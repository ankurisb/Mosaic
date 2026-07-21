// -- /api/query-runner/generate -------------------------------
// Turn a plain-English question into a query for a specific connection.
//
// Deliberately does NOT execute anything. It returns the query so the Query
// Builder can put it in the editor where the user can read, edit and run it.
// That keeps the manual path intact (the builder works with no AI at all),
// keeps generated SQL auditable, and means execution still goes through
// /api/query-runner with its existing read-only checks, LIMIT injection and
// query_history logging rather than a second, less-guarded path.

import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getKey } from '@/lib/keys'
import { getOrFetchSchema } from '@/lib/tools'
import { log } from '@/lib/logger'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'

// Generated SQL must be a read. The connection-level read_only flag in
// query-runner is opt-in per connection, so we cannot rely on it here — a
// model mistake against a writable connection would otherwise be executable.
const READ_ONLY_SQL = /^\s*(SELECT|WITH|SHOW)\b/i

// Keep the prompt bounded on wide schemas. Industrial databases routinely have
// hundreds of tables; sending all of them wastes tokens and buries the
// relevant ones.
const MAX_TABLES = 40
const MAX_COLS = 40

type Schema = Awaited<ReturnType<typeof getOrFetchSchema>>

/** Render the cached schema as compact text for the prompt. */
function describeSchema(schema: Schema): string {
  if (!schema) return ''
  const parts: string[] = []

  for (const t of (schema.tables ?? []).slice(0, MAX_TABLES)) {
    const name = t.schema ? `${t.schema}.${t.name}` : t.name
    const cols = (t.columns ?? []).slice(0, MAX_COLS)
      .map(c => `${c.name} ${c.type}${c.pk ? ' PK' : ''}`)
      .join(', ')
    parts.push(`${name}(${cols})`)
  }

  // InfluxDB: measurements with tags and fields rather than tables.
  for (const m of (schema.measurements ?? []).slice(0, MAX_TABLES)) {
    const tags = (m.tag_keys ?? []).join(', ')
    const fields = (m.field_keys ?? []).map(f => `${f.name} ${f.type}`).join(', ')
    parts.push(`measurement ${m.name} — tags: ${tags} — fields: ${fields}`)
  }

  // MongoDB: collections with observed keys.
  for (const c of (schema.collections ?? []).slice(0, MAX_TABLES)) {
    const keys = (c.sample_keys ?? []).map(k => `${k.name} ${k.type}`).join(', ')
    parts.push(`collection ${c.name}(${keys})`)
  }

  return parts.join('\n')
}

/** Dialect-specific instructions. Not every source speaks SQL. */
function dialectRules(dialect: string): string {
  switch (dialect) {
    case 'mongodb':
      return 'Return a MongoDB query as a JSON object with keys: collection, filter, and optionally sort, limit, projection. Return JSON only.'
    case 'influxdb':
      return 'Return a single InfluxQL SELECT statement. Time filters use e.g. WHERE time > now() - 7d.'
    case 'elasticsearch':
      return 'Return an Elasticsearch query as a JSON object with keys: index and query. Return JSON only.'
    case 'mssql':
      return 'Return a single T-SQL SELECT statement. Use SELECT TOP n rather than LIMIT.'
    case 'postgres':
      return 'Return a single PostgreSQL SELECT statement. Quote identifiers only when necessary.'
    case 'mysql':
      return 'Return a single MySQL SELECT statement.'
    default:
      return 'Return a single standard SQL SELECT statement.'
  }
}

function buildSystemPrompt(dialect: string, schemaText: string): string {
  return [
    'You translate plain-English questions from factory and operations staff into database queries.',
    '',
    dialectRules(dialect),
    '',
    'Rules:',
    '- Read-only. Never produce INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE or CREATE.',
    '- Use only the tables and columns in the schema below. Never invent names.',
    '- If the question cannot be answered from this schema, reply with exactly: CANNOT_ANSWER',
    '- Prefer readable output: alias aggregates, and order results the way a person would expect.',
    '- Do not add a row limit; the caller applies one.',
    '- Output the query only. No explanation, no markdown fences, no commentary.',
    '',
    'Schema:',
    schemaText || '(schema unavailable)',
  ].join('\n')
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { connectionId, question } = await req.json() as {
    connectionId?: string; question?: string
  }
  if (!connectionId || !question?.trim())
    return Response.json({ error: 'connectionId and question are required' }, { status: 400 })

  // Availability first, so the UI gets a clean, explainable refusal rather than
  // an SDK error. `code` lets the client show the right message without
  // string-matching.
  const [apiKey, aiEnabledRaw] = await Promise.all([
    getKey('ANTHROPIC_API_KEY'),
    getKey('AI_ENABLED'),
  ])
  const aiDisabled = (aiEnabledRaw ?? '').toLowerCase() === 'false'
  if (aiDisabled || !apiKey) {
    return Response.json({
      code: 'no_llm',
      disabled: aiDisabled,
      error: aiDisabled
        ? 'This deployment runs without an AI model, so questions can\'t be translated into queries. You can still write and run queries yourself.'
        : 'Mosaic isn\'t connected to an AI model yet, so it can\'t turn your question into a query. An admin can connect one in Settings → API Keys. You can still write and run queries yourself.',
    }, { status: 503 })
  }

  const sql = getDb()
  const rows = await sql`SELECT id, label, dialect FROM db_connections WHERE id = ${connectionId} LIMIT 1`
  const conn = (rows as { id: string; label: string; dialect: string }[])[0]
  if (!conn) return Response.json({ error: 'Connection not found' }, { status: 404 })

  const schema = await getOrFetchSchema(connectionId)
  const schemaText = describeSchema(schema)
  if (!schemaText) {
    return Response.json({
      code: 'no_schema',
      error: 'Mosaic hasn\'t read this connection\'s schema yet, so it can\'t build a query. Open the table list once to load it, then try again.',
    }, { status: 409 })
  }

  try {
    const anthropic = new Anthropic({ apiKey })
    const resp = await anthropic.messages.create({
      // Haiku: this is a short, well-constrained translation task, and the
      // Query Builder is interactive so latency matters more than depth.
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: buildSystemPrompt(conn.dialect, schemaText),
      messages: [{ role: 'user', content: question.trim() }],
    })

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim()
      // Models still fence occasionally despite being told not to.
      .replace(/^```(?:sql|json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()

    if (!text || /^CANNOT_ANSWER$/i.test(text)) {
      return Response.json({
        code: 'cannot_answer',
        error: 'That question doesn\'t look answerable from this data source\'s schema. Try naming the table or field you have in mind.',
      }, { status: 422 })
    }

    // Guard the SQL dialects. JSON-query sources (mongo/elasticsearch) are
    // structurally incapable of expressing a write through this path, so the
    // read-only check applies only where it is meaningful.
    const isJsonDialect = conn.dialect === 'mongodb' || conn.dialect === 'elasticsearch'
    if (!isJsonDialect && !READ_ONLY_SQL.test(text)) {
      log.warn({ service: 'query-generate', dialect: conn.dialect }, 'Rejected non-read generated query')
      return Response.json({
        code: 'not_read_only',
        error: 'Mosaic only generates read-only queries, and this question produced something that would modify data. Rephrase it as a question about existing data.',
      }, { status: 422 })
    }
    if (isJsonDialect) {
      try { JSON.parse(text) } catch {
        return Response.json({
          code: 'bad_json',
          error: 'The generated query wasn\'t valid JSON for this data source. Try rephrasing your question.',
        }, { status: 422 })
      }
    }

    return Response.json({ query: text, dialect: conn.dialect })
  } catch (err) {
    log.error({ service: 'query-generate', err }, 'Generation failed')
    return Response.json({
      code: 'generation_failed',
      error: 'Couldn\'t reach the AI model just now. You can still write the query yourself.',
    }, { status: 502 })
  }
}

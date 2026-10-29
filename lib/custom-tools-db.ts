// lib/custom-tools-db.ts — DB glue for custom tools (kept out of lib/custom-tools.ts so that
// the executor/validation logic stays pure and unit-testable).
import { getDb } from './db'
import type { CustomToolDef } from './custom-tools'

type Row = Record<string, unknown>

export function rowToCustomTool(r: Row): CustomToolDef {
  const parse = <T,>(v: unknown, d: T): T => { try { return (typeof v === 'string' ? JSON.parse(v) : (v ?? d)) as T } catch { return d } }
  return {
    name: String(r.name),
    description: String(r.description || ''),
    method: String(r.method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET',
    url_template: String(r.url_template || ''),
    headers: parse<Record<string, string>>(r.headers, {}),
    body_template: r.body_template == null ? undefined : String(r.body_template),
    read_only: Number(r.read_only) !== 0,
    input_schema: parse<CustomToolDef['input_schema']>(r.input_schema, { type: 'object', properties: {} }),
  }
}

/** Load enabled custom-tool definitions for a set of ids (order not guaranteed). */
export async function loadCustomTools(ids: string[]): Promise<CustomToolDef[]> {
  if (!Array.isArray(ids) || ids.length === 0) return []
  const sql = getDb()
  const out: CustomToolDef[] = []
  for (const id of ids.slice(0, 50)) {
    const rows = await sql`SELECT * FROM custom_tools WHERE id=${id} AND enabled=1`.catch(() => []) as Row[]
    if (rows[0]) out.push(rowToCustomTool(rows[0]))
  }
  return out
}

/** Attach resolved custom tools onto an AgentDef, from its custom_tool_ids column. */
export async function attachCustomTools<T extends { customTools?: CustomToolDef[] }>(agent: T, idsJson: unknown): Promise<T> {
  let ids: string[] = []
  try { ids = typeof idsJson === 'string' ? JSON.parse(idsJson) : (Array.isArray(idsJson) ? idsJson as string[] : []) } catch { ids = [] }
  if (ids.length) agent.customTools = await loadCustomTools(ids.map(String))
  return agent
}

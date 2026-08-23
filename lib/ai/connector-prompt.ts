// lib/ai/connector-prompt.ts
// AI generation of Airbyte declarative (low-code) connector manifests.
//
// Two entry points:
//   generateManifest(description, sample?) -> a first-draft manifest from a
//     plain-English source description (+ optional sample response / API docs)
//   refineManifest(manifest, feedback) -> a corrected manifest given the REAL
//     result of testing the previous draft against the live source (records or
//     errors from read_stream). This is the loop that makes it robust: the model
//     iterates against ground truth, not its own assumptions.
//
// The system prompt encodes the manifest requirements learned by actually
// debugging Airbyte's connector-builder (the `spec` block, the check stream, the
// DpathExtractor field_path, request_parameters) so first drafts are usually
// valid.
import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-sonnet-4-6'

const SYSTEM = `You generate Airbyte DECLARATIVE (low-code) connector manifests for REST/HTTP APIs.
You output ONLY a single JSON object — the manifest — with no prose, no markdown, no code fences.

The manifest MUST have this exact shape and required blocks:
{
  "version": "0.79.0",
  "type": "DeclarativeSource",
  "check": { "type": "CheckStream", "stream_names": ["<primary stream>"] },
  "spec": {
    "type": "Spec",
    "connection_specification": {
      "type": "object",
      "$schema": "http://json-schema.org/draft-07/schema#",
      "properties": { /* user-config fields, e.g. api_key, base_url — {} if none */ },
      "additionalProperties": true
    }
  },
  "streams": [
    {
      "type": "DeclarativeStream",
      "name": "<stream name>",
      "primary_key": "<field or [] if none>",
      "schema_loader": {
        "type": "InlineSchemaLoader",
        "schema": {
          "$schema": "http://json-schema.org/draft-07/schema#",
          "type": "object",
          "additionalProperties": true,
          "properties": { /* one entry PER field a record contains, e.g. "id": {"type":["integer","null"]}, "name": {"type":["string","null"]} */ }
        }
      },
      "retriever": {
        "type": "SimpleRetriever",
        "requester": {
          "type": "HttpRequester",
          "url_base": "<https://host>",
          "path": "<path>",
          "http_method": "GET",
          "request_parameters": { /* query params as string values, omit if none */ }
        },
        "record_selector": {
          "type": "RecordSelector",
          "extractor": {
            "type": "DpathExtractor",
            "field_path": [ /* path to the records array; [] if records are the root array, ["items"] if nested under "items", etc. */ ]
          }
        }
      }
    }
  ]
}

CRITICAL RULES:
- The "spec" block is REQUIRED. Omitting it makes the connector fail to load.
- Every stream MUST have a "schema_loader" of type InlineSchemaLoader whose schema
  declares the record fields under "properties". This is what lets Airbyte
  DISCOVER the stream and land it to a table — a stream with no declared schema is
  invisible to sync. Infer the fields from the description and any sample provided;
  make every field nullable (e.g. {"type":["string","null"]}) so real-world nulls
  don't break the sync. Include "additionalProperties": true so unexpected fields
  still flow through.
- field_path is [] ONLY when the response body IS the array of records. If records
  are nested (e.g. {"items":[...]}, {"data":{"results":[...]}}), set field_path
  accordingly (["items"] or ["data","results"]).
- request_parameters values must be STRINGS ("5", not 5).
- If the API needs auth, add the appropriate authenticator to the requester
  (ApiKeyAuthenticator / BearerAuthenticator / BasicHttpAuthenticator) and declare
  the corresponding fields in spec.connection_specification.properties, referencing
  them as "{{ config['field_name'] }}".
- Prefer the smallest page size the API supports for the check stream.
- Output the JSON object only.`

function extractJson(text: string): Record<string, unknown> {
  // Strip any accidental fences, then parse the first {...} block.
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('AI did not return a JSON manifest')
  return JSON.parse(cleaned.slice(start, end + 1))
}

export interface ManifestResult {
  ok: boolean
  manifest?: Record<string, unknown>
  streamName?: string
  reason?: string
}

/** Generate a first-draft manifest from a plain-English description (+ optional sample/docs). */
export async function generateManifest(description: string, sample?: string): Promise<ManifestResult> {
  try {
    const client = new Anthropic()
    const user = [
      `Source description:\n${description}`,
      sample ? `\nSample response or API docs (use this to get the record path and fields right):\n${sample.slice(0, 6000)}` : '',
      `\nGenerate the declarative manifest JSON.`,
    ].join('')
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
    })
    const text = (msg.content.find(b => b.type === 'text') as { text: string } | undefined)?.text ?? ''
    const manifest = extractJson(text)
    const streamName = firstStreamName(manifest)
    return { ok: true, manifest, streamName }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Refine a manifest using the REAL outcome of testing the previous draft.
 * `feedback` should carry what actually happened: the returned records (so the
 * model can confirm the shape) and/or the error/log messages from read_stream.
 */
export async function refineManifest(params: {
  previousManifest: Record<string, unknown>
  testRecords?: unknown[]
  testError?: string
  testLogs?: unknown[]
  userNote?: string
}): Promise<ManifestResult> {
  try {
    const client = new Anthropic()
    const parts = [
      `Here is the previous manifest you generated:\n${JSON.stringify(params.previousManifest, null, 2)}`,
      params.testError ? `\nTesting it against the live source FAILED with:\n${params.testError}` : '',
      params.testLogs?.length ? `\nAirbyte logs:\n${JSON.stringify(params.testLogs).slice(0, 2000)}` : '',
      params.testRecords?.length
        ? `\nIt returned ${params.testRecords.length} records; here is the first one:\n${JSON.stringify(params.testRecords[0], null, 2).slice(0, 2000)}`
        : (params.testError ? '' : '\nIt returned ZERO records — the record path (field_path) is likely wrong.'),
      params.userNote ? `\nUser correction: ${params.userNote}` : '',
      `\nReturn a corrected manifest JSON that fixes the problem.`,
    ]
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: 'user', content: parts.join('') }],
    })
    const text = (msg.content.find(b => b.type === 'text') as { text: string } | undefined)?.text ?? ''
    const manifest = extractJson(text)
    return { ok: true, manifest, streamName: firstStreamName(manifest) }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

function firstStreamName(manifest: Record<string, unknown>): string | undefined {
  const streams = manifest.streams as { name?: string }[] | undefined
  return streams?.[0]?.name
}

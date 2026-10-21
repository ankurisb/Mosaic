// lib/cube-sync.ts
// Phase 6: write the generated Cube schema + the datasource map into the shared volume
// that the Cube engine reads (CUBE_MODEL_DIR, default /cube-model). Thin I/O around the
// pure builders in cube-schema.ts / cube-client.ts. No-ops safely when CUBE_MODEL_DIR is
// unset (Cube not deployed) so it is harmless to call unconditionally after a semantic
// model or connection change.
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { getDb } from './db'
import { decrypt } from './encrypt'
import { log } from './logger'
import { getSemanticModel } from './semantic-model'
import { generateCubeSchema, renderAllCubes } from './cube-schema'
import { buildDatasourceMap, cubeDialectSupported, type DbConnLike } from './cube-client'

function modelDir(): string | null {
  const d = process.env.CUBE_MODEL_DIR
  return d && d.trim() ? d.trim() : null
}

// Write .datasources.json (connId -> driver config, passwords decrypted) for every
// Cube-supported connection. Returns the number of sources written.
export async function syncDatasourceMap(): Promise<number> {
  const dir = modelDir()
  if (!dir) return 0
  const sql = getDb()
  const rows = await sql`SELECT id, dialect, host, port, database_name, username, password_enc FROM db_connections` as unknown as Array<DbConnLike & { password_enc?: string | null }>
  const passwordFor = (id: string) => {
    const r = rows.find(x => x.id === id)
    try { return r?.password_enc ? decrypt(r.password_enc) : undefined } catch { return undefined }
  }
  const map = buildDatasourceMap(rows, passwordFor)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '.datasources.json'), JSON.stringify(map, null, 2), { mode: 0o600 })
  return Object.keys(map).length
}

// Generate + write the cube schema file for one source (one .js file per connection,
// each cube tagged with its data_source). Skips non-Cube dialects.
export async function syncCubeSchemaForSource(sourceId: string, dialect?: string | null): Promise<boolean> {
  const dir = modelDir()
  if (!dir) return false
  if (!cubeDialectSupported(dialect)) return false
  const model = await getSemanticModel('database', sourceId)
  const cubes = generateCubeSchema([...model.byKey.values()], sourceId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const safe = sourceId.replace(/[^A-Za-z0-9_-]/g, '_')
  writeFileSync(join(dir, `${safe}.js`), renderAllCubes(cubes), { mode: 0o644 })
  return cubes.length > 0
}

// Full resync: datasource map + a schema file per Cube-supported connection. Called after
// a semantic-model change or a connection add/edit. Fire-and-forget safe.
export async function resyncCubeModel(): Promise<{ sources: number; schemas: number }> {
  const dir = modelDir()
  if (!dir) return { sources: 0, schemas: 0 }
  try {
    const sources = await syncDatasourceMap()
    const sql = getDb()
    const rows = await sql`SELECT id, dialect FROM db_connections` as Array<{ id: string; dialect?: string | null }>
    let schemas = 0
    for (const r of rows) {
      if (await syncCubeSchemaForSource(r.id, r.dialect)) schemas++
    }
    log.info({ sources, schemas }, 'cube model resynced')
    return { sources, schemas }
  } catch (e) {
    log.warn({ err: (e as Error)?.message }, 'cube model resync failed (non-fatal)')
    return { sources: 0, schemas: 0 }
  }
}

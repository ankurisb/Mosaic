// lib/mosaic-folders.ts
// Personal edition: turn each top-level subfolder of the mounted ~/Mosaic/files tree
// into its OWN "Mosaic Files: <name>" data source (scoped via sub_path), plus a root
// source for loose files. Gives users real data boundaries — organised subfolders
// become separate sources the AI treats independently, so it won't cross-correlate
// (e.g. production vs compliance) unless explicitly asked. Idempotent + prunes sources
// for folders that are gone, so it runs at boot and on a schedule as folders change.
import { getDb } from './db'
import { log } from './logger'

const MOUNT = '/mosaic-files'
const DEFAULT_TYPES = 'csv,xlsx,xls,pdf,txt,md,xml,json,docx,pptx'
const ROOT_LABEL = 'Mosaic Files'
const SUB_PREFIX = 'Mosaic Files: '

export async function syncMosaicFolders(): Promise<{ created: number; removed: number; kept: number } | null> {
  if ((process.env.MOSAIC_EDITION || 'personal') !== 'personal' || !process.env.MOSAIC_FILES_DIR) return null

  const sql = getDb()
  let subdirs: string[] = []
  let hasLooseFiles = false
  try {
    const { readdir } = await import('fs/promises')
    const entries = await readdir(MOUNT, { withFileTypes: true })
    subdirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name).sort()
    hasLooseFiles = entries.some(e => e.isFile() && !e.name.startsWith('.'))
  } catch {
    return null
  }

  try {
    const existing = await sql`
      SELECT id, label, sub_path FROM file_servers
      WHERE transport = 'local' AND share_path = ${MOUNT}
        AND (label = ${ROOT_LABEL} OR label LIKE ${SUB_PREFIX + '%'})
    ` as unknown as { id: string; label: string; sub_path: string | null }[]

    const bySubPath = new Map(existing.map(e => [e.sub_path || '', e]))
    let created = 0, removed = 0

    // Root "Mosaic Files" source. ALWAYS ensure it exists in Personal — even when the
    // folder is empty (fresh install) — so a new user immediately sees where to drop
    // files. (Previously it was only created once loose files appeared, so a fresh
    // install showed NO Mosaic Files source at all — the signature feature was
    // invisible until the user both added a file and waited for a sync.)
    const rootExisting = bySubPath.get('')
    if (!rootExisting) {
      await sql`INSERT INTO file_servers (label, transport, environment, share_path, sub_path, file_types)
                VALUES (${ROOT_LABEL}, 'local', 'production', ${MOUNT}, NULL, ${DEFAULT_TYPES})`
      created++
    }
    void hasLooseFiles

    // One source per subfolder.
    for (const name of subdirs) {
      if (!bySubPath.has(name)) {
        await sql`INSERT INTO file_servers (label, transport, environment, share_path, sub_path, file_types)
                  VALUES (${SUB_PREFIX + name}, 'local', 'production', ${MOUNT}, ${name}, ${DEFAULT_TYPES})`
        created++
      }
    }

    // Prune auto sources whose subfolder no longer exists.
    const liveSubPaths = new Set<string>(['', ...subdirs])
    for (const e of existing) {
      const sp = e.sub_path || ''
      if (sp !== '' && !liveSubPaths.has(sp)) {
        await sql`DELETE FROM file_servers WHERE id = ${e.id}`
        removed++
      }
    }

    const kept = existing.length - removed
    if (created || removed) log.info({ service: 'mosaic-folders', created, removed, kept }, 'synced Mosaic Files folder sources')
    return { created, removed, kept }
  } catch (e) {
    log.warn({ service: 'mosaic-folders', err: (e as Error).message }, 'folder sync skipped')
    return null
  }
}

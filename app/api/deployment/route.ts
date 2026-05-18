import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
export const runtime = 'nodejs'

function getBuildDate(): string {
  try {
    const d = execSync('git log -1 --format=%cd --date=format:%Y%m%d', { cwd: process.cwd(), timeout: 3000 }).toString().trim()
    return d || new Date().toISOString().slice(0,10).replace(/-/g,'')
  } catch {
    return new Date().toISOString().slice(0,10).replace(/-/g,'')
  }
}

function parseChangelog(md: string) {
  const releases: Array<{ version: string; date: string; sections: Record<string, string[]> }> = []
  let current: typeof releases[0] | null = null
  let currentSection = ''
  for (const line of md.split('\n')) {
    const releaseMatch = line.match(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})/)
    if (releaseMatch) {
      current = { version: releaseMatch[1], date: releaseMatch[2], sections: {} }
      releases.push(current)
      continue
    }
    const sectionMatch = line.match(/^### (.+)/)
    if (sectionMatch && current) { currentSection = sectionMatch[1]; current.sections[currentSection] = []; continue }
    const itemMatch = line.match(/^- (.+)/)
    if (itemMatch && current && currentSection) current.sections[currentSection].push(itemMatch[1])
  }
  return releases
}

export async function GET() {
  const isVercel = !!process.env.VERCEL
  const dbUrl = process.env.DATABASE_URL || ''
  const isNeon = dbUrl.includes('neon.tech') || dbUrl.includes('neondb.net') || dbUrl.includes('postgresql')
  const isSqlite = dbUrl.startsWith('sqlite')

  let changelog: ReturnType<typeof parseChangelog> = []
  try {
    const md = fs.readFileSync(path.join(process.cwd(), 'CHANGELOG.md'), 'utf8')
    changelog = parseChangelog(md)
  } catch { /* CHANGELOG.md not found */ }

  // Read current version from package.json
  let currentVersion = '1.0.0'
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
    currentVersion = pkg.version || '1.0.0'
  } catch { /* use fallback */ }

  // Check for updates via GitHub releases API
  let latestVersion: string | null = null
  let latestReleaseUrl: string | null = null
  let updateAvailable = false
  try {
    const { getKey } = await import('@/lib/keys')
    const token = await getKey('GITHUB_TOKEN')
    const repo  = await getKey('GITHUB_REPO') || 'ankurisb/Mosaic'
    if (token && repo) {
      const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        const data = await res.json() as { tag_name: string; html_url: string }
        latestVersion = data.tag_name?.replace(/^v/, '') || null
        latestReleaseUrl = data.html_url || null
        if (latestVersion) {
          const [lMaj, lMin, lPat] = latestVersion.split('.').map(Number)
          const [cMaj, cMin, cPat] = currentVersion.split('.').map(Number)
          updateAvailable = lMaj > cMaj || (lMaj === cMaj && lMin > cMin) || (lMaj === cMaj && lMin === cMin && lPat > cPat)
        }
      }
    }
  } catch { /* offline or no token */ }

  return Response.json({
    mode: isVercel ? 'vercel' : 'self-hosted',
    scheduler: isVercel ? 'Vercel Cron' : 'Built-in',
    database: isSqlite ? 'SQLite (local)' : isNeon ? 'Neon Postgres (cloud)' : 'Postgres',
    appUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    nodeEnv: process.env.NODE_ENV || 'development',
    buildDate: getBuildDate(),
    changelog,
    currentVersion,
    latestVersion,
    latestReleaseUrl,
    updateAvailable,
  })
}

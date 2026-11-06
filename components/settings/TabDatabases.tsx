'use client'
import React, { useState, useEffect, useRef } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, INP, SEL, Btn, Badge, StatusDot, Field, Grid, Alert, Spinner } from './ui'
import { safeJson } from '@/lib/fetch'
import SemanticDescriptionsModal from './SemanticDescriptionsModal'

interface DbConn { id: string; label: string; dialect: string; environment: string; host: string; port: number; database_name: string; username: string; schema_name: string; ssl_mode: string; pool_min: number; pool_max: number; read_only: boolean; mcp_endpoint?: string; mcp_token?: string; full_text_search?: boolean | number; fts_airbyte_conn_id?: string; managed?: boolean | number; description?: string }
interface TestResult { ok: boolean; message?: string; latencyMs?: number; detail?: string }
const EMPTY = { label: '', dialect: 'postgres', environment: 'development', host: '', port: '5432', database_name: '', username: '', password: '', connection_string: '', schema_name: 'public', ssl_mode: 'prefer', ssl_ca: '', pool_min: '1', pool_max: '5', connect_timeout_ms: '5000', query_timeout_ms: '30000', read_only: false, mcp_endpoint: '', mcp_token: '', description: '', full_text_search: false, fts_airbyte_conn_id: '', managed: false, auth_mode: 'sql', tenant_id: '', warehouse: '', role: '', http_path: '' }

// Keys whose values look like DB connection strings
const ENV_KEY_PATTERNS = [/DATABASE_URL/i, /DB_URL/i, /DB_URI/i, /_DSN/i, /POSTGRES/i, /POSTGRESQL/i, /MYSQL/i, /MONGO/i, /CLICKHOUSE/i, /INFLUX/i, /REDIS/i, /SQLITE/i, /CONNECTION_STRING/i, /CONN_STR/i]
const CONN_PROTOCOLS = ['postgresql://', 'postgres://', 'mysql://', 'mysql2://', 'mongodb://', 'mongodb+srv://', 'mssql://', 'sqlserver://', 'clickhouse://', 'clickhouses://', 'redis://', 'sqlite://', 'http://', 'https://']

// Parse a .env file -- client-side only, never uploaded
function parseEnvFile(content: string): Array<{ key: string; value: string }> {
  const results: Array<{ key: string; value: string }> = []
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i)
    if (!match) continue
    const key = match[1]
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    const keyOk = ENV_KEY_PATTERNS.some(p => p.test(key))
    const valOk = CONN_PROTOCOLS.some(p => value.toLowerCase().startsWith(p))
    if (keyOk && valOk) results.push({ key, value })
  }
  return results
}

// Parse a connection string and return form fields -- returns null if unrecognised
function parseConnStr(raw: string): Partial<typeof EMPTY> | null {
  if (!raw || !raw.trim()) return null
  const s = raw.trim()

  // SQLite -- file path or :memory:
  if (s === ':memory:' || s.startsWith('/') || s.startsWith('./') || s.endsWith('.db') || s.endsWith('.sqlite')) {
    return { dialect: 'sqlite', host: s, port: '', database_name: s, username: '', ssl_mode: 'disable' }
  }

  // InfluxDB -- heuristic before generic URL parse
  if (s.includes('influx') || s.includes(':8086')) {
    try {
      const u = new URL(s.startsWith('http') ? s : 'http://' + s)
      return { dialect: 'influxdb', host: u.hostname, port: u.port || '8086', database_name: u.pathname.replace(/^\//, '') || '', username: decodeURIComponent(u.username || ''), password: decodeURIComponent(u.password || ''), ssl_mode: u.protocol === 'https:' ? 'require' : 'disable' }
    } catch {}
  }

  try {
    const u = new URL(s)
    const proto = u.protocol.replace(':', '').toLowerCase()
    const dialectMap: Record<string, string> = { postgres: 'postgres', postgresql: 'postgres', mysql: 'mysql', mysql2: 'mysql', mssql: 'mssql', sqlserver: 'mssql', mongodb: 'mongodb', 'mongodb+srv': 'mongodb', clickhouse: 'clickhouse', clickhouses: 'clickhouse', redshift: 'redshift' }
    const dialect = dialectMap[proto] || 'postgres'
    const params = u.searchParams
    const sslParam = params.get('sslmode') || params.get('ssl') || params.get('tls') || ''
    let ssl_mode = 'prefer'
    if (['disable', 'false', '0'].includes(sslParam)) ssl_mode = 'disable'
    else if (['require', 'true', '1'].includes(sslParam)) ssl_mode = 'require'
    else if (sslParam === 'verify-ca') ssl_mode = 'verify-ca'
    else if (sslParam === 'verify-full') ssl_mode = 'verify-full'
    else if (proto === 'mongodb+srv' || proto === 'clickhouses') ssl_mode = 'require'
    else if (proto === 'clickhouse') ssl_mode = 'disable'
    const defaultPorts: Record<string, string> = { postgres: '5432', mysql: '3306', mssql: '1433', mongodb: '27017', clickhouse: '8123', influxdb: '8086', redshift: '5439' }
    return {
      dialect, host: u.hostname, port: u.port || defaultPorts[dialect] || '',
      database_name: u.pathname.replace(/^\//, ''),
      username: decodeURIComponent(u.username || ''), password: decodeURIComponent(u.password || ''),
      ssl_mode, schema_name: params.get('schema') || params.get('currentSchema') || 'public',
    }
  } catch {}
  return null
}

export default function TabDatabases({ user }: { user: SessionUser }) {
  const [conns, setConns] = useState<DbConn[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<Record<string, string | boolean>>(EMPTY)
  const [editing, setEditing] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, TestResult>>({})
  const [ftsLoading, setFtsLoading] = useState<Record<string,boolean>>({})
  const [describing, setDescribing] = useState<DbConn | null>(null)
  const [coverage, setCoverage] = useState<Record<string, { needs_config: boolean; verified: number; cube_serving: string | null; cube_reason: string | null }>>({})
  const [rechecking, setRechecking] = useState<Record<string, boolean>>({})

  async function toggleFts(connId: string, currentlyEnabled: boolean) {
    setFtsLoading(p => ({ ...p, [connId]: true }))
    try {
      const r = await fetch('/api/connections/fts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: connId, enable: !currentlyEnabled }),
      })
      const data = await r.json()
      if (!r.ok || data.error) {
        alert(data.error || 'Failed to update full-text search')
      } else {
        await load()
      }
    } catch {
      alert('Failed to update full-text search')
    } finally {
      setFtsLoading(p => ({ ...p, [connId]: false }))
    }
  }
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [parsedOk, setParsedOk] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)

  // Scroll edit form into view when it opens
  useEffect(() => {
    if (showForm && formRef.current) {
      formRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [showForm, editing])
  // .env import state
  const envFileRef = useRef<HTMLInputElement>(null)
  const [envPreview, setEnvPreview] = useState<Array<{ key: string; value: string; selected: boolean; parsed: Partial<typeof EMPTY> | null }> | null>(null)
  const [envImporting, setEnvImporting] = useState(false)
  const [envDragOver, setEnvDragOver] = useState(false)

  const [sandboxing, setSandboxing] = useState(false)
  const [dbSearch, setDbSearch] = useState('')
  const [dbPage, setDbPage] = useState(1)
  const [sandboxMsg, setSandboxMsg] = useState('')
  const [harnessing, setHarnessing] = useState(false)
  const [harnessMsg, setHarnessMsg] = useState('')
  const [harnessStatus, setHarnessStatus] = useState<{ total: number; registered: number } | null>(null)
  const [harnessCmdCopied, setHarnessCmdCopied] = useState('')

  // Apply a parsed connection string -- fills all fields, auto-selects dialect
  function applyConnStr(raw: string) {
    const parsed = parseConnStr(raw)
    if (parsed) {
      setForm(p => ({ ...p, ...parsed, connection_string: raw }))
      setParsedOk(true)
    } else {
      setParsedOk(false)
    }
  }

  // Handle .env file -- parse client-side, never upload
  function handleEnvFile(file: File) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = e => {
      const content = e.target?.result as string
      const found = parseEnvFile(content)
      if (!found.length) {
        alert('No database connection strings found in this .env file.\n\nLooking for keys like DATABASE_URL, MYSQL_URL, MONGODB_URI, etc. with protocol-based values (postgresql://, mysql://, etc.).')
        return
      }
      setEnvPreview(found.map(item => ({
        ...item,
        selected: true,
        parsed: parseConnStr(item.value),
      })))
    }
    reader.readAsText(file)
  }

  async function importEnvSelected() {
    if (!envPreview) return
    const toImport = envPreview.filter(i => i.selected && i.parsed)
    if (!toImport.length) return
    setEnvImporting(true)
    for (const item of toImport) {
      const label = item.key.replace(/_URL$|_URI$|_DSN$|_STRING$/i, '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || item.key
      await fetch('/api/connections', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', ...EMPTY, ...item.parsed, connection_string: item.value, label, environment: 'development' }),
      })
    }
    setEnvPreview(null)
    setEnvImporting(false)
    load()
  }

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/connections')
      if (r.ok) {
        const data = await r.json()
        setConns(Array.isArray(data.connections) ? data.connections : [])
      }
    } finally {
      setLoading(false)
    }
    loadCoverage()
  }

  async function loadCoverage() {
    try {
      const r = await fetch('/api/semantic?view=coverage')
      if (!r.ok) return
      const d = await r.json() as { sources?: Array<{ source_id: string; needs_config: boolean; verified: number; cube_serving: string | null; cube_reason: string | null }> }
      const m: Record<string, { needs_config: boolean; verified: number; cube_serving: string | null; cube_reason: string | null }> = {}
      for (const s of d.sources || []) m[s.source_id] = { needs_config: s.needs_config, verified: s.verified, cube_serving: s.cube_serving ?? null, cube_reason: s.cube_reason ?? null }
      setCoverage(m)
    } catch { /* non-fatal */ }
  }

  // Actively re-probe whether a source serves through Cube, then refresh the badge.
  async function recheckCube(id: string) {
    setRechecking(s => ({ ...s, [id]: true }))
    try { await fetch(`/api/semantic?view=cube-readiness&source_id=${encodeURIComponent(id)}`) }
    catch { /* non-fatal */ }
    finally { await loadCoverage(); setRechecking(s => ({ ...s, [id]: false })) }
  }

  async function createSandbox() {
    setSandboxing(true); setSandboxMsg('')
    try {
      const r = await fetch('/api/test-db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create_sandbox' }) })
      const { data: d, error: err } = await safeJson<{ already_existed?: boolean; error?: string }>(r)
      if (err) { setSandboxMsg('Error: ' + err); return }
      setSandboxMsg(d?.already_existed ? 'Sandbox already exists — see connection list below.' : '✓ Sandbox DB created! Ask Mosaic: "Show me OEE for each machine"')
      await load()
    } finally { setSandboxing(false) }
  }
  async function loadHarnessStatus() {
    if (user.role !== 'admin') return
    const r = await fetch('/api/test-db?status=harness')
    const { data } = await safeJson<{ total: number; registered: number }>(r)
    if (data && typeof data.total === 'number') setHarnessStatus({ total: data.total, registered: data.registered })
  }
  async function createHarness() {
    setHarnessing(true); setHarnessMsg('')
    try {
      const r = await fetch('/api/test-db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create_harness' }) })
      const { data: d, error: err } = await safeJson<{ added?: string[]; skipped?: string[]; already_existed?: boolean; error?: string }>(r)
      if (err) { setHarnessMsg('Error: ' + err); return }
      const added = d?.added?.length ?? 0
      const skipped = d?.skipped?.length ?? 0
      setHarnessMsg(
        added === 0
          ? `All ${skipped} harness sources already registered — see the list below.`
          : `✓ Registered ${added} harness source${added === 1 ? '' : 's'}${skipped ? ` (${skipped} already present)` : ''}. Start the demo profile to bring them online.`
      )
      await Promise.all([load(), loadHarnessStatus()])
    } finally { setHarnessing(false) }
  }
  async function removeHarness() {
    if (!confirm('Deregister the test harness? This removes the harness connections so their data is no longer used by Mosaic. It does NOT stop the containers, and you can re-add it anytime.')) return
    setHarnessing(true); setHarnessMsg('')
    try {
      const r = await fetch('/api/test-db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove_harness' }) })
      const { data: d, error: err } = await safeJson<{ removed?: string[]; none_present?: boolean; error?: string }>(r)
      if (err) { setHarnessMsg('Error: ' + err); return }
      const removed = d?.removed?.length ?? 0
      setHarnessMsg(removed === 0 ? 'No harness sources were registered.' : `✓ Deregistered ${removed} harness source${removed === 1 ? '' : 's'}. Mosaic will no longer use their data.`)
      await Promise.all([load(), loadHarnessStatus()])
    } finally { setHarnessing(false) }
  }
  function copyHarnessCmd(cmd: string, key: string) {
    navigator.clipboard?.writeText(cmd).then(() => { setHarnessCmdCopied(key); setTimeout(() => setHarnessCmdCopied(''), 1500) }).catch(() => {})
  }
  useEffect(() => { load(); loadHarnessStatus() }, [])

  const set = (k: string, v: string | boolean) => setForm(p => ({ ...p, [k]: v }))

  async function save() {
    if (!form.label) { setError('Label is required'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: editing ? 'update' : 'create', id: editing, ...form }) })
      const { data, error: err } = await safeJson<{ id?: string }>(r)
      if (err) { setError(err); return }
      // The connection saved. Immediately verify it actually connects, so a
      // wrong host / SSL mode / credential surfaces here at setup time rather
      // than later as an empty Query Builder dropdown. The row's own Test
      // button drives the same check; this just runs it automatically once.
      const savedId = editing || data?.id
      setShowForm(false); setEditing(null); setForm(EMPTY); setError('')
      await load()
      if (savedId) test(savedId)
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  async function test(id: string) {
    setTesting(id)
    try {
      const r = await fetch('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test', id }) })
      const { data, error: err } = await safeJson<TestResult>(r)
      setResults(p => ({ ...p, [id]: err ? { ok: false, message: err } : (data as TestResult) }))
    } catch { setResults(p => ({ ...p, [id]: { ok: false, message: 'Connection check failed — server unreachable' } })) }
    finally { setTesting(null) }
  }

  function del(id: string, label: string) {
    if (!confirm(`Delete "${label}"?`)) return
    fetch('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) })
      .then(() => load())
  }

  const envColor = (e: string): 'red'|'amber'|'green' => e === 'production' ? 'red' : e === 'staging' ? 'amber' : 'green'
  const DB_PAGE_SIZE = 10
  const dbFiltered = conns.filter(conn => !dbSearch || conn.label?.toLowerCase().includes(dbSearch.toLowerCase()) || conn.dialect?.toLowerCase().includes(dbSearch.toLowerCase()))
  const dbTotalPages = Math.ceil(dbFiltered.length / DB_PAGE_SIZE) || 1
  const dbPaged = dbFiltered.slice((dbPage - 1) * DB_PAGE_SIZE, dbPage * DB_PAGE_SIZE)

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <PageTitle>Data sources</PageTitle>
        {user.role === 'admin' && <Btn variant="primary" onClick={() => { setShowForm(!showForm); setEditing(null); setForm(EMPTY); setError(''); setParsedOk(false) }}>+ Add database</Btn>}
      </div>
      <PageSub>Direct database connections for live queries. Use the Airbyte tab to connect SaaS systems, ERP and APIs.</PageSub>

      {/* Sandbox test DB */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}> Test sandbox database</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>Creates a built-in SQLite DB pre-loaded with sample machines, OEE, downtime, and quality data. Use it to verify the full chatquery flow without a real DB.</div>
          {sandboxMsg && <div style={{ fontSize: 12, marginTop: 6, color: sandboxMsg.startsWith('ok') ? 'var(--green-t)' : 'var(--red-t)' }}>{sandboxMsg}</div>}
        </div>
        <Btn onClick={createSandbox} disabled={sandboxing}>{sandboxing ? 'Creating...' : 'Add sandbox DB'}</Btn>
      </div>

      {/* Full test-data harness (admin only) */}
      {user.role === 'admin' && (() => {
        const reg = harnessStatus?.registered ?? 0
        const total = harnessStatus?.total ?? 8
        const isReg = reg > 0
        const upCmd = 'docker compose -f docker-compose.yml -f docker-compose.demo.yml --profile demo up -d'
        const downCmd = 'docker compose -f docker-compose.yml -f docker-compose.demo.yml --profile demo down'
        return (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 18px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
                  Test data harness
                  <Badge color={isReg ? 'green' : 'gray'} label={isReg ? `Registered · ${reg}/${total}` : 'Not registered'} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>The full demo estate — Postgres plant ops, MySQL ERP, SQL Server CMMS, InfluxDB telemetry, MongoDB event logs, Elasticsearch, plus SFTP and S3 file drops. Registering adds them as connections; deregistering removes them so their data is no longer used once you have real sources. Health (green/red) for each shows in the list below.</div>
                {harnessMsg && <div style={{ fontSize: 12, marginTop: 6, color: harnessMsg.startsWith('Error') ? 'var(--red-t)' : 'var(--green-t)' }}>{harnessMsg}</div>}
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <Btn onClick={createHarness} disabled={harnessing}>{harnessing ? 'Working…' : (isReg ? 'Re-add missing' : 'Add test harness')}</Btn>
                {isReg && <Btn variant="danger" onClick={removeHarness} disabled={harnessing}>Deregister</Btn>}
              </div>
            </div>

            {/* Guided container on/off — Mosaic intentionally does not control Docker. */}
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Harness containers (run on the host)</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>Registering connections does not start the data stores — run these on the server (adds ~3&nbsp;GB RAM when all nine are up). On hosted boxes include <code style={{ fontFamily: 'var(--font-mono)' }}>-f docker-compose.override.yml</code> before the demo file.</div>
              {[{ k: 'up', verb: 'Start', cmd: upCmd }, { k: 'down', verb: 'Stop', cmd: downCmd }].map(c => (
                <div key={c.k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text2)', width: 40, flexShrink: 0 }}>{c.verb}</span>
                  <code style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '6px 9px', color: 'var(--text2)', overflowX: 'auto', whiteSpace: 'nowrap' }}>{c.cmd}</code>
                  <Btn size="sm" onClick={() => copyHarnessCmd(c.cmd, c.k)}>{harnessCmdCopied === c.k ? 'Copied' : 'Copy'}</Btn>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {error && <Alert variant="error">{error}</Alert>}

      {/* -- .env import -- */}
      {user.role === 'admin' && (
        <>
          <input ref={envFileRef} type="file" accept=".env,.txt" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleEnvFile(f); e.target.value = '' }} />

          {!envPreview ? (
            <div
              onClick={() => envFileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setEnvDragOver(true) }}
              onDragLeave={() => setEnvDragOver(false)}
              onDrop={e => { e.preventDefault(); setEnvDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleEnvFile(f) }}
              style={{ border: `2px dashed ${envDragOver ? 'var(--blue)' : 'var(--border2)'}`, borderRadius: 'var(--radius)', padding: '14px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', background: envDragOver ? 'var(--blue-bg)' : 'var(--bg)', transition: 'all .15s' }}>
              <div style={{ fontSize: 22 }}></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>Import from .env file</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>Drop your .env here or click to browse -- parsed client-side, never uploaded. Extracts DATABASE_URL, MYSQL_URL, MONGODB_URI, and similar keys.</div>
              </div>
            </div>
          ) : (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 16, boxShadow: 'var(--shadow)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>Found {envPreview.length} connection string{envPreview.length !== 1 ? 's' : ''}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>Review and deselect any you don't want to import. Credentials are stored encrypted.</div>
                </div>
                <button onClick={() => setEnvPreview(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 18, lineHeight: 1 }}></button>
              </div>
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', marginBottom: 14 }}>
                {envPreview.map((item, idx) => (
                  <label key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', borderBottom: idx < envPreview.length - 1 ? '1px solid var(--border)' : 'none', cursor: 'pointer', background: item.selected ? 'transparent' : 'var(--bg3)' }}>
                    <input type="checkbox" checked={item.selected}
                      onChange={e => setEnvPreview(p => p ? p.map((x, i) => i === idx ? { ...x, selected: e.target.checked } : x) : p)}
                      style={{ width: 14, height: 14, cursor: 'pointer', flexShrink: 0, marginTop: 2 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{item.key}</span>
                        {item.parsed
                          ? <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 99, background: 'var(--blue-bg)', border: '1px solid rgba(37,99,235,.2)', color: 'var(--blue-t)', fontWeight: 600 }}>{item.parsed.dialect?.toUpperCase()}</span>
                          : <span style={{ fontSize: 10, color: 'var(--red-t)' }}> unrecognised format</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.value.replace(/:\/\/([^:@]+):([^@]+)@/, '://$1:@')}
                      </div>
                      {item.parsed && (
                        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                          {[item.parsed.host, item.parsed.database_name].filter(Boolean).join(' / ')}
                          {item.parsed.ssl_mode && item.parsed.ssl_mode !== 'prefer' && ` . SSL: ${item.parsed.ssl_mode}`}
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
              <Alert variant="info">
                 Passwords are masked above and will be stored encrypted. The .env file was parsed entirely in your browser and was never sent to any server.
              </Alert>
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <Btn variant="primary" onClick={importEnvSelected} disabled={envImporting || !envPreview.some(i => i.selected && i.parsed)}>
                  {envImporting ? 'Importing...' : `Import ${envPreview.filter(i => i.selected && i.parsed).length} connection${envPreview.filter(i => i.selected && i.parsed).length !== 1 ? 's' : ''}`}
                </Btn>
                <Btn onClick={() => setEnvPreview(null)}>Cancel</Btn>
              </div>
            </div>
          )}
        </>
      )}

      {showForm && (
        <div ref={formRef} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 24, marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)', marginBottom: 20 }}>{editing ? 'Edit connection' : 'New database connection'}</div>

          {/* -- Connection string -- primary input -- */}
          <Field label="Connection string" hint="Paste from your DB dashboard -- fields below will fill automatically">
            <div style={{ position: 'relative' }}>
              <input
                style={{ ...INP, fontFamily: 'var(--font-mono)', fontSize: 12, paddingRight: parsedOk ? 32 : undefined }}
                type="password"
                placeholder="postgresql://user:pass@host:5432/db?sslmode=require"
                value={String(form.connection_string)}
                onChange={e => { set('connection_string', e.target.value); applyConnStr(e.target.value) }}
                onPaste={e => { const v = e.clipboardData.getData('text'); setTimeout(() => applyConnStr(v), 0) }}
              />
              {parsedOk && (
                <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--green-t)', fontSize: 14 }}>ok</span>
              )}
            </div>
            {parsedOk && (
              <div style={{ fontSize: 11, color: 'var(--green-t)', marginTop: 4 }}>
                ok Parsed as <strong>{String(form.dialect).toUpperCase()}</strong> -- fields below filled automatically. Review and adjust if needed.
              </div>
            )}
          </Field>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0', color: 'var(--text4)', fontSize: 12 }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span>or fill manually</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          <Grid cols={2}>
            <Field label="Display label" required><input style={INP} placeholder="Production DB" value={String(form.label)} onChange={e => set('label', e.target.value)} /></Field>
            <Field label="Environment">
              <select style={SEL} value={String(form.environment)} onChange={e => set('environment', e.target.value)}>
                <option value="production"> Production</option>
                <option value="staging"> Staging</option>
                <option value="development"> Development</option>
              </select>
            </Field>
          </Grid>

          <Field label="Database type">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[['postgres','PostgreSQL'],['mysql','MySQL'],['mssql','SQL Server'],['sqlite','SQLite'],['mongodb','MongoDB'],['clickhouse','ClickHouse'],['influxdb','InfluxDB'],['elasticsearch','Elasticsearch'],['redshift','Amazon Redshift'],['bigquery','BigQuery'],['snowflake','Snowflake'],['databricks','Databricks']].map(([v,l]) => {
                const defaultPorts: Record<string,string> = {postgres:'5432',mysql:'3306',mssql:'1433',sqlite:'',mongodb:'27017',clickhouse:'8123',influxdb:'8086',elasticsearch:'9200',redshift:'5439',bigquery:'',snowflake:'',databricks:''}
                return (
                  <button key={v} onClick={() => { set('dialect', v); set('port', defaultPorts[v] || ''); if (v === 'bigquery') set('auth_mode', 'service_account'); if (v === 'snowflake') set('auth_mode', 'password') }}
                    style={{ padding: '6px 14px', borderRadius: 'var(--radius-pill)', border: `1.5px solid ${form.dialect === v ? 'var(--blue)' : 'var(--border2)'}`, background: form.dialect === v ? 'var(--blue-bg)' : 'var(--bg)', color: form.dialect === v ? 'var(--blue-t)' : 'var(--text2)', fontSize: 13, fontWeight: form.dialect === v ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s' }}>
                    {l}
                  </button>
                )
              })}
            </div>
          </Field>

          {form.dialect === 'bigquery' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="Authentication">
                <div style={{ display: 'flex', gap: 6 }}>
                  {[['service_account','Service account key'],['none','Emulator (no auth)']].map(([v,l]) => (
                    <button key={v} type="button" onClick={() => set('auth_mode', v)}
                      style={{ padding: '6px 14px', borderRadius: 'var(--radius-pill)', border: `1.5px solid ${form.auth_mode === v ? 'var(--blue)' : 'var(--border2)'}`, background: form.auth_mode === v ? 'var(--blue-bg)' : 'var(--bg)', color: form.auth_mode === v ? 'var(--blue-t)' : 'var(--text2)', fontSize: 13, fontWeight: form.auth_mode === v ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>{l}</button>
                  ))}
                </div>
              </Field>
              <Grid cols={2}>
                <Field label="Project ID" required><input style={INP} placeholder="my-gcp-project" value={String(form.database_name)} onChange={e => set('database_name', e.target.value)} /></Field>
                <Field label="Default dataset" hint="For introspection. Cross-project: project.dataset"><input style={INP} placeholder="analytics  (or other-project.analytics)" value={String(form.schema_name)} onChange={e => set('schema_name', e.target.value)} /></Field>
              </Grid>
              {form.auth_mode === 'none'
                ? <Field label="API endpoint" hint="Emulator URL, e.g. http://bq-emulator:9050"><input style={INP} placeholder="http://localhost:9050" value={String(form.host)} onChange={e => set('host', e.target.value)} /></Field>
                : <Field label="Service account JSON" hint="Stored encrypted"><textarea style={{ ...INP, minHeight: 90, fontFamily: 'var(--font-mono)', fontSize: 11 }} placeholder='{ "type": "service_account", "project_id": "...", "client_email": "...", "private_key": "..." }' value={String(form.password)} onChange={e => set('password', e.target.value)} /></Field>}
            </div>
          ) : form.dialect === 'snowflake' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="Authentication">
                <div style={{ display: 'flex', gap: 6 }}>
                  {[['password','Password'],['keypair','Key pair (JWT)']].map(([v,l]) => (
                    <button key={v} type="button" onClick={() => set('auth_mode', v)}
                      style={{ padding: '6px 14px', borderRadius: 'var(--radius-pill)', border: `1.5px solid ${form.auth_mode === v ? 'var(--blue)' : 'var(--border2)'}`, background: form.auth_mode === v ? 'var(--blue-bg)' : 'var(--bg)', color: form.auth_mode === v ? 'var(--blue-t)' : 'var(--text2)', fontSize: 13, fontWeight: form.auth_mode === v ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>{l}</button>
                  ))}
                </div>
              </Field>
              <Grid cols={2}>
                <Field label="Account" required hint="e.g. xy12345.eu-west-1"><input style={INP} placeholder="xy12345.eu-west-1" value={String(form.host)} onChange={e => set('host', e.target.value)} /></Field>
                <Field label="Username" required><input style={INP} placeholder="svc_user" value={String(form.username)} onChange={e => set('username', e.target.value)} /></Field>
              </Grid>
              {form.auth_mode === 'keypair'
                ? <Field label="Private key (PEM)" hint="Stored encrypted"><textarea style={{ ...INP, minHeight: 80, fontFamily: 'var(--font-mono)', fontSize: 11 }} placeholder="-----BEGIN PRIVATE KEY-----" value={String(form.password)} onChange={e => set('password', e.target.value)} /></Field>
                : <Field label="Password" hint="Stored encrypted"><input style={INP} type="password" value={String(form.password)} onChange={e => set('password', e.target.value)} /></Field>}
              <Grid cols={2}>
                <Field label="Database"><input style={INP} placeholder="ANALYTICS" value={String(form.database_name)} onChange={e => set('database_name', e.target.value)} /></Field>
                <Field label="Schema"><input style={INP} placeholder="PUBLIC" value={String(form.schema_name)} onChange={e => set('schema_name', e.target.value)} /></Field>
              </Grid>
              <Grid cols={2}>
                <Field label="Warehouse" hint="Compute"><input style={INP} placeholder="COMPUTE_WH" value={String(form.warehouse)} onChange={e => set('warehouse', e.target.value)} /></Field>
                <Field label="Role" hint="Optional"><input style={INP} placeholder="ANALYST" value={String(form.role)} onChange={e => set('role', e.target.value)} /></Field>
              </Grid>
            </div>
          ) : form.dialect === 'databricks' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Grid cols={2}>
                <Field label="Workspace host" required hint="e.g. abc.cloud.databricks.com"><input style={INP} placeholder="abc.cloud.databricks.com" value={String(form.host)} onChange={e => set('host', e.target.value)} /></Field>
                <Field label="HTTP path" required hint="SQL warehouse"><input style={INP} placeholder="/sql/1.0/warehouses/abc123" value={String(form.http_path)} onChange={e => set('http_path', e.target.value)} /></Field>
              </Grid>
              <Field label="Access token (PAT)" hint="Stored encrypted"><input style={INP} type="password" placeholder="dapi..." value={String(form.password)} onChange={e => set('password', e.target.value)} /></Field>
              <Grid cols={2}>
                <Field label="Catalog" hint="Unity Catalog (optional)"><input style={INP} placeholder="main" value={String(form.database_name)} onChange={e => set('database_name', e.target.value)} /></Field>
                <Field label="Schema" hint="Optional"><input style={INP} placeholder="default" value={String(form.schema_name)} onChange={e => set('schema_name', e.target.value)} /></Field>
              </Grid>
            </div>
          ) : (
          <Grid cols={3}>
            <Field label="Host" required><input style={INP} placeholder="db.company.com" value={String(form.host)} onChange={e => set('host', e.target.value)} /></Field>
            <Field label="Port"><input style={INP} placeholder="5432" value={String(form.port)} onChange={e => set('port', e.target.value)} /></Field>
            <Field label="Database name"><input style={INP} placeholder="mydb" value={String(form.database_name)} onChange={e => set('database_name', e.target.value)} /></Field>
          </Grid>
          )}

          {form.dialect === 'mssql' && (
            <div style={{ marginBottom: 12 }}>
              <Field label="Authentication" hint="Azure SQL / Synapse / Microsoft Fabric use Entra ID">
                <div style={{ display: 'flex', gap: 6 }}>
                  {[['sql','SQL login'],['entra_sp','Microsoft Entra service principal']].map(([v,l]) => (
                    <button key={v} type="button" onClick={() => set('auth_mode', v)}
                      style={{ padding: '6px 14px', borderRadius: 'var(--radius-pill)', border: `1.5px solid ${form.auth_mode === v ? 'var(--blue)' : 'var(--border2)'}`, background: form.auth_mode === v ? 'var(--blue-bg)' : 'var(--bg)', color: form.auth_mode === v ? 'var(--blue-t)' : 'var(--text2)', fontSize: 13, fontWeight: form.auth_mode === v ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>{l}</button>
                  ))}
                </div>
              </Field>
            </div>
          )}

          {!['bigquery','snowflake','databricks'].includes(form.dialect) && (
          <Grid cols={3}>
            {form.dialect === 'mssql' && form.auth_mode === 'entra_sp' ? (
              <>
                <Field label="Client ID" hint="App (client) ID of the service principal"><input style={INP} placeholder="00000000-0000-0000-0000-000000000000" value={String(form.username)} onChange={e => set('username', e.target.value)} /></Field>
                <Field label="Client secret" hint="Stored encrypted"><input style={INP} type="password" placeholder="" value={String(form.password)} onChange={e => set('password', e.target.value)} /></Field>
                <Field label="Tenant ID" hint="Directory (tenant) ID"><input style={INP} placeholder="00000000-0000-0000-0000-000000000000" value={String(form.tenant_id)} onChange={e => set('tenant_id', e.target.value)} /></Field>
              </>
            ) : (
              <>
                <Field label="Username"><input style={INP} placeholder="app_user" value={String(form.username)} onChange={e => set('username', e.target.value)} /></Field>
                <Field label="Password" hint="Stored encrypted"><input style={INP} type="password" placeholder="" value={String(form.password)} onChange={e => set('password', e.target.value)} /></Field>
                <Field label="Schema" hint="Default: public"><input style={INP} placeholder="public" value={String(form.schema_name)} onChange={e => set('schema_name', e.target.value)} /></Field>
              </>
            )}
          </Grid>
          )}

          <Field label="Description" hint="Optional — tell Mosaic what this connection contains and how it relates to other sources. Improves query routing and cross-source analysis.">
            <textarea
              style={{ ...INP, resize: 'vertical', minHeight: 64, fontSize: 12, fontFamily: 'inherit' }}
              placeholder="e.g. Primary CMMS — work orders, asset registry, PM schedules. Asset IDs match sensor_telemetry.asset_id in InfluxDB."
              value={String(form.description || '')}
              onChange={e => set('description', e.target.value)}
            />
          </Field>

          {form.dialect === 'elasticsearch' && (
            <Field label="API Key" hint="Optional — leave blank for Basic auth above. Stored encrypted.">
              <input style={INP} type="password" placeholder="base64-encoded Elasticsearch API key"
                value={String((form as Record<string,unknown>).es_api_key || '')}
                onChange={e => set('es_api_key' as never, e.target.value as never)} />
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                If set, API Key auth is used instead of username/password. Leave username blank.
              </div>
            </Field>
          )}

          <Grid cols={2}>
            <Field label="SSL mode">
              <select style={SEL} value={String(form.ssl_mode)} onChange={e => set('ssl_mode', e.target.value)}>
                {['disable','allow','prefer','require','verify-ca','verify-full'].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Connection pool (min / max)">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input style={INP} type="number" placeholder="1" value={String(form.pool_min)} onChange={e => set('pool_min', e.target.value)} />
                <input style={INP} type="number" placeholder="5" value={String(form.pool_max)} onChange={e => set('pool_max', e.target.value)} />
              </div>
            </Field>
          </Grid>

          {(form.ssl_mode === 'verify-ca' || form.ssl_mode === 'verify-full') && (
            <Field label="CA Certificate (PEM)" hint="Paste the contents of your CA cert. Required for cloud DBs like AWS RDS.">
              <textarea style={{ ...INP, resize: 'vertical', minHeight: 80, fontSize: 12, fontFamily: 'var(--font-mono)' }} placeholder="-----BEGIN CERTIFICATE-----" value={String(form.ssl_ca)} onChange={e => set('ssl_ca', e.target.value)} />
            </Field>
          )}

          {/* MCP connector -- only for SQL dialects that have MCP server support */}
          {(form.dialect === 'postgres' || form.dialect === 'mysql' || form.dialect === 'mssql') && (
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 7 }}>
                <span> MCP connector</span>
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 99, background: 'var(--blue-bg)', border: '1px solid rgba(37,99,235,.2)', color: 'var(--blue-t)', fontWeight: 600 }}>optional</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
                If you have an MCP server for this database, Mosaic will use it for schema-aware queries -- it can browse tables and columns before writing SQL. Leave blank to use direct SQL (default).
                <br />Compatible with: <strong>Neon remote MCP</strong> (mcp.neon.tech), <strong>postgres-mcp</strong>, <strong>pg-mcp-server</strong>, <strong>Google MCP Toolbox</strong> (--prebuilt=postgres/mysql/mssql).
              </div>
              <Grid cols={2}>
                <Field label="MCP endpoint URL" hint="e.g. https://mcp.neon.tech/mcp or http://localhost:3100/mcp">
                  <input style={{ ...INP, fontFamily: 'var(--font-mono)', fontSize: 12 }}
                    placeholder="https://mcp.neon.tech/mcp"
                    value={String(form.mcp_endpoint || '')}
                    onChange={e => set('mcp_endpoint', e.target.value)} />
                </Field>
                <Field label="MCP auth token" hint="Bearer token if your MCP server requires auth. Leave blank for unauthenticated.">
                  <input style={{ ...INP, fontFamily: 'var(--font-mono)', fontSize: 12 }} type="password"
                    placeholder="Optional -- leave blank for Neon OAuth"
                    value={String(form.mcp_token || '')}
                    onChange={e => set('mcp_token', e.target.value)} />
                </Field>
              </Grid>
            </div>
          )}

          {/* -- MCP connector -- only shown for SQL dialects -- */}
          {(form.dialect === 'postgres' || form.dialect === 'mysql' || form.dialect === 'mssql') && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>
                MCP connector <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text3)' }}>(optional)</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
                Point Mosaic at an MCP server for schema-aware queries -- Mosaic can browse tables and columns before writing SQL.
                Compatible with{' '}
                <a href="https://mcp.neon.tech/mcp" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue-t)' }}>Neon remote MCP</a>,{' '}
                <a href="https://github.com/crystaldba/postgres-mcp" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue-t)' }}>postgres-mcp</a>,{' '}
                and <a href="https://github.com/googleapis/mcp-toolbox" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue-t)' }}>Google MCP Toolbox</a>.
              </div>
              <Grid cols={2}>
                <Field label="MCP endpoint URL" hint="e.g. https://mcp.neon.tech/mcp">
                  <input style={{ ...INP, fontFamily: 'var(--font-mono)', fontSize: 12 }}
                    placeholder="https://mcp.neon.tech/mcp"
                    value={String(form.mcp_endpoint || '')}
                    onChange={e => set('mcp_endpoint', e.target.value)} />
                </Field>
                <Field label="MCP auth token" hint="Bearer token if the server requires auth">
                  <input style={{ ...INP, fontFamily: 'var(--font-mono)', fontSize: 12 }}
                    type="password"
                    placeholder="optional -- leave blank for unauthenticated servers"
                    value={String(form.mcp_token || '')}
                    onChange={e => set('mcp_token', e.target.value)} />
                </Field>
              </Grid>
              {form.mcp_endpoint && (
                <div style={{ fontSize: 11, color: 'var(--green-t)', marginTop: 4 }}>
                  ok MCP active -- Mosaic will route queries through this server and can browse schema before querying.
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16, borderTop: '1px solid var(--border)', marginTop: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', color: 'var(--text2)' }}>
              <input type="checkbox" checked={Boolean(form.read_only)} onChange={e => set('read_only', e.target.checked)} style={{ width: 15, height: 15, cursor: 'pointer' }} />
              Read-only mode (block INSERT / UPDATE / DELETE)
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save connection'}</Btn>
              <Btn onClick={() => { setShowForm(false); setEditing(null); setError(''); setParsedOk(false) }}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={24} /></div>
      ) : conns.length === 0 ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '48px 24px', textAlign: 'center', fontSize: 14, color: 'var(--text3)' }}>
          No database connections yet. Add one above to start querying from chat.
        </div>
      ) : (
        <>
          <input style={{ width: '100%', padding: '8px 12px', marginBottom: 10, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
            placeholder="Search databases..." value={dbSearch} onChange={e => { setDbSearch(e.target.value); setDbPage(1) }} />
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
            {dbPaged.map((c, i) => {
            const tr = results[c.id]
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: i < conns.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <StatusDot status={tr ? (tr.ok ? 'healthy' : 'down') : 'unknown'} />
                <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 'var(--radius-sm)', background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text3)' }}>{c.dialect.toUpperCase()}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>{c.label} <Badge label={c.environment} color={envColor(c.environment)} /></div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{c.host}:{c.port}/{c.database_name} . SSL: {c.ssl_mode} . pool {c.pool_min}-{c.pool_max}{c.read_only ? ' . read-only' : ''}{c.mcp_endpoint ? ' .  MCP' : ''}</div>
                  {tr && <div style={{ fontSize: 11, color: tr.ok ? 'var(--green-t)' : 'var(--red-t)', marginTop: 3 }}>{tr.ok ? `ok Connected . ${tr.latencyMs}ms${tr.detail ? ' . ' + tr.detail : ''}` : `x ${tr.message}`}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {user.role === 'admin' && c.dialect !== 'elasticsearch' && !c.managed && (
                    <button
                      onClick={() => toggleFts(c.id, !!c.full_text_search)}
                      disabled={!!ftsLoading[c.id]}
                      title={c.full_text_search ? 'Full-text search enabled — click to disable' : 'Enable full-text search'}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '3px 8px', borderRadius: 'var(--radius-pill)',
                        border: `1.5px solid ${c.full_text_search ? 'var(--green)' : 'var(--border2)'}`,
                        background: c.full_text_search ? 'var(--green-bg)' : 'var(--bg)',
                        color: c.full_text_search ? 'var(--green-t)' : 'var(--text3)',
                        fontSize: 11, fontWeight: 600, cursor: ftsLoading[c.id] ? 'wait' : 'pointer',
                        transition: 'all .15s', whiteSpace: 'nowrap', fontFamily: 'inherit',
                      }}>
                      {ftsLoading[c.id] ? <Spinner size={10} /> : <>{c.full_text_search ? '⚡ FTS on' : '⚡ FTS'}</>}
                    </button>
                  )}
                  <Btn size="sm" onClick={() => test(c.id)} disabled={testing === c.id}>{testing === c.id ? <Spinner size={11} /> : 'Test'}</Btn>
                  {user.role === 'admin' && c.dialect !== 'elasticsearch' && coverage[c.id] && (() => {
                    const cov = coverage[c.id]
                    const pill = (bg: string, bd: string, fg: string): React.CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 'var(--radius-pill)', border: `1.5px solid ${bd}`, background: bg, color: fg, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', fontFamily: 'inherit' })
                    const amber = pill('color-mix(in srgb, var(--warning,var(--amber-t)) 12%, transparent)', 'var(--warning,var(--amber-t))', 'var(--warning,var(--amber-t))')
                    const green = pill('var(--green-bg)', 'var(--green)', 'var(--green-t)')
                    const neutral = pill('transparent', 'var(--border2)', 'var(--text3)')
                    // Humanize the probe reason for the tooltip — no internal engine jargon.
                    const hr = (r?: string | null): string => {
                      if (!r) return 'unknown reason'
                      if (r.startsWith('dialect-unsupported')) return `unsupported database type: ${r.split(':')[1] || '—'}`
                      if (r.includes('http-')) return `serving engine error (${r.replace(/.*http-/, 'HTTP ')})`
                      const map: Record<string, string> = {
                        'model-unverified': 'model is not verified',
                        'schema-drift': 'schema changed since the last scan — re-scan this source',
                        'non-native-measure': 'a selected measure uses an aggregation that can’t be accelerated',
                        'needs-delta-pipeline': 'a measure needs delta handling',
                        'no-verified-native-measure': 'no verified numeric measure to serve',
                        'no-measures': 'no measure is defined',
                        'cross-table': 'the model spans multiple tables',
                        'not-deployed': 'the serving engine is not enabled on this deployment',
                        'building': 'still building — try again shortly',
                        'no-response': 'the serving engine did not respond',
                      }
                      const k = r.replace(/^cube-?/, '').replace(/^error:.*/, 'no-response')
                      return map[k] || k.replace(/[-_]/g, ' ')
                    }
                    // 1) Semantics unverified — fill in + verify the model first.
                    if (cov.needs_config)
                      return <button onClick={() => setDescribing(c)} title="Semantics not verified yet — dashboards won't get units, roll-ups or acceleration" style={{ ...amber, cursor: 'pointer' }}>⚠ Semantics unverified</button>
                    if (rechecking[c.id])
                      return <span style={neutral}><Spinner size={10} /> Checking…</span>
                    // 3) Servable — verified and proven to serve.
                    if (cov.cube_serving === 'serving')
                      return <span title={`${cov.verified} verified field(s) · servable to external BI tools`} style={green}>✓ Servable</span>
                    // 2) Verified but unservable — surface the humanized reason; re-check on click.
                    if (cov.cube_serving === 'unreachable')
                      return <button onClick={() => recheckCube(c.id)} title={`Verified, but not servable yet: ${hr(cov.cube_reason)}. Dashboards still return correct values. Click to re-check.`} style={{ ...amber, cursor: 'pointer' }}>⚠ Verified · unservable</button>
                    // Verified but not yet checked.
                    return <button onClick={() => recheckCube(c.id)} title="Verified. Click to check whether this source is servable." style={{ ...neutral, cursor: 'pointer' }}>✓ Verified · check</button>
                  })()}
                  {user.role === 'admin' && <Btn size="sm" variant="ghost" onClick={() => setDescribing(c)} title="Describe tables & columns so Mosaic's AI understands this source">Describe</Btn>}
                  {user.role === 'admin' && !c.managed && <Btn size="sm" onClick={() => { setForm({ ...EMPTY, ...c, port: String(c.port), pool_min: String(c.pool_min), pool_max: String(c.pool_max), mcp_endpoint: c.mcp_endpoint || '', mcp_token: c.mcp_token || '', description: c.description || '', full_text_search: !!c.full_text_search, managed: !!c.managed, fts_airbyte_conn_id: c.fts_airbyte_conn_id || '' }); setEditing(c.id); setShowForm(true); setParsedOk(false) }}>Edit</Btn>}
                  {user.role === 'admin' && !c.managed && <Btn size="sm" variant="danger" onClick={() => del(c.id, c.label)}>Delete</Btn>}
                </div>
              </div>
            )
            })}
          </div>
          {describing && (
            <SemanticDescriptionsModal
              sourceId={describing.id}
              sourceLabel={describing.label}
              onClose={() => { setDescribing(null); loadCoverage() }}
            />
          )}
          {(
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 0 4px' }}>
              <button onClick={() => setDbPage(p => Math.max(1, p - 1))} disabled={dbPage === 1} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: dbPage === 1 ? 'not-allowed' : 'pointer', color: 'var(--text3)', fontSize: 12 }}>←</button>
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>Page {dbPage} of {dbTotalPages}</span>
              <button onClick={() => setDbPage(p => Math.min(dbTotalPages, p + 1))} disabled={dbPage === dbTotalPages} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: dbPage === dbTotalPages ? 'not-allowed' : 'pointer', color: 'var(--text3)', fontSize: 12 }}>→</button>
            </div>
          )}
        </>
      )}

    </div>
  )
}


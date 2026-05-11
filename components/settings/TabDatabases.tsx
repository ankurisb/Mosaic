'use client'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, INP, SEL, Btn, Badge, StatusDot, Field, Grid, Alert, Spinner } from './ui'

interface DbConn { id: string; label: string; dialect: string; environment: string; host: string; port: number; database_name: string; username: string; schema_name: string; ssl_mode: string; pool_min: number; pool_max: number; read_only: boolean; mcp_endpoint?: string; mcp_token?: string }
interface TestResult { ok: boolean; message?: string; latencyMs?: number; detail?: string }
const EMPTY = { label: '', dialect: 'postgres', environment: 'development', host: '', port: '5432', database_name: '', username: '', password: '', connection_string: '', schema_name: 'public', ssl_mode: 'prefer', ssl_ca: '', pool_min: '1', pool_max: '5', connect_timeout_ms: '5000', query_timeout_ms: '30000', read_only: false, mcp_endpoint: '', mcp_token: '' }

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
    const dialectMap: Record<string, string> = { postgres: 'postgres', postgresql: 'postgres', mysql: 'mysql', mysql2: 'mysql', mssql: 'mssql', sqlserver: 'mssql', mongodb: 'mongodb', 'mongodb+srv': 'mongodb', clickhouse: 'clickhouse', clickhouses: 'clickhouse' }
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
    const defaultPorts: Record<string, string> = { postgres: '5432', mysql: '3306', mssql: '1433', mongodb: '27017', clickhouse: '8123', influxdb: '8086' }
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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [parsedOk, setParsedOk] = useState(false)
  // .env import state
  const envFileRef = useRef<HTMLInputElement>(null)
  const [envPreview, setEnvPreview] = useState<Array<{ key: string; value: string; selected: boolean; parsed: Partial<typeof EMPTY> | null }> | null>(null)
  const [envImporting, setEnvImporting] = useState(false)
  const [envDragOver, setEnvDragOver] = useState(false)

  const [sandboxing, setSandboxing] = useState(false)
  const [dbSearch, setDbSearch] = useState('')
  const [dbPage, setDbPage] = useState(1)
  const [sandboxMsg, setSandboxMsg] = useState('')
  const [showAirbyteForm, setShowAirbyteForm] = useState(false)

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
  }

  async function createSandbox() {
    setSandboxing(true); setSandboxMsg('')
    const r = await fetch('/api/test-db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create_sandbox' }) })
    const d = await r.json()
    if (r.ok) {
      setSandboxMsg(d.already_existed ? 'Sandbox already exists — see connection list below.' : 'ok Sandbox DB created! Ask Mosaic: "Show me OEE for each machine"')
      await load()
    } else {
      setSandboxMsg('Error: ' + (d.error || 'Unknown error'))
    }
    setSandboxing(false)
  }
  useEffect(() => { load() }, [])

  const set = (k: string, v: string | boolean) => setForm(p => ({ ...p, [k]: v }))

  async function save() {
    if (!form.label) { setError('Label is required'); return }
    setSaving(true)
    const r = await fetch('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: editing ? 'update' : 'create', id: editing, ...form }) })
    const d = await r.json()
    if (!r.ok) { setError(d.error); setSaving(false); return }
    setSaving(false); setShowForm(false); setEditing(null); setForm(EMPTY); setError(''); load()
  }

  async function test(id: string) {
    setTesting(id)
    const r = await fetch('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test', id }) })
    const data = await r.json()
    setResults(p => ({ ...p, [id]: data })); setTesting(null)
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
      <PageSub>Direct database connections for live queries. Use Airbyte below to connect SaaS systems, ERP, and APIs.</PageSub>

      <Alert variant="info"> Once connected, ask Mosaic: <em>"Query the [connection label] database for all customers ordered by revenue"</em></Alert>

      {/* Sandbox test DB */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}> Test sandbox database</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>Creates a built-in SQLite DB pre-loaded with sample machines, OEE, downtime, and quality data. Use it to verify the full chatquery flow without a real DB.</div>
          {sandboxMsg && <div style={{ fontSize: 12, marginTop: 6, color: sandboxMsg.startsWith('ok') ? 'var(--green-t)' : 'var(--red-t)' }}>{sandboxMsg}</div>}
        </div>
        <Btn onClick={createSandbox} disabled={sandboxing}>{sandboxing ? 'Creating...' : 'Add sandbox DB'}</Btn>
      </div>

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
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 24, marginBottom: 20 }}>
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
              {[['postgres','PostgreSQL'],['mysql','MySQL'],['mssql','SQL Server'],['sqlite','SQLite'],['mongodb','MongoDB'],['clickhouse','ClickHouse'],['influxdb','InfluxDB']].map(([v,l]) => {
                const defaultPorts: Record<string,string> = {postgres:'5432',mysql:'3306',mssql:'1433',sqlite:'',mongodb:'27017',clickhouse:'8123',influxdb:'8086'}
                return (
                  <button key={v} onClick={() => { set('dialect', v); set('port', defaultPorts[v] || '') }}
                    style={{ padding: '6px 14px', borderRadius: 'var(--radius-pill)', border: `1.5px solid ${form.dialect === v ? 'var(--blue)' : 'var(--border2)'}`, background: form.dialect === v ? 'var(--blue-bg)' : 'var(--bg)', color: form.dialect === v ? 'var(--blue-t)' : 'var(--text2)', fontSize: 13, fontWeight: form.dialect === v ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s' }}>
                    {l}
                  </button>
                )
              })}
            </div>
          </Field>

          <Grid cols={3}>
            <Field label="Host" required><input style={INP} placeholder="db.company.com" value={String(form.host)} onChange={e => set('host', e.target.value)} /></Field>
            <Field label="Port"><input style={INP} placeholder="5432" value={String(form.port)} onChange={e => set('port', e.target.value)} /></Field>
            <Field label="Database name"><input style={INP} placeholder="mydb" value={String(form.database_name)} onChange={e => set('database_name', e.target.value)} /></Field>
          </Grid>

          <Grid cols={3}>
            <Field label="Username"><input style={INP} placeholder="app_user" value={String(form.username)} onChange={e => set('username', e.target.value)} /></Field>
            <Field label="Password" hint="Stored encrypted"><input style={INP} type="password" placeholder="" value={String(form.password)} onChange={e => set('password', e.target.value)} /></Field>
            <Field label="Schema" hint="Default: public"><input style={INP} placeholder="public" value={String(form.schema_name)} onChange={e => set('schema_name', e.target.value)} /></Field>
          </Grid>

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
                <div style={{ display: 'flex', gap: 6 }}>
                  <Btn size="sm" onClick={() => test(c.id)} disabled={testing === c.id}>{testing === c.id ? <Spinner size={11} /> : 'Test'}</Btn>
                  {user.role === 'admin' && <Btn size="sm" onClick={() => { setForm({ ...EMPTY, ...c, port: String(c.port), pool_min: String(c.pool_min), pool_max: String(c.pool_max), mcp_endpoint: c.mcp_endpoint || '', mcp_token: c.mcp_token || '' }); setEditing(c.id); setShowForm(true); setParsedOk(false) }}>Edit</Btn>}
                  {user.role === 'admin' && <Btn size="sm" variant="danger" onClick={() => del(c.id, c.label)}>Delete</Btn>}
                </div>
              </div>
            )
            })}
          </div>
          {(
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 0 4px' }}>
              <button onClick={() => setDbPage(p => Math.max(1, p - 1))} disabled={dbPage === 1} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: dbPage === 1 ? 'not-allowed' : 'pointer', color: 'var(--text3)', fontSize: 12 }}>←</button>
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>Page {dbPage} of {dbTotalPages}</span>
              <button onClick={() => setDbPage(p => Math.min(dbTotalPages, p + 1))} disabled={dbPage === dbTotalPages} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: dbPage === dbTotalPages ? 'not-allowed' : 'pointer', color: 'var(--text3)', fontSize: 12 }}>→</button>
            </div>
          )}
        </>
      )}

      {/* ── Airbyte section ───────────────────────────────── */}
      <div style={{ marginTop: 40, marginBottom: 8, paddingTop: 32, borderTop: '2px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="18" height="18" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" style={{ color: '#615cf5' }}><polygon points="11,2 14,8 20,9 16,14 17,20 11,17 5,20 6,14 2,9 8,8"/></svg>
              Airbyte — non-SQL sources
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5, maxWidth: 560 }}>
              For SAP, Salesforce, ERP, SaaS APIs and other systems with no direct SQL interface.
              Airbyte syncs these into your destination DB, then Mosaic queries via the connection above.
              You don't need the Airbyte browser open — just Docker running.
            </div>
          </div>
          {user.role === 'admin' && (
            <button onClick={() => setShowAirbyteForm(true)}
              style={{ padding: '7px 14px', borderRadius: 999, border: '1px solid var(--border2)', background: 'var(--bg)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, fontFamily: 'inherit' }}>
              + Connect Airbyte
            </button>
          )}
        </div>
      </div>
      <AirbyteSection user={user} showForm={showAirbyteForm} setShowForm={setShowAirbyteForm} />

    </div>
  )
}

// ── AirbyteSection ───────────────────────────────────────────
interface AbInstance { id: string; label: string; url: string; username: string; workspace_id: string | null; last_synced: string | null; client_id?: string | null }
interface AbSource   { sourceId?: string; id?: string; name: string; sourceName?: string; sourceType?: string; status?: string }
interface AbDest     { destinationId?: string; id?: string; name: string; destinationType?: string; destinationName?: string }
interface AbConn     { connectionId?: string; id?: string; name: string; status: string; schedule?: Record<string,unknown>; syncCatalog?: { streams?: unknown[] } }
interface AbJob      { id?: number; jobId?: number; status: string; createdAt?: number; updatedAt?: number; job?: { id: number; status: string; createdAt: number; updatedAt: number } }

const AB_EMPTY = { label: 'Local Airbyte', url: 'http://localhost:8000', username: 'airbyte', password: '', client_id: '', client_secret: '' }

function AbIcon({ name, size = 26 }: { name: string; size?: number }) {
  const slug = abSlug(name)
  const [err, setErr] = React.useState(false)
  const abbr = (name || '??').replace(/[^a-zA-Z0-9 ]/g,'').split(' ').map((w:string) => w[0]||'').join('').slice(0,2).toUpperCase()
  if (!slug || err) return (
    <div style={{ width: size, height: size, borderRadius: 6, background: 'var(--bg4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: 'var(--text3)', flexShrink: 0 }}>{abbr}</div>
  )
  return <img src={`https://connectors.airbyte.com/files/metadata/airbyte/${slug}/latest/icon.svg`} onError={() => setErr(true)} style={{ width: size, height: size, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} />
}

function abSlug(name: string) {
  const n = (name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const m: Record<string,string> = {
    postgres: 'source-postgres', postgresql: 'source-postgres', mysql: 'source-mysql',
    mssql: 'source-mssql', sqlserver: 'source-mssql', mongodb: 'source-mongodb-v2',
    elasticsearch: 'source-elasticsearch', clickhouse: 'source-clickhouse',
    snowflake: 'source-snowflake', bigquery: 'source-bigquery', redshift: 'source-redshift',
    s3: 'source-s3', influxdb: 'source-influxdb', kafka: 'source-kafka',
    salesforce: 'source-salesforce', hubspot: 'source-hubspot', github: 'source-github',
    gitlab: 'source-gitlab', slack: 'source-slack', stripe: 'source-stripe',
    shopify: 'source-shopify', notion: 'source-notion', jira: 'source-jira',
    googlesheetsv4: 'source-google-sheets', googlesheets: 'source-google-sheets',
    googleanalytics: 'source-google-analytics-v4', airtable: 'source-airtable',
    zendesk: 'source-zendesk-support', intercom: 'source-intercom',
    mixpanel: 'source-mixpanel', amplitude: 'source-amplitude', stripe2: 'source-stripe',
    sap: 'source-sap-fieldglass', asana: 'source-asana', pipedrive: 'source-pipedrive',
  }
  for (const k of Object.keys(m)) { if (n.includes(k)) return m[k] }
  return null
}

function AbStatusBadge({ status }: { status: string }) {
  const s = (status || '').toLowerCase()
  const map: Record<string,[string,string]> = {
    active: ['#f0fdf4','#15803d'], inactive: ['#fef2f2','#dc2626'],
    succeeded: ['#f0fdf4','#15803d'], failed: ['#fef2f2','#dc2626'],
    running: ['#eff6ff','#2563eb'], pending: ['#fffbeb','#d97706'],
  }
  const [bg,fg] = map[s] || ['var(--bg4)','var(--text3)']
  return <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600, background: bg, color: fg }}>{status || '—'}</span>
}

function AirbyteSection({ user, showForm, setShowForm }: { user: SessionUser; showForm: boolean; setShowForm: (v: boolean) => void }) {
  const isAdmin = user.role === 'admin'
  const [instances, setInstances] = React.useState<AbInstance[]>([])
  const [loading, setLoading]     = React.useState(true)
  const [form, setForm]           = React.useState(AB_EMPTY)
  const authMode = form.client_id ? 'oauth' : 'basic'
  const [editing, setEditing]     = React.useState<string | null>(null)
  const [saving, setSaving]       = React.useState(false)
  const [expanded, setExpanded]   = React.useState<string | null>(null)
  const [subTab, setSubTab]       = React.useState<Record<string,'sources'|'connections'|'jobs'|'destinations'>>({})
  const [sources, setSources]     = React.useState<Record<string, AbSource[] | null>>({})
  const [dests, setDests]         = React.useState<Record<string, AbDest[] | null>>({})
  const [conns2, setConns2]       = React.useState<Record<string, AbConn[] | null>>({})
  const [jobs2, setJobs2]         = React.useState<Record<string, AbJob[] | null>>({})
  const [pingMap, setPingMap]     = React.useState<Record<string,{ok:boolean;msg:string}|'loading'>>({})
  const [syncing, setSyncing]     = React.useState<string | null>(null)
  const [cancelling, setCancelling] = React.useState<string | null>(null)
  const [toast, setToast]         = React.useState<{msg:string;ok:boolean}|null>(null)

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const loadInstances = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/airbyte?action=list')
      const d = await r.json()
      setInstances(d.instances || [])
    } catch { showToast('Failed to load Airbyte instances', false) }
    finally { setLoading(false) }
  }, [])

  React.useEffect(() => { loadInstances() }, [loadInstances])

  async function ping(id: string) {
    setPingMap(p => ({ ...p, [id]: 'loading' }))
    const r = await fetch(`/api/airbyte?action=ping&id=${id}`)
    const d = await r.json()
    setPingMap(p => ({ ...p, [id]: { ok: d.ok, msg: d.ok ? `Connected · ${d.workspaceCount ?? '?'} workspace(s)` : d.error } }))
  }

  async function discoverWs(id: string) {
    setPingMap(p => ({ ...p, [id]: 'loading' }))
    try {
      const r = await fetch('/api/airbyte', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: 'discover_workspace', id }) })
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      showToast(`Workspace found: ${d.workspaceId?.slice(0,8)}`)
      loadInstances()
      setSources(p => ({ ...p, [id]: null }))
      fetchTab(id, 'sources')
    } catch (e) { showToast((e as Error).message, false) }
    finally { setPingMap(p => { const n = {...p}; delete n[id]; return n }) }
  }

  function toggleExpand(id: string) {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    const tab = subTab[id] || 'sources'
    if (!subTab[id]) setSubTab(p => ({ ...p, [id]: 'sources' }))
    fetchTab(id, tab)
  }

  function switchTab(id: string, tab: 'sources'|'connections'|'jobs'|'destinations') {
    setSubTab(p => ({ ...p, [id]: tab }))
    fetchTab(id, tab)
  }

  async function fetchTab(id: string, tab: string) {
    if (tab === 'sources' && !sources[id]) {
      setSources(p => ({ ...p, [id]: null }))
      const r = await fetch(`/api/airbyte?action=sources&id=${id}`)
      const d = await r.json()
      setSources(p => ({ ...p, [id]: d.sources || [] }))
    } else if (tab === 'destinations' && !dests[id]) {
      setDests(p => ({ ...p, [id]: null }))
      const r = await fetch(`/api/airbyte?action=destinations&id=${id}`)
      const d = await r.json()
      setDests(p => ({ ...p, [id]: d.destinations || [] }))
    } else if (tab === 'connections' && !conns2[id]) {
      setConns2(p => ({ ...p, [id]: null }))
      const r = await fetch(`/api/airbyte?action=connections&id=${id}`)
      const d = await r.json()
      setConns2(p => ({ ...p, [id]: d.connections || [] }))
    } else if (tab === 'jobs' && !jobs2[id]) {
      setJobs2(p => ({ ...p, [id]: null }))
      const r = await fetch(`/api/airbyte?action=jobs&id=${id}`)
      const d = await r.json()
      setJobs2(p => ({ ...p, [id]: d.jobs || [] }))
    }
  }

  async function refreshTab(id: string) {
    const tab = subTab[id] || 'sources'
    if (tab === 'sources') setSources(p => ({ ...p, [id]: null }))
    else if (tab === 'destinations') setDests(p => ({ ...p, [id]: null }))
    else if (tab === 'connections') setConns2(p => ({ ...p, [id]: null }))
    else setJobs2(p => ({ ...p, [id]: null }))
    setTimeout(() => fetchTab(id, tab), 50)
  }

  async function triggerSync(instanceId: string, connectionId: string) {
    setSyncing(connectionId)
    try {
      const r = await fetch('/api/airbyte', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: 'trigger_sync', instanceId, connectionId }) })
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      showToast(`Sync triggered${d.jobId ? ' · job #' + d.jobId : ''}`)
      setJobs2(p => ({ ...p, [instanceId]: null }))
    } catch (e) { showToast((e as Error).message, false) }
    finally { setSyncing(null) }
  }

  async function cancelJob(instanceId: string, jobId: number | string) {
    setCancelling(String(jobId))
    try {
      const r = await fetch('/api/airbyte', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: 'cancel_job', instanceId, jobId }) })
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      showToast('Job cancelled')
      setJobs2(p => ({ ...p, [instanceId]: null }))
      fetchTab(instanceId, 'jobs')
    } catch (e) { showToast((e as Error).message, false) }
    finally { setCancelling(null) }
  }

  async function deleteSource(instanceId: string, sourceId: string) {
    if (!confirm('Delete this source from Airbyte?')) return
    try {
      const r = await fetch('/api/airbyte', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: 'delete_source', instanceId, sourceId }) })
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      showToast('Source deleted')
      setSources(p => ({ ...p, [instanceId]: null }))
      fetchTab(instanceId, 'sources')
    } catch (e) { showToast((e as Error).message, false) }
  }

  async function saveInstance() {
    if (!form.url.trim()) { showToast('URL required', false); return }
    setSaving(true)
    try {
      const r = await fetch('/api/airbyte', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: editing ? 'update_instance' : 'create_instance', id: editing, ...form }) })
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      showToast(editing ? 'Instance updated' : 'Airbyte connected')
      setShowForm(false); setEditing(null); setForm(AB_EMPTY)
      loadInstances()
    } catch (e) { showToast((e as Error).message, false) }
    finally { setSaving(false) }
  }

  async function deleteInstance(id: string) {
    if (!confirm('Remove this Airbyte instance?')) return
    await fetch('/api/airbyte', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: 'delete_instance', id }) })
    if (expanded === id) setExpanded(null)
    loadInstances()
    showToast('Instance removed')
  }

  function openEdit(inst: AbInstance) {
    setForm({ label: inst.label, url: inst.url, username: inst.username, password: '', client_id: inst.client_id || '', client_secret: '' })
    setEditing(inst.id); setShowForm(true)
  }

  function normaliseJob(j: AbJob) {
    return j.job || j
  }

  const S: React.CSSProperties = { fontSize: 11, padding: '0 0' }

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 2000, padding: '10px 16px', borderRadius: 10, fontSize: 13, fontWeight: 500, background: toast.ok ? '#f0fdf4' : '#fef2f2', color: toast.ok ? '#15803d' : '#dc2626', border: `1px solid ${toast.ok ? '#bbf7d0' : '#fecaca'}`, boxShadow: '0 4px 16px rgba(0,0,0,.12)' }}>
          {toast.msg}
        </div>
      )}

      {loading && <div style={{ padding: '20px 0', color: 'var(--text3)', fontSize: 13 }}>Loading…</div>}

      {!loading && instances.length === 0 && (
        <div style={{ padding: '28px 20px', background: 'var(--bg3)', borderRadius: 10, textAlign: 'center', fontSize: 13, color: 'var(--text3)', marginTop: 12 }}>
          No Airbyte instance connected. Start Airbyte with <code style={{ background: 'var(--bg4)', padding: '1px 5px', borderRadius: 4, fontFamily: 'var(--font-mono)' }}>docker compose up -d</code> then click "+ Connect Airbyte" above.
        </div>
      )}

      {instances.map(inst => {
        const curTab = subTab[inst.id] || 'sources'
        const isExp  = expanded === inst.id
        const ps     = pingMap[inst.id]

        return (
          <div key={inst.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 12, overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
            <div style={{ padding: '13px 18px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ width: 34, height: 34, borderRadius: 8, background: 'linear-gradient(135deg,#615cf5,#a78bfa)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 22 22" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round"><polygon points="11,2 14,8 20,9 16,14 17,20 11,17 5,20 6,14 2,9 8,8"/></svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{inst.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {inst.url} · {inst.username}{inst.workspace_id ? ` · ws:${inst.workspace_id.slice(0,8)}` : ''}
                </div>
              </div>
              {ps && ps !== 'loading' && (
                <span style={{ fontSize: 11, color: ps.ok ? '#15803d' : '#dc2626', fontWeight: 500 }}>{ps.msg}</span>
              )}
              {ps === 'loading' && <Spinner size={12} />}
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', flexShrink: 0 }}>
                <Btn size="sm" onClick={() => ping(inst.id)} disabled={ps === 'loading'}>Test</Btn>
                {!inst.workspace_id && <Btn size="sm" onClick={() => discoverWs(inst.id)}>Discover WS</Btn>}
                <Btn size="sm" onClick={() => toggleExpand(inst.id)}>{isExp ? '↑ Collapse' : '↓ Explore'}</Btn>
                {isAdmin && <Btn size="sm" onClick={() => openEdit(inst)}>Edit</Btn>}
                {isAdmin && <Btn size="sm" variant="danger" onClick={() => deleteInstance(inst.id)}>Delete</Btn>}
              </div>
            </div>

            {isExp && (
              <div style={{ borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: 4, padding: '8px 18px', background: 'var(--bg3)', alignItems: 'center', overflowX: 'auto' }}>
                  {(['sources','destinations','connections','jobs'] as const).map(t => (
                    <button key={t} onClick={() => switchTab(inst.id, t)} style={{ padding: '3px 12px', borderRadius: 999, border: 'none', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', fontWeight: curTab === t ? 600 : 400, background: curTab === t ? 'var(--accent-bg)' : 'transparent', color: curTab === t ? 'var(--accent-fg)' : 'var(--text3)', whiteSpace: 'nowrap' }}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                  <button onClick={() => refreshTab(inst.id)} style={{ marginLeft: 'auto', padding: '3px 10px', borderRadius: 999, border: '1px solid var(--border2)', fontSize: 11, cursor: 'pointer', background: 'transparent', color: 'var(--text3)', fontFamily: 'inherit' }}>↻</button>
                </div>

                {/* Sources */}
                {curTab === 'sources' && (
                  <div>
                    {sources[inst.id] === null && <div style={{ padding: 20, color: 'var(--text3)', fontSize: 12 }}><Spinner size={11} /> Loading sources…</div>}
                    {sources[inst.id]?.length === 0 && <div style={{ padding: 20, color: 'var(--text3)', fontSize: 12 }}>No sources configured.{!inst.workspace_id && ' Click "Discover WS" first.'}</div>}
                    {sources[inst.id] && sources[inst.id]!.length > 0 && (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 380 }}>
                          <thead><tr>
                            {['Source','Type',''].map(h => <th key={h} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text4)', padding: '8px 14px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {sources[inst.id]!.map((s, i) => (
                              <tr key={s.sourceId || s.id || i}>
                                <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <AbIcon name={s.sourceName || s.sourceType || s.name} size={22} />
                                    <div>
                                      <div style={{ fontSize: 12, fontWeight: 500 }}>{s.name}</div>
                                      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{s.sourceName || s.sourceType || '—'}</div>
                                    </div>
                                  </div>
                                </td>
                                <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)' }}>{s.sourceName || s.sourceType || '—'}</td>
                                <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)' }}>
                                  {isAdmin && <Btn size="sm" variant="danger" onClick={() => deleteSource(inst.id, s.sourceId || s.id || '')}>Delete</Btn>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* Destinations */}
                {curTab === 'destinations' && (
                  <div>
                    {dests[inst.id] === null && <div style={{ padding: 20, color: 'var(--text3)', fontSize: 12 }}><Spinner size={11} /> Loading destinations…</div>}
                    {dests[inst.id]?.length === 0 && <div style={{ padding: 20, color: 'var(--text3)', fontSize: 12 }}>No destinations configured in Airbyte.</div>}
                    {dests[inst.id] && dests[inst.id]!.length > 0 && (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 340 }}>
                          <thead><tr>
                            {['Destination','Type'].map(h => <th key={h} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text4)', padding: '8px 14px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {dests[inst.id]!.map((d, i) => (
                              <tr key={d.destinationId || d.id || i}>
                                <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 500 }}>{d.name}</td>
                                <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)' }}>{d.destinationType || d.destinationName || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* Connections */}
                {curTab === 'connections' && (
                  <div>
                    {conns2[inst.id] === null && <div style={{ padding: 20, color: 'var(--text3)', fontSize: 12 }}><Spinner size={11} /> Loading connections…</div>}
                    {conns2[inst.id]?.length === 0 && <div style={{ padding: 20, color: 'var(--text3)', fontSize: 12 }}>No connections configured.</div>}
                    {conns2[inst.id] && conns2[inst.id]!.length > 0 && (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 440 }}>
                          <thead><tr>
                            {['Connection','Schedule','Status',''].map(h => <th key={h} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text4)', padding: '8px 14px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {conns2[inst.id]!.map((c, i) => {
                              const cid = c.connectionId || c.id || ''
                              const sched = (c.schedule as any)?.scheduleType || 'manual'
                              return (
                                <tr key={cid || i}>
                                  <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 500 }}>{c.name}</td>
                                  <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{sched}</td>
                                  <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)' }}><AbStatusBadge status={c.status} /></td>
                                  <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)' }}>
                                    <div style={{ display: 'flex', gap: 5 }}>
                                      {isAdmin && <Btn size="sm" onClick={() => triggerSync(inst.id, cid)} disabled={syncing === cid}>{syncing === cid ? <Spinner size={10} /> : 'Sync'}</Btn>}
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* Jobs */}
                {curTab === 'jobs' && (
                  <div>
                    {jobs2[inst.id] === null && <div style={{ padding: 20, color: 'var(--text3)', fontSize: 12 }}><Spinner size={11} /> Loading jobs…</div>}
                    {jobs2[inst.id]?.length === 0 && <div style={{ padding: 20, color: 'var(--text3)', fontSize: 12 }}>No recent jobs.</div>}
                    {jobs2[inst.id] && jobs2[inst.id]!.map((j, i) => {
                      const jj = normaliseJob(j) as any
                      const createdMs = (jj.createdAt||0) > 1e12 ? jj.createdAt : (jj.createdAt||0)*1000
                      const durSec = jj.updatedAt && jj.createdAt ? Math.round(((jj.updatedAt>1e12?jj.updatedAt:jj.updatedAt*1000) - createdMs)/1000) : null
                      const isRunning = (jj.status||'').toLowerCase() === 'running'
                      return (
                        <div key={jj.id || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 500 }}>Job #{jj.id}</div>
                            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{createdMs ? new Date(createdMs).toLocaleString() : '—'}{durSec !== null ? ` · ${durSec >= 60 ? Math.floor(durSec/60)+'m '+durSec%60+'s' : durSec+'s'}` : ''}</div>
                          </div>
                          <AbStatusBadge status={jj.status} />
                          {isAdmin && isRunning && (
                            <Btn size="sm" variant="danger" onClick={() => cancelJob(inst.id, jj.id)} disabled={cancelling === String(jj.id)}>
                              {cancelling === String(jj.id) ? <Spinner size={10}/> : 'Cancel'}
                            </Btn>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Add / Edit modal */}
      {showForm && (
        <div onClick={e => { if (e.target === e.currentTarget) { setShowForm(false); setEditing(null); setForm(AB_EMPTY) } }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--surface)', borderRadius: 14, padding: 28, width: 420, maxWidth: '100%', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{editing ? 'Edit Airbyte instance' : 'Connect Airbyte instance'}</div>
              <button onClick={() => { setShowForm(false); setEditing(null); setForm(AB_EMPTY) }} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--border2)', background: 'var(--bg)', fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>
            <div style={{ padding: '8px 12px', background: '#f0fdf4', borderRadius: 8, fontSize: 12, color: '#15803d', lineHeight: 1.5, marginBottom: 16, border: '1px solid #bbf7d0' }}>
              <strong>Docker Compose</strong> — use Username: <code style={{fontFamily:'var(--font-mono)'}}>airbyte</code> / Password: <code style={{fontFamily:'var(--font-mono)'}}>password</code><br/>
              <strong>abctl (Kubernetes)</strong> — use your email + password from <code style={{fontFamily:'var(--font-mono)'}}>abctl local credentials</code>, plus Client ID &amp; Secret below.
            </div>
            {([
              { key: 'label',         label: 'Label',         ph: 'Local Airbyte',          type: 'text',     hint: '' },
              { key: 'url',           label: 'Airbyte URL',   ph: 'http://localhost:8000',  type: 'text',     hint: 'Default port 8000', req: true },
              { key: 'username',      label: 'Email / Username', ph: 'airbyte or your@email.com', type: 'text', hint: '' },
              { key: 'password',      label: 'Password',      ph: editing ? '(unchanged)' : 'password', type: 'password', hint: editing ? 'Leave blank to keep existing' : '' },
              { key: 'client_id',     label: 'Client ID',     ph: 'abctl only — from abctl local credentials', type: 'text', hint: 'OAuth2 client ID for abctl deployments' },
              { key: 'client_secret', label: 'Client Secret', ph: editing ? '(unchanged)' : 'abctl only', type: 'password', hint: editing ? 'Leave blank to keep existing' : 'OAuth2 client secret for abctl deployments' },
            ] as const).map(f => (
              <div key={f.key} style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 5 }}>
                  {f.label}{(f as any).req && <span style={{ color: '#dc2626' }}> *</span>}
                </label>
                <input type={f.type} value={form[f.key as keyof typeof form]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.ph}
                  style={{ width: '100%', padding: '8px 11px', border: '1.5px solid var(--border2)', borderRadius: 8, fontSize: 13, background: 'var(--bg)', color: 'var(--text)', fontFamily: 'inherit', outline: 'none' }} />
                {f.hint && <div style={{ fontSize: 11, color: 'var(--text4)', marginTop: 3 }}>{f.hint}</div>}
              </div>
            ))}
            <div style={{ padding: '10px 12px', background: '#eff6ff', borderRadius: 8, fontSize: 12, color: '#2563eb', lineHeight: 1.6, marginBottom: 20 }}>
              Run <code style={{ fontFamily: 'var(--font-mono)', background: 'rgba(37,99,235,.12)', padding: '1px 5px', borderRadius: 4 }}>docker compose up -d</code> in your Airbyte directory. Default: <code style={{ fontFamily: 'var(--font-mono)' }}>airbyte / password</code>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Btn variant="ghost" onClick={() => { setShowForm(false); setEditing(null); setForm(AB_EMPTY) }}>Cancel</Btn>
              <Btn onClick={saveInstance} disabled={saving}>{saving ? <Spinner size={12} /> : (editing ? 'Save changes' : 'Connect')}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

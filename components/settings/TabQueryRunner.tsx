'use client'
import { useState, useEffect, useRef, useCallback } from 'react'

type ConnType = 'db' | 'api' | 'fileserver'
interface Connection { id: string; label: string; dialect: string; environment: string; type: ConnType; group: string; subgroup: string; shortLabel: string; hint: string; inputLabel: string }
interface QueryResult { columns: string[]; rows: Record<string, any>[]; rowCount: number; durationMs: number; dialect: string; label: string; file?: string; modified?: string; note?: string }
interface SavedQuery { id: string; label: string; connectionId: string; connectionLabel: string; query: string; savedAt: string }

const DIALECT_LABELS: Record<string, string> = { postgres: 'PostgreSQL', mysql: 'MySQL', mssql: 'SQL Server', sqlite: 'SQLite', mongodb: 'MongoDB', clickhouse: 'ClickHouse', influxdb: 'InfluxDB', elasticsearch: 'Elasticsearch', api: 'REST API', file: 'File' }
const ENV_DOT: Record<string, string> = { production: '#e24b4a', staging: '#ef9f27', development: '#1D9E75' }

function dbHint(d: string) {
  if (d === 'mssql') return 'SELECT TOP 100 * FROM your_table'
  if (d === 'mongodb') return '{ "collection": "your_collection", "filter": {}, "limit": 100 }'
  if (d === 'influxdb') return 'SELECT * FROM measurement LIMIT 100'
  if (d === 'elasticsearch') return '{ "query": { "match_all": {} } }'
  return 'SELECT * FROM your_table LIMIT 100'
}
interface DropdownOption { value: string; label: string; group?: string; meta?: string }
function CustomDropdown({ value, onChange, options, placeholder, searchable = false, disabled = false }: { value: string; onChange: (v: string) => void; options: DropdownOption[]; placeholder?: string; searchable?: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h) }, [])
  useEffect(() => { if (open && searchable && inputRef.current) inputRef.current.focus() }, [open])
  const selected = options.find(o => o.value === value)
  const filtered = search ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()) || (o.group ?? '').toLowerCase().includes(search.toLowerCase())) : options
  const groups = [...new Set(options.map(o => o.group ?? ''))]
  const hasGroups = groups.some(g => g !== '')
  const renderItem = (o: DropdownOption) => (
    <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); setSearch('') }}
      style={{ width: '100%', background: o.value === value ? 'var(--bg3)' : 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: 'inherit', fontSize: 13, color: o.value === value ? 'var(--text)' : 'var(--text2)', padding: '8px 14px', textAlign: 'left' }}
      onMouseEnter={e => { if (o.value !== value) e.currentTarget.style.background = 'var(--bg3)' }}
      onMouseLeave={e => { if (o.value !== value) e.currentTarget.style.background = 'none' }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{o.label}</span>
      {o.meta && <span style={{ fontSize: 10, color: 'var(--text4)', marginLeft: 8, flexShrink: 0 }}>{o.meta}</span>}
      {o.value === value && <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ marginLeft: 6, flexShrink: 0 }}><path d="M2 6l3 3 5-5" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
    </button>
  )
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <button onClick={() => !disabled && setOpen(v => !v)} disabled={disabled}
        style={{ width: '100%', height: 38, background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: selected ? 'var(--text)' : 'var(--text3)', cursor: disabled ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: 'inherit', fontSize: 13, padding: '0 10px', textAlign: 'left', opacity: disabled ? 0.5 : 1 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{selected ? selected.label : (placeholder ?? '— select —')}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, marginLeft: 6, transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }}><path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: '0 4px 16px rgba(0,0,0,.12)', zIndex: 100, maxHeight: 280, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {searchable && <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}><input ref={inputRef} style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 12, padding: '5px 10px', outline: 'none', boxSizing: 'border-box' }} placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} onClick={e => e.stopPropagation()} /></div>}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.length === 0 && <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text4)' }}>No results</div>}
            {hasGroups
              ? groups.map(grp => { const items = filtered.filter(o => (o.group ?? '') === grp); if (!items.length) return null; return (<div key={grp}>{grp && <div style={{ padding: '8px 14px 4px', fontSize: 10, fontWeight: 600, color: 'var(--text4)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{grp}</div>}{items.map(renderItem)}</div>) })
              : filtered.map(renderItem)}
          </div>
        </div>
      )}
    </div>
  )
}
export default function TabQueryRunner() {
  const [connections, setConnections] = useState<Connection[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState(500)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 10

  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([])
  const [saveLabel, setSaveLabel] = useState('')
  const [showSave, setShowSave] = useState(false)
  const [showSavedPanel, setShowSavedPanel] = useState(false)
  const [savedSearch, setSavedSearch] = useState('')
  const savedPanelRef = useRef<HTMLDivElement>(null)

  const [schemaLoading, setSchemaLoading] = useState(false)
  const [copiedCell, setCopiedCell] = useState<string | null>(null)
  const [exported, setExported] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const selectedConn = connections.find(c => c.id === selectedId)
  const isApi = selectedConn?.type === 'api'
  const isFile = selectedConn?.type === 'fileserver'
  const [tableOptions, setTableOptions] = useState<{ value: string; label: string; sql: string }[]>([])
  const [selectedTable, setSelectedTable] = useState('')

  // Plain-English query building. aiStatus is null until known, so the input
  // isn't disabled on first paint and then enabled a moment later.
  const [nlQuestion, setNlQuestion] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genNote, setGenNote] = useState<string | null>(null)
  const [aiStatus, setAiStatus] = useState<{ available: boolean; disabled: boolean } | null>(null)

  useEffect(() => {
    fetch('/api/ai/status')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setAiStatus({ available: !!d.available, disabled: !!d.disabled }) })
      .catch(() => {})
  }, [])

  // Puts the result in the editor rather than executing it: the user reviews,
  // edits if needed, then runs through the normal path.
  const generateQuery = useCallback(async () => {
    if (!selectedId || !nlQuestion.trim()) return
    setGenerating(true); setGenNote(null); setError(null)
    try {
      const res = await fetch('/api/query-runner/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: selectedId, question: nlQuestion.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        // Every failure mode from this endpoint carries a human-readable
        // message, including the deliberate no-AI case.
        setGenNote(data?.error ?? 'Couldn’t build a query from that question.')
        if (data?.code === 'no_llm') setAiStatus({ available: false, disabled: !!data.disabled })
        return
      }
      setQuery(data.query)
      setResult(null)
      setGenNote('Query built — review it below, then Run.')
    } catch {
      setGenNote('Couldn’t build a query just now. You can still write one yourself.')
    } finally {
      setGenerating(false)
    }
  }, [selectedId, nlQuestion])

  // ── Load sources ──────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      fetch('/api/connections').then(r => r.json()).catch(() => ({ connections: [] })),
      fetch('/api/services').then(r => r.json()).catch(() => ({ services: [], connections: [] })),
      fetch('/api/file-servers').then(r => r.json()).catch(() => ({ file_servers: [] })),
    ]).then(([dbRes, apiRes, fsRes]) => {
      const dbs: Connection[] = (dbRes.connections ?? []).map((c: any) => ({ id: c.id, label: c.label, dialect: c.dialect, environment: c.environment ?? 'development', type: 'db' as ConnType, group: 'Databases', subgroup: DIALECT_LABELS[c.dialect] ?? c.dialect, shortLabel: c.label, hint: dbHint(c.dialect), inputLabel: 'SQL Query' }))
      const svcMap = Object.fromEntries((apiRes?.services ?? []).map((s: any) => [s.id, s]))
      const apis: Connection[] = (apiRes?.connections ?? []).map((c: any) => { const svc = svcMap[c.service_id] ?? {}; return { id: c.id, label: `${svc.label ?? 'API'} / ${c.label}`, dialect: 'api', environment: svc.environment ?? 'development', type: 'api' as ConnType, group: 'API Endpoints', subgroup: svc.label ?? 'Unknown', shortLabel: c.label, hint: c.base_path ?? '/', inputLabel: 'Endpoint' } })
      const files: Connection[] = (fsRes?.file_servers ?? []).map((s: any) => ({ id: s.id, label: s.label, dialect: 'file', environment: s.environment ?? 'development', type: 'fileserver' as ConnType, group: 'File Servers', subgroup: s.transport ?? 'local', shortLabel: s.label, hint: 'latest report', inputLabel: 'File hint' }))
      const all = [...dbs, ...apis, ...files]
      setConnections(all)
      if (all.length > 0) setSelectedId(all[0].id)
    })
    try { const s = localStorage.getItem('mosaic_saved_queries'); if (s) setSavedQueries(JSON.parse(s)) } catch {}
  }, [])

  // ── Schema / table dropdown ───────────────────────────────────────────
  useEffect(() => {
    setTableOptions([]); setSelectedTable('')
    if (!selectedId || !selectedConn) return
    if (selectedConn.type === 'db') {
      setSchemaLoading(true)
      fetch('/api/connections/schema-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connection_id: selectedId }) })
        .then(r => r.json()).then(d => {
          setTableOptions((d.schema?.tables ?? []).map((t: any) => {
            const name = t.schema && t.schema !== 'public' ? `${t.schema}.${t.name}` : t.name
            const sql = selectedConn.dialect === 'mssql' ? `SELECT TOP 100 * FROM ${name}` : selectedConn.dialect === 'mongodb' ? `{ "collection": "${t.name}", "filter": {}, "limit": 100 }` : `SELECT * FROM ${name} LIMIT 100`
            return { value: name, label: name, sql }
          }))
        }).catch(() => {}).finally(() => setSchemaLoading(false))
    }
    if (selectedConn.type === 'api') setTableOptions([{ value: '__auto__', label: selectedConn.hint || '/', sql: '' }])
    if (selectedConn.type === 'fileserver') {
      fetch('/api/query-runner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connectionId: selectedId, connectionType: 'fileserver', query: '' }) })
        .then(r => r.json()).then(d => { if (d.rows?.length) setTableOptions(d.rows.map((r: any) => { const n = r.name ?? r.file ?? String(Object.values(r)[0]); return { value: n, label: n, sql: n } })) }).catch(() => {})
    }
  }, [selectedId])

  function onTableSelect(v: string) { setSelectedTable(v); const opt = tableOptions.find(o => o.value === v); if (opt?.sql && !isApi) setQuery(opt.sql) }

  // ── Run ───────────────────────────────────────────────────────────────
  const runQuery = useCallback(async () => {
    if (!selectedId || (!isApi && !query.trim())) return
    setRunning(true); setError(null); setResult(null)
    try {
      const res = await fetch('/api/query-runner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connectionId: selectedId, connectionType: selectedConn?.type ?? 'db', query: query.trim(), limit }) })
      const data = await res.json()
      if (!res.ok || data.error) setError(data.error ?? 'Query failed')
      else { setResult(data); setPage(1) }
    } catch (e: any) { setError(e?.message ?? 'Network error') }
    finally { setRunning(false) }
  }, [selectedId, selectedConn, query, limit])

  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); runQuery() } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [runQuery])

  // Close saved panel on outside click
  useEffect(() => { const h = (e: MouseEvent) => { if (savedPanelRef.current && !savedPanelRef.current.contains(e.target as Node)) setShowSavedPanel(false) }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h) }, [])

  // ── Saved queries ─────────────────────────────────────────────────────
  function saveQuery() {
    if (!saveLabel.trim() || !selectedConn) return
    const sq: SavedQuery = { id: Date.now().toString(), label: saveLabel.trim(), connectionId: selectedId, connectionLabel: selectedConn.label, query: query.trim(), savedAt: new Date().toISOString() }
    const updated = [sq, ...savedQueries].slice(0, 50); setSavedQueries(updated)
    try { localStorage.setItem('mosaic_saved_queries', JSON.stringify(updated)) } catch {}
    setSaveLabel(''); setShowSave(false)
  }
  function deleteSaved(id: string) { const u = savedQueries.filter(q => q.id !== id); setSavedQueries(u); try { localStorage.setItem('mosaic_saved_queries', JSON.stringify(u)) } catch {} }
  function loadSaved(sq: SavedQuery) {
    const conn = connections.find(c => c.id === sq.connectionId) ?? connections.find(c => c.label === sq.connectionLabel)
    if (conn) {
      setSelectedId(conn.id); setSelectedTable(''); setTableOptions([])
      if (!sq.connectionId || sq.connectionId !== conn.id) { const u = savedQueries.map(q => q.id === sq.id ? { ...q, connectionId: conn.id } : q); setSavedQueries(u); try { localStorage.setItem('mosaic_saved_queries', JSON.stringify(u)) } catch {} }
    }
    setQuery(sq.query); setResult(null); setError(null)
    setShowSavedPanel(false); setSavedSearch('')
  }

  // ── Export / copy ─────────────────────────────────────────────────────
  function exportCsv() {
    if (!result?.rows.length) return
    const csv = [result.columns.join(','), ...result.rows.map(row => result.columns.map(col => { const v = row[col]; const s = v == null ? '' : String(v); return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s }).join(','))].join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `query-${Date.now()}.csv`; a.click(); URL.revokeObjectURL(a.href)
    setExported(true); setTimeout(() => setExported(false), 2000)
  }
  function copyCell(val: any, key: string) { navigator.clipboard.writeText(val == null ? '' : String(val)); setCopiedCell(key); setTimeout(() => setCopiedCell(null), 1200) }
  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text)', margin: '0 0 4px' }}>Query Builder</h1>
        <p style={{ fontSize: 13, color: 'var(--text3)', margin: 0 }}>Explore any connected data source — pick a source, choose a table, and run.</p>
      </div>

      {/* ── Toolbar ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>

        {/* Data source */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 2, minWidth: 200 }}>
          <label style={LBL}>Data source</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <CustomDropdown value={selectedId} onChange={v => { setSelectedId(v); setQuery(''); setResult(null); setError(null); setSelectedTable(''); setNlQuestion(''); setGenNote(null) }} searchable placeholder="Select a data source…"
                options={connections.map(c => ({ value: c.id, label: c.label, group: c.group, meta: c.dialect !== 'api' && c.dialect !== 'file' ? DIALECT_LABELS[c.dialect] ?? c.dialect : undefined }))} />
            </div>
            {selectedConn && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 500, color: ENV_DOT[selectedConn.environment] ?? 'var(--text3)', whiteSpace: 'nowrap', flexShrink: 0 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: ENV_DOT[selectedConn.environment] ?? 'var(--text4)', display: 'inline-block' }} />{selectedConn.environment}</span>}
          </div>
        </div>

        {/* Table */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1.5, minWidth: 160 }}>
          <label style={LBL}>{isApi ? 'Endpoint' : isFile ? 'File' : schemaLoading ? 'Table — loading…' : 'Table'}</label>
          {isApi
            ? <div style={{ height: 38, display: 'flex', alignItems: 'center', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '0 12px', fontSize: 13, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedConn?.hint ?? '/'}</div>
            : <CustomDropdown value={selectedTable} onChange={onTableSelect} placeholder={schemaLoading ? 'Loading…' : '— select table —'} disabled={schemaLoading || tableOptions.length === 0} options={tableOptions.map(o => ({ value: o.value, label: o.label }))} />}
        </div>

        {/* Rows */}
        {!isApi && <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={LBL}>Rows</label>
          <select style={{ ...SEL, width: 90 }} value={limit} onChange={e => setLimit(Number(e.target.value))}>{[100, 250, 500, 1000, 2000].map(n => <option key={n} value={n}>{n}</option>)}</select>
        </div>}

        {/* Run */}
        <button onClick={runQuery} disabled={running || !selectedId || (!isApi && !query.trim())}
          style={{ height: 38, padding: '0 20px', background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 500, cursor: running || !selectedId || (!isApi && !query.trim()) ? 'default' : 'pointer', opacity: running || !selectedId || (!isApi && !query.trim()) ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {running ? <><Spinner />Running…</> : <><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><polygon points="2,1 10,6 2,11" fill="currentColor"/></svg>Run</>}
        </button>

        {/* Saved queries button */}
        <div ref={savedPanelRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button onClick={() => setShowSavedPanel(v => !v)}
            style={{ height: 38, padding: '0 14px', background: showSavedPanel ? 'var(--bg3)' : 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text2)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><rect x="1" y="1" width="12" height="12" rx="1.5"/><path d="M4 5h6M4 7.5h6M4 10h4"/></svg>
            Saved queries
            {savedQueries.length > 0 && <span style={{ background: 'var(--accent)', color: 'white', borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '0 5px', lineHeight: '16px' }}>{savedQueries.length}</span>}
          </button>

          {showSavedPanel && (
            <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, width: 400, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: '0 8px 24px rgba(0,0,0,.14)', zIndex: 200, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', flexShrink: 0 }}>Saved queries</span>
                <input
                  autoFocus
                  style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 12, padding: '4px 9px', outline: 'none' }}
                  placeholder="Search…"
                  value={savedSearch}
                  onChange={e => setSavedSearch(e.target.value)}
                />
                <button onClick={() => { setShowSavedPanel(false); setSavedSearch('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 16, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>×</button>
              </div>
              <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                {(() => {
                  const filtered = savedSearch
                    ? savedQueries.filter(sq => sq.label.toLowerCase().includes(savedSearch.toLowerCase()) || sq.connectionLabel.toLowerCase().includes(savedSearch.toLowerCase()))
                    : savedQueries
                  if (savedQueries.length === 0) return <div style={{ padding: '24px 14px', fontSize: 12, color: 'var(--text4)', textAlign: 'center' }}>No saved queries yet.<br/>Write a query and click "Save query".</div>
                  if (filtered.length === 0) return <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--text4)', textAlign: 'center' }}>No matches for "{savedSearch}"</div>
                  return filtered.map(sq => (
                    <div key={sq.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderBottom: '1px solid var(--border)' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sq.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sq.connectionLabel}</div>
                      </div>
                      <button style={{ ...GHOST_BTN, flexShrink: 0 }} onClick={() => loadSaved(sq)}>Load</button>
                      <button style={{ ...GHOST_BTN, color: 'var(--text4)', flexShrink: 0 }} onClick={() => deleteSaved(sq.id)}>Delete</button>
                    </div>
                  ))
                })()}
              </div>
            </div>
          )}
        </div>
      </div>
      {/* ── Ask in plain English ──
          Writes into the editor below rather than running straight away: the
          user sees the query, can edit it, and execution still goes through the
          normal Run path. Hidden for API/file sources, which aren't queried. */}
      {!isApi && !isFile && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
            <input
              style={{ flex: 1, height: 38, background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 13, padding: '0 12px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
              placeholder={aiStatus && !aiStatus.available ? 'Ask a question in plain English…' : 'Ask in plain English — e.g. "top 10 downtime reasons last week"'}
              value={nlQuestion}
              disabled={!selectedId || generating || (aiStatus ? !aiStatus.available : false)}
              onChange={e => { setNlQuestion(e.target.value); setGenNote(null) }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generateQuery() } }}
            />
            <button
              onClick={generateQuery}
              disabled={!selectedId || generating || !nlQuestion.trim() || (aiStatus ? !aiStatus.available : false)}
              style={{ height: 38, padding: '0 16px', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text2)', fontSize: 12, fontWeight: 500, fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 7, cursor: (!selectedId || generating || !nlQuestion.trim() || (aiStatus ? !aiStatus.available : false)) ? 'default' : 'pointer', opacity: (!selectedId || generating || !nlQuestion.trim() || (aiStatus ? !aiStatus.available : false)) ? .5 : 1 }}>
              {generating ? <><Spinner />Building…</> : 'Build query'}
            </button>
          </div>
          {/* Availability notice — stated once, calmly, not as an error. */}
          {aiStatus && !aiStatus.available && (
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>
              {aiStatus.disabled
                ? 'This deployment runs without an AI model, so questions can’t be turned into queries. Everything else here works as normal.'
                : 'Mosaic isn’t connected to an AI model yet, so it can’t turn questions into queries. An admin can connect one in Settings → API Keys. You can still write and run queries below.'}
            </div>
          )}
          {genNote && (
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>{genNote}</div>
          )}
        </div>
      )}

      {/* ── Query editor ── */}
      {!isApi && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg2)' }}>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>{isFile ? 'Enter a filename or keyword' : '⌘↵ to run · select a table above to auto-fill'}</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {showSave
                ? <><input style={INP_SM} placeholder="Query name…" value={saveLabel} autoFocus onChange={e => setSaveLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveQuery(); if (e.key === 'Escape') setShowSave(false) }} /><button style={GHOST_BTN} onClick={saveQuery} disabled={!saveLabel.trim()}>Save</button><button style={GHOST_BTN} onClick={() => setShowSave(false)}>Cancel</button></>
                : <button style={GHOST_BTN} onClick={() => setShowSave(true)} disabled={!query.trim()}>Save query</button>}
            </div>
          </div>
          <textarea ref={textareaRef} style={{ fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.6, background: 'transparent', color: 'var(--text)', border: 'none', outline: 'none', padding: '14px 16px', resize: 'vertical', minHeight: 100, maxHeight: 240, width: '100%', boxSizing: 'border-box' }}
            value={query} onChange={e => setQuery(e.target.value)} placeholder={selectedConn?.hint ?? '-- Select a data source above'} spellCheck={false} autoCapitalize="off" autoCorrect="off" />
        </div>
      )}
      {isApi && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div><div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{selectedConn?.label}</div><div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>GET {selectedConn?.hint}</div></div>
          <div style={{ display: 'flex', gap: 6 }}>
            {showSave
              ? <><input style={INP_SM} placeholder="Query name…" value={saveLabel} autoFocus onChange={e => setSaveLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveQuery(); if (e.key === 'Escape') setShowSave(false) }} /><button style={GHOST_BTN} onClick={saveQuery} disabled={!saveLabel.trim()}>Save</button><button style={GHOST_BTN} onClick={() => setShowSave(false)}>Cancel</button></>
              : <button style={GHOST_BTN} onClick={() => setShowSave(true)}>Save</button>}
          </div>
        </div>
      )}

      {/* ── Results ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
        {result && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg2)' }}>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>{result.rowCount} row{result.rowCount !== 1 ? 's' : ''} · {result.durationMs}ms · {result.label}{result.file ? ` · ${result.file}` : ''}</span>
            <button onClick={exportCsv} style={GHOST_BTN}>{exported ? 'Exported ✓' : 'Export CSV'}</button>
          </div>
        )}
        <div style={{ minHeight: 160 }}>
          {error && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: 'var(--red-bg)', border: '1px solid rgba(220,38,38,.15)', borderRadius: 'var(--radius-sm)', color: 'var(--red)', margin: 16, padding: '12px 16px' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/><path d="M8 5v3.5M8 11v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 12, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{error}</pre>
            </div>
          )}
          {result?.note && <div style={{ fontSize: 12, color: 'var(--amber)', background: 'var(--amber-bg)', borderRadius: 'var(--radius-sm)', margin: '12px 16px 0', padding: '8px 12px' }}>{result.note}</div>}
          {!error && !result && !running && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '48px 24px', opacity: .35 }}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><rect x="3" y="7" width="26" height="18" rx="2" stroke="currentColor" strokeWidth="1.3"/><path d="M3 13h26M9 7v6M16 7v6M23 7v6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              <span style={{ fontSize: 13, color: 'var(--text3)' }}>Select a source and run a query</span>
            </div>
          )}
          {!error && result && result.rows.length === 0 && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}><span style={{ fontSize: 13, color: 'var(--text3)' }}>Query returned 0 rows</span></div>}
          {!error && result && result.rows.length > 0 && (() => {
            const totalPages = Math.ceil(result.rows.length / PAGE_SIZE)
            const pagedRows = result.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
            return (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                    <thead><tr><th style={TH_NUM}>#</th>{result.columns.map(col => <th key={col} style={TH}>{col}</th>)}</tr></thead>
                    <tbody>
                      {pagedRows.map((row, i) => {
                        const abs = (page - 1) * PAGE_SIZE + i
                        return (
                          <tr key={abs} style={{ borderBottom: '1px solid var(--border)', background: abs % 2 === 1 ? 'var(--bg2)' : 'transparent' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')} onMouseLeave={e => (e.currentTarget.style.background = abs % 2 === 1 ? 'var(--bg2)' : 'transparent')}>
                            <td style={{ color: 'var(--text4)', fontSize: 10, padding: '8px 10px', textAlign: 'center', userSelect: 'none' }}>{abs + 1}</td>
                            {result.columns.map(col => {
                              const val = row[col]; const isNull = val == null; const ck = `${abs}-${col}`; const strVal = isNull ? '' : String(val)
                              const sc = ['status', 'state', 'category', 'type'].includes(col.toLowerCase()) ? getStatusColor(strVal) : null
                              return (
                                <td key={col} title={isNull ? 'NULL' : strVal} onClick={() => copyCell(val, ck)} style={{ borderRight: '1px solid var(--border)', color: isNull ? 'var(--text4)' : 'var(--text)', cursor: 'pointer', maxWidth: 280, overflow: 'hidden', padding: '8px 16px', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {copiedCell === ck ? <span style={{ background: 'var(--accent-bg)', color: 'var(--accent-fg)', borderRadius: 3, fontSize: 10, padding: '1px 5px' }}>Copied</span>
                                    : isNull ? <span style={{ fontStyle: 'italic', opacity: .4 }}>NULL</span>
                                    : sc ? <span style={{ background: sc.bg, color: sc.fg, borderRadius: 4, fontSize: 11, padding: '1px 8px', fontFamily: 'var(--font-sans)' }}>{strVal}</span>
                                    : strVal.length > 100 ? strVal.slice(0, 100) + '…' : strVal}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg2)' }}>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>Rows {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, result.rows.length)} of {result.rows.length}</span>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {['«','‹'].map((ch, idx) => <button key={ch} onClick={() => setPage(idx === 0 ? 1 : p => Math.max(1, p-1))} disabled={page===1} style={pgBtn(page===1)}>{ch}</button>)}
                    {Array.from({length:totalPages},(_,i)=>i+1).filter(p=>p===1||p===totalPages||Math.abs(p-page)<=2)
                      .reduce<(number|'…')[]>((a,p,i,arr)=>{ if(i>0&&p-(arr[i-1] as number)>1) a.push('…'); a.push(p); return a },[])
                      .map((p,i)=>p==='…'?<span key={`e${i}`} style={{fontSize:11,color:'var(--text4)',padding:'0 3px'}}>…</span>:<button key={p} onClick={()=>setPage(p as number)} style={{...pgBtn(false),fontWeight:page===p?700:400,background:page===p?'var(--accent)':'transparent',color:page===p?'white':'var(--text2)',borderColor:page===p?'var(--accent)':'var(--border2)'}}>{p}</button>)}
                    {['›','»'].map((ch,idx) => <button key={ch} onClick={() => setPage(idx===0?p=>Math.min(totalPages,p+1):totalPages)} disabled={page===totalPages} style={pgBtn(page===totalPages)}>{ch}</button>)}
                  </div>
                </div>
              </>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
const LBL: React.CSSProperties = { fontSize: 11, fontWeight: 500, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em' }
const SEL: React.CSSProperties = { height: 38, background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 13, padding: '0 10px', outline: 'none', cursor: 'pointer', width: '100%' }
const INP_SM: React.CSSProperties = { background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 12, padding: '4px 10px', outline: 'none', width: 150 }
const GHOST_BTN: React.CSSProperties = { background: 'none', border: '1px solid var(--border2)', borderRadius: 4, color: 'var(--text2)', cursor: 'pointer', fontSize: 11, padding: '3px 9px', fontFamily: 'inherit' }
const TH: React.CSSProperties = { background: 'var(--bg3)', borderBottom: '2px solid var(--border)', borderRight: '1px solid var(--border)', color: 'var(--text3)', fontSize: 10, fontWeight: 600, letterSpacing: '.05em', padding: '7px 12px', position: 'sticky', textAlign: 'left', textTransform: 'uppercase', top: 0, whiteSpace: 'nowrap', zIndex: 1 }
const TH_NUM: React.CSSProperties = { ...TH, textAlign: 'center', width: 36, borderRight: 'none' }

function pgBtn(disabled: boolean): React.CSSProperties {
  return { background: 'transparent', border: '1px solid var(--border2)', borderRadius: 4, color: disabled ? 'var(--text4)' : 'var(--text2)', cursor: disabled ? 'default' : 'pointer', fontSize: 11, fontFamily: 'inherit', lineHeight: 1, minWidth: 26, padding: '3px 6px', opacity: disabled ? 0.4 : 1 }
}
function Spinner() { return <span style={{ display: 'inline-block', width: 10, height: 10, border: '1.5px solid transparent', borderTopColor: 'currentColor', borderRadius: '50%', animation: 'spin .8s linear infinite' }} /> }
function getStatusColor(val: string): { bg: string; fg: string } | null {
  const v = val.toLowerCase()
  if (['active', 'success', 'completed', 'running', 'online', 'open'].includes(v)) return { bg: 'var(--green-bg, #EAF3DE)', fg: 'var(--green, #3B6D11)' }
  if (['maintenance', 'pending', 'warning', 'paused'].includes(v)) return { bg: 'var(--amber-bg, #FAEEDA)', fg: 'var(--amber, #633806)' }
  if (['error', 'failed', 'critical', 'offline', 'closed', 'inactive'].includes(v)) return { bg: 'var(--red-bg, #FCEBEB)', fg: 'var(--red, #A32D2D)' }
  return null
}

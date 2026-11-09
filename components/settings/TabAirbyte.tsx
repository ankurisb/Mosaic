'use client'
// Third-party connector tab — its own sub-tab in line with Databases / API connections /
// File servers / MCP servers / Prism. The underlying sync engine is deliberately NOT surfaced
// to end users: the UI calls it the "connector engine" and connector logos are served from the
// bundled, same-origin icon set (no vendor CDN, no vendor name in the network tab).
import React, { useState, useCallback } from 'react'
import type { SessionUser } from '@/lib/auth'
import { Btn, Spinner } from './ui'
import { safeJson } from '@/lib/fetch'
import { ObjectFields, seedConfig, type Schema } from './SpecFields'
import DataSourceIcon from './DataSourceIcon'

// Shared, one-time load of the bundled connector icon set (same-origin, air-gap).
let _connIcons: Record<string, string> | null = null
let _connIconsP: Promise<Record<string, string>> | null = null
function loadConnIcons(): Promise<Record<string, string>> {
  if (_connIcons) return Promise.resolve(_connIcons)
  if (!_connIconsP) _connIconsP = fetch('/connectors/airbyte-icons.json').then(r => r.ok ? r.json() : {}).then(d => { _connIcons = d; return d }).catch(() => ({}))
  return _connIconsP
}
function useConnIcons() {
  const [icons, setIcons] = React.useState<Record<string, string> | null>(_connIcons)
  React.useEffect(() => { if (!_connIcons) loadConnIcons().then(setIcons) }, [])
  return icons || _connIcons
}
// Normalise a connector display name / type into the bundled icon key.
function connIconSlug(name: string): string {
  return (name || '').toLowerCase().replace(/^source-/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
// White-label the engine instance label for display (covers rows seeded before the rename): drop
// the "(abctl)" deployment tag and swap the vendor word for the neutral term.
function displayEngineLabel(label: string): string {
  return (label || 'Connector engine').replace(/\s*\(abctl\)\s*/i, ' ').replace(/airbyte/ig, 'Connector Engine').replace(/\s{2,}/g, ' ').trim()
}

export default function TabAirbyte({ user, openConnector }: { user: SessionUser; openConnector?: { name: string; nonce: number } | null }) {
  const [showAirbyteForm, setShowAirbyteForm] = useState(false)
  const [airbyteCount, setAirbyteCount] = useState(0)
  const [airbyteIsCloud, setAirbyteIsCloud] = useState(false)
  React.useEffect(() => {
    fetch('/api/airbyte?action=list').then(r => r.json()).then(d => {
      const instances = d.instances || []
      setAirbyteCount(instances.length)
      setAirbyteIsCloud(instances.some((i: { url?: string }) => /(^|\.)airbyte\.com/i.test(i.url || '')))
    }).catch(() => {})
  }, [showAirbyteForm])

  return (
    <div>
      {user.role === 'admin' && (
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          {!airbyteIsCloud && (
            <a href="/connectors" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, border: '1px solid var(--border2)', background: 'var(--bg)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', color: 'var(--text)', textDecoration: 'none', fontWeight: 500 }}>
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="3.5" cy="7" r="2"/><circle cx="10.5" cy="3.5" r="2"/><circle cx="10.5" cy="10.5" r="2"/><path d="M5.3 6.1l3.4-1.6M5.3 7.9l3.4 1.6"/></svg>
              Build one with AI
            </a>
          )}
          {airbyteCount === 0 && (
            <button onClick={() => setShowAirbyteForm(true)}
              style={{ padding: '7px 14px', borderRadius: 999, border: '1px solid var(--border2)', background: 'var(--bg)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, fontFamily: 'inherit' }}>
              + Connect engine
            </button>
          )}
        </div>
      )}
      {user.role === 'admin' && airbyteIsCloud && (
        <div style={{ marginBottom: 16, padding: '14px 16px', borderRadius: 12, border: '1px solid var(--border2)', background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent-fg) 6%, transparent), color-mix(in srgb, var(--accent-fg) 2%, transparent))', maxWidth: 560 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 6, background: 'color-mix(in srgb, var(--accent-fg) 12%, transparent)' }}>
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="var(--accent-fg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="6.5" width="9" height="6" rx="1.2"/><path d="M4.5 6.5V4.5a2.5 2.5 0 0 1 5 0v2"/></svg>
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>AI custom connectors</span>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--accent-fg)', background: 'color-mix(in srgb, var(--accent-fg) 10%, transparent)', padding: '2px 7px', borderRadius: 999 }}>Enterprise</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.6 }}>
            Build a connector to <em>any</em> source — including your proprietary and internal systems — by describing it in plain language. Available on the self-hosted Enterprise edition, where connectors are built and run entirely within your network. The standard catalog of 300+ connectors is available here.
          </div>
        </div>
      )}
      <AirbyteSection user={user} showForm={showAirbyteForm} setShowForm={setShowAirbyteForm} onCountChange={setAirbyteCount} openConnector={openConnector} />
    </div>
  )
}

interface AbInstance { id: string; label: string; url: string; username: string; workspace_id: string | null; last_synced: string | null; client_id?: string | null }
interface AbSource   { sourceId?: string; id?: string; name: string; sourceName?: string; sourceType?: string; status?: string }
interface AbDest     { destinationId?: string; id?: string; name: string; destinationType?: string; destinationName?: string }
interface AbConn     { connectionId?: string; id?: string; name: string; status: string; schedule?: Record<string,unknown>; syncCatalog?: { streams?: unknown[] } }
interface AbJob      { id?: number; jobId?: number; status: string; createdAt?: number; updatedAt?: number; job?: { id: number; status: string; createdAt: number; updatedAt: number } }

const AB_EMPTY = { label: 'Connector engine', url: 'http://localhost:8000', username: 'airbyte', password: '', client_id: '', client_secret: '' }

// Connector logo chip — served entirely from the bundled icon set (same-origin, air-gap, no vendor
// CDN or vendor name in the network tab). Falls back to a generic glyph when no logo is bundled.
function AbIcon({ name, size = 26 }: { name: string; size?: number }) {
  const icons = useConnIcons()
  const svg = icons?.[connIconSlug(name)]
  return <DataSourceIcon name={name} size={size} kind="connector" svg={svg || undefined} />
}

function AbStatusBadge({ status }: { status: string }) {
  const s = (status || '').toLowerCase()
  const map: Record<string,[string,string]> = {
    active: ['var(--green-bg)','var(--green-t)'], inactive: ['var(--red-bg)','var(--red-t)'],
    succeeded: ['var(--green-bg)','var(--green-t)'], failed: ['var(--red-bg)','var(--red-t)'],
    running: ['var(--blue-bg)','var(--blue-t)'], pending: ['var(--amber-bg)','var(--amber-t)'],
  }
  const [bg,fg] = map[s] || ['var(--bg4)','var(--text3)']
  return <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600, background: bg, color: fg }}>{status || '—'}</span>
}

function AirbyteSection({ user, showForm, setShowForm, onCountChange, openConnector }: { user: SessionUser; showForm: boolean; setShowForm: (v: boolean) => void; onCountChange?: (n: number) => void; openConnector?: { name: string; nonce: number } | null }) {
  const isAdmin = user.role === 'admin'
  const [instances, setInstances]     = React.useState<AbInstance[]>([])
  const [loading, setLoading]         = React.useState(true)
  const [form, setForm]               = React.useState(AB_EMPTY)
  const [editing, setEditing]         = React.useState<string | null>(null)
  const [saving, setSaving]           = React.useState(false)
  const [expanded, setExpanded]       = React.useState<string | null>(null)
  const [pingMap, setPingMap]         = React.useState<Record<string,{ok:boolean;msg:string}|'loading'>>({})
  const [syncing, setSyncing]         = React.useState<string | null>(null)
  const [cancelling, setCancelling]   = React.useState<string | null>(null)
  const [pipelines, setPipelines]     = React.useState<Record<string, any[]|null>>({})
  const [pipelinesLoading, setPipelinesLoading] = React.useState<Record<string,boolean>>({})
  const [showAdvanced, setShowAdvanced] = React.useState<Record<string,boolean>>({})
  const [subTab, setSubTab]           = React.useState<Record<string,'sources'|'connections'|'jobs'|'destinations'>>({})
  const [sources, setSources]         = React.useState<Record<string, AbSource[] | null>>({})
  const [dests, setDests]             = React.useState<Record<string, AbDest[] | null>>({})
  const [conns2, setConns2]           = React.useState<Record<string, AbConn[] | null>>({})
  const [jobs2, setJobs2]             = React.useState<Record<string, AbJob[] | null>>({})
  const [toast, setToast]             = React.useState<{msg:string;ok:boolean}|null>(null)
  const [showWizard, setShowWizard]   = React.useState(false)
  const [wizardStep, setWizardStep]   = React.useState<1|2>(1)
  const [wizardInst, setWizardInst]   = React.useState('')
  const [connDefs, setConnDefs]       = React.useState<any[]>([])
  const [defsLoading, setDefsLoading] = React.useState(false)
  const [selectedDef, setSelectedDef] = React.useState<any>(null)
  const [sourceSpec, setSourceSpec]   = React.useState<any>(null)
  const [specLoading, setSpecLoading] = React.useState(false)
  const [sourceConfig, setSourceConfig] = React.useState<Record<string,unknown>>({})
  const [sourceName, setSourceName]   = React.useState('')
  const [wizardSaving, setWizardSaving] = React.useState(false)
  const [defSearch, setDefSearch]     = React.useState('')
  // When browsing the catalog on Airbyte Cloud (which doesn't expose it), we show
  // this as an intentional edition boundary instead of an empty grid / raw 403.
  const [catalogNotice, setCatalogNotice] = React.useState('')

  const onCountChangeRef = React.useRef(onCountChange)
  React.useEffect(() => { onCountChangeRef.current = onCountChange }, [onCountChange])

  function showToast(msg: string, ok = true) { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500) }

  const loadInstances = useCallback(async () => {
    setLoading(true)
    try { const r = await fetch('/api/airbyte?action=list'); const d = await r.json(); const insts = d.instances || []; setInstances(insts); onCountChangeRef.current?.(insts.length) }
    catch { showToast('Failed to load connector engines', false) }
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
      loadInstances(); loadPipelines(id, true)
    } catch (e) { showToast((e as Error).message, false) }
    finally { setPingMap(p => { const n = {...p}; delete n[id]; return n }) }
  }

  async function loadPipelines(id: string, force = false) {
    if (pipelines[id] && !force) return
    setPipelinesLoading(p => ({ ...p, [id]: true }))
    setPipelines(p => ({ ...p, [id]: null }))
    try { const r = await fetch(`/api/airbyte?action=pipelines&id=${id}`); const d = await r.json(); setPipelines(p => ({ ...p, [id]: d.pipelines || [] })) }
    catch { setPipelines(p => ({ ...p, [id]: [] })) }
    finally { setPipelinesLoading(p => ({ ...p, [id]: false })) }
  }

  async function fetchTab(id: string, tab: string) {
    if (tab === 'sources' && !sources[id]) { setSources(p => ({ ...p, [id]: null })); const r = await fetch(`/api/airbyte?action=sources&id=${id}`); const d = await r.json(); setSources(p => ({ ...p, [id]: d.sources || [] })) }
    else if (tab === 'destinations' && !dests[id]) { setDests(p => ({ ...p, [id]: null })); const r = await fetch(`/api/airbyte?action=destinations&id=${id}`); const d = await r.json(); setDests(p => ({ ...p, [id]: d.destinations || [] })) }
    else if (tab === 'connections' && !conns2[id]) { setConns2(p => ({ ...p, [id]: null })); const r = await fetch(`/api/airbyte?action=connections&id=${id}`); const d = await r.json(); setConns2(p => ({ ...p, [id]: d.connections || [] })) }
    else if (tab === 'jobs' && !jobs2[id]) { setJobs2(p => ({ ...p, [id]: null })); const r = await fetch(`/api/airbyte?action=jobs&id=${id}`); const d = await r.json(); setJobs2(p => ({ ...p, [id]: d.jobs || [] })) }
  }

  function switchTab(id: string, tab: 'sources'|'connections'|'jobs'|'destinations') { setSubTab(p => ({ ...p, [id]: tab })); fetchTab(id, tab) }

  async function triggerSync(instanceId: string, connectionId: string) {
    setSyncing(connectionId)
    try {
      const r = await fetch('/api/airbyte', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: 'trigger_sync', instanceId, connectionId }) })
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      showToast(`Sync triggered${d.jobId ? ' · job #' + d.jobId : ''}`)
      setTimeout(() => loadPipelines(instanceId, true), 2000)
    } catch (e) { showToast((e as Error).message, false) }
    finally { setSyncing(null) }
  }

  async function cancelJob(instanceId: string, jobId: number | string) {
    setCancelling(String(jobId))
    try {
      const r = await fetch('/api/airbyte', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: 'cancel_job', instanceId, jobId }) })
      const d = await r.json(); if (d.error) throw new Error(d.error)
      showToast('Job cancelled'); setTimeout(() => loadPipelines(instanceId, true), 1000)
    } catch (e) { showToast((e as Error).message, false) }
    finally { setCancelling(null) }
  }

  async function deleteSource(instanceId: string, sourceId: string) {
    if (!confirm('Delete this source?')) return
    try {
      const r = await fetch('/api/airbyte', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: 'delete_source', instanceId, sourceId }) })
      const d = await r.json(); if (d.error) throw new Error(d.error)
      showToast('Source deleted'); setSources(p => ({ ...p, [instanceId]: null })); loadPipelines(instanceId, true)
    } catch (e) { showToast((e as Error).message, false) }
  }

  async function saveInstance() {
    setSaving(true)
    try {
      const r = await fetch('/api/airbyte', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: editing ? 'update_instance' : 'create_instance', id: editing, ...form }) })
      const d = await r.json(); if (d.error) throw new Error(d.error)
      setShowForm(false); setEditing(null); setForm(AB_EMPTY); loadInstances()
      showToast(editing ? 'Engine updated' : 'Connector engine connected')
    } catch (e) { showToast((e as Error).message, false) }
    finally { setSaving(false) }
  }

  async function deleteInstance(id: string) {
    if (!confirm('Disconnect this connector engine?')) return
    await fetch('/api/airbyte', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: 'delete_instance', id }) })
    loadInstances()
  }

  function openEdit(inst: AbInstance) { setForm({ label: inst.label, url: inst.url, username: inst.username, password: '', client_id: '', client_secret: '' }); setEditing(inst.id); setShowForm(true) }

  // When the wizard is opened from the "Browse" catalogue, the chosen connector's name is passed so
  // we can skip the duplicate "choose connector" step: after the live catalogue loads, if exactly
  // one definition matches the name we jump straight to Configure (step 2); otherwise we pre-fill
  // the search so the admin never retypes. We never guess a definition — only an exact name match
  // auto-advances, so a catalogue that differs from the static Browse list can't misfire.
  const normName = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  async function openWizard(instId: string, targetName?: string) {
    setWizardInst(instId); setWizardStep(1); setSelectedDef(null)
    setSourceSpec(null); setSourceConfig({}); setSourceName(''); setDefSearch('')
    setCatalogNotice(''); setShowWizard(true); setDefsLoading(true)
    try {
      const r = await fetch(`/api/airbyte?action=source_definitions&id=${instId}`)
      const d = await r.json()
      // Airbyte Cloud doesn't expose the catalog — show it as an intentional
      // edition boundary, not a failure.
      if (d.error === 'catalog_unavailable_on_cloud' || d.cloud) {
        setCatalogNotice(d.message || 'The connector catalog is available on the self-hosted engine only.')
        setConnDefs([])
      } else if (d.error) {
        // Real backend failure — surface it rather than a silent, misleading "No connectors found".
        setConnDefs([])
        showToast(`Couldn't load connectors: ${d.error}`, false)
      } else {
        const defs = d.definitions || []
        setConnDefs(defs)
        if (targetName) {
          const matches = defs.filter((x: any) => normName(x.name) === normName(targetName))
          if (matches.length === 1) { setDefsLoading(false); await selectDef(matches[0], instId); return }
          setDefSearch(targetName)   // 0 or >1 matches: pre-fill the search, stay on step 1
        }
      }
    }
    catch { showToast('Failed to load connectors', false) }
    finally { setDefsLoading(false) }
  }

  async function selectDef(def: any, instId?: string) {
    const inst = instId || wizardInst
    setSelectedDef(def); setWizardStep(2); setSpecLoading(true); setSourceName(def.name || '')
    try {
      const r = await fetch(`/api/airbyte?action=source_spec&id=${inst}&definitionId=${def.sourceDefinitionId || def.id}`)
      const d = await r.json(); setSourceSpec(d.spec)
      // seedConfig walks the schema for defaults, const values, and oneOf
      // discriminators — producing the nested shape Airbyte expects.
      setSourceConfig(d.spec ? seedConfig(d.spec as Schema) : {})
    } catch { showToast('Failed to load connector spec', false) }
    finally { setSpecLoading(false) }
  }

  // Deep-link from the Browse catalogue: remember the picked connector, then open the wizard for it
  // as soon as a ready engine (with a workspace) is available.
  const pendingConnRef = React.useRef<string | null>(null)
  React.useEffect(() => { if (openConnector?.name) pendingConnRef.current = openConnector.name }, [openConnector?.nonce])
  React.useEffect(() => {
    if (!pendingConnRef.current || !isAdmin || showWizard) return
    const ready = instances.find(i => i.workspace_id)
    if (!ready) return
    const name = pendingConnRef.current; pendingConnRef.current = null
    openWizard(ready.id, name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances, openConnector?.nonce])

  async function createSource() {
    setWizardSaving(true)
    try {
      // sourceConfig is already correctly typed and nested by the SpecFields
      // renderer (numbers/booleans/objects/arrays as the schema requires), so
      // it is passed straight through — no flat re-typing pass.
      const cleanEmpty = (o: unknown): unknown => {
        if (Array.isArray(o)) return o.map(cleanEmpty)
        if (o && typeof o === 'object') {
          const r: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
            if (v === '' || v === undefined) continue
            r[k] = cleanEmpty(v)
          }
          return r
        }
        return o
      }
      const config = cleanEmpty(sourceConfig) as Record<string, unknown>
      const instData = instances.find(i => i.id === wizardInst)
      if (!instData?.workspace_id) throw new Error('Workspace not discovered. Click "Discover WS" first.')
      const r = await fetch('/api/airbyte', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: 'create_source', instanceId: wizardInst, workspaceId: instData.workspace_id, name: sourceName || selectedDef?.name, definitionId: selectedDef?.sourceDefinitionId || selectedDef?.id, config }) })
      const d = await r.json(); if (d.error) throw new Error(d.error)
      showToast(`Source "${sourceName}" created`); setShowWizard(false)
      setSources(p => ({ ...p, [wizardInst]: null })); loadPipelines(wizardInst, true)
    } catch (e) { showToast((e as Error).message, false) }
    finally { setWizardSaving(false) }
  }

  function fmtRelTime(ts: string | number | null): string {
    if (!ts) return 'Never'
    const ms = typeof ts === 'number' ? (ts > 1e12 ? ts : ts * 1000) : new Date(ts).getTime()
    const diff = Date.now() - ms
    if (diff < 60000) return 'Just now'
    if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`
    return `${Math.floor(diff/86400000)}d ago`
  }

  function normaliseJob(j: AbJob) { return (j as any).job || j }

  const filteredDefs = connDefs.filter(d => !defSearch || (d.name || '').toLowerCase().includes(defSearch.toLowerCase()))

  return (
    <div>
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, padding: '10px 18px', borderRadius: 10, background: toast.ok ? 'var(--green-bg)' : 'var(--red-bg)', border: `1px solid ${toast.ok ? 'color-mix(in srgb, var(--green-t) 35%, transparent)' : 'color-mix(in srgb, var(--red-t) 35%, transparent)'}`, color: toast.ok ? 'var(--green-t)' : 'var(--red-t)', fontSize: 13, fontWeight: 500, boxShadow: '0 4px 20px rgba(0,0,0,.12)' }}>
          {toast.msg}
        </div>
      )}

      {loading && <div style={{ padding: '20px 0', color: 'var(--text3)', fontSize: 13 }}>Loading…</div>}

      {!loading && instances.length === 0 && (
        <div style={{ padding: '28px 20px', background: 'var(--bg3)', borderRadius: 10, textAlign: 'center', fontSize: 13, color: 'var(--text3)', marginTop: 12 }}>
          No connector engine connected. Start it with <code style={{ background: 'var(--bg4)', padding: '1px 5px', borderRadius: 4, fontFamily: 'var(--font-mono)' }}>docker compose up -d</code> then click "+ Connect engine" above.
        </div>
      )}

      {instances.map(inst => {
        const isExp  = expanded === inst.id
        const ps     = pingMap[inst.id]
        const pipes  = pipelines[inst.id]
        const isAdv  = showAdvanced[inst.id]
        const curTab = subTab[inst.id] || 'sources'

        return (
          <div key={inst.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 12, overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
            <div style={{ padding: '13px 18px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ width: 34, height: 34, borderRadius: 8, background: 'linear-gradient(135deg, var(--accent-fg), color-mix(in srgb, var(--accent-fg) 55%, var(--surface)))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 22 22" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round"><polygon points="11,2 14,8 20,9 16,14 17,20 11,17 5,20 6,14 2,9 8,8"/></svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{displayEngineLabel(inst.label)}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {inst.url}{inst.workspace_id ? ` · ws:${inst.workspace_id.slice(0,8)}` : ''}
                </div>
              </div>
              {ps && ps !== 'loading' && <span style={{ fontSize: 11, color: (ps as any).ok ? 'var(--green-t)' : 'var(--red-t)', fontWeight: 500 }}>{(ps as any).msg}</span>}
              {ps === 'loading' && <Spinner size={12} />}
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', flexShrink: 0 }}>
                <Btn size="sm" onClick={() => ping(inst.id)} disabled={ps === 'loading'}>Test</Btn>
                {!inst.workspace_id && <Btn size="sm" onClick={() => discoverWs(inst.id)}>Discover WS</Btn>}
                {isAdmin && inst.workspace_id && <Btn size="sm" onClick={() => openWizard(inst.id)}>+ Add source</Btn>}
                <Btn size="sm" onClick={() => { if (expanded === inst.id) { setExpanded(null) } else { setExpanded(inst.id); loadPipelines(inst.id) } }}>{isExp ? '↑ Hide' : '↓ Pipelines'}</Btn>
                {isAdmin && <Btn size="sm" onClick={() => openEdit(inst)}>Edit</Btn>}
                {isAdmin && <Btn size="sm" variant="danger" onClick={() => deleteInstance(inst.id)}>Delete</Btn>}
              </div>
            </div>

            {isAdmin && inst.workspace_id && <CustomConnectorsList instanceId={inst.id} isCloud={/(^|\.)airbyte\.com/i.test(inst.url)} />}

            {isAdmin && <WorkspaceSelector instanceId={inst.id} onChange={() => { loadPipelines(inst.id); if (expanded === inst.id) loadPipelines(inst.id) }} />}

            {isExp && (
              <div style={{ borderTop: '1px solid var(--border)' }}>
                {pipelinesLoading[inst.id] && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}><Spinner size={14} /> Loading pipelines…</div>}

                {pipes && pipes.length === 0 && (
                  <div style={{ padding: '24px 18px', textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>
                    No pipelines configured yet.
                    {isAdmin && inst.workspace_id && <> Click <strong>+ Add source</strong> to create your first pipeline.</>}
                    {!inst.workspace_id && <> Click <strong>Discover WS</strong> first.</>}
                  </div>
                )}

                {pipes && pipes.length > 0 && (
                  <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {pipes.map((p: any) => {
                      const lastJob   = p.lastJob
                      const isRunning = lastJob?.status?.toLowerCase() === 'running'
                      const isSyncing = syncing === p.connectionId
                      const schedLabel = p.schedule?.scheduleType === 'cron' ? p.schedule.cronExpression
                        : p.schedule?.scheduleType === 'basic' ? `Every ${p.schedule.basicSchedule?.units} ${p.schedule.basicSchedule?.timeUnit}`
                        : 'Manual'
                      return (
                        <div key={p.connectionId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 140 }}>
                            <AbIcon name={p.sourceType || p.sourceName} size={28} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.sourceName || p.name}</div>
                              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{p.sourceType}</div>
                            </div>
                          </div>
                          <div style={{ color: 'var(--text4)', fontSize: 13, flexShrink: 0 }}>→</div>
                          <div style={{ flex: 1, minWidth: 100 }}>
                            <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.destinationName}</div>
                            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{p.destinationType}</div>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap', textAlign: 'right', minWidth: 90 }}>
                            <div>{fmtRelTime(lastJob?.createdAt ?? null)}</div>
                            {lastJob?.recordsSynced != null && <div style={{ color: 'var(--text4)' }}>{lastJob.recordsSynced.toLocaleString()} rec</div>}
                            <div style={{ fontSize: 10, color: 'var(--text4)' }}>{schedLabel}</div>
                          </div>
                          <AbStatusBadge status={lastJob?.status || p.status} />
                          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                            <Btn size="sm" onClick={() => triggerSync(inst.id, p.connectionId)} disabled={isSyncing || isRunning}>{isSyncing ? <Spinner size={10} /> : 'Sync'}</Btn>
                            {isRunning && isAdmin && <Btn size="sm" variant="danger" onClick={() => cancelJob(inst.id, lastJob.id)} disabled={cancelling === String(lastJob.id)}>{cancelling === String(lastJob.id) ? <Spinner size={10} /> : 'Stop'}</Btn>}
                          </div>
                        </div>
                      )
                    })}
                    <button onClick={() => loadPipelines(inst.id, true)} style={{ alignSelf: 'flex-end', fontSize: 11, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>↻ Refresh</button>
                  </div>
                )}

                {!pipelinesLoading[inst.id] && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '8px 16px' }}>
                    <button onClick={() => setShowAdvanced(p => ({ ...p, [inst.id]: !p[inst.id] }))} style={{ fontSize: 11, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit' }}>
                      {isAdv ? '▾' : '▸'} Advanced view
                    </button>
                    {isAdv && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ display: 'flex', gap: 4, marginBottom: 8, overflowX: 'auto' }}>
                          {(['sources','destinations','connections','jobs'] as const).map(t => (
                            <button key={t} onClick={() => switchTab(inst.id, t)} style={{ padding: '3px 12px', borderRadius: 999, border: 'none', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', fontWeight: curTab === t ? 600 : 400, background: curTab === t ? 'var(--accent-bg)' : 'transparent', color: curTab === t ? 'var(--accent-fg)' : 'var(--text3)', whiteSpace: 'nowrap' }}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
                          ))}
                        </div>
                        {curTab === 'sources' && (
                          <div>
                            {sources[inst.id] === null && <div style={{ padding: 16, color: 'var(--text3)', fontSize: 12 }}><Spinner size={11} /> Loading…</div>}
                            {sources[inst.id]?.length === 0 && <div style={{ padding: 16, color: 'var(--text3)', fontSize: 12 }}>No sources.</div>}
                            {sources[inst.id] && sources[inst.id]!.length > 0 && (
                              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead><tr>{['Source','Type',''].map(h => <th key={h} style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text4)', padding: '6px 12px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>{h}</th>)}</tr></thead>
                                <tbody>{sources[inst.id]!.map((s, i) => (
                                  <tr key={s.sourceId || s.id || i}>
                                    <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><AbIcon name={s.sourceName || s.sourceType || s.name} size={20} /><div style={{ fontSize: 12, fontWeight: 500 }}>{s.name}</div></div></td>
                                    <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)' }}>{s.sourceName || s.sourceType || '—'}</td>
                                    <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>{isAdmin && <Btn size="sm" variant="danger" onClick={() => deleteSource(inst.id, s.sourceId || s.id || '')}>Delete</Btn>}</td>
                                  </tr>
                                ))}</tbody>
                              </table>
                            )}
                          </div>
                        )}
                        {curTab === 'destinations' && (
                          <div>
                            {dests[inst.id] === null && <div style={{ padding: 16, color: 'var(--text3)', fontSize: 12 }}><Spinner size={11} /> Loading…</div>}
                            {dests[inst.id]?.length === 0 && <div style={{ padding: 16, color: 'var(--text3)', fontSize: 12 }}>No destinations.</div>}
                            {dests[inst.id] && dests[inst.id]!.length > 0 && (
                              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead><tr>{['Name','Type'].map(h => <th key={h} style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text4)', padding: '6px 12px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>{h}</th>)}</tr></thead>
                                <tbody>{dests[inst.id]!.map((d, i) => (
                                  <tr key={d.destinationId || d.id || i}>
                                    <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 500 }}>{d.name}</td>
                                    <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)' }}>{d.destinationType || d.destinationName || '—'}</td>
                                  </tr>
                                ))}</tbody>
                              </table>
                            )}
                          </div>
                        )}
                        {curTab === 'connections' && (
                          <div>
                            {conns2[inst.id] === null && <div style={{ padding: 16, color: 'var(--text3)', fontSize: 12 }}><Spinner size={11} /> Loading…</div>}
                            {conns2[inst.id]?.length === 0 && <div style={{ padding: 16, color: 'var(--text3)', fontSize: 12 }}>No connections.</div>}
                            {conns2[inst.id] && conns2[inst.id]!.length > 0 && (
                              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead><tr>{['Connection','Schedule','Status',''].map(h => <th key={h} style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text4)', padding: '6px 12px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>{h}</th>)}</tr></thead>
                                <tbody>{conns2[inst.id]!.map((c, i) => {
                                  const cid = c.connectionId || c.id || ''
                                  return (
                                    <tr key={cid || i}>
                                      <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 500 }}>{c.name}</td>
                                      <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{(c.schedule as any)?.scheduleType || 'manual'}</td>
                                      <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}><AbStatusBadge status={c.status} /></td>
                                      <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>{isAdmin && <Btn size="sm" onClick={() => triggerSync(inst.id, cid)} disabled={syncing === cid}>{syncing === cid ? <Spinner size={10} /> : 'Sync'}</Btn>}</td>
                                    </tr>
                                  )
                                })}</tbody>
                              </table>
                            )}
                          </div>
                        )}
                        {curTab === 'jobs' && (
                          <div>
                            {jobs2[inst.id] === null && <div style={{ padding: 16, color: 'var(--text3)', fontSize: 12 }}><Spinner size={11} /> Loading…</div>}
                            {jobs2[inst.id]?.length === 0 && <div style={{ padding: 16, color: 'var(--text3)', fontSize: 12 }}>No recent jobs.</div>}
                            {jobs2[inst.id] && jobs2[inst.id]!.map((j, i) => {
                              const jj = normaliseJob(j) as any
                              const createdMs = (jj.createdAt||0) > 1e12 ? jj.createdAt : (jj.createdAt||0)*1000
                              const durSec = jj.updatedAt && jj.createdAt ? Math.round(((jj.updatedAt>1e12?jj.updatedAt:jj.updatedAt*1000)-createdMs)/1000) : null
                              const isRunning = (jj.status||'').toLowerCase() === 'running'
                              return (
                                <div key={jj.id || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 12, fontWeight: 500 }}>Job #{jj.id}</div>
                                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{createdMs ? new Date(createdMs).toLocaleString() : '—'}{durSec !== null ? ` · ${durSec >= 60 ? Math.floor(durSec/60)+'m '+durSec%60+'s' : durSec+'s'}` : ''}</div>
                                  </div>
                                  <AbStatusBadge status={jj.status} />
                                  {isAdmin && isRunning && <Btn size="sm" variant="danger" onClick={() => cancelJob(inst.id, jj.id)} disabled={cancelling === String(jj.id)}>{cancelling === String(jj.id) ? <Spinner size={10}/> : 'Cancel'}</Btn>}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {showWizard && (
        <div onClick={e => { if (e.target === e.currentTarget) setShowWizard(false) }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 14, width: 540, maxWidth: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Add data source</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Step {wizardStep} of 2 — {wizardStep === 1 ? 'Choose connector' : 'Configure source'}</div>
              </div>
              <button onClick={() => setShowWizard(false)} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--bg)', fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>

            {wizardStep === 1 && (
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 16 }}>
                <input placeholder="Search 300+ connectors..." value={defSearch} onChange={e => setDefSearch(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', border: '1.5px solid var(--border2)', borderRadius: 8, fontSize: 13, background: 'var(--bg)', color: 'var(--text)', fontFamily: 'inherit', outline: 'none', marginBottom: 12, boxSizing: 'border-box' }} autoFocus />
                {defsLoading && <div style={{ textAlign: 'center', padding: 24, color: 'var(--text3)' }}><Spinner size={16} /> Loading connectors…</div>}
                {!defsLoading && catalogNotice && (
                  <div style={{ padding: '18px 20px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M18 10h-1V7A5 5 0 0 0 7 7v3H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z"/></svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', marginBottom: 5 }}>Connector catalog is self-hosted only</div>
                      <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.6 }}>{catalogNotice}</div>
                    </div>
                  </div>
                )}
                {!defsLoading && !catalogNotice && (
                  <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {filteredDefs.map(def => (
                      <button key={def.sourceDefinitionId || def.id} onClick={() => selectDef(def)}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1.5px solid var(--border)', borderRadius: 8, background: 'var(--bg)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', transition: 'border-color .15s' }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--blue)')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}>
                        <AbIcon name={def.name} size={24} />
                        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{def.name}</span>
                      </button>
                    ))}
                    {filteredDefs.length === 0 && <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 24, color: 'var(--text3)', fontSize: 13 }}>No connectors found</div>}
                  </div>
                )}
              </div>
            )}

            {wizardStep === 2 && (
              <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
                {specLoading && <div style={{ textAlign: 'center', padding: 24, color: 'var(--text3)' }}><Spinner size={16} /> Loading spec…</div>}
                {!specLoading && sourceSpec && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                      <AbIcon name={selectedDef?.name} size={32} />
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{selectedDef?.name}</div>
                    </div>
                    <div style={{ marginBottom: 16 }}>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 5 }}>Source name *</label>
                      <input value={sourceName} onChange={e => setSourceName(e.target.value)} placeholder={`My ${selectedDef?.name}`}
                        style={{ width: '100%', padding: '8px 11px', border: '1.5px solid var(--border2)', borderRadius: 8, fontSize: 13, background: 'var(--bg)', color: 'var(--text)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <ObjectFields
                      schema={sourceSpec as Schema}
                      value={sourceConfig as Record<string, unknown>}
                      onChange={(v) => setSourceConfig(v)}
                    />
                  </>
                )}
              </div>
            )}

            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
              <Btn onClick={() => { if (wizardStep === 2) setWizardStep(1); else setShowWizard(false) }}>{wizardStep === 1 ? 'Cancel' : '← Back'}</Btn>
              {wizardStep === 2 && <Btn onClick={createSource} disabled={wizardSaving || !sourceName}>{wizardSaving ? <><Spinner size={11} /> Creating…</> : 'Create source'}</Btn>}
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div onClick={e => { if (e.target === e.currentTarget) { setShowForm(false); setEditing(null); setForm(AB_EMPTY) } }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 14, padding: 28, width: 420, maxWidth: '100%', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{editing ? 'Edit connector engine' : 'Connect connector engine'}</div>
              <button onClick={() => { setShowForm(false); setEditing(null); setForm(AB_EMPTY) }} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--bg)', fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>
            <div style={{ padding: '8px 12px', background: 'var(--green-bg)', borderRadius: 8, fontSize: 12, color: 'var(--green-t)', lineHeight: 1.5, marginBottom: 16, border: '1px solid color-mix(in srgb, var(--green-t) 35%, transparent)' }}>
              <strong>Docker (recommended)</strong> — use Username: <code style={{fontFamily:'var(--font-mono)'}}>airbyte</code> / Password: <code style={{fontFamily:'var(--font-mono)'}}>password</code><br/>
              <strong>Kubernetes</strong> — use the email + password from your engine&apos;s local credentials, plus Client ID &amp; Secret below.<br/>
              <strong>Hosted engine</strong> — enter the engine URL plus the Client ID &amp; Secret from its application settings. Standard 300+ connectors; AI custom connectors are Enterprise (self-hosted) only.
            </div>
            {([
              { key: 'label',         label: 'Label',            ph: 'Connector engine',           type: 'text',     hint: '' },
              { key: 'url',           label: 'Engine URL',       ph: 'http://localhost:8000',      type: 'text',     hint: 'Self-hosted: http://localhost:8000 · Hosted engine: enter its API URL plus the application client ID & secret', req: true },
              { key: 'username',      label: 'Email / Username', ph: 'airbyte or your@email.com', type: 'text',     hint: '' },
              { key: 'password',      label: 'Password',         ph: editing ? '(unchanged)' : 'password', type: 'password', hint: editing ? 'Leave blank to keep existing' : '' },
              { key: 'client_id',     label: 'Client ID',        ph: 'abctl only',                 type: 'text',     hint: 'OAuth2 client ID for abctl deployments' },
              { key: 'client_secret', label: 'Client Secret',    ph: editing ? '(unchanged)' : 'abctl only', type: 'password', hint: editing ? 'Leave blank to keep existing' : 'OAuth2 client secret' },
            ] as const).map(f => (
              <div key={f.key} style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 5 }}>{f.label}{(f as any).req && <span style={{ color: 'var(--red-t)' }}> *</span>}</label>
                <input type={f.type} value={form[f.key as keyof typeof form]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.ph}
                  style={{ width: '100%', padding: '8px 11px', border: '1.5px solid var(--border2)', borderRadius: 8, fontSize: 13, background: 'var(--bg)', color: 'var(--text)', fontFamily: 'inherit', outline: 'none' }} />
                {f.hint && <div style={{ fontSize: 11, color: 'var(--text4)', marginTop: 3 }}>{f.hint}</div>}
              </div>
            ))}
            <div style={{ padding: '10px 12px', background: 'var(--blue-bg)', borderRadius: 8, fontSize: 12, color: 'var(--blue-t)', lineHeight: 1.6, marginBottom: 20 }}>
              Run <code style={{ fontFamily: 'var(--font-mono)', background: 'rgba(37,99,235,.12)', padding: '1px 5px', borderRadius: 4 }}>docker compose up -d</code> in your connector-engine directory.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Btn onClick={() => { setShowForm(false); setEditing(null); setForm(AB_EMPTY) }}>Cancel</Btn>
              <Btn onClick={saveInstance} disabled={saving}>{saving ? <Spinner size={12} /> : (editing ? 'Save changes' : 'Connect')}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── WorkspaceSelector ────────────────────────────────────────
// An Airbyte account can hold several workspaces; Mosaic reads sources/connections
// from ONE. This shows which workspace is active and lets the user switch — so
// they never create sources in a workspace Mosaic isn't looking at. Renders only
// when there are 2+ workspaces (single-workspace accounts see nothing).
function WorkspaceSelector({ instanceId, onChange }: { instanceId: string; onChange?: () => void }) {
  const [workspaces, setWorkspaces] = React.useState<{ id: string; name: string; active: boolean }[]>([])
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const r = await fetch(`/api/airbyte?action=workspaces&id=${instanceId}`)
      const d = await r.json()
      if (Array.isArray(d.workspaces)) setWorkspaces(d.workspaces)
    } catch { /* silent — selector just won't show */ }
  }, [instanceId])
  React.useEffect(() => { load() }, [load])

  if (workspaces.length < 2) return null // nothing to choose
  const active = workspaces.find(w => w.active) || workspaces[0]

  async function pick(wsId: string) {
    if (wsId === active.id) return
    setSaving(true)
    try {
      await fetch('/api/airbyte', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set_workspace', id: instanceId, workspace_id: wsId }) })
      await load()
      onChange?.()
    } finally { setSaving(false) }
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Workspace</span>
      <select
        value={active.id}
        onChange={e => pick(e.target.value)}
        disabled={saving}
        style={{ fontSize: 12.5, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'inherit', cursor: 'pointer', maxWidth: 320 }}
      >
        {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      <span style={{ fontSize: 11, color: 'var(--text4)' }}>
        {saving ? 'Switching…' : `Mosaic reads sources & connections from this workspace (${workspaces.length} available)`}
      </span>
    </div>
  )
}

// ── CustomConnectorsList ─────────────────────────────────────
// Published (Airbyte custom source definitions) + drafts (builder projects),
// unified. Airbyte is the source of truth; delete removes from Airbyte.
interface CustomConnectorItem { id: string; name: string; status: 'published' | 'draft' }

function CustomConnectorsList({ instanceId, isCloud }: { instanceId: string; isCloud?: boolean }) {
  const [items, setItems] = React.useState<CustomConnectorItem[] | null>(null)
  const [err, setErr] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [page, setPage] = React.useState(1)
  const [sync, setSync] = React.useState<CustomConnectorItem | null>(null)
  const PAGE_SIZE = 5

  const load = React.useCallback(async () => {
    setErr(null)
    // Airbyte Cloud has no connector-builder endpoints (custom connectors are a
    // self-hosted capability). Don't call the API and don't show a red error —
    // just render nothing, so the card stays clean. The Enterprise note above the
    // instance already explains custom connectors are self-hosted only.
    if (isCloud) { setItems([]); return }
    try {
      const res = await fetch('/api/connectors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list_connectors', instanceId }) })
      const { data } = await safeJson<{ ok?: boolean; connectors?: CustomConnectorItem[]; error?: string }>(res)
      if (!res.ok || !data?.ok) { setErr(data?.error || 'Could not load connectors'); setItems([]); return }
      setItems(data.connectors || [])
    } catch { setErr('Could not load connectors'); setItems([]) }
  }, [instanceId, isCloud])

  React.useEffect(() => { load() }, [load])

  async function remove(item: CustomConnectorItem) {
    if (!confirm(`Delete "${item.name}"? This removes the ${item.status} connector.`)) return
    setBusy(item.id)
    const action = item.status === 'published' ? 'delete_source_definition' : 'delete_project'
    const key = item.status === 'published' ? 'sourceDefinitionId' : 'projectId'
    try {
      const res = await fetch('/api/connectors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, [key]: item.id, instanceId }) })
      const { data } = await safeJson<{ ok?: boolean; error?: string }>(res)
      if (!res.ok || !data?.ok) { setErr(data?.error || 'Delete failed'); setBusy(null); return }
      await load()
    } catch { setErr('Delete failed') }
    setBusy(null)
  }

  if (items === null) return <div style={{ padding: '10px 18px', fontSize: 12, color: 'var(--text4)', borderTop: '1px solid var(--border)' }}>Loading custom connectors…</div>
  if (items.length === 0 && !err) return null // nothing built yet — keep the card clean

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageItems = items.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const th: React.CSSProperties = { textAlign: 'left', fontSize: 10, fontWeight: 600, color: 'var(--text4)', textTransform: 'uppercase', letterSpacing: '.05em', padding: '6px 10px' }
  const td: React.CSSProperties = { fontSize: 13, color: 'var(--text)', padding: '8px 10px', borderTop: '1px solid var(--border)' }

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px 14px' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Custom connectors</div>
      {err && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{err}</div>}
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={th}>Name</th>
            <th style={{ ...th, width: 110 }}>Status</th>
            <th style={{ ...th, width: 190, textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {pageItems.map(item => (
            <tr key={item.id}>
              <td style={{ ...td, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</td>
              <td style={td}>
                <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', padding: '2px 8px', borderRadius: 999,
                  background: item.status === 'published' ? 'var(--green-bg)' : 'var(--amber-t)',
                  color: item.status === 'published' ? 'var(--green)' : 'var(--text2)' }}>
                  {item.status}
                </span>
              </td>
              <td style={{ ...td, textAlign: 'right' }}>
                <div style={{ display: 'inline-flex', gap: 12, alignItems: 'center' }}>
                  {item.status === 'published' && <button onClick={() => setSync(item)} style={{ fontSize: 12, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>Set up sync</button>}
                  {item.status === 'draft' && <a href="/connectors" style={{ fontSize: 12, color: 'var(--blue)', textDecoration: 'none' }}>Resume</a>}
                  <button onClick={() => remove(item)} disabled={busy === item.id}
                    style={{ fontSize: 12, color: 'var(--red)', background: 'none', border: 'none', cursor: busy === item.id ? 'default' : 'pointer', padding: 0, opacity: busy === item.id ? 0.5 : 1, fontFamily: 'inherit' }}>
                    {busy === item.id ? '…' : 'Delete'}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--text4)' }}>Page {safePage} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
            style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: safePage === 1 ? 'not-allowed' : 'pointer', color: 'var(--text3)', fontSize: 12, opacity: safePage === 1 ? 0.5 : 1 }}>&larr;</button>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
            style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: safePage === totalPages ? 'not-allowed' : 'pointer', color: 'var(--text3)', fontSize: 12, opacity: safePage === totalPages ? 0.5 : 1 }}>&rarr;</button>
        </div>
      )}
      {sync && <SetUpSyncModal connector={sync} instanceId={instanceId} onClose={() => setSync(null)} onDone={() => { setSync(null); load() }} />}
    </div>
  )
}

// Walks a published connector all the way to queryable data: pick a destination ->
// create a source -> build the pipeline (connection + first sync) -> optionally
// register the landed destination as a Mosaic connection. The destination is
// chosen by the operator from those configured in Airbyte (not hardcoded); it and
// its credentials are Airbyte's domain.
interface AbDestination { destinationId?: string; id?: string; name?: string; destinationName?: string; destinationType?: string }

function SetUpSyncModal({ connector, instanceId, onClose, onDone }: { connector: CustomConnectorItem; instanceId: string; onClose: () => void; onDone: () => void }) {
  const [phase, setPhase] = React.useState<'loading' | 'pick' | 'building' | 'built' | 'registering' | 'done'>('loading')
  const [err, setErr] = React.useState<string | null>(null)
  const [password, setPassword] = React.useState('')
  const [info, setInfo] = React.useState<{ jobId?: string; streamCount?: number } | null>(null)
  const [destinations, setDestinations] = React.useState<AbDestination[]>([])
  const [destId, setDestId] = React.useState<string>('')
  const [workspaceId, setWorkspaceId] = React.useState<string>('')

  const destName = (d: AbDestination) => d.name || d.destinationName || d.destinationType || (d.destinationId || d.id || '').slice(0, 8)

  // Load the workspace + available destinations up front so the operator picks one.
  React.useEffect(() => {
    (async () => {
      try {
        const instRes = await fetch('/api/airbyte?action=list')
        const instJson = await instRes.json()
        const inst = (instJson.instances || []).find((i: { id: string; workspace_id?: string }) => i.id === instanceId)
        if (!inst?.workspace_id) { setErr('Connector engine workspace not discovered yet.'); setPhase('pick'); return }
        setWorkspaceId(inst.workspace_id)
        const destRes = await fetch(`/api/airbyte?action=destinations&id=${instanceId}`)
        const destJson = await destRes.json()
        const dests: AbDestination[] = destJson.destinations || destJson.data || []
        setDestinations(dests)
        if (dests.length) setDestId(dests[0].destinationId || dests[0].id || '')
        setPhase('pick')
      } catch (e) { setErr((e as Error).message); setPhase('pick') }
    })()
  }, [instanceId])

  async function run() {
    if (!destId) { setErr('Choose a destination first.'); return }
    setErr(null); setPhase('building')
    try {
      const csRes = await fetch('/api/airbyte', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create_source', instanceId, workspaceId, name: `${connector.name} source`, definitionId: connector.id, config: {} }) })
      const cs = await csRes.json()
      if (cs.error || !cs.sourceId) { setErr(cs.error || 'Could not create source'); setPhase('pick'); return }
      const bpRes = await fetch('/api/airbyte', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'build_pipeline', instanceId, sourceId: cs.sourceId, destinationId: destId, name: `${connector.name} pipeline` }) })
      const bp = await bpRes.json()
      if (!bp.ok) { setErr(bp.error || 'Could not build the pipeline'); setPhase('pick'); return }
      setInfo({ jobId: bp.jobId, streamCount: bp.streamCount }); setPhase('built')
    } catch (e) { setErr((e as Error).message); setPhase('pick') }
  }

  async function register() {
    setErr(null); setPhase('registering')
    try {
      const res = await fetch('/api/connectors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'register_connection', destinationId: destId, password, label: `${connector.name} (landed)`, instanceId }) })
      const { data } = await safeJson<{ ok?: boolean; error?: string }>(res)
      if (!res.ok || !data?.ok) { setErr(data?.error || 'Registration failed'); setPhase('built'); return }
      setPhase('done')
    } catch (e) { setErr((e as Error).message); setPhase('built') }
  }

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }
  const modal: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '22px 24px', width: 480, maxWidth: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,.2)' }
  const btnP: React.CSSProperties = { height: 36, padding: '0 16px', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', background: 'var(--blue)', color: '#fff', border: 'none', cursor: 'pointer' }
  const btnG: React.CSSProperties = { height: 36, padding: '0 16px', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', background: 'var(--bg)', color: 'var(--text2)', border: '1px solid var(--border2)', cursor: 'pointer' }
  const field: React.CSSProperties = { width: '100%', height: 36, background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 13, padding: '0 12px', outline: 'none', boxSizing: 'border-box' }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Set up sync — {connector.name}</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5, marginBottom: 16 }}>
          Mosaic will create a source from this connector and sync its data into the destination you choose, then optionally register it as a queryable connection.
        </div>
        {err && <div style={{ fontSize: 12, color: 'var(--red)', background: 'var(--red-t)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', marginBottom: 12 }}>{err}</div>}

        {phase === 'loading' && <div style={{ fontSize: 13, color: 'var(--text3)' }}>Loading destinations…</div>}

        {phase === 'pick' && (
          <div>
            {destinations.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5, marginBottom: 14 }}>
                No destinations are configured yet. Add a destination (Postgres, Snowflake, BigQuery, etc.) in the connector engine, then come back to set up the sync.
              </div>
            ) : (
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text2)', marginBottom: 6 }}>Sync into destination</label>
                <select value={destId} onChange={e => setDestId(e.target.value)} style={{ ...field, cursor: 'pointer' }}>
                  {destinations.map(d => { const id = d.destinationId || d.id || ''; return <option key={id} value={id}>{destName(d)}</option> })}
                </select>
                <div style={{ fontSize: 11, color: 'var(--text4)', marginTop: 6 }}>Destinations are managed in the connector engine.</div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={btnG}>Cancel</button>
              {destinations.length > 0 && <button onClick={run} disabled={!destId} style={{ ...btnP, opacity: destId ? 1 : 0.5 }}>Start sync</button>}
            </div>
          </div>
        )}

        {phase === 'building' && <div style={{ fontSize: 13, color: 'var(--text3)' }}>Creating the source and starting the first sync… this can take up to a minute.</div>}

        {(phase === 'built' || phase === 'registering') && (
          <div>
            <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 12 }}>
              Sync started{info?.streamCount ? ` (${info.streamCount} stream${info.streamCount === 1 ? '' : 's'})` : ''}. To query the landed data from Mosaic, register the destination as a connection — enter its database password (the connector engine doesn&rsquo;t expose it).
            </div>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Destination database password" style={{ ...field, marginBottom: 12 }} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onDone} style={btnG}>Skip for now</button>
              <button onClick={register} disabled={!password || phase === 'registering'} style={{ ...btnP, opacity: (!password || phase === 'registering') ? 0.5 : 1 }}>{phase === 'registering' ? 'Registering…' : 'Register connection'}</button>
            </div>
          </div>
        )}

        {phase === 'done' && (
          <div>
            <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 16 }}>
              Done. The landed data is now a Mosaic connection you can query in chat, dashboards, and reports. The first sync may take a moment to finish populating.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button onClick={onDone} style={btnP}>Close</button></div>
          </div>
        )}
      </div>
    </div>
  )
}

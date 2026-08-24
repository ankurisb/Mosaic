'use client'
import AppShell from '@/components/AppShell'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { SessionUser } from '@/lib/auth'
import { safeJson } from '@/lib/fetch'
interface Condition {
  id: string; source_type: string; source_id: string
  field: string; op: string; value: number; logic: string; query: string
}
interface RuleAction {
  type: string; channel_id: string | null; channel_type: string
  label: string; recipients: Recipient[]
  message_template: string; service_id: string; path: string
  payload_template: string; rca_context: string; assignee_role: string
  query: string; query_source_type: string; query_source_id: string
  query_on_complete: string
}
interface Recipient { type: string; label: string; address?: string; number?: string; role?: string; group_id?: string }
interface Controls { cooldown_sec: number; active_hours: string; max_per_day: number; consecutive: number }
interface Trigger   { type: string; interval_sec?: number }
interface RuleGroup {
  id: string; name: string; description: string; active: boolean; logic: string
  trigger: Trigger; conditions: Condition[]; controls: Controls
  actions: RuleAction[]; recipients: Recipient[]; message_template: string
  email_channel_id?: string | null; sms_channel_id?: string | null
  last_fired_at: string | null; fire_count_today: number; created_at: string
}

// -- Alert (integration_rules) types and constants ----------
interface AlertRule {
  id: string; name: string; active: boolean
  trigger_type: string; source_type: string; source_id: string | null
  query: string | null; condition: Record<string, unknown>
  channel_id: string; channel_name: string; channel_type: string
  message_template: string; last_run_at: string | null; next_run_at: string | null
}
interface AlertRun {
  id: string; triggered_at: string; status: string
  message_sent: string | null; error: string | null; latency_ms: number
}
const ALERT_EMPTY = { name: '', active: true, trigger_type: 'threshold', source_type: 'database', source_id: '', query: '', channel_id: '', message_template: '', op: '<', threshold: '', column: '', interval: '3600', file_format: 'csv' }
const TRIGGER_TYPE_OPTS = [
  { value: 'threshold',    label: 'Threshold alert' },
  { value: 'schedule',     label: 'Scheduled report' },
  { value: 'rca_complete', label: 'RCA completed' },
]
const INTERVAL_OPTS_ALERT = [
  { label: '5 minutes', value: 300 }, { label: '15 minutes', value: 900 },
  { label: '1 hour', value: 3600 },   { label: '6 hours', value: 21600 },
  { label: '1 day', value: 86400 },   { label: '1 week', value: 604800 },
]
const INP_A: React.CSSProperties = { width: '100%', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '9px 12px', fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }
const SEL_A: React.CSSProperties = { ...INP_A, cursor: 'pointer' }
const MONO_A: React.CSSProperties = { ...INP_A, fontFamily: 'var(--font-mono)', fontSize: 12 }
function fmtDateAlert(iso: string | null) {
  if (!iso) return '--'
  const d = new Date(iso)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function fmtIntervalAlert(sec: number) {
  if (sec >= 86400) return `${Math.floor(sec / 86400)}d`
  if (sec >= 3600)  return `${Math.floor(sec / 3600)}h`
  if (sec >= 60)    return `${Math.floor(sec / 60)}m`
  return `${sec}s`
}

const EMPTY_GROUP: Omit<RuleGroup, 'id' | 'created_at' | 'last_fired_at' | 'fire_count_today'> = {
  name: '', description: '', active: true, logic: 'OR',
  trigger: { type: 'schedule', interval_sec: 300 },
  conditions: [], controls: { cooldown_sec: 7200, active_hours: '06:00-22:00', max_per_day: 5, consecutive: 1 },
  actions: [], recipients: [], message_template: '', email_channel_id: '', sms_channel_id: '',
}
const TRIGGER_LABELS: Record<string, string> = { schedule: 'Scheduled', threshold: 'Threshold', rca_complete: 'RCA completed', manual: 'Manual' }
const OP_LABELS: Record<string, string> = { '<': '<', '<=': '', '>': '>', '>=': '', '==': '=', '!=': '' }

function fmtInterval(sec: number) {
  if (sec >= 86400) return `${Math.floor(sec / 86400)}d`
  if (sec >= 3600)  return `${Math.floor(sec / 3600)}h`
  if (sec >= 60)    return `${Math.floor(sec / 60)}m`
  return `${sec}s`
}
function fmtDate(iso: string | null) {
  if (!iso) return 'never'
  return new Date(iso).toLocaleDateString() + ' ' + new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// -- Shared input style ----------------------------------------
const INP: React.CSSProperties = { width: '100%', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '8px 11px', fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }
const SEL: React.CSSProperties = { ...INP, cursor: 'pointer' }
const LBL: React.CSSProperties = { fontSize: 11, fontWeight: 500, color: 'var(--text2)', marginBottom: 5, display: 'block' }

import React from 'react'

export default function RulesPage({ user }: { user: SessionUser }) {
  const router = useRouter()
  const [groups,    setGroups]    = useState<RuleGroup[]>([])
  const [loading,   setLoading]   = useState(true)
  const [view,      setView]      = useState<'list' | 'builder' | 'detail'>('list')
  const [activeId,  setActiveId]  = useState<string | null>(null)
  const [form,      setForm]      = useState<typeof EMPTY_GROUP>({ ...EMPTY_GROUP })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving,    setSaving]    = useState(false)
  const [activeTab, setActiveTab]  = useState<'alerts'|'workflow'|'automation'>('alerts')
  const [n8nStatus, setN8nStatus]   = useState<null|Record<string,unknown>>(null)
  const [n8nLoading, setN8nLoading] = useState(false)
  const [toast,     setToast]     = useState('')
  const [dbConns,    setDbConns]    = useState<Array<{id:string;label:string}>>([])  
  const [apiSvcs,    setApiSvcs]    = useState<Array<{id:string;label:string}>>([])  
  const [channels,   setChannels]   = useState<Array<{id:string;name:string;type:string}>>([])  
  const [notifGroups, setNotifGroups] = useState<Array<{id:string;name:string;members:unknown[]}>>([])  
  // Alert (integration_rules) state
  const [alerts,        setAlerts]        = useState<AlertRule[]>([])
  const [showAlertForm, setShowAlertForm] = useState(false)
  const [alertEditing,  setAlertEditing]  = useState<string | null>(null)
  const [alertForm,     setAlertForm]     = useState({ ...ALERT_EMPTY })
  const [expandedAlerts,setExpandedAlerts]= useState<Record<string, boolean>>({})
  const [alertRunLogs,  setAlertRunLogs]  = useState<Record<string, AlertRun[]>>({})
  const [alertSaving,   setAlertSaving]   = useState(false)

  useEffect(() => { load() }, [])
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 2500); return () => clearTimeout(t) } }, [toast])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rd, dbr, apr, chr, ngr, alr] = await Promise.all([
        fetch('/api/rules').then(r => r.json()),
        fetch('/api/connections').then(r => r.json()).catch(() => ({ connections: [] })),
        fetch('/api/services').then(r => r.json()).catch(() => ({ services: [] })),
        fetch('/api/integrations/channels').then(r => r.json()).catch(() => ({ channels: [] })),
        fetch('/api/integrations/groups').then(r => r.json()).catch(() => ({ groups: [] })),
        fetch('/api/integrations/rules').then(r => r.json()).catch(() => ({ rules: [] })),
      ])
      setGroups(rd.groups || [])
      setDbConns(dbr.connections || [])
      setApiSvcs(apr.services || [])
      setChannels(chr.channels || [])
      setNotifGroups(ngr.groups || [])
      setAlerts(alr.rules || [])
    } finally { setLoading(false) }
  }, [])

  // -- Alert (integration_rules) actions --------------------
  async function saveAlert() {
    if (!alertForm.name.trim() || !alertForm.channel_id) return
    setAlertSaving(true)
    try {
      const action = alertEditing ? 'update' : 'create'
      const condition: Record<string, unknown> = {}
      if (alertForm.trigger_type === 'threshold') { condition.operator = alertForm.op; condition.value = Number(alertForm.threshold); condition.column = alertForm.column }
      if (alertForm.trigger_type === 'schedule')  { condition.interval_sec = Number(alertForm.interval) }
      if (alertForm.source_type === 'file_server' && alertForm.trigger_type !== 'rca_complete') { condition.file_format = alertForm.file_format }
      const body: Record<string, unknown> = { action, name: alertForm.name.trim(), active: alertForm.active, trigger_type: alertForm.trigger_type, source_type: alertForm.source_type, source_id: alertForm.source_id || null, query: alertForm.query || null, condition, channel_id: alertForm.channel_id, message_template: alertForm.message_template }
      if (alertEditing) body.id = alertEditing
      await fetch('/api/integrations/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      setShowAlertForm(false); setAlertEditing(null); setAlertForm({ ...ALERT_EMPTY })
      setToast(alertEditing ? 'Alert updated' : 'Alert saved')
      await load()
    } finally { setAlertSaving(false) }
  }
  async function toggleAlert(id: string) {
    await fetch('/api/integrations/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'toggle', id }) })
    setAlerts(p => p.map(r => r.id === id ? { ...r, active: !r.active } : r))
  }
  async function deleteAlert(id: string, name: string) {
    if (!confirm(`Delete alert "${name}"?`)) return
    await fetch('/api/integrations/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) })
    setAlerts(p => p.filter(r => r.id !== id)); setToast('Alert deleted')
  }
  async function loadAlertRuns(ruleId: string) {
    try {
      const r = await fetch('/api/integrations/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get_runs', rule_id: ruleId }) })
      const { data: d } = await safeJson<{ runs?: unknown[] }>(r)
      setAlertRunLogs(p => ({ ...p, [ruleId]: (d?.runs || []) as AlertRun[] }))
    } catch { setAlertRunLogs(p => ({ ...p, [ruleId]: [] })) }
  }
  const triggerLabel = (t: string) => TRIGGER_TYPE_OPTS.find(x => x.value === t)?.label ?? t
  const conditionSummary = (rule: AlertRule) => {
    const c = rule.condition
    if (rule.trigger_type === 'threshold')    return `When ${c.column} ${c.operator} ${c.value}`
    if (rule.trigger_type === 'schedule')     return `Every ${fmtIntervalAlert(Number(c.interval_sec || 3600))}`
    if (rule.trigger_type === 'rca_complete') return 'When an RCA session completes'
    return ''
  }

  async function loadN8nStatus() {
    setN8nLoading(true)
    try {
      const r = await fetch('/api/n8n')
      const { data: d } = await safeJson(r)
      setN8nStatus(d)
    } catch { setN8nStatus(null) } finally { setN8nLoading(false) }
  }

  async function saveGroup() {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const action = editingId ? 'update' : 'create'
      const body = { action, ...form, ...(editingId ? { id: editingId } : {}) }
      const r = await fetch('/api/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const { data: d, error: err } = await safeJson<{ id?: string }>(r)
      if (err) { setToast('Error: ' + err); return }
      setToast(editingId ? 'Group updated' : 'Group created')
      setView('list'); setEditingId(null); setForm({ ...EMPTY_GROUP })
      await load()
      if (!editingId && d?.id) { setActiveId(d.id); setView('detail') }
    } catch (e) { setToast('Error: ' + (e instanceof Error ? e.message : 'Save failed')) }
    finally { setSaving(false) }
  }

  async function toggleGroup(id: string) {
    await fetch('/api/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'toggle', id }) })
    setGroups(p => p.map(g => g.id === id ? { ...g, active: !g.active } : g))
  }

  async function deleteGroup(id: string, name: string) {
    if (!confirm(`Delete "${name}"?`)) return
    await fetch('/api/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) })
    setGroups(p => p.filter(g => g.id !== id))
    if (activeId === id) { setActiveId(null); setView('list') }
    setToast('Group deleted')
  }

  function startEdit(g: RuleGroup) {
    setEditingId(g.id)
    setForm({ name: g.name, description: g.description, active: g.active, logic: g.logic, trigger: g.trigger, conditions: g.conditions, controls: g.controls, actions: g.actions, recipients: g.recipients, message_template: g.message_template, email_channel_id: g.email_channel_id || '', sms_channel_id: g.sms_channel_id || '' })
    setView('builder')
  }

  function startNew() {
    setEditingId(null)
    setForm({ ...EMPTY_GROUP })
    setView('builder')
  }

  const active = groups.find(g => g.id === activeId)
  const isAdmin = user.role === 'admin'

  // -- Header --------------------------------------------------
  const topbar = (
    <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0 24px', height: 52, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
      <button onClick={() => router.push('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text3)', fontSize: 12, fontFamily: 'inherit', padding: 0 }}>
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M9 2L4 6.5l5 4.5"/></svg>
        Chat
      </button>
      <div style={{ width: 1, height: 14, background: 'var(--border2)' }} />
      {view !== 'list' && (
        <button onClick={() => { setView('list'); setActiveId(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text3)', fontSize: 12, fontFamily: 'inherit', padding: 0 }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 2L3 6l5 4"/></svg>
          Rules
        </button>
      )}
      {view !== 'list' && <div style={{ width: 1, height: 14, background: 'var(--border2)' }} />}
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', flex: 1 }}>
        {activeTab === 'alerts' ? 'Alerts' : view === 'list' ? 'Workflow rules' : view === 'builder' ? (editingId ? 'Edit rule group' : 'New rule group') : active?.name}
      </span>

      {view === 'detail' && active && isAdmin && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => toggleGroup(active.id)} style={{ padding: '5px 12px', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-pill)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text2)' }}>
            {active.active ? 'Pause' : 'Resume'}
          </button>
          <button onClick={() => startEdit(active)} style={{ padding: '5px 12px', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-pill)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text2)' }}>Edit</button>
          <button onClick={() => deleteGroup(active.id, active.name)} style={{ padding: '5px 12px', background: 'var(--red-bg)', border: '1px solid rgba(220,38,38,.2)', borderRadius: 'var(--radius-pill)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--red-t)' }}>Delete</button>
        </div>
      )}
    </div>
  )

  // -- Tab strip ------------------------------------------------
  const TAB_HINTS: Record<'alerts'|'workflow'|'automation', string> = {
    alerts:     'Simple watch-and-notify: check one source on a schedule and send a message when a threshold is crossed. Start here for "tell me when X."',
    workflow:   'Multi-condition rules with AND/OR logic, several actions and recipients, and rate limiting. Use when one alert isn\u2019t enough — combined conditions or richer routing.',
    automation: 'Full workflow automation via n8n for complex or multi-step logic (branching, external systems, transforms). Mosaic and n8n call each other, so automations can query your data and trigger syncs.',
  }
  const tabStrip = (
    <div>
    <div style={{ display: 'flex', gap: 2, padding: '0 24px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', marginTop: -1 }}>
      {(['alerts', 'workflow', 'automation'] as const).map(tab => (
        <button key={tab} onClick={() => { setActiveTab(tab); setView('list') }} style={{ padding: '10px 16px', fontSize: 13, fontWeight: activeTab === tab ? 600 : 400, color: activeTab === tab ? 'var(--text)' : 'var(--text3)', background: 'none', border: 'none', borderBottom: activeTab === tab ? '2px solid var(--accent-fg)' : '2px solid transparent', cursor: 'pointer', fontFamily: 'inherit', marginBottom: -1 }}>
          {tab === 'alerts' ? 'Alerts' : tab === 'workflow' ? 'Workflow rules' : 'Automation'}
        </button>
      ))}
    </div>
    <div style={{ padding: '8px 24px 0', fontSize: 12, color: 'var(--text3)', lineHeight: 1.5, maxWidth: 720 }}>
      {TAB_HINTS[activeTab]}
    </div>
    </div>
  )

  // -- Alerts view -----------------------------------------------
  const alertsView = (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', maxWidth: 860, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--text3)' }}>{alerts.length} alert{alerts.length !== 1 ? 's' : ''} configured</div>
        {isAdmin && !showAlertForm && <button onClick={() => { setShowAlertForm(true); setAlertEditing(null); setAlertForm({ ...ALERT_EMPTY }) }} style={{ padding: '6px 14px', background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>+ New alert</button>}
      </div>
      {showAlertForm && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 18, marginBottom: 14, boxShadow: 'var(--shadow-md)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>{alertEditing ? 'Edit alert' : 'New alert'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
            <div><label style={{ fontSize: 11, fontWeight: 500, color: 'var(--text2)', marginBottom: 5, display: 'block' }}>Alert name *</label><input style={INP_A} value={alertForm.name} onChange={e => setAlertForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. OEE below 75% alert" /></div>
            <div><label style={{ fontSize: 11, fontWeight: 500, color: 'var(--text2)', marginBottom: 5, display: 'block' }}>Trigger type</label><select style={SEL_A} value={alertForm.trigger_type} onChange={e => setAlertForm(p => ({ ...p, trigger_type: e.target.value }))}>{TRIGGER_TYPE_OPTS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
          </div>
          {(alertForm.trigger_type === 'threshold' || alertForm.trigger_type === 'schedule') && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
              <div><label style={{ fontSize: 11, fontWeight: 500, color: 'var(--text2)', marginBottom: 5, display: 'block' }}>Source *</label>
                <select style={SEL_A} value={alertForm.source_id ? `${alertForm.source_type}:${alertForm.source_id}` : ''} onChange={e => { const v = e.target.value; if (!v) { setAlertForm(p => ({ ...p, source_type: 'database', source_id: '' })); return }; const [stype, ...rest] = v.split(':'); setAlertForm(p => ({ ...p, source_type: stype, source_id: rest.join(':') })) }}>
                  <option value="">Select source...</option>
                  {dbConns.length > 0 && <optgroup label="Databases">{dbConns.map(c => <option key={c.id} value={`database:${c.id}`}>{c.label}</option>)}</optgroup>}
                  {apiSvcs.length > 0 && <optgroup label="API services">{apiSvcs.map(c => <option key={c.id} value={`api:${c.id}`}>{c.label}</option>)}</optgroup>}
                </select>
              </div>
              {alertForm.source_type === 'file_server' ? (
                <div><label style={{ fontSize: 11, fontWeight: 500, color: 'var(--text2)', marginBottom: 5, display: 'block' }}>File format *</label><select style={SEL_A} value={alertForm.file_format} onChange={e => setAlertForm(p => ({ ...p, file_format: e.target.value }))}><option value="csv">CSV</option><option value="xlsx">Excel (xlsx)</option></select></div>
              ) : <div />}
            </div>
          )}
          {alertForm.trigger_type === 'threshold' && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, marginBottom: 8 }}>
                <input style={MONO_A} value={alertForm.column} onChange={e => setAlertForm(p => ({ ...p, column: e.target.value }))} placeholder="column name" />
                <select style={{ ...SEL_A, width: 64 }} value={alertForm.op} onChange={e => setAlertForm(p => ({ ...p, op: e.target.value }))}>{['<','<=','>','>=','=='].map(op => <option key={op} value={op}>{op}</option>)}</select>
                <input style={{ ...INP_A, width: 80 }} type="number" value={alertForm.threshold} onChange={e => setAlertForm(p => ({ ...p, threshold: e.target.value }))} placeholder="75" />
              </div>
              <input style={MONO_A} value={alertForm.query || ''} onChange={e => setAlertForm(p => ({ ...p, query: e.target.value }))} placeholder="SELECT avg(oee_pct) as oee_pct FROM oee_hourly" />
            </div>
          )}
          {alertForm.trigger_type === 'schedule' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
              <div><label style={{ fontSize: 11, fontWeight: 500, color: 'var(--text2)', marginBottom: 5, display: 'block' }}>Run every</label><select style={SEL_A} value={alertForm.interval} onChange={e => setAlertForm(p => ({ ...p, interval: e.target.value }))}>{INTERVAL_OPTS_ALERT.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
              <div><label style={{ fontSize: 11, fontWeight: 500, color: 'var(--text2)', marginBottom: 5, display: 'block' }}>SQL query</label><input style={MONO_A} value={alertForm.query || ''} onChange={e => setAlertForm(p => ({ ...p, query: e.target.value }))} placeholder="SELECT line, avg(oee_pct) FROM oee_daily GROUP BY line" /></div>
            </div>
          )}
          {alertForm.trigger_type === 'rca_complete' && (
            <div style={{ fontSize: 12, color: 'var(--text3)', padding: '8px 12px', background: 'var(--bg3)', borderRadius: 'var(--radius-sm)', marginBottom: 10 }}>Fires automatically when any RCA session produces a completed output. No query needed.</div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
            <div><label style={{ fontSize: 11, fontWeight: 500, color: 'var(--text2)', marginBottom: 5, display: 'block' }}>Channel *</label><select style={SEL_A} value={alertForm.channel_id} onChange={e => setAlertForm(p => ({ ...p, channel_id: e.target.value }))}><option value="">Select channel...</option>{channels.map(c => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}</select></div>
            <div><label style={{ fontSize: 11, fontWeight: 500, color: 'var(--text2)', marginBottom: 5, display: 'block' }}>Message template</label><input style={INP_A} value={alertForm.message_template} onChange={e => setAlertForm(p => ({ ...p, message_template: e.target.value }))} placeholder="OEE dropped to {value}% on {date}" /></div>
          </div>
          <div style={{ display: 'flex', gap: 8, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <button onClick={saveAlert} disabled={alertSaving || !alertForm.name.trim() || !alertForm.channel_id} style={{ padding: '7px 18px', background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', opacity: alertSaving || !alertForm.name.trim() || !alertForm.channel_id ? 0.5 : 1 }}>{alertSaving ? 'Saving...' : alertEditing ? 'Update' : 'Save alert'}</button>
            <button onClick={() => { setShowAlertForm(false); setAlertEditing(null) }} style={{ padding: '7px 14px', background: 'var(--surface)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-pill)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          </div>
        </div>
      )}
      {alerts.length === 0 && !showAlertForm ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text3)', fontSize: 13 }}>No alerts yet. Click + New alert to create one.</div>
      ) : alerts.map(rule => {
        const expanded = expandedAlerts[rule.id]
        return (
          <div key={rule.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 8, boxShadow: 'var(--shadow)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 5, background: rule.active ? '#16a34a' : '#d0d0d0' }} />
              <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => { const next = { ...expandedAlerts, [rule.id]: !expanded }; setExpandedAlerts(next); if (!expanded && !alertRunLogs[rule.id]) loadAlertRuns(rule.id) }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 99, background: rule.trigger_type === 'threshold' ? '#fef2f2' : rule.trigger_type === 'schedule' ? '#eff6ff' : '#f5f3ff', color: rule.trigger_type === 'threshold' ? '#dc2626' : rule.trigger_type === 'schedule' ? '#1d4ed8' : '#7c3aed', border: `1px solid ${rule.trigger_type === 'threshold' ? 'rgba(220,38,38,.2)' : rule.trigger_type === 'schedule' ? 'rgba(29,78,216,.2)' : 'rgba(124,58,237,.2)'}`, fontWeight: 600 }}>{triggerLabel(rule.trigger_type)}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{rule.name}</span>
                  <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 99, background: rule.active ? '#f0fdf4' : 'var(--bg3)', color: rule.active ? '#16a34a' : 'var(--text3)', border: `1px solid ${rule.active ? 'rgba(22,163,74,.2)' : 'var(--border)'}` }}>{rule.active ? 'Active' : 'Paused'}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 12 }}>
                  <span>{conditionSummary(rule)}</span>
                  <span>{rule.channel_name}</span>
                  {rule.next_run_at && <span>Next: {fmtDateAlert(rule.next_run_at)}</span>}
                </div>
              </div>
              {isAdmin && (
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => toggleAlert(rule.id)} style={{ padding: '4px 10px', fontSize: 11, border: '1px solid var(--border2)', borderRadius: 'var(--radius-pill)', background: 'var(--surface)', color: 'var(--text2)', cursor: 'pointer', fontFamily: 'inherit' }}>{rule.active ? 'Pause' : 'Resume'}</button>
                  <button onClick={() => { setAlertEditing(rule.id); setAlertForm({ name: rule.name, active: rule.active, trigger_type: rule.trigger_type, source_type: rule.source_type, source_id: rule.source_id || '', query: rule.query || '', channel_id: rule.channel_id, message_template: rule.message_template, op: String(rule.condition.operator || '<'), threshold: String(rule.condition.value || ''), column: String(rule.condition.column || ''), interval: String(rule.condition.interval_sec || 3600), file_format: String(rule.condition.file_format || 'csv') }); setShowAlertForm(true) }} style={{ padding: '4px 10px', fontSize: 11, border: '1px solid var(--border2)', borderRadius: 'var(--radius-pill)', background: 'var(--surface)', color: 'var(--text2)', cursor: 'pointer', fontFamily: 'inherit' }}>Edit</button>
                  <button onClick={() => deleteAlert(rule.id, rule.name)} style={{ padding: '4px 10px', fontSize: 11, border: '1px solid rgba(220,38,38,.2)', borderRadius: 'var(--radius-pill)', background: '#fef2f2', color: '#dc2626', cursor: 'pointer', fontFamily: 'inherit' }}>Delete</button>
                </div>
              )}
            </div>
            {expanded && (
              <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 5 }}>Recent runs</div>
                {(alertRunLogs[rule.id] || []).length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text4)' }}>No runs yet</div>
                ) : (alertRunLogs[rule.id] || []).map(run => (
                  <div key={run.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 11 }}>
                    <span style={{ fontWeight: 600, color: run.status === 'sent' ? '#16a34a' : run.status === 'error' ? '#dc2626' : 'var(--text3)', flexShrink: 0 }}>{run.status}</span>
                    <span style={{ color: 'var(--text3)', flexShrink: 0 }}>{fmtDateAlert(run.triggered_at)}</span>
                    {run.message_sent && <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text2)' }}>{run.message_sent}</span>}
                    {run.error && <span style={{ color: '#dc2626', flex: 1 }}>{run.error}</span>}
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text4)', flexShrink: 0 }}>{run.latency_ms}ms</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )

  // -- Automation view (n8n) ------------------------------------
  const automationView = (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', maxWidth: 860, margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>n8n Workflow Automation</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>Connect Mosaic alerts and data to external systems via n8n workflows</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={loadN8nStatus} disabled={n8nLoading}
            style={{ padding: '6px 14px', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-pill)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text2)' }}>
            {n8nLoading ? 'Checking...' : 'Check status'}
          </button>
          {n8nStatus && (n8nStatus.n8nStatus as string) === 'online' && (
            <a href={n8nStatus.n8nUrl as string} target="_blank" rel="noopener noreferrer"
              style={{ padding: '6px 14px', background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              Open n8n Editor ↗
            </a>
          )}
        </div>
      </div>

      {/* Status card */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 18px', marginBottom: 14, boxShadow: 'var(--shadow)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.08em', marginBottom: 10 }}>Status</div>
        {!n8nStatus ? (
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>Click "Check status" to connect to your n8n instance</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>n8n instance</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: (n8nStatus.n8nStatus as string) === 'online' ? '#16a34a' : '#dc2626' }} />
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                  {(n8nStatus.n8nStatus as string) === 'online' ? 'Online' : 'Offline'}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text4)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>{n8nStatus.n8nUrl as string}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Workflows</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)' }}>{String(n8nStatus.workflowCount ?? '—')}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>API key</div>
              <div style={{ fontSize: 13, color: (n8nStatus.apiKeyConfigured as boolean) ? '#16a34a' : '#dc2626', fontWeight: 500 }}>
                {(n8nStatus.apiKeyConfigured as boolean) ? 'Configured' : 'Not set'}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Mosaic API credentials for n8n */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 18px', marginBottom: 14, boxShadow: 'var(--shadow)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.08em', marginBottom: 10 }}>Mosaic API — paste into n8n credentials</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
          In n8n, create a new credential of type <strong>Header Auth</strong>. Set name to <code>Authorization</code> and value to <code>Bearer {'<your-n8n-api-key>'}</code>. Use the base URL below for all Mosaic HTTP nodes.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, fontSize: 12 }}>
          <span style={{ color: 'var(--text3)', paddingTop: 2 }}>Base URL</span>
          <code style={{ background: 'var(--bg)', padding: '4px 8px', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', fontSize: 11, border: '1px solid var(--border2)' }}>
            {n8nStatus ? (n8nStatus.mosaicApiBase as string) : 'http://localhost:3001'}
          </code>
          <span style={{ color: 'var(--text3)', paddingTop: 2 }}>Query endpoint</span>
          <code style={{ background: 'var(--bg)', padding: '4px 8px', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', fontSize: 11, border: '1px solid var(--border2)' }}>
            POST /api/n8n  {"{"}"action":"query","connection_id":"...","sql":"SELECT ..."{"}"}
          </code>
          <span style={{ color: 'var(--text3)', paddingTop: 2 }}>Sync endpoint</span>
          <code style={{ background: 'var(--bg)', padding: '4px 8px', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', fontSize: 11, border: '1px solid var(--border2)' }}>
            POST /api/n8n  {"{"}"action":"sync","source_label":"ERP Lite"{"}"}
          </code>
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text3)' }}>
          Set API key in <strong>Settings → API Keys → n8n API Key</strong>. The same key goes into n8n as the Bearer token.
        </div>
      </div>

      {/* Recent executions */}
      {n8nStatus && (n8nStatus.recentExecutions as unknown[])?.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 18px', boxShadow: 'var(--shadow)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.08em', marginBottom: 10 }}>Recent executions</div>
          {(n8nStatus.recentExecutions as Array<Record<string,string>>).map(ex => (
            <div key={ex.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: ex.status === 'success' ? '#16a34a' : ex.status === 'running' ? '#2563eb' : '#dc2626' }} />
              <span style={{ flex: 1, color: 'var(--text)', fontWeight: 500 }}>{ex.workflowName}</span>
              <span style={{ color: 'var(--text3)' }}>{ex.status}</span>
              <span style={{ color: 'var(--text4)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                {new Date(ex.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Setup guide */}
      {(!n8nStatus || (n8nStatus.n8nStatus as string) === 'offline') && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 18px', boxShadow: 'var(--shadow)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.08em', marginBottom: 10 }}>Quick setup</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.8 }}>
            <div><strong>1.</strong> n8n starts automatically with <code>docker compose up -d</code></div>
            <div><strong>2.</strong> Open n8n at <code>http://localhost:5678</code> and create an account</div>
            <div><strong>3.</strong> Go to n8n Settings → API → Create API Key</div>
            <div><strong>4.</strong> Save the key in <strong>Settings → API Keys → n8n API Key</strong></div>
            <div><strong>5.</strong> Come back here and click "Check status"</div>
          </div>
        </div>
      )}
    </div>
  )

  // -- List view ------------------------------------------------
  const listView = (
    <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px', maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 24 }}>
        {[['Groups', String(groups.length), ''], ['Active', String(groups.filter(g => g.active).length), 'monitoring'], ['Fired today', String(groups.reduce((s,g) => s + g.fire_count_today, 0)), 'notifications']].map(([l,v,s]) => (
          <div key={l} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px', boxShadow: 'var(--shadow)' }}>
            <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.06em', marginBottom: 4 }}>{l}</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)', letterSpacing: '-.02em' }}>{v}</div>
            {s && <div style={{ fontSize: 10, color: 'var(--text4)', marginTop: 2 }}>{s}</div>}
          </div>
        ))}
      </div>

      {!loading && groups.length > 0 && isAdmin && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button onClick={startNew} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>+ New group</button>
        </div>
      )}
      {loading ? <div style={{ textAlign: 'center', padding: 48, color: 'var(--text3)', fontSize: 13 }}>Loading...</div>
      : groups.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text2)', marginBottom: 6 }}>No rule groups yet</div>
          <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 20 }}>Create a group to start automating responses to your plant data.</div>
          {isAdmin && <button onClick={startNew} style={{ padding: '8px 20px', background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>Create first group</button>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {groups.map(g => (
            <div key={g.id} onClick={() => { setActiveId(g.id); setView('detail') }}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 18px', cursor: 'pointer', boxShadow: 'var(--shadow)', transition: 'box-shadow .15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-md)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 4, background: g.active ? (g.fire_count_today > 0 ? '#dc2626' : '#16a34a') : '#d0d0d0' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{g.name}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: g.logic === 'OR' ? '#fff7ed' : '#eff6ff', color: g.logic === 'OR' ? '#c2410c' : '#1d4ed8', border: `1px solid ${g.logic === 'OR' ? 'rgba(194,65,12,.3)' : 'rgba(29,78,216,.3)'}` }}>{g.logic}</span>
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 99, background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text3)' }}>{TRIGGER_LABELS[g.trigger?.type] ?? g.trigger?.type}</span>
                  </div>
                  {g.description && <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 5 }}>{g.description}</div>}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: 'var(--text3)' }}>
                    <span>{g.conditions.length} condition{g.conditions.length !== 1 ? 's' : ''}</span>
                    <span>{g.actions.length} action{g.actions.length !== 1 ? 's' : ''}</span>
                    <span>Last fired: {fmtDate(g.last_fired_at)}</span>
                    {g.fire_count_today > 0 && <span style={{ color: '#dc2626', fontWeight: 600 }}>{g.fire_count_today} today</span>}
                  </div>
                </div>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="var(--text4)" strokeWidth="1.5" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 4 }}><path d="M4 2l4 4-4 4"/></svg>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  // -- Detail view ----------------------------------------------
  const detailView = active ? (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', maxWidth: 860, margin: '0 auto', width: '100%' }}>
      {/* Conditions */}
      <Section title="Conditions">
        {active.conditions.length === 0
          ? <div style={{ fontSize: 12, color: 'var(--text4)' }}>Always fires on trigger</div>
          : active.conditions.map((c, ci) => (
            <div key={c.id}>
              {ci > 0 && (
                <div style={{ fontSize: 9, fontWeight: 700, padding: '2px 0 2px 8px', letterSpacing: '.06em', color: c.logic === 'OR' ? '#c2410c' : '#1d4ed8' }}>{c.logic}</div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7, marginBottom: 3 }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: c.logic === 'OR' ? '#fff7ed' : '#eff6ff', color: c.logic === 'OR' ? '#c2410c' : '#1d4ed8', flexShrink: 0 }}>IF</span>
                <code style={{ fontSize: 12, flex: 1 }}>{c.field} {OP_LABELS[c.op] ?? c.op} {c.value}</code>
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>{c.source_type}</span>
              </div>
            </div>
          ))
        }
      </Section>

      {/* Controls */}
      <Section title="Controls">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            [`Cooldown: ${fmtInterval(active.controls?.cooldown_sec ?? 0)}`],
            [`Hours: ${active.controls?.active_hours}`],
            [`Max ${active.controls?.max_per_day}/day`],
            active.controls?.consecutive > 1 ? [`${active.controls.consecutive} consecutive`] : null,
          ].filter(Boolean).map((items, i) => (
            <span key={i} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 99, background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text3)' }}>{(items as string[])[0]}</span>
          ))}
        </div>
      </Section>

      {/* Actions */}
      <Section title="Actions">
        {active.actions.map((a, i) => {
          const cls = { notify: '#f0fdf4', api_call: '#eff6ff', rca: '#f5f3ff', query: '#fff7ed' }[a.type] ?? 'var(--bg)'
          const border = { notify: 'rgba(22,163,74,.2)', api_call: 'rgba(37,99,235,.2)', rca: 'rgba(109,40,217,.2)', query: 'rgba(194,65,12,.2)' }[a.type] ?? 'var(--border)'
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: cls, border: `1px solid ${border}`, borderRadius: 7, marginBottom: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', flexShrink: 0 }}>{i + 1}.</span>
              <span style={{ fontSize: 12, color: 'var(--text2)', flex: 1 }}>{a.type.replace('_', ' ')} {a.label ? ` ${a.label}` : ''}</span>
            </div>
          )
        })}
      </Section>

      {/* Notifications */}
      <Section title="Notifications">
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
          {active.recipients.map((r, i) => {
            const bg = r.type === 'group' ? '#f5f3ff' : r.type === 'role' ? '#eff6ff' : 'var(--bg3)'
            const co = r.type === 'group' ? '#6d28d9' : r.type === 'role' ? '#1d4ed8' : 'var(--text2)'
            return <span key={i} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: bg, color: co, border: `1px solid ${co}30` }}>{r.label}</span>
          })}
        </div>
        {active.message_template && (
          <code style={{ display: 'block', fontSize: 11, background: 'var(--bg3)', padding: '6px 10px', borderRadius: 6, color: 'var(--text2)', lineHeight: 1.5 }}>{active.message_template}</code>
        )}
      </Section>

      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text4)' }}>
        <span>Last fired: {fmtDate(active.last_fired_at)}</span>
        <span style={{ color: active.fire_count_today > 0 ? '#dc2626' : 'var(--text4)' }}>{active.fire_count_today} fire{active.fire_count_today !== 1 ? 's' : ''} today</span>
      </div>
    </div>
  ) : null

  // -- Builder view ---------------------------------------------
  const builderView = (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', maxWidth: 800, margin: '0 auto', width: '100%' }}>
      {/* Identity */}
      <Section title="Identity">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
          <div><label style={LBL}>Group name *</label><input style={INP} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Line A quality watch" /></div>
          <div><label style={LBL}>Status</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 }}>
              <div onClick={() => setForm(p => ({ ...p, active: !p.active }))} style={{ width: 36, height: 20, borderRadius: 10, background: form.active ? 'var(--accent-bg)' : 'var(--bg4)', cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: 2, left: form.active ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: form.active ? 'var(--accent-fg)' : 'var(--text3)', transition: 'left .2s' }} />
              </div>
              <span style={{ fontSize: 13, color: 'var(--text2)' }}>{form.active ? 'Active' : 'Paused'}</span>
            </div>
          </div>
        </div>
        <div><label style={LBL}>Description</label><input style={INP} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="What does this group monitor?" /></div>
      </Section>

      {/* Trigger */}
      <Section title="Trigger">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><label style={LBL}>Type</label>
            <select style={SEL} value={form.trigger.type} onChange={e => setForm(p => ({ ...p, trigger: { ...p.trigger, type: e.target.value } }))}>
              {Object.entries(TRIGGER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          {form.trigger.type === 'schedule' && (
            <div><label style={LBL}>Check every</label>
              <select style={SEL} value={form.trigger.interval_sec ?? 300} onChange={e => setForm(p => ({ ...p, trigger: { ...p.trigger, interval_sec: Number(e.target.value) } }))}>
                {[[60,'1 min'],[300,'5 min'],[900,'15 min'],[1800,'30 min'],[3600,'1 hr']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          )}
        </div>
      </Section>

      {/* Conditions */}
      <Section title={<span>Conditions <button onClick={() => setForm(p => ({ ...p, logic: p.logic === 'AND' ? 'OR' : 'AND' }))} style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '1px 8px', borderRadius: 99, background: form.logic === 'OR' ? '#fff7ed' : '#eff6ff', color: form.logic === 'OR' ? '#c2410c' : '#1d4ed8', border: `1.5px solid ${form.logic === 'OR' ? 'rgba(194,65,12,.3)' : 'rgba(29,78,216,.3)'}`, cursor: 'pointer', fontFamily: 'inherit' }}>{form.logic} -- click to toggle</button></span>}>
        {form.conditions.map((c, ci) => (
          <div key={c.id}>
            {ci > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 0 2px 8px' }}>
                <button onClick={() => setForm(p => ({ ...p, conditions: p.conditions.map((x, i) => i === ci ? { ...x, logic: x.logic === 'AND' ? 'OR' : 'AND' } : x) }))} style={{ fontSize: 9, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: c.logic === 'OR' ? '#fff7ed' : '#eff6ff', color: c.logic === 'OR' ? '#c2410c' : '#1d4ed8', border: `1.5px solid ${c.logic === 'OR' ? 'rgba(194,65,12,.3)' : 'rgba(29,78,216,.3)'}`, cursor: 'pointer', fontFamily: 'inherit' }}>{c.logic}</button>
                <span style={{ fontSize: 10, color: 'var(--text4)' }}>click to toggle</span>
              </div>
            )}
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', marginBottom: 4 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <select style={{ ...SEL, width: 110, fontSize: 11 }} value={c.source_type} onChange={e => setForm(p => ({ ...p, conditions: p.conditions.map((x, i) => i === ci ? { ...x, source_type: e.target.value, source_id: '', field: '' } : x) }))}>
                  <option value="database">Database</option>
                  <option value="api">API</option>
                </select>
                <select style={{ ...SEL, flex: 1, fontSize: 11 }} value={c.source_id ? `${c.source_type}:${c.source_id}` : ''} onChange={e => {
                    const v = e.target.value
                    if (!v) { setForm(p => ({ ...p, conditions: p.conditions.map((x, i) => i === ci ? { ...x, source_type: 'database', source_id: '' } : x) })); return }
                    const [stype, ...rest] = v.split(':'); const sid = rest.join(':')
                    setForm(p => ({ ...p, conditions: p.conditions.map((x, i) => i === ci ? { ...x, source_type: stype, source_id: sid } : x) }))
                  }}>
                  <option value="">Select source...</option>
                  {dbConns.length > 0 && <optgroup label="Databases">{dbConns.map(c => <option key={c.id} value={`database:${c.id}`}>{c.label}</option>)}</optgroup>}
                  {apiSvcs.length > 0 && <optgroup label="API services">{apiSvcs.map(c => <option key={c.id} value={`api:${c.id}`}>{c.label}</option>)}</optgroup>}
                </select>
                <button onClick={() => setForm(p => ({ ...p, conditions: p.conditions.filter((_, i) => i !== ci) }))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 18, padding: '0 6px', flexShrink: 0, lineHeight: 1 }}>×</button>
              </div>
              <div style={{ display: 'flex', gap: 8, opacity: c.source_id ? 1 : 0.4, pointerEvents: c.source_id ? 'auto' : 'none' }}>
                <input style={{ ...INP, flex: 1, fontSize: 11, fontFamily: 'var(--font-mono)' }} value={c.field} onChange={e => setForm(p => ({ ...p, conditions: p.conditions.map((x, i) => i === ci ? { ...x, field: e.target.value } : x) }))} placeholder="field name (result column to compare)" />
                <select style={{ ...SEL, width: 58, fontSize: 12 }} value={c.op} onChange={e => setForm(p => ({ ...p, conditions: p.conditions.map((x, i) => i === ci ? { ...x, op: e.target.value } : x) }))}>
                  {['<','<=','>','>=','==','!='].map(op => <option key={op} value={op}>{op}</option>)}
                </select>
                <input style={{ ...INP, width: 80, fontSize: 12 }} type="number" value={c.value} onChange={e => setForm(p => ({ ...p, conditions: p.conditions.map((x, i) => i === ci ? { ...x, value: Number(e.target.value) } : x) }))} />
              </div>
              <div style={{ marginTop: 6, opacity: c.source_id ? 1 : 0.4, pointerEvents: c.source_id ? 'auto' : 'none' }}>
                <input style={{ ...INP, fontSize: 11, fontFamily: 'var(--font-mono)' }} value={c.query || ''} onChange={e => setForm(p => ({ ...p, conditions: p.conditions.map((x, i) => i === ci ? { ...x, query: e.target.value } : x) }))} placeholder={c.source_type === 'api' ? '/endpoint?param=value' : 'SELECT avg(oee_pct) as oee_pct FROM oee_hourly WHERE machine_id = 6'} />
              </div>
            </div>
          </div>
        ))}
        <button onClick={() => setForm(p => ({ ...p, conditions: [...p.conditions, { id: 'c-' + Date.now(), source_type: 'database', source_id: '', field: '', op: '<', value: 0, logic: 'AND', query: '' }] }))} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 7, border: '1px dashed var(--border2)', background: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text3)', fontFamily: 'inherit' }}>
          + Add condition
        </button>
      </Section>

      {/* Actions */}
      <Section title="Actions">
        {form.actions.map((a, ai) => (
          <div key={ai} style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', flexShrink: 0 }}>{ai + 1}.</span>
            <select style={{ ...SEL, width: 110, fontSize: 11 }} value={a.type} onChange={e => setForm(p => ({ ...p, actions: p.actions.map((x, i) => i === ai ? { ...x, type: e.target.value } : x) }))}>
              <option value="notify">Notify</option>
              <option value="api_call">API call</option>
              <option value="n8n_webhook">n8n webhook</option>
            </select>
            {a.type === 'notify' && (
              <select style={{ ...SEL, flex: 1, fontSize: 11 }} value={a.channel_id || ''} onChange={e => setForm(p => ({ ...p, actions: p.actions.map((x, i) => i === ai ? { ...x, channel_id: e.target.value } : x) }))}>
                <option value="">Select channel...</option>
                {channels.map(c => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
              </select>
            )}
            {a.type === 'api_call' && (
              <input style={{ ...INP, flex: 1, fontSize: 11, fontFamily: 'var(--font-mono)' }} value={a.path || ''} onChange={e => setForm(p => ({ ...p, actions: p.actions.map((x, i) => i === ai ? { ...x, path: e.target.value } : x) }))} placeholder="/webhook/trigger" />
            )}
            {a.type === 'n8n_webhook' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1 }}>
                <input style={{ ...INP, fontSize: 11, fontFamily: 'var(--font-mono)' }} value={a.path || ''} onChange={e => setForm(p => ({ ...p, actions: p.actions.map((x, i) => i === ai ? { ...x, path: e.target.value } : x) }))} placeholder="n8n webhook URL — e.g. http://localhost:5678/webhook/abc123" />
                <input style={{ ...INP, fontSize: 11, fontFamily: 'var(--font-mono)' }} value={a.payload_template || ''} onChange={e => setForm(p => ({ ...p, actions: p.actions.map((x, i) => i === ai ? { ...x, payload_template: e.target.value } : x) }))} placeholder='Payload template — e.g. {"rule":"{{group_name}}","value":"{{value}}","asset":"{{asset_id}}"}' />
              </div>
            )}
            <button onClick={() => setForm(p => ({ ...p, actions: p.actions.filter((_, i) => i !== ai) }))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text4)', fontSize: 16, padding: '0 4px', flexShrink: 0 }}>×</button>
          </div>
        ))}
        <button onClick={() => setForm(p => ({ ...p, actions: [...p.actions, { type: 'notify', channel_id: null, channel_type: '', label: '', recipients: [], message_template: '', service_id: '', path: '', payload_template: '', rca_context: '', assignee_role: '', query: '', query_source_type: '', query_source_id: '', query_on_complete: '' }] }))} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 7, border: '1px dashed var(--border2)', background: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text3)', fontFamily: 'inherit' }}>
          + Add action
        </button>
      </Section>

      {/* Controls */}
      <Section title="Controls">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
          <div><label style={LBL}>Cooldown</label>
            <select style={SEL} value={form.controls.cooldown_sec} onChange={e => setForm(p => ({ ...p, controls: { ...p.controls, cooldown_sec: Number(e.target.value) } }))}>
              {[[0,'None'],[1800,'30m'],[3600,'1h'],[7200,'2h'],[14400,'4h'],[86400,'1d']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div><label style={LBL}>Active hours</label><input style={{ ...INP, fontSize: 12 }} value={form.controls.active_hours} onChange={e => setForm(p => ({ ...p, controls: { ...p.controls, active_hours: e.target.value } }))} placeholder="06:00-22:00" /></div>
          <div><label style={LBL}>Max/day</label><input style={{ ...INP, fontSize: 12 }} type="number" value={form.controls.max_per_day} onChange={e => setForm(p => ({ ...p, controls: { ...p.controls, max_per_day: Number(e.target.value) } }))} /></div>
          <div><label style={LBL}>Consecutive</label>
            <select style={SEL} value={form.controls.consecutive} onChange={e => setForm(p => ({ ...p, controls: { ...p.controls, consecutive: Number(e.target.value) } }))}>
              {[1,2,3,5].map(n => <option key={n} value={n}>{n === 1 ? 'Every breach' : `${n} in a row`}</option>)}
            </select>
          </div>
        </div>
      </Section>

      {/* Recipient groups */}
      <Section title="Recipient groups">
        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>Add notification groups — members receive alerts via the channels configured below.</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {(form.recipients as unknown as Array<Record<string,unknown>>).filter(r => r['type'] === 'group').map((r, i) => (
            <span key={i} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 4 }}>
              {r.label as string}
              <button onClick={() => setForm(p => ({ ...p, recipients: p.recipients.filter((_, j) => j !== i) }))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <select style={{ ...SEL, flex: 1, fontSize: 11 }} onChange={e => {
            const g = notifGroups.find(x => x.id === e.target.value)
            if (!g) return
            if ((form.recipients as unknown as Array<Record<string,unknown>>).some(r => r['type'] === 'group' && r['group_id'] === g.id)) return
            setForm(p => ({ ...p, recipients: [...p.recipients, { type: 'group', group_id: g.id, label: g.name }] }))
            e.target.value = ''
          }}>
            <option value="">+ Add recipient group...</option>
            {notifGroups.map(g => <option key={g.id} value={g.id}>{g.name} ({(g.members as unknown[]).length} members)</option>)}
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={LBL}>Email channel</label>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4 }}>Used to reach email members in groups</div>
            <select style={SEL} value={form.email_channel_id || ''} onChange={e => setForm(p => ({ ...p, email_channel_id: e.target.value }))}>
              <option value="">None</option>
              {channels.filter(c => c.type === 'email').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={LBL}>SMS channel</label>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4 }}>Used to reach phone members in groups</div>
            <select style={SEL} value={form.sms_channel_id || ''} onChange={e => setForm(p => ({ ...p, sms_channel_id: e.target.value }))}>
              <option value="">None</option>
              {channels.filter(c => c.type === 'twilio_sms').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      </Section>

      {/* Notifications */}
      <Section title="Notification template">
        <div><label style={LBL}>Message template</label>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 5 }}>Variables: {'{{group_name}} {{value}} {{threshold}} {{date}} {{time}}'}</div>
          <textarea style={{ ...INP, fontFamily: 'var(--font-mono)', fontSize: 11, resize: 'vertical' as const, minHeight: 48 }} value={form.message_template} onChange={e => setForm(p => ({ ...p, message_template: e.target.value }))} placeholder=" {{group_name}} triggered -- value {{value}}, threshold {{threshold}}" />
        </div>
      </Section>

      {/* Save */}
      <div style={{ display: 'flex', gap: 8, paddingTop: 16, paddingBottom: 32 }}>
        <button onClick={saveGroup} disabled={saving || !form.name.trim()} style={{ padding: '8px 20px', background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 500, cursor: saving || !form.name.trim() ? 'not-allowed' : 'pointer', opacity: saving || !form.name.trim() ? 0.5 : 1, fontFamily: 'inherit' }}>
          {saving ? 'Saving...' : editingId ? 'Update group' : 'Create group'}
        </button>
        <button onClick={() => { setView('list'); setEditingId(null) }} style={{ padding: '8px 16px', background: 'var(--surface)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-pill)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
      </div>
    </div>
  )

  return (
    <AppShell user={user}>
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      {topbar}
      {tabStrip}
      {activeTab === 'alerts'     && alertsView}
      {activeTab === 'workflow'    && view === 'list'    && listView}
      {activeTab === 'workflow'    && view === 'detail'  && detailView}
      {activeTab === 'workflow'    && view === 'builder' && builderView}
      {activeTab === 'automation'  && automationView}
      {toast && <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--text)', color: 'var(--bg)', padding: '9px 18px', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 500, boxShadow: 'var(--shadow-lg)', zIndex: 999 }}>{toast}</div>}
    </div>
    </AppShell>
  )
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 16px', marginBottom: 10, boxShadow: 'var(--shadow)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.08em', marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  )
}

'use client'
import { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, SectionLabel, Card, CardRow, Btn, Badge, Field, Grid, Alert, Toggle, Divider } from './ui'

// -- Types -----------------------------------------------------
interface Channel {
  id: string; name: string; type: string; active: boolean
  config: Record<string, unknown>; created_at: string
}
interface Rule {
  id: string; name: string; active: boolean
  trigger_type: string; source_type: string; source_id: string | null
  query: string | null; condition: Record<string, unknown>
  channel_id: string; channel_name: string; channel_type: string
  message_template: string; last_run_at: string | null; next_run_at: string | null
}
interface Run {
  id: string; triggered_at: string; status: string
  message_sent: string | null; error: string | null; latency_ms: number
}
interface NotifGroup {
  id: string; name: string; description: string
  members: Array<{ type: string; address?: string; role?: string; number?: string; group_id?: string; label?: string }>
}

const CHAN_EMPTY = { name: '', type: 'slack', active: true, webhook_url: '', smtp_host: '', smtp_port: '587', smtp_user: '', smtp_pass: '', from_address: '', to_address: '', url: '', account_sid: '', auth_token: '', from_number: '', to_number: '', template_sid: '', content_variables: '' }
const RULE_EMPTY = { name: '', active: true, trigger_type: 'threshold', source_type: 'database', source_id: '', query: '', channel_id: '', message_template: '', op: '<', threshold: '', column: '', interval: '3600' }
const GROUP_EMPTY = { name: '', description: '', members: [] as NotifGroup['members'] }

const CHANNEL_TYPES = [
  { value: 'slack',            label: 'Slack' },
  { value: 'teams',            label: 'Microsoft Teams' },
  { value: 'email',            label: 'Email (SMTP)' },
  { value: 'webhook',          label: 'Webhook' },
  { value: 'twilio_sms',       label: 'Twilio SMS' },
  { value: 'twilio_whatsapp',  label: 'Twilio WhatsApp' },
]
const TRIGGER_TYPES = [
  { value: 'threshold',    label: 'Threshold alert' },
  { value: 'schedule',     label: 'Scheduled report' },
  { value: 'rca_complete', label: 'RCA completed' },
]
const INTERVAL_OPTS = [
  { label: '5 minutes',  value: 300 },
  { label: '15 minutes', value: 900 },
  { label: '1 hour',     value: 3600 },
  { label: '6 hours',    value: 21600 },
  { label: '1 day',      value: 86400 },
  { label: '1 week',     value: 604800 },
]

const INP_S: React.CSSProperties = { width: '100%', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '9px 12px', fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }
const SEL_S: React.CSSProperties = { ...INP_S, cursor: 'pointer' }
const MONO: React.CSSProperties = { ...INP_S, fontFamily: 'var(--font-mono)', fontSize: 12 }

function fmtDate(iso: string | null) {
  if (!iso) return '--'
  const d = new Date(iso)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function fmtInterval(sec: number) {
  if (sec >= 86400) return `${Math.floor(sec / 86400)}d`
  if (sec >= 3600)  return `${Math.floor(sec / 3600)}h`
  if (sec >= 60)    return `${Math.floor(sec / 60)}m`
  return `${sec}s`
}

import React from 'react'

export default function TabIntegrations({ user }: { user: SessionUser }) {
  const [channels,   setChannels]   = useState<Channel[]>([])
  const [rules,      setRules]      = useState<Rule[]>([])
  const [groups,     setGroups]     = useState<NotifGroup[]>([])
  const [loading,    setLoading]    = useState(true)
  const [toast,      setToast]      = useState('')

  // Channel form
  const [showChanForm, setShowChanForm] = useState(false)
  const [chanEditing,  setChanEditing]  = useState<string | null>(null)
  const [chanForm,     setChanForm]     = useState({ ...CHAN_EMPTY })

  // Rule form
  const [showRuleForm, setShowRuleForm] = useState(false)
  const [ruleEditing,  setRuleEditing]  = useState<string | null>(null)
  const [ruleForm,     setRuleForm]     = useState({ ...RULE_EMPTY })
  const [expandedRules, setExpandedRules] = useState<Record<string, boolean>>({})
  const [runLogs,      setRunLogs]      = useState<Record<string, Run[]>>({})

  // Group form
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [groupEditing,  setGroupEditing]  = useState<string | null>(null)
  const [groupForm,     setGroupForm]     = useState<typeof GROUP_EMPTY>({ ...GROUP_EMPTY })

  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 2500); return () => clearTimeout(t) } }, [toast])

  async function load() {
    setLoading(true)
    try {
      const [cr, rr, gr] = await Promise.all([
        fetch('/api/integrations/channels').then(r => r.json()),
        fetch('/api/integrations/rules').then(r => r.json()),
        fetch('/api/integrations/groups').then(r => r.json()).catch(() => ({ groups: [] })),
      ])
      setChannels(cr.channels || [])
      setRules(rr.rules || [])
      setGroups(gr.groups || [])
    } finally { setLoading(false) }
  }

  // -- Channel actions -----------------------------------------
  async function saveChan() {
    if (!chanForm.name.trim()) return
    setSaving(true)
    try {
      const action = chanEditing ? 'update' : 'create'
      const config: Record<string, unknown> = {}
      if (chanForm.type === 'slack' || chanForm.type === 'teams') config.webhook_url = chanForm.webhook_url
      if (chanForm.type === 'webhook') config.url = chanForm.url
      if (chanForm.type === 'email') { config.smtp_host = chanForm.smtp_host; config.smtp_port = Number(chanForm.smtp_port); config.smtp_user = chanForm.smtp_user; config.from_address = chanForm.from_address; if (chanForm.smtp_pass) config.smtp_pass = chanForm.smtp_pass }
      if (chanForm.type === 'twilio_sms' || chanForm.type === 'twilio_whatsapp') { config.account_sid = chanForm.account_sid; config.from_number = chanForm.from_number; config.to_number = chanForm.to_number; if (chanForm.auth_token) config.auth_token = chanForm.auth_token; if (chanForm.type === 'twilio_whatsapp') { config.template_sid = chanForm.template_sid; try { config.content_variables = JSON.parse(chanForm.content_variables || '{}') } catch { config.content_variables = {} } } }
      const body: Record<string, unknown> = { action, name: chanForm.name.trim(), type: chanForm.type, active: chanForm.active, config }
      if (chanEditing) body.id = chanEditing
      await fetch('/api/integrations/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      setShowChanForm(false); setChanEditing(null); setChanForm({ ...CHAN_EMPTY })
      setToast(chanEditing ? 'Channel updated' : 'Channel added')
      await load()
    } finally { setSaving(false) }
  }

  async function testChan(id: string) {
    const r = await fetch('/api/integrations/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test', id }) })
    const d = await r.json()
    setToast(d.ok ? 'Test notification sent ok' : `Test failed: ${d.error}`)
  }

  async function deleteChan(id: string, name: string) {
    if (!confirm(`Delete channel "${name}"?`)) return
    await fetch('/api/integrations/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) })
    setChannels(p => p.filter(c => c.id !== id)); setToast('Channel deleted')
  }

  // -- Rule actions --------------------------------------------
  async function saveRule() {
    if (!ruleForm.name.trim() || !ruleForm.channel_id) return
    setSaving(true)
    try {
      const action = ruleEditing ? 'update' : 'create'
      const condition: Record<string, unknown> = {}
      if (ruleForm.trigger_type === 'threshold') { condition.operator = ruleForm.op; condition.value = Number(ruleForm.threshold); condition.column = ruleForm.column }
      if (ruleForm.trigger_type === 'schedule')  { condition.interval_sec = Number(ruleForm.interval) }
      const body: Record<string, unknown> = { action, name: ruleForm.name.trim(), active: ruleForm.active, trigger_type: ruleForm.trigger_type, source_type: ruleForm.source_type, source_id: ruleForm.source_id || null, query: ruleForm.query || null, condition, channel_id: ruleForm.channel_id, message_template: ruleForm.message_template }
      if (ruleEditing) body.id = ruleEditing
      await fetch('/api/integrations/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      setShowRuleForm(false); setRuleEditing(null); setRuleForm({ ...RULE_EMPTY })
      setToast(ruleEditing ? 'Rule updated' : 'Rule saved')
      await load()
    } finally { setSaving(false) }
  }

  async function toggleRule(id: string) {
    await fetch('/api/integrations/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'toggle', id }) })
    setRules(p => p.map(r => r.id === id ? { ...r, active: !r.active } : r))
  }

  async function deleteRule(id: string, name: string) {
    if (!confirm(`Delete rule "${name}"?`)) return
    await fetch('/api/integrations/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) })
    setRules(p => p.filter(r => r.id !== id)); setToast('Rule deleted')
  }

  async function loadRuns(ruleId: string) {
    const r = await fetch('/api/integrations/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get_runs', rule_id: ruleId }) })
    const d = await r.json()
    setRunLogs(p => ({ ...p, [ruleId]: d.runs || [] }))
  }

  // -- Group actions -------------------------------------------
  async function saveGroup() {
    if (!groupForm.name.trim() || !groupForm.members.length) return
    setSaving(true)
    try {
      const action = groupEditing ? 'update' : 'create'
      const body: Record<string, unknown> = { action, name: groupForm.name.trim(), description: groupForm.description, members: groupForm.members }
      if (groupEditing) body.id = groupEditing
      await fetch('/api/integrations/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      setShowGroupForm(false); setGroupEditing(null); setGroupForm({ ...GROUP_EMPTY })
      setToast(groupEditing ? 'Group updated' : 'Group saved')
      await load()
    } finally { setSaving(false) }
  }

  async function deleteGroup(id: string, name: string) {
    if (!confirm(`Delete group "${name}"?`)) return
    await fetch('/api/integrations/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) })
    setGroups(p => p.filter(g => g.id !== id)); setToast('Group deleted')
  }

  const isAdmin = user.role === 'admin'

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60, color: 'var(--text3)', fontSize: 13 }}>Loading...</div>

  const channelTypeLabel = (t: string) => CHANNEL_TYPES.find(c => c.value === t)?.label ?? t
  const triggerTypeLabel = (t: string) => TRIGGER_TYPES.find(x => x.value === t)?.label ?? t
  const conditionSummary = (rule: Rule) => {
    const c = rule.condition
    if (rule.trigger_type === 'threshold')    return `When ${c.column} ${c.operator} ${c.value}`
    if (rule.trigger_type === 'schedule')     return `Every ${fmtInterval(Number(c.interval_sec || 3600))}`
    if (rule.trigger_type === 'rca_complete') return 'When an RCA session completes'
    return ''
  }

  return (
    <div>
      <PageTitle>Integrations</PageTitle>
      <PageSub>Connect Mosaic to Slack, Teams, email, SMS, and WhatsApp. Rules fire automatically via Vercel Cron (every minute).</PageSub>

      {/* -- CHANNELS -------------------------------------------- */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <SectionLabel>Channels</SectionLabel>
        {isAdmin && <Btn size="sm" variant="primary" onClick={() => { setShowChanForm(true); setChanEditing(null); setChanForm({ ...CHAN_EMPTY }) }}>+ Add channel</Btn>}
      </div>

      {showChanForm && (
        <div className="fade-in" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 18, marginBottom: 14, boxShadow: 'var(--shadow-md)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>{chanEditing ? 'Edit channel' : 'New channel'}</div>
          <Grid cols={2}>
            <Field label="Name" required>
              <input style={INP_S} value={chanForm.name} onChange={e => setChanForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Production Slack" />
            </Field>
            <Field label="Type">
              <select style={SEL_S} value={chanForm.type} onChange={e => setChanForm(p => ({ ...p, type: e.target.value }))}>
                {CHANNEL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
          </Grid>
          {(chanForm.type === 'slack' || chanForm.type === 'teams') && (
            <Field label="Webhook URL" required><input style={MONO} value={chanForm.webhook_url} onChange={e => setChanForm(p => ({ ...p, webhook_url: e.target.value }))} placeholder="https://hooks.slack.com/services/..." /></Field>
          )}
          {chanForm.type === 'webhook' && (
            <Field label="URL" required><input style={MONO} value={chanForm.url} onChange={e => setChanForm(p => ({ ...p, url: e.target.value }))} placeholder="https://cmms.company.com/api/alerts" /></Field>
          )}
          {chanForm.type === 'email' && (
            <>
              <Grid cols={2}><Field label="SMTP host" required><input style={INP_S} value={chanForm.smtp_host} onChange={e => setChanForm(p => ({ ...p, smtp_host: e.target.value }))} placeholder="smtp.gmail.com" /></Field><Field label="SMTP port"><input style={INP_S} type="number" value={chanForm.smtp_port} onChange={e => setChanForm(p => ({ ...p, smtp_port: e.target.value }))} /></Field></Grid>
              <Grid cols={2}><Field label="From address" required><input style={INP_S} value={chanForm.from_address} onChange={e => setChanForm(p => ({ ...p, from_address: e.target.value }))} placeholder="alerts@company.com" /></Field><Field label="SMTP username"><input style={INP_S} value={chanForm.smtp_user} onChange={e => setChanForm(p => ({ ...p, smtp_user: e.target.value }))} /></Field></Grid>
              <Field label="SMTP password" hint="Stored encrypted"><input style={{ ...INP_S }} type="password" value={chanForm.smtp_pass} onChange={e => setChanForm(p => ({ ...p, smtp_pass: e.target.value }))} placeholder="Stored encrypted" /></Field>
            </>
          )}
          {(chanForm.type === 'twilio_sms' || chanForm.type === 'twilio_whatsapp') && (
            <>
              <Alert variant={chanForm.type === 'twilio_whatsapp' ? 'warning' : 'info'}>
                {chanForm.type === 'twilio_whatsapp' ? 'WhatsApp requires a Meta-approved message template. Register in Meta Business Manager and enter the Content Template SID below.' : 'SMS via Twilio. Credentials are encrypted at rest. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in Vercel environment variables.'}
              </Alert>
              <Grid cols={2}><Field label="Account SID" required><input style={MONO} value={chanForm.account_sid} onChange={e => setChanForm(p => ({ ...p, account_sid: e.target.value }))} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" /></Field><Field label="Auth token" hint="Stored encrypted"><input style={MONO} type="password" value={chanForm.auth_token} onChange={e => setChanForm(p => ({ ...p, auth_token: e.target.value }))} placeholder="Stored encrypted" /></Field></Grid>
              <Grid cols={2}><Field label="From number" required hint="E.164 format"><input style={MONO} value={chanForm.from_number} onChange={e => setChanForm(p => ({ ...p, from_number: e.target.value }))} placeholder="+14155552671" /></Field><Field label="To number" required hint="E.164 format"><input style={MONO} value={chanForm.to_number} onChange={e => setChanForm(p => ({ ...p, to_number: e.target.value }))} placeholder="+919876543210" /></Field></Grid>
              {chanForm.type === 'twilio_whatsapp' && (
                <Grid cols={2}><Field label="Content Template SID" hint="From Twilio Console  Messaging  Content Editor"><input style={MONO} value={chanForm.template_sid} onChange={e => setChanForm(p => ({ ...p, template_sid: e.target.value }))} placeholder="HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" /></Field><Field label="Template variables (JSON)" hint={'Map {{n}} slots to rule variables e.g. {"1":"{{value}}"}'} ><input style={MONO} value={chanForm.content_variables} onChange={e => setChanForm(p => ({ ...p, content_variables: e.target.value }))} /></Field></Grid>
              )}
            </>
          )}
          <div style={{ display: 'flex', gap: 8, paddingTop: 12, borderTop: '1px solid var(--border)', marginTop: 4 }}>
            <Btn variant="primary" onClick={saveChan} disabled={saving || !chanForm.name.trim()}>{saving ? 'Saving...' : chanEditing ? 'Update' : 'Save channel'}</Btn>
            <Btn onClick={() => { setShowChanForm(false); setChanEditing(null) }}>Cancel</Btn>
          </div>
        </div>
      )}

      {channels.length === 0 && !showChanForm ? (
        <Alert variant="info">No channels configured. Add one to start sending notifications.</Alert>
      ) : (
        channels.map(ch => (
          <Card key={ch.id}>
            <CardRow>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <Badge label={channelTypeLabel(ch.type)} color={ch.active ? 'green' : 'gray'} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{ch.name}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                  {ch.type === 'email' ? `From: ${ch.config.from_address || '--'}` :
                   ch.type === 'twilio_sms' || ch.type === 'twilio_whatsapp' ? `${ch.config.from_number || '--'}  ${ch.config.to_number || '--'}` :
                   ch.type === 'webhook' ? String(ch.config.url || '--') : 'Incoming webhook configured'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <Btn size="sm" onClick={() => testChan(ch.id)}>Test</Btn>
                {isAdmin && <>
                  <Btn size="sm" onClick={() => { setChanEditing(ch.id); setChanForm({ name: ch.name, type: ch.type, active: ch.active, webhook_url: String(ch.config.webhook_url || ''), smtp_host: String(ch.config.smtp_host || ''), smtp_port: String(ch.config.smtp_port || 587), smtp_user: String(ch.config.smtp_user || ''), smtp_pass: '', from_address: String(ch.config.from_address || ''), to_address: String(ch.config.to_address || ''), url: String(ch.config.url || ''), account_sid: String(ch.config.account_sid || ''), auth_token: '', from_number: String(ch.config.from_number || ''), to_number: String(ch.config.to_number || ''), template_sid: String(ch.config.template_sid || ''), content_variables: ch.config.content_variables ? JSON.stringify(ch.config.content_variables) : '' }); setShowChanForm(true) }}>Edit</Btn>
                  <Btn size="sm" variant="danger" onClick={() => deleteChan(ch.id, ch.name)}>Delete</Btn>
                </>}
              </div>
            </CardRow>
          </Card>
        ))
      )}

      <Divider />

      {/* -- RULES ----------------------------------------------- */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <SectionLabel>Rules</SectionLabel>
        {isAdmin && <Btn size="sm" variant="primary" onClick={() => { setShowRuleForm(true); setRuleEditing(null); setRuleForm({ ...RULE_EMPTY }) }}>+ Add rule</Btn>}
      </div>

      {showRuleForm && (
        <div className="fade-in" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 18, marginBottom: 14, boxShadow: 'var(--shadow-md)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>{ruleEditing ? 'Edit rule' : 'New rule'}</div>
          <Grid cols={2}>
            <Field label="Rule name" required><input style={INP_S} value={ruleForm.name} onChange={e => setRuleForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. OEE below 75% alert" /></Field>
            <Field label="Trigger type"><select style={SEL_S} value={ruleForm.trigger_type} onChange={e => setRuleForm(p => ({ ...p, trigger_type: e.target.value }))}>{TRIGGER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></Field>
          </Grid>
          {ruleForm.trigger_type === 'threshold' && (
            <>
              <Grid cols={3}>
                <Field label="Column *"><input style={MONO} value={ruleForm.column} onChange={e => setRuleForm(p => ({ ...p, column: e.target.value }))} placeholder="e.g. oee_pct" /></Field>
                <Field label="Operator"><select style={SEL_S} value={ruleForm.op} onChange={e => setRuleForm(p => ({ ...p, op: e.target.value }))}>{['<','<=','>','>=','=='].map(op => <option key={op} value={op}>{op}</option>)}</select></Field>
                <Field label="Value *"><input style={INP_S} type="number" value={ruleForm.threshold} onChange={e => setRuleForm(p => ({ ...p, threshold: e.target.value }))} placeholder="75" /></Field>
              </Grid>
              <Field label="SQL query" hint="Runs against the selected data source"><input style={MONO} value={ruleForm.query || ''} onChange={e => setRuleForm(p => ({ ...p, query: e.target.value }))} placeholder="SELECT avg(oee_pct) as oee_pct FROM oee_hourly WHERE time > now()-5m" /></Field>
            </>
          )}
          {ruleForm.trigger_type === 'schedule' && (
            <Grid cols={2}>
              <Field label="Run every"><select style={SEL_S} value={ruleForm.interval} onChange={e => setRuleForm(p => ({ ...p, interval: e.target.value }))}>{INTERVAL_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
              <Field label="SQL query"><input style={MONO} value={ruleForm.query || ''} onChange={e => setRuleForm(p => ({ ...p, query: e.target.value }))} placeholder="SELECT line, avg(oee_pct) FROM oee_daily GROUP BY line" /></Field>
            </Grid>
          )}
          {ruleForm.trigger_type === 'rca_complete' && (
            <Alert variant="info">Fires automatically when any RCA session produces a completed output. No query needed.</Alert>
          )}
          <Grid cols={2}>
            <Field label="Channel *"><select style={SEL_S} value={ruleForm.channel_id} onChange={e => setRuleForm(p => ({ ...p, channel_id: e.target.value }))}><option value="">Select channel...</option>{channels.map(c => <option key={c.id} value={c.id}>{c.name} ({channelTypeLabel(c.type)})</option>)}</select></Field>
            <Field label="Message template" hint="Variables: {value} {threshold} {column} {source} {title} {date} {time} {table}"><input style={INP_S} value={ruleForm.message_template} onChange={e => setRuleForm(p => ({ ...p, message_template: e.target.value }))} placeholder="OEE dropped to {value}% on {date}" /></Field>
          </Grid>
          <div style={{ display: 'flex', gap: 8, paddingTop: 12, borderTop: '1px solid var(--border)', marginTop: 4 }}>
            <Btn variant="primary" onClick={saveRule} disabled={saving || !ruleForm.name.trim() || !ruleForm.channel_id}>{saving ? 'Saving...' : ruleEditing ? 'Update' : 'Save rule'}</Btn>
            <Btn onClick={() => { setShowRuleForm(false); setRuleEditing(null) }}>Cancel</Btn>
          </div>
        </div>
      )}

      {rules.length === 0 && !showRuleForm ? (
        <Alert variant="info">No rules defined. Add a rule to start sending automated notifications.</Alert>
      ) : (
        rules.map(rule => {
          const expanded = expandedRules[rule.id]
          return (
            <Card key={rule.id}>
              <CardRow>
                <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => { const next = { ...expandedRules, [rule.id]: !expanded }; setExpandedRules(next); if (!expanded && !runLogs[rule.id]) loadRuns(rule.id) }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <Badge label={triggerTypeLabel(rule.trigger_type)} color={rule.trigger_type === 'threshold' ? 'red' : rule.trigger_type === 'schedule' ? 'blue' : 'purple'} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{rule.name}</span>
                    <Badge label={rule.active ? 'Active' : 'Paused'} color={rule.active ? 'green' : 'gray'} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 12 }}>
                    <span>{conditionSummary(rule)}</span>
                    <span> {rule.channel_name}</span>
                    {rule.next_run_at && <span>Next: {fmtDate(rule.next_run_at)}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {isAdmin && <>
                    <Btn size="sm" onClick={() => toggleRule(rule.id)}>{rule.active ? 'Pause' : 'Resume'}</Btn>
                    <Btn size="sm" onClick={() => { setRuleEditing(rule.id); setRuleForm({ name: rule.name, active: rule.active, trigger_type: rule.trigger_type, source_type: rule.source_type, source_id: rule.source_id || '', query: rule.query || '', channel_id: rule.channel_id, message_template: rule.message_template, op: String(rule.condition.operator || '<'), threshold: String(rule.condition.value || ''), column: String(rule.condition.column || ''), interval: String(rule.condition.interval_sec || 3600) }); setShowRuleForm(true) }}>Edit</Btn>
                    <Btn size="sm" variant="danger" onClick={() => deleteRule(rule.id, rule.name)}>Delete</Btn>
                  </>}
                </div>
              </CardRow>
              {expanded && (
                <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.07em', marginBottom: 5 }}>Message template</div>
                  <code style={{ fontSize: 11, background: 'var(--bg3)', padding: '4px 8px', borderRadius: 4, color: 'var(--text2)', display: 'block', marginBottom: 12 }}>{rule.message_template || '(none)'}</code>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.07em', marginBottom: 6 }}>Recent runs</div>
                  {(runLogs[rule.id] || []).length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text4)' }}>No runs yet</div>
                  ) : (
                    <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                      {(runLogs[rule.id] || []).map(run => (
                        <div key={run.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 11 }}>
                          <span style={{ fontWeight: 600, color: run.status === 'sent' ? 'var(--green-t)' : run.status === 'error' ? 'var(--red-t)' : 'var(--text3)', flexShrink: 0 }}>{run.status}</span>
                          <span style={{ color: 'var(--text3)', flexShrink: 0 }}>{fmtDate(run.triggered_at)}</span>
                          {run.message_sent && <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text2)' }}>{run.message_sent}</span>}
                          {run.error && <span style={{ color: 'var(--red-t)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.error}</span>}
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text4)', flexShrink: 0 }}>{run.latency_ms}ms</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          )
        })
      )}

      <Divider />

      {/* -- RECIPIENT GROUPS ------------------------------------ */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <SectionLabel>Recipient groups</SectionLabel>
        {isAdmin && <Btn size="sm" variant="primary" onClick={() => { setShowGroupForm(true); setGroupEditing(null); setGroupForm({ ...GROUP_EMPTY }) }}>+ Add group</Btn>}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>Named lists of email addresses, phone numbers, and user roles. Reference them in email/SMS/WhatsApp channel configs.</div>

      {showGroupForm && (
        <div className="fade-in" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 18, marginBottom: 14, boxShadow: 'var(--shadow-md)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>{groupEditing ? 'Edit group' : 'New recipient group'}</div>
          <Grid cols={2}>
            <Field label="Group name" required><input style={INP_S} value={groupForm.name} onChange={e => setGroupForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. QA Team" /></Field>
            <Field label="Description"><input style={INP_S} value={groupForm.description} onChange={e => setGroupForm(p => ({ ...p, description: e.target.value }))} placeholder="Who is in this group?" /></Field>
          </Grid>
          <Field label="Members">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, minHeight: 36, background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', marginBottom: 8 }}>
              {groupForm.members.map((m, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '2px 8px', borderRadius: 99, background: m.type === 'role' ? 'var(--blue-bg)' : m.type === 'phone' ? 'var(--green-bg)' : 'var(--bg3)', border: '1px solid var(--border)', color: m.type === 'role' ? 'var(--blue-t)' : 'var(--text2)' }}>
                  {m.type === 'email' ? m.address : m.type === 'phone' ? m.number : `Role: ${m.role}`}
                  <button onClick={() => setGroupForm(p => ({ ...p, members: p.members.filter((_, j) => j !== i) }))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text4)', fontSize: 13, lineHeight: 1, padding: 0, marginLeft: 2 }}></button>
                </span>
              ))}
              {!groupForm.members.length && <span style={{ fontSize: 11, color: 'var(--text4)' }}>No members yet</span>}
            </div>
            <AddMemberRow onAdd={m => setGroupForm(p => ({ ...p, members: [...p.members, m] }))} />
          </Field>
          <div style={{ display: 'flex', gap: 8, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <Btn variant="primary" onClick={saveGroup} disabled={saving || !groupForm.name.trim() || !groupForm.members.length}>{saving ? 'Saving...' : groupEditing ? 'Update' : 'Save group'}</Btn>
            <Btn onClick={() => { setShowGroupForm(false); setGroupEditing(null) }}>Cancel</Btn>
          </div>
        </div>
      )}

      {groups.length === 0 && !showGroupForm ? (
        <Alert variant="info">No recipient groups defined. Create groups to easily target teams across multiple notification rules.</Alert>
      ) : (
        groups.map(g => (
          <Card key={g.id}>
            <CardRow>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{g.name}</div>
                {g.description && <div style={{ fontSize: 12, color: 'var(--text3)' }}>{g.description} . <strong style={{ color: 'var(--text2)' }}>{g.members.length} members</strong></div>}
              </div>
              {isAdmin && (
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <Btn size="sm" onClick={() => { setGroupEditing(g.id); setGroupForm({ name: g.name, description: g.description, members: [...g.members] }); setShowGroupForm(true) }}>Edit</Btn>
                  <Btn size="sm" variant="danger" onClick={() => deleteGroup(g.id, g.name)}>Delete</Btn>
                </div>
              )}
            </CardRow>
            <div style={{ padding: '8px 18px 10px', display: 'flex', flexWrap: 'wrap', gap: 4, borderTop: '1px solid var(--border)' }}>
              {g.members.map((m, i) => (
                <span key={i} style={{ fontSize: 11, padding: '1px 7px', borderRadius: 99, background: m.type === 'role' ? 'var(--blue-bg)' : m.type === 'phone' ? 'var(--green-bg)' : 'var(--bg3)', border: '1px solid var(--border)', color: m.type === 'role' ? 'var(--blue-t)' : 'var(--text2)' }}>
                  {m.type === 'email' ? `@ ${m.address}` : m.type === 'phone' ? ` ${m.number}` : `Role: ${m.role}`}
                </span>
              ))}
            </div>
          </Card>
        ))
      )}

      <Divider />

      {/* -- SCHEDULER STATUS ------------------------------------ */}
      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--blue-t)" strokeWidth="1.4" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="7" cy="7" r="6"/><path d="M7 4v3.5l2.5 1.5"/></svg>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>Scheduler: Vercel Cron . every minute</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.6 }}>
            Defined in <code style={{ background: 'var(--bg3)', padding: '1px 5px', borderRadius: 3, fontSize: 10 }}>vercel.json</code>.
            Calls <code style={{ background: 'var(--bg3)', padding: '1px 5px', borderRadius: 3, fontSize: 10 }}>POST /api/integrations/scheduler</code> every minute.
            Only processes rules whose <code style={{ background: 'var(--bg3)', padding: '1px 5px', borderRadius: 3, fontSize: 10 }}>next_run_at</code> has passed.
            Set <code style={{ background: 'var(--bg3)', padding: '1px 5px', borderRadius: 3, fontSize: 10 }}>CRON_SECRET</code> in Vercel env to secure the endpoint.
          </div>
        </div>
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--text)', color: 'var(--bg)', padding: '9px 18px', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 500, boxShadow: 'var(--shadow-lg)', zIndex: 999 }}>{toast}</div>
      )}
    </div>
  )
}

// -- Add member sub-component ----------------------------------
function AddMemberRow({ onAdd }: { onAdd: (m: { type: string; address?: string; number?: string; role?: string }) => void }) {
  const [type, setType] = useState('email')
  const [val,  setVal]  = useState('')

  function add() {
    if (!val) return
    if (type === 'email'  && !val.includes('@')) return
    if (type === 'phone'  && !val.startsWith('+')) return
    onAdd(type === 'email' ? { type, address: val } : type === 'phone' ? { type, number: val } : { type, role: val })
    setVal('')
  }

  return (
    <div style={{ display: 'flex', gap: 7, alignItems: 'flex-end' }}>
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Add by</div>
        <select style={{ background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '7px 10px', fontSize: 12, color: 'var(--text)', outline: 'none', cursor: 'pointer', width: 120, fontFamily: 'inherit' }} value={type} onChange={e => { setType(e.target.value); setVal('') }}>
          <option value="email">Email</option>
          <option value="phone">Phone (SMS/WA)</option>
          <option value="role">Role</option>
        </select>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{type === 'email' ? 'Email address' : type === 'phone' ? 'Phone number (E.164)' : 'User role'}</div>
        {type === 'role' ? (
          <select style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '7px 10px', fontSize: 12, color: 'var(--text)', outline: 'none', cursor: 'pointer', fontFamily: 'inherit' }} value={val} onChange={e => setVal(e.target.value)}>
            <option value="">Select...</option>
            <option value="admin">All admins</option>
            <option value="user">All users</option>
          </select>
        ) : (
          <input style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '7px 10px', fontSize: 12, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }}
            value={val} onChange={e => setVal(e.target.value)}
            placeholder={type === 'email' ? 'user@company.com' : '+919876543210'}
            onKeyDown={e => { if (e.key === 'Enter') add() }} />
        )}
      </div>
      <Btn size="sm" onClick={add}>Add</Btn>
    </div>
  )
}

'use client'
import { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, INP, Btn, Badge, Alert, Spinner } from './ui'
import { safeJson } from '@/lib/fetch'

const KEY_SECTIONS = [
  { title: 'Anthropic',                keys: ['ANTHROPIC_API_KEY'] },
  { title: 'AI & Search',              keys: ['TAVILY_API_KEY'] },
  { title: 'App Configuration',        keys: ['NEXT_PUBLIC_APP_URL', 'CRON_SECRET'] },
  { title: 'Database',                 keys: ['DATABASE_URL'] },
  { title: 'GitHub — Update Checker',  keys: ['GITHUB_TOKEN', 'GITHUB_REPO'] },
  { title: 'Superset Analytics',       keys: ['SUPERSET_URL', 'SUPERSET_ADMIN_USER', 'SUPERSET_ADMIN_PASSWORD'] },
  { title: 'Airbyte Connectors',       keys: ['AIRBYTE_USER', 'AIRBYTE_PASSWORD'] },
  { title: 'Notifications — Twilio',   keys: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] },
  { title: 'n8n Automation',           keys: ['N8N_URL', 'N8N_API_KEY', 'N8N_MOSAIC_API_KEY'] },
]

const KEY_META: Record<string, { label: string; hint: string; placeholder: string; secret?: boolean }> = {
  ANTHROPIC_API_KEY:       { label: 'Anthropic API key',        hint: 'Powers all Mosaic AI completions · get it from console.anthropic.com',              placeholder: 'sk-ant-api03-...', secret: true },
  TAVILY_API_KEY:          { label: 'Tavily API key',           hint: 'Web search · free tier at app.tavily.com · 1,000 searches/month',                   placeholder: 'tvly-...', secret: true },
  NEXT_PUBLIC_APP_URL:     { label: 'App URL',                  hint: 'Public URL of this Mosaic instance · used in emails and SSO callbacks',              placeholder: 'https://mosaic.yourcompany.com' },
  CRON_SECRET:             { label: 'Cron secret',              hint: 'Protects the scheduler endpoint · set a random string',                              placeholder: 'Random secret string', secret: true },
  DATABASE_URL:            { label: 'Database URL',             hint: 'Leave blank for SQLite · set postgresql://... for Neon or Postgres cloud',           placeholder: 'postgresql://user:pass@host/db?sslmode=require', secret: true },
  GITHUB_TOKEN:            { label: 'GitHub token',             hint: 'Fine-grained PAT with Contents read-only · used to check for Mosaic updates',       placeholder: 'github_pat_...', secret: true },
  GITHUB_REPO:             { label: 'GitHub repo',              hint: 'Repository to check for updates · format: owner/repo',                               placeholder: 'ankurisb/Mosaic' },
  SUPERSET_URL:            { label: 'Superset URL',             hint: 'Base URL of your Superset instance · default http://localhost:8088',                 placeholder: 'http://localhost:8088' },
  SUPERSET_ADMIN_USER:     { label: 'Superset admin user',      hint: 'Superset admin username · default: admin',                                           placeholder: 'admin' },
  SUPERSET_ADMIN_PASSWORD: { label: 'Superset admin password',  hint: 'Superset admin password · stored encrypted',                                        placeholder: 'Stored encrypted', secret: true },
  AIRBYTE_USER:            { label: 'Airbyte username',         hint: 'Airbyte API username · default: airbyte',                                            placeholder: 'airbyte' },
  AIRBYTE_PASSWORD:        { label: 'Airbyte password',         hint: 'Airbyte API password · stored encrypted',                                            placeholder: 'Stored encrypted', secret: true },
  TWILIO_ACCOUNT_SID:      { label: 'Twilio Account SID',       hint: 'Required for SMS and WhatsApp · found in Twilio Console',                            placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
  TWILIO_AUTH_TOKEN:       { label: 'Twilio Auth Token',        hint: 'Paired with Account SID · stored encrypted',                                        placeholder: 'Stored encrypted', secret: true },
  N8N_URL:                 { label: 'n8n URL',                  hint: 'Base URL of your n8n instance · default: http://localhost:5678',                    placeholder: 'http://localhost:5678' },
  N8N_API_KEY:             { label: 'n8n API key',              hint: 'Generated in n8n Settings → API · used by Mosaic to import workflows',              placeholder: 'n8n_...', secret: true },
  N8N_MOSAIC_API_KEY:      { label: 'Mosaic API key (for n8n)', hint: 'Paste into n8n as Header Auth credential · n8n uses this to call Mosaic',           placeholder: 'Generate below' },
}

const SECTION_LINKS: Record<string, { envKey: string; defaultUrl: string }> = {
  'Superset Analytics': { envKey: 'SUPERSET_URL',  defaultUrl: 'http://localhost:8088' },
  'Airbyte Connectors': { envKey: 'AIRBYTE_URL',   defaultUrl: 'http://localhost:8080' },
  'n8n Automation':     { envKey: 'N8N_URL',        defaultUrl: 'http://localhost:5678' },
}

export default function TabKeys({ user }: { user: SessionUser }) {
  const [keys,    setKeys]    = useState<Record<string, { configured: boolean; preview: string }>>({})
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [vals,    setVals]    = useState<Record<string, string>>({})
  const [saving,  setSaving]  = useState<string | null>(null)
  const [toast,   setToast]   = useState('')

  useEffect(() => { load() }, [])
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 2500); return () => clearTimeout(t) } }, [toast])

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/keys')
      const d = await r.json()
      setKeys(d.keys || {})
    } finally { setLoading(false) }
  }

  async function save(key: string) {
    if (!vals[key]?.trim()) return
    setSaving(key)
    try {
      const r = await fetch('/api/keys', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set', key, value: vals[key] }),
      })
      const { data: d, error: err } = await safeJson<{ ok?: boolean }>(r)
      if (err) { setToast('Error: ' + err); return }
      if (d?.ok) {
        setKeys(p => ({ ...p, [key]: { configured: true, preview: vals[key].slice(0,4) + '...' } }))
        setVals(p => ({ ...p, [key]: '' }))
        setEditing(null)
        setToast('Saved')
      }
    } catch (e) { setToast('Error: ' + (e instanceof Error ? e.message : 'Save failed')) }
    finally { setSaving(null) }
  }

  async function remove(key: string) {
    if (!confirm(`Remove ${KEY_META[key]?.label ?? key}?`)) return
    await fetch('/api/keys', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', key }),
    })
    setKeys(p => ({ ...p, [key]: { configured: false, preview: '' } }))
    setToast('Removed')
  }

  if (user.role !== 'admin') return (
    <div className="fade-in"><PageTitle>API keys & configuration</PageTitle><Alert variant="warning">Only admins can manage keys.</Alert></div>
  )

  return (
    <div className="fade-in">
      <PageTitle>API keys & configuration</PageTitle>
      <PageSub>Stored encrypted in the database. Set here instead of editing .env.local directly.</PageSub>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 2000, padding: '10px 18px', background: 'var(--green-bg)', border: '1px solid rgba(22,163,74,.2)', borderRadius: 'var(--radius)', fontSize: 13, color: 'var(--green-t)', fontWeight: 500, boxShadow: 'var(--shadow-lg)' }}>
          {toast}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={20} /></div>
      ) : (
        <>
          {KEY_SECTIONS.map(section => (
            <div key={section.title} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                {section.title}
                {SECTION_LINKS[section.title] && (() => {
                  const link = SECTION_LINKS[section.title]
                  const urlKey = keys[link.envKey]
                  const href = urlKey?.configured ? undefined : link.defaultUrl
                  return (
                    <a href={href ?? link.defaultUrl} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 10, color: 'var(--text4)', textDecoration: 'none', fontWeight: 500, opacity: .8, textTransform: 'none', letterSpacing: 0 }}
                      title={`Open ${section.title}`}>↗</a>
                  )
                })()}
              </div>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
                {section.keys.map((key, i) => {
                  const meta = KEY_META[key]
                  if (!meta) return null
                  const status = keys[key]
                  const isEditing = editing === key
                  return (
                    <div key={key} style={{ padding: '14px 18px', borderBottom: i < section.keys.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
                            {meta.label}
                            {status?.configured
                              ? <Badge label="configured" color="green" />
                              : <Badge label="not set" color="amber" />}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: isEditing ? 10 : 0 }}>{meta.hint}</div>
                          {status?.configured && !isEditing && (
                            <div style={{ fontSize: 11, color: 'var(--text4)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{status.preview}</div>
                          )}
                          {isEditing && (
                            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                              <input
                                type={meta.secret ? 'password' : 'text'}
                                style={{ ...INP, flex: 1, fontFamily: meta.secret ? 'var(--font-mono)' : 'inherit', fontSize: 12 }}
                                placeholder={meta.placeholder}
                                value={vals[key] || ''}
                                onChange={e => setVals(p => ({ ...p, [key]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') save(key); if (e.key === 'Escape') setEditing(null) }}
                                autoFocus
                              />
                              <Btn variant="primary" onClick={() => save(key)} disabled={saving === key}>
                                {saving === key ? <Spinner size={12} /> : 'Save'}
                              </Btn>
                              <Btn onClick={() => setEditing(null)}>Cancel</Btn>
                            </div>
                          )}
                        </div>
                        {!isEditing && (
                          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                            <Btn size="sm" onClick={() => { setEditing(key); setVals(p => ({ ...p, [key]: '' })) }}>
                              {status?.configured ? 'Update' : 'Set'}
                            </Btn>
                            {status?.configured && (
                              <Btn size="sm" variant="danger" onClick={() => remove(key)}>Remove</Btn>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

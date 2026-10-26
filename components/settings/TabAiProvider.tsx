'use client'
import { useState, useEffect, useCallback } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, SectionLabel, Card, INP, Btn, Badge, Alert, Spinner } from './ui'
import { safeJson } from '@/lib/fetch'

type Provider = 'anthropic' | 'bedrock' | 'foundry'

interface KeyStatus { configured: boolean; source?: 'kv' | 'env' | 'none'; preview: string; value?: string }

const PROVIDERS: { id: Provider; name: string; blurb: string }[] = [
  { id: 'anthropic', name: 'Anthropic API',     blurb: 'Direct to Anthropic. Simplest to set up — just an API key.' },
  { id: 'bedrock',   name: 'Amazon Bedrock',    blurb: 'Claude runs inside your AWS account. Data stays in your AWS region.' },
  { id: 'foundry',   name: 'Azure AI Foundry',  blurb: 'Claude runs inside your Azure tenancy. Data stays in your Azure region.' },
]

interface FieldDef { key: string; label: string; hint: string; placeholder: string; secret?: boolean; optional?: boolean }

const FIELDS: Record<Provider, FieldDef[]> = {
  anthropic: [
    { key: 'ANTHROPIC_API_KEY', label: 'API key', hint: 'From console.anthropic.com', placeholder: 'sk-ant-api03-...', secret: true },
  ],
  bedrock: [
    { key: 'BEDROCK_REGION', label: 'AWS region', hint: 'Region where Claude models are enabled for your account', placeholder: 'us-east-1' },
    { key: 'BEDROCK_MODEL', label: 'Model / inference-profile id', hint: 'The Bedrock model id used for chat & RCA', placeholder: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0' },
    { key: 'BEDROCK_MODEL_FAST', label: 'Fast model id', hint: 'Cheaper model for routing & short helper calls', placeholder: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', optional: true },
    { key: 'BEDROCK_MODEL_TOP', label: 'Top model id', hint: 'Most capable model for the hardest queries', placeholder: 'us.anthropic.claude-opus-...-v1:0', optional: true },
    { key: 'BEDROCK_ACCESS_KEY_ID', label: 'Access key id', hint: 'Leave blank to use the instance/task IAM role (recommended)', placeholder: 'Using IAM role', secret: true, optional: true },
    { key: 'BEDROCK_SECRET_ACCESS_KEY', label: 'Secret access key', hint: 'Only if not using an IAM role', placeholder: 'Using IAM role', secret: true, optional: true },
    { key: 'BEDROCK_SESSION_TOKEN', label: 'Session token', hint: 'Only for temporary STS credentials', placeholder: 'Optional', secret: true, optional: true },
  ],
  foundry: [
    { key: 'FOUNDRY_BASE_URL', label: 'Base URL', hint: 'Your Foundry resource endpoint', placeholder: 'https://<resource>.services.ai.azure.com/anthropic' },
    { key: 'FOUNDRY_API_KEY', label: 'API key', hint: 'Foundry resource key (Keys and Endpoint page)', placeholder: 'Azure API key', secret: true },
    { key: 'FOUNDRY_DEPLOYMENT', label: 'Deployment id', hint: 'The Azure deployment name used as the model', placeholder: 'claude-sonnet-4-5', },
    { key: 'FOUNDRY_DEPLOYMENT_FAST', label: 'Fast deployment id', hint: 'Cheaper deployment for routing & short helper calls', placeholder: 'claude-haiku-4-5', optional: true },
    { key: 'FOUNDRY_DEPLOYMENT_TOP', label: 'Top deployment id', hint: 'Most capable deployment for the hardest queries', placeholder: 'claude-opus-...', optional: true },
  ],
}

export default function TabAiProvider({ user }: { user: SessionUser }) {
  const [keys, setKeys] = useState<Record<string, KeyStatus>>({})
  const [provider, setProvider] = useState<Provider>('anthropic')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [vals, setVals] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; model?: string; latencyMs?: number; error?: string; reply?: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/keys')
      const d = await r.json()
      const k: Record<string, KeyStatus> = d.keys || {}
      setKeys(k)
      const p = (k['AI_PROVIDER']?.value || '').toLowerCase()
      if (p === 'bedrock' || p === 'foundry') setProvider(p)
      else setProvider('anthropic')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 2500); return () => clearTimeout(t) } }, [toast])

  async function saveKey(key: string, value: string) {
    const r = await fetch('/api/keys', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set', key, value }),
    })
    const { data, error } = await safeJson<{ ok?: boolean }>(r)
    if (error || !data?.ok) throw new Error(error || 'Save failed')
  }

  async function selectProvider(p: Provider) {
    if (p === provider) return
    setProvider(p)
    setTestResult(null)
    try {
      await saveKey('AI_PROVIDER', p)
      setKeys(prev => ({ ...prev, AI_PROVIDER: { configured: true, source: 'kv', preview: p, value: p } }))
      setToast(`Provider set to ${PROVIDERS.find(x => x.id === p)!.name}`)
    } catch (e) { setToast('Error: ' + (e instanceof Error ? e.message : 'failed')) }
  }

  async function save(key: string) {
    const v = vals[key]?.trim()
    if (!v) return
    setSaving(key)
    try {
      await saveKey(key, v)
      setKeys(p => ({ ...p, [key]: { configured: true, source: 'kv', preview: v.length > 8 ? v.slice(0, 4) + '...' + v.slice(-4) : '***', value: v } }))
      setVals(p => ({ ...p, [key]: '' }))
      setEditing(null)
      setToast('Saved')
      setTestResult(null)
    } catch (e) { setToast('Error: ' + (e instanceof Error ? e.message : 'Save failed')) }
    finally { setSaving(null) }
  }

  async function remove(key: string) {
    await fetch('/api/keys', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', key }),
    })
    setKeys(p => ({ ...p, [key]: { configured: false, source: 'none', preview: '' } }))
    setToast('Removed')
    setTestResult(null)
  }

  async function runTest() {
    setTesting(true); setTestResult(null)
    try {
      const r = await fetch('/api/ai-provider/test', { method: 'POST' })
      const d = await r.json()
      setTestResult(d)
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : 'Test failed' })
    } finally { setTesting(false) }
  }

  if (user.role !== 'admin') return (
    <div className="fade-in"><PageTitle>AI Provider</PageTitle><Alert variant="warning">Only admins can change the AI provider.</Alert></div>
  )

  const fields = FIELDS[provider]

  return (
    <div className="fade-in">
      <PageTitle>AI Provider</PageTitle>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 2000, padding: '10px 18px', background: 'var(--green-bg)', border: '1px solid rgba(22,163,74,.2)', borderRadius: 'var(--radius)', fontSize: 13, color: 'var(--green-t)', fontWeight: 500, boxShadow: 'var(--shadow-lg)' }}>
          {toast}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={20} /></div>
      ) : (
        <>
          <SectionLabel>Provider</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginBottom: 24 }}>
            {PROVIDERS.map(p => {
              const active = provider === p.id
              return (
                <button key={p.id} onClick={() => selectProvider(p.id)}
                  style={{ textAlign: 'left', padding: '14px 16px', borderRadius: 'var(--radius)', cursor: 'pointer',
                    border: active ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                    background: 'var(--surface)',
                    boxShadow: active ? 'var(--shadow)' : 'none',
                    outline: active ? '3px solid var(--accent-bg, rgba(37,99,235,.08))' : 'none', outlineOffset: -1,
                    transition: 'all .12s' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {p.name}
                    {active && <Badge label="active" color="green" />}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.5 }}>{p.blurb}</div>
                </button>
              )
            })}
          </div>

          {provider === 'bedrock' && (
            <Alert variant="info">Leave the access-key fields blank to use the EC2/ECS instance role — the cleanest setup, with no long-lived secrets stored. Make sure the role has <code>bedrock:InvokeModel</code> and the model is enabled in your region.</Alert>
          )}

          <SectionLabel>{PROVIDERS.find(p => p.id === provider)!.name} configuration</SectionLabel>
          <Card>
            {fields.map((f, i) => {
              const status = keys[f.key]
              const isEditing = editing === f.key
              const set = status?.configured
              return (
                <div key={f.key} style={{ padding: '14px 18px', borderBottom: i < fields.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
                        {f.label}
                        {set ? <Badge label="configured" color="green" /> : f.optional ? <Badge label="optional" color="gray" /> : <Badge label="required" color="amber" />}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{f.hint}</div>
                      {set && !isEditing && !f.secret && status?.value && (
                        <div style={{ fontSize: 11, color: 'var(--text4)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{status.value}</div>
                      )}
                      {set && !isEditing && f.secret && status?.preview && (
                        <div style={{ fontSize: 11, color: 'var(--text4)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{status.preview}</div>
                      )}
                      {isEditing && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          <input
                            type={f.secret ? 'password' : 'text'}
                            style={{ ...INP, flex: 1, fontFamily: f.secret ? 'var(--font-mono)' : 'inherit', fontSize: 12 }}
                            placeholder={f.placeholder}
                            value={vals[f.key] || ''}
                            onChange={e => setVals(p => ({ ...p, [f.key]: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') save(f.key); if (e.key === 'Escape') setEditing(null) }}
                            autoFocus
                          />
                          <Btn variant="primary" onClick={() => save(f.key)} disabled={saving === f.key}>
                            {saving === f.key ? <Spinner size={12} /> : 'Save'}
                          </Btn>
                          <Btn onClick={() => setEditing(null)}>Cancel</Btn>
                        </div>
                      )}
                    </div>
                    {!isEditing && (
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <Btn size="sm" onClick={() => { setEditing(f.key); setVals(p => ({ ...p, [f.key]: '' })) }}>
                          {set ? 'Update' : 'Set'}
                        </Btn>
                        {set && status?.source === 'kv' && (
                          <Btn size="sm" variant="danger" onClick={() => remove(f.key)}>Remove</Btn>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </Card>

          <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
            <Btn variant="primary" onClick={runTest} disabled={testing}>
              {testing ? <><Spinner size={12} /> &nbsp;Testing…</> : 'Test connection'}
            </Btn>
            <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>Makes one tiny live request through this provider.</span>
          </div>

          {testResult && (
            <div style={{ marginTop: 14 }}>
              <Alert variant={testResult.ok ? 'success' : 'error'}>
                {testResult.ok
                  ? `Connected. ${testResult.model ? `Model ${testResult.model} ` : ''}responded in ${testResult.latencyMs ?? '?'} ms.`
                  : `Test failed: ${testResult.error}`}
              </Alert>
            </div>
          )}
        </>
      )}
    </div>
  )
}

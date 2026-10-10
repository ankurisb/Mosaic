'use client'
import { useState, useRef, useMemo } from 'react'
import { INP, Btn, Field, Alert, Spinner } from './ui'

// Conversational AI builder for a Type-2 live API source. Describe the API
// (with pasted docs / attachments / a docs URL), the AI drafts a candidate,
// we probe it LIVE against the real source, refine against what actually came
// back, and register it — the same experience as iterating in a chat.
//
// Backend: /api/api-builder (generate|refine|fetch_docs), /api/test-api
// (candidate-mode live probe), /api/services (createService + createConnection).

interface MissingField { field: string; label?: string; secret?: boolean }
interface ConnDraft {
  label?: string; description?: string; base_path?: string
  pagination_style?: string; pagination_limit_param?: string
  pagination_cursor_param?: string; pagination_data_path?: string | null
}
interface ServiceDraft {
  label?: string; base_url?: string; auth_type?: string
  auth_config?: Record<string, string>; default_headers?: Record<string, string>
  api_version?: string | null; version_header?: string | null
}
interface Candidate {
  service?: ServiceDraft
  connections?: ConnDraft[]
  probe?: { connection_index?: number; method?: string; path?: string }
  missing?: MissingField[]
  message?: string
  ready_to_probe?: boolean
}
interface ProbeResult { ok: boolean; status: number; latencyMs?: number; url?: string; body?: unknown; error?: string }

const TEXT_EXT = ['txt', 'md', 'markdown', 'json', 'yaml', 'yml', 'csv', 'har']

export default function ApiBuilder({ onClose, onRegistered }: { onClose: () => void; onRegistered: () => void }) {
  const [step, setStep] = useState<'describe' | 'review'>('describe')
  const [description, setDescription] = useState('')
  const [docsUrl, setDocsUrl] = useState('')
  const [materials, setMaterials] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [probeMethod, setProbeMethod] = useState('GET')
  const [probePath, setProbePath] = useState('/')
  const [probeConnIdx, setProbeConnIdx] = useState(0)
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [registered, setRegistered] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const probeId = useRef(`draft-${Date.now().toString(36)}`)

  const missing = candidate?.missing || []
  const service = candidate?.service || {}
  const connections = candidate?.connections || []

  // The auth_config that will actually be sent: model's non-secret fields plus
  // what the user typed for the "missing" fields.
  const mergedAuthConfig = useMemo(
    () => ({ ...(service.auth_config || {}), ...pruneEmpty(secrets) }),
    [service.auth_config, secrets],
  )
  const unfilledSecrets = missing.filter(m => m.secret && !pruneEmpty(secrets)[m.field])

  async function addFiles(files: FileList | null) {
    if (!files) return
    const added: string[] = []
    let text = ''
    for (const f of Array.from(files)) {
      const ext = f.name.split('.').pop()?.toLowerCase() || ''
      if (!TEXT_EXT.includes(ext)) { added.push(`${f.name} (skipped — not a text file)`); continue }
      const content = await f.text().catch(() => '')
      if (content) { text += `\n\n===== ${f.name} =====\n${content}`; added.push(f.name) }
    }
    if (text) setMaterials(m => m + text)
    setAttachments(a => [...a, ...added])
    if (fileRef.current) fileRef.current.value = ''
  }

  async function fetchDocs() {
    if (!docsUrl.trim()) return
    setBusy('Fetching docs…'); setError(null)
    try {
      const r = await fetch('/api/api-builder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'fetch_docs', url: docsUrl.trim() }) })
      const d = await r.json()
      if (!d.ok) { setError(d.error || 'Could not fetch that URL'); setBusy(null); return }
      setMaterials(m => m + `\n\n===== ${docsUrl.trim()} =====\n${d.text}`)
      setAttachments(a => [...a, docsUrl.trim()])
      setDocsUrl('')
    } catch { setError('Could not fetch that URL') }
    setBusy(null)
  }

  async function generate() {
    setBusy('Drafting the connection…'); setError(null)
    try {
      const r = await fetch('/api/api-builder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate', description, materials: materials || undefined }) })
      const d = await r.json()
      if (!d.ok) { setError(d.error || 'Generation failed'); setBusy(null); return }
      applyCandidate(d.candidate)
      setStep('review')
    } catch { setError('Generation failed') }
    setBusy(null)
  }

  function applyCandidate(c: Candidate) {
    setCandidate(c)
    setProbe(null)
    const idx = c.probe?.connection_index ?? 0
    setProbeConnIdx(idx)
    setProbeMethod((c.probe?.method || 'GET').toUpperCase())
    setProbePath(c.probe?.path || '/')
  }

  async function runProbe() {
    if (!candidate) return
    setBusy('Probing the live source…'); setError(null); setProbe(null)
    try {
      const conn = connections[probeConnIdx] || {}
      const payload = {
        candidate: {
          probe_id: probeId.current,
          service: { ...service, auth_config: mergedAuthConfig },
          connection: { base_path: conn.base_path || '' },
        },
        method: probeMethod,
        path: probePath,
      }
      const r = await fetch('/api/test-api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const d = await r.json()
      setProbe(d as ProbeResult)
    } catch (e) { setProbe({ ok: false, status: 0, error: e instanceof Error ? e.message : 'Probe failed' }) }
    setBusy(null)
  }

  async function refine() {
    if (!candidate) return
    setBusy('Refining with the probe result…'); setError(null)
    try {
      const r = await fetch('/api/api-builder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'refine',
          previousCandidate: { ...candidate, service: { ...service, auth_config: mergedAuthConfig } },
          probeStatus: probe?.status,
          probeBody: probe?.body,
          probeError: probe?.error,
          userNote: note || undefined,
        }),
      })
      const d = await r.json()
      if (!d.ok) { setError(d.error || 'Refine failed'); setBusy(null); return }
      applyCandidate(d.candidate)
      setNote('')
    } catch { setError('Refine failed') }
    setBusy(null)
  }

  async function register() {
    if (!candidate) return
    setBusy('Registering the source…'); setError(null)
    try {
      const svcRes = await fetch('/api/services', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createService',
          label: service.label || 'API source',
          base_url: service.base_url,
          auth_type: service.auth_type || 'bearer',
          auth_config: mergedAuthConfig,
          default_headers: service.default_headers || {},
          api_version: service.api_version || null,
          version_header: service.version_header || null,
        }),
      })
      const svc = await svcRes.json()
      if (!svc.id) { setError(svc.error || 'Could not create service'); setBusy(null); return }
      for (const c of connections) {
        await fetch('/api/services', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'createConnection',
            service_id: svc.id,
            label: c.label || 'Endpoint',
            description: c.description || null,
            base_path: c.base_path || null,
            pagination_style: c.pagination_style || 'none',
            pagination_limit_param: c.pagination_limit_param || 'limit',
            pagination_cursor_param: c.pagination_cursor_param || 'cursor',
            pagination_data_path: c.pagination_data_path || null,
          }),
        })
      }
      setRegistered(service.label || 'API source')
    } catch { setError('Registration failed') }
    setBusy(null)
  }

  // ── Registered confirmation ──────────────────────────────────────────────
  if (registered) {
    return (
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>“{registered}” registered</div>
        <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
          It’s now a live API source — available in chats and RCAs, and in the list below with Try / Edit / Delete.
        </div>
        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <Btn variant="primary" onClick={onRegistered}>Done</Btn>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Add an API with AI</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>
            Describe the API and share whatever you have. Mosaic drafts the connection, tests it live, and registers it once it works.
          </div>
        </div>
        <Btn onClick={onClose} size="sm">Close</Btn>
      </div>

      {error && <div style={{ marginBottom: 12 }}><Alert variant="error">{error}</Alert></div>}

      {/* Step 1 — Describe */}
      {step === 'describe' && (
        <div style={card}>
          <Field label="What API do you want to connect?" hint="Base URL, what it returns, how auth works — whatever you know.">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={5}
              placeholder="e.g. Terralayr — base https://api.trlyr.com. Auth is a username/password login at /auth/public/authenticate that returns an access_token used as a Bearer. I want auctions, revenue and asset monitoring."
              style={{ ...INP, resize: 'vertical', fontFamily: 'inherit' }} />
          </Field>

          <div style={{ marginTop: 12 }}>
            <Field label="Docs / spec / sample" hint="Attach text files (docs, OpenAPI, Postman, a sample response) or pull a docs URL.">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Btn size="sm" onClick={() => fileRef.current?.click()}>Attach files</Btn>
                <input ref={fileRef} type="file" multiple accept=".txt,.md,.markdown,.json,.yaml,.yml,.csv,.har" style={{ display: 'none' }}
                  onChange={e => addFiles(e.target.files)} />
                <input value={docsUrl} onChange={e => setDocsUrl(e.target.value)} placeholder="https://docs.example.com/llms.txt"
                  style={{ ...INP, flex: 1, minWidth: 220 }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); fetchDocs() } }} />
                <Btn size="sm" onClick={fetchDocs} disabled={!docsUrl.trim() || !!busy}>Fetch</Btn>
              </div>
            </Field>
            {attachments.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {attachments.map((a, i) => (
                  <span key={i} style={chip}>{a}</span>
                ))}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--text4)', marginTop: 6 }}>
              You can also paste docs straight into the description. Secrets are collected later in masked fields — don’t paste passwords here.
            </div>
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
            <Btn variant="primary" onClick={generate} disabled={!description.trim() || !!busy}>Draft connection</Btn>
            {busy && <span style={{ fontSize: 12, color: 'var(--text3)', display: 'inline-flex', gap: 6, alignItems: 'center' }}><Spinner size={12} />{busy}</span>}
          </div>
        </div>
      )}

      {/* Step 2 — Review / probe / refine */}
      {step === 'review' && candidate && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {candidate.message && <Alert variant="info">{candidate.message}</Alert>}

          {/* What it drafted */}
          <div style={card}>
            <SectionLabel>Connection</SectionLabel>
            <KV k="Name" v={service.label} />
            <KV k="Base URL" v={service.base_url} mono />
            <KV k="Auth" v={service.auth_type} />
            {service.auth_config?.login_url && <KV k="Login" v={service.auth_config.login_url} mono />}
            {connections.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <SectionLabel>Endpoints ({connections.length})</SectionLabel>
                {connections.map((c, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text2)', padding: '3px 0' }}>
                    <span style={{ fontWeight: 500 }}>{c.label}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text3)' }}> · {c.base_path || '/'}</span>
                    {c.pagination_data_path && <span style={{ color: 'var(--text4)' }}> · records at {c.pagination_data_path}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Missing config / secrets */}
          {missing.length > 0 && (
            <div style={card}>
              <SectionLabel>Credentials & details needed</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
                {missing.map(m => (
                  <Field key={m.field} label={m.label || m.field}>
                    <input type={m.secret ? 'password' : 'text'} autoComplete="off"
                      value={secrets[m.field] || ''} onChange={e => setSecrets(s => ({ ...s, [m.field]: e.target.value }))}
                      placeholder={m.secret ? '••••••••' : ''} style={INP} />
                  </Field>
                ))}
              </div>
            </div>
          )}

          {/* Live probe */}
          <div style={card}>
            <SectionLabel>Test it live</SectionLabel>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
              {connections.length > 1 && (
                <select value={probeConnIdx} onChange={e => setProbeConnIdx(Number(e.target.value))} style={{ ...INP, width: 'auto' }}>
                  {connections.map((c, i) => <option key={i} value={i}>{c.label || `Endpoint ${i + 1}`}</option>)}
                </select>
              )}
              <select value={probeMethod} onChange={e => setProbeMethod(e.target.value)} style={{ ...INP, width: 'auto' }}>
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => <option key={m}>{m}</option>)}
              </select>
              <input value={probePath} onChange={e => setProbePath(e.target.value)} placeholder="/path?query"
                style={{ ...INP, flex: 1, minWidth: 180, fontFamily: 'var(--font-mono)' }} />
              <Btn variant="primary" size="sm" onClick={runProbe} disabled={!!busy || unfilledSecrets.length > 0}>Probe</Btn>
            </div>
            {unfilledSecrets.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text4)', marginTop: 6 }}>Fill the credentials above to probe.</div>
            )}
            {busy === 'Probing the live source…' && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text3)', display: 'inline-flex', gap: 6, alignItems: 'center' }}><Spinner size={12} />Calling the source…</div>}
            {probe && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: probe.ok ? 'var(--green, #16a34a)' : 'var(--red, #dc2626)' }}>
                  {probe.ok ? `✓ ${probe.status} OK` : `✗ ${probe.status ? `HTTP ${probe.status}` : 'Failed'}`}
                  {typeof probe.latencyMs === 'number' && <span style={{ color: 'var(--text4)', fontWeight: 400 }}> · {probe.latencyMs}ms</span>}
                </div>
                {probe.error && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>{probe.error}</div>}
                {probe.body !== undefined && (
                  <pre style={pre}>{safePreview(probe.body)}</pre>
                )}
              </div>
            )}
          </div>

          {/* Refine */}
          <div style={card}>
            <SectionLabel>Not right? Tell Mosaic what to fix</SectionLabel>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="e.g. the records are under data.results, not the top level — or auth should post to /login not /authenticate"
              style={{ ...INP, resize: 'vertical', fontFamily: 'inherit', marginTop: 6 }} />
            <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Btn onClick={refine} disabled={!!busy}>Refine</Btn>
              <Btn variant="primary" onClick={register} disabled={!!busy || !probe?.ok}>Register source</Btn>
              <Btn onClick={() => { setStep('describe') }} size="sm">Back</Btn>
              {!probe?.ok && <span style={{ fontSize: 11, color: 'var(--text4)' }}>Register unlocks once a probe succeeds.</span>}
              {busy && busy !== 'Probing the live source…' && <span style={{ fontSize: 12, color: 'var(--text3)', display: 'inline-flex', gap: 6, alignItems: 'center' }}><Spinner size={12} />{busy}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── small helpers / styles ──────────────────────────────────────────────────
function pruneEmpty(o: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(o)) if (v && v.trim() !== '') out[k] = v
  return out
}
function safePreview(body: unknown): string {
  try {
    const s = typeof body === 'string' ? body : JSON.stringify(body, null, 2)
    return s.length > 3000 ? s.slice(0, 3000) + '\n… (truncated)' : s
  } catch { return String(body) }
}
const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{children}</div>
)
function KV({ k, v, mono }: { k: string; v?: string | null; mono?: boolean }) {
  if (!v) return null
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 12, padding: '2px 0' }}>
      <span style={{ color: 'var(--text4)', width: 72, flexShrink: 0 }}>{k}</span>
      <span style={{ color: 'var(--text)', fontFamily: mono ? 'var(--font-mono)' : 'inherit', wordBreak: 'break-all' }}>{v}</span>
    </div>
  )
}
const card: React.CSSProperties = { background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius, 10px)', padding: '16px 18px' }
const chip: React.CSSProperties = { fontSize: 11, color: 'var(--text2)', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 999, padding: '3px 10px' }
const pre: React.CSSProperties = { marginTop: 8, padding: 12, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text2)', overflow: 'auto', maxHeight: 280, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }

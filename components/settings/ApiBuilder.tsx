'use client'
import { useState, useRef, useMemo, useEffect } from 'react'
import { INP, Btn, Field, Alert, Spinner } from './ui'

// Conversational AI builder for a Type-2 live API source. Describe the API
// (with pasted docs / attachments / a docs URL), the AI drafts a candidate,
// we probe it LIVE against the real source, refine against what actually came
// back, and register it — the same experience as iterating in a chat.
//
// Backend: /api/api-builder (generate|refine|fetch_docs), /api/test-api
// (candidate-mode live probe), /api/services (saveApiSource for draft/publish,
// getServiceConfig to resume a draft).

// Credential fields per auth type — used to split a resumed draft's auth_config
// into prefilled credential inputs (the structural fields stay in auth_config).
const CRED_FIELDS: Record<string, { field: string; label: string; secret: boolean }[]> = {
  bearer: [{ field: 'token', label: 'Bearer token', secret: true }],
  api_key_header: [{ field: 'key', label: 'API key', secret: true }],
  basic: [{ field: 'username', label: 'Username', secret: false }, { field: 'password', label: 'Password', secret: true }],
  oauth2_client: [{ field: 'client_id', label: 'Client ID', secret: false }, { field: 'client_secret', label: 'Client secret', secret: true }, { field: 'refresh_token', label: 'Refresh token', secret: true }],
  session_token: [{ field: 'username', label: 'Username', secret: false }, { field: 'password', label: 'Password', secret: true }],
}

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

export default function ApiBuilder({ onClose, onRegistered, onDraftSaved, resumeDraftId }: { onClose: () => void; onRegistered: () => void; onDraftSaved?: () => void; resumeDraftId?: string }) {
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
  const [info, setInfo] = useState<string | null>(null)
  const [draftServiceId, setDraftServiceId] = useState<string | null>(resumeDraftId || null)
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

  // Resume a saved draft: load its config, pull the credentials out of auth_config
  // into the (prefilled) credential fields, rebuild the candidate, and open review.
  useEffect(() => {
    if (!resumeDraftId) return
    let cancelled = false
    ;(async () => {
      setBusy('Loading draft…'); setError(null)
      try {
        const r = await fetch('/api/services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'getServiceConfig', id: resumeDraftId }) })
        const d = await r.json()
        if (cancelled) return
        if (!d.service) { setError(d.error || 'Could not load draft'); setBusy(null); return }
        const authType = String(d.service.auth_type || 'bearer')
        const authConfig: Record<string, string> = { ...(d.service.auth_config || {}) }
        const secretVals: Record<string, string> = {}
        const missingList: MissingField[] = []
        for (const cf of (CRED_FIELDS[authType] || [])) {
          missingList.push(cf)
          const v = authConfig[cf.field]
          if (v !== undefined && v !== null && v !== '') { secretVals[cf.field] = String(v); delete authConfig[cf.field] }
        }
        const conns: ConnDraft[] = (d.connections || []).map((c: Record<string, unknown>) => ({
          label: c.label as string, description: c.description as string, base_path: c.base_path as string,
          pagination_style: c.pagination_style as string, pagination_limit_param: c.pagination_limit_param as string,
          pagination_cursor_param: c.pagination_cursor_param as string, pagination_data_path: (c.pagination_data_path as string) ?? null,
        }))
        setSecrets(secretVals)
        applyCandidate({
          service: { label: d.service.label, base_url: d.service.base_url, auth_type: authType, auth_config: authConfig, default_headers: d.service.default_headers || {}, api_version: d.service.api_version, version_header: d.service.version_header },
          connections: conns,
          probe: { connection_index: 0, method: 'GET', path: conns[0]?.base_path ? '' : '/' },
          missing: missingList,
          message: 'Resumed draft — credentials filled in. Probe to pick up where you left off.',
          ready_to_probe: true,
        })
        setStep('review')
      } catch { if (!cancelled) setError('Could not load draft') }
      if (!cancelled) setBusy(null)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeDraftId])

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
    setBusy('Reading your links & drafting the connection…'); setError(null)
    try {
      const r = await fetch('/api/api-builder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate', description, materials: materials || undefined }) })
      const d = await r.json()
      // The server auto-fetches any URLs in the description; surface what it pulled.
      if (Array.isArray(d.fetched) && d.fetched.length) {
        setAttachments(a => [...a, ...d.fetched.map((f: { url: string; ok: boolean; bytes?: number; note?: string }) =>
          f.ok ? `${f.url} — read` : `${f.url} — couldn’t read (${f.note || 'failed'})`)])
      }
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

  // Upsert the whole source (service + connections) with a lifecycle status.
  // Reuses the draft's id so re-saving/publishing updates in place, not a dup.
  async function persist(status: 'draft' | 'published'): Promise<string | null> {
    const r = await fetch('/api/services', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveApiSource',
        id: draftServiceId || undefined,
        status,
        service: {
          label: service.label || 'API source',
          base_url: service.base_url,
          auth_type: service.auth_type || 'bearer',
          auth_config: mergedAuthConfig,
          default_headers: service.default_headers || {},
          api_version: service.api_version || null,
          version_header: service.version_header || null,
        },
        connections,
      }),
    })
    const d = await r.json()
    if (!d.id) { setError(d.error || 'Save failed'); return null }
    setDraftServiceId(d.id)
    return d.id
  }

  async function saveDraft() {
    if (!candidate) return
    setBusy('Saving draft…'); setError(null); setInfo(null)
    const id = await persist('draft')
    setBusy(null)
    if (id) { setInfo('Saved as draft — it’s in your API connections list, marked Draft. It won’t be used in chat until you publish.'); onDraftSaved?.() }
  }

  async function register() {
    if (!candidate) return
    setBusy('Publishing…'); setError(null); setInfo(null)
    const id = await persist('published')
    setBusy(null)
    if (id) setRegistered(service.label || 'API source')
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
      {info && <div style={{ marginBottom: 12 }}><Alert variant="success">{info}</Alert></div>}

      {/* Step 1 — Describe */}
      {step === 'describe' && (
        <div style={card}>
          <Field label="What API do you want to connect?" hint="Base URL, what it returns, how auth works — whatever you know.">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={5}
              placeholder="e.g. a REST API at https://api.example.com. Auth is a username/password login at /auth/login that returns an access_token used as a Bearer. I want the orders, invoices and usage endpoints."
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
              Paste doc links straight into the description — Mosaic reads them automatically (including an llms.txt index). Secrets are collected later in masked fields — don’t paste passwords here.
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
        <>
          <style>{COCKPIT_CSS}</style>
          {candidate.message && <div style={{ marginBottom: 12 }}><Alert variant="info">{candidate.message}</Alert></div>}
          <div className="apib-stage">

            {/* ── Draft (reference) ── */}
            <section className="apib-pane">
              <div className="apib-head"><span>Draft</span>{service.auth_type && <span style={badge}>{service.auth_type}</span>}</div>
              <div className="apib-scroll">
                <div>
                  <SectionLabel>Connection</SectionLabel>
                  <KV k="Name" v={service.label} />
                  <KV k="Base URL" v={service.base_url} mono />
                  <KV k="Auth" v={service.auth_type} />
                  {service.auth_config?.login_url && <KV k="Login" v={service.auth_config.login_url} mono />}
                </div>
                {connections.length > 0 && (
                  <div>
                    <SectionLabel>Endpoints ({connections.length})</SectionLabel>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                      {connections.map((c, i) => (
                        <button key={i} type="button"
                          onClick={() => { setProbeConnIdx(i); setProbePath(i === (candidate.probe?.connection_index ?? 0) ? (candidate.probe?.path || '') : '') }}
                          style={{ ...epBtn, ...(probeConnIdx === i ? epBtnSel : null) }}>
                          <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text)' }}>{c.label || `Endpoint ${i + 1}`}</span>
                          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)' }}>{c.base_path || '/'}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {missing.length > 0 && (
                  <div>
                    <SectionLabel>Credentials &amp; details needed</SectionLabel>
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
                <div>
                  <SectionLabel>Records path</SectionLabel>
                  <div style={{ marginTop: 6 }}><span style={badge}>{connections[probeConnIdx]?.pagination_data_path || 'root array'}</span></div>
                </div>
              </div>
            </section>

            {/* ── Cockpit: probe bar + persistent result ── */}
            <section className="apib-pane">
              <div className="apib-head">
                <span>Test &amp; result</span>
                {probe && typeof probe.latencyMs === 'number' && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text4)', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>{probe.latencyMs}ms</span>}
              </div>
              <div className="apib-probebar">
                {connections.length > 1 && (
                  <select value={probeConnIdx} onChange={e => setProbeConnIdx(Number(e.target.value))} style={{ ...INP, width: 'auto' }}>
                    {connections.map((c, i) => <option key={i} value={i}>{c.label || `Endpoint ${i + 1}`}</option>)}
                  </select>
                )}
                <select value={probeMethod} onChange={e => setProbeMethod(e.target.value)} style={{ ...INP, width: 'auto' }}>
                  {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => <option key={m}>{m}</option>)}
                </select>
                <input value={probePath} onChange={e => setProbePath(e.target.value)} placeholder="/path?query"
                  style={{ ...INP, flex: 1, minWidth: 110, fontFamily: 'var(--font-mono)' }} />
                <Btn variant="primary" size="sm" onClick={runProbe} disabled={!!busy || unfilledSecrets.length > 0}>Probe</Btn>
              </div>
              <div className="apib-result">
                {busy === 'Probing the live source…' && <div style={{ fontSize: 12, color: 'var(--text3)', display: 'inline-flex', gap: 6, alignItems: 'center' }}><Spinner size={12} />Calling the source…</div>}
                {!probe && busy !== 'Probing the live source…' && (
                  <div style={{ fontSize: 12.5, color: 'var(--text4)', lineHeight: 1.5 }}>
                    {unfilledSecrets.length > 0
                      ? 'Fill the credentials on the left, then Probe.'
                      : <>Hit <strong>Probe</strong> to call the live endpoint. The response stays here while you refine.</>}
                  </div>
                )}
                {probe && (
                  <>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: probe.ok ? 'var(--green-t, #16a34a)' : 'var(--red-t, #dc2626)' }}>
                      {probe.ok ? `✓ ${probe.status} OK` : `✗ ${probe.status ? `HTTP ${probe.status}` : 'Failed'}`}
                    </div>
                    {probe.url && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)', wordBreak: 'break-all' }}>{probeMethod} {probe.url}</div>}
                    {probe.error && <div style={{ fontSize: 12, color: 'var(--text2)' }}>{probe.error}</div>}
                    {probe.body !== undefined && <pre style={pre}>{safePreview(probe.body)}</pre>}
                  </>
                )}
              </div>
            </section>

            {/* ── Refine (right, always visible) ── */}
            <section className="apib-pane">
              <div className="apib-head"><span>Refine</span></div>
              <div className="apib-refinebody">
                <label style={{ fontSize: 11.5, color: 'var(--text2)' }}>Tell Mosaic what to fix</label>
                <textarea value={note} onChange={e => setNote(e.target.value)}
                  placeholder="e.g. the records are under data.results, not the top level — or auth should post to /login not /authenticate"
                  style={{ ...INP, flex: 1, minHeight: 110, resize: 'none', fontFamily: 'inherit' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Btn onClick={refine} disabled={!!busy} style={{ width: '100%' }}>Refine</Btn>
                  <Btn variant="primary" onClick={register} disabled={!!busy || !probe?.ok} style={{ width: '100%' }}>Publish source</Btn>
                  {!probe?.ok && <span style={{ fontSize: 11, color: 'var(--text4)' }}>Publish unlocks once a probe succeeds.</span>}
                  <Btn onClick={saveDraft} disabled={!!busy} style={{ width: '100%' }}>Save as draft</Btn>
                  <span style={{ fontSize: 11, color: 'var(--text4)' }}>A draft stays off chat until you publish.</span>
                  {busy && busy !== 'Probing the live source…' && <span style={{ fontSize: 12, color: 'var(--text3)', display: 'inline-flex', gap: 6, alignItems: 'center' }}><Spinner size={12} />{busy}</span>}
                  <Btn size="sm" onClick={() => setStep('describe')} style={{ width: '100%' }}>Back to describe</Btn>
                </div>
              </div>
            </section>

          </div>
        </>
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
const badge: React.CSSProperties = { fontSize: 11, color: 'var(--text2)', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 999, padding: '2px 9px', textTransform: 'none', letterSpacing: 0, fontWeight: 500 }
const epBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', cursor: 'pointer', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 9, padding: '9px 11px', fontFamily: 'inherit' }
const epBtnSel: React.CSSProperties = { borderColor: '#615cf5', background: 'rgba(97,92,245,0.09)' }
// Cockpit: three panes (Draft · Test&result · Refine) that fill one screen —
// each pane scrolls internally so the page never scrolls to iterate. Stacks on
// narrow widths.
const COCKPIT_CSS = `
.apib-stage{display:grid;grid-template-columns:minmax(220px,22%) minmax(0,1fr) minmax(280px,27%);gap:12px;height:min(72vh,720px);}
.apib-pane{background:var(--bg);border:1px solid var(--border2);border-radius:10px;min-height:0;display:flex;flex-direction:column;overflow:hidden;}
.apib-head{padding:10px 14px;border-bottom:1px solid var(--border2);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--text3);}
.apib-scroll{overflow:auto;padding:14px;display:flex;flex-direction:column;gap:16px;}
.apib-probebar{display:flex;gap:8px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border2);flex-shrink:0;flex-wrap:wrap;}
.apib-result{flex:1;min-height:0;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px;}
.apib-refinebody{flex:1;min-height:0;padding:14px;display:flex;flex-direction:column;gap:10px;}
@media (max-width:1024px){.apib-stage{grid-template-columns:1fr;height:auto;}.apib-pane{min-height:300px;}}
`

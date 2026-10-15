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
  session_token: [
    { field: 'login_url', label: 'Login URL (absolute URL, or a path like /auth/login)', secret: false },
    { field: 'username', label: 'Username', secret: false },
    { field: 'password', label: 'Password', secret: true },
    { field: 'token_path', label: 'Token path in the login response (default: access_token)', secret: false },
  ],
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
  const [agentUser, setAgentUser] = useState('')
  const [agentPass, setAgentPass] = useState('')
  const [transcript, setTranscript] = useState<string[]>([])
  const [agentVerified, setAgentVerified] = useState<{ groups: number; auth: string; status: number } | null>(null)
  const [refineChat, setRefineChat] = useState<Array<{ role: 'user' | 'assistant'; text: string; steps?: string[]; probe?: ProbeResult; candidate?: Candidate; applied?: boolean }>>([])
  const [chatBusy, setChatBusy] = useState(false)
  // Latches true once ANY probe succeeds this session (manual probe, the agent's
  // build probe, or an Ask & refine probe). Unlocks Publish and stays unlocked
  // even if a later probe on a non-existent path 404s. Reset when the config
  // materially changes (new build / applied refine).
  const [probedOk, setProbedOk] = useState(false)
  // Per-endpoint validation status (keyed by connection index) + roll-up summary.
  // Populated by "Validate all" — a deterministic probe of each endpoint group
  // that classifies what actually came back (data / empty / dead / auth / error).
  const [epStatus, setEpStatus] = useState<Record<number, { cls: string; rows?: number; dataKey?: string; detail: string; status: number }>>({})
  const [epSummary, setEpSummary] = useState<{ total: number; data: number; empty: number; dead: number; auth: number; error: number } | null>(null)
  const [validating, setValidating] = useState(false)
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
        const hasCreds = Object.keys(secretVals).length > 0
        applyCandidate({
          service: { label: d.service.label, base_url: d.service.base_url, auth_type: authType, auth_config: authConfig, default_headers: d.service.default_headers || {}, api_version: d.service.api_version, version_header: d.service.version_header },
          connections: conns,
          probe: { connection_index: 0, method: 'GET', path: conns[0]?.base_path ? '' : '/' },
          missing: missingList,
          message: d.service.status === 'draft'
            ? (hasCreds
                ? 'Resumed draft — credentials filled in. Probe a real endpoint to pick up where you left off.'
                : 'Resumed draft. This draft has no saved credentials — enter them under “Credentials & details needed” on the left, then Probe to verify and publish.')
            : (hasCreds
                ? `Loaded “${d.service.label}”. Its saved configuration and credentials are filled in — tell the AI what to fix below (or edit the fields on the left), then Probe and republish.`
                : `Loaded “${d.service.label}”. No saved credentials were found — add them under “Credentials & details needed” on the left (and tell the AI anything else to fix), then Probe and republish.`),
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

  // Agentic build: Mosaic investigates the API itself (discovers the spec, logs
  // in and reads the real token path, probes) and lands a working, already-probed
  // candidate in the cockpit — the heavy lifting done for you.
  async function buildWithAgent() {
    setBusy('Mosaic is investigating the API…'); setError(null); setInfo(null); setTranscript([]); setAgentVerified(null); setProbedOk(false)
    try {
      const credentials: Record<string, string> = {}
      if (agentUser.trim()) credentials.username = agentUser.trim()
      if (agentPass) credentials.password = agentPass
      const r = await fetch('/api/api-builder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'agent_build', description, materials: materials || undefined, credentials: Object.keys(credentials).length ? credentials : undefined }),
      })
      const d = await r.json()
      if (Array.isArray(d.fetched) && d.fetched.length) {
        setAttachments(a => [...a, ...d.fetched.map((f: { url: string; ok: boolean; note?: string }) => f.ok ? `${f.url} — read` : `${f.url} — couldn’t read (${f.note || 'failed'})`)])
      }
      setTranscript(Array.isArray(d.transcript) ? d.transcript : [])
      if (d.candidate) {
        const authType = String((d.candidate.service || {}).auth_type || 'bearer')
        const secretVals: Record<string, string> = {}
        const missingList: MissingField[] = []
        for (const cf of (CRED_FIELDS[authType] || [])) {
          missingList.push(cf)
          if (credentials[cf.field]) secretVals[cf.field] = credentials[cf.field]
          // Prefill non-secret structural fields (login_url, token_path) the AI
          // already set on the candidate, so they show in the inputs instead of
          // appearing blank.
          else if (!cf.secret) { const v = ((d.candidate.service || {}).auth_config || {})[cf.field]; if (v != null && v !== '') secretVals[cf.field] = String(v) }
        }
        setSecrets(secretVals)
        applyCandidate({ ...d.candidate, missing: (d.candidate.missing && d.candidate.missing.length) ? d.candidate.missing : missingList })
        if (d.probe) setProbe(d.probe as ProbeResult)   // seed the agent's successful probe
        setStep('review')
        if (d.ok && d.probe?.ok) {
          setAgentVerified({ groups: (d.candidate.connections || []).length, auth: authType, status: Number(d.probe.status) || 200 })
          setProbedOk(true)
        }
        if (!d.ok) setError(d.reason || 'Mosaic couldn’t fully verify the connection — review and probe below.')
      } else {
        setError(d.reason || d.error || 'Mosaic couldn’t build the connection. See what it tried below, then try Quick draft.')
      }
    } catch { setError('Agent build failed') }
    setBusy(null)
  }

  function applyCandidate(c: Candidate) {
    setCandidate(c)
    setProbe(null)
    setEpStatus({}); setEpSummary(null)   // endpoint set changed — stale validation
    const idx = c.probe?.connection_index ?? 0
    setProbeConnIdx(idx)
    setProbeMethod((c.probe?.method || 'GET').toUpperCase())
    setProbePath(c.probe?.path || '/')
  }

  // Deterministically probe every endpoint group and classify what came back, so
  // you can see at a glance which endpoints actually serve data vs. which are
  // dead module prefixes — without guessing paths. A data endpoint also unlocks
  // Publish (same as a successful probe).
  async function validateEndpoints() {
    if (!candidate || !connections.length || validating) return
    setValidating(true); setError(null)
    try {
      const r = await fetch('/api/api-builder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'validate_endpoints', service: { ...service, auth_config: mergedAuthConfig }, connections }),
      })
      const d = await r.json()
      if (!r.ok || !d.ok) { setError(d.error || 'Validation failed'); setValidating(false); return }
      const map: Record<number, { cls: string; rows?: number; dataKey?: string; detail: string; status: number }> = {}
      for (const row of d.results) map[row.index] = { cls: row.cls, rows: row.rows, dataKey: row.dataKey, detail: row.detail, status: row.status }
      setEpStatus(map); setEpSummary(d.summary)
      if (d.results.some((x: { cls: string }) => x.cls === 'data')) setProbedOk(true)
    } catch { setError('Validation failed') }
    setValidating(false)
  }

  // Drop the endpoints that returned no data (404 / HTML module prefixes) in one
  // click. Keeps data/empty/auth/error so nothing fixable is lost.
  function removeDeadEndpoints() {
    const dead = new Set(Object.entries(epStatus).filter(([, v]) => v.cls === 'dead').map(([k]) => Number(k)))
    if (!dead.size) return
    const kept = connections.filter((_, i) => !dead.has(i))
    setCandidate(c => c ? { ...c, connections: kept } : c)
    setEpStatus({}); setEpSummary(null)
    if (probeConnIdx >= kept.length) setProbeConnIdx(0)
  }

  // AI-led test: instead of making you type a path and guess the required query
  // params, Mosaic picks a real data-returning endpoint under the selected group,
  // fills the params itself, probes it, and shows the response here + its
  // reasoning in Ask & refine.
  async function aiTest() {
    if (!candidate || chatBusy || busy) return
    const conn = connections[probeConnIdx] || {}
    const target = conn.label || conn.base_path || 'this API'
    const msg = `Test ${target} (${conn.base_path || '/'}): probe a real path under it that returns data — fill in any required query parameters or path variables yourself — and show me what came back. If the group root returns 404 or an HTML page, find the correct listable endpoint under it and probe that instead.`
    setChatBusy(true); setBusy('Testing with AI…'); setError(null)
    setRefineChat(c => [...c, { role: 'user', text: `Test “${target}” with AI` }])
    try {
      const r = await fetch('/api/api-builder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'diagnose', mode: 'assist', service: { ...service, auth_config: mergedAuthConfig }, connections, symptom: msg, history: [] }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Request failed')
      setRefineChat(c => [...c, { role: 'assistant', text: d.diagnosis || d.reason || 'No answer.', steps: d.transcript, probe: d.probe as ProbeResult | undefined, candidate: d.candidate as Candidate | undefined }])
      if (d.probe) setProbe(d.probe as ProbeResult)
      if ((d.probe as ProbeResult | undefined)?.ok) setProbedOk(true)
    } catch (e) {
      setRefineChat(c => [...c, { role: 'assistant', text: `Sorry — ${e instanceof Error ? e.message : 'request failed'}.` }])
    }
    setChatBusy(false); setBusy(null)
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
      if ((d as ProbeResult)?.ok) setProbedOk(true)   // latch: one success unlocks Publish
    } catch (e) { setProbe({ ok: false, status: 0, error: e instanceof Error ? e.message : 'Probe failed' }) }
    setBusy(null)
  }

  // Interactive assistant for the draft: answers questions about the API (by
  // probing / reading the spec) and makes changes you can apply. Reuses the same
  // server agent as the Diagnose panel, in 'assist' mode, with the current draft
  // (incl. live credentials) sent inline.
  async function askAssistant() {
    const msg = note.trim()
    if (!msg || chatBusy || !candidate) return
    setChatBusy(true); setError(null)
    const history = refineChat.map(t => ({ role: t.role, text: t.text }))
    setRefineChat(c => [...c, { role: 'user', text: msg }])
    setNote('')
    try {
      const r = await fetch('/api/api-builder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'diagnose', mode: 'assist',
          service: { ...service, auth_config: mergedAuthConfig },
          connections, symptom: msg, history,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Request failed')
      setRefineChat(c => [...c, { role: 'assistant', text: d.diagnosis || d.reason || 'No answer.', steps: d.transcript, probe: d.probe as ProbeResult | undefined, candidate: d.candidate as Candidate | undefined }])
      if ((d.probe as ProbeResult | undefined)?.ok) setProbedOk(true)   // a verified call here also unlocks Publish
    } catch (e) {
      setRefineChat(c => [...c, { role: 'assistant', text: `Sorry — ${e instanceof Error ? e.message : 'request failed'}.` }])
    }
    setChatBusy(false)
  }

  // Rename the API source in place (editable in the Draft pane). Persisted by
  // Save as draft / Publish like any other field.
  function setServiceLabel(label: string) {
    setCandidate(c => c ? { ...c, service: { ...(c.service || {}), label } } : c)
  }

  // Apply a change the assistant proposed to the in-cockpit draft (re-attaching
  // the live secrets, which the server strips from its proposal). Does NOT
  // publish — you still probe / Publish when ready.
  function applyProposed(idx: number) {
    const c = refineChat[idx]?.candidate
    if (!c) return
    const merged: Candidate = { ...c, service: { ...(c.service || {}), auth_config: { ...((c.service || {}).auth_config || {}), ...secrets } } as ServiceDraft }
    applyCandidate(merged)
    setProbedOk(false)   // config changed — re-verify with a probe before publishing
    setRefineChat(list => list.map((t, i) => i === idx ? { ...t, applied: true } : t))
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
    if (id) {
      setInfo('Saved as draft — it’s in your API connections list, marked Draft. It won’t be used in chat until you publish.')
      setCandidate(c => c ? { ...c, message: undefined } : c)   // drop the now-stale resume/build hint so banners don't stack
      onDraftSaved?.()
    }
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
              Paste doc links straight into the description — Mosaic reads them automatically (including an llms.txt index).
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <Field label="Credentials (optional)" hint="Give Mosaic the login so it can sign in, read where the token really is, and verify endpoints itself — the agentic path. Stored encrypted on publish.">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input value={agentUser} onChange={e => setAgentUser(e.target.value)} placeholder="username / email" autoComplete="off" style={{ ...INP, flex: 1, minWidth: 160 }} />
                <input value={agentPass} onChange={e => setAgentPass(e.target.value)} placeholder="password" type="password" autoComplete="off" style={{ ...INP, flex: 1, minWidth: 160 }} />
              </div>
            </Field>
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Btn variant="primary" onClick={buildWithAgent} disabled={!description.trim() || !!busy}>Build it with AI</Btn>
            <Btn onClick={generate} disabled={!description.trim() || !!busy}>Quick draft</Btn>
            {busy && <span style={{ fontSize: 12, color: 'var(--text3)', display: 'inline-flex', gap: 6, alignItems: 'center' }}><Spinner size={12} />{busy}</span>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text4)', marginTop: 8 }}>
            <strong>Build it with AI</strong> investigates the API end-to-end (finds the spec, logs in, probes) and lands a verified connection. <strong>Quick draft</strong> just drafts one for you to probe.
          </div>

          {transcript.length > 0 && (
            <div style={{ ...card, marginTop: 14, background: 'var(--bg3)' }}>
              <SectionLabel>What Mosaic did</SectionLabel>
              <ol style={{ margin: '8px 0 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {transcript.map((t, i) => <li key={i} style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.45 }}>{t}</li>)}
              </ol>
            </div>
          )}
        </div>
      )}

      {/* Step 2 — Review / probe / refine */}
      {step === 'review' && candidate && (
        <>
          <style>{COCKPIT_CSS}</style>
          {candidate.message && <div style={{ marginBottom: 12 }}><Alert variant="info">{candidate.message}</Alert></div>}
          {transcript.length > 0 && (
            <details style={{ marginBottom: 12 }}>
              <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text3)' }}>What Mosaic did ({transcript.length} steps)</summary>
              <ol style={{ margin: '8px 0 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {transcript.map((t, i) => <li key={i} style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.45 }}>{t}</li>)}
              </ol>
            </details>
          )}
          {agentVerified && (
            <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 'var(--radius-sm)', background: 'var(--green-bg, rgba(22,163,74,.1))', border: '1px solid rgba(22,163,74,.25)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--success, #15803d)', fontWeight: 700, lineHeight: 1.5 }}>✓</span>
              <div style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.5 }}>
                <strong>Connection verified.</strong> Found {agentVerified.groups} endpoint group{agentVerified.groups !== 1 ? 's' : ''} behind {agentVerified.auth} auth and confirmed a live call returned {agentVerified.status} OK. Auth is shared across every group, so you don’t need to test each one — <strong>Publish source</strong> registers all {agentVerified.groups} and chat can then call any path under them.
              </div>
            </div>
          )}
          <div className="apib-stage">

            {/* ── Draft (reference) ── */}
            <section className="apib-pane">
              <div className="apib-head"><span>Draft</span>{service.auth_type && <span style={badge}>{service.auth_type}</span>}</div>
              <div className="apib-scroll">
                <div>
                  <SectionLabel>Connection</SectionLabel>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' }}>
                    <span style={{ color: 'var(--text4)', width: 72, flexShrink: 0, fontSize: 12 }}>Name</span>
                    <input
                      value={service.label || ''}
                      onChange={e => setServiceLabel(e.target.value)}
                      placeholder="Name this API source"
                      style={{ ...INP, padding: '4px 8px', fontSize: 12.5, flex: 1 }}
                    />
                  </div>
                  <KV k="Base URL" v={service.base_url} mono />
                  <KV k="Auth" v={service.auth_type} />
                  {service.auth_config?.login_url && <KV k="Login" v={service.auth_config.login_url} mono />}
                </div>
                {missing.length > 0 && (
                  <div style={unfilledSecrets.length > 0 ? { padding: '10px 12px', borderRadius: 'var(--radius-sm)', background: 'rgba(184,134,11,.10)', border: '1px solid rgba(184,134,11,.3)' } : undefined}>
                    <SectionLabel>Credentials &amp; details needed</SectionLabel>
                    {unfilledSecrets.length > 0 && <div style={{ fontSize: 11.5, color: 'var(--warn, #b8860b)', margin: '2px 0 4px', lineHeight: 1.4 }}>Enter these to probe and publish — they aren’t saved on this draft yet.</div>}
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
                {connections.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <SectionLabel>Endpoints ({connections.length})</SectionLabel>
                      <button type="button" onClick={validateEndpoints} disabled={validating || unfilledSecrets.length > 0}
                        title={unfilledSecrets.length > 0 ? 'Fill the credentials first' : 'Probe every endpoint and show which return data'}
                        style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text2)', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 6, padding: '3px 9px', cursor: (validating || unfilledSecrets.length > 0) ? 'default' : 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 5, opacity: unfilledSecrets.length > 0 ? 0.5 : 1 }}>
                        {validating ? <><Spinner size={10} />Validating…</> : 'Validate all'}
                      </button>
                    </div>
                    {epSummary && (
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5, lineHeight: 1.5 }}>
                        <span style={{ color: 'var(--text2)' }}>{epSummary.data} return data</span>
                        {epSummary.empty ? ` · ${epSummary.empty} reachable, empty` : ''}
                        {epSummary.dead ? ` · ${epSummary.dead} no data` : ''}
                        {epSummary.auth ? ` · ${epSummary.auth} auth` : ''}
                        {epSummary.error ? ` · ${epSummary.error} error` : ''}
                        {epSummary.dead > 0 && (
                          <>{' '}<button type="button" onClick={removeDeadEndpoints}
                            style={{ fontSize: 11, color: 'var(--text2)', background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                            Remove {epSummary.dead} with no data
                          </button></>
                        )}
                      </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                      {connections.map((c, i) => {
                        const st = epStatus[i]
                        return (
                          <button key={i} type="button"
                            onClick={() => { setProbeConnIdx(i); setProbePath(i === (candidate.probe?.connection_index ?? 0) ? (candidate.probe?.path || '') : '') }}
                            title={st?.detail}
                            style={{ ...epBtn, ...(probeConnIdx === i ? epBtnSel : null) }}>
                            {st && <EpIcon cls={st.cls} />}
                            <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text)' }}>{c.label || `Endpoint ${i + 1}`}</span>
                            {st?.rows != null && <span style={{ fontSize: 10.5, color: 'var(--text4)' }}>{st.rows} row{st.rows === 1 ? '' : 's'}</span>}
                            <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)' }}>{c.base_path || '/'}</span>
                          </button>
                        )
                      })}
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
              <div className="apib-probebar" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Btn variant="primary" size="sm" onClick={aiTest} disabled={chatBusy || !!busy || unfilledSecrets.length > 0}>Test with AI</Btn>
                  <span style={{ fontSize: 11, color: 'var(--text4)', lineHeight: 1.4 }}>
                    {connections.length > 1 ? `Tests “${connections[probeConnIdx]?.label || `Endpoint ${probeConnIdx + 1}`}” — Mosaic picks a real path & fills the params.` : 'Mosaic picks a real endpoint & fills the params.'}
                  </span>
                </div>
                <details>
                  <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--text3)', userSelect: 'none' }}>Manual probe</summary>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
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
                    <Btn size="sm" onClick={runProbe} disabled={!!busy || unfilledSecrets.length > 0}>Probe</Btn>
                  </div>
                </details>
              </div>
              <div className="apib-result">
                {(busy === 'Probing the live source…' || busy === 'Testing with AI…') && <div style={{ fontSize: 12, color: 'var(--text3)', display: 'inline-flex', gap: 6, alignItems: 'center' }}><Spinner size={12} />{busy === 'Testing with AI…' ? 'Mosaic is finding a real endpoint…' : 'Calling the source…'}</div>}
                {!probe && busy !== 'Probing the live source…' && busy !== 'Testing with AI…' && (
                  <div style={{ fontSize: 12.5, color: 'var(--text4)', lineHeight: 1.5 }}>
                    {unfilledSecrets.length > 0
                      ? 'Fill the credentials on the left, then test.'
                      : <>Hit <strong>Test with AI</strong> — Mosaic finds a working endpoint, fills the params, and shows the response here. Or open <strong>Manual probe</strong> to call a specific path.</>}
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

            {/* ── Chat: ask about the API + refine (right, always visible) ── */}
            <section className="apib-pane">
              <div className="apib-head"><span>Ask &amp; refine</span></div>
              <div className="apib-refinebody">
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 2 }}>
                  {refineChat.length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>
                      Ask about this API or request a change — Mosaic checks it live against the source.
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--text4)' }}>
                        <span>· &ldquo;do all the endpoints work?&rdquo;</span>
                        <span>· &ldquo;what does the materials endpoint return?&rdquo;</span>
                        <span>· &ldquo;records are under data.results, not the top level&rdquo;</span>
                      </div>
                    </div>
                  )}
                  {refineChat.map((t, i) => t.role === 'user' ? (
                    <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '90%', background: 'rgba(0,112,243,0.10)', border: '1px solid rgba(0,112,243,0.18)', color: 'var(--text)', padding: '7px 10px', borderRadius: 'var(--radius-sm)', fontSize: 12.5 }}>{t.text}</div>
                  ) : (
                    <div key={i} style={{ alignSelf: 'flex-start', maxWidth: '96%', background: 'var(--surface)', border: '1px solid var(--border2)', padding: '8px 10px', borderRadius: 'var(--radius-sm)', fontSize: 12.5, color: 'var(--text)' }}>
                      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{t.text}</div>
                      {t.probe && (
                        <div style={{ marginTop: 5, fontSize: 11, color: t.probe.ok ? 'var(--success, #15803d)' : 'var(--danger, #b91c1c)' }}>
                          probe: {t.probe.ok ? `${t.probe.status} OK` : `HTTP ${t.probe.status || 'failed'}`}
                        </div>
                      )}
                      {t.steps && t.steps.length > 0 && (
                        <details style={{ marginTop: 5 }}>
                          <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--text3)' }}>{t.steps.length} step{t.steps.length !== 1 ? 's' : ''} it took</summary>
                          <ol style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 11, color: 'var(--text3)', lineHeight: 1.5 }}>
                            {t.steps.map((s, j) => <li key={j}>{s}</li>)}
                          </ol>
                        </details>
                      )}
                      {t.candidate && (t.candidate.service || (t.candidate.connections && t.candidate.connections.length)) && (
                        t.applied
                          ? <div style={{ marginTop: 7, fontSize: 11.5, color: 'var(--success, #15803d)', fontWeight: 500 }}>✓ Applied to the draft — re-probe, then Publish.</div>
                          : <Btn size="sm" variant="primary" onClick={() => applyProposed(i)} style={{ marginTop: 7 }}>Apply to draft</Btn>
                      )}
                    </div>
                  ))}
                  {chatBusy && <div style={{ alignSelf: 'flex-start', display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--text3)' }}><Spinner size={12} /> Checking against the live API…</div>}
                </div>

                <textarea value={note} onChange={e => setNote(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); askAssistant() } }}
                  placeholder="Ask a question or describe a change…"
                  style={{ ...INP, minHeight: 56, resize: 'none', fontFamily: 'inherit' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Btn onClick={askAssistant} disabled={chatBusy || !note.trim()} style={{ width: '100%' }}>{chatBusy ? 'Thinking…' : 'Send'}</Btn>
                  <Btn variant="primary" onClick={register} disabled={!!busy || !probedOk} style={{ width: '100%' }}>Publish source</Btn>
                  {!probedOk && <span style={{ fontSize: 11, color: 'var(--text4)' }}>Publish unlocks once any endpoint probes successfully — a 404 on a group root (e.g. /accounts) doesn’t count; try a real endpoint, or ask &ldquo;do all endpoints work?&rdquo;</span>}
                  <Btn onClick={saveDraft} disabled={!!busy} style={{ width: '100%' }}>Save as draft</Btn>
                  <span style={{ fontSize: 11, color: 'var(--text4)' }}>A draft stays off chat until you publish.</span>
                  {busy && busy !== 'Probing the live source…' && <span style={{ fontSize: 12, color: 'var(--text3)', display: 'inline-flex', gap: 6, alignItems: 'center' }}><Spinner size={12} />{busy}</span>}
                  {!resumeDraftId && <Btn size="sm" onClick={() => setStep('describe')} style={{ width: '100%' }}>Back to describe</Btn>}
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
// Monochrome status glyph for a validated endpoint — single-hue (greys only), no
// colour coding, so it reads as a quiet signal next to the endpoint name. The
// full detail is in the button's title tooltip and the summary line.
function EpIcon({ cls }: { cls?: string }) {
  if (!cls) return null
  const map: Record<string, { g: string; c: string }> = {
    data:  { g: '✓', c: 'var(--text)' },
    empty: { g: '○', c: 'var(--text4)' },
    dead:  { g: '✕', c: 'var(--text4)' },
    auth:  { g: '⦸', c: 'var(--text3)' },
    error: { g: '!', c: 'var(--text3)' },
  }
  const m = map[cls] || map.error
  return <span aria-hidden style={{ fontFamily: 'var(--font-mono)', fontSize: 12, width: 13, textAlign: 'center', color: m.c, flexShrink: 0, fontWeight: 600 }}>{m.g}</span>
}
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

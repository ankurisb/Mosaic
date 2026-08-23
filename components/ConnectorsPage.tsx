'use client'
import { useState } from 'react'
import AppShell from './AppShell'
import type { SessionUser } from '@/lib/auth'

type Manifest = Record<string, unknown>
type Step = 'describe' | 'review' | 'tested'

async function callConnectors(body: Record<string, unknown>) {
  const res = await fetch('/api/connectors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { code: res.status, data: await res.json().catch(() => ({})) }
}

export default function ConnectorsPage({ user }: { user: SessionUser }) {
  const [step, setStep] = useState<Step>('describe')
  const [description, setDescription] = useState('')
  const [sample, setSample] = useState('')
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [streamName, setStreamName] = useState('')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [records, setRecords] = useState<unknown[] | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [published, setPublished] = useState<string | null>(null)
  const [refineOpen, setRefineOpen] = useState(false)

  function reset() {
    setStep('describe'); setManifest(null); setStreamName(''); setProjectId(null)
    setRecords(null); setTestError(null); setNote(''); setPublished(null); setRefineOpen(false)
  }

  async function generate() {
    setBusy('Generating connector…'); setTestError(null)
    const { data } = await callConnectors({ action: 'generate', description, sample: sample || undefined })
    setBusy(null)
    if (!data.ok) { setTestError(data.error || 'Generation failed'); return }
    setManifest(data.manifest); setStreamName(data.streamName || ''); setStep('review')
    setRecords(null); setProjectId(null)
  }

  async function test() {
    if (!manifest) return
    setBusy('Testing against the live source…'); setTestError(null); setRecords(null)
    // Always create a fresh draft project for the CURRENT manifest — after a
    // refinement the manifest has changed, so a reused project would hold a stale
    // draft. Cheap, and keeps each test honest to what's on screen.
    const c = await callConnectors({ action: 'create', name: `mosaic-${Date.now().toString(36)}`, manifest })
    if (!c.data.ok) { setBusy(null); setTestError(c.data.error || 'Could not create draft'); return }
    const pid = c.data.projectId; setProjectId(pid)
    const { data } = await callConnectors({ action: 'test', manifest, streamName, projectId: pid, config: {} })
    setBusy(null)
    if (!data.ok) { setTestError(data.error || 'Test failed'); setRecords([]); setStep('tested'); return }
    setRecords(data.records || []); setStep('tested')
    if (!data.records?.length) setTestError('The source returned zero records — the record path or a filter is likely off.')
  }

  async function refine() {
    if (!manifest) return
    setBusy('Refining with the test result…'); setRefineOpen(false)
    const { data } = await callConnectors({
      action: 'refine',
      previousManifest: manifest,
      testRecords: records || [],
      testError: testError || undefined,
      userNote: note || undefined,
    })
    setBusy(null)
    if (!data.ok) { setTestError(data.error || 'Refine failed'); return }
    // New manifest -> discard the old draft/results and return to a testable
    // state. The loop is: test -> refine -> test -> refine, as many times as
    // needed; publish only appears once records come back.
    setManifest(data.manifest); setStreamName(data.streamName || streamName)
    setRecords(null); setProjectId(null); setNote(''); setTestError(null); setStep('review')
  }

  async function publish() {
    if (!manifest || !projectId) return
    setBusy('Publishing connector…')
    const name = (description.slice(0, 40) || 'Custom connector').trim()
    const { data } = await callConnectors({ action: 'publish', projectId, name, manifest })
    setBusy(null)
    if (!data.ok) { setTestError(data.error || 'Publish failed'); return }
    setPublished(data.sourceDefinitionId)
  }

  const hasRecords = records && records.length > 0

  return (
    <AppShell user={user}>
      <div style={{ flex: 1, overflowY: 'auto', height: 0 }}>
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 40px' }}>

          <div style={{ marginBottom: 24 }}>
            <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)', margin: 0 }}>Custom connectors</h1>
            <p style={{ fontSize: 13, color: 'var(--text3)', margin: '6px 0 0', lineHeight: 1.5 }}>
              Describe a data source Mosaic can&rsquo;t reach yet. Mosaic drafts a connector, tests it against the
              live source, and — once it returns the right data — publishes it for use. Connectors run in the
              ingestion sandbox, never inside Mosaic.
            </p>
          </div>

          {published ? (
            <div style={{ background: 'var(--green-bg)', border: '1px solid var(--green-t)', borderRadius: 'var(--radius)', padding: '20px 22px' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Connector published</div>
              <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
                It&rsquo;s now available as a source you can configure and sync. To load its data for querying and
                dashboards, set up a sync to a database destination.
              </div>
              <button onClick={reset} style={btn('primary')} type="button">Create another</button>
            </div>
          ) : (
            <>
              {/* Step 1 — describe */}
              <Section n="1" title="Describe the source" active={step === 'describe'}>
                <label style={lbl}>What is the source? Include the base URL, the endpoint, and what it returns.</label>
                <textarea value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="e.g. A REST API at https://api.example.com. The /readings endpoint returns a JSON array of sensor readings with fields timestamp, machine_id, temperature. It takes a page query parameter."
                  style={textarea(96)} />
                <label style={{ ...lbl, marginTop: 12 }}>Sample response or API docs <span style={{ color: 'var(--text4)' }}>(optional, improves accuracy)</span></label>
                <textarea value={sample} onChange={e => setSample(e.target.value)}
                  placeholder="Paste a sample JSON response or the relevant API docs here."
                  style={textarea(72)} />
                <div style={{ marginTop: 14 }}>
                  <button onClick={generate} disabled={!description.trim() || !!busy} style={btn('primary', !description.trim() || !!busy)} type="button">
                    Draft connector
                  </button>
                </div>
              </Section>

              {/* Step 2 — review + test */}
              {manifest && (
                <Section n="2" title="Review &amp; test" active={step === 'review' || step === 'tested'}>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>
                    Drafted connector for stream <code style={code}>{streamName || '—'}</code>. Test it to pull real
                    records from the live source before publishing.
                  </div>
                  <pre style={manifestBox}>{JSON.stringify(manifest, null, 2)}</pre>
                  <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
                    <button onClick={test} disabled={!!busy} style={btn('primary', !!busy)} type="button">
                      Test against live source
                    </button>
                    <button onClick={() => setRefineOpen(v => !v)} disabled={!!busy} style={btn('ghost', !!busy)} type="button">
                      Refine with a note
                    </button>
                  </div>
                  {refineOpen && (
                    <div style={{ marginTop: 12 }}>
                      <label style={lbl}>Tell Mosaic what to change</label>
                      <textarea value={note} onChange={e => setNote(e.target.value)}
                        placeholder="e.g. The records are nested under a results array, not the root. Add a bearer token from config."
                        style={textarea(64)} />
                      <button onClick={refine} disabled={!note.trim() || !!busy} style={{ ...btn('primary', !note.trim() || !!busy), marginTop: 8 }} type="button">
                        Apply refinement
                      </button>
                    </div>
                  )}
                </Section>
              )}

              {/* Step 3 — results */}
              {step === 'tested' && (
                <Section n="3" title="Result" active>
                  {hasRecords ? (
                    <>
                      <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 8 }}>
                        <strong>{records!.length}</strong> record{records!.length === 1 ? '' : 's'} returned from the live source.
                      </div>
                      <pre style={{ ...manifestBox, maxHeight: 260 }}>{JSON.stringify(records!.slice(0, 5), null, 2)}</pre>
                      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                        <button onClick={publish} disabled={!!busy} style={btn('primary', !!busy)} type="button">Publish connector</button>
                        <button onClick={() => setRefineOpen(true)} disabled={!!busy} style={btn('ghost', !!busy)} type="button">Not right — refine</button>
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
                      {testError || 'No records returned.'} Refine the connector and test again — you can repeat this as many times as needed.
                    </div>
                  )}

                  {/* Refine loop — available whether the test succeeded imperfectly or
                      returned nothing. Refining produces a new draft and returns to
                      the test step, so test -> refine -> test can repeat freely. */}
                  {(refineOpen || !hasRecords) && (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                      <label style={lbl}>What should change? <span style={{ color: 'var(--text4)' }}>(optional — Mosaic also uses the test result)</span></label>
                      <textarea value={note} onChange={e => setNote(e.target.value)}
                        placeholder="e.g. Records are nested under a results array. Or: add a bearer token from config. Leave blank to let Mosaic infer from the test result."
                        style={textarea(64)} />
                      <button onClick={refine} disabled={!!busy} style={{ ...btn('primary', !!busy), marginTop: 8 }} type="button">
                        Refine &amp; return to test
                      </button>
                    </div>
                  )}
                </Section>
              )}

              {busy && <div style={{ marginTop: 16, fontSize: 13, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 8 }}><Spinner />{busy}</div>}
              {testError && step !== 'tested' && <div style={{ marginTop: 14, fontSize: 13, color: 'var(--red)', background: 'var(--red-t)', border: '1px solid var(--red-t)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>{testError}</div>}
            </>
          )}
        </div>
      </div>
    </AppShell>
  )
}

function Section({ n, title, active, children }: { n: string; title: string; active?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface)', border: `1px solid var(--border)`, borderRadius: 'var(--radius)', padding: '18px 20px', marginBottom: 14, opacity: active ? 1 : 0.6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ width: 22, height: 22, borderRadius: '50%', background: active ? 'var(--blue)' : 'var(--bg3)', color: active ? '#fff' : 'var(--text3)', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{n}</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }} dangerouslySetInnerHTML={{ __html: title }} />
      </div>
      {children}
    </div>
  )
}

function Spinner() {
  return <span style={{ width: 13, height: 13, border: '2px solid var(--border2)', borderTopColor: 'var(--blue)', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
}

const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text2)', marginBottom: 6 }
const code: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--bg3)', padding: '1px 6px', borderRadius: 'var(--radius-sm)', color: 'var(--text)' }
const manifestBox: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.5, background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', margin: 0, maxHeight: 300, overflow: 'auto', color: 'var(--text2)' }
function textarea(h: number): React.CSSProperties {
  return { width: '100%', minHeight: h, background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', padding: '10px 12px', outline: 'none', boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.5 }
}
function btn(kind: 'primary' | 'ghost', disabled?: boolean): React.CSSProperties {
  const base: React.CSSProperties = { height: 36, padding: '0 16px', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, border: '1px solid transparent' }
  if (kind === 'primary') return { ...base, background: 'var(--blue)', color: '#fff' }
  return { ...base, background: 'var(--bg)', color: 'var(--text2)', border: '1px solid var(--border2)' }
}

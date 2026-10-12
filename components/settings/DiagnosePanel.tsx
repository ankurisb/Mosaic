'use client'
import { useState, useRef, useEffect } from 'react'
import { Btn, Alert, Spinner } from './ui'

// Interactive troubleshooter for a saved API connection. Runs the same server
// agent (/api/api-builder action:'diagnose') that the chat tool uses: reproduce
// the failure, root-cause it, and — when it's a config problem — propose a fix
// the admin applies with an explicit confirm (action:'apply_fix', published +
// audit-logged). Read-only until that confirm.

interface Turn {
  role: 'user' | 'assistant'
  text: string
  steps?: string[]
  probe?: { ok: boolean; status: number; url: string }
  candidate?: { service?: Record<string, unknown>; connections?: Array<Record<string, unknown>> }
  diff?: string
  applied?: boolean
}

function fixDiff(candidate: Turn['candidate']): string {
  if (!candidate) return ''
  const s = (candidate.service || {}) as Record<string, unknown>
  const parts: string[] = []
  if (s.base_url) parts.push(`base URL → ${String(s.base_url)}`)
  if (s.auth_type) parts.push(`auth → ${String(s.auth_type)}`)
  const conns = candidate.connections || []
  if (conns.length) {
    const paths = conns.map(c => String((c as Record<string, unknown>).base_path ?? '')).filter(Boolean)
    parts.push(`${conns.length} connection${conns.length !== 1 ? 's' : ''}${paths.length ? ` (${paths.slice(0, 6).join(', ')}${paths.length > 6 ? ', …' : ''})` : ''}`)
  }
  return parts.join('  ·  ')
}

export default function DiagnosePanel({ svc, onClose, onApplied }: {
  svc: { id: string; label: string }
  onClose: () => void
  onApplied?: () => void
}) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [symptom, setSymptom] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null)
  const [applying, setApplying] = useState(false)
  const [stepsOpen, setStepsOpen] = useState<Set<number>>(new Set())
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }) }, [turns, loading])

  async function runDiagnose() {
    const sym = symptom.trim()
    if (!sym || loading) return
    setError(''); setLoading(true)
    const history = turns.map(t => ({ role: t.role, text: t.text }))
    setTurns(t => [...t, { role: 'user', text: sym }])
    setSymptom('')
    try {
      const res = await fetch('/api/api-builder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'diagnose', service_id: svc.id, symptom: sym, history }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Diagnosis failed')
      setTurns(t => [...t, {
        role: 'assistant',
        text: data.diagnosis || data.reason || 'No root cause determined.',
        steps: data.transcript,
        probe: data.probe,
        candidate: data.candidate,
        diff: data.candidate ? fixDiff(data.candidate) : undefined,
      }])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Diagnosis failed')
    } finally {
      setLoading(false)
    }
  }

  async function applyFix(idx: number) {
    const turn = turns[idx]
    if (!turn?.candidate || applying) return
    setApplying(true); setError('')
    try {
      const res = await fetch('/api/api-builder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply_fix', service_id: svc.id, candidate: turn.candidate }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Apply failed')
      setTurns(t => t.map((x, i) => i === idx ? { ...x, applied: true } : x))
      setConfirmIdx(null)
      onApplied?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Apply failed')
    } finally {
      setApplying(false)
    }
  }

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }
  const panel: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg, var(--shadow))', width: 'min(680px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Diagnose — {svc.label}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Describe what&apos;s going wrong; Mosaic reproduces it against the live API and proposes a fix.</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        <div ref={logRef} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 160 }}>
          {turns.length === 0 && !loading && (
            <div style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center', margin: 'auto', maxWidth: 420 }}>
              e.g. &ldquo;every endpoint returns 404&rdquo;, &ldquo;login works but data calls are 401&rdquo;, or &ldquo;returns an empty list&rdquo;. Include the failing method/path if you know it.
            </div>
          )}
          {turns.map((t, i) => t.role === 'user' ? (
            <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '85%', background: 'var(--accent-bg, rgba(0,112,243,.1))', color: 'var(--text)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', fontSize: 13 }}>{t.text}</div>
          ) : (
            <div key={i} style={{ alignSelf: 'flex-start', maxWidth: '92%', background: 'var(--bg)', border: '1px solid var(--border)', padding: '10px 12px', borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--text)' }}>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{t.text}</div>
              {t.probe && (
                <div style={{ marginTop: 6, fontSize: 11, color: t.probe.ok ? 'var(--success, #15803d)' : 'var(--danger, #b91c1c)' }}>
                  probe: {t.probe.ok ? `${t.probe.status} OK` : `HTTP ${t.probe.status || 'failed'}`} — <span style={{ color: 'var(--text4)' }}>{t.probe.url}</span>
                </div>
              )}
              {t.steps && t.steps.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <button onClick={() => setStepsOpen(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text3)', fontSize: 11 }}>
                    {stepsOpen.has(i) ? '▾' : '▸'} {t.steps.length} step{t.steps.length !== 1 ? 's' : ''} it took
                  </button>
                  {stepsOpen.has(i) && (
                    <ol style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 11, color: 'var(--text3)', lineHeight: 1.5 }}>
                      {t.steps.map((s, j) => <li key={j}>{s}</li>)}
                    </ol>
                  )}
                </div>
              )}
              {t.candidate && (
                <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text3)', marginBottom: 4 }}>Proposed fix</div>
                  <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 8 }}>{t.diff || 'Updates the connection configuration.'}</div>
                  {t.applied ? (
                    <div style={{ fontSize: 12, color: 'var(--success, #15803d)', fontWeight: 500 }}>✓ Applied &amp; re-published</div>
                  ) : confirmIdx === i ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, color: 'var(--text2, var(--text))' }}>Re-publish {svc.label} with these changes?</span>
                      <Btn size="sm" variant="primary" disabled={applying} onClick={() => applyFix(i)}>{applying ? 'Applying…' : 'Confirm'}</Btn>
                      <Btn size="sm" onClick={() => setConfirmIdx(null)} disabled={applying}>Cancel</Btn>
                    </div>
                  ) : (
                    <Btn size="sm" variant="primary" onClick={() => setConfirmIdx(i)}>Apply &amp; publish</Btn>
                  )}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text3)' }}>
              <Spinner /> Investigating — probing the API and reading its spec…
            </div>
          )}
        </div>

        {error && <div style={{ padding: '0 16px' }}><Alert variant="error">{error}</Alert></div>}

        <div style={{ display: 'flex', gap: 8, padding: 14, borderTop: '1px solid var(--border)' }}>
          <textarea
            value={symptom}
            onChange={e => setSymptom(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runDiagnose() } }}
            placeholder={turns.length ? 'Add detail or ask a follow-up…' : 'Describe the problem…'}
            rows={2}
            style={{ flex: 1, resize: 'none', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit' }}
          />
          <Btn variant="primary" onClick={runDiagnose} disabled={loading || !symptom.trim()}>{turns.length ? 'Send' : 'Diagnose'}</Btn>
        </div>
      </div>
    </div>
  )
}

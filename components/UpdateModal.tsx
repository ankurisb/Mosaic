'use client'

import { useEffect, useState } from 'react'

interface MosaicUpdater {
  available: boolean
  update: () => void
  onProgress: (cb: (p: { pct?: number; label?: string; message?: string }) => void) => () => void
  onDone: (cb: (r: { ok: boolean; ready?: boolean; error?: string }) => void) => () => void
}
declare global {
  interface Window { mosaicUpdater?: MosaicUpdater }
}

interface ChangelogEntry { version: string; date: string; sections: Record<string, string[]> }

// Edition-aware update dialog — Mosaic-styled, self-contained. NEVER opens an external
// GitHub page; release notes render inline from the app's own changelog.
export function UpdateModal({ deploy, onClose }: {
  deploy: {
    edition?: string; currentVersion?: string; latestVersion?: string | null
    changelog?: ChangelogEntry[]
  }
  onClose: () => void
}) {
  const [canSelfUpdate, setCanSelfUpdate] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [pct, setPct] = useState(0)
  const [label, setLabel] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [showNotes, setShowNotes] = useState(false)

  useEffect(() => {
    setCanSelfUpdate(!!window.mosaicUpdater?.available && deploy.edition === 'personal')
  }, [deploy.edition])

  function startUpdate() {
    if (!window.mosaicUpdater) return
    setUpdating(true); setError(''); setPct(4); setLabel('Starting update…')
    const offP = window.mosaicUpdater.onProgress(p => {
      if (typeof p.pct === 'number') setPct(p.pct)
      if (p.label || p.message) setLabel(p.label || p.message || '')
    })
    const offD = window.mosaicUpdater.onDone(r => {
      offP(); offD()
      if (r.ok) { setPct(100); setDone(true); setLabel('Update complete — reloading…'); setTimeout(() => window.location.reload(), 1800) }
      else { setUpdating(false); setError(r.error || 'Update failed. Please try again.') }
    })
    window.mosaicUpdater.update()
  }

  const notes = (deploy.changelog || []).find(c => c.version === deploy.latestVersion) || (deploy.changelog || [])[0]
  const v = deploy.latestVersion
  const clean = (s: string) => s.replace(/\*\*/g, '').replace(/`/g, '')

  return (
    <div onClick={updating ? undefined : onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 24 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', width: 'min(440px, 100%)', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        <div style={{ padding: '20px 22px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>
            {done ? 'Mosaic is up to date' : `Mosaic v${v} is available`}
          </div>
          {!done && <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 4 }}>You&rsquo;re on v{deploy.currentVersion}.</div>}
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto' }}>
          {updating ? (
            <div>
              <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 10 }}>{label}</div>
              <div style={{ height: 8, borderRadius: 999, background: 'var(--bg3)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent-bg)', borderRadius: 999, transition: 'width .45s ease' }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text4)', marginTop: 6, textAlign: 'right' }}>{Math.round(pct)}%</div>
              {!done && <div style={{ fontSize: 11.5, color: 'var(--text4)', marginTop: 12, lineHeight: 1.5 }}>Keep Mosaic open — this can take a minute or two. Your data and settings are kept.</div>}
            </div>
          ) : (
            <>
              {notes && (
                <div style={{ marginBottom: 16 }}>
                  <button onClick={() => setShowNotes(s => !s)}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text3)', fontSize: 12, fontWeight: 600, fontFamily: 'inherit' }}>
                    <span style={{ transform: showNotes ? 'rotate(90deg)' : 'none', transition: 'transform .15s', display: 'inline-block' }}>&rsaquo;</span>
                    What&rsquo;s new in v{notes.version}
                  </button>
                  {showNotes && (
                    <div style={{ marginTop: 10, paddingLeft: 4 }}>
                      {Object.entries(notes.sections).map(([section, items]) => (
                        <div key={section} style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 5 }}>{section}</div>
                          <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {items.slice(0, 8).map((it, i) => (
                              <li key={i} style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>{clean(it)}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {canSelfUpdate ? (
                <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
                  Mosaic will download v{v} and restart automatically. Your data and settings are kept.
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 12 }}>
                    A new version is available. On this deployment, updates are applied on
                    the server by your administrator.
                  </div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>To update (administrator)</div>
                  <pre style={{ margin: 0, padding: '10px 12px', background: 'var(--bg3)', borderRadius: 'var(--radius-sm)', fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--text2)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{`docker compose pull mosaic
docker compose up -d mosaic`}</pre>
                </div>
              )}

              {error && <div style={{ fontSize: 12, color: 'var(--red-t, #dc2626)', background: 'var(--red-bg, #fef2f2)', border: '1px solid var(--red-t, #dc2626)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', marginTop: 12 }}>{error}</div>}
            </>
          )}
        </div>

        {!updating && (
          <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {canSelfUpdate ? (
              <>
                <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text2)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Later</button>
                <button onClick={startUpdate} style={{ padding: '8px 20px', borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--accent-bg)', color: 'var(--accent-fg)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Update now</button>
              </>
            ) : (
              <button onClick={onClose} style={{ padding: '8px 20px', borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--accent-bg)', color: 'var(--accent-fg)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Got it</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'

// The Electron desktop shell (Personal edition) exposes this to the running app so it
// can self-update. Absent in a plain browser / Enterprise server deployment.
interface MosaicUpdater {
  available: boolean
  update: () => void
  onProgress: (cb: (p: { pct?: number; message?: string; step?: string }) => void) => () => void
  onDone: (cb: (r: { ok: boolean; error?: string }) => void) => () => void
}
declare global {
  interface Window { mosaicUpdater?: MosaicUpdater }
}

/**
 * Edition-aware update dialog.
 *  - Personal (Electron desktop app, updater bridge present): "Update now" runs
 *    docker compose pull && up -d in the desktop shell, streaming a progress bar —
 *    the same experience as first install.
 *  - Enterprise / plain browser (no bridge): updating a server is an IT operation, so
 *    we show the documented steps + "notify your administrator", never a self-update
 *    button.
 */
export function UpdateModal({ deploy, onClose }: {
  deploy: { edition?: string; currentVersion?: string; latestVersion?: string | null; latestReleaseUrl?: string | null }
  onClose: () => void
}) {
  const [canSelfUpdate, setCanSelfUpdate] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [pct, setPct] = useState(0)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    // Self-update is only offered when the Electron bridge is actually present AND
    // the server considers this a Personal deployment. Both must hold.
    setCanSelfUpdate(!!window.mosaicUpdater?.available && deploy.edition === 'personal')
  }, [deploy.edition])

  function startUpdate() {
    if (!window.mosaicUpdater) return
    setUpdating(true); setError(''); setPct(5); setMessage('Starting update…')
    const offP = window.mosaicUpdater.onProgress(p => {
      if (typeof p.pct === 'number') setPct(p.pct)
      if (p.message) setMessage(p.message)
    })
    const offD = window.mosaicUpdater.onDone(r => {
      offP(); offD()
      if (r.ok) { setPct(100); setDone(true); setMessage('Update complete — reloading…'); setTimeout(() => window.location.reload(), 1800) }
      else { setUpdating(false); setError(r.error || 'Update failed. Check the desktop app logs.') }
    })
    window.mosaicUpdater.update()
  }

  const v = deploy.latestVersion

  return (
    <div onClick={updating ? undefined : onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 24 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', width: 'min(460px, 100%)', overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', fontFamily: 'Georgia, serif' }}>
            {done ? 'Update complete' : `Update available — v${v}`}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 3 }}>
            You&rsquo;re on v{deploy.currentVersion}.
          </div>
        </div>

        <div style={{ padding: 22 }}>
          {/* Progress (self-update in flight) */}
          {updating ? (
            <div>
              <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 10 }}>{message}</div>
              <div style={{ height: 8, borderRadius: 999, background: 'var(--bg3)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: 'var(--blue)', borderRadius: 999, transition: 'width .4s ease' }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text4)', marginTop: 6, textAlign: 'right' }}>{Math.round(pct)}%</div>
              {!done && <div style={{ fontSize: 11, color: 'var(--text4)', marginTop: 10 }}>Keep the app open — this can take a couple of minutes.</div>}
            </div>
          ) : canSelfUpdate ? (
            // Personal: one-click update.
            <div>
              <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 16 }}>
                Mosaic will download v{v} and restart. Your data and settings are kept.
              </div>
              {error && <div style={{ fontSize: 12, color: 'var(--red-t)', background: 'var(--red-bg, #fef2f2)', border: '1px solid var(--red-t)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', marginBottom: 12 }}>{error}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                {deploy.latestReleaseUrl && <a href={deploy.latestReleaseUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, color: 'var(--text3)', textDecoration: 'none', alignSelf: 'center', marginRight: 'auto' }}>Release notes ↗</a>}
                <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text2)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Later</button>
                <button onClick={startUpdate} style={{ padding: '8px 18px', borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--accent-bg)', color: 'var(--accent-fg)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Update now</button>
              </div>
            </div>
          ) : (
            // Enterprise / browser: updates are an administrator operation.
            <div>
              <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 14 }}>
                A new version is available. On this deployment, updates are applied on the
                server by your administrator — Mosaic won&rsquo;t update itself from here.
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>To update (administrator)</div>
              <pre style={{ margin: 0, padding: '10px 12px', background: 'var(--bg3)', borderRadius: 'var(--radius-sm)', fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--text2)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{`docker compose pull mosaic
docker compose up -d mosaic`}</pre>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, alignItems: 'center' }}>
                {deploy.latestReleaseUrl && <a href={deploy.latestReleaseUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, color: 'var(--text3)', textDecoration: 'none', marginRight: 'auto' }}>Release notes ↗</a>}
                <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--accent-bg)', color: 'var(--accent-fg)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Got it</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

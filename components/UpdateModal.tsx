'use client'

import { useState } from 'react'

interface ChangelogEntry { version: string; date: string; sections: Record<string, string[]> }

// Edition-aware update dialog — Mosaic-styled, self-contained. NEVER opens an external
// GitHub page (release notes render inline from the app's own changelog), and NEVER
// auto-updates (that path black-screened the Electron window it was updating). Both
// editions show clear, reliable guided steps:
//   Personal   -> quit & reopen (the installer fetches the new version) / CLI fallback
//   Enterprise -> the administrator runs docker compose on the server
export function UpdateModal({ deploy, onClose }: {
  deploy: {
    edition?: string; currentVersion?: string; latestVersion?: string | null
    changelog?: ChangelogEntry[]
  }
  onClose: () => void
}) {
  const [showNotes, setShowNotes] = useState(false)

  const notes = (deploy.changelog || []).find(c => c.version === deploy.latestVersion) || (deploy.changelog || [])[0]
  const v = deploy.latestVersion
  const clean = (s: string) => s.replace(/\*\*/g, '').replace(/`/g, '')

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 24 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', width: 'min(440px, 100%)', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        <div style={{ padding: '20px 22px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>
            Mosaic v{v} is available
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 4 }}>You&rsquo;re on v{deploy.currentVersion}.</div>
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto' }}>
          {/* Release notes — inline, Mosaic-styled, from the app's own changelog. */}
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

          {deploy.edition === 'personal' ? (
            <div>
              <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 10 }}>
                To update to v{v}, open a terminal in your <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg3)', padding: '1px 5px', borderRadius: 4 }}>~/Mosaic</code> folder and run the commands below, then reopen Mosaic. Your data and settings are kept.
              </div>
              <pre style={{ margin: '8px 0 0', padding: '10px 12px', background: 'var(--bg3)', borderRadius: 'var(--radius-sm)', fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--text2)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{`cd ~/Mosaic
docker compose pull
docker compose up -d`}</pre>
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
        </div>

        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '8px 20px', borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--accent-bg)', color: 'var(--accent-fg)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Got it</button>
        </div>
      </div>
    </div>
  )
}

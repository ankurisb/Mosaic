'use client'

import { useState } from 'react'

export interface QueryRow {
  id: string
  name: string
  source_sql?: string | null
  source_connection?: string | null
  superset_dashboard_id?: number | null
  created_at?: string
  updated_at?: string
}

const PAGE_SIZE = 10

function fmtDate(s?: string): string {
  if (!s) return '\u2014'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * A Mosaic-styled, paginated table of every dashboard Mosaic built in Superset
 * from a query — the authored SQL, the connection, when it was created, and a link.
 * Structured to grow: when a dashboard holds multiple charts/queries, this becomes
 * one row per (dashboard, chart) rather than per dashboard.
 */
export function QueriesTable({ rows, supersetUrl, onClose }: {
  rows: QueryRow[]
  supersetUrl?: string
  onClose: () => void
}) {
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)

  const total = rows.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const dashUrl = (id?: number | null) =>
    supersetUrl && id != null ? `${supersetUrl.replace(/\/$/, '')}/superset/dashboard/${id}/` : null

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-md)', width: 'min(960px, 100%)', maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', fontFamily: 'Georgia, serif' }}>Queries &amp; dashboards</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>Dashboards Mosaic built in Superset from a query</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 20, lineHeight: 1, padding: 4 }}>&times;</button>
        </div>

        <div style={{ overflow: 'auto', flex: 1 }}>
          {total === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
              No query-built dashboards yet. Use the Query Builder to create one.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  <th style={{ padding: '10px 20px', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>Dashboard</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>Connection</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>Created</th>
                  <th style={{ padding: '10px 20px', fontWeight: 600, borderBottom: '1px solid var(--border)', textAlign: 'right' }}>Query &middot; Link</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(r => {
                  const url = dashUrl(r.superset_dashboard_id)
                  const isOpen = expanded === r.id
                  return (
                    <>
                      <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '11px 20px', color: 'var(--text)', fontWeight: 500 }}>{r.name}</td>
                        <td style={{ padding: '11px 12px', color: 'var(--text2)' }}>{r.source_connection || '\u2014'}</td>
                        <td style={{ padding: '11px 12px', color: 'var(--text3)', whiteSpace: 'nowrap' }}>{fmtDate(r.created_at || r.updated_at)}</td>
                        <td style={{ padding: '11px 20px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {r.source_sql && (
                            <button
                              onClick={() => setExpanded(isOpen ? null : r.id)}
                              style={{ fontSize: 11.5, color: 'var(--blue-t)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', marginRight: 12 }}
                            >{isOpen ? 'hide SQL' : 'view SQL'}</button>
                          )}
                          {url && (
                            <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, color: 'var(--blue-t)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              open
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14L21 3"/></svg>
                            </a>
                          )}
                        </td>
                      </tr>
                      {isOpen && r.source_sql && (
                        <tr key={r.id + '-sql'}>
                          <td colSpan={4} style={{ padding: '0 20px 12px' }}>
                            <pre style={{ margin: 0, padding: '10px 12px', background: 'var(--bg3)', borderRadius: 'var(--radius-sm)', fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--text2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflow: 'auto' }}>{r.source_sql}</pre>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {total > PAGE_SIZE && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>
              Page {page + 1} of {totalPages} &middot; showing {page * PAGE_SIZE + 1}&ndash;{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                style={{ fontSize: 12, padding: '4px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border2)', background: 'var(--bg)', color: page === 0 ? 'var(--text4)' : 'var(--text)', cursor: page === 0 ? 'default' : 'pointer', fontFamily: 'inherit' }}>&lsaquo; Prev</button>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                style={{ fontSize: 12, padding: '4px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border2)', background: 'var(--bg)', color: page >= totalPages - 1 ? 'var(--text4)' : 'var(--text)', cursor: page >= totalPages - 1 ? 'default' : 'pointer', fontFamily: 'inherit' }}>Next &rsaquo;</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

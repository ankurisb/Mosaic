'use client'
import { useEffect, useMemo, useState } from 'react'
import { DATA_SOURCES, DS_GROUPS, type DsEntry } from '@/lib/datasource-catalog'
import { AIRBYTE_SOURCES } from '@/lib/airbyte-sources'
import DataSourceIcon from './DataSourceIcon'
import { INP } from './ui'

const CONNECTORS_GROUP = 'Connectors'
const PAGE_SIZE = 60

// The connector catalogue is shown white-labelled, so drop the one upstream entry that is itself
// named after the connector platform.
const CONNECTORS = AIRBYTE_SOURCES.filter(s => s.slug !== 'airbyte' && !/airbyte/i.test(s.name))

// The "Browse" front door: pick WHAT you want to connect to and Mosaic routes you into the right
// flow. A search box over an NxN icon grid; curated sources (warehouses, databases, business apps,
// built-in API templates) plus the full connector catalogue (paginated, icons served locally).
export default function TabDataSourceCatalog({ onPick }: { onPick: (entry: DsEntry) => void }) {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [connIcons, setConnIcons] = useState<Record<string, string> | null>(null)

  // Fetch the bundled connector icon map once (same-origin asset — air-gap, no internet).
  useEffect(() => {
    let alive = true
    fetch('/connectors/airbyte-icons.json').then(r => r.ok ? r.json() : {}).then(d => { if (alive) setConnIcons(d) }).catch(() => { if (alive) setConnIcons({}) })
    return () => { alive = false }
  }, [])

  const needle = q.trim().toLowerCase()
  useEffect(() => { setPage(1) }, [needle])

  const curatedGroups = useMemo(() => {
    const match = (e: DsEntry) =>
      !needle || e.name.toLowerCase().includes(needle) || e.id.includes(needle) ||
      (e.dialect || '').includes(needle) || (e.blurb || '').toLowerCase().includes(needle) ||
      (e.keywords || []).some(k => k.includes(needle))
    const filtered = DATA_SOURCES.filter(match)
    return DS_GROUPS.map(g => ({ group: g, items: filtered.filter(e => e.group === g) })).filter(s => s.items.length > 0)
  }, [needle])

  const connectors = useMemo(
    () => needle ? CONNECTORS.filter(s => s.name.toLowerCase().includes(needle) || s.slug.includes(needle)) : CONNECTORS,
    [needle],
  )
  const pageCount = Math.max(1, Math.ceil(connectors.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageItems = connectors.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const total = curatedGroups.reduce((n, s) => n + s.items.length, 0) + connectors.length
  const connEntry = (s: { name: string; slug: string }): DsEntry => ({ id: 'ab-' + s.slug, name: s.name, category: 'airbyte', group: CONNECTORS_GROUP })

  return (
    <div>
      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 24, maxWidth: 440 }}>
        <input autoFocus value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search 600+ data sources — Snowflake, Postgres, Stripe, Shopify…" style={{ ...INP, paddingLeft: 36 }} />
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--text4)" strokeWidth={2}
          style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
          <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
        </svg>
      </div>

      {total === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text3)', padding: '24px 0' }}>
          No data source matches “{q}”. Try a different term, or use the tabs above to set one up directly.
        </div>
      )}

      {/* Curated groups */}
      {curatedGroups.map(section => (
        <Section key={section.group} title={section.group}>
          {section.items.map(e => (
            <Tile key={e.id} name={e.name} onClick={() => onPick(e)}>
              <DataSourceIcon icon={e.icon} color={e.color} name={e.name} size={44} kind={e.category} />
            </Tile>
          ))}
        </Section>
      ))}

      {/* Connector catalogue (paginated) */}
      {connectors.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text3)' }}>
              {CONNECTORS_GROUP} · {connectors.length}
            </div>
            {pageCount > 1 && <Pager page={safePage} pageCount={pageCount} onChange={setPage} />}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 10 }}>
            {pageItems.map(s => (
              <Tile key={s.slug} name={s.name} onClick={() => onPick(connEntry(s))}>
                <DataSourceIcon name={s.name} size={44} kind="connector" svg={s.icon ? connIcons?.[s.slug] : undefined} />
              </Tile>
            ))}
          </div>
          {pageCount > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
              <Pager page={safePage} pageCount={pageCount} onChange={setPage} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text3)', marginBottom: 12 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 10 }}>{children}</div>
    </div>
  )
}

function Tile({ name, onClick, children }: { name: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={name}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center',
        padding: '16px 8px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)',
        background: 'var(--surface)', cursor: 'pointer', fontFamily: 'inherit', width: '100%', minWidth: 0,
        transition: 'border-color .15s, background .15s',
      }}
      onMouseEnter={ev => { ev.currentTarget.style.borderColor = 'var(--border2)'; ev.currentTarget.style.background = 'var(--bg2)' }}
      onMouseLeave={ev => { ev.currentTarget.style.borderColor = 'var(--border)'; ev.currentTarget.style.background = 'var(--surface)' }}>
      {children}
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', lineHeight: 1.25, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', width: '100%' }}>{name}</span>
    </button>
  )
}

function Pager({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (p: number) => void }) {
  const btn: React.CSSProperties = {
    padding: '5px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border2)', background: 'var(--bg)',
    color: 'var(--text2)', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
  }
  const disabled: React.CSSProperties = { opacity: 0.45, cursor: 'default' }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button style={{ ...btn, ...(page <= 1 ? disabled : {}) }} disabled={page <= 1} onClick={() => onChange(page - 1)}>‹ Prev</button>
      <span style={{ fontSize: 12, color: 'var(--text3)', minWidth: 72, textAlign: 'center' }}>Page {page} / {pageCount}</span>
      <button style={{ ...btn, ...(page >= pageCount ? disabled : {}) }} disabled={page >= pageCount} onClick={() => onChange(page + 1)}>Next ›</button>
    </div>
  )
}

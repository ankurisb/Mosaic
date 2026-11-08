'use client'
import { useEffect, useMemo, useState } from 'react'
import { DATA_SOURCES, DS_GROUPS, type DsEntry } from '@/lib/datasource-catalog'
import { AIRBYTE_SOURCES } from '@/lib/airbyte-sources'
import DataSourceIcon from './DataSourceIcon'
import { INP } from './ui'

const AIRBYTE_GROUP = 'Connectors (via Airbyte)'
const AIRBYTE_PREVIEW = 48   // how many Airbyte tiles to show before "Show all"

// The "Browse" front door: pick WHAT you want to connect to and Mosaic routes you into the right
// flow. A search box over an NxN icon grid; curated sources (warehouses, databases, business apps,
// built-in API templates) plus the full Airbyte connector catalogue (icons served locally).
export default function TabDataSourceCatalog({ onPick }: { onPick: (entry: DsEntry) => void }) {
  const [q, setQ] = useState('')
  const [showAllAb, setShowAllAb] = useState(false)
  const [abIcons, setAbIcons] = useState<Record<string, string> | null>(null)

  // Fetch the bundled Airbyte icon map once (same-origin asset — air-gap, no internet). Non-blocking:
  // tiles render with a monogram until it arrives, then upgrade to the real glyph.
  useEffect(() => {
    let alive = true
    fetch('/connectors/airbyte-icons.json').then(r => r.ok ? r.json() : {}).then(d => { if (alive) setAbIcons(d) }).catch(() => { if (alive) setAbIcons({}) })
    return () => { alive = false }
  }, [])

  const needle = q.trim().toLowerCase()

  const curatedGroups = useMemo(() => {
    const match = (e: DsEntry) =>
      !needle || e.name.toLowerCase().includes(needle) || e.id.includes(needle) ||
      (e.dialect || '').includes(needle) || (e.blurb || '').toLowerCase().includes(needle) ||
      (e.keywords || []).some(k => k.includes(needle))
    const filtered = DATA_SOURCES.filter(match)
    return DS_GROUPS.map(g => ({ group: g, items: filtered.filter(e => e.group === g) })).filter(s => s.items.length > 0)
  }, [needle])

  const abMatches = useMemo(
    () => needle ? AIRBYTE_SOURCES.filter(s => s.name.toLowerCase().includes(needle) || s.slug.includes(needle)) : AIRBYTE_SOURCES,
    [needle],
  )
  const abShown = needle || showAllAb ? abMatches : abMatches.slice(0, AIRBYTE_PREVIEW)

  const total = curatedGroups.reduce((n, s) => n + s.items.length, 0) + abMatches.length

  const abEntry = (s: { name: string; slug: string }): DsEntry => ({ id: 'ab-' + s.slug, name: s.name, category: 'airbyte', group: AIRBYTE_GROUP })

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16 }}>
        Choose what you want to connect to — Mosaic takes you to the right setup (database, API, MCP or connector).
      </div>

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
              <DataSourceIcon icon={e.icon} color={e.color} name={e.name} size={44} />
            </Tile>
          ))}
        </Section>
      ))}

      {/* Airbyte connector catalogue */}
      {abShown.length > 0 && (
        <Section title={`${AIRBYTE_GROUP}${!needle ? ` · ${AIRBYTE_SOURCES.length}` : ''}`}>
          {abShown.map(s => (
            <Tile key={s.slug} name={s.name} onClick={() => onPick(abEntry(s))}>
              <DataSourceIcon name={s.name} size={44} svg={s.icon ? abIcons?.[s.slug] : undefined} color="#615EFF" />
            </Tile>
          ))}
        </Section>
      )}
      {!needle && !showAllAb && abMatches.length > AIRBYTE_PREVIEW && (
        <button onClick={() => setShowAllAb(true)}
          style={{ marginTop: -8, padding: '8px 14px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text2)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
          Show all {abMatches.length} Airbyte connectors
        </button>
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

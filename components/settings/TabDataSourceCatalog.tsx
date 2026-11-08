'use client'
import { useMemo, useState } from 'react'
import { DATA_SOURCES, DS_GROUPS, type DsEntry } from '@/lib/datasource-catalog'
import DataSourceIcon from './DataSourceIcon'
import { INP } from './ui'

// The "Browse" front door: pick WHAT you want to connect to (Snowflake, Postgres, an API, an MCP
// server…) and Mosaic routes you into the right flow. Search at the top; brand-icon cards grouped
// by kind. onPick hands the chosen entry back to TabDataSources, which switches to the owning
// sub-tab (and, for databases, pre-selects the dialect).
export default function TabDataSourceCatalog({ onPick }: { onPick: (entry: DsEntry) => void }) {
  const [q, setQ] = useState('')

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const match = (e: DsEntry) =>
      !needle ||
      e.name.toLowerCase().includes(needle) ||
      e.id.includes(needle) ||
      (e.dialect || '').includes(needle) ||
      (e.blurb || '').toLowerCase().includes(needle) ||
      (e.keywords || []).some(k => k.includes(needle))
    const filtered = DATA_SOURCES.filter(match)
    return DS_GROUPS
      .map(g => ({ group: g, items: filtered.filter(e => e.group === g) }))
      .filter(s => s.items.length > 0)
  }, [q])

  const total = groups.reduce((n, s) => n + s.items.length, 0)

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16 }}>
        Choose what you want to connect to — Mosaic takes you to the right setup (database, API, MCP or connector).
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 24, maxWidth: 420 }}>
        <input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search data sources — Snowflake, Postgres, API…"
          style={{ ...INP, paddingLeft: 36 }}
        />
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

      {groups.map(section => (
        <div key={section.group} style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text3)', marginBottom: 12 }}>
            {section.group}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
            {section.items.map(e => (
              <button
                key={e.id}
                onClick={() => onPick(e)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
                  padding: 12, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)',
                  background: 'var(--surface)', cursor: 'pointer', fontFamily: 'inherit', width: '100%',
                  transition: 'border-color .15s, background .15s, transform .05s',
                }}
                onMouseEnter={ev => { ev.currentTarget.style.borderColor = 'var(--border2)'; ev.currentTarget.style.background = 'var(--bg2)' }}
                onMouseLeave={ev => { ev.currentTarget.style.borderColor = 'var(--border)'; ev.currentTarget.style.background = 'var(--surface)' }}
              >
                <DataSourceIcon icon={e.icon} color={e.color} name={e.name} size={40} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</div>
                  {e.blurb && <div style={{ fontSize: 11.5, color: 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.blurb}</div>}
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

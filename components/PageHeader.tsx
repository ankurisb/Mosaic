'use client'
import React from 'react'
import { useIsMobile } from '@/lib/useIsMobile'

// Shared page header for every top-level section (Agents, Dashboards, Digests,
// Query Builder, Rules, Assets). One consistent pattern: a surface band with the
// page title + one-line subtitle on the left, primary actions on the right, and
// optional underline tabs along the bottom edge. No breadcrumbs — the sidebar
// already shows location. See DESIGN_SYSTEM.md.
//
// On mobile the AppShell app-bar already shows the section title, so the big <h1>
// is hidden here to avoid showing it twice; subtitle, actions and tabs remain.

export interface PageTab { id: string; label: string }

// Reusable action-button styles so every header's buttons match.
export const hbtnPrimary: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px',
  background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: '1px solid transparent',
  borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
  fontFamily: 'inherit', flexShrink: 0, whiteSpace: 'nowrap',
}
export const hbtnSecondary: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
  background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border2)',
  borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
  fontFamily: 'inherit', flexShrink: 0, whiteSpace: 'nowrap',
}

export default function PageHeader({
  title, subtitle, actions, tabs, activeTab, onTab,
}: {
  title: string
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  tabs?: PageTab[]
  activeTab?: string
  onTab?: (id: string) => void
}) {
  const isMobile = useIsMobile()
  const hasTabs = !!tabs && tabs.length > 0
  return (
    <div style={{
      background: 'var(--surface)', borderBottom: '1px solid var(--border)',
      padding: isMobile ? '12px 16px 0' : '16px 24px 0', flexShrink: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 16, flexWrap: 'wrap', paddingBottom: hasTabs ? 10 : (isMobile ? 12 : 16),
      }}>
        <div style={{ minWidth: 0 }}>
          {!isMobile && (
            <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-.01em', color: 'var(--text)', margin: 0 }}>{title}</h1>
          )}
          {subtitle && (
            <p style={{ fontSize: 13, color: 'var(--text3)', margin: isMobile ? 0 : '3px 0 0', lineHeight: 1.5 }}>{subtitle}</p>
          )}
        </div>
        {actions && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>{actions}</div>
        )}
      </div>
      {hasTabs && (
        <div style={{ display: 'flex', gap: 2, overflowX: 'auto' }}>
          {tabs!.map(t => {
            const on = activeTab === t.id
            return (
              <button key={t.id} onClick={() => onTab?.(t.id)}
                style={{
                  padding: isMobile ? '11px 14px' : '9px 14px', fontSize: isMobile ? 14 : 13,
                  fontWeight: on ? 600 : 500, color: on ? 'var(--text)' : 'var(--text2)',
                  background: 'none', border: 'none',
                  borderBottom: on ? '2px solid var(--accent)' : '2px solid transparent',
                  cursor: 'pointer', fontFamily: 'inherit', marginBottom: -1, whiteSpace: 'nowrap',
                }}>
                {t.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

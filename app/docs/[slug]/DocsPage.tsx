'use client'
import React, { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Link from 'next/link'

interface DocEntry { file: string; title: string }

const NAV_ITEMS = [
  { slug: 'install',     label: 'Install guide',
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M7 1v8M4 6l3 3 3-3"/><path d="M2 10v2a1 1 0 001 1h8a1 1 0 001-1v-2"/></svg> },
  { slug: 'first-steps', label: 'First steps',
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 7l3 3 7-6"/></svg> },
  { slug: 'updating',    label: 'Updating',
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M7 10V3M4 6l3-3 3 3"/><path d="M2 11h10"/></svg> },
  { slug: 'secrets',     label: 'Secrets & credentials',
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="5.5" cy="5.5" r="2.5"/><path d="M7.5 7.5l4 4M9.5 9.5l1.5-1.5"/></svg> },
  { slug: 'network',     label: 'Network requirements',
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="7" cy="7" r="5.5"/><path d="M7 1.5C5 3.5 4 5.2 4 7s1 3.5 3 5.5M7 1.5C9 3.5 10 5.2 10 7s-1 3.5-3 5.5M1.5 7h11"/></svg> },
  { slug: 'keycloak',    label: 'SSO / Keycloak',
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><rect x="2" y="6" width="10" height="7" rx="1.5"/><path d="M4 6V4a3 3 0 016 0v2"/></svg> },
]

// Rewrite markdown file links to internal /docs/ routes
function rewriteDocLinks(content: string): string {
  const linkMap: Record<string, string> = {
    'INSTALL.md':      '/docs/install',
    'FIRST_STEPS.md':  '/docs/first-steps',
    'UPDATING.md':     '/docs/updating',
    'SECRETS.md':      '/docs/secrets',
    'NETWORK.md':      '/docs/network',
    'KEYCLOAK.md':     '/docs/keycloak',
    'docs/INSTALL.md':      '/docs/install',
    'docs/FIRST_STEPS.md':  '/docs/first-steps',
    'docs/UPDATING.md':     '/docs/updating',
    'docs/SECRETS.md':      '/docs/secrets',
    'docs/NETWORK.md':      '/docs/network',
    'docs/KEYCLOAK.md':     '/docs/keycloak',
  }
  return content.replace(/\]\(([^)]+\.md)\)/g, (match, href) => {
    return `](${linkMap[href] || href})`
  })
}

export default function DocsPage({
  title, slug, content, docMap,
}: {
  title: string
  slug: string
  content: string
  docMap: Record<string, DocEntry>
}) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    const t = document.documentElement.getAttribute('data-theme')
    if (t === 'dark') setTheme('dark')
    const obs = new MutationObserver(() => {
      setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
    })
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-sans)' }}>

      {/* Sidebar */}
      <aside style={{ width: 240, flexShrink: 0, background: 'var(--surface)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}>
        {/* Logo / back */}
        <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid var(--border)' }}>
          <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 18, color: 'var(--text)', fontWeight: 400 }}>Mosaic</span>
          </Link>
          <Link href="/" style={{ fontSize: 11, color: 'var(--text3)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
            <span>←</span> Back to Mosaic
          </Link>
        </div>

        {/* Nav label */}
        <div style={{ padding: '16px 16px 6px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text4)' }}>
          Documentation
        </div>

        {/* Nav links */}
        <nav style={{ flex: 1, padding: '0 8px 16px' }}>
          {NAV_ITEMS.map(item => {
            const active = item.slug === slug
            return (
              <Link key={item.slug} href={`/docs/${item.slug}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 10px', borderRadius: 'var(--radius-sm)',
                  fontSize: 13, textDecoration: 'none',
                  color: active ? 'var(--text)' : 'var(--text2)',
                  background: active ? 'var(--bg3)' : 'transparent',
                  fontWeight: active ? 500 : 400,
                  marginBottom: 1,
                  transition: 'background .1s, color .1s',
                }}>
                <span style={{ width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: active ? 1 : 0.5 }}>{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Footer version */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text4)' }}>
          Mosaic Documentation
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ maxWidth: 780, margin: '0 auto', padding: '48px 40px 80px' }}>

          {/* Breadcrumb */}
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Link href="/" style={{ color: 'var(--text3)', textDecoration: 'none' }}>Mosaic</Link>
            <span>/</span>
            <span>Docs</span>
            <span>/</span>
            <span style={{ color: 'var(--text2)' }}>{title}</span>
          </div>

          <div className="docs-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                h1: ({ children }) => (
                  <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 30, fontWeight: 400, color: 'var(--text)', marginBottom: 8, marginTop: 0, lineHeight: 1.3 }}>{children}</h1>
                ),
                h2: ({ children }) => (
                  <>
                    <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '40px 0 24px' }} />
                    <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', marginBottom: 14, marginTop: 0, lineHeight: 1.4 }}>{children}</h2>
                  </>
                ),
                h3: ({ children }) => (
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 10, marginTop: 24 }}>{children}</h3>
                ),
                p: ({ children }) => (
                  <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.8, marginBottom: 14 }}>{children}</p>
                ),
                a: ({ href, children }) => (
                  <a href={href} style={{ color: 'var(--blue-t)', textDecoration: 'none', borderBottom: '1px solid rgba(37,99,235,.3)' }}
                    target={href?.startsWith('http') ? '_blank' : undefined}
                    rel={href?.startsWith('http') ? 'noreferrer' : undefined}>
                    {children}
                  </a>
                ),
                code: ({ children, className }) => {
                  const isBlock = className?.includes('language-')
                  if (isBlock) return (
                    <code style={{ display: 'block', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '14px 16px', fontSize: 12.5, fontFamily: 'var(--font-mono)', lineHeight: 1.7, color: 'var(--text)', overflowX: 'auto', whiteSpace: 'pre' }}>
                      {children}
                    </code>
                  )
                  return <code style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{children}</code>
                },
                pre: ({ children }) => (
                  <pre style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '14px 16px', fontSize: 12.5, fontFamily: 'var(--font-mono)', lineHeight: 1.7, color: 'var(--text)', overflowX: 'auto', marginBottom: 16 }}>{children}</pre>
                ),
                ul: ({ children }) => (
                  <ul style={{ paddingLeft: 20, marginBottom: 14, color: 'var(--text2)', fontSize: 14, lineHeight: 1.8 }}>{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol style={{ paddingLeft: 20, marginBottom: 14, color: 'var(--text2)', fontSize: 14, lineHeight: 1.8 }}>{children}</ol>
                ),
                li: ({ children }) => (
                  <li style={{ marginBottom: 4 }}>{children}</li>
                ),
                blockquote: ({ children }) => (
                  <blockquote style={{ borderLeft: '3px solid var(--border2)', paddingLeft: 14, margin: '0 0 14px', color: 'var(--text3)', fontStyle: 'italic', fontSize: 13 }}>{children}</blockquote>
                ),
                table: ({ children }) => (
                  <div style={{ overflowX: 'auto', marginBottom: 16 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>{children}</table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead style={{ background: 'var(--bg3)' }}>{children}</thead>
                ),
                th: ({ children }) => (
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--text2)', borderBottom: '1px solid var(--border)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em' }}>{children}</th>
                ),
                td: ({ children }) => (
                  <td style={{ padding: '9px 12px', borderBottom: '1px solid var(--border)', color: 'var(--text2)', verticalAlign: 'top' }}>{children}</td>
                ),
                tr: ({ children }) => (
                  <tr style={{ transition: 'background .1s' }}>{children}</tr>
                ),
                strong: ({ children }) => (
                  <strong style={{ fontWeight: 600, color: 'var(--text)' }}>{children}</strong>
                ),
                hr: () => (
                  <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '32px 0' }} />
                ),
              }}
            >
              {rewriteDocLinks(content)}
            </ReactMarkdown>
          </div>

          {/* Page footer nav */}
          <div style={{ marginTop: 56, paddingTop: 24, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            {(() => {
              const idx = NAV_ITEMS.findIndex(n => n.slug === slug)
              const prev = idx > 0 ? NAV_ITEMS[idx - 1] : null
              const next = idx < NAV_ITEMS.length - 1 ? NAV_ITEMS[idx + 1] : null
              return (
                <>
                  {prev ? (
                    <Link href={`/docs/${prev.slug}`}
                      style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', textDecoration: 'none', minWidth: 160 }}>
                      <span style={{ fontSize: 11, color: 'var(--text4)' }}>← Previous</span>
                      <span style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 500 }}>{prev.label}</span>
                    </Link>
                  ) : <div />}
                  {next ? (
                    <Link href={`/docs/${next.slug}`}
                      style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', textDecoration: 'none', minWidth: 160, textAlign: 'right', alignItems: 'flex-end' }}>
                      <span style={{ fontSize: 11, color: 'var(--text4)' }}>Next →</span>
                      <span style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 500 }}>{next.label}</span>
                    </Link>
                  ) : <div />}
                </>
              )
            })()}
          </div>
        </div>
      </main>
    </div>
  )
}

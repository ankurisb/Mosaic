import { SH, SS, Badge } from './ui'

const DEPS = [
  { name: 'next', version: '15.3.9', status: 'ok' },
  { name: '@anthropic-ai/sdk', version: '0.39.0', status: 'ok' },
  { name: '@neondatabase/serverless', version: '0.10.4', status: 'ok' },
  { name: 'bcryptjs', version: '2.4.3', status: 'ok' },
  { name: 'jose', version: '5.9.6', status: 'ok' },
  { name: 'pg', version: '8.13.1', status: 'update' },
  { name: 'react', version: '19.1.0', status: 'ok' },
  { name: 'typescript', version: '5.7.3', status: 'ok' },
]

const CHANGELOG = [
  { version: 'v1.0.0', date: '8 April 2026', type: 'initial', items: [
    'Claude chat with streaming responses and tool use',
    'Web search via Tavily API',
    'Database connections — query PostgreSQL, MySQL, SQL Server from chat',
    'API service workspaces — call HubSpot, Stripe, Salesforce and any REST API from chat',
    'User management with admin/user roles',
    'Usage analytics with per-user cost tracking',
    'Service monitoring with live health checks',
    'Authentication via email + password with JWT sessions',
  ]},
]

export default function TabAbout() {
  return (
    <div>
      <div style={SH}>About</div>
      <div style={SS}>Version information, dependencies, and changelog.</div>

      {/* Version card */}
      <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 10, padding: 24, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 22, fontWeight: 500 }}>claude app</span>
          <span style={{ fontSize: 12, color: 'var(--text2)', padding: '2px 8px', borderRadius: 5, background: 'var(--bg4)', border: '1px solid var(--border2)' }}>v1.0.0</span>
          <Badge label="stable" color="green" />
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 16 }}>Build 20260408 · Released 8 April 2026 · ugx.ai</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { label: 'Platform', value: 'Vercel (Edge/Node.js)', sub: 'Serverless functions' },
            { label: 'AI model', value: 'claude-sonnet-4-5', sub: 'Anthropic · streaming enabled' },
            { label: 'Database', value: 'PostgreSQL (Neon)', sub: 'Serverless · auto-scaling' },
            { label: 'Authentication', value: 'JWT + bcrypt', sub: '7-day sessions' },
            { label: 'Web search', value: 'Tavily API', sub: '1,000 free searches/month' },
            { label: 'DB querying', value: 'node-postgres (pg)', sub: 'PostgreSQL, MySQL, SQL Server' },
          ].map(item => (
            <div key={item.label} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 7, padding: '10px 14px' }}>
              <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.08em', marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontSize: 12, color: 'var(--text)' }}>{item.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{item.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Dependencies */}
      <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.1em', marginBottom: 10 }}>Dependencies</div>
      <div style={{ border: '1px solid var(--border2)', borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ padding: '0 16px' }}>
          {DEPS.map((d, i) => (
            <div key={d.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: i < DEPS.length - 1 ? '1px solid var(--border)' : 'none', fontSize: 12 }}>
              <span style={{ color: 'var(--text2)' }}>{d.name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code style={{ fontSize: 11, color: 'var(--text3)' }}>{d.version}</code>
                {d.status === 'ok' ? <span style={{ fontSize: 10, color: 'var(--gt)' }}>✓ up to date</span> : <span style={{ fontSize: 10, color: 'var(--at)' }}>↑ update available</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Changelog */}
      <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.1em', marginBottom: 10 }}>Changelog</div>
      <div style={{ border: '1px solid var(--border2)', borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ padding: '0 16px' }}>
          {CHANGELOG.map((entry, i) => (
            <div key={entry.version} style={{ paddingTop: 12, paddingBottom: 12, borderBottom: i < CHANGELOG.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{entry.version}</span>
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>{entry.date}</span>
                <Badge label="initial release" color="green" />
              </div>
              <div style={{ paddingLeft: 12 }}>
                {entry.items.map((item, j) => (
                  <div key={j} style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.8 }}>· {item}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'center' as const, padding: '4px 0' }}>
        claude app v1.0.0 · build 20260408 · ugx.ai · powered by Anthropic Claude
      </div>
    </div>
  )
}

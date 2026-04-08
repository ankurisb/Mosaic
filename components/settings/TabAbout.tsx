import { PageTitle, PageSub, SectionLabel, Card, Badge } from './ui'

const DEPS = [
  { name: 'next',                    version: '15.3.9', ok: true },
  { name: '@anthropic-ai/sdk',       version: '0.39.0', ok: true },
  { name: '@neondatabase/serverless', version: '0.10.4', ok: true },
  { name: 'bcryptjs',                version: '2.4.3',  ok: true },
  { name: 'jose',                    version: '5.9.6',  ok: true },
  { name: 'pg',                      version: '8.13.1', ok: false },
  { name: 'react',                   version: '19.1.0', ok: true },
  { name: 'typescript',              version: '5.7.3',  ok: true },
]

export default function TabAbout() {
  return (
    <div className="fade-in">
      <PageTitle>About</PageTitle>
      <PageSub>Version information, system details, and changelog.</PageSub>

      {/* Version card */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 28, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: 28, color: 'var(--text)' }}>claude app</span>
          <span style={{ fontSize: 14, color: 'var(--text2)', background: 'var(--bg3)', padding: '3px 10px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border)', fontWeight: 500 }}>v1.0.0</span>
          <Badge label="stable" color="green" />
        </div>
        <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 24 }}>Build 20260408 · Released 8 April 2026 · ugx.ai</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { label: 'Platform',       value: 'Vercel (Node.js runtime)', sub: 'Serverless functions' },
            { label: 'AI model',       value: 'claude-sonnet-4-5',         sub: 'Anthropic · streaming' },
            { label: 'Database',       value: 'PostgreSQL (Neon)',         sub: 'Serverless · auto-scaling' },
            { label: 'Authentication', value: 'JWT + bcrypt',              sub: '7-day sessions' },
            { label: 'Web search',     value: 'Tavily API',                sub: '1,000 free/month' },
            { label: 'DB querying',    value: 'node-postgres (pg)',        sub: 'PostgreSQL, MySQL, SQL Server' },
          ].map(item => (
            <div key={item.label} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.06em', marginBottom: 5 }}>{item.label}</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>{item.value}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{item.sub}</div>
            </div>
          ))}
        </div>
      </div>

      <SectionLabel>Dependencies</SectionLabel>
      <Card>
        <div style={{ padding: '0 18px' }}>
          {DEPS.map((d, i) => (
            <div key={d.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < DEPS.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <span style={{ fontSize: 13, color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>{d.name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{d.version}</span>
                {d.ok ? <span style={{ fontSize: 12, color: 'var(--green-t)', fontWeight: 500 }}>✓ up to date</span> : <span style={{ fontSize: 12, color: 'var(--amber-t)', fontWeight: 500 }}>↑ update available</span>}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <SectionLabel>Changelog</SectionLabel>
      <Card>
        <div style={{ padding: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 16, color: 'var(--text)' }}>v1.0.0</span>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>8 April 2026</span>
            <Badge label="initial release" color="green" />
          </div>
          <div style={{ paddingLeft: 4 }}>
            {[
              'Claude chat with streaming responses and tool use',
              'Web search via Tavily API',
              'Database connections — query PostgreSQL, MySQL, SQL Server from chat',
              'API service workspaces — call HubSpot, Stripe, Salesforce and any REST API',
              'User management with admin/user roles',
              'Usage analytics with per-user cost tracking',
              'Service monitoring with live health checks',
              'Light and dark mode with system preference detection',
            ].map((item, i) => (
              <div key={i} style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.9, display: 'flex', gap: 8 }}>
                <span style={{ color: 'var(--text4)' }}>·</span>{item}
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div style={{ fontSize: 12, color: 'var(--text4)', textAlign: 'center' as const, paddingTop: 8 }}>
        claude app v1.0.0 · build 20260408 · ugx.ai · powered by Anthropic Claude
      </div>
    </div>
  )
}

'use client'

// Illustrated explainer shown to Personal-edition users whose own (bring-your-own)
// Superset can't be embedded directly in Mosaic — typically because their local
// Superset is http and Mosaic is served over https, so the browser blocks the
// in-page embed. Rather than a technical mixed-content error, this frames it as an
// intentional edition behaviour: Mosaic connects to your Superset and opens
// dashboards in it; the seamless embedded view is the bundled (Enterprise) setup.
export function SupersetConnectDiagram({ supersetUrl, onOpen }: { supersetUrl?: string; onOpen?: () => void }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 32, textAlign: 'center' }}>
      <svg width="440" height="150" viewBox="0 0 440 150" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ maxWidth: '100%' }}>
        {/* Mosaic node */}
        <rect x="20" y="45" width="120" height="60" rx="12" fill="var(--surface)" stroke="var(--border2)" strokeWidth="1.5" />
        <text x="80" y="72" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--text)" fontFamily="Georgia, serif">Mosaic</text>
        <text x="80" y="90" textAnchor="middle" fontSize="10" fill="var(--text3)">your workspace</text>

        {/* Superset node */}
        <rect x="300" y="45" width="120" height="60" rx="12" fill="var(--surface)" stroke="var(--border2)" strokeWidth="1.5" />
        <text x="360" y="72" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--text)">Superset</text>
        <text x="360" y="90" textAnchor="middle" fontSize="10" fill="var(--text3)">running on your machine</text>

        {/* Connection: Mosaic -> Superset (reads) */}
        <line x1="140" y1="65" x2="300" y2="65" stroke="var(--text4)" strokeWidth="1.5" markerEnd="url(#arrow)" />
        <text x="220" y="58" textAnchor="middle" fontSize="9.5" fill="var(--text3)">reads dashboards</text>

        {/* Connection: Superset -> Mosaic (link back / open) */}
        <line x1="300" y1="88" x2="140" y2="88" stroke="var(--text4)" strokeWidth="1.5" strokeDasharray="4 3" markerEnd="url(#arrowOpen)" />
        <text x="220" y="102" textAnchor="middle" fontSize="9.5" fill="var(--text3)">opens dashboards in Superset</text>

        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="var(--text4)" />
          </marker>
          <marker id="arrowOpen" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="var(--text4)" />
          </marker>
        </defs>
      </svg>

      <div style={{ maxWidth: 460 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text2)', marginBottom: 6 }}>Your dashboards open in Superset</div>
        <div style={{ fontSize: 12.5, color: 'var(--text3)', lineHeight: 1.7 }}>
          Mosaic is connected to your own Superset and reads your dashboards. Because your
          Superset runs locally, dashboards open in Superset&rsquo;s own window rather than
          embedded here. Everything stays on your machine.
          {' '}Embedding dashboards directly inside Mosaic is available with the bundled
          Superset in the Enterprise edition.
        </div>
      </div>

      {supersetUrl && (
        <a
          href={supersetUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onOpen}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 999, border: '1px solid var(--border2)', background: 'var(--bg)', fontSize: 13, fontWeight: 500, color: 'var(--text)', textDecoration: 'none' }}
        >
          Open this dashboard in Superset
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6M10 14L21 3" /></svg>
        </a>
      )}
    </div>
  )
}

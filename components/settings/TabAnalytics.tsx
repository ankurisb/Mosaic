'use client'
import React, { useState, useEffect } from 'react'

const ITEMS_PER_PAGE = 12

const CATEGORY_COLORS: Record<string, string> = {
  spc:         '#2563eb',
  time_series: '#7c3aed',
  reliability: '#dc2626',
  quality:     '#d97706',
  correlation: '#059669',
  oee:         '#0891b2',
  energy:      '#65a30d',
  hypothesis:  '#db2777',
}

const CATEGORY_LABELS: Record<string, string> = {
  spc:         'Statistical Process Control',
  time_series: 'Time Series',
  reliability: 'Reliability',
  quality:     'Quality',
  correlation: 'Correlation',
  oee:         'OEE',
  energy:      'Energy',
  hypothesis:  'Hypothesis Testing',
}

// SVG icons per analysis type
function AnalysisIcon({ name, color }: { name: string; color: string }) {
  const p = { width: 32, height: 32, viewBox: '0 0 32 32', fill: 'none', stroke: color, strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'control_chart':
      return <svg {...p}><path d="M4 16h24M4 8h24" strokeDasharray="2 2" opacity={0.3}/><path d="M4 12h24" strokeDasharray="3 2" opacity={0.5}/><polyline points="4,20 8,14 12,18 16,10 20,22 24,12 28,16" strokeWidth={2} stroke={color}/><circle cx="16" cy="10" r="2" fill={color} stroke="none"/><circle cx="20" cy="22" r="2" fill="#dc2626" stroke="none"/></svg>
    case 'process_capability':
      return <svg {...p}><path d="M4 24 Q16 4 28 24"/><line x1="10" y1="4" x2="10" y2="26" strokeDasharray="3 2"/><line x1="22" y1="4" x2="22" y2="26" strokeDasharray="3 2"/><line x1="16" y1="8" x2="16" y2="26"/><text x="9" y="29" fontSize="5" fill={color} stroke="none">LSL</text><text x="21" y="29" fontSize="5" fill={color} stroke="none">USL</text></svg>
    case 'trend':
      return <svg {...p}><polyline points="4,22 10,18 14,20 18,14 22,16 28,8"/><line x1="4" y1="24" x2="28" y2="10" strokeDasharray="3 2" opacity={0.5}/><circle cx="28" cy="8" r="2" fill={color} stroke="none"/></svg>
    case 'anomaly_detection':
      return <svg {...p}><polyline points="4,16 8,15 12,16 16,15 20,26 24,15 28,16"/><circle cx="20" cy="26" r="3" stroke="#dc2626" strokeWidth={2}/><line x1="20" y1="22" x2="20" y2="18" stroke="#dc2626"/></svg>
    case 'changepoint_detection':
      return <svg {...p}><polyline points="4,18 8,17 12,18 16,17"/><line x1="16" y1="6" x2="16" y2="26" strokeDasharray="3 2" stroke="#dc2626"/><polyline points="16,10 20,9 24,8 28,7"/></svg>
    case 'pareto':
      return <svg {...p}><rect x="4" y="8" width="4" height="16" fill={color} opacity={0.8} stroke="none"/><rect x="10" y="12" width="4" height="12" fill={color} opacity={0.6} stroke="none"/><rect x="16" y="16" width="4" height="8" fill={color} opacity={0.4} stroke="none"/><rect x="22" y="19" width="4" height="5" fill={color} opacity={0.3} stroke="none"/><path d="M4 8 Q10 8 14 12 Q18 16 28 19" strokeWidth={1.5} strokeDasharray="2 1"/></svg>
    case 'correlation':
      return <svg {...p}><circle cx="8" cy="22" r="1.5" fill={color} stroke="none"/><circle cx="11" cy="19" r="1.5" fill={color} stroke="none"/><circle cx="14" cy="16" r="1.5" fill={color} stroke="none"/><circle cx="17" cy="14" r="1.5" fill={color} stroke="none"/><circle cx="20" cy="11" r="1.5" fill={color} stroke="none"/><circle cx="23" cy="9" r="1.5" fill={color} stroke="none"/><line x1="6" y1="24" x2="26" y2="7" strokeDasharray="3 2" opacity={0.5}/></svg>
    case 'regression':
      return <svg {...p}><circle cx="7" cy="21" r="1.5" fill={color} stroke="none"/><circle cx="10" cy="18" r="1.5" fill={color} stroke="none"/><circle cx="13" cy="17" r="1.5" fill={color} stroke="none"/><circle cx="16" cy="13" r="1.5" fill={color} stroke="none"/><circle cx="19" cy="12" r="1.5" fill={color} stroke="none"/><circle cx="22" cy="9" r="1.5" fill={color} stroke="none"/><line x1="5" y1="23" x2="25" y2="8" strokeWidth={2}/></svg>
    case 'weibull':
      return <svg {...p}><path d="M4 24 L8 23 Q12 22 16 16 Q20 8 24 7 L28 8"/><line x1="4" y1="6" x2="4" y2="26"/><line x1="4" y1="26" x2="28" y2="26"/><text x="5" y="12" fontSize="4" fill={color} stroke="none">β=1.7</text></svg>
    case 'mtbf':
      return <svg {...p}><line x1="4" y1="20" x2="28" y2="20"/><line x1="8" y1="16" x2="8" y2="24"/><line x1="16" y1="16" x2="16" y2="24"/><line x1="24" y1="16" x2="24" y2="24"/><path d="M8 20 h8 M16 20 h8" strokeWidth={2.5} opacity={0.4}/><text x="9" y="15" fontSize="4" fill={color} stroke="none">MTBF</text><text x="17" y="15" fontSize="4" fill={color} stroke="none">MTTR</text></svg>
    case 'oee_decomposition':
      return <svg {...p}><rect x="4" y="6" width="6" height="20" fill={color} opacity={0.9} stroke="none" rx="1"/><rect x="12" y="11" width="6" height="15" fill={color} opacity={0.6} stroke="none" rx="1"/><rect x="20" y="15" width="6" height="11" fill={color} opacity={0.35} stroke="none" rx="1"/><text x="5" y="30" fontSize="4" fill={color} stroke="none">A</text><text x="13" y="30" fontSize="4" fill={color} stroke="none">P</text><text x="21" y="30" fontSize="4" fill={color} stroke="none">Q</text></svg>
    case 'hypothesis_test':
      return <svg {...p}><path d="M4 20 Q10 8 16 20 Q22 8 28 20"/><path d="M4 18 Q10 6 16 18" opacity={0.4}/><line x1="16" y1="6" x2="16" y2="26" strokeDasharray="3 2"/><text x="6" y="26" fontSize="4" fill={color} stroke="none">G1</text><text x="19" y="26" fontSize="4" fill={color} stroke="none">G2</text></svg>
    default:
      return <svg {...p}><circle cx="16" cy="16" r="10"/><path d="M16 12v4l3 3"/></svg>
  }
}

interface AnalysisDef {
  name: string
  category: string
  title: string
  description: string
  when_to_use: string
  example_question: string
  output_summary: string
}

// Embedded registry — mirrors lib/analytics/registry.ts
const REGISTRY: AnalysisDef[] = [
  { name: 'control_chart',       category: 'spc',         title: 'Control Chart (XmR)',         description: 'Calculates mean, UCL, LCL and identifies out-of-control points using Western Electric rules.',         when_to_use: 'Is this variation normal? Is the process in control? Should we act on this reading?',           example_question: 'Is the vibration on Compressor 4 showing a real upward trend or normal variation?', output_summary: 'mean, UCL, LCL, sigma, out-of-control points, trend detected, WE violations' },
  { name: 'process_capability',  category: 'spc',         title: 'Process Capability (Cpk)',     description: 'Calculates Cp, Cpk, Pp, Ppk capability indices given a dataset and specification limits.',             when_to_use: 'Are we capable of holding this tolerance? What is our Cpk? Can this process meet the spec?',   example_question: 'Are we capable of holding ±0.05mm on this dimension?',                                output_summary: 'Cp, Cpk, Pp, Ppk, sigma level, % out of spec, capability rating' },
  { name: 'trend',               category: 'time_series', title: 'Linear Trend Analysis',        description: 'Fits a linear regression to time-series data, tests significance and estimates time to threshold.',     when_to_use: 'Is there an upward/downward trend? How fast is this degrading? When will it hit the limit?', example_question: 'Is bearing temperature trending upward and when will it exceed the alarm threshold?',  output_summary: 'slope, R², p-value, significance, direction, days to threshold' },
  { name: 'anomaly_detection',   category: 'time_series', title: 'Anomaly Detection',            description: 'Identifies statistical outliers using Z-score and IQR methods.',                                        when_to_use: 'Are there any unusual readings? What are the outliers? Which data points are abnormal?',      example_question: 'Are there any unusual spikes in the pressure readings from last week?',               output_summary: 'anomalies list, z-scores, IQR bounds, anomaly rate' },
  { name: 'changepoint_detection', category: 'time_series', title: 'Changepoint Detection',     description: 'Detects when a process fundamentally shifted using CUSUM method.',                                       when_to_use: 'When did this change? Did something happen to the process? When did performance degrade?',   example_question: 'When did the OEE on Line B start declining?',                                         output_summary: 'changepoints with index, direction, magnitude, before/after means' },
  { name: 'pareto',              category: 'quality',     title: 'Pareto Analysis',              description: 'Ranks categories by frequency/impact, calculates cumulative percentages, identifies the vital few.',    when_to_use: 'What are the top causes? Which defect types account for 80% of failures?',                  example_question: 'Which fault codes account for 80% of our downtime on Line B?',                       output_summary: 'ranked items, %, cumulative %, vital few, trivial many' },
  { name: 'correlation',         category: 'correlation', title: 'Correlation Analysis',         description: 'Calculates Pearson and Spearman correlation between two variables, tests significance.',                when_to_use: 'Is there a relationship between X and Y? Does temperature affect defect rate?',             example_question: 'Is there a relationship between ambient temperature and defect rate on Line A?',      output_summary: 'Pearson r, Spearman r, p-values, significance, strength, direction' },
  { name: 'regression',          category: 'correlation', title: 'Multivariate Regression',      description: 'Fits linear regression model, returns coefficients, R², and p-values per predictor.',                   when_to_use: 'What factors predict X? What drives OEE? Which variables most influence failure rate?',     example_question: 'What machine parameters most predict bearing failure?',                               output_summary: 'coefficients, p-values, R², RMSE, significant predictors' },
  { name: 'weibull',             category: 'reliability', title: 'Weibull Failure Analysis',     description: 'Fits a Weibull distribution to time-to-failure data, calculates MTBF and failure probability.',        when_to_use: 'What is the MTBF? Probability of failure by time T? Infant mortality or wear-out?',         example_question: 'What is the expected MTBF on these motors given the failure history?',                output_summary: 'beta, eta, MTBF, B10/B50 life, failure mode, reliability curve' },
  { name: 'mtbf',                category: 'reliability', title: 'MTBF / MTTR / Availability',   description: 'Calculates mean time between failures, mean time to repair, and availability from event data.',         when_to_use: 'What is the MTBF? What is the availability? How long does repair typically take?',          example_question: 'What is the availability and MTBF for the hydraulic press this quarter?',            output_summary: 'MTBF, MTTR, availability %, failure rate, total downtime' },
  { name: 'oee_decomposition',   category: 'oee',         title: 'OEE Decomposition',            description: 'Decomposes OEE into Availability, Performance, Quality components with benchmarking.',                 when_to_use: 'What is driving our OEE loss? Is it availability, performance or quality?',                 example_question: 'What is driving the OEE loss on Line B — availability, speed or quality?',           output_summary: 'OEE, A, P, Q components, loss breakdown, biggest loss driver, vs benchmark' },
  { name: 'hypothesis_test',     category: 'hypothesis',  title: 'Hypothesis Test (t-test/ANOVA)', description: 'Tests whether two or more groups are statistically different using t-test or ANOVA.',               when_to_use: 'Is shift A actually worse than shift B? Are these machines performing differently?',         example_question: 'Is the defect rate on the night shift statistically higher than the day shift?',     output_summary: 'test used, statistic, p-value, significance, group stats, conclusion' },
]

export default function TabAnalytics() {
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<string>('all')
  const [sidecarOk, setSidecarOk] = useState<boolean | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const totalPages = Math.ceil(
    (filter === 'all' ? REGISTRY : REGISTRY.filter(a => a.category === filter)).length / ITEMS_PER_PAGE
  )
  const filtered = filter === 'all' ? REGISTRY : REGISTRY.filter(a => a.category === filter)
  const paged = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)
  const categories = Array.from(new Set(REGISTRY.map(a => a.category)))

  useEffect(() => {
    fetch('/api/stats/health')
      .then(r => r.json())
      .then(d => setSidecarOk(d.ok))
      .catch(() => setSidecarOk(false))
  }, [])

  return (
    <div style={{ padding: '0 0 40px' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Analysis Capabilities</h2>
            <p style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4, marginBottom: 0 }}>
              Statistical analyses available to Mosaic. Claude automatically selects the right analysis based on your question.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border)', fontSize: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: sidecarOk === null ? 'var(--text4)' : sidecarOk ? '#16a34a' : '#dc2626' }} />
            <span style={{ color: 'var(--text2)', fontWeight: 500 }}>
              {sidecarOk === null ? 'Checking…' : sidecarOk ? 'Stats engine online' : 'Stats engine offline'}
            </span>
          </div>
        </div>

        {sidecarOk === false && (
          <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12, color: '#dc2626', marginTop: 12 }}>
            The statistical analysis engine is not running. Start it with <code style={{ background: 'rgba(220,38,38,.1)', padding: '1px 5px', borderRadius: 4 }}>cd services/stats-sidecar && python3 main.py</code> or via Docker Compose.
          </div>
        )}
      </div>

      {/* Category filter */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        <button onClick={() => { setFilter('all'); setPage(1) }}
          style={{ padding: '4px 12px', borderRadius: 999, border: `1.5px solid ${filter === 'all' ? 'var(--blue)' : 'var(--border2)'}`, background: filter === 'all' ? 'var(--blue-bg)' : 'var(--bg)', color: filter === 'all' ? 'var(--blue-t)' : 'var(--text3)', fontSize: 12, fontWeight: filter === 'all' ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
          All ({REGISTRY.length})
        </button>
        {categories.map(cat => {
          const count = REGISTRY.filter(a => a.category === cat).length
          const active = filter === cat
          return (
            <button key={cat} onClick={() => { setFilter(cat); setPage(1) }}
              style={{ padding: '4px 12px', borderRadius: 999, border: `1.5px solid ${active ? CATEGORY_COLORS[cat] : 'var(--border2)'}`, background: active ? CATEGORY_COLORS[cat] + '18' : 'var(--bg)', color: active ? CATEGORY_COLORS[cat] : 'var(--text3)', fontSize: 12, fontWeight: active ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
              {CATEGORY_LABELS[cat] || cat} ({count})
            </button>
          )
        })}
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
        {paged.map(a => {
          const color = CATEGORY_COLORS[a.category] || '#6366f1'
          const isExpanded = expanded === a.name
          return (
            <div key={a.name}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--shadow)', transition: 'box-shadow .15s' }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,.1)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = 'var(--shadow)')}>

              {/* Card header */}
              <div style={{ padding: '16px 16px 12px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ width: 52, height: 52, borderRadius: 10, background: color + '12', border: `1px solid ${color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <AnalysisIcon name={a.name} color={color} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{a.title}</span>
                  </div>
                  <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 999, background: color + '18', color: color, fontWeight: 600, border: `1px solid ${color}30` }}>
                    {CATEGORY_LABELS[a.category] || a.category}
                  </span>
                </div>
              </div>

              {/* Description */}
              <div style={{ padding: '0 16px 12px' }}>
                <p style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5, margin: 0 }}>{a.description}</p>
              </div>

              {/* When to use */}
              <div style={{ padding: '10px 16px', background: 'var(--bg3)', borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text4)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>When to use</div>
                <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0, lineHeight: 1.4, fontStyle: 'italic' }}>"{a.when_to_use}"</p>
              </div>

              {/* Expandable details */}
              <div style={{ borderTop: '1px solid var(--border)' }}>
                <button onClick={() => setExpanded(isExpanded ? null : a.name)}
                  style={{ width: '100%', padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--text3)', fontFamily: 'inherit' }}>
                  <span>Example &amp; output</span>
                  <span>{isExpanded ? '▾' : '▸'}</span>
                </button>
                {isExpanded && (
                  <div style={{ padding: '0 16px 14px' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text4)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Example question</div>
                    <p style={{ fontSize: 12, color: 'var(--text2)', margin: '0 0 10px', lineHeight: 1.4 }}>"{a.example_question}"</p>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text4)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Output includes</div>
                    <p style={{ fontSize: 11, color: 'var(--text3)', margin: 0, fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>{a.output_summary}</p>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 24 }}>
          <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
            style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: page === 1 ? 'not-allowed' : 'pointer', color: 'var(--text3)', fontSize: 13, opacity: page === 1 ? 0.5 : 1 }}>←</button>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages}
            style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: page === totalPages ? 'not-allowed' : 'pointer', color: 'var(--text3)', fontSize: 13, opacity: page === totalPages ? 0.5 : 1 }}>→</button>
        </div>
      )}

      {/* Count */}
      <div style={{ textAlign: 'center', marginTop: 12, fontSize: 12, color: 'var(--text4)' }}>
        {filtered.length} analys{filtered.length === 1 ? 'is' : 'es'} {filter !== 'all' ? `in ${CATEGORY_LABELS[filter]}` : 'available'}
      </div>
    </div>
  )
}

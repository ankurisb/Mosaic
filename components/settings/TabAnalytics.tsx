'use client'
import React, { useState, useEffect, useCallback } from 'react'

// ── Constants ──────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 12

const CATEGORY_COLORS: Record<string, string> = {
  spc:         '#2563eb',
  time_series: '#7c3aed',
  reliability: '#dc2626',
  quality:     '#d97706',
  correlation: '#059669',
  oee:         '#0891b2',
  hypothesis:  '#db2777',
}

const CATEGORY_LABELS: Record<string, string> = {
  spc:         'Statistical Process Control',
  time_series: 'Time Series',
  reliability: 'Reliability',
  quality:     'Quality',
  correlation: 'Correlation',
  oee:         'OEE',
  hypothesis:  'Hypothesis Testing',
}

// ── Demo sample data per analysis type ────────────────────────────────────────
// Realistic industrial data — used for the live demo modal

const DEMO_PAYLOADS: Record<string, { analysis_type: string; data: unknown; params?: unknown }> = {
  control_chart: {
    analysis_type: 'control_chart',
    data: [142.1,143.8,141.5,144.2,143.1,145.8,142.9,143.5,144.1,142.8,149.2,143.7,144.0,142.5,143.9,144.8,142.2,143.6,151.3,143.4],
    params: { labels: ['08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30'] }
  },
  process_capability: {
    analysis_type: 'process_capability',
    data: [10.01,9.98,10.03,10.00,9.97,10.02,9.99,10.04,10.01,9.96,10.03,10.00,9.98,10.02,10.01,9.99,10.03,10.00,9.97,10.02,10.01,9.98,10.04,10.00,9.99],
    params: { lsl: 9.90, usl: 10.10, target: 10.00 }
  },
  trend: {
    analysis_type: 'trend',
    data: [62.1,63.4,63.8,64.5,65.2,65.8,66.4,67.1,67.8,68.3,69.1,69.8,70.2,70.9,71.5,72.2,72.8,73.5,74.1,74.9],
    params: { threshold: 80 }
  },
  anomaly_detection: {
    analysis_type: 'anomaly_detection',
    data: [4.1,4.3,4.0,4.2,4.1,4.4,4.2,4.3,9.8,4.1,4.2,4.0,4.3,4.2,4.1,4.3,4.4,4.2,0.3,4.1],
    params: { labels: Array.from({length:20},(_,i)=>`T${i+1}`) }
  },
  changepoint_detection: {
    analysis_type: 'changepoint_detection',
    data: [84.2,83.8,85.1,84.5,83.9,84.8,85.0,84.3,78.1,77.5,78.3,77.8,78.5,77.2,78.0,77.9,78.4,77.6,78.1,77.8],
    params: { labels: ['W1','W2','W3','W4','W5','W6','W7','W8','W9','W10','W11','W12','W13','W14','W15','W16','W17','W18','W19','W20'] }
  },
  pareto: {
    analysis_type: 'pareto',
    data: [
      { category: 'Seal failure', value: 38 },
      { category: 'PLC fault', value: 22 },
      { category: 'Overheating', value: 15 },
      { category: 'Sensor error', value: 10 },
      { category: 'Power surge', value: 8 },
      { category: 'Belt wear', value: 4 },
      { category: 'Other', value: 3 },
    ],
    params: { threshold_pct: 80 }
  },
  correlation: {
    analysis_type: 'correlation',
    data: [
      {temperature:21.2,defect_rate:1.8},{temperature:22.1,defect_rate:2.1},{temperature:23.5,defect_rate:2.9},
      {temperature:24.8,defect_rate:3.4},{temperature:22.8,defect_rate:2.6},{temperature:26.1,defect_rate:4.1},
      {temperature:21.5,defect_rate:1.9},{temperature:25.3,defect_rate:3.8},{temperature:23.1,defect_rate:2.7},
      {temperature:27.4,defect_rate:4.8},{temperature:22.4,defect_rate:2.2},{temperature:24.2,defect_rate:3.2},
    ],
    params: { x_label: 'Ambient Temp (°C)', y_label: 'Defect Rate (%)' }
  },
  regression: {
    analysis_type: 'regression',
    data: [
      {vibration_mm:0.8,temp_rise_c:12,load_pct:72,days_to_failure:148},
      {vibration_mm:1.2,temp_rise_c:18,load_pct:85,days_to_failure:92},
      {vibration_mm:0.6,temp_rise_c:9,load_pct:65,days_to_failure:201},
      {vibration_mm:1.8,temp_rise_c:24,load_pct:91,days_to_failure:45},
      {vibration_mm:1.0,temp_rise_c:15,load_pct:78,days_to_failure:118},
      {vibration_mm:2.1,temp_rise_c:28,load_pct:94,days_to_failure:31},
      {vibration_mm:0.9,temp_rise_c:11,load_pct:70,days_to_failure:165},
      {vibration_mm:1.5,temp_rise_c:21,load_pct:88,days_to_failure:67},
    ],
    params: { y_key: 'days_to_failure', feature_names: ['vibration_mm','temp_rise_c','load_pct'] }
  },
  weibull: {
    analysis_type: 'weibull',
    data: [820,1240,680,1580,920,1100,750,1380,860,1020,1450,790,1180,940,1320],
  },
  mtbf: {
    analysis_type: 'mtbf',
    data: [
      {failure_timestamp:0,repair_duration:4.5},
      {failure_timestamp:312,repair_duration:6.2},
      {failure_timestamp:658,repair_duration:3.8},
      {failure_timestamp:1021,repair_duration:5.1},
      {failure_timestamp:1398,repair_duration:4.9},
      {failure_timestamp:1745,repair_duration:7.3},
    ],
    params: { observation_period: 2160 }
  },
  oee_decomposition: {
    analysis_type: 'oee_decomposition',
    data: [{ planned_time: 480, run_time: 412, ideal_cycle_time: 0.45, total_count: 820, good_count: 791 }],
    params: { benchmark_oee: 0.85 }
  },
  hypothesis_test: {
    analysis_type: 'hypothesis_test',
    data: [[2.1,1.8,2.3,1.9,2.0,2.2,1.7,2.4,1.8,2.1],[3.2,2.9,3.4,3.1,2.8,3.3,3.0,3.5,2.9,3.2]],
    params: { group_labels: ['Day Shift','Night Shift'], alpha: 0.05 }
  },
}

// ── Analysis type display labels ───────────────────────────────────────────────
const DEMO_CONTEXT: Record<string, { scenario: string; source: string }> = {
  control_chart:        { scenario: 'Hydraulic pressure readings (bar) — PRESS-01, last 10 hours', source: 'Sensor Telemetry · InfluxDB' },
  process_capability:   { scenario: 'Shaft diameter measurements (mm) — CNC-01, last 200 parts', source: 'Quality Checks · Plant Operations' },
  trend:                { scenario: 'Bearing temperature (°C) — MILL-02, last 20 shifts', source: 'Sensor Telemetry · InfluxDB' },
  anomaly_detection:    { scenario: 'Vibration amplitude (mm/s) — Compressor 4, last 20 readings', source: 'Sensor Telemetry · InfluxDB' },
  changepoint_detection:{ scenario: 'OEE % — Line B, last 20 weeks', source: 'Production Logs · Plant Operations' },
  pareto:               { scenario: 'Downtime causes — all machines, last 90 days', source: 'Downtime Events · Maintenance CMMS' },
  correlation:          { scenario: 'Ambient temperature vs defect rate — Line A, last 12 months', source: 'Quality Checks + Sensor Telemetry' },
  regression:           { scenario: 'Bearing failure predictors — motor fleet, historical failures', source: 'Maintenance Logs · Elasticsearch' },
  weibull:              { scenario: 'Motor bearing failure times (hours) — fleet of 15 units', source: 'Maintenance Logs · Elasticsearch' },
  mtbf:                 { scenario: 'PRESS-01 failure and repair events — last 2,160 hours (90 days)', source: 'Maintenance CMMS · MSSQL' },
  oee_decomposition:    { scenario: 'CNC-01 single shift — 480 min planned, 820 parts produced', source: 'Production Logs · Plant Operations' },
  hypothesis_test:      { scenario: 'Defect rates — Day shift vs Night shift, last 10 readings each', source: 'Quality Checks · Plant Operations' },
}

// ── SVG mini-charts for demo results ──────────────────────────────────────────

function SparkLine({ values, color, width=200, height=50, ucl, lcl, mean: meanLine }: {
  values: number[]; color: string; width?: number; height?: number
  ucl?: number; lcl?: number; mean?: number
}) {
  if (!values.length) return null
  const min = Math.min(...values, lcl ?? Infinity) * 0.98
  const max = Math.max(...values, ucl ?? -Infinity) * 1.02
  const scale = (v: number) => height - ((v - min) / (max - min)) * height
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${scale(v)}`).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      {ucl !== undefined && <line x1={0} y1={scale(ucl)} x2={width} y2={scale(ucl)} stroke="#dc2626" strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />}
      {lcl !== undefined && <line x1={0} y1={scale(lcl)} x2={width} y2={scale(lcl)} stroke="#dc2626" strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />}
      {meanLine !== undefined && <line x1={0} y1={scale(meanLine)} x2={width} y2={scale(meanLine)} stroke={color} strokeWidth={1} strokeDasharray="3 2" opacity={0.5} />}
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {values.map((v, i) => {
        const isOut = (ucl !== undefined && v > ucl) || (lcl !== undefined && v < lcl)
        return isOut ? <circle key={i} cx={(i/(values.length-1))*width} cy={scale(v)} r={3.5} fill="#dc2626" /> : null
      })}
    </svg>
  )
}

function BarChart({ items, color, width=200, height=50 }: {
  items: {label:string; value:number}[]; color: string; width?: number; height?: number
}) {
  if (!items.length) return null
  const max = Math.max(...items.map(i => i.value))
  const barW = (width - (items.length - 1) * 3) / items.length
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {items.map((item, i) => {
        const bh = (item.value / max) * (height - 4)
        const opacity = 0.9 - (i / items.length) * 0.5
        return <rect key={i} x={i * (barW + 3)} y={height - bh - 4} width={barW} height={bh} fill={color} opacity={opacity} rx={2} />
      })}
    </svg>
  )
}

// ── Result renderer — turns sidecar JSON into readable output ─────────────────

function DemoResult({ name, result, color }: { name: string; result: Record<string,unknown>; color: string }) {
  const r = result

  if (name === 'control_chart') {
    const vals = (DEMO_PAYLOADS.control_chart.data as number[])
    const ooc = r.out_of_control_points as Array<{index:number;value:number;violations:string[]}> || []
    return (
      <div>
        <SparkLine values={vals} color={color} ucl={r.ucl as number} lcl={r.lcl as number} mean={r.mean as number} width={320} height={70} />
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
          {[['Mean', (r.mean as number)?.toFixed(1)+' bar'],['UCL',(r.ucl as number)?.toFixed(1)+' bar'],['LCL',(r.lcl as number)?.toFixed(1)+' bar'],['σ',(r.sigma as number)?.toFixed(2)]].map(([k,v])=>(
            <div key={k} style={{ background: 'var(--bg3)', borderRadius: 6, padding: '8px 10px' }}>
              <div style={{ fontSize: 10, color: 'var(--text4)', marginBottom: 2 }}>{k}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{v}</div>
            </div>
          ))}
        </div>
        {ooc.length > 0 && (
          <div style={{ marginTop: 10, padding: '8px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#dc2626' }}>
            {ooc.length} out-of-control point{ooc.length>1?'s':''} detected — {ooc[0].violations[0]}
          </div>
        )}
        {ooc.length === 0 && (
          <div style={{ marginTop: 10, padding: '8px 10px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, fontSize: 12, color: '#15803d' }}>
            Process in statistical control — no violations detected
          </div>
        )}
      </div>
    )
  }

  if (name === 'process_capability') {
    const cpk = r.cpk as number
    const rating = r.capability_rating as string
    const color2 = cpk >= 1.33 ? '#16a34a' : cpk >= 1.0 ? '#d97706' : '#dc2626'
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 12 }}>
          {[['Cp',(r.cp as number)?.toFixed(3)],['Cpk',(r.cpk as number)?.toFixed(3)],['Pp',(r.pp as number)?.toFixed(3)],['Ppk',(r.ppk as number)?.toFixed(3)]].map(([k,v])=>(
            <div key={k} style={{ background: 'var(--bg3)', borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text4)', marginBottom: 2 }}>{k}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: k==='Cpk'?color2:'var(--text)' }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: '8px 12px', background: color2+'15', border: `1px solid ${color2}40`, borderRadius: 6, fontSize: 12, fontWeight: 500, color: color2 }}>
          {rating} · σ level: {(r.sigma_level as number)?.toFixed(2)} · {r.percent_out_of_spec as number}% out of spec
        </div>
      </div>
    )
  }

  if (name === 'trend') {
    const vals = DEMO_PAYLOADS.trend.data as number[]
    const dir = r.trend_direction as string
    const sig = r.slope_significant as boolean
    return (
      <div>
        <SparkLine values={vals} color={color} width={320} height={70} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 12 }}>
          {[['Slope',`+${(r.slope as number)?.toFixed(3)}°C/shift`],['R²',(r.r_squared as number)?.toFixed(3)],['p-value',(r.p_value as number)?.toFixed(4)]].map(([k,v])=>(
            <div key={k} style={{ background: 'var(--bg3)', borderRadius: 6, padding: '8px 10px' }}>
              <div style={{ fontSize: 10, color: 'var(--text4)', marginBottom: 2 }}>{k}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10, padding: '8px 10px', background: sig ? '#fff7ed' : '#f0fdf4', border: `1px solid ${sig ? '#fed7aa':'#bbf7d0'}`, borderRadius: 6, fontSize: 12, color: sig ? '#c2410c' : '#15803d' }}>
          {sig ? `Significant ${dir} trend detected (p<0.05)` : 'No statistically significant trend'}
          {r.days_to_threshold ? ` — reaches threshold in ~${r.days_to_threshold} shifts` : ''}
        </div>
      </div>
    )
  }

  if (name === 'anomaly_detection') {
    const vals = DEMO_PAYLOADS.anomaly_detection.data as number[]
    const anomalies = r.anomalies as Array<{index:number;value:number;z_score:number}> || []
    return (
      <div>
        <SparkLine values={vals} color={color} mean={r.mean as number} width={320} height={70} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 12 }}>
          {[['Anomalies',String(r.anomaly_count)],['Rate',`${r.anomaly_rate}%`],['Mean',`${(r.mean as number)?.toFixed(2)} mm/s`]].map(([k,v])=>(
            <div key={k} style={{ background: 'var(--bg3)', borderRadius: 6, padding: '8px 10px' }}>
              <div style={{ fontSize: 10, color: 'var(--text4)', marginBottom: 2 }}>{k}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: k==='Anomalies' && (r.anomaly_count as number)>0 ? '#dc2626':'var(--text)' }}>{v}</div>
            </div>
          ))}
        </div>
        {anomalies.map((a,i) => (
          <div key={i} style={{ marginTop: 6, padding: '6px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 11, color: '#dc2626' }}>
            Point {a.index+1}: {a.value} mm/s · z-score {a.z_score.toFixed(1)}σ
          </div>
        ))}
      </div>
    )
  }

  if (name === 'changepoint_detection') {
    const vals = DEMO_PAYLOADS.changepoint_detection.data as number[]
    const cps = r.changepoints as Array<{index:number;label:string;direction:string;before_mean:number;after_mean:number;magnitude:number}> || []
    return (
      <div>
        <SparkLine values={vals} color={color} mean={r.overall_mean as number} width={320} height={70} />
        {cps.length > 0 ? cps.map((cp,i) => (
          <div key={i} style={{ marginTop: 10, padding: '8px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#dc2626' }}>
            Shift detected at {cp.label} — {cp.before_mean.toFixed(1)}% → {cp.after_mean.toFixed(1)}% ({cp.direction}, Δ{cp.magnitude.toFixed(1)}pp)
          </div>
        )) : (
          <div style={{ marginTop: 10, padding: '8px 10px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, fontSize: 12, color: '#15803d' }}>No changepoints detected — process is stable</div>
        )}
      </div>
    )
  }

  if (name === 'pareto') {
    const items = (r.items as Array<{category:string;value:number;percentage:number;cumulative_percentage:number}> || []).slice(0,7)
    const vitalFew = r.vital_few as string[] || []
    return (
      <div>
        <BarChart items={items.map(i=>({label:i.category,value:i.value}))} color={color} width={320} height={70} />
        <div style={{ marginTop: 10 }}>
          {items.map((item,i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
              <span style={{ color: vitalFew.includes(item.category) ? 'var(--text)' : 'var(--text3)', fontWeight: vitalFew.includes(item.category) ? 500 : 400 }}>{item.category}</span>
              <span style={{ color: 'var(--text3)' }}>{item.percentage}% · {item.cumulative_percentage}% cum.</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8, padding: '6px 10px', background: color+'10', border: `1px solid ${color}30`, borderRadius: 6, fontSize: 11, color }}>
          Vital few: {vitalFew.join(', ')} account for {r.threshold_pct as number}% of downtime
        </div>
      </div>
    )
  }

  if (name === 'correlation') {
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
          {[['Pearson r',(r.pearson_r as number)?.toFixed(4)],['p-value',(r.pearson_p as number)?.toFixed(4)],['R²',(r.r_squared as number)?.toFixed(4)]].map(([k,v])=>(
            <div key={k} style={{ background: 'var(--bg3)', borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text4)', marginBottom: 2 }}>{k}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: '8px 12px', background: color+'10', border: `1px solid ${color}30`, borderRadius: 6, fontSize: 12, color }}>
          {r.relationship_strength as string} {r.relationship_direction as string} correlation{r.significant ? ' — statistically significant (p<0.05)' : ''}
        </div>
      </div>
    )
  }

  if (name === 'regression') {
    const coefs = r.coefficients as Array<{name:string;value:number;p_value:number;significant:boolean}> || []
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 12 }}>
          {[['R²',(r.r_squared as number)?.toFixed(4)],['RMSE',(r.rmse as number)?.toFixed(2)+' days']].map(([k,v])=>(
            <div key={k} style={{ background: 'var(--bg3)', borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text4)', marginBottom: 2 }}>{k}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{v}</div>
            </div>
          ))}
        </div>
        {coefs.filter(c=>c.name!=='intercept').map((c,i)=>(
          <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid var(--border)', fontSize:12 }}>
            <span style={{ color: c.significant ? 'var(--text)' : 'var(--text4)', fontWeight: c.significant ? 500 : 400 }}>{c.name}</span>
            <span style={{ color: c.significant ? color : 'var(--text4)' }}>{c.value>0?'+':''}{c.value.toFixed(2)} · p={c.p_value.toFixed(3)}{c.significant?' ✓':''}</span>
          </div>
        ))}
      </div>
    )
  }

  if (name === 'weibull') {
    const fc = r.failure_mode as string
    const beta = r.beta as number
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 12 }}>
          {[['β (shape)',(beta)?.toFixed(3)],['η (life)',(r.eta as number)?.toFixed(0)+' hr'],['MTBF',(r.mtbf as number)?.toFixed(0)+' hr'],['B10 life',(r.b10_life as number)?.toFixed(0)+' hr']].map(([k,v])=>(
            <div key={k} style={{ background: 'var(--bg3)', borderRadius: 6, padding: '8px 10px', textAlign:'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text4)', marginBottom: 2 }}>{k}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: '8px 12px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, fontSize: 12, color: '#c2410c' }}>
          β={beta?.toFixed(2)} → {fc}
        </div>
      </div>
    )
  }

  if (name === 'mtbf') {
    const avail = r.availability_pct as number
    const color2 = avail >= 95 ? '#16a34a' : avail >= 90 ? '#d97706' : '#dc2626'
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
          {[['MTBF',`${(r.mtbf as number)?.toFixed(0)} hr`],['MTTR',`${(r.mttr as number)?.toFixed(1)} hr`],['Availability',`${avail?.toFixed(1)}%`]].map(([k,v])=>(
            <div key={k} style={{ background: 'var(--bg3)', borderRadius: 6, padding: '10px 10px', textAlign:'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text4)', marginBottom: 2 }}>{k}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: k==='Availability'?color2:'var(--text)' }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text3)' }}>
          {r.total_failures as number} failures over {r.observation_period as number} hr observation period
        </div>
      </div>
    )
  }

  if (name === 'oee_decomposition') {
    const oee = r.oee as number
    const oeeColor = oee >= 85 ? '#16a34a' : oee >= 70 ? '#d97706' : '#dc2626'
    const losses = r.losses as {availability_loss:number;performance_loss:number;quality_loss:number} || {}
    return (
      <div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'flex-end' }}>
          <div style={{ textAlign: 'center', padding: '14px 18px', background: oeeColor+'12', border: `1px solid ${oeeColor}30`, borderRadius: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--text4)', marginBottom: 4 }}>OEE</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: oeeColor, lineHeight: 1 }}>{oee}%</div>
            <div style={{ fontSize: 10, color: oeeColor, marginTop: 4 }}>{oee>=85?'World class':'Improvement needed'}</div>
          </div>
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
            {[['Availability',(r.availability as number)+'%'],['Performance',(r.performance as number)+'%'],['Quality',(r.quality as number)+'%']].map(([k,v])=>(
              <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'5px 8px', background:'var(--bg3)', borderRadius:4, fontSize:12 }}>
                <span style={{color:'var(--text2)'}}>{k}</span>
                <span style={{fontWeight:600,color:'var(--text)'}}>{v}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ padding:'8px 12px', background: '#fff7ed', border:'1px solid #fed7aa', borderRadius:6, fontSize:12, color:'#c2410c' }}>
          Biggest loss driver: {(r.biggest_loss_driver as string)?.replace('_loss','').replace('_',' ')} ({(Object.values(losses)[Object.keys(losses).indexOf(r.biggest_loss_driver as string)] as number)?.toFixed(1)}% loss)
        </div>
      </div>
    )
  }

  if (name === 'hypothesis_test') {
    const gs = r.group_stats as Array<{label:string;mean:number;std:number;n:number}> || []
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          {gs.map(g => (
            <div key={g.label} style={{ background:'var(--bg3)', borderRadius:6, padding:'8px 10px', textAlign:'center' }}>
              <div style={{ fontSize:10, color:'var(--text4)', marginBottom:2 }}>{g.label}</div>
              <div style={{ fontSize:16, fontWeight:700, color:'var(--text)' }}>{g.mean.toFixed(3)}%</div>
              <div style={{ fontSize:10, color:'var(--text3)' }}>σ={g.std.toFixed(3)}, n={g.n}</div>
            </div>
          ))}
        </div>
        <div style={{ padding:'8px 12px', background: (r.significant as boolean) ? '#fef2f2':'#f0fdf4', border:`1px solid ${(r.significant as boolean)?'#fecaca':'#bbf7d0'}`, borderRadius:6, fontSize:12, color:(r.significant as boolean)?'#dc2626':'#15803d' }}>
          {r.conclusion as string}
        </div>
        <div style={{ marginTop:6, fontSize:11, color:'var(--text3)' }}>
          {r.test_used as string} · t={( r.statistic as number)?.toFixed(3)} · p={( r.p_value as number)?.toFixed(4)}
        </div>
      </div>
    )
  }

  // Fallback — show key values as grid
  const keys = Object.keys(r).filter(k => typeof r[k] !== 'object' && k !== 'analysis_type' && k !== 'ok').slice(0,8)
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8 }}>
      {keys.map(k => (
        <div key={k} style={{ background:'var(--bg3)', borderRadius:6, padding:'8px 10px' }}>
          <div style={{ fontSize:10, color:'var(--text4)', marginBottom:2 }}>{k.replace(/_/g,' ')}</div>
          <div style={{ fontSize:13, fontWeight:600, color:'var(--text)' }}>{String(r[k]).slice(0,20)}</div>
        </div>
      ))}
    </div>
  )
}

// ── Demo Modal ─────────────────────────────────────────────────────────────────

function DemoModal({ item, color, onClose }: { item: AnalysisDef; color: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<Record<string,unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    setLoading(true); setError(null); setResult(null)
    try {
      const payload = DEMO_PAYLOADS[item.name]
      if (!payload) throw new Error('No demo data configured for this analysis')
      const res = await fetch('/api/stats/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Analysis failed')
      setResult(data.result)
    } catch (e) {
      setError((e as Error).message)
    } finally { setLoading(false) }
  }, [item.name])

  useEffect(() => { run() }, [run])

  const ctx = DEMO_CONTEXT[item.name] || { scenario: '', source: '' }

  return (
    <div style={{ position:'fixed', inset:0, zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center' }}>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.5)', backdropFilter:'blur(2px)' }} />
      {/* Modal */}
      <div style={{
        position:'relative', zIndex:1, background:'var(--surface)', border:'1px solid var(--border)',
        borderRadius:12, boxShadow:'0 20px 60px rgba(0,0,0,.2)', width:420, maxWidth:'92vw',
        maxHeight:'88vh', overflow:'hidden', display:'flex', flexDirection:'column'
      }}>
        {/* Header */}
        <div style={{ padding:'18px 20px 14px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'flex-start', gap:12 }}>
          <div style={{ width:40, height:40, borderRadius:8, background:color+'15', border:`1px solid ${color}30`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <AnalysisIcon name={item.name} color={color} />
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:15, fontWeight:700, color:'var(--text)', marginBottom:2 }}>{item.title}</div>
            <div style={{ fontSize:11, padding:'1px 7px', borderRadius:999, background:color+'15', color:color, fontWeight:600, border:`1px solid ${color}30`, display:'inline-block' }}>
              {CATEGORY_LABELS[item.category] || item.category}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text3)', fontSize:18, lineHeight:1, padding:'2px 4px', flexShrink:0 }}>×</button>
        </div>

        {/* Scenario context */}
        <div style={{ padding:'10px 20px', borderBottom:'1px solid var(--border)', background:'var(--bg3)' }}>
          <div style={{ fontSize:11, fontWeight:600, color:'var(--text4)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:3 }}>Demo scenario</div>
          <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.4 }}>{ctx.scenario}</div>
          <div style={{ fontSize:11, color:'var(--text4)', marginTop:3 }}>Source: {ctx.source}</div>
        </div>

        {/* Result area */}
        <div style={{ padding:'16px 20px', overflowY:'auto', flex:1 }}>
          {loading && (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'30px 0', gap:12 }}>
              <div style={{ width:28, height:28, border:`2px solid ${color}30`, borderTop:`2px solid ${color}`, borderRadius:'50%', animation:'spin .8s linear infinite' }} />
              <div style={{ fontSize:12, color:'var(--text3)' }}>Running analysis on sample data…</div>
            </div>
          )}
          {error && (
            <div style={{ padding:'12px 14px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, fontSize:12, color:'#dc2626' }}>
              <div style={{ fontWeight:600, marginBottom:4 }}>Analysis failed</div>
              <div>{error}</div>
              {error.includes('503') || error.includes('offline') || error.includes('fetch') ? (
                <div style={{ marginTop:8, padding:'6px 8px', background:'rgba(220,38,38,.08)', borderRadius:4, fontSize:11 }}>
                  The stats engine is not running. Start it with:<br/>
                  <code style={{ fontFamily:'monospace' }}>cd services/stats-sidecar && python3 main.py</code>
                </div>
              ) : null}
              <button onClick={run} style={{ marginTop:8, padding:'4px 10px', borderRadius:6, border:'1px solid #fecaca', background:'white', cursor:'pointer', fontSize:11, color:'#dc2626' }}>Retry</button>
            </div>
          )}
          {result && <DemoResult name={item.name} result={result} color={color} />}
        </div>

        {/* Footer */}
        <div style={{ padding:'12px 20px', borderTop:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ fontSize:11, color:'var(--text4)' }}>Live result from stats engine · sample data</div>
          <button onClick={run} style={{ fontSize:11, padding:'4px 12px', borderRadius:6, border:`1px solid ${color}40`, background:color+'10', color, cursor:'pointer', fontWeight:500 }}>
            Re-run
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// ── SVG icons (same as before) ────────────────────────────────────────────────

function AnalysisIcon({ name, color }: { name: string; color: string }) {
  const p = { width:32, height:32, viewBox:'0 0 32 32', fill:'none', stroke:color, strokeWidth:1.6, strokeLinecap:'round' as const, strokeLinejoin:'round' as const }
  switch (name) {
    case 'control_chart': return <svg {...p}><path d="M4 16h24M4 8h24" strokeDasharray="2 2" opacity={0.3}/><path d="M4 12h24" strokeDasharray="3 2" opacity={0.5}/><polyline points="4,20 8,14 12,18 16,10 20,22 24,12 28,16" strokeWidth={2} stroke={color}/><circle cx="16" cy="10" r="2" fill={color} stroke="none"/><circle cx="20" cy="22" r="2" fill="#dc2626" stroke="none"/></svg>
    case 'process_capability': return <svg {...p}><path d="M4 24 Q16 4 28 24"/><line x1="10" y1="4" x2="10" y2="26" strokeDasharray="3 2"/><line x1="22" y1="4" x2="22" y2="26" strokeDasharray="3 2"/><line x1="16" y1="8" x2="16" y2="26"/><text x="9" y="29" fontSize="5" fill={color} stroke="none">LSL</text><text x="21" y="29" fontSize="5" fill={color} stroke="none">USL</text></svg>
    case 'trend': return <svg {...p}><polyline points="4,22 10,18 14,20 18,14 22,16 28,8"/><line x1="4" y1="24" x2="28" y2="10" strokeDasharray="3 2" opacity={0.5}/><circle cx="28" cy="8" r="2" fill={color} stroke="none"/></svg>
    case 'anomaly_detection': return <svg {...p}><polyline points="4,16 8,15 12,16 16,15 20,26 24,15 28,16"/><circle cx="20" cy="26" r="3" stroke="#dc2626" strokeWidth={2}/><line x1="20" y1="22" x2="20" y2="18" stroke="#dc2626"/></svg>
    case 'changepoint_detection': return <svg {...p}><polyline points="4,18 8,17 12,18 16,17"/><line x1="16" y1="6" x2="16" y2="26" strokeDasharray="3 2" stroke="#dc2626"/><polyline points="16,10 20,9 24,8 28,7"/></svg>
    case 'pareto': return <svg {...p}><rect x="4" y="8" width="4" height="16" fill={color} opacity={0.8} stroke="none"/><rect x="10" y="12" width="4" height="12" fill={color} opacity={0.6} stroke="none"/><rect x="16" y="16" width="4" height="8" fill={color} opacity={0.4} stroke="none"/><rect x="22" y="19" width="4" height="5" fill={color} opacity={0.3} stroke="none"/><path d="M4 8 Q10 8 14 12 Q18 16 28 19" strokeWidth={1.5} strokeDasharray="2 1"/></svg>
    case 'correlation': return <svg {...p}><circle cx="8" cy="22" r="1.5" fill={color} stroke="none"/><circle cx="11" cy="19" r="1.5" fill={color} stroke="none"/><circle cx="14" cy="16" r="1.5" fill={color} stroke="none"/><circle cx="17" cy="14" r="1.5" fill={color} stroke="none"/><circle cx="20" cy="11" r="1.5" fill={color} stroke="none"/><circle cx="23" cy="9" r="1.5" fill={color} stroke="none"/><line x1="6" y1="24" x2="26" y2="7" strokeDasharray="3 2" opacity={0.5}/></svg>
    case 'regression': return <svg {...p}><circle cx="7" cy="21" r="1.5" fill={color} stroke="none"/><circle cx="10" cy="18" r="1.5" fill={color} stroke="none"/><circle cx="13" cy="17" r="1.5" fill={color} stroke="none"/><circle cx="16" cy="13" r="1.5" fill={color} stroke="none"/><circle cx="19" cy="12" r="1.5" fill={color} stroke="none"/><circle cx="22" cy="9" r="1.5" fill={color} stroke="none"/><line x1="5" y1="23" x2="25" y2="8" strokeWidth={2}/></svg>
    case 'weibull': return <svg {...p}><path d="M4 24 L8 23 Q12 22 16 16 Q20 8 24 7 L28 8"/><line x1="4" y1="6" x2="4" y2="26"/><line x1="4" y1="26" x2="28" y2="26"/></svg>
    case 'mtbf': return <svg {...p}><line x1="4" y1="20" x2="28" y2="20"/><line x1="8" y1="16" x2="8" y2="24"/><line x1="16" y1="16" x2="16" y2="24"/><line x1="24" y1="16" x2="24" y2="24"/><path d="M8 20 h8 M16 20 h8" strokeWidth={2.5} opacity={0.4}/></svg>
    case 'oee_decomposition': return <svg {...p}><rect x="4" y="6" width="6" height="20" fill={color} opacity={0.9} stroke="none" rx="1"/><rect x="12" y="11" width="6" height="15" fill={color} opacity={0.6} stroke="none" rx="1"/><rect x="20" y="15" width="6" height="11" fill={color} opacity={0.35} stroke="none" rx="1"/><text x="5" y="30" fontSize="4" fill={color} stroke="none">A</text><text x="13" y="30" fontSize="4" fill={color} stroke="none">P</text><text x="21" y="30" fontSize="4" fill={color} stroke="none">Q</text></svg>
    case 'hypothesis_test': return <svg {...p}><path d="M4 20 Q10 8 16 20 Q22 8 28 20"/><path d="M4 18 Q10 6 16 18" opacity={0.4}/><line x1="16" y1="6" x2="16" y2="26" strokeDasharray="3 2"/></svg>
    default: return <svg {...p}><circle cx="16" cy="16" r="10"/><path d="M16 12v4l3 3"/></svg>
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface AnalysisDef {
  name: string; category: string; title: string; description: string
  when_to_use: string; example_question: string; output_summary: string
}

// ── Registry (mirrors lib/analytics/registry.ts) ─────────────────────────────

const REGISTRY: AnalysisDef[] = [
  { name:'control_chart',         category:'spc',         title:'Control Chart (XmR)',           description:'Calculates mean, UCL, LCL and identifies out-of-control points using Western Electric rules.',         when_to_use:'Is this variation normal? Is the process in control? Should we act on this reading?',           example_question:'Is the vibration on Compressor 4 showing a real upward trend or normal variation?', output_summary:'mean, UCL, LCL, sigma, out-of-control points, trend detected, WE violations' },
  { name:'process_capability',    category:'spc',         title:'Process Capability (Cpk)',       description:'Calculates Cp, Cpk, Pp, Ppk capability indices given a dataset and specification limits.',             when_to_use:'Are we capable of holding this tolerance? What is our Cpk? Can this process meet the spec?',   example_question:'Are we capable of holding ±0.05mm on this dimension?',                                output_summary:'Cp, Cpk, Pp, Ppk, sigma level, % out of spec, capability rating' },
  { name:'trend',                 category:'time_series', title:'Linear Trend Analysis',          description:'Fits a linear regression to time-series data, tests significance and estimates time to threshold.',     when_to_use:'Is there an upward/downward trend? How fast is this degrading? When will it hit the limit?', example_question:'Is bearing temperature trending upward and when will it exceed the alarm threshold?',  output_summary:'slope, R², p-value, significance, direction, days to threshold' },
  { name:'anomaly_detection',     category:'time_series', title:'Anomaly Detection',              description:'Identifies statistical outliers using Z-score and IQR methods.',                                        when_to_use:'Are there any unusual readings? What are the outliers? Which data points are abnormal?',      example_question:'Are there any unusual spikes in the pressure readings from last week?',               output_summary:'anomalies list, z-scores, IQR bounds, anomaly rate' },
  { name:'changepoint_detection', category:'time_series', title:'Changepoint Detection',          description:'Detects when a process fundamentally shifted using CUSUM method.',                                       when_to_use:'When did this change? Did something happen to the process? When did performance degrade?',   example_question:'When did the OEE on Line B start declining?',                                         output_summary:'changepoints with index, direction, magnitude, before/after means' },
  { name:'pareto',                category:'quality',     title:'Pareto Analysis',                description:'Ranks categories by frequency/impact, calculates cumulative percentages, identifies the vital few.',    when_to_use:'What are the top causes? Which defect types account for 80% of failures?',                  example_question:'Which fault codes account for 80% of our downtime on Line B?',                       output_summary:'ranked items, %, cumulative %, vital few, trivial many' },
  { name:'correlation',           category:'correlation', title:'Correlation Analysis',           description:'Calculates Pearson and Spearman correlation between two variables, tests significance.',                when_to_use:'Is there a relationship between X and Y? Does temperature affect defect rate?',             example_question:'Is there a relationship between ambient temperature and defect rate on Line A?',      output_summary:'Pearson r, Spearman r, p-values, significance, strength, direction' },
  { name:'regression',            category:'correlation', title:'Multivariate Regression',        description:'Fits linear regression model, returns coefficients, R², and p-values per predictor.',                   when_to_use:'What factors predict X? What drives OEE? Which variables most influence failure rate?',     example_question:'What machine parameters most predict bearing failure?',                               output_summary:'coefficients, p-values, R², RMSE, significant predictors' },
  { name:'weibull',               category:'reliability', title:'Weibull Failure Analysis',       description:'Fits a Weibull distribution to time-to-failure data, calculates MTBF and failure probability.',        when_to_use:'What is the MTBF? Probability of failure by time T? Infant mortality or wear-out?',         example_question:'What is the expected MTBF on these motors given the failure history?',                output_summary:'beta, eta, MTBF, B10/B50 life, failure mode, reliability curve' },
  { name:'mtbf',                  category:'reliability', title:'MTBF / MTTR / Availability',     description:'Calculates mean time between failures, mean time to repair, and availability from event data.',         when_to_use:'What is the MTBF? What is the availability? How long does repair typically take?',          example_question:'What is the availability and MTBF for the hydraulic press this quarter?',            output_summary:'MTBF, MTTR, availability %, failure rate, total downtime' },
  { name:'oee_decomposition',     category:'oee',         title:'OEE Decomposition',              description:'Decomposes OEE into Availability, Performance, Quality components with benchmarking.',                 when_to_use:'What is driving our OEE loss? Is it availability, performance or quality?',                 example_question:'What is driving the OEE loss on Line B — availability, speed or quality?',           output_summary:'OEE, A, P, Q components, loss breakdown, biggest loss driver, vs benchmark' },
  { name:'hypothesis_test',       category:'hypothesis',  title:'Hypothesis Test (t-test/ANOVA)', description:'Tests whether two or more groups are statistically different using t-test or ANOVA.',               when_to_use:'Is shift A actually worse than shift B? Are these machines performing differently?',         example_question:'Is the defect rate on the night shift statistically higher than the day shift?',     output_summary:'test used, statistic, p-value, significance, group stats, conclusion' },
]

// ── Main component ─────────────────────────────────────────────────────────────

export default function TabAnalytics() {
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [sidecarOk, setSidecarOk] = useState<boolean | null>(null)
  const [disabled, setDisabled] = useState<string[]>([])
  const [saving, setSaving] = useState<string | null>(null)
  const [demoItem, setDemoItem] = useState<AnalysisDef | null>(null)

  const filtered = REGISTRY.filter(a => {
    const matchCat = filter === 'all' || a.category === filter
    const matchSearch = !search || a.title.toLowerCase().includes(search.toLowerCase()) ||
      a.description.toLowerCase().includes(search.toLowerCase()) ||
      a.when_to_use.toLowerCase().includes(search.toLowerCase())
    return matchCat && matchSearch
  })
  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE)
  const paged = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)
  const categories = Array.from(new Set(REGISTRY.map(a => a.category)))

  useEffect(() => {
    fetch('/api/stats/health').then(r => r.json()).then(d => setSidecarOk(d.ok)).catch(() => setSidecarOk(false))
    fetch('/api/stats/settings').then(r => r.json()).then(d => setDisabled(d.disabled || [])).catch(() => {})
  }, [])

  async function toggleAnalysis(name: string, e: React.MouseEvent) {
    e.stopPropagation()
    setSaving(name)
    const newDisabled = disabled.includes(name) ? disabled.filter(d => d !== name) : [...disabled, name]
    try {
      await fetch('/api/stats/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: newDisabled }),
      })
      setDisabled(newDisabled)
    } catch { } finally { setSaving(null) }
  }

  return (
    <div style={{ padding: '0 0 40px' }}>
      {/* Demo modal */}
      {demoItem && (
        <DemoModal
          item={demoItem}
          color={CATEGORY_COLORS[demoItem.category] || '#6366f1'}
          onClose={() => setDemoItem(null)}
        />
      )}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Analysis Capabilities</h2>
            <p style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4, marginBottom: 0 }}>
              12 statistical analyses — click any card to see a live demo with sample data.
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
            Statistical analyses are unavailable. Start the engine: <code style={{ background: 'rgba(220,38,38,.1)', padding: '1px 5px', borderRadius: 4 }}>cd services/stats-sidecar && python3 main.py</code>
          </div>
        )}
      </div>

      {/* Search */}
      <div style={{ marginBottom: 14 }}>
        <input placeholder="Search analyses…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
          style={{ width: '100%', padding: '8px 12px', border: '1.5px solid var(--border2)', borderRadius: 8, fontSize: 13, background: 'var(--bg)', color: 'var(--text)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
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
          const isDisabled = disabled.includes(a.name)
          return (
            <div key={a.name}
              onClick={() => setDemoItem(a)}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--shadow)', transition: 'all .15s', opacity: isDisabled ? 0.55 : 1, cursor: 'pointer' }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = `0 4px 16px rgba(0,0,0,.1)`; (e.currentTarget as HTMLDivElement).style.borderColor = color + '60' }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow)'; (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)' }}>

              {/* Card header */}
              <div style={{ padding: '16px 16px 12px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ width: 52, height: 52, borderRadius: 10, background: color + '12', border: `1px solid ${color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <AnalysisIcon name={a.name} color={color} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{a.title}</div>
                  <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 999, background: color + '18', color, fontWeight: 600, border: `1px solid ${color}30` }}>
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

              {/* Footer row */}
              <div style={{ borderTop: '1px solid var(--border)', padding: '8px 12px 8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color, fontWeight: 500 }}>▶ View demo</span>
                <button
                  onClick={(e) => toggleAnalysis(a.name, e)}
                  disabled={saving === a.name}
                  style={{ padding: '3px 10px', borderRadius: 999, border: `1.5px solid ${isDisabled ? 'var(--border2)' : color}`, background: isDisabled ? 'var(--bg3)' : color + '18', color: isDisabled ? 'var(--text4)' : color, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s' }}>
                  {saving === a.name ? '…' : isDisabled ? 'Disabled' : 'Enabled'}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 24 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: page === 1 ? 'not-allowed' : 'pointer', color: 'var(--text3)', fontSize: 13, opacity: page === 1 ? 0.5 : 1 }}>←</button>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: page === totalPages ? 'not-allowed' : 'pointer', color: 'var(--text3)', fontSize: 13, opacity: page === totalPages ? 0.5 : 1 }}>→</button>
        </div>
      )}
      <div style={{ textAlign: 'center', marginTop: 12, fontSize: 12, color: 'var(--text4)' }}>
        {filtered.length} analys{filtered.length === 1 ? 'is' : 'es'} {filter !== 'all' ? `in ${CATEGORY_LABELS[filter]}` : 'available'}
      </div>
    </div>
  )
}

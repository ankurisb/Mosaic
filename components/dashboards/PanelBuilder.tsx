'use client'
import React from 'react'
import { useState, useEffect } from 'react'

interface Panel {
  id?: string; title: string; subtitle: string
  source_type: string; source_id: string
  query: string; chart_type: string; chart_config: Record<string, unknown>
  refresh_sec: number | null; col: number; row: number; w: number; h: number
}
interface Connection { id: string; label: string; dialect?: string }
interface ApiService  { id: string; label: string }
interface FileServer  { id: string; label: string }

const CHART_TYPES = [
  { value: 'bar',    label: 'Bar chart',  icon: '' },
  { value: 'line',   label: 'Line chart', icon: '' },
  { value: 'number', label: 'KPI number', icon: '#' },
  { value: 'table',  label: 'Data table', icon: '' },
  { value: 'donut',  label: 'Donut',      icon: '' },
  { value: 'gauge',  label: 'Gauge',      icon: '' },
]

const WIDTHS = [
  { value: 1, label: ' width (1 col)' },
  { value: 2, label: ' width (2 cols)' },
  { value: 3, label: ' width (3 cols)' },
  { value: 4, label: 'Full width (4 cols)' },
]

const REFRESH_OPTS = [
  { label: 'Dashboard default', value: null },
  { label: '1 min',  value: 60 },
  { label: '5 min',  value: 300 },
  { label: '15 min', value: 900 },
  { label: '1 hour', value: 3600 },
]

const INP: React.CSSProperties = {
  width: '100%', background: 'var(--bg)', border: '1px solid var(--border2)',
  borderRadius: 'var(--radius-sm)', padding: '8px 11px', fontSize: 13,
  color: 'var(--text)', outline: 'none', fontFamily: 'inherit',
}
const LBL: React.CSSProperties = { fontSize: 11, fontWeight: 500, color: 'var(--text2)', marginBottom: 5, display: 'block' }

export default function PanelBuilder({
  initial, onSave, onCancel,
}: {
  initial: Panel | null
  onSave: (data: Panel) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<Panel>(initial ?? {
    title: '', subtitle: '', source_type: 'database', source_id: '',
    query: '', chart_type: 'bar', chart_config: {}, refresh_sec: null,
    col: 0, row: 0, w: 2, h: 1,
  })
  const [dbs, setDbs]       = useState<Connection[]>([])
  const [apis, setApis]     = useState<ApiService[]>([])
  const [files, setFiles]   = useState<FileServer[]>([])
  const [aiQuery, setAiQuery]   = useState('')
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    fetch('/api/connections').then(r => r.json()).then(d => setDbs(d.connections || []))
    fetch('/api/services').then(r => r.json()).then(d => setApis(d.services || []))
    fetch('/api/file-servers').then(r => r.json()).then(d => setFiles(d.file_servers || []))
  }, [])

  const set = (k: keyof Panel, v: unknown) => setForm(p => ({ ...p, [k]: v }))

  // -- Agent query generator -------------------------------------
  async function generateQuery() {
    if (!aiQuery.trim() || !form.source_id) return
    setGenerating(true)
    try {
      const source = form.source_type === 'database'
        ? dbs.find(d => d.id === form.source_id)
        : form.source_type === 'api'
        ? apis.find(a => a.id === form.source_id)
        : files.find(f => f.id === form.source_id)
      const sourceLabel = (source as { label?: string })?.label || form.source_id
      const prompt = `Write a ${form.source_type === 'database' ? 'SQL SELECT query' : form.source_type === 'api' ? 'OData URL path' : 'file search hint'} to answer: "${aiQuery}"\n\nSource: ${sourceLabel}\n\nReturn ONLY the query, no explanation, no markdown fences.`
      const r = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          model: 'claude-haiku-4-5-20251001',
        }),
      })
      // Read SSE stream for text events
      const reader = r.body!.getReader()
      const dec = new TextDecoder()
      let buf = '', q = ''
      while (true) {
        const { done, value } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n\n'); buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const e = JSON.parse(line.slice(6))
            if (e.type === 'text') q += e.text
          } catch {}
        }
      }
      set('query', q.trim())
    } finally { setGenerating(false) }
  }

  const sourceList = form.source_type === 'database' ? dbs
    : form.source_type === 'api' ? apis
    : files

  return (
    <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '16px 24px', boxShadow: '0 4px 16px rgba(0,0,0,.08)' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 16 }}>
          {initial?.id ? 'Edit panel' : 'Add panel'}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          {/* Title */}
          <div><label style={LBL}>Panel title *</label>
            <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. OEE -- Line A" style={INP} />
          </div>
          {/* Subtitle */}
          <div><label style={LBL}>Subtitle</label>
            <input value={form.subtitle} onChange={e => set('subtitle', e.target.value)} placeholder="e.g. Last 7 days" style={INP} />
          </div>
          {/* Width */}
          <div><label style={LBL}>Width</label>
            <select value={form.w} onChange={e => set('w', Number(e.target.value))} style={{ ...INP, cursor: 'pointer' }}>
              {WIDTHS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          {/* Source type */}
          <div><label style={LBL}>Source type</label>
            <select value={form.source_type} onChange={e => { set('source_type', e.target.value); set('source_id', '') }} style={{ ...INP, cursor: 'pointer' }}>
              <option value="database">Database</option>
              <option value="api">API service</option>
              <option value="file_server">File server</option>
            </select>
          </div>
          {/* Source connection */}
          <div><label style={LBL}>Connection *</label>
            <select value={form.source_id} onChange={e => set('source_id', e.target.value)} style={{ ...INP, cursor: 'pointer' }}>
              <option value="">Select...</option>
              {sourceList.map((s: { id: string; label: string }) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
          {/* Refresh override */}
          <div><label style={LBL}>Refresh (panel override)</label>
            <select value={form.refresh_sec ?? 'null'} onChange={e => set('refresh_sec', e.target.value === 'null' ? null : Number(e.target.value))} style={{ ...INP, cursor: 'pointer' }}>
              {REFRESH_OPTS.map(o => <option key={String(o.value)} value={o.value ?? 'null'}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {/* AI query generator */}
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 6 }}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" style={{ marginRight: 4, verticalAlign: 'middle' }}><circle cx="5.5" cy="5.5" r="4.5"/><path d="M5.5 3.5v2.5l2 1"/></svg>
            Describe what you want — Mosaic writes the query
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={aiQuery} onChange={e => setAiQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') generateQuery() }}
              placeholder="e.g. OEE % by line for the last 7 days"
              style={{ ...INP, flex: 1 }} />
            <button onClick={generateQuery} disabled={generating || !aiQuery.trim() || !form.source_id}
              style={{ padding: '8px 14px', background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 500, cursor: generating || !aiQuery.trim() || !form.source_id ? 'not-allowed' : 'pointer', opacity: generating || !aiQuery.trim() || !form.source_id ? 0.5 : 1, fontFamily: 'inherit', flexShrink: 0 }}>
              {generating ? 'Generating...' : 'Generate query'}
            </button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text4)', marginTop: 4 }}>Select a connection first, then describe what to show. Review the query below before saving.</div>
        </div>

        {/* Query / path */}
        <div style={{ marginBottom: 12 }}>
          <label style={LBL}>
            {form.source_type === 'database' ? 'SQL query *' : form.source_type === 'api' ? 'OData / API path *' : 'File hint *'}
          </label>
          <textarea value={form.query} onChange={e => set('query', e.target.value)}
            rows={3} placeholder={
              form.source_type === 'database'
                ? 'SELECT line, avg(oee_pct) as oee FROM oee_daily WHERE date >= now() - interval \'7 days\' GROUP BY line'
                : form.source_type === 'api'
                ? '/OEEReport?$filter=Date ge \'2026-01-01\'&$top=50&$format=json'
                : 'Latest OEE report for Line A'
            }
            style={{ ...INP, resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 12 }} />
        </div>

        {/* Chart type */}
        <div style={{ marginBottom: 14 }}>
          <label style={LBL}>Chart type</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CHART_TYPES.map(ct => (
              <button key={ct.value} onClick={() => set('chart_type', ct.value)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: `1.5px solid ${form.chart_type === ct.value ? 'var(--accent-bg)' : 'var(--border2)'}`, background: form.chart_type === ct.value ? 'var(--accent-bg)' : 'var(--bg)', color: form.chart_type === ct.value ? 'var(--accent-fg)' : 'var(--text2)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .12s' }}>
                <span style={{ fontSize: 14 }}>{ct.icon}</span>{ct.label}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        {/* Chart config -- axis / field mapping */}
        {['bar','line','donut','gauge','boxplot','sankey'].includes(form.chart_type) && (
          <div style={{ marginBottom: 14 }}>
            <label style={LBL}>Field mapping <span style={{ fontWeight: 400, color: 'var(--text3)' }}>(leave blank to auto-detect)</span></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {(form.chart_type === 'sankey' ? [
                  { key: 'source_key', label: 'Source column', ph: 'e.g. from_stage' },
                  { key: 'target_key', label: 'Target column', ph: 'e.g. to_stage'   },
                  { key: 'value_key',  label: 'Value column',  ph: 'e.g. count'      },
                  { key: 'unit',       label: 'Unit',          ph: 'e.g. units'      },
                ] : form.chart_type === 'boxplot' ? [
                  { key: 'group_key', label: 'Group column', ph: 'e.g. machine'  },
                  { key: 'value_key', label: 'Value column', ph: 'e.g. cycle_ms' },
                  { key: 'unit',      label: 'Unit',         ph: 'e.g. ms'       },
                ] : form.chart_type === 'gauge' ? [
                  { key: 'value_key', label: 'Value column', ph: 'e.g. oee_pct' },
                  { key: 'min',       label: 'Min',          ph: '0'            },
                  { key: 'max',       label: 'Max',          ph: '100'          },
                  { key: 'unit',      label: 'Unit',         ph: '%'            },
                ] : form.chart_type === 'donut' ? [
                  { key: 'label_key', label: 'Label column', ph: 'e.g. defect_type' },
                  { key: 'value_key', label: 'Value column', ph: 'e.g. count'       },
                ] : [
                  { key: 'label_key', label: 'Label / X column', ph: 'e.g. date'    },
                  { key: 'value_key', label: 'Value / Y column',  ph: 'e.g. oee_pct' },
                  { key: 'unit',      label: 'Unit',              ph: 'e.g. %'        },
                ]
              ).map(({ key, label, ph }: { key: string; label: string; ph: string }) => (
                <div key={key}>
                  <label style={{ ...LBL, marginBottom: 3 }}>{label}</label>
                  <input
                    value={String((form.chart_config as Record<string,unknown>)[key] ?? '')}
                    onChange={e => set('chart_config', { ...(form.chart_config as Record<string,unknown>), [key]: e.target.value })}
                    placeholder={ph}
                    style={{ ...INP, fontSize: 12 }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
        {form.chart_type === 'heatmap' && (
          <div style={{ marginBottom: 14 }}>
            <label style={LBL}>Heatmap config</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
              {[
                { key: 'low',  label: 'Min value', ph: '0'   },
                { key: 'high', label: 'Max value',  ph: '100' },
                { key: 'unit', label: 'Unit',       ph: '%'   },
              ].map(({ key, label, ph }: { key: string; label: string; ph: string }) => (
                <div key={key}>
                  <label style={{ ...LBL, marginBottom: 3 }}>{label}</label>
                  <input
                    value={String((form.chart_config as Record<string,unknown>)[key] ?? '')}
                    onChange={e => set('chart_config', { ...(form.chart_config as Record<string,unknown>), [key]: e.target.value })}
                    placeholder={ph} style={{ ...INP, fontSize: 12 }}
                  />
                </div>
              ))}
              <div>
                <label style={{ ...LBL, marginBottom: 3 }}>Direction</label>
                <select
                  value={String((form.chart_config as Record<string,unknown>).good_high ?? 'true')}
                  onChange={e => set('chart_config', { ...(form.chart_config as Record<string,unknown>), good_high: e.target.value === 'true' })}
                  style={{ ...INP, cursor: 'pointer', fontSize: 12 }}>
                  <option value="true">High is good (OEE, availability)</option>
                  <option value="false">Low is good (defects, downtime)</option>
                </select>
              </div>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <button onClick={() => onSave(form)} disabled={!form.title.trim() || !form.source_id || !form.query.trim()}
            style={{ padding: '8px 18px', background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 500, cursor: !form.title.trim() || !form.source_id || !form.query.trim() ? 'not-allowed' : 'pointer', opacity: !form.title.trim() || !form.source_id || !form.query.trim() ? 0.5 : 1, fontFamily: 'inherit' }}>
            {initial?.id ? 'Update panel' : 'Add panel'}
          </button>
          <button onClick={onCancel} style={{ padding: '8px 16px', background: 'var(--surface)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-pill)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

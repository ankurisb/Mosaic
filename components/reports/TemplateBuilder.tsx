'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────

type SectionType = 'kpi' | 'table' | 'chart' | 'ai_narrative' | 'text'

interface Section {
  id: string
  type: SectionType
  title: string
  // data binding
  source_type: 'database' | 'api' | 'none'
  source_id: string       // db_connection id or api_service id
  query: string           // SQL or API path
  // ai narrative
  ai_prompt: string       // prompt sent to Claude with query results injected
  // text / static
  content: string
  // display options
  chart_type?: 'bar' | 'line' | 'pie' | 'number'
}

interface DbConnection { id: string; label: string; dialect: string }
interface ApiService   { id: string; label: string; base_url: string }

interface Template {
  id?: string
  name: string
  description: string
  type: string
  schedule: string
  recipients: string
  sections: Section[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 10) }

function defaultSection(type: SectionType): Section {
  return {
    id: uid(), type, title: '',
    source_type: type === 'text' || type === 'ai_narrative' ? 'none' : 'database',
    source_id: '', query: '', ai_prompt: '', content: '',
    chart_type: 'bar',
  }
}

// SVG icons matching Mosaic's inline SVG style (stroke=currentColor, strokeWidth=1.4, round caps)
const SECTION_ICONS: Record<SectionType, React.ReactNode> = {
  kpi: <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="7" width="3" height="6" rx="1"/><rect x="5.5" y="4" width="3" height="9" rx="1"/><rect x="10" y="1" width="3" height="12" rx="1"/></svg>,
  table: <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="1" width="12" height="12" rx="1.5"/><path d="M1 5h12M5 5v8"/></svg>,
  chart: <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M1 10l3-4 2.5 2.5 3-5 2.5 3"/><path d="M1 13h12"/></svg>,
  ai_narrative: <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><polygon points="7,1 9,5 13,5.5 10,8.5 10.5,13 7,11 3.5,13 4,8.5 1,5.5 5,5"/></svg>,
  text: <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 3h10M2 6.5h8M2 10h6"/></svg>,
}

const SECTION_LABELS: Record<SectionType, string> = {
  kpi:          'KPI Summary',
  table:        'Data Table',
  chart:        'Chart',
  ai_narrative: 'AI Narrative',
  text:         'Static Text',
}

const SECTION_DESC: Record<SectionType, string> = {
  kpi:          'Run a query and render results as metric cards',
  table:        'Run a query and render results as a formatted table',
  chart:        'Run a query and render as bar, line, or pie chart',
  ai_narrative: 'Claude analyses query results and writes a narrative paragraph',
  text:         'Static markdown/HTML text — no data binding needed',
}

// ── Styles ────────────────────────────────────────────────────────────────────

const INP: React.CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1.5px solid var(--border2)',
  borderRadius: 7, fontSize: 13, background: 'var(--bg)', color: 'var(--text)',
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
}
const TEXTAREA: React.CSSProperties = { ...INP, resize: 'vertical', minHeight: 72, lineHeight: 1.5 }
const LABEL: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 5 }
const FIELD: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 0 }

// ── Section card ──────────────────────────────────────────────────────────────

function SectionCard({
  section, index, total, dbs, apis,
  onChange, onRemove, onMoveUp, onMoveDown,
}: {
  section: Section, index: number, total: number,
  dbs: DbConnection[], apis: ApiService[],
  onChange: (s: Section) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const [open, setOpen] = useState(true)
  const up = <T,>(k: keyof Section, v: T) => onChange({ ...section, [k]: v })

  const needsSource = section.type !== 'text'
  const needsQuery  = section.type !== 'text' && section.source_type !== 'none'
  const needsPrompt = section.type === 'ai_narrative'
  const needsContent = section.type === 'text'
  const needsChart   = section.type === 'chart'

  return (
    <div style={{ border: '1.5px solid var(--border)', borderRadius: 10, background: 'var(--surface)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg2)', borderBottom: open ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}>
        <span style={{ fontSize: 12, color: 'var(--text3)', minWidth: 20 }}>{index + 1}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text2)' }}>
            {SECTION_ICONS[section.type]}
            {SECTION_LABELS[section.type]}
          </span>
        {section.title && <span style={{ fontSize: 12, color: 'var(--text3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>— {section.title}</span>}
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }} onClick={e => e.stopPropagation()}>
          <button onClick={onMoveUp} disabled={index === 0} title="Move up"
            style={{ width: 26, height: 26, borderRadius: 5, border: '1px solid var(--border2)', background: 'var(--bg)', cursor: index === 0 ? 'default' : 'pointer', opacity: index === 0 ? 0.35 : 1, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>↑</button>
          <button onClick={onMoveDown} disabled={index === total - 1} title="Move down"
            style={{ width: 26, height: 26, borderRadius: 5, border: '1px solid var(--border2)', background: 'var(--bg)', cursor: index === total - 1 ? 'default' : 'pointer', opacity: index === total - 1 ? 0.35 : 1, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>↓</button>
          <button onClick={onRemove} title="Remove section"
            style={{ width: 26, height: 26, borderRadius: 5, border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>
        <span style={{ color: 'var(--text3)', fontSize: 11, marginLeft: 4 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Section title */}
          <div style={FIELD}>
            <label style={LABEL}>Section title</label>
            <input style={INP} placeholder={`e.g. ${SECTION_LABELS[section.type]}`}
              value={section.title} onChange={e => up('title', e.target.value)} />
          </div>

          {/* Source type */}
          {needsSource && (
            <div style={FIELD}>
              <label style={LABEL}>Data source</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['database', 'api', 'none'] as const).map(st => (
                  <button key={st} onClick={() => up('source_type', st)}
                    style={{ padding: '5px 12px', borderRadius: 6, border: `1.5px solid ${section.source_type === st ? 'var(--blue)' : 'var(--border2)'}`, background: section.source_type === st ? '#eff6ff' : 'var(--bg)', color: section.source_type === st ? 'var(--blue-t)' : 'var(--text2)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: section.source_type === st ? 600 : 400 }}>
                    {st === 'database' ? 'Database' : st === 'api' ? 'API' : 'None'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Source picker */}
          {needsSource && section.source_type === 'database' && (
            <div style={FIELD}>
              <label style={LABEL}>Connection</label>
              <select style={INP} value={section.source_id} onChange={e => up('source_id', e.target.value)}>
                <option value="">— Select a database connection —</option>
                {dbs.map(d => <option key={d.id} value={d.id}>{d.label} ({d.dialect})</option>)}
              </select>
            </div>
          )}
          {needsSource && section.source_type === 'api' && (
            <div style={FIELD}>
              <label style={LABEL}>API service</label>
              <select style={INP} value={section.source_id} onChange={e => up('source_id', e.target.value)}>
                <option value="">— Select an API service —</option>
                {apis.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>
          )}

          {/* Query */}
          {needsQuery && section.source_type !== 'none' && (
            <div style={FIELD}>
              <label style={LABEL}>
                {section.source_type === 'database' ? 'SQL query' : 'API path / endpoint'}
                <span style={{ fontWeight: 400, color: 'var(--text3)', marginLeft: 6 }}>
                  {section.source_type === 'database' ? '(results injected into section)' : '(relative path, e.g. /odata/Equipment)'}
                </span>
              </label>
              <textarea style={TEXTAREA}
                placeholder={section.source_type === 'database'
                  ? 'SELECT machine_id, oee_pct, availability FROM oee_weekly\nWHERE week >= date(\'now\', \'-7 days\')\nORDER BY oee_pct ASC LIMIT 10'
                  : '/odata/Equipment?$filter=Plant eq \'P001\'&$top=20'}
                value={section.query} onChange={e => up('query', e.target.value)} />
            </div>
          )}

          {/* Chart type */}
          {needsChart && (
            <div style={FIELD}>
              <label style={LABEL}>Chart type</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['bar', 'line', 'pie', 'number'] as const).map(ct => (
                  <button key={ct} onClick={() => up('chart_type', ct)}
                    style={{ padding: '5px 12px', borderRadius: 6, border: `1.5px solid ${section.chart_type === ct ? 'var(--blue)' : 'var(--border2)'}`, background: section.chart_type === ct ? '#eff6ff' : 'var(--bg)', color: section.chart_type === ct ? 'var(--blue-t)' : 'var(--text2)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: section.chart_type === ct ? 600 : 400 }}>
                    {ct === 'bar' ? 'Bar' : ct === 'line' ? 'Line' : ct === 'pie' ? 'Pie' : 'Number'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* AI prompt */}
          {needsPrompt && (
            <div style={FIELD}>
              <label style={LABEL}>
                AI narrative prompt
                <span style={{ fontWeight: 400, color: 'var(--text3)', marginLeft: 6 }}>(query results will be appended automatically)</span>
              </label>
              <textarea style={{ ...TEXTAREA, minHeight: 90 }}
                placeholder={'Analyse the OEE data below and write a 2-paragraph narrative. Identify the top 2 underperforming machines, state the likely causes, and recommend immediate actions. Be concise and use manufacturing terminology.'}
                value={section.ai_prompt} onChange={e => up('ai_prompt', e.target.value)} />
            </div>
          )}

          {/* Static content */}
          {needsContent && (
            <div style={FIELD}>
              <label style={LABEL}>Content (HTML or plain text)</label>
              <textarea style={{ ...TEXTAREA, minHeight: 90 }}
                placeholder="Enter static content for this section — can include <b>bold</b>, <ul>, <table>, etc."
                value={section.content} onChange={e => up('content', e.target.value)} />
            </div>
          )}

          <div style={{ fontSize: 11, color: 'var(--text3)', padding: '6px 10px', background: 'var(--bg2)', borderRadius: 6 }}>
            {SECTION_DESC[section.type]}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Section type picker ───────────────────────────────────────────────────────

function SectionPicker({ onAdd }: { onAdd: (t: SectionType) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {!open ? (
        <button onClick={() => setOpen(true)}
          style={{ padding: '8px 18px', borderRadius: 8, border: '1.5px dashed var(--border2)', background: 'var(--bg)', color: 'var(--text2)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M7 2v10M2 7h10"/></svg> Add section
        </button>
      ) : (
        <div style={{ border: '1.5px solid var(--border)', borderRadius: 10, background: 'var(--surface)', overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Choose section type</span>
            <button onClick={() => setOpen(false)} style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid var(--border2)', background: 'var(--bg)', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)' }}>×</button>
          </div>
          {(Object.keys(SECTION_LABELS) as SectionType[]).map((t, i, arr) => (
            <button key={t} onClick={() => { onAdd(t); setOpen(false) }}
              style={{ width: '100%', padding: '11px 16px', border: 'none', borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ color: 'var(--text3)' }}>{SECTION_ICONS[t]}</span>
                  {SECTION_LABELS[t]}
                </span>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>{SECTION_DESC[t]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Schedule builder ──────────────────────────────────────────────────────────

const SCHEDULE_PRESETS = [
  { label: 'Manual only',          value: '' },
  { label: 'Daily at 06:00',       value: '0 6 * * *' },
  { label: 'Weekly — Mon 06:00',   value: '0 6 * * 1' },
  { label: 'Weekly — Fri 17:00',   value: '0 17 * * 5' },
  { label: 'Monthly — 1st at 07:00', value: '0 7 1 * *' },
  { label: 'Custom cron…',         value: '__custom__' },
]

function ScheduleBuilder({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isPreset = SCHEDULE_PRESETS.some(p => p.value === value && p.value !== '__custom__')
  const [custom, setCustom] = useState(!isPreset && value !== '')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <select style={INP}
        value={custom ? '__custom__' : value}
        onChange={e => {
          if (e.target.value === '__custom__') { setCustom(true) }
          else { setCustom(false); onChange(e.target.value) }
        }}>
        {SCHEDULE_PRESETS.map(p => <option key={p.label} value={p.value}>{p.label}</option>)}
      </select>
      {custom && (
        <input style={INP} placeholder="cron expression, e.g. 0 6 * * 1"
          value={value} onChange={e => onChange(e.target.value)} />
      )}
      {value && !custom && (
        <div style={{ fontSize: 11, color: 'var(--text3)' }}>Cron: <code>{value}</code></div>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function TemplateBuilder({ user, templateId }: { user: { role: string }; templateId?: string }) {
  const router = useRouter()
  const isEdit = !!templateId

  const [template, setTemplate] = useState<Template>({
    name: '', description: '', type: 'operational', schedule: '', recipients: '', sections: [],
  })
  const [dbs, setDbs]   = useState<DbConnection[]>([])
  const [apis, setApis] = useState<ApiService[]>([])
  const [saving, setSaving]   = useState(false)
  const [loading, setLoading] = useState(isEdit)
  const [error, setError]     = useState('')

  // Load connections
  useEffect(() => {
    fetch('/api/connections').then(r => r.json()).then(d => setDbs(d.connections || []))
    fetch('/api/services').then(r => r.json()).then(d => setApis(d.services || []))
  }, [])

  // Load existing template if editing
  useEffect(() => {
    if (!templateId) return
    fetch(`/api/reports?type=template&id=${templateId}`)
      .then(r => r.json())
      .then(d => {
        const t = d.template
        if (!t) return
        setTemplate({
          id: t.id, name: t.name, description: t.description || '',
          type: t.type || 'operational', schedule: t.schedule || '',
          recipients: Array.isArray(t.recipients) ? t.recipients.join(', ') : (t.recipients || ''),
          sections: (() => { try { return JSON.parse(t.sections) } catch { return [] } })(),
        })
      })
      .finally(() => setLoading(false))
  }, [templateId])

  const up = useCallback(<K extends keyof Template>(k: K, v: Template[K]) =>
    setTemplate(p => ({ ...p, [k]: v })), [])

  function addSection(type: SectionType) {
    setTemplate(p => ({ ...p, sections: [...p.sections, defaultSection(type)] }))
  }

  function updateSection(idx: number, s: Section) {
    setTemplate(p => { const ss = [...p.sections]; ss[idx] = s; return { ...p, sections: ss } })
  }

  function removeSection(idx: number) {
    setTemplate(p => ({ ...p, sections: p.sections.filter((_, i) => i !== idx) }))
  }

  function moveSection(idx: number, dir: -1 | 1) {
    setTemplate(p => {
      const ss = [...p.sections]
      const target = idx + dir
      if (target < 0 || target >= ss.length) return p
      ;[ss[idx], ss[target]] = [ss[target], ss[idx]]
      return { ...p, sections: ss }
    })
  }

  async function save() {
    if (!template.name) { setError('Template name is required'); return }
    setSaving(true); setError('')
    try {
      const body = {
        action: isEdit ? 'update_template' : 'create_template',
        id: template.id,
        name: template.name,
        description: template.description,
        type: template.type,
        sections: template.sections,
        schedule: template.schedule || null,
        recipients: template.recipients.split(',').map(r => r.trim()).filter(Boolean),
      }
      const res = await fetch('/api/reports', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok || d.error) { setError(d.error || 'Save failed'); return }
      router.push('/reports')
    } catch (e) {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text3)', fontSize: 13 }}>
      Loading template…
    </div>
  )

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* Left panel — sections */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text3)' }}>
          <button onClick={() => router.push('/reports')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 12, fontFamily: 'inherit', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 2L4 6l4 4"/></svg>
            Reports
          </button>
          <span>/</span>
          <span style={{ color: 'var(--text)' }}>{isEdit ? 'Edit template' : 'New template'}</span>
        </div>

        <div style={{ fontWeight: 700, fontSize: 20 }}>{isEdit ? 'Edit template' : 'New report template'}</div>

        {/* Sections */}
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', marginBottom: -8 }}>
          Sections
          <span style={{ fontWeight: 400, color: 'var(--text3)', marginLeft: 8 }}>
            {template.sections.length === 0 ? 'No sections yet — add one below' : `${template.sections.length} section${template.sections.length !== 1 ? 's' : ''}`}
          </span>
        </div>

        {template.sections.length === 0 && (
          <div style={{ padding: '32px 20px', border: '1.5px dashed var(--border2)', borderRadius: 10, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
            Add sections to define what data appears in this report.
            <br />Each section can pull from a database query, API, or AI narrative.
          </div>
        )}

        {template.sections.map((s, i) => (
          <SectionCard key={s.id} section={s} index={i} total={template.sections.length}
            dbs={dbs} apis={apis}
            onChange={ns => updateSection(i, ns)}
            onRemove={() => removeSection(i)}
            onMoveUp={() => moveSection(i, -1)}
            onMoveDown={() => moveSection(i, 1)}
          />
        ))}

        <SectionPicker onAdd={addSection} />
      </div>

      {/* Right panel — metadata + save */}
      <div style={{ width: 320, borderLeft: '1px solid var(--border)', overflowY: 'auto', padding: '24px 22px', display: 'flex', flexDirection: 'column', gap: 18, background: 'var(--surface)', flexShrink: 0 }}>

        <div style={{ fontWeight: 700, fontSize: 15 }}>Template settings</div>

        <div style={FIELD}>
          <label style={LABEL}>Template name *</label>
          <input style={INP} placeholder="e.g. Weekly OEE Summary — Line B"
            value={template.name} onChange={e => up('name', e.target.value)} />
        </div>

        <div style={FIELD}>
          <label style={LABEL}>Description</label>
          <textarea style={{ ...TEXTAREA, minHeight: 60 }}
            placeholder="What this report covers"
            value={template.description} onChange={e => up('description', e.target.value)} />
        </div>

        <div style={FIELD}>
          <label style={LABEL}>Report type</label>
          <select style={INP} value={template.type} onChange={e => up('type', e.target.value)}>
            <option value="operational">Operational</option>
            <option value="maintenance">Maintenance</option>
            <option value="quality">Quality</option>
            <option value="rca">RCA Summary</option>
            <option value="safety">Safety</option>
          </select>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Schedule</div>
          <ScheduleBuilder value={template.schedule} onChange={v => up('schedule', v)} />
        </div>

        <div style={FIELD}>
          <label style={LABEL}>Recipients</label>
          <textarea style={{ ...TEXTAREA, minHeight: 60 }}
            placeholder="manager@company.com&#10;ops-team@company.com"
            value={template.recipients}
            onChange={e => up('recipients', e.target.value)} />
          <span style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>One email per line or comma-separated</span>
        </div>

        {/* Summary */}
        <div style={{ background: 'var(--bg2)', borderRadius: 8, padding: '12px 14px', fontSize: 12, color: 'var(--text3)', display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div><b style={{ color: 'var(--text2)' }}>{template.sections.length}</b> sections</div>
          <div><b style={{ color: 'var(--text2)' }}>{template.sections.filter(s => s.source_type !== 'none').length}</b> data bindings</div>
          <div><b style={{ color: 'var(--text2)' }}>{template.sections.filter(s => s.type === 'ai_narrative').length}</b> AI narratives</div>
          <div><b style={{ color: 'var(--text2)' }}>{template.schedule ? template.schedule : 'Manual only'}</b></div>
        </div>

        {error && (
          <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 7, fontSize: 12, color: '#dc2626' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 'auto' }}>
          <button onClick={save} disabled={saving || !template.name}
            style={{ padding: '10px 0', borderRadius: 8, border: 'none', background: 'var(--blue)', color: 'white', fontSize: 14, fontWeight: 700, cursor: template.name ? 'pointer' : 'not-allowed', fontFamily: 'inherit', opacity: !template.name ? 0.5 : 1 }}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create template'}
          </button>
          <button onClick={() => router.push('/reports')}
            style={{ padding: '9px 0', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text2)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

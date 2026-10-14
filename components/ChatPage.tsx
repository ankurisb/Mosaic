'use client'
import React from 'react'
import ChartArtifact from '@/components/ChartArtifact'
import MapView from '@/components/MapArtifact'
import type { MapArtifact as MapData } from '@/lib/tools'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { SessionUser } from '@/lib/auth'
import ThemeToggle from './ThemeToggle'
import { APP_VERSION } from '@/lib/version'
import { UpdateModal } from '@/components/UpdateModal'
import RcaRenderer from './rca/RcaRenderer'
import ReactMarkdown from 'react-markdown'
import * as XLSX from 'xlsx'
import SetupBanner from './SetupBanner'
import { parseRcaOutput, KNOWN_ACTION_IDS } from '@/lib/rca'
import type { RcaBlock, RcaAction } from '@/lib/rca'

interface DataSource {
  id: string; label: string; type: 'db' | 'api' | 'airbyte' | 'prism' | 'file_server' | 'mcp'
  dialect?: string; host?: string; database_name?: string
  service_label?: string; base_path?: string
}

// Category grouping for the source picker.
const SOURCE_CATEGORIES: { key: DataSource['type']; label: string }[] = [
  { key: 'db', label: 'Databases' },
  { key: 'api', label: 'APIs' },
  { key: 'file_server', label: 'File servers' },
  { key: 'prism', label: 'Prism' },
  { key: 'airbyte', label: 'Airbyte' },
  { key: 'mcp', label: 'MCP servers' },
]

interface ToolCall { name: string; input: unknown; result?: unknown }
interface Message { role: 'user' | 'assistant'; content: string; tools?: ToolCall[]; rca?: RcaBlock; actions?: RcaAction[]; suggestedViews?: import('@/lib/rca').SuggestedView[]; narration?: string; startedAt?: number }
interface Conv { id: string; title: string; messages: Message[] }

const SUGGESTIONS: { icon: string; label: string; prompt: string }[] = []

// Phase indicator shown above the tool pill while streaming.
// Derived purely from message state (tools.length, content.length) — no
// extra event types from the server needed.
function PhaseIndicator({ tools, hasText }: { tools: Array<{ result?: unknown }>; hasText: boolean }) {
  const phase = hasText
    ? { label: 'Synthesizing', step: 3 }
    : tools.length === 0
      ? { label: 'Starting', step: 1 }
      : { label: 'Gathering data', step: 2 }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 11, color: 'var(--text3)' }}>
      <span style={{ fontWeight: 500 }}>{phase.label}</span>
      <span style={{ display: 'inline-flex', gap: 3 }}>
        {[1, 2, 3].map(n => (
          <span key={n} style={{ width: 5, height: 5, borderRadius: '50%', background: n <= phase.step ? 'var(--accent-bg)' : 'var(--border2)' }} />
        ))}
      </span>
    </div>
  )
}

// Live elapsed seconds since `since`, ticking once per second. Re-renders only
// this component, not the whole chat.
function useElapsed(since: number | undefined, active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!active || !since) return
    const i = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(i)
  }, [active, since])
  if (!since) return 0
  return Math.max(0, Math.floor((now - since) / 1000))
}

// Collapsible tool calls component
function ToolCalls({
  tools,
  msgIdx,
  narration,
  streaming,
  startedAt,
  dataSources,
}: {
  tools: Array<{name: string; input: unknown; result?: unknown}>
  msgIdx: number
  narration?: string
  streaming?: boolean
  startedAt?: number
  dataSources?: DataSource[]
}) {
  const [open, setOpen] = React.useState(false)
  const elapsed = useElapsed(startedAt, !!streaming)
  const toolLabel: Record<string, string> = {
    web_search: 'Web search',
    query_database: 'Database query',
    call_api: 'API call',
    read_file_server: 'File read',
    query_airbyte: 'Airbyte query',
  }
  const names = tools.map(t => toolLabel[t.name] || t.name)
  const uniqueNames = [...new Set(names)]
  const allOk = tools.every(t => t.result !== undefined && !String(JSON.stringify(t.result)).includes('"error"'))

  // Resolve a friendly display name for a tool call (used in pill + expanded rows)
  function resolveToolLabel(tc: { name: string; input: unknown }): string {
    const inp = (tc.input || {}) as Record<string, unknown>
    if (tc.name === 'query_database') {
      const ds = dataSources?.find(d => d.id === String(inp.connection_id || ''))
      return ds ? ds.label : 'Database'
    }
    if (tc.name === 'call_api') {
      const ds = dataSources?.find(d => d.id === String(inp.service_id || inp.connection_id || ''))
      return ds ? ds.label : 'API'
    }
    if (tc.name === 'read_file_server') {
      const ds = dataSources?.find(d => d.id === String(inp.connection_id || ''))
      return ds ? ds.label : 'File server'
    }
    if (tc.name === 'web_search') return `Web: "${String(inp.query || '').slice(0, 30)}"`
    return toolLabel[tc.name] || tc.name
  }

  // Pill summary: show up to 3 source names, "+N more" for the rest
  const resolvedNames = tools.map(resolveToolLabel)
  const uniqueResolved = [...new Set(resolvedNames)]
  const MAX_PILL_NAMES = 3
  const visibleNames = uniqueResolved.slice(0, MAX_PILL_NAMES)
  const overflowCount = uniqueResolved.length - MAX_PILL_NAMES
  const pillLabel = overflowCount > 0
    ? visibleNames.join(' · ') + ` +${overflowCount}`
    : visibleNames.join(' · ')

  // The "currently running" tool is the most recent one without a result.
  const running = streaming ? [...tools].reverse().find(t => t.result === undefined) : undefined

  // Friendly status line: "Querying Plant Operations…" / "Reading hydraulic pressure…"
  function describeRunning(t: { name: string; input: unknown }): string {
    const inp = (t.input || {}) as Record<string, unknown>
    if (t.name === 'query_database') {
      const cid = inp.connection_id as string | undefined
      const ds = dataSources?.find(d => d.id === cid)
      return ds ? `Querying ${ds.label}…` : 'Querying database…'
    }
    if (t.name === 'web_search') return `Searching the web for "${String(inp.query || '').slice(0, 40)}"…`
    if (t.name === 'call_api') return 'Calling API…'
    if (t.name === 'read_file_server') return 'Reading file…'
    if (t.name === 'query_airbyte') return 'Querying Airbyte…'
    return `Running ${t.name}…`
  }

  // Streaming pill suffix: "· 7 calls · 23s"
  const streamingSuffix = streaming
    ? ` · ${tools.length} call${tools.length === 1 ? '' : 's'}${elapsed > 0 ? ` · ${elapsed}s` : ''}`
    : ''

  return (
    <div style={{ marginBottom: 8 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', fontSize: 11, color: 'var(--text3)', cursor: 'pointer', fontFamily: 'inherit', transition: 'all .12s' }}>
        <span style={{ color: streaming ? 'var(--accent-bg)' : (allOk ? 'var(--green-t)' : 'var(--amber-t)'), fontSize: 9, animation: streaming ? 'blink 1s step-end infinite' : 'none' }}>●</span>
        {pillLabel}{streamingSuffix}
        <span style={{ fontSize: 9, opacity: 0.6 }}>{open ? '▲' : '▼'}</span>
      </button>
      {running && (
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, marginLeft: 2, fontStyle: 'italic' }}>
          {describeRunning(running)}
        </div>
      )}
      {open && (
        <div style={{ marginTop: 6, padding: '10px 12px', background: 'var(--bg3)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
          {narration && (
            <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--border)', fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>
              {narration}
            </div>
          )}
          {tools.map((tc, j) => (
            <div key={j} style={{ marginBottom: j < tools.length - 1 ? 10 : 0 }}>
              {tc.name === 'run_statistical_analysis' ? (
                <AnalysisChip input={tc.input} result={tc.result} />
              ) : (
                <>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 3 }}>{resolveToolLabel(tc)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {typeof tc.input === 'object' ? JSON.stringify(tc.input) : String(tc.input)}
                  </div>
                  {tc.result !== undefined && (
                    <div style={{ fontSize: 11, color: String(JSON.stringify(tc.result)).includes('"error"') ? 'var(--red-t)' : 'var(--green-t)' }}>
                      {String(JSON.stringify(tc.result)).includes('"error"') ? '✗' : '✓'} {JSON.stringify(tc.result).slice(0, 200)}{JSON.stringify(tc.result).length > 200 ? '…' : ''}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Rich chip for a statistical analysis, making the rigour legible: shows the
// method name and the key computed figures (slope, R², Cpk, control limits…)
// rather than a raw JSON blob, so a user can see the conclusion came from real
// computation. Falls back gracefully if the result shape is unexpected.
function AnalysisChip({ input, result }: { input: unknown; result?: unknown }) {
  const inp = (input || {}) as Record<string, unknown>
  const analysisType = String(inp.analysis_type || 'analysis')
  const labelMap: Record<string, string> = {
    control_chart: 'Control Chart (SPC)', process_capability: 'Process Capability (Cp/Cpk)',
    trend: 'Linear Trend Regression', anomaly_detection: 'Anomaly Detection',
    changepoint_detection: 'Changepoint Detection', correlation: 'Correlation Analysis',
    distribution: 'Distribution Analysis', hypothesis_test: 'Hypothesis Test',
  }
  const pretty = labelMap[analysisType] || analysisType.replace(/_/g, ' ')
  const res = (result || {}) as Record<string, unknown>
  const r = (res.result || res) as Record<string, unknown>
  const hasError = JSON.stringify(res).includes('"error"')
  const pending = result === undefined

  // Pull a few headline metrics if present, in a friendly order.
  const metricKeys = ['slope', 'r_squared', 'p_value', 'trend_direction', 'cpk', 'cp', 'ppk',
    'mean', 'ucl', 'lcl', 'sigma', 'out_of_control_points', 'anomaly_count', 'anomaly_rate',
    'capability_rating', 'days_to_threshold', 'changepoints']
  const fmt = (v: unknown): string => {
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, '')
    if (Array.isArray(v)) return String(v.length)
    return String(v)
  }
  const metrics = metricKeys
    .filter(k => r[k] !== undefined && r[k] !== null)
    .slice(0, 6)
    .map(k => ({ k: k.replace(/_/g, ' '), v: fmt(r[k]) }))

  return (
    <div style={{ border: '1px solid var(--border2)', borderRadius: 10, padding: '9px 11px', background: 'linear-gradient(135deg, rgba(37,99,235,0.05), rgba(37,99,235,0.01))' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: metrics.length ? 7 : 0 }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#2563eb" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2 13h12M4 13V8M8 13V4M12 13V6"/></svg>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)' }}>{pretty}</span>
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: '#2563eb', background: 'rgba(37,99,235,0.1)', padding: '1px 6px', borderRadius: 999 }}>Computed</span>
        {pending && <span style={{ fontSize: 10, color: 'var(--text3)' }}>running…</span>}
        {hasError && <span style={{ fontSize: 10, color: 'var(--red-t)' }}>failed</span>}
      </div>
      {metrics.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 12px' }}>
          {metrics.map((m, i) => (
            <span key={i} style={{ fontSize: 10.5, color: 'var(--text2)' }}>
              <span style={{ color: 'var(--text3)' }}>{m.k}:</span> <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{m.v}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

interface GenFile { id: string; name: string; mime: string; size: number }
// Live state of a deep-research / deep-diagnose run, driven by streamed SSE events.
interface ResearchSubtask { id: string; title: string; brief?: string; status: 'queued' | 'running' | 'done'; tool?: string; summary?: string; headline?: string; bullets?: string[]; links?: Array<{ title: string; url: string }>; sources?: number; toolCalls?: number; error?: string; verdict?: 'supported' | 'refuted' | 'inconclusive'; confidence?: number }
interface DiagCause { cause: string; confidence: number; evidence: string[] }
interface ResearchState { mode: 'research' | 'diagnose'; question: string; phase: 'planning' | 'researching' | 'synthesizing' | 'done'; subtasks: ResearchSubtask[]; sourceCount?: number; subagentCount?: number; ms?: number; causes?: DiagCause[]; checks?: string[] }

// What the right-side panel is currently showing.
type PanelItem = { kind: 'file'; file: GenFile } | { kind: 'map'; map: MapData } | { kind: 'research' }

// Download chips + inline image previews for files produced by run_code. Each
// file is served (owner-checked) from /api/files/<id>. Images render inline;
// everything else shows as a labelled download chip.
function fmtBytes(n: number) { return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB` }

function GeneratedFiles({ files, onOpen }: { files: GenFile[]; onOpen: (f: GenFile) => void }) {
  if (!files.length) return null
  const icon = (mime: string) => {
    if (/sheet|excel|csv/i.test(mime)) return '▦'
    if (/word|document/i.test(mime)) return '✎'
    if (/pdf/i.test(mime)) return '▤'
    if (/^image\//i.test(mime)) return '▣'
    return '◰'
  }
  const images = files.filter(f => /^image\//i.test(f.mime))
  const others = files.filter(f => !/^image\//i.test(f.mime))
  return (
    <div style={{ margin: '4px 0 12px' }}>
      {images.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: others.length ? 10 : 0 }}>
          {images.map(f => (
            <button key={f.id} onClick={() => onOpen(f)} title={`Preview ${f.name}`}
              style={{ padding: 0, display: 'block', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', maxWidth: 420, cursor: 'pointer', background: 'none' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/files/${f.id}`} alt={f.name} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
            </button>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {others.map(f => (
            <button key={f.id} onClick={() => onOpen(f)} title={`Preview ${f.name}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .12s' }}>
              <span style={{ fontSize: 15, color: 'var(--accent-bg)' }}>{icon(f.mime)}</span>
              <span style={{ fontWeight: 600, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              <span style={{ color: 'var(--text3)', fontSize: 11 }}>{fmtBytes(f.size)}</span>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text3)' }}><path d="M2 8s2.5-4.5 6-4.5S14 8 14 8s-2.5 4.5-6 4.5S2 8 2 8z"/><circle cx="8" cy="8" r="1.8"/></svg>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Generic file preview panel (Claude-style right-side previewer) ──────────
// Renders a file from /api/files/<id> by type, with a download card as the
// universal fallback so unknown/oversized/unparseable types degrade gracefully
// rather than breaking. Images & PDFs stream from the URL; text/CSV/XLSX/JSON/
// HTML are fetched and rendered client-side. HTML is shown in a script-disabled
// sandboxed iframe.
const PREVIEW_TEXT_MAX = 2 * 1024 * 1024  // 2 MB ceiling for fetch+parse previews

function classifyFile(name: string, mime: string): string {
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (/^image\//.test(mime) || ['png','jpg','jpeg','gif','webp','bmp','svg'].includes(ext)) return 'image'
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (mime === 'text/html' || ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (mime === 'application/json' || ext === 'json') return 'json'
  if (ext === 'csv') return 'csv'
  if (ext === 'tsv') return 'tsv'
  if (/spreadsheet|excel/.test(mime) || ['xlsx','xls','xlsm'].includes(ext)) return 'xlsx'
  if (['js','jsx','ts','tsx','py','sh','bash','sql','yaml','yml','css','scss','xml','java','go','rb','rs','c','cpp','h','hpp','toml','ini','r','php'].includes(ext)) return 'code'
  if (/^text\//.test(mime) || ['txt','log','text',''].includes(ext)) return 'text'
  return 'other'
}

type PreviewState = { status: 'loading'|'ready'|'error'|'toobig'|'unsupported'; text?: string; sheets?: Record<string, string[][]>; sheetNames?: string[] }

function FilePreviewPanel({ file, onClose }: { file: GenFile; onClose: () => void }) {
  const kind = classifyFile(file.name, file.mime)
  const url = `/api/files/${file.id}`
  const [st, setSt] = useState<PreviewState>({ status: 'loading' })
  const [activeSheet, setActiveSheet] = useState<string>('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    setSt({ status: 'loading' })
    async function load() {
      if (kind === 'image' || kind === 'pdf') { setSt({ status: 'ready' }); return }
      if (kind === 'other') { setSt({ status: 'unsupported' }); return }
      if (file.size > PREVIEW_TEXT_MAX && kind !== 'xlsx') { setSt({ status: 'toobig' }); return }
      try {
        const toRows = (ws: XLSX.WorkSheet) => (XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' }) as unknown[][]).slice(0, 1000).map(r => r.map(c => String(c)))
        if (kind === 'xlsx') {
          const buf = await (await fetch(url)).arrayBuffer()
          const wb = XLSX.read(buf, { type: 'array' })
          const sheets: Record<string, string[][]> = {}
          for (const n of wb.SheetNames) sheets[n] = toRows(wb.Sheets[n])
          if (cancelled) return
          setActiveSheet(wb.SheetNames[0] || '')
          setSt({ status: 'ready', sheets, sheetNames: wb.SheetNames })
          return
        }
        const text = await (await fetch(url)).text()
        if (cancelled) return
        if (kind === 'csv' || kind === 'tsv') {
          const wb = XLSX.read(text, { type: 'string', FS: kind === 'tsv' ? '\t' : ',' })
          const n = wb.SheetNames[0]
          setSt({ status: 'ready', sheets: { data: toRows(wb.Sheets[n]) }, sheetNames: ['data'] })
          setActiveSheet('data')
        } else {
          setSt({ status: 'ready', text })
        }
      } catch { if (!cancelled) setSt({ status: 'error' }) }
    }
    load()
    return () => { cancelled = true }
  }, [file.id, file.size, kind, url])

  const DownloadBtn = () => (
    <a href={url} download style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'var(--accent-bg)', color: 'var(--accent-fg,#fff)', borderRadius: 'var(--radius-pill)', textDecoration: 'none', fontSize: 12, fontWeight: 600 }}>
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v8M4.5 7L8 10.5 11.5 7M3 13h10"/></svg>
      Download
    </a>
  )

  const Fallback = ({ msg }: { msg: string }) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 14, color: 'var(--text3)', textAlign: 'center', padding: 24 }}>
      <div style={{ fontSize: 34 }}>◰</div>
      <div style={{ fontSize: 13, maxWidth: 280 }}>{msg}</div>
      <DownloadBtn />
    </div>
  )

  const Table = ({ rows }: { rows: string[][] }) => (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ color: 'var(--text3)', textAlign: 'right', padding: '2px 8px', position: 'sticky', left: 0, background: 'var(--bg)', borderRight: '1px solid var(--border)', userSelect: 'none' }}>{i === 0 ? '' : i}</td>
              {r.map((c, j) => (
                <td key={j} style={{ padding: '3px 10px', border: '1px solid var(--border)', whiteSpace: 'nowrap', fontWeight: i === 0 ? 700 : 400, background: i === 0 ? 'var(--bg3)' : 'transparent', color: 'var(--text)' }}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  let body: React.ReactNode
  if (st.status === 'loading') body = <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text3)', fontSize: 13 }}>Loading preview…</div>
  else if (st.status === 'error') body = <Fallback msg="Couldn't render a preview for this file. You can download it to view it in another app." />
  else if (st.status === 'toobig') body = <Fallback msg={`This file is ${fmtBytes(file.size)} — too large to preview inline. Download it to view.`} />
  else if (st.status === 'unsupported') body = <Fallback msg="No inline preview for this file type. Download it to open in the right app." />
  else if (kind === 'image') body = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 12, overflow: 'auto' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={file.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
    </div>
  )
  else if (kind === 'pdf') body = <iframe src={url} title={file.name} style={{ width: '100%', height: '100%', border: 0 }} />
  else if (kind === 'html') body = <iframe title={file.name} sandbox="" srcDoc={st.text} style={{ width: '100%', height: '100%', border: 0, background: '#fff' }} />
  else if (kind === 'markdown') body = <div className="prose-mosaic" style={{ padding: 18, fontSize: 14, lineHeight: 1.7, color: 'var(--text)', overflow: 'auto', height: '100%' }}><ReactMarkdown>{st.text || ''}</ReactMarkdown></div>
  else if (kind === 'json') { let t = st.text || ''; try { t = JSON.stringify(JSON.parse(t), null, 2) } catch {} body = <pre style={{ margin: 0, padding: 16, fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6, color: 'var(--text)', overflow: 'auto', height: '100%', whiteSpace: 'pre' }}>{t}</pre> }
  else if (kind === 'code' || kind === 'text') body = <pre style={{ margin: 0, padding: 16, fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6, color: 'var(--text)', overflow: 'auto', height: '100%', whiteSpace: 'pre' }}>{st.text}</pre>
  else if ((kind === 'csv' || kind === 'tsv' || kind === 'xlsx') && st.sheets) {
    const names = st.sheetNames || []
    const rows = st.sheets[activeSheet] || st.sheets[names[0]] || []
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {names.length > 1 && (
          <div style={{ display: 'flex', gap: 4, padding: '6px 8px', borderBottom: '1px solid var(--border)', overflowX: 'auto', flexShrink: 0 }}>
            {names.map(n => (
              <button key={n} onClick={() => setActiveSheet(n)} style={{ padding: '3px 10px', fontSize: 11, borderRadius: 'var(--radius-pill)', border: '1px solid var(--border)', cursor: 'pointer', background: n === activeSheet ? 'var(--accent-bg)' : 'var(--bg3)', color: n === activeSheet ? 'var(--accent-fg,#fff)' : 'var(--text2)', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>{n}</button>
            ))}
          </div>
        )}
        <div style={{ flex: 1, overflow: 'hidden' }}><Table rows={rows} /></div>
      </div>
    )
  }
  else body = <Fallback msg="No inline preview available. Download to view." />

  return (
    <div style={{ width: 'min(48vw, 560px)', minWidth: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderLeft: '1px solid var(--border)', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{fmtBytes(file.size)}{file.mime && file.mime !== 'application/octet-stream' ? ` · ${file.mime}` : ''}</div>
        </div>
        <DownloadBtn />
        <button onClick={onClose} title="Close (Esc)" style={{ width: 28, height: 28, borderRadius: 'var(--radius-pill)', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text2)', cursor: 'pointer', fontSize: 15, lineHeight: 1, flexShrink: 0 }}>×</button>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>{body}</div>
    </div>
  )
}

// Gather map artifacts produced by render_map calls in a message.
function collectMapArtifacts(tools?: ToolCall[]): MapData[] {
  if (!Array.isArray(tools)) return []
  const out: MapData[] = []
  for (const t of tools) {
    if (t.name !== 'render_map' || !t.result || typeof t.result !== 'object') continue
    if ((t.result as { kind?: string }).kind === 'map_artifact') out.push(t.result as MapData)
  }
  return out
}

// Chip(s) that open a produced map in the right panel.
function MapChips({ maps, onOpen }: { maps: MapData[]; onOpen: (m: MapData) => void }) {
  if (!maps.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '4px 0 12px' }}>
      {maps.map((m, i) => (
        <button key={i} onClick={() => onOpen(m)} title="Open map"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--accent-bg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L2 4v10l4-2 4 2 4-2V2l-4 2-4-2z"/><path d="M6 2v10M10 4v10"/></svg>
          <span style={{ fontWeight: 600 }}>{m.title || 'Map'}</span>
          <span style={{ color: 'var(--text3)', fontSize: 11 }}>{m.points?.length || 0} location{(m.points?.length || 0) === 1 ? '' : 's'}</span>
        </button>
      ))}
    </div>
  )
}

// Right-side panel wrapper for an interactive map artifact (mirrors the file
// preview panel's chrome so the two feel like one surface).
function MapPanel({ map, onClose }: { map: MapData; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div style={{ width: 'min(48vw, 560px)', minWidth: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderLeft: '1px solid var(--border)', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{map.title || 'Map'}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{map.points?.length || 0} location{(map.points?.length || 0) === 1 ? '' : 's'}</div>
        </div>
        <button onClick={onClose} title="Close (Esc)" style={{ width: 28, height: 28, borderRadius: 'var(--radius-pill)', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text2)', cursor: 'pointer', fontSize: 15, lineHeight: 1, flexShrink: 0 }}>×</button>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}><MapView data={map} /></div>
    </div>
  )
}

// Live "Research workspace": the lead agent and each sub-agent with status, the
// tool it's using now, and its finding — the Phase 3 orchestration view.
function ResearchPanel({ research, onClose }: { research: ResearchState; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  // Per-sub-agent expand/collapse. Default: ALL collapsed (empty set). Reset when
  // a new run starts (question/mode changes). A card only has a body once it has
  // left 'queued', so expand-all / collapse-all operates over those ids.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  useEffect(() => { setExpanded(new Set()) }, [research.question, research.mode])
  const toggle = (id: string) => setExpanded(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const dx = research.mode === 'diagnose'
  const done = research.subtasks.filter(s => s.status === 'done').length
  const noun = dx ? 'hypotheses' : 'sub-agents'
  const lead = research.phase === 'planning' ? (dx ? 'Forming testable fault-mode hypotheses…' : 'Decomposing the question into focused sub-tasks…')
    : research.phase === 'researching' ? (dx ? `Testing ${research.subtasks.length} hypotheses in parallel against your data.` : `Spun out ${research.subtasks.length} sub-agents, each with a focused brief and a tool budget.`)
    : research.phase === 'synthesizing' ? (dx ? 'All hypotheses tested — ranking the probable causes.' : 'All sub-agents done — synthesising a cited briefing.')
    : (dx ? `Diagnosis complete — ${research.causes?.length ?? 0} probable cause(s) ranked.` : `Research complete — ${research.sourceCount ?? 0} sources across ${research.subagentCount ?? research.subtasks.length} sub-agents.`)
  const sub = research.phase === 'done' ? (dx ? `complete · ${research.causes?.length ?? 0} ranked causes` : `complete · ${research.sourceCount ?? 0} sources`) : `${done}/${research.subtasks.length || '…'} ${noun} done`
  const bodyIds = research.subtasks.filter(s => s.status !== 'queued').map(s => s.id)
  const allOpen = bodyIds.length > 0 && bodyIds.every(id => expanded.has(id))
  // Overall progress: sub-agent completion fills a 8–90% band during the run,
  // synthesis is ~95%, done is 100%; planning (no sub-tasks yet) shows a sliver.
  const total = research.subtasks.length
  const frac = research.phase === 'done' ? 1
    : research.phase === 'synthesizing' ? 0.95
    : total === 0 ? 0.06
    : Math.max(0.08, (done / total) * 0.9)
  const pctRun = Math.round(frac * 100)
  // status / verdict badge
  const badge = (s: ResearchSubtask) => {
    if (s.status !== 'done') return s.status === 'running' ? { bg: 'var(--accent-bg)', c: 'var(--accent-fg,#fff)', t: dx ? 'Testing' : 'Researching' } : { bg: 'var(--bg3)', c: 'var(--text3)', t: 'Queued' }
    if (dx && s.verdict) return s.verdict === 'supported' ? { bg: 'var(--amber-bg,#fffbeb)', c: 'var(--amber-t,#d97706)', t: 'Likely' }
      : s.verdict === 'refuted' ? { bg: 'var(--bg3)', c: 'var(--text3)', t: 'Ruled out' }
      : { bg: 'var(--bg3)', c: 'var(--text3)', t: 'Inconclusive' }
    return { bg: 'var(--green-bg,#ecfdf5)', c: 'var(--green-t,#16a34a)', t: 'Done' }
  }
  const pct = (c?: number) => Math.round((c ?? 0) * 100)
  return (
    <div style={{ width: 'min(48vw, 560px)', minWidth: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderLeft: '1px solid var(--border)', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{dx ? 'Diagnosis workspace' : 'Research workspace'}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{sub}{research.phase !== 'done' ? ` · ${pctRun}%` : ''}</div>
        </div>
        <button onClick={onClose} title="Close (Esc)" style={{ width: 28, height: 28, borderRadius: 'var(--radius-pill)', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text2)', cursor: 'pointer', fontSize: 15, lineHeight: 1, flexShrink: 0 }}>×</button>
      </div>
      {/* Overall progress bar */}
      <div style={{ height: 3, background: 'var(--bg3)', flexShrink: 0 }} role="progressbar" aria-valuenow={pctRun} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ height: '100%', width: `${pctRun}%`, background: research.phase === 'done' ? 'var(--green-t,#16a34a)' : 'var(--accent-bg)', transition: 'width .4s ease' }} />
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '12px 13px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg3)', marginBottom: 14 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--surface)', display: 'grid', placeItems: 'center', flexShrink: 0, fontSize: 15 }}>{dx ? '🩺' : '◎'}</div>
          <div><div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>Lead {dx ? 'diagnostician' : 'agent'}{research.phase !== 'done' ? <span style={{ color: 'var(--accent-bg)', marginLeft: 6, animation: 'blink 1s step-end infinite' }}>●</span> : null}</div><div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2, lineHeight: 1.5 }}>{lead}</div></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 2px 9px' }}>
          <span style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{dx ? 'Hypotheses' : 'Sub-agents'}</span>
          {bodyIds.length > 0 ? (
            <button onClick={() => setExpanded(allOpen ? new Set() : new Set(bodyIds))} style={{ fontSize: 10.5, color: 'var(--text2)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 500 }}>{allOpen ? 'Collapse all' : 'Expand all'}</button>
          ) : null}
        </div>
        {research.subtasks.length === 0 && <div style={{ fontSize: 12, color: 'var(--text3)' }}>{dx ? 'Forming hypotheses…' : 'Planning…'}</div>}
        {research.subtasks.map(s => { const b = badge(s); const hasBody = s.status !== 'queued'; const open = expanded.has(s.id); return (
          <div key={s.id} style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', padding: '11px 12px', marginBottom: 9 }}>
            <div onClick={() => hasBody && toggle(s.id)} style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: hasBody ? 'pointer' : 'default', userSelect: 'none' }}>
              <span style={{ fontSize: 9, color: 'var(--text3)', flexShrink: 0, width: 10, transition: 'transform .15s ease', transform: open ? 'rotate(90deg)' : 'none', opacity: hasBody ? 1 : 0.25 }}>▶</span>
              <div style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.title}>{s.title}</div>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.03em', padding: '2px 8px', borderRadius: 999, textTransform: 'uppercase', background: b.bg, color: b.c, flexShrink: 0 }}>{b.t}{s.status === 'running' ? <span style={{ marginLeft: 5, animation: 'blink 1s step-end infinite' }}>●</span> : null}</span>
            </div>
            {open && hasBody ? (
              <div>
                {dx && s.status === 'done' && typeof s.confidence === 'number' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <div style={{ flex: 1, height: 4, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}><div style={{ height: '100%', width: `${pct(s.confidence)}%`, background: s.verdict === 'supported' ? 'var(--amber-t,#d97706)' : 'var(--text3)' }} /></div>
                    <span style={{ fontSize: 10.5, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{pct(s.confidence)}%</span>
                  </div>
                )}
                {s.status === 'running' && (s.tool
                  ? <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text2)', marginTop: 8, fontFamily: 'var(--font-mono)' }}>▸ {s.tool}</div>
                  : <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 8 }}>working…</div>)}
                {/* Structured finding: one-line headline + key-fact bullets. Falls back
                    to the raw summary text when a sub-agent didn't emit the trailer. */}
                {s.status === 'done' && (s.headline || (s.bullets?.length) || s.summary) ? (
                  <div style={{ marginTop: 8 }}>
                    {s.headline && <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', lineHeight: 1.45 }}>{s.headline}</div>}
                    {s.bullets?.length ? (
                      <ul style={{ margin: s.headline ? '6px 0 0' : 0, paddingLeft: 16 }}>
                        {s.bullets.map((b, i) => <li key={i} style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5, marginBottom: 3 }}>{b}</li>)}
                      </ul>
                    ) : (!s.headline && s.summary ? (
                      <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.5 }}>{s.summary}</div>
                    ) : null)}
                  </div>
                ) : null}
                {s.status === 'done' && s.links?.length ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>
                    {s.links.map((l, i) => {
                      let host = l.title || l.url
                      try { host = new URL(l.url).hostname.replace(/^www\./, '') } catch { /* keep title */ }
                      return <a key={i} href={l.url} target="_blank" rel="noreferrer" title={l.title ? `${l.title} — ${l.url}` : l.url} style={{ fontSize: 11, color: 'var(--text2)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 999, padding: '2px 9px', textDecoration: 'none', maxWidth: 210, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>↗ {host}</a>
                    })}
                  </div>
                ) : null}
                {s.status === 'done' && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 7 }}>{s.error ? 'completed with issues' : `${s.sources ?? 0} source${(s.sources ?? 0) === 1 ? '' : 's'} · ${s.toolCalls ?? 0} tool call${(s.toolCalls ?? 0) === 1 ? '' : 's'}`}</div>}
              </div>
            ) : null}
          </div>
        ) })}

        {dx && research.phase === 'done' && (research.causes?.length || research.checks?.length) ? (
          <div style={{ marginTop: 6, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 2px 9px' }}>Ranked probable causes</div>
            {(research.causes || []).map((c, i) => (
              <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg3)', padding: '10px 12px', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-bg)' }}>{i + 1}.</span>
                  <div style={{ fontSize: 13, fontWeight: 600, flex: 1, color: 'var(--text)' }}>{c.cause}</div>
                  <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{pct(c.confidence)}%</span>
                </div>
                {c.evidence?.length ? <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{c.evidence.map((ev, k) => <li key={k} style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>{ev}</li>)}</ul> : null}
              </div>
            ))}
            {research.checks?.length ? (
              <>
                <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', margin: '14px 2px 8px' }}>Recommended checks</div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>{research.checks.map((c, i) => <li key={i} style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.6 }}>{c}</li>)}</ul>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

// Gather produced files across all run_code calls in a message.
function collectGeneratedFiles(tools?: ToolCall[]): GenFile[] {
  if (!Array.isArray(tools)) return []
  const out: GenFile[] = []
  for (const t of tools) {
    if (t.name !== 'run_code' || !t.result || typeof t.result !== 'object') continue
    const files = (t.result as { files?: unknown }).files
    if (Array.isArray(files)) {
      for (const f of files) {
        if (f && typeof f === 'object' && typeof (f as GenFile).id === 'string') out.push(f as GenFile)
      }
    }
  }
  return out
}

// Pull the persisted Research/Diagnosis workspace snapshot off a message's tool
// calls, so the panel can be reopened later (and after a reload) from the
// message itself rather than the transient live `research` state.
function workspaceFromMsg(tools?: ToolCall[]): ResearchState | null {
  if (!Array.isArray(tools)) return null
  for (const t of tools) {
    if ((t.name === 'deep_research' || t.name === 'deep_diagnose') && t.result && typeof t.result === 'object') {
      const ws = (t.result as { workspace?: unknown }).workspace
      if (ws && typeof ws === 'object' && Array.isArray((ws as ResearchState).subtasks)) return ws as ResearchState
    }
  }
  return null
}

export default function ChatPage({ user }: { user: SessionUser }) {
  const router = useRouter()
  const [convs, setConvs] = useState<Conv[]>([{ id: 'local-1', title: 'New conversation', messages: [] }])
  const [activeId, setActiveId] = useState('local-1')
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [showSystem, setShowSystem] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  // Update status for the nav chip (chat page has its own sidebar, not AppShell).
  const [deploy, setDeploy] = useState<{ edition?: string; currentVersion?: string; updateAvailable?: boolean; latestVersion?: string | null; latestReleaseUrl?: string | null; changelog?: { version: string; date: string; sections: Record<string, string[]> }[] }>({})
  const [showUpdate, setShowUpdate] = useState(false)
  useEffect(() => { fetch('/api/deployment').then(r => r.json()).then(setDeploy).catch(() => {}) }, [])
  // Model list is fetched live from /api/models (sourced from the Anthropic API) —
  // no hardcoded options, so new models appear automatically. `model` starts empty
  // and is set to the resolved default once loaded; the server also validates it.
  const [model, setModel] = useState('')
  const [availableModels, setAvailableModels] = useState<{ id: string; label: string }[]>([])
  useEffect(() => {
    fetch('/api/models').then(r => r.json()).then(d => {
      if (Array.isArray(d.models)) setAvailableModels(d.models)
      // Default to Auto: Mosaic picks the model by query shape (RCA/substantive →
      // the strong default-or-stronger; trivial small-talk → fast). Users can still
      // pin a specific model.
      setModel(cur => cur || 'auto')
    }).catch(() => { setModel(cur => cur || 'auto') })
  }, [])
  // Group the live model list by tier (Opus / Sonnet / Haiku / Fable) with the
  // newest version first inside each tier — mirrors how Claude's own picker is
  // organised, instead of one long flat list. Derived entirely from the API list
  // so new models/tiers slot in automatically.
  const TIER_ORDER = ['opus', 'sonnet', 'haiku', 'fable']
  const TIER_LABEL: Record<string, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable' }
  const modelGroups = useMemo(() => {
    const verKey = (id: string, tier: string) => {
      // Numeric parts after the tier (e.g. claude-opus-4-8 → [4,8]; dated → trailing date adds ordering)
      const rest = id.replace(/^claude-/, '').replace(new RegExp('^' + tier + '-?'), '')
      const nums = (rest.match(/\d+/g) || []).map(Number)
      return nums
    }
    const cmpVer = (a: number[], b: number[]) => {
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const d = (b[i] ?? -1) - (a[i] ?? -1)
        if (d) return d
      }
      return 0
    }
    const groups: { key: string; label: string; models: { id: string; label: string }[] }[] = []
    const byTier: Record<string, { id: string; label: string }[]> = {}
    const other: { id: string; label: string }[] = []
    for (const m of availableModels) {
      const tier = TIER_ORDER.find(t => m.id.includes('-' + t + '-') || m.id.includes('-' + t))
      if (tier) (byTier[tier] ||= []).push(m)
      else other.push(m)
    }
    for (const t of TIER_ORDER) {
      if (!byTier[t]?.length) continue
      byTier[t].sort((a, b) => cmpVer(verKey(a.id, t), verKey(b.id, t)))
      groups.push({ key: t, label: TIER_LABEL[t] || t, models: byTier[t] })
    }
    if (other.length) groups.push({ key: 'other', label: 'Other', models: other })
    return groups
  }, [availableModels])
  const [loadingConvs, setLoadingConvs] = useState(true)
  const [dataSources, setDataSources] = useState<DataSource[]>([])
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [mentionIdx, setMentionIdx] = useState(0)
  const [pinnedSources, setPinnedSources] = useState<DataSource[]>([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [convSearch, setConvSearch] = useState('')
  const [plusOpen, setPlusOpen] = useState(false)
  const [plusSubmenu, setPlusSubmenu] = useState<'sources'|'workflows'|'model'|'system'|null>(null)
  const [srcSearch, setSrcSearch] = useState('')
  const [openCats, setOpenCats] = useState<Set<string>>(new Set())
  const [attachments, setAttachments] = useState<Array<{ name: string; type: string; data: string; preview?: string }>>([])
  const [panel, setPanel] = useState<PanelItem | null>(null)
  const [research, setResearch] = useState<ResearchState | null>(null)
  const [workflows, setWorkflows] = useState<Array<{ id: string; name: string; description: string }>>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const plusRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const mentionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/rca-workflows').then(r => r.json()).then(d => {
      if (d.workflows) setWorkflows(d.workflows.filter((w: { active: boolean }) => w.active))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!plusOpen) return
    const handler = (e: MouseEvent) => {
      if (plusRef.current && !plusRef.current.contains(e.target as Node)) {
        setPlusOpen(false); setPlusSubmenu(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [plusOpen])

  async function handleFiles(files: FileList | null) {
    if (!files) return
    for (const file of Array.from(files)) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const data = (e.target?.result as string).split(',')[1]
        const preview = file.type.startsWith('image/') ? (e.target?.result as string) : undefined
        setAttachments(a => [...a, { name: file.name, type: file.type, data, preview }])
      }
      reader.readAsDataURL(file)
    }
  }

  const active = convs.find(c => c.id === activeId) || convs[0] || { id: 'local-0', title: 'New conversation', messages: [] }
  // Safety: ensure messages is always an array
  if (!Array.isArray(active.messages)) (active as Conv).messages = []
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [active?.messages])

  // Load available data sources for chips + @ mention
  const loadSources = useCallback(async () => {
    try {
      const [dbRes, apiRes, abRes, prismRes, fileRes, mcpRes] = await Promise.all([
        fetch('/api/connections'),
        fetch('/api/services'),
        fetch('/api/airbyte?action=list'),
        fetch('/api/prism-instances'),
        fetch('/api/file-servers'),
        fetch('/api/mcp-connections'),
      ])
      const dbData = await dbRes.json().catch(() => ({}))
      const apiData = await apiRes.json().catch(() => ({}))
      const abData = await abRes.json().catch(() => ({}))
      const prismData = await prismRes.json().catch(() => ({}))
      const fileData = await fileRes.json().catch(() => ({}))
      const mcpData = await mcpRes.json().catch(() => ({}))

      // Direct DB connections
      const dbs: DataSource[] = (dbData.connections || []).map((c: Record<string,unknown>) => ({
        id: String(c.id), label: String(c.label), type: 'db' as const,
        dialect: String(c.dialect || ''), host: String(c.host || ''), database_name: String(c.database_name || ''),
      }))

      // API connections — join services + connections
      const serviceMap: Record<string,string> = {}
      ;(apiData.services || []).forEach((s: Record<string,unknown>) => {
        serviceMap[String(s.id)] = String(s.label || '')
      })
      const apis: DataSource[] = (apiData.connections || []).map((c: Record<string,unknown>) => ({
        id: String(c.id), label: String(c.label), type: 'api' as const,
        service_label: serviceMap[String(c.service_id)] || '', base_path: String(c.base_path || ''),
      }))

      // Airbyte instances — each instance appears as one source
      const airbytes: DataSource[] = (abData.instances || []).map((inst: Record<string,unknown>) => ({
        id: `airbyte:${String(inst.id)}`, label: String(inst.label || 'Airbyte'),
        type: 'airbyte' as const, dialect: 'airbyte',
        host: String(inst.url || ''), database_name: String(inst.workspace_id || ''),
      }))

      // Prism IoT instances
      const prisms: DataSource[] = (prismData.instances || []).map((p: Record<string,unknown>) => ({
        id: String(p.id), label: String(p.label || 'Prism'), type: 'prism' as const,
        host: String(p.base_url || ''), database_name: String(p.environment || ''),
      }))

      // File servers / local folders
      const files: DataSource[] = (fileData.file_servers || []).map((f: Record<string,unknown>) => ({
        id: String(f.id), label: String(f.label || 'File server'), type: 'file_server' as const,
        host: String(f.host || f.transport || ''), dialect: String(f.transport || ''),
      }))

      // MCP servers
      const mcps: DataSource[] = (mcpData.mcp_connections || []).map((m: Record<string,unknown>) => ({
        id: String(m.id), label: String(m.label || 'MCP server'), type: 'mcp' as const,
        host: String(m.endpoint_url || ''),
      }))

      setDataSources([...dbs, ...apis, ...files, ...prisms, ...airbytes, ...mcps])
    } catch {}
  }, [])

  useEffect(() => { loadSources() }, [loadSources])
  // Default the picker's categories open when small, collapsed when large (so a
  // 40-endpoint API service doesn't flood the list). Runs once sources arrive.
  const catsInit = useRef(false)
  useEffect(() => {
    if (catsInit.current || dataSources.length === 0) return
    catsInit.current = true
    const open = new Set<string>()
    for (const c of SOURCE_CATEGORIES) {
      const n = dataSources.filter(s => s.type === c.key).length
      if (n > 0 && n <= 8) open.add(c.key)
    }
    setOpenCats(open)
  }, [dataSources])

  // Load conversations from DB on mount
  useEffect(() => {
    fetch('/api/conversations')
      .then(r => r.json())
      .then(data => {
        if (data.conversations?.length) {
          // Keep any unsaved local conversations + prepend with DB ones
          setConvs(prev => {
            const dbConvs: Conv[] = data.conversations.map((c: { id: string; title: string }) => ({
              id: c.id, title: c.title, messages: [],
            }))
            const localUnsaved = prev.filter(c => c.id.startsWith('local-') && c.messages.length > 0)
            return [...localUnsaved, ...dbConvs]
          })
          setActiveId(data.conversations[0].id)
        }
      })
      .catch(() => {})
      .finally(() => setLoadingConvs(false))
  }, [])

  // Load messages when switching to a DB conversation
  useEffect(() => {
    if (!activeId || activeId.startsWith('local-')) return
    const conv = convs.find(c => c.id === activeId)
    if (!conv || conv.messages.length > 0) return // already loaded
    fetch(`/api/conversations/${activeId}`)
      .then(r => r.json())
      .then(data => {
        if (data.messages) {
          setConvs(prev => prev.map(c => c.id === activeId
            ? { ...c, messages: data.messages.map((m: { role: string; content: string; tool_calls?: unknown[]; rca_block?: unknown }) => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
                tools: Array.isArray(m.tool_calls) ? m.tool_calls : (m.tool_calls ? JSON.parse(String(m.tool_calls)) : []),
                ...(m.rca_block ? { rca: m.rca_block as import('@/lib/rca').RcaBlock, actions: (m.rca_block as import('@/lib/rca').RcaBlock).actions, suggestedViews: (m.rca_block as import('@/lib/rca').RcaBlock).suggested_views } : {}),
              })) }
            : c
          ))
        }
      })
      .catch(() => {})
  }, [activeId])

  function newConv() {
    const id = `local-${Date.now()}`
    setConvs(p => [{ id, title: 'New conversation', messages: [] }, ...p])
    setActiveId(id)
  }

  function delConv(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    // Delete from DB if it's a real conversation
    if (!id.startsWith('local-')) {
      fetch(`/api/conversations/${id}`, { method: 'DELETE' }).catch(() => {})
    }
    setConvs(p => {
      const next = p.filter(c => c.id !== id)
      if (!next.length) { const nid = `local-${Date.now()}`; setActiveId(nid); return [{ id: nid, title: 'New conversation', messages: [] }] }
      if (activeId === id) setActiveId(next[0].id)
      return next
    })
  }

  function updateLast(cid: string, fn: (m: Message) => Message) {
    setConvs(p => p.map(c => {
      if (c.id !== cid) return c
      const msgs = [...c.messages]; msgs[msgs.length - 1] = fn(msgs[msgs.length - 1])
      return { ...c, messages: msgs }
    }))
  }

  async function handleAction(action: import('@/lib/rca').RcaAction, conversationId: string) {
    if (action.id === 'export_word') {
      try {
        // Capture all RCA renderer cards as images
        const { default: html2canvas } = await import('html2canvas')
        const cards = Array.from(document.querySelectorAll('[data-rca-card]')) as HTMLElement[]
        const images: string[] = []
        for (const card of cards) {
          try {
            const canvas = await html2canvas(card, { 
              backgroundColor: '#1a1a2e',
              scale: 2,
              logging: false,
              useCORS: true
            })
            images.push(canvas.toDataURL('image/png'))
          } catch { /* skip failed cards */ }
        }

        const res = await fetch('/api/export/word', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversation_id: conversationId, chart_images: images }),
        })
        if (!res.ok) { alert('Export failed'); return }
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = res.headers.get('Content-Disposition')?.split('filename="')[1]?.replace('"', '') || 'RCA_Report.docx'
        a.click()
        URL.revokeObjectURL(url)
      } catch (e) { console.error('[ChatPage] export_docx failed:', e); alert('Export failed') } // intentional: client component, Pino is server-only
      return
    }

    if (action.id === 'export_pdf') {
      try {
        const res = await fetch('/api/export/pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversation_id: conversationId }),
        })
        if (!res.ok) { alert('PDF export failed'); return }
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = res.headers.get('Content-Disposition')?.split('filename="')[1]?.replace('"', '') || 'RCA_Report.pdf'
        a.click()
        URL.revokeObjectURL(url)
      } catch (e) { console.error('[ChatPage] export_pdf failed:', e); alert('PDF export failed') } // intentional: client component, Pino is server-only
      return
    }

    if (action.id === 'mark_complete') {
      send('Mark all corrective actions in this analysis as complete and confirm.')
      return
    }

    if (action.id === 'share') {
      const url = `${window.location.origin}/chat?conv=${conversationId}`
      await navigator.clipboard.writeText(url).catch(() => {})
      alert('Link copied to clipboard')
      return
    }

    // Unknown action — route back to Claude as a follow-up message
    send(action.label)
  }

  // Data-aware "next best view" chip: re-runs the analysis scoped to produce ONLY
  // the chosen renderer, using the data already established in this conversation.
  // Because the model only suggested views it can fully populate (see the
  // suggested_views rules), the follow-up reliably renders a populated diagram.
  function handleView(renderer: string, label: string) {
    const viewNames: Record<string, string> = {
      pareto: 'Pareto chart', breakdown: '6M breakdown', subcause: 'sub-cause breakdown',
      fishbone: 'fishbone (Ishikawa) diagram', five_whys: '5 Whys', cap: 'corrective action plan',
      spc: 'SPC control chart', fault_tree: 'fault tree', '8d': '8D report',
      trend: 'trend chart', scatter: 'correlation scatter', timeline: 'event timeline',
      fmea: 'FMEA', comparison: 'comparison table', capability: 'process capability (Cpk) analysis',
      oee_waterfall: 'OEE loss waterfall',
    }
    const name = viewNames[renderer] || label
    send(`Render a ${name} for the analysis above, using the data already established in this conversation. Output only that structured view.`)
  }

    async function send(text: string) {
    if (!text.trim() || streaming) return
    let cid = activeId
    const isFirstMsg = (convs.find(c => c.id === cid)?.messages.length ?? 0) === 0
    const newTitle = isFirstMsg ? text.slice(0, 42) : undefined
    setConvs(p => p.map(c => {
      if (c.id !== cid) return c
      return { ...c, title: isFirstMsg ? text.slice(0, 42) : c.title, messages: [...c.messages, { role: 'user', content: text }, { role: 'assistant', content: '', tools: [], startedAt: Date.now() }] }
    }))
    setInput(''); setStreaming(true)
    if (taRef.current) { taRef.current.style.height = 'auto' }
    const history = [...(active?.messages || []), { role: 'user' as const, content: text }]
    try {
      // Build system prompt — inform the model of the pinned scope. This is now
      // backed by HARD server-side enforcement (allowed_sources below): calls to
      // other sources are rejected, so tell the model plainly rather than as a
      // soft preference.
      const pinnedNote = pinnedSources.length > 0
        ? '\n\nThe user has scoped this chat to these data sources: ' +
          pinnedSources.map(s => `"${s.label}" (id: ${s.id})`).join(', ') +
          '. Only these sources are available — queries to any other source will be rejected. Work exclusively within this scope; if a question needs a source outside it, say so and ask the user to add it.'
        : ''
      abortRef.current = new AbortController()
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          messages: history.map(m => ({ role: m.role, content: m.content })),
          system: systemPrompt + pinnedNote,
          model,
          conversation_id: cid.startsWith('local-') ? null : cid,
          title: newTitle || convs.find(c => c.id === cid)?.title,
          // Hard scope: when the user has pinned sources, send their ids so the
          // server restricts tool calls to them (not just the prompt hint above).
          allowed_sources: pinnedSources.map(s => s.id),
          // Uploaded files for this turn: images (native vision) + documents
          // (extracted to text server-side). Sent once with the message.
          attachments: attachments.map(a => ({ name: a.name, type: a.type, data: a.data })),
        }),
      })
      // Attachments are consumed by this turn — clear them so they don't re-send.
      if (attachments.length > 0) setAttachments([])
      if (!res.ok) throw new Error((await res.json()).error || 'Request failed')
      const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = ''
      while (true) {
        const { done, value } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n\n'); buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const e = JSON.parse(line.slice(6))
            if (e.type === 'conv_id' && e.id && cid !== e.id) {
              // Server created a new DB conversation -- swap local temp id for real UUID.
              // Bug 4.3 has two parts:
              //  (a) reassign cid so subsequent updateLast(cid, ...) calls in
              //      this stream loop target the renamed conversation;
              //  (b) capture cid into a local const BEFORE scheduling the
              //      setConvs setter — JS closures capture by reference, so if
              //      we used `cid` directly inside the setter callback it would
              //      see the value AFTER the reassignment on the line below.
              const oldId = cid
              const newId = e.id
              setConvs(p => p.map(c => c.id === oldId ? { ...c, id: newId } : c))
              setActiveId(newId)
              cid = newId
            }
            else if (e.type === 'text') updateLast(cid, m => ({ ...m, content: m.content + e.text }))
            else if (e.type === 'intermediate_text') updateLast(cid, m => ({ ...m, narration: (m.narration || '') + e.text }))
            else if (e.type === 'tool_start') updateLast(cid, m => ({ ...m, tools: [...(m.tools || []), { name: e.name, input: e.input }] }))
            else if (e.type === 'tool_result') {
              updateLast(cid, m => {
                const tools = [...(m.tools || [])]
                for (let i = tools.length - 1; i >= 0; i--) { if (tools[i].name === e.name && tools[i].result === undefined) { tools[i] = { ...tools[i], result: e.result }; break } }
                return { ...m, tools }
              })
              // Auto-open a produced map in the right panel.
              if (e.name === 'render_map' && e.result && (e.result as { kind?: string }).kind === 'map_artifact') setPanel({ kind: 'map', map: e.result as MapData })
            }
            // -- Deep research live events --
            else if (e.type === 'research_started') { setResearch({ mode: e.mode === 'diagnose' ? 'diagnose' : 'research', question: String(e.question || ''), phase: 'planning', subtasks: [] }); setPanel({ kind: 'research' }) }
            else if (e.type === 'research_plan') {
              const subs = (Array.isArray(e.subtasks) ? e.subtasks : []) as Array<{ id: string; title: string; brief?: string }>
              setResearch(r => ({ mode: e.mode === 'diagnose' ? 'diagnose' : (r?.mode || 'research'), question: String(e.question || r?.question || ''), phase: 'researching', subtasks: subs.map(s => ({ id: s.id, title: s.title, brief: s.brief, status: 'queued' as const })) }))
              setPanel({ kind: 'research' })
            }
            else if (e.type === 'subagent_status') setResearch(r => r ? ({ ...r, subtasks: r.subtasks.map(s => s.id === e.id ? { ...s, status: (e.status as ResearchSubtask['status']) || s.status, tool: e.tool as string | undefined } : s) }) : r)
            else if (e.type === 'subagent_result') setResearch(r => r ? ({ ...r, subtasks: r.subtasks.map(s => s.id === e.id ? { ...s, status: 'done', tool: undefined, summary: e.summary as string, headline: typeof e.headline === 'string' ? e.headline : undefined, bullets: Array.isArray(e.bullets) ? (e.bullets as string[]) : undefined, links: Array.isArray(e.links) ? (e.links as Array<{ title: string; url: string }>) : undefined, sources: Number(e.sources) || 0, toolCalls: Number(e.toolCalls) || 0, error: e.error as string | undefined, verdict: e.verdict as ResearchSubtask['verdict'], confidence: typeof e.confidence === 'number' ? e.confidence : undefined } : s) }) : r)
            else if (e.type === 'research_synthesizing') setResearch(r => r ? ({ ...r, phase: 'synthesizing' }) : r)
            else if (e.type === 'research_done') setResearch(r => r ? ({ ...r, phase: 'done', sourceCount: Number(e.sourceCount) || 0, subagentCount: Number(e.subagentCount) || r.subtasks.length, ms: Number(e.ms) || undefined, causes: Array.isArray(e.causes) ? e.causes as DiagCause[] : r.causes, checks: Array.isArray(e.checks) ? (e.checks as string[]) : r.checks }) : r)
            else if (e.type === 'error') updateLast(cid, m => ({ ...m, content: 'Error: ' + e.message }))
          } catch {}
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        updateLast(cid, m => ({ ...m, content: m.content || 'Error: ' + (err instanceof Error ? err.message : 'Something went wrong') }))
      }
    }
    finally {
      abortRef.current = null
      // Parse and strip <rca_output> block from the final assistant message
      setConvs(p => p.map(c => {
        if (c.id !== cid && c.id !== activeId) return c
        const msgs = [...c.messages]
        const last = msgs[msgs.length - 1]
        if (last?.role === 'assistant' && last.content) {
          const { text, rca } = parseRcaOutput(last.content)
          msgs[msgs.length - 1] = { ...last, content: text, ...(rca ? { rca, actions: rca.actions, suggestedViews: rca.suggested_views } : {}) }
        }
        return { ...c, messages: msgs }
      }))
      setStreaming(false)
    }
  }

  async function signOut() {
    await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'signout' }) })
    router.push('/login')
  }

  function selectMention(src: DataSource) {
    // Replace the @filter text with the source label, add to pinned
    const cursor = taRef.current?.selectionStart || input.length
    const textBefore = input.slice(0, cursor)
    const atIdx = textBefore.lastIndexOf('@')
    const newInput = input.slice(0, atIdx) + input.slice(cursor)
    setInput(newInput)
    setMentionOpen(false)
    setMentionFilter('')
    // Pin this source for the conversation
    setPinnedSources(prev => prev.find(s => s.id === src.id) ? prev : [...prev, src])
    setTimeout(() => taRef.current?.focus(), 0)
  }

  function removePinned(id: string) {
    setPinnedSources(prev => prev.filter(s => s.id !== id))
  }

  function sourceIcon(src: DataSource) {
    if (src.type === 'airbyte') return (
      <svg width="12" height="12" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><polygon points="11,2 14,8 20,9 16,14 17,20 11,17 5,20 6,14 2,9 8,8"/></svg>
    )
    if (src.type === 'api') return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><rect x="1" y="3" width="10" height="6" rx="1.5"/><path d="M3 6h2M7 6h2"/></svg>
    )
    if (src.type === 'file_server') return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M1 3.5l1-1.5h3l1 1.5h4V10H1z"/></svg>
    )
    if (src.type === 'prism') return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M6 1L1 10h10z"/></svg>
    )
    if (src.type === 'mcp') return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="6" cy="3" r="1.5"/><circle cx="2.5" cy="9" r="1.5"/><circle cx="9.5" cy="9" r="1.5"/><path d="M6 4.5v2M5 7.5L3.5 8M7 7.5L8.5 8"/></svg>
    )
    const d = (src.dialect || '').toLowerCase()
    if (d === 'influxdb') return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M1 9l3-4 2.5 2 3-5 2.5 3"/></svg>
    )
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><ellipse cx="6" cy="4" rx="4" ry="1.5"/><path d="M2 4v4c0 .8 1.8 1.5 4 1.5s4-.7 4-1.5V4"/></svg>
    )
  }

  const isLastStreaming = (i: number) => streaming && i === active.messages.length - 1

  const toolLabel: Record<string, string> = { web_search: ' Web search', query_database: ' Database query', call_api: ' API call' }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>

      {showUpdate && <UpdateModal deploy={deploy} onClose={() => setShowUpdate(false)} />}
      {/* -- Sidebar -- */}
      <div style={{ width: sidebarCollapsed ? 56 : 240, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRight: '1px solid var(--border)', transition: 'width .2s ease', overflow: 'hidden' }}>

        {/* Logo — extra top padding so the wordmark clears the window's top edge /
            macOS traffic-light title bar in the Electron desktop app. */}
        <div style={{ padding: '28px 16px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minWidth: 0 }}>
          {!sidebarCollapsed && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, overflow: 'hidden' }}>
              <span style={{ fontFamily: 'var(--font-serif)', fontSize: 20, color: 'var(--text)', whiteSpace: 'nowrap' }}>Mosaic</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: sidebarCollapsed ? 'auto' : 0, marginRight: sidebarCollapsed ? 'auto' : 0 }}>
            {!sidebarCollapsed && (
              <button onClick={newConv} title="New conversation"
                style={{ width: 28, height: 28, borderRadius: 'var(--radius-pill)', border: '1px solid var(--border2)', background: 'var(--bg)', cursor: 'pointer', fontSize: 16, color: 'var(--text2)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow)', lineHeight: 1 }}>+</button>
            )}
            <button onClick={() => setSidebarCollapsed(s => !s)} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              style={{ width: 28, height: 28, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border2)', background: 'var(--bg)', cursor: 'pointer', color: 'var(--text3)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow)' }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" style={{ transform: sidebarCollapsed ? 'scaleX(-1)' : 'none', transition: 'transform .2s' }}>
                <rect x="1" y="1" width="12" height="12" rx="2"/>
                <line x1="5" y1="1" x2="5" y2="13"/>
                <path d="M3 5l-1.5 2 1.5 2" strokeWidth="1.2"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Primary nav */}
        <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
          {([ 
            { label: 'Chats',         href: null,              active: true,  icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M12 1H2a1 1 0 00-1 1v7a1 1 0 001 1h1v3l3-3h6a1 1 0 001-1V2a1 1 0 00-1-1z"/></svg> },
            { label: 'Dashboards',    href: '/dashboards',     active: false, icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><rect x="1" y="7" width="4" height="6" rx="1"/><rect x="5.5" y="4" width="4" height="9" rx="1"/><rect x="10" y="1" width="3" height="12" rx="1"/></svg> },
            { label: 'Reports',       href: '/reports',        active: false, icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 1h7l3 3v9a1 1 0 01-1 1H2a1 1 0 01-1-1V2a1 1 0 011-1z"/><path d="M9 1v3h3M4 6h6M4 8.5h6M4 11h4"/></svg> },
            { label: 'Query Builder', href: '/query-builder',  active: false, icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="2" width="12" height="10" rx="1.5"/><path d="M4 5.5l2 2-2 2M8 9.5h2.5"/></svg> },
            { label: 'Rules',         href: '/rules',          active: false, icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 4h10M2 7h7M2 10h8"/><circle cx="12" cy="10" r="1.5" fill="currentColor" stroke="none"/></svg> },
          ] as { label: string; href: string | null; active: boolean; enterpriseOnly?: boolean; icon: React.ReactNode }[])
            .filter(item => !(deploy.edition === 'personal' && item.enterpriseOnly))
            .map(item => (
            <button key={item.label}
              onClick={() => item.href ? router.push(item.href) : undefined}
              title={sidebarCollapsed ? item.label : undefined}
              style={{ width: '100%', padding: '7px 10px', background: item.active ? 'var(--bg3)' : 'none', border: `1px solid ${item.active ? 'var(--border2)' : 'transparent'}`, borderRadius: 'var(--radius-sm)', cursor: item.href ? 'pointer' : 'default', fontSize: 12, color: item.active ? 'var(--text)' : 'var(--text2)', fontWeight: item.active ? 500 : 400, textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: sidebarCollapsed ? 'center' : 'flex-start', gap: 7, fontFamily: 'inherit', transition: 'background .12s', marginBottom: 1 }}
              onMouseEnter={e => { if (!item.active) e.currentTarget.style.background = 'var(--bg3)' }}
              onMouseLeave={e => { if (!item.active) e.currentTarget.style.background = 'none' }}>
              <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{item.icon}</span>
              {!sidebarCollapsed && item.label}
            </button>
          ))}
        </div>

        {/* Conversations */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {sidebarCollapsed ? (
            <button onClick={newConv} title="New conversation"
              style={{ width: '100%', padding: '8px 0', background: 'none', border: '1px solid transparent', borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: 'var(--text3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M7 2v10M2 7h10"/></svg>
            </button>
          ) : (
            <>
              <div style={{ position: 'relative', marginBottom: 6 }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text4)', pointerEvents: 'none' }}><circle cx="5" cy="5" r="3.5"/><path d="M8 8l2 2"/></svg>
                <input value={convSearch} onChange={e => setConvSearch(e.target.value)} placeholder="Search chats..."
                  style={{ width: '100%', padding: '6px 8px 6px 26px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--text)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                {convSearch && (
                  <button onClick={() => setConvSearch('')} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text4)', padding: 0, display: 'flex' }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 2l6 6M8 2l-6 6"/></svg>
                  </button>
                )}
              </div>
              {convs.filter(conv => !convSearch || conv.title.toLowerCase().includes(convSearch.toLowerCase())).map(conv => (
                <div key={conv.id} onClick={() => setActiveId(conv.id)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', marginBottom: 2, background: conv.id === activeId ? 'var(--bg3)' : 'transparent', border: `1px solid ${conv.id === activeId ? 'var(--border2)' : 'transparent'}`, transition: 'background .12s' }}>
                  <span style={{ fontSize: 12, color: conv.id === activeId ? 'var(--text)' : 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{conv.title}</span>
                  <button onClick={e => delConv(conv.id, e)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text4)', fontSize: 14, paddingLeft: 6, flexShrink: 0, opacity: 0 }} className="conv-del-btn">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 2l6 6M8 2l-6 6"/></svg>
                  </button>
                </div>
              ))}
            </>
          )}
        </div>

        {/* User + theme */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: sidebarCollapsed ? 'center' : 'space-between', gap: 8 }}>
          <div style={{ position: 'relative', flex: sidebarCollapsed ? 'none' : 1 }}>
            <button onClick={() => setShowUserMenu(v => !v)} title={sidebarCollapsed ? user.name : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', width: '100%' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg4)', border: '1px solid var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text2)', flexShrink: 0 }}>
                {user.name.slice(0, 2).toUpperCase()}
              </div>
              {!sidebarCollapsed && (
                <div style={{ textAlign: 'left', overflow: 'hidden', flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.role}</div>
                  {deploy.updateAvailable ? (
                    <button onClick={e => { e.stopPropagation(); setShowUpdate(true) }}
                      title={`Version ${deploy.latestVersion} is available`}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 3, padding: '1px 8px', borderRadius: 'var(--radius-pill)', background: 'var(--blue-bg, #eff6ff)', border: '1px solid var(--blue-t)', color: 'var(--blue-t)', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.6 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--blue-t)', display: 'inline-block' }} />
                      Update to v{deploy.latestVersion}
                    </button>
                  ) : (
                    <div style={{ fontSize: 10, color: 'var(--text4)' }}>v{deploy.currentVersion || APP_VERSION}</div>
                  )}
                </div>
              )}
            </button>
            {showUserMenu && (
              <>
                <div onClick={() => setShowUserMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                <div style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', padding: 6, width: 200, zIndex: 50 }}>
                  <div style={{ padding: '8px 10px', fontSize: 12, borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
                    <div style={{ fontWeight: 500, color: 'var(--text)', marginBottom: 1 }}>{user.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{user.email}</div>
                  </div>
                  {[
                    { label: ' Settings', action: () => { setShowUserMenu(false); router.push('/settings') } },
                    { label: ' Sign out', action: () => { setShowUserMenu(false); signOut() } },
                  ].map(item => (
                    <button key={item.label} onClick={item.action}
                      style={{ width: '100%', padding: '8px 10px', background: 'none', border: 'none', fontSize: 12, color: 'var(--text2)', cursor: 'pointer', textAlign: 'left', borderRadius: 'var(--radius-sm)', fontFamily: 'inherit' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                      {item.label}
                    </button>
                  ))}
                  <div style={{ padding: '7px 10px', borderTop: '1px solid var(--border)', marginTop: 4, fontSize: 10, color: 'var(--text4)' }}>
                    Mosaic v{APP_VERSION} · ugx.ai
                  </div>
                </div>
              </>
            )}
          </div>
          {!sidebarCollapsed && <ThemeToggle />}
        </div>
      </div>

      {/* -- Main -- */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        <SetupBanner isAdmin={user.role === 'admin'} />

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '32px 0' }}>
          <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 32px' }}>
            {active.messages.length === 0 ? (
              <div className="fade-in">
                <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 28, fontWeight: 400, color: 'var(--text)', marginBottom: 8 }}>What can I help with?</h1>
                <p style={{ fontSize: 14, color: 'var(--text3)', marginBottom: 24 }}>Web search · Database & API queries · Industrial AI</p>


              </div>
            ) : (
              active.messages.map((msg, i) => (
                <div key={i} className="fade-in" style={{ marginBottom: 28 }}>
                  {/* Role label */}
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>
                    {msg.role === 'user' ? 'You' : 'Mosaic'}
                  </div>

                  {/* Phase indicator while streaming */}
                  {msg.role === 'assistant' && isLastStreaming(i) && (
                    <PhaseIndicator tools={msg.tools || []} hasText={!!msg.content} />
                  )}

                  {/* Tool calls — collapsed by default, expand on click */}
                  {((Array.isArray(msg.tools) && msg.tools.length > 0) || (msg.role === 'assistant' && isLastStreaming(i))) && (
                    <ToolCalls
                      tools={msg.tools || []}
                      msgIdx={i}
                      narration={msg.narration}
                      streaming={isLastStreaming(i)}
                      startedAt={msg.startedAt}
                      dataSources={dataSources}
                    />
                  )}

                  {/* Chart artifacts from render_chart tool calls */}
                  {Array.isArray(msg.tools) && msg.tools
                    .filter(t => t.name === 'render_chart' && t.result && typeof t.result === 'object' && (t.result as { kind?: string }).kind === 'chart_artifact')
                    .map((t, k) => <ChartArtifact key={k} spec={(t.result as { spec: import('@/lib/tools').ChartSpec }).spec} />)
                  }

                  {/* Files produced by run_code — download chips + inline images */}
                  {msg.role === 'assistant' && <GeneratedFiles files={collectGeneratedFiles(msg.tools)} onOpen={f => setPanel({ kind: 'file', file: f })} />}
                  {msg.role === 'assistant' && <MapChips maps={collectMapArtifacts(msg.tools)} onOpen={m => setPanel({ kind: 'map', map: m })} />}
                  {msg.role === 'assistant' && (() => {
                    // Reopen from the message's own persisted snapshot. While a run is
                    // still streaming its result isn't attached yet, so fall back to the
                    // live `research` state for the in-flight message.
                    const ws = workspaceFromMsg(msg.tools) || (streaming && Array.isArray(msg.tools) && msg.tools.some(t => (t.name === 'deep_research' || t.name === 'deep_diagnose') && t.result === undefined) ? research : null)
                    if (!ws) return null
                    return (
                      <div style={{ margin: '4px 0 12px' }}>
                        <button onClick={() => { setResearch(ws); setPanel({ kind: 'research' }) }} title={ws.mode === 'diagnose' ? 'Open diagnosis workspace' : 'Open research workspace'}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>
                          <span style={{ fontSize: 14, color: 'var(--accent-bg)' }}>{ws.mode === 'diagnose' ? '🩺' : '◎'}</span>
                          <span style={{ fontWeight: 600 }}>{ws.mode === 'diagnose' ? 'Diagnosis workspace' : 'Research workspace'}</span>
                          <span style={{ color: 'var(--text3)', fontSize: 11 }}>{ws.mode === 'diagnose' ? `${ws.causes?.length ?? 0} causes` : `${ws.subagentCount ?? ws.subtasks.length} agents · ${ws.sourceCount ?? 0} sources`}</span>
                        </button>
                      </div>
                    )
                  })()}

                  {/* Message bubble */}
                  {msg.role === 'user' ? (
                    <div style={{ display: 'inline-block', background: 'var(--bg4)', borderRadius: 'var(--radius)', padding: '10px 16px', fontSize: 14, color: 'var(--text)', lineHeight: 1.7, maxWidth: '80%' }}>
                      {msg.content}
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--text)' }} className="prose-mosaic">
                        <ReactMarkdown
                          components={{
                            p: ({children}) => <p style={{ margin: '0 0 10px', lineHeight: 1.8 }}>{children}</p>,
                            strong: ({children}) => <strong style={{ fontWeight: 600, color: 'var(--text)' }}>{children}</strong>,
                            ul: ({children}) => <ul style={{ margin: '6px 0 10px', paddingLeft: 20 }}>{children}</ul>,
                            ol: ({children}) => <ol style={{ margin: '6px 0 10px', paddingLeft: 20 }}>{children}</ol>,
                            li: ({children}) => <li style={{ margin: '3px 0', lineHeight: 1.7 }}>{children}</li>,
                            h1: ({children}) => <h1 style={{ fontSize: 18, fontWeight: 600, margin: '16px 0 8px', color: 'var(--text)' }}>{children}</h1>,
                            h2: ({children}) => <h2 style={{ fontSize: 16, fontWeight: 600, margin: '14px 0 6px', color: 'var(--text)' }}>{children}</h2>,
                            h3: ({children}) => <h3 style={{ fontSize: 14, fontWeight: 600, margin: '12px 0 4px', color: 'var(--text)' }}>{children}</h3>,
                            code: ({children}) => <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--bg3)', padding: '1px 5px', borderRadius: 3 }}>{children}</code>,
                            pre: ({children}) => <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', overflowX: 'auto', margin: '8px 0' }}>{children}</pre>,
                            blockquote: ({children}) => <blockquote style={{ borderLeft: '3px solid var(--border2)', paddingLeft: 12, margin: '8px 0', color: 'var(--text3)', fontStyle: 'italic' }}>{children}</blockquote>,
                            a: ({href, children}) => <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--blue-t)', textDecoration: 'none' }}>{children}</a>,
                            hr: () => <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '12px 0' }} />,
                          }}
                        >
                          {msg.rca ? (() => {
                            const lines = msg.content.split('\n')
                            let end = lines.length
                            while (end > 0) {
                              const line = lines[end - 1].trim()
                              if (line === '' || (line.length < 60 && !/[.!?:]$/.test(line) && !/^[A-Z].*[a-z]{3,}.*[.!?]/.test(line))) { end-- } else break
                            }
                            return lines.slice(0, end).join('\n').trim()
                          })() : msg.content}
                        </ReactMarkdown>
                        {isLastStreaming(i) && (
                          <span style={{ display: 'inline-block', width: 2, height: 16, background: 'var(--text)', marginLeft: 2, verticalAlign: 'middle', animation: 'blink 1s step-end infinite', borderRadius: 1 }} />
                        )}
                      </div>
                      {msg.rca && <RcaRenderer block={msg.rca} />}
                    </>
                  )}

                  {/* Data-aware "next best view" chips — offer a structured view the
                      model has the data to populate, on one tap. Distinct styling
                      (accent tint + chart icon) from the generic follow-up actions. */}
                  {msg.role === 'assistant' && i === active.messages.length - 1 && !streaming && msg.content && msg.suggestedViews && msg.suggestedViews.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                      {msg.suggestedViews.slice(0, 2).map(v => (
                        <button key={v.renderer} onClick={() => handleView(v.renderer, v.label)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 13px', border: '1px solid var(--blue-t)', borderRadius: 'var(--radius-pill)', background: 'var(--blue-bg, #eff6ff)', fontSize: 12, color: 'var(--blue-t)', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'opacity .12s' }}
                          onMouseEnter={e => (e.currentTarget.style.opacity = '0.82')}
                          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2 13h12M4 13V8M8 13V4M12 13V6"/></svg>
                          {v.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Follow-up suggestions + RCA action buttons */}
                  {msg.role === 'assistant' && i === active.messages.length - 1 && !streaming && msg.content && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
                      {(msg.actions && msg.actions.length > 0 ? msg.actions : [
                          {id:'go_deeper',label:'Go deeper'},
                          {id:'simplify',label:'Simplify this'},
                          {id:'examples',label:'Give examples'},
                          {id:'what_next',label:'What next?'}
                        ]).map(action => (
                          <button key={action.id} onClick={() => handleAction(action, active.id)}
                            style={{ padding: '5px 13px', border: '1px solid var(--border2)', borderRadius: 'var(--radius-pill)', background: 'var(--surface)', fontSize: 12, color: 'var(--text2)', cursor: 'pointer', fontFamily: 'inherit', boxShadow: 'var(--shadow)', transition: 'background .12s' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'var(--surface)')}>
                            {action.label}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input bar */}
        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)', padding: '14px 24px 18px', flexShrink: 0 }}>
          <div style={{ maxWidth: 720, margin: '0 auto', position: 'relative' }}>
            {/* Pinned source + attachment chips */}
            {(pinnedSources.length > 0 || attachments.length > 0) && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {pinnedSources.map(src => (
                  <span key={src.id} title="Scoped source — the chat is restricted to the selected sources; queries to others are blocked" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 'var(--radius-pill)', background: 'var(--accent-bg)', color: 'var(--accent-fg)', fontSize: 11, fontWeight: 600 }}>
                    <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.9 }}><rect x="2.5" y="6.5" width="9" height="6" rx="1"/><path d="M4.5 6.5V4.5a2.5 2.5 0 0 1 5 0v2"/></svg>
                    {src.label}
                    <button onClick={() => removePinned(src.id)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1, opacity: 0.7 }}>×</button>
                  </span>
                ))}
                {attachments.map((a, i) => (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 'var(--radius-pill)', background: 'var(--bg3)', border: '1px solid var(--border)', fontSize: 11, fontWeight: 500, color: 'var(--text2)' }}>
                    {a.preview
                      ? <img src={a.preview} style={{ width: 16, height: 16, borderRadius: 2, objectFit: 'cover' }} alt="" />
                      : <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 1h5l3 3v7H2V1z"/><path d="M7 1v3h3"/></svg>
                    }
                    {a.name.slice(0, 20)}{a.name.length > 20 ? '…' : ''}
                    <button onClick={() => setAttachments(x => x.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1, opacity: 0.7 }}>×</button>
                  </span>
                ))}
              </div>
            )}

            {/* @ Mention dropdown — Option 3 */}
            {mentionOpen && (() => {
              const filtered = dataSources.filter(s => s.label.toLowerCase().includes(mentionFilter.toLowerCase()))
              return filtered.length > 0 ? (
                <div ref={mentionRef} style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', marginBottom: 8, maxHeight: 200, overflowY: 'auto', zIndex: 50 }}>
                  <div style={{ padding: '6px 12px', fontSize: 10, fontWeight: 700, color: 'var(--text4)', textTransform: 'uppercase', letterSpacing: '.07em', borderBottom: '1px solid var(--border)' }}>
                    Data sources
                  </div>
                  {filtered.map((src, i) => (
                    <button key={src.id} onClick={() => selectMention(src)}
                      style={{ width: '100%', padding: '9px 14px', background: i === mentionIdx ? 'var(--bg3)' : 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9, fontFamily: 'inherit' }}
                      onMouseEnter={() => setMentionIdx(i)}>
                      <div style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', flexShrink: 0 }}>
                        {sourceIcon(src)}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{src.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                          {src.type === 'db' ? `${src.dialect} · ${src.host}/${src.database_name}` : `API · ${src.service_label}`}
                        </div>
                      </div>
                      {pinnedSources.find(s => s.id === src.id) && (
                        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>Active</span>
                      )}
                    </button>
                  ))}
                </div>
              ) : null
            })()}
            {/* Hidden file input */}
            <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.csv,.xlsx,.xls,.txt,.docx,.pptx" style={{ display: 'none' }}
              onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />

            {/* + menu */}
            <div ref={plusRef} style={{ position: 'relative', marginBottom: 6 }}>
              {plusOpen && (
                <div style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 4, background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', minWidth: 220, zIndex: 100, overflow: 'hidden' }}>

                  <button onClick={() => { fileInputRef.current?.click(); setPlusOpen(false) }}
                    style={{ width: '100%', padding: '10px 14px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'inherit', fontSize: 13, color: 'var(--text)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 2h6l3 3v8H2V2z"/><path d="M8 2v3h3"/></svg>
                    Add files
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text4)' }}>image · pdf · csv</span>
                  </button>

                  <div style={{ height: 1, background: 'var(--border)' }} />

                  <button onClick={() => setPlusSubmenu(s => s === 'sources' ? null : 'sources')}
                    style={{ width: '100%', padding: '10px 14px', background: plusSubmenu === 'sources' ? 'var(--bg3)' : 'none', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'inherit', fontSize: 13, color: 'var(--text)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
                    onMouseLeave={e => e.currentTarget.style.background = plusSubmenu === 'sources' ? 'var(--bg3)' : 'none'}>
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><ellipse cx="7.5" cy="4" rx="5" ry="2"/><path d="M2.5 4v3.5c0 1.1 2.2 2 5 2s5-.9 5-2V4"/><path d="M2.5 7.5V11c0 1.1 2.2 2 5 2s5-.9 5-2V7.5"/></svg>
                    Data sources
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" style={{ marginLeft: 'auto', transform: plusSubmenu === 'sources' ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}><path d="M3 2l4 3-4 3"/></svg>
                  </button>
                  {plusSubmenu === 'sources' && (() => {
                    const q = srcSearch.trim().toLowerCase()
                    const matches = (s: DataSource) => !q || s.label.toLowerCase().includes(q) || (s.service_label || '').toLowerCase().includes(q) || (s.host || '').toLowerCase().includes(q)
                    const cats = SOURCE_CATEGORIES
                      .map(c => ({ ...c, items: dataSources.filter(s => s.type === c.key && matches(s)) }))
                      .filter(c => c.items.length > 0)
                    const searching = q.length > 0
                    const toggleCat = (k: string) => setOpenCats(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
                    const total = dataSources.length
                    return (
                      <div style={{ background: 'var(--bg)', borderTop: '1px solid var(--border)' }}>
                        {/* search */}
                        <div style={{ padding: '8px 12px 8px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 8 }}>
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" style={{ color: 'var(--text4)', flexShrink: 0 }}><circle cx="5" cy="5" r="3.5"/><path d="M8 8l2.5 2.5"/></svg>
                            <input value={srcSearch} onChange={e => setSrcSearch(e.target.value)} placeholder={`Search ${total} sources…`} autoFocus
                              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 12.5, fontFamily: 'inherit' }} />
                            {srcSearch && <button onClick={() => setSrcSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text4)', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>}
                          </div>
                        </div>
                        <div style={{ maxHeight: 280, overflowY: 'auto', paddingBottom: 4 }}>
                          {total === 0 && <div style={{ padding: '8px 14px 8px 38px', fontSize: 12, color: 'var(--text4)' }}>No sources connected yet</div>}
                          {total > 0 && cats.length === 0 && <div style={{ padding: '8px 14px 8px 38px', fontSize: 12, color: 'var(--text4)' }}>No sources match &ldquo;{srcSearch}&rdquo;</div>}
                          {cats.map(cat => {
                            const open = searching || openCats.has(cat.key)
                            const pinnedInCat = cat.items.filter(s => pinnedSources.find(p => p.id === s.id)).length
                            return (
                              <div key={cat.key}>
                                <button onClick={() => toggleCat(cat.key)}
                                  style={{ width: '100%', padding: '7px 14px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'inherit' }}
                                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
                                  onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                                  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" style={{ color: 'var(--text4)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}><path d="M3 2l4 3-4 3"/></svg>
                                  <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{cat.label}</span>
                                  <span style={{ fontSize: 10.5, color: 'var(--text4)' }}>{cat.items.length}</span>
                                  {pinnedInCat > 0 && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>{pinnedInCat} active</span>}
                                </button>
                                {open && cat.items.map(src => {
                                  const isPinned = !!pinnedSources.find(s => s.id === src.id)
                                  return (
                                    <button key={src.id}
                                      onClick={() => { isPinned ? removePinned(src.id) : setPinnedSources(p => [...p, src]) }}
                                      style={{ width: '100%', padding: '7px 14px 7px 32px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'inherit', fontSize: 12, color: 'var(--text)' }}
                                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
                                      onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                                      {sourceIcon(src)}
                                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {src.label}
                                        {src.type === 'api' && src.service_label && <span style={{ color: 'var(--text4)', marginLeft: 6, fontSize: 11 }}>· {src.service_label}</span>}
                                      </span>
                                      {isPinned && <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" style={{ color: 'var(--green)', flexShrink: 0 }}><path d="M2 5.5l2.5 2.5 4.5-5"/></svg>}
                                    </button>
                                  )
                                })}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })()}

                  <button onClick={() => setPlusSubmenu(s => s === 'workflows' ? null : 'workflows')}
                    style={{ width: '100%', padding: '10px 14px', background: plusSubmenu === 'workflows' ? 'var(--bg3)' : 'none', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'inherit', fontSize: 13, color: 'var(--text)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
                    onMouseLeave={e => e.currentTarget.style.background = plusSubmenu === 'workflows' ? 'var(--bg3)' : 'none'}>
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><rect x="1" y="1" width="4" height="3" rx="1"/><rect x="1" y="11" width="4" height="3" rx="1"/><rect x="10" y="5.5" width="4" height="3" rx="1"/><line x1="3" y1="4" x2="3" y2="11"/><line x1="3" y1="7.5" x2="10" y2="7.5"/></svg>
                    RCA Workflows
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" style={{ marginLeft: 'auto', transform: plusSubmenu === 'workflows' ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}><path d="M3 2l4 3-4 3"/></svg>
                  </button>
                  {plusSubmenu === 'workflows' && (
                    <div style={{ background: 'var(--bg)', borderTop: '1px solid var(--border)' }}>
                      {workflows.length === 0
                        ? <div style={{ padding: '8px 14px 8px 38px', fontSize: 12, color: 'var(--text4)' }}>No active workflows</div>
                        : workflows.map(w => (
                          <button key={w.id}
                            onClick={() => { setInput(`Run the "${w.name}" RCA workflow on the connected data sources.`); setPlusOpen(false); setPlusSubmenu(null) }}
                            style={{ width: '100%', padding: '8px 14px 8px 38px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                            <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>{w.name}</div>
                            {w.description && <div style={{ fontSize: 11, color: 'var(--text4)', marginTop: 1 }}>{w.description.slice(0, 50)}</div>}
                          </button>
                        ))
                      }
                    </div>
                  )}

                  <div style={{ height: 1, background: 'var(--border)' }} />

                  <button style={{ width: '100%', padding: '10px 14px', background: 'none', border: 'none', textAlign: 'left', cursor: 'default', display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'inherit', fontSize: 13, color: 'var(--text3)' }}>
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="6.5" cy="6.5" r="4.5"/><path d="M10 10l3 3"/></svg>
                    Web search
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text4)' }}>always on</span>
                  </button>

                  <div style={{ height: 1, background: 'var(--border)' }} />

                  <button onClick={() => setPlusSubmenu(s => s === 'system' ? null : 'system')}
                    style={{ width: '100%', padding: '10px 14px', background: plusSubmenu === 'system' ? 'var(--bg3)' : 'none', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'inherit', fontSize: 13, color: 'var(--text)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
                    onMouseLeave={e => e.currentTarget.style.background = plusSubmenu === 'system' ? 'var(--bg3)' : 'none'}>
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><rect x="1" y="3" width="13" height="9" rx="1.5"/><path d="M4 7h7M4 10h4"/></svg>
                    System prompt
                    {systemPrompt && <span style={{ marginLeft: 4, width: 6, height: 6, borderRadius: '50%', background: 'var(--blue-t)', flexShrink: 0 }} />}
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" style={{ marginLeft: 'auto', transform: plusSubmenu === 'system' ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}><path d="M3 2l4 3-4 3"/></svg>
                  </button>
                  {plusSubmenu === 'system' && (
                    <div style={{ padding: '8px 14px', background: 'var(--bg)', borderTop: '1px solid var(--border)' }}>
                      <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={3}
                        placeholder="Custom instructions for this session..."
                        style={{ width: '100%', resize: 'none', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', fontSize: 12, color: 'var(--text)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                    </div>
                  )}

                  <button onClick={() => setPlusSubmenu(s => s === 'model' ? null : 'model')}
                    style={{ width: '100%', padding: '10px 14px', background: plusSubmenu === 'model' ? 'var(--bg3)' : 'none', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'inherit', fontSize: 13, color: 'var(--text)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
                    onMouseLeave={e => e.currentTarget.style.background = plusSubmenu === 'model' ? 'var(--bg3)' : 'none'}>
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="7.5" cy="7.5" r="5.5"/><path d="M7.5 5v2.5l1.5 1.5"/></svg>
                    Model
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text4)' }}>
                      {model === 'auto' ? 'Auto' : (availableModels.find(m => m.id === model)?.label || model || 'Model').replace(/^Claude\s+/, '')}
                    </span>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" style={{ transform: plusSubmenu === 'model' ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}><path d="M3 2l4 3-4 3"/></svg>
                  </button>
                  {plusSubmenu === 'model' && (
                    <div style={{ background: 'var(--bg)', borderTop: '1px solid var(--border)' }}>
                      <button key="auto"
                        onClick={() => { setModel('auto'); setPlusSubmenu(null) }}
                        style={{ width: '100%', padding: '8px 14px 8px 38px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'inherit' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: model === 'auto' ? 600 : 400 }}>Auto</div>
                          <div style={{ fontSize: 11, color: 'var(--text4)' }}>Optimal model per query — RCA stays on the strong model</div>
                        </div>
                        {model === 'auto' && <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M2 5.5l2.5 2.5 4.5-5"/></svg>}
                      </button>
                      {modelGroups.map(g => (
                        <div key={g.key}>
                          <div style={{ padding: '8px 14px 3px 38px', fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text4)' }}>{g.label}</div>
                          {g.models.map(m => (
                            <button key={m.id}
                              onClick={() => { setModel(m.id); setPlusSubmenu(null) }}
                              style={{ width: '100%', padding: '7px 14px 7px 38px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'inherit' }}
                              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
                              onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: model === m.id ? 600 : 400 }}>{m.label.replace(/^Claude\s+/, '')}</div>
                                <div style={{ fontSize: 11, color: 'var(--text4)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.id}</div>
                              </div>
                              {model === m.id && <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M2 5.5l2.5 2.5 4.5-5"/></svg>}
                            </button>
                          ))}
                        </div>
                      ))}
                      {availableModels.length === 0 && (
                        <div style={{ padding: '8px 14px 8px 38px', fontSize: 11, color: 'var(--text4)' }}>Loading models…</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-lg)', padding: '10px 12px', boxShadow: 'var(--shadow)' }}>
              <button onClick={() => { setPlusOpen(o => !o); setPlusSubmenu(null) }}
                style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border2)', background: plusOpen ? 'var(--bg3)' : 'var(--surface)', color: 'var(--text2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .12s' }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M7 2v10M2 7h10"/></svg>
              </button>
              <textarea ref={taRef} value={input}
                onChange={e => {
                  const val = e.target.value
                  setInput(val)
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'
                  // Detect @ mention
                  const cursor = e.target.selectionStart || 0
                  const textBefore = val.slice(0, cursor)
                  const atMatch = textBefore.match(/@(\w*)$/)
                  if (atMatch) {
                    setMentionFilter(atMatch[1])
                    setMentionOpen(true)
                    setMentionIdx(0)
                  } else {
                    setMentionOpen(false)
                  }
                }}
                onKeyDown={e => {
                  if (mentionOpen) {
                    const filtered = dataSources.filter(s => s.label.toLowerCase().includes(mentionFilter.toLowerCase()))
                    if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => Math.min(i+1, filtered.length-1)); return }
                    if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionIdx(i => Math.max(i-1, 0)); return }
                    if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault()
                      if (filtered[mentionIdx]) selectMention(filtered[mentionIdx])
                      return
                    }
                    if (e.key === 'Escape') { setMentionOpen(false); return }
                  }
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
                }}
                placeholder="Message... (Enter to send, Shift+Enter for new line)"
                rows={1}
                style={{ flex: 1, resize: 'none', background: 'transparent', border: 'none', outline: 'none', fontSize: 14, color: 'var(--text)', lineHeight: 1.6, fontFamily: 'inherit' }} />
              {streaming ? (
                <button onClick={() => abortRef.current?.abort()}
                  style={{ flexShrink: 0, width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'var(--bg4)', color: 'var(--text2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .15s' }}
                  title="Stop generating">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="2" width="8" height="8" rx="1.5"/></svg>
                </button>
              ) : (
                <button onClick={() => send(input)} disabled={!input.trim()}
                  style={{ flexShrink: 0, width: 34, height: 34, borderRadius: '50%', border: 'none', background: !input.trim() ? 'var(--bg4)' : 'var(--accent-bg)', color: !input.trim() ? 'var(--text4)' : 'var(--accent-fg)', cursor: !input.trim() ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .15s', boxShadow: !input.trim() ? 'none' : 'var(--shadow)' }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 7h10M8 3l4 4-4 4"/></svg>
                </button>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text4)', textAlign: 'center', marginTop: 8 }}>
              Mosaic may make mistakes. Verify important information.
            </div>
          </div>
        </div>
      </div>
      {panel?.kind === 'file' && <FilePreviewPanel file={panel.file} onClose={() => setPanel(null)} />}
      {panel?.kind === 'map' && <MapPanel map={panel.map} onClose={() => setPanel(null)} />}
      {panel?.kind === 'research' && research && <ResearchPanel research={research} onClose={() => setPanel(null)} />}
    </div>
  )
}

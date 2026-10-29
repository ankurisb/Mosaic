'use client'
import React from 'react'
import ChartArtifact from '@/components/ChartArtifact'
import SourceHealthCard, { type HealthData } from '@/components/SourceHealthCard'
import MapView from '@/components/MapArtifact'
import type { MapArtifact as MapData } from '@/lib/tools'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { SessionUser } from '@/lib/auth'
import ThemeToggle from './ThemeToggle'
import { APP_VERSION } from '@/lib/version'
import { UpdateModal } from '@/components/UpdateModal'
import RcaRenderer from './rca/RcaRenderer'
import PanelChart from './dashboards/PanelChart'
import ReactMarkdown from 'react-markdown'
import * as XLSX from 'xlsx'
import SetupBanner from './SetupBanner'
import { parseRcaOutput, KNOWN_ACTION_IDS } from '@/lib/rca'
import type { RcaBlock, RcaAction } from '@/lib/rca'
import {
  classifyAttachment, humanBytes, extOf, SUPPORTED_IMAGE_MIME,
  MAX_ATTACH_COUNT, MAX_DOC_BYTES, MAX_IMAGE_BYTES, MAX_IMAGE_EDGE, TARGET_IMAGE_JPEG_QUALITY,
} from '@/lib/attachment-limits'

// ── Client-side attachment preparation ──────────────────────────────────────
// Shrinks/transcodes images in the browser BEFORE upload so we never ship a
// full-res photo (which 400s Claude's vision API) or a HEIC file (which it
// can't read) or a multi-MB payload that stalls/resets the POST. Each failure
// becomes a visible error chip with a reason — never a silent drop.
type AttachStatus = 'pending' | 'ready' | 'error'
interface Attachment { id: string; name: string; type: string; data: string; preview?: string; status: AttachStatus; error?: string }

function readAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => { try { resolve((r.result as string).split(',')[1] || '') } catch { reject(new Error('read failed')) } }
    r.onerror = () => reject(new Error('the file could not be read'))
    r.onabort = () => reject(new Error('reading was interrupted'))
    r.readAsDataURL(blob)
  })
}

// Downscale an already-decoded bitmap to within MAX_IMAGE_EDGE and encode it.
function encodeBitmap(bmp: ImageBitmap, outType: 'image/jpeg' | 'image/png'): Promise<Blob> {
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('canvas unavailable'))
  if (outType === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h) } // flatten alpha for JPEG
  ctx.drawImage(bmp, 0, 0, w, h)
  return new Promise((res, rej) =>
    canvas.toBlob(b => b ? res(b) : rej(new Error('image could not be encoded')), outType,
      outType === 'image/jpeg' ? TARGET_IMAGE_JPEG_QUALITY : undefined))
}

// Produce an upload-ready {type,data,preview} for any image kind, or throw with
// a user-facing reason. GIFs are kept as-is (may be animated); PNGs that need
// shrinking stay PNG (crisp screenshots); everything else becomes JPEG.
async function prepareImage(file: File, kind: string): Promise<{ type: string; data: string; preview: string }> {
  const srcMime = (file.type || '').toLowerCase()
  const ext = extOf(file.name)
  const isGif = srcMime === 'image/gif' || ext === 'gif'
  if (isGif) {
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`GIF is ${humanBytes(file.size)}, over the ${humanBytes(MAX_IMAGE_BYTES)} limit — please resize it`)
    const data = await readAsBase64(file)
    return { type: 'image/gif', data, preview: `data:image/gif;base64,${data}` }
  }
  let bmp: ImageBitmap
  try { bmp = await createImageBitmap(file) }
  catch {
    if (kind === 'image-heic') throw new Error('this browser can’t read HEIC — re-send as JPEG or PNG (iPhone: share the photo, or Settings → Camera → Formats → “Most Compatible”)')
    throw new Error('this image couldn’t be decoded — convert it to JPEG or PNG and re-send')
  }
  const srcIsPng = kind === 'image-native' && (srcMime === 'image/png' || ext === 'png')
  const keepable = kind === 'image-native' && (srcIsPng
    || srcMime === 'image/jpeg' || ext === 'jpg' || ext === 'jpeg'
    || srcMime === 'image/webp' || ext === 'webp')
  const maxEdge = Math.max(bmp.width, bmp.height)
  // Already within both caps and a vision-native type → ship original bytes (no re-encode, full fidelity).
  if (keepable && maxEdge <= MAX_IMAGE_EDGE && file.size <= MAX_IMAGE_BYTES) {
    if (bmp.close) bmp.close()
    const data = await readAsBase64(file)
    const t = SUPPORTED_IMAGE_MIME.has(srcMime) ? srcMime : (srcIsPng ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg'))
    return { type: t, data, preview: `data:${t};base64,${data}` }
  }
  // Otherwise downscale/transcode.
  const outType: 'image/jpeg' | 'image/png' = srcIsPng ? 'image/png' : 'image/jpeg'
  let blob = await encodeBitmap(bmp, outType)
  if (blob.size > MAX_IMAGE_BYTES && outType === 'image/png') blob = await encodeBitmap(bmp, 'image/jpeg') // PNG still too big → JPEG
  if (bmp.close) bmp.close()
  if (blob.size > MAX_IMAGE_BYTES) throw new Error(`image is still ${humanBytes(blob.size)} after shrinking — crop or resize it and re-send`)
  const outMime = blob.type || outType
  const data = await readAsBase64(blob)
  return { type: outMime, data, preview: `data:${outMime};base64,${data}` }
}

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
interface MsgAttachment { name: string; type: string; preview?: string }
interface Message { role: 'user' | 'assistant'; content: string; tools?: ToolCall[]; rca?: RcaBlock; actions?: RcaAction[]; suggestedViews?: import('@/lib/rca').SuggestedView[]; narration?: string; startedAt?: number; dashboardProposal?: DashboardProposal; dashboardSaved?: { id: string; title: string }; attachments?: MsgAttachment[] }
interface Conv { id: string; title: string; messages: Message[]; folderId?: string | null; createdAt?: string; updatedAt?: string }
interface Folder { id: string; name: string; position?: number }

// True on phone-width viewports. Drives the mobile chat shell (drawer sidebar,
// full-screen panels, bottom-docked composer) without touching desktop.
function useIsMobile(breakpoint = 760): boolean {
  const [m, setM] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`)
    const on = () => setM(mq.matches)
    on(); mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [breakpoint])
  return m
}

// Persisted, clamped width for a resizable panel (localStorage-backed; falls
// back gracefully where storage is unavailable).
function usePersistentWidth(key: string, def: number, min: number, max: number): [number, (v: number) => void] {
  const [w, setW] = useState(def)
  useEffect(() => {
    try { const v = parseInt(localStorage.getItem(key) || '', 10); if (Number.isFinite(v)) setW(Math.min(max, Math.max(min, v))) } catch {}
  }, [key, min, max])
  const set = (v: number) => {
    const c = Math.min(max, Math.max(min, Math.round(v)))
    setW(c)
    try { localStorage.setItem(key, String(c)) } catch {}
  }
  return [w, set]
}

// A thin draggable divider sitting on `side` of its (position:relative) parent.
// dir=+1 → dragging right widens; dir=-1 → dragging left widens (left-edge
// handle on a right-docked panel).
function ResizeHandle({ width, setWidth, min, max, dir, side }: { width: number; setWidth: (v: number) => void; min: number; max: number; dir: 1 | -1; side: 'left' | 'right' }) {
  const start = (e: React.MouseEvent) => {
    e.preventDefault()
    const x0 = e.clientX, w0 = width
    const move = (ev: MouseEvent) => setWidth(Math.min(max, Math.max(min, w0 + dir * (ev.clientX - x0))))
    const up = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''; document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'
  }
  const style: React.CSSProperties = { position: 'absolute', top: 0, width: 7, height: '100%', cursor: 'col-resize', zIndex: 30, background: 'transparent', transition: 'background .12s' }
  style[side] = -3
  return (
    <div onMouseDown={start} title="Drag to resize"
      style={style}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-bg, var(--border2))')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')} />
  )
}

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
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--blue-t)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2 13h12M4 13V8M8 13V4M12 13V6"/></svg>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)' }}>{pretty}</span>
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: 'var(--blue-t)', background: 'rgba(37,99,235,0.1)', padding: '1px 6px', borderRadius: 999 }}>Computed</span>
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
type PanelItem = { kind: 'file'; file: GenFile } | { kind: 'map'; map: MapData } | { kind: 'research' } | { kind: 'dashboard_proposal'; proposal: DashboardProposal }

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

function FilePreviewPanel({ file, onClose, panelW, setPanelW, mobile }: { file: GenFile; onClose: () => void; panelW: number; setPanelW: (v: number) => void; mobile: boolean }) {
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
    <div style={mobile
      ? { position: 'fixed', inset: 0, zIndex: 120, width: '100%', display: 'flex', flexDirection: 'column', background: 'var(--surface)', height: '100dvh', paddingTop: 'var(--safe-top)' }
      : { width: panelW, minWidth: 320, flexShrink: 0, position: 'relative', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderLeft: '1px solid var(--border)', height: '100%' }}>
      {!mobile && <ResizeHandle width={panelW} setWidth={setPanelW} min={320} max={1100} dir={-1} side="left" />}
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
function MapPanel({ map, onClose, panelW, setPanelW, mobile }: { map: MapData; onClose: () => void; panelW: number; setPanelW: (v: number) => void; mobile: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div style={mobile
      ? { position: 'fixed', inset: 0, zIndex: 120, width: '100%', display: 'flex', flexDirection: 'column', background: 'var(--surface)', height: '100dvh', paddingTop: 'var(--safe-top)' }
      : { width: panelW, minWidth: 320, flexShrink: 0, position: 'relative', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderLeft: '1px solid var(--border)', height: '100%' }}>
      {!mobile && <ResizeHandle width={panelW} setWidth={setPanelW} min={320} max={1100} dir={-1} side="left" />}
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
function ResearchPanel({ research, onClose, panelW, setPanelW, mobile }: { research: ResearchState; onClose: () => void; panelW: number; setPanelW: (v: number) => void; mobile: boolean }) {
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
    if (dx && s.verdict) return s.verdict === 'supported' ? { bg: 'var(--amber-bg,var(--amber-bg))', c: 'var(--amber-t,var(--amber-t))', t: 'Likely' }
      : s.verdict === 'refuted' ? { bg: 'var(--bg3)', c: 'var(--text3)', t: 'Ruled out' }
      : { bg: 'var(--bg3)', c: 'var(--text3)', t: 'Inconclusive' }
    return { bg: 'var(--green-bg,var(--green-bg))', c: 'var(--green-t,var(--green-t))', t: 'Done' }
  }
  const pct = (c?: number) => Math.round((c ?? 0) * 100)
  return (
    <div style={mobile
      ? { position: 'fixed', inset: 0, zIndex: 120, width: '100%', display: 'flex', flexDirection: 'column', background: 'var(--surface)', height: '100dvh', paddingTop: 'var(--safe-top)' }
      : { width: panelW, minWidth: 320, flexShrink: 0, position: 'relative', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderLeft: '1px solid var(--border)', height: '100%' }}>
      {!mobile && <ResizeHandle width={panelW} setWidth={setPanelW} min={320} max={1100} dir={-1} side="left" />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{dx ? 'Diagnosis workspace' : 'Research workspace'}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{sub}{research.phase !== 'done' ? ` · ${pctRun}%` : ''}</div>
        </div>
        <button onClick={onClose} title="Close (Esc)" style={{ width: 28, height: 28, borderRadius: 'var(--radius-pill)', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text2)', cursor: 'pointer', fontSize: 15, lineHeight: 1, flexShrink: 0 }}>×</button>
      </div>
      {/* Overall progress bar */}
      <div style={{ height: 3, background: 'var(--bg3)', flexShrink: 0 }} role="progressbar" aria-valuenow={pctRun} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ height: '100%', width: `${pctRun}%`, background: research.phase === 'done' ? 'var(--green-t,var(--green-t))' : 'var(--accent-bg)', transition: 'width .4s ease' }} />
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
                    <div style={{ flex: 1, height: 4, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}><div style={{ height: '100%', width: `${pct(s.confidence)}%`, background: s.verdict === 'supported' ? 'var(--amber-t,var(--amber-t))' : 'var(--text3)' }} /></div>
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

// ── Dashboard proposal (chat-native builder) ────────────────────────────────
interface ProposalPanel {
  intent?: string; title: string; subtitle?: string
  source_type: string; source_id: string; query: string
  chart_type: string; chart_config?: Record<string, unknown>
  suggested_grid?: { col: number; row: number; w: number; h: number }
  validation: { cls: 'data' | 'empty' | 'error' | 'invalid'; rows: number; detail?: string; sample?: unknown[]; needsEntity?: boolean }
  readiness?: { ready: boolean; gaps: string[] }
}
interface DashboardProposal {
  title: string; description?: string
  panels: ProposalPanel[]
  summary: { data: number; empty: number; error: number; invalid: number; total: number }
  suggested_window?: string
  entity?: { source_type?: string; source_id?: string; kind?: string; key_field?: string; label_field?: string | null; table?: string | null; default?: string[] }
  readiness?: { allReady: boolean; readyCount: number; total: number; gaps: { panel: string; gaps: string[] }[] }
}
const PROPOSAL_CHART_TYPES = ['bar', 'line', 'area', 'table', 'stat', 'donut', 'gauge', 'heatmap', 'boxplot', 'sankey']

// Read-only live render of a saved dashboard, shown inside the review drawer so the
// user sees the actual charts (not just a "saved" line) alongside "Open dashboard".
// Fetches the same /data endpoint the full dashboard uses and stacks each panel in a
// single column sized to the drawer; no edit/resize/reorder affordances.
function ProposalSavedPreview({ id, window }: { id: string; window?: string }) {
  const [panels, setPanels] = useState<Array<Record<string, unknown>>>([])
  const [results, setResults] = useState<Record<string, { ok: boolean; data?: unknown; error?: string; latency_ms: number }>>({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/dashboards/${id}/data?time_window=${window || 'all'}`)
        const d = await r.json()
        if (cancelled) return
        if (!r.ok) { setErr(d.error || 'Could not load preview'); return }
        setPanels(d.panels || [])
        const map: Record<string, { ok: boolean; data?: unknown; error?: string; latency_ms: number }> = {}
        for (const res of (d.results || [])) map[res.panel_id] = res
        setResults(map)
      } catch (e) { if (!cancelled) setErr(e instanceof Error ? e.message : 'Preview failed') }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [id, window])
  if (loading) return <div style={{ fontSize: 12, color: 'var(--text3)', padding: '8px 0' }}>Loading preview…</div>
  if (err) return <div style={{ fontSize: 12, color: 'var(--amber-t, #b4690e)', padding: '8px 0' }}>Preview unavailable: {err}</div>
  if (!panels.length) return null
  const noop = () => {}
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
      {panels.map(p => (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <PanelChart key={String(p.id)} panel={p as any} result={results[String(p.id)]} isOwner={false} onEdit={noop} onDelete={noop} onRefresh={noop} />
      ))}
    </div>
  )
}

// Live-preview proposal card: each tile shows the panel's validation verdict and a
// real sample of rows. The user includes/excludes, edits the query/chart/title, then
// saves — persisting via the existing create_dashboard / add_panel actions. Preview
// is exactly the query that gets saved (bounded only for the dry-run).
function DashboardProposalCard({ proposal, onOpen, onSaved, embedded }: { proposal: DashboardProposal; onOpen: (id: string) => void; onSaved?: (id: string, title: string) => void; embedded?: boolean }) {
  // A panel is "ready" per the readiness gate when present; otherwise fall back to the
  // old executability heuristic (data/empty) for proposals that predate the gate.
  const panelReady = (p: { readiness?: { ready: boolean }; validation: { cls: string } }) =>
    p.readiness ? p.readiness.ready : (p.validation.cls === 'data' || p.validation.cls === 'empty')
  // The whole dashboard is blocked from saving until EVERY panel is ready — the chat is the
  // single deterministic path to a buildable dashboard (source-agnostic: PRISM, SQL, API…).
  const planBlocked = proposal.readiness ? !proposal.readiness.allReady : false
  const [panels, setPanels] = useState(() => proposal.panels.map(p => ({
    ...p, include: panelReady(p), expanded: false,
  })))
  const [title, setTitle] = useState(proposal.title)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const clsStyle = (cls: string): { bg: string; fg: string; label: string } => {
    if (cls === 'data') return { bg: 'var(--pass-bg, rgba(31,138,82,.12))', fg: 'var(--green-t, #1f8a52)', label: 'data' }
    if (cls === 'empty') return { bg: 'var(--amber-bg, rgba(180,105,14,.12))', fg: 'var(--amber-t, #b4690e)', label: 'empty' }
    if (cls === 'invalid') return { bg: 'var(--bg3)', fg: 'var(--text3)', label: 'invalid' }
    return { bg: 'var(--red-bg, rgba(220,38,38,.1))', fg: 'var(--red-t, #dc2626)', label: 'error' }
  }
  const set = (i: number, patch: Partial<(typeof panels)[number]>) => setPanels(ps => ps.map((p, j) => j === i ? { ...p, ...patch } : p))
  const includedCount = panels.filter(p => p.include).length

  async function save() {
    if (planBlocked) { setErr('This dashboard isn’t ready to build yet — resolve the gaps in chat and I’ll rebuild it.'); return }
    setSaving(true); setErr('')
    try {
      // Defensive: never persist a not-ready panel even if a stale include slipped through.
      const chosen = panels.filter(p => p.include && panelReady(p))
      if (!chosen.length) throw new Error('Include at least one ready panel')
      const cr = await fetch('/api/dashboards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create_dashboard', name: title.trim() || 'New dashboard', description: proposal.description || '', default_time_window: proposal.suggested_window }) })
      const cd = await cr.json()
      if (!cr.ok) throw new Error(cd.error || 'Could not create dashboard')
      const id = cd.id as string
      let order = 0
      for (const p of chosen) {
        const g = p.suggested_grid || { col: (order % 2) * 6, row: Math.floor(order / 2), w: 6, h: 1 }
        // The grid is 12 columns; scale any width that looks like the old 4-column
        // scale (≤4) so a planner-supplied grid doesn't render a sliver.
        const gw = g.w <= 4 ? g.w * 3 : g.w
        const r = await fetch('/api/dashboards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          action: 'add_panel', dashboard_id: id, title: p.title, subtitle: p.subtitle || '',
          source_type: p.source_type, source_id: p.source_id, query: p.query, chart_type: p.chart_type,
          chart_config: p.chart_config || {}, col: g.col, row: g.row, w: gw, h: g.h, sort_order: order,
        }) })
        if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `Failed to add panel "${p.title}"`) }
        order++
      }
      // Phase 9: persist the device/entity binding so the saved dashboard shows the Device
      // filter and the {{entity_id}} panels resolve. Without this the panels are stuck asking
      // for a device with no selector. (The in-dashboard chat dock already does this.)
      if (proposal.entity && typeof proposal.entity === 'object') {
        await fetch('/api/dashboards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set_entity_config', id, entity_config: proposal.entity }) }).catch(() => {})
      }
      setSaved(id)
      onSaved?.(id, title.trim() || 'New dashboard')
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  if (saved) {
    return (
      <div style={{ marginTop: embedded ? 0 : 10, border: embedded ? 'none' : '1px solid var(--border)', borderRadius: embedded ? 0 : 12, padding: 16, background: embedded ? 'transparent' : 'var(--surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Dashboard “{title}” saved — {includedCount} panel{includedCount === 1 ? '' : 's'}.</div>
          <button onClick={() => onOpen(saved)} style={{ padding: '7px 14px', background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>Open dashboard →</button>
        </div>
        <ProposalSavedPreview id={saved} window={proposal.suggested_window} />
      </div>
    )
  }

  return (
    <div style={{ marginTop: embedded ? 0 : 10, border: embedded ? 'none' : '1px solid var(--border2)', borderRadius: embedded ? 0 : 12, background: embedded ? 'transparent' : 'var(--surface)', overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <input value={title} onChange={e => setTitle(e.target.value)} style={{ flex: 1, minWidth: 160, fontSize: 14, fontWeight: 600, color: 'var(--text)', background: 'transparent', border: 'none', borderBottom: '1px dashed var(--border2)', outline: 'none', padding: '2px 0', fontFamily: 'inherit' }} />
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>{proposal.readiness ? `${proposal.readiness.readyCount}/${proposal.readiness.total} ready` : `${proposal.summary.data} data · ${proposal.summary.empty} empty · ${proposal.summary.error + proposal.summary.invalid} issue`}</span>
        <button onClick={save} disabled={saving || includedCount === 0 || planBlocked} title={planBlocked ? 'Resolve the gaps in chat before saving' : undefined} style={{ padding: '7px 14px', background: (includedCount && !planBlocked) ? 'var(--accent-bg)' : 'var(--bg4)', color: (includedCount && !planBlocked) ? 'var(--accent-fg)' : 'var(--text4)', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 12, fontWeight: 600, cursor: (saving || !includedCount || planBlocked) ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>{saving ? 'Saving…' : planBlocked ? 'Not ready to build' : `Save dashboard (${includedCount})`}</button>
      </div>
      {planBlocked && proposal.readiness && (
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--amber-bg, rgba(180,105,14,.08))' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--amber-t, #b4690e)', marginBottom: 4 }}>Not ready to build — {proposal.readiness.total - proposal.readiness.readyCount} of {proposal.readiness.total} panel(s) need input</div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: 'var(--text2)' }}>
            {proposal.readiness.gaps.map((g, k) => <li key={k} style={{ marginBottom: 2 }}><strong style={{ color: 'var(--text)' }}>{g.panel}</strong>: {g.gaps.join('; ')}</li>)}
          </ul>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5 }}>Answer the questions in chat (confirm the metric/filter, pick a device, fix a field) and I’ll rebuild — nothing is saved until every panel is ready.</div>
        </div>
      )}
      {err && <div style={{ padding: '8px 16px', color: 'var(--red-t, #dc2626)', fontSize: 12, borderBottom: '1px solid var(--border)' }}>{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10, padding: 14 }}>
        {panels.map((p, i) => {
          const c = clsStyle(p.validation.cls)
          return (
            <div key={i} style={{ border: `1px solid ${p.include ? 'var(--border2)' : 'var(--border)'}`, borderRadius: 10, padding: 12, background: p.include ? 'var(--bg)' : 'var(--bg3)', opacity: p.include ? 1 : 0.6, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <input type="checkbox" checked={p.include} disabled={!panelReady(p)} onChange={e => set(i, { include: e.target.checked })} style={{ flexShrink: 0, cursor: panelReady(p) ? 'pointer' : 'not-allowed' }} title={panelReady(p) ? undefined : 'Not ready — resolve in chat'} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{p.title}</span>
                {!panelReady(p) && <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 999, background: 'var(--amber-bg, rgba(180,105,14,.12))', color: 'var(--amber-t, #b4690e)' }}>not ready</span>}
                <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 999, background: c.bg, color: c.fg }}>{c.label}{p.validation.cls === 'data' ? ` · ${p.validation.rows}` : ''}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>{p.chart_type}{p.intent ? ` — ${p.intent}` : ''}</div>
              {p.readiness && !p.readiness.ready && p.readiness.gaps.length > 0 ? (
                <div style={{ fontSize: 11, color: 'var(--amber-t, #b4690e)', marginBottom: 6 }}>Needs: {p.readiness.gaps.join('; ')}</div>
              ) : p.validation.detail && p.validation.cls !== 'data' && (
                <div style={{ fontSize: 11, color: c.fg, marginBottom: 6 }}>{p.validation.detail}</div>
              )}
              {p.validation.sample && p.validation.sample.length > 0 && (
                <div style={{ overflowX: 'auto', marginBottom: 6 }}>
                  <pre style={{ margin: 0, fontSize: 10, color: 'var(--text2)', fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre', maxHeight: 90, overflowY: 'auto' }}>{JSON.stringify(p.validation.sample.slice(0, 3), null, 0).slice(0, 400)}</pre>
                </div>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => set(i, { expanded: !p.expanded })} style={{ background: 'none', border: 'none', color: 'var(--accent-fg, var(--text2))', fontSize: 11, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>{p.expanded ? 'Hide' : 'Edit'}</button>
              </div>
              {p.expanded && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <input value={p.title} onChange={e => set(i, { title: e.target.value })} placeholder="Title" style={{ fontSize: 12, padding: '5px 8px', border: '1px solid var(--border2)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit' }} />
                  <select value={p.chart_type} onChange={e => set(i, { chart_type: e.target.value })} style={{ fontSize: 12, padding: '5px 8px', border: '1px solid var(--border2)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit' }}>
                    {PROPOSAL_CHART_TYPES.map(ct => <option key={ct} value={ct}>{ct}</option>)}
                  </select>
                  <textarea value={p.query} onChange={e => set(i, { query: e.target.value })} rows={3} style={{ fontSize: 11, padding: '6px 8px', border: '1px solid var(--border2)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text)', fontFamily: 'ui-monospace, monospace', resize: 'vertical' }} />
                  <div style={{ fontSize: 10, color: 'var(--text4)' }}>Edits are saved as-is; re-run by asking in chat if you want them re-previewed.</div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Right-side review panel for a dashboard proposal — same resizable chrome as the
// file/map panels. Holds the proposal card (validate → edit → save).
function DashboardProposalPanel({ proposal, onClose, panelW, setPanelW, mobile, onOpen, onSaved }: { proposal: DashboardProposal; onClose: () => void; panelW: number; setPanelW: (v: number) => void; mobile: boolean; onOpen: (id: string) => void; onSaved: (id: string, title: string) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div style={mobile
      ? { position: 'fixed', inset: 0, zIndex: 120, width: '100%', display: 'flex', flexDirection: 'column', background: 'var(--surface)', height: '100dvh', paddingTop: 'var(--safe-top)' }
      : { width: panelW, minWidth: 320, flexShrink: 0, position: 'relative', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderLeft: '1px solid var(--border)', height: '100%' }}>
      {!mobile && <ResizeHandle width={panelW} setWidth={setPanelW} min={320} max={1100} dir={-1} side="left" />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Review dashboard</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>Validate the panels, then save</div>
        </div>
        <button onClick={onClose} title="Close (Esc)" style={{ width: 28, height: 28, borderRadius: 'var(--radius-pill)', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text2)', cursor: 'pointer', fontSize: 15, lineHeight: 1, flexShrink: 0 }}>×</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: 12 }}>
        <DashboardProposalCard proposal={proposal} onOpen={onOpen} onSaved={onSaved} embedded />
      </div>
    </div>
  )
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
  // Resizable panel widths (persisted). Sidebar 200–460; right panel 320–1100.
  const [sidebarWidth, setSidebarWidth] = usePersistentWidth('mosaic.sidebarW', 240, 200, 460)
  const [panelWidth, setPanelWidth] = usePersistentWidth('mosaic.panelW', 560, 320, 1100)
  // Mobile shell: the sidebar becomes an off-canvas drawer, panels go full-screen.
  const isMobile = useIsMobile()
  const [mobileNav, setMobileNav] = useState(false)
  // Chat folders.
  const [folders, setFolders] = useState<Folder[]>([])
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('mosaic.collapsedFolders') || '[]')) } catch { return new Set() }
  })
  const [moveMenuFor, setMoveMenuFor] = useState<string | null>(null)   // conversation id whose move-menu is open
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null)
  const [renamingConv, setRenamingConv] = useState<string | null>(null)
  const [convSort, setConvSort] = useState<'recent' | 'oldest' | 'az'>('recent')
  const [plusOpen, setPlusOpen] = useState(false)
  const [plusSubmenu, setPlusSubmenu] = useState<'sources'|'workflows'|'model'|'system'|null>(null)
  const [srcSearch, setSrcSearch] = useState('')
  const [openCats, setOpenCats] = useState<Set<string>>(new Set())
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [panel, setPanel] = useState<PanelItem | null>(null)
  const [research, setResearch] = useState<ResearchState | null>(null)
  const [workflows, setWorkflows] = useState<Array<{ id: string; name: string; description: string }>>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
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
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      // Add a chip immediately (pending), or an error chip if over the count cap —
      // so the user always sees what happened to each file, never a silent skip.
      let accepted = true
      setAttachments(cur => {
        if (cur.length >= MAX_ATTACH_COUNT) {
          accepted = false
          return [...cur, { id, name: file.name, type: file.type, data: '', status: 'error', error: `too many files (max ${MAX_ATTACH_COUNT})` }]
        }
        return [...cur, { id, name: file.name, type: file.type, data: '', status: 'pending' }]
      })
      if (!accepted) continue

      const kind = classifyAttachment(file.type, file.name)
      try {
        if (kind.startsWith('image')) {
          const r = await prepareImage(file, kind)
          setAttachments(cur => cur.map(a => a.id === id ? { ...a, type: r.type, data: r.data, preview: r.preview, status: 'ready' } : a))
        } else {
          if (file.size > MAX_DOC_BYTES) throw new Error(`file is ${humanBytes(file.size)}, over the ${humanBytes(MAX_DOC_BYTES)} limit`)
          const data = await readAsBase64(file)
          if (!data) throw new Error('the file appears to be empty')
          setAttachments(cur => cur.map(a => a.id === id ? { ...a, data, status: 'ready' } : a))
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'could not be read'
        setAttachments(cur => cur.map(a => a.id === id ? { ...a, status: 'error', error: msg } : a))
      }
    }
  }

  const attachPending = attachments.some(a => a.status === 'pending')
  const attachHasReady = attachments.some(a => a.status === 'ready')
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
            const dbConvs: Conv[] = data.conversations.map((c: { id: string; title: string; folder_id?: string | null; created_at?: string; updated_at?: string }) => ({
              id: c.id, title: c.title, messages: [], folderId: c.folder_id ?? null, createdAt: c.created_at, updatedAt: c.updated_at,
            }))
            const localUnsaved = prev.filter(c => c.id.startsWith('local-') && c.messages.length > 0)
            return [...localUnsaved, ...dbConvs]
          })
          setActiveId(data.conversations[0].id)
        }
      })
      .catch(() => {})
      .finally(() => setLoadingConvs(false))
    // Load the user's chat folders.
    fetch('/api/folders').then(r => r.json()).then(d => { if (Array.isArray(d.folders)) setFolders(d.folders) }).catch(() => {})
  }, [])

  // Persist folder collapse state.
  useEffect(() => {
    try { localStorage.setItem('mosaic.collapsedFolders', JSON.stringify([...collapsedFolders])) } catch {}
  }, [collapsedFolders])

  // ── Folder operations ───────────────────────────────────────────────────
  async function createFolder(): Promise<string | null> {
    try {
      const r = await fetch('/api/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'New folder' }) })
      const d = await r.json()
      if (d.folder) { setFolders(f => [...f, d.folder]); setRenamingFolder(d.folder.id); return d.folder.id }
    } catch {}
    return null
  }
  async function renameFolder(id: string, name: string) {
    const trimmed = name.trim(); if (!trimmed) return
    setFolders(f => f.map(x => x.id === id ? { ...x, name: trimmed } : x))
    fetch('/api/folders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name: trimmed }) }).catch(() => {})
  }
  // Rename a conversation. Updates immediately; persists for saved (non-local) chats.
  async function renameConv(id: string, title: string) {
    const trimmed = title.trim(); if (!trimmed) return
    setConvs(p => p.map(c => c.id === id ? { ...c, title: trimmed } : c))
    if (!id.startsWith('local-')) {
      fetch(`/api/conversations/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: trimmed.slice(0, 100) }) }).catch(() => {})
    }
  }
  async function deleteFolder(id: string) {
    setFolders(f => f.filter(x => x.id !== id))
    setConvs(p => p.map(c => c.folderId === id ? { ...c, folderId: null } : c))
    fetch('/api/folders', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => {})
  }
  // Move a conversation into a folder (or out, folderId=null). Server-backed
  // conversations only — a brand-new local chat is folderable once it has saved.
  async function moveConv(convId: string, folderId: string | null) {
    setMoveMenuFor(null)
    if (convId.startsWith('local-')) return
    setConvs(p => p.map(c => c.id === convId ? { ...c, folderId } : c))
    fetch(`/api/conversations/${convId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder_id: folderId }) }).catch(() => {})
  }
  function toggleFolder(id: string) {
    setCollapsedFolders(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const fMenuItem: React.CSSProperties = { width: '100%', padding: '6px 8px', background: 'none', border: 'none', fontSize: 12, color: 'var(--text2)', cursor: 'pointer', textAlign: 'left', borderRadius: 'var(--radius-sm)', fontFamily: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

  // One conversation row, with a move-to-folder menu and delete. Shared by the
  // grouped (folder) and ungrouped lists.
  const renderConvRow = (conv: Conv) => (
    <div key={conv.id} className="conv-row" onClick={() => { setActiveId(conv.id); if (isMobile) setMobileNav(false) }}
      style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 2, padding: '8px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', marginBottom: 2, background: conv.id === activeId ? 'var(--nav-active-bg)' : 'transparent', border: `1px solid ${conv.id === activeId ? 'var(--nav-border)' : 'transparent'}`, transition: 'background .12s' }}>
      {renamingConv === conv.id ? (
        <input autoFocus defaultValue={conv.title} onClick={e => e.stopPropagation()}
          onBlur={e => { renameConv(conv.id, e.target.value); setRenamingConv(null) }}
          onKeyDown={e => { if (e.key === 'Enter') { renameConv(conv.id, (e.target as HTMLInputElement).value); setRenamingConv(null) } if (e.key === 'Escape') setRenamingConv(null) }}
          style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--nav-text-strong)', background: 'var(--bg)', border: '1px solid var(--nav-border)', borderRadius: 4, padding: '2px 6px', outline: 'none', fontFamily: 'inherit' }} />
      ) : (
        <span onDoubleClick={e => { e.stopPropagation(); setRenamingConv(conv.id) }} title="Double-click to rename"
          style={{ fontSize: 12, color: conv.id === activeId ? 'var(--nav-text-strong)' : 'var(--nav-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{conv.title}</span>
      )}
      {renamingConv !== conv.id && (
        <>
          <button onClick={e => { e.stopPropagation(); setRenamingConv(conv.id) }} title="Rename" className="conv-row-btn"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--nav-muted)', paddingLeft: 2, flexShrink: 0, opacity: 0, display: 'flex' }}>
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 2.5l2 2L5 11l-2.5.5.5-2.5 6.5-6.5z"/></svg>
          </button>
          {!conv.id.startsWith('local-') && (
            <button onClick={e => { e.stopPropagation(); setMoveMenuFor(moveMenuFor === conv.id ? null : conv.id) }} title="Move to folder" className="conv-row-btn"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--nav-muted)', paddingLeft: 2, flexShrink: 0, opacity: moveMenuFor === conv.id ? 1 : 0, display: 'flex' }}>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M1 3.5h4l1 1.5h6.5a1 1 0 011 1V11a1 1 0 01-1 1H2a1 1 0 01-1-1V3.5z"/></svg>
            </button>
          )}
          <button onClick={e => delConv(conv.id, e)} title="Delete" className="conv-row-btn"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--nav-muted)', fontSize: 14, paddingLeft: 2, flexShrink: 0, opacity: 0, display: 'flex' }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 2l6 6M8 2l-6 6"/></svg>
          </button>
        </>
      )}
      {moveMenuFor === conv.id && (
        <>
          <div onClick={e => { e.stopPropagation(); setMoveMenuFor(null) }} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
          <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 'calc(100% + 2px)', right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', padding: 5, width: 184, zIndex: 61, maxHeight: 280, overflowY: 'auto' }}>
            <div style={{ fontSize: 10, color: 'var(--text4)', padding: '4px 8px', textTransform: 'uppercase', letterSpacing: '.05em' }}>Move to</div>
            {conv.folderId && <button style={fMenuItem} onClick={() => moveConv(conv.id, null)}>Remove from folder</button>}
            {folders.filter(f => f.id !== conv.folderId).map(f => (
              <button key={f.id} style={fMenuItem} onClick={() => moveConv(conv.id, f.id)}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>{f.name}</button>
            ))}
            <button style={{ ...fMenuItem, color: 'var(--text3)', borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 7 }}
              onClick={async () => { const fid = await createFolder(); if (fid) moveConv(conv.id, fid) }}>+ New folder</button>
          </div>
        </>
      )}
    </div>
  )

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
    if (isMobile) setMobileNav(false)
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
    if (streaming) return
    if (attachments.some(a => a.status === 'pending')) return  // still preparing a file — button is disabled too
    const readyAttachments = attachments.filter(a => a.status === 'ready' && a.data)
    if (!text.trim() && readyAttachments.length === 0) return  // nothing to send
    let cid = activeId
    const isFirstMsg = (convs.find(c => c.id === cid)?.messages.length ?? 0) === 0
    const newTitle = isFirstMsg ? text.slice(0, 42) : undefined
    // Record the uploaded files ON the user message so the chat shows what was
    // sent — confirmation that the upload landed (names + image thumbnails).
    const msgAttachments: MsgAttachment[] = readyAttachments.map(a => ({ name: a.name, type: a.type, preview: a.preview }))
    setConvs(p => p.map(c => {
      if (c.id !== cid) return c
      return { ...c, title: isFirstMsg ? text.slice(0, 42) : c.title, messages: [...c.messages, { role: 'user', content: text, attachments: msgAttachments.length ? msgAttachments : undefined }, { role: 'assistant', content: '', tools: [], startedAt: Date.now() }] }
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
          // Uploaded files for this turn: images (native vision, already
          // downscaled/transcoded client-side) + documents (extracted to text
          // server-side). Only ready files are sent; errored/pending chips are
          // excluded. Sent once with the message.
          attachments: readyAttachments.map(a => ({ name: a.name, type: a.type, data: a.data })),
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
            // Dashboard builder proposal — attach to the message (for a reopen chip)
            // and open it in the right-side review panel, same as file/map review.
            else if (e.type === 'dashboard_proposal' && e.proposal) { const prop = e.proposal as DashboardProposal; updateLast(cid, m => ({ ...m, dashboardProposal: prop })); setPanel({ kind: 'dashboard_proposal', proposal: prop }) }
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
    <div style={{ display: 'flex', height: '100dvh', overflow: 'hidden', background: 'var(--bg)', position: 'relative' }}>
      {/* Mobile drawer backdrop */}
      {isMobile && mobileNav && <div onClick={() => setMobileNav(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 99 }} />}

      {showUpdate && <UpdateModal deploy={deploy} onClose={() => setShowUpdate(false)} />}
      {/* -- Sidebar -- */}
      <div style={isMobile
        ? { position: 'fixed', top: 0, left: 0, bottom: 0, width: 'min(84vw, 320px)', zIndex: 100, transform: mobileNav ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform .25s ease', display: 'flex', flexDirection: 'column', background: 'var(--nav-bg)', borderRight: '1px solid var(--nav-border)', boxShadow: mobileNav ? 'var(--shadow-lg)' : 'none', paddingTop: 'var(--safe-top)' }
        : { width: sidebarCollapsed ? 56 : sidebarWidth, flexShrink: 0, position: 'relative', display: 'flex', flexDirection: 'column', background: 'var(--nav-bg)', borderRight: '1px solid var(--nav-border)', transition: sidebarCollapsed ? 'width .2s ease' : 'none', overflow: 'visible' }}>
        {!isMobile && !sidebarCollapsed && <ResizeHandle width={sidebarWidth} setWidth={setSidebarWidth} min={200} max={460} dir={1} side="right" />}

        {/* Logo — extra top padding so the wordmark clears the window's top edge /
            macOS traffic-light title bar in the Electron desktop app. */}
        <div style={{ padding: '28px 16px 14px', borderBottom: '1px solid var(--nav-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minWidth: 0 }}>
          {!sidebarCollapsed && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, overflow: 'hidden' }}>
              <span style={{ fontFamily: 'var(--font-serif)', fontSize: 20, color: 'var(--nav-text-strong)', whiteSpace: 'nowrap' }}>Mosaic</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: sidebarCollapsed ? 'auto' : 0, marginRight: sidebarCollapsed ? 'auto' : 0 }}>
            {!sidebarCollapsed && (
              <button onClick={newConv} title="New conversation"
                style={{ width: 28, height: 28, borderRadius: 'var(--radius-pill)', border: '1px solid var(--nav-border)', background: 'transparent', cursor: 'pointer', fontSize: 16, color: 'var(--nav-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>+</button>
            )}
            <button onClick={() => setSidebarCollapsed(s => !s)} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              style={{ width: 28, height: 28, borderRadius: 'var(--radius-sm)', border: '1px solid var(--nav-border)', background: 'transparent', cursor: 'pointer', color: 'var(--nav-text)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" style={{ transform: sidebarCollapsed ? 'scaleX(-1)' : 'none', transition: 'transform .2s' }}>
                <rect x="1" y="1" width="12" height="12" rx="2"/>
                <line x1="5" y1="1" x2="5" y2="13"/>
                <path d="M3 5l-1.5 2 1.5 2" strokeWidth="1.2"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Primary nav */}
        <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--nav-border)' }}>
          {([ 
            { label: 'Chats',         href: null,              active: true,  icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M12 1H2a1 1 0 00-1 1v7a1 1 0 001 1h1v3l3-3h6a1 1 0 001-1V2a1 1 0 00-1-1z"/></svg> },
            { label: 'Dashboards',    href: '/dashboards',     active: false, icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><rect x="1" y="7" width="4" height="6" rx="1"/><rect x="5.5" y="4" width="4" height="9" rx="1"/><rect x="10" y="1" width="3" height="12" rx="1"/></svg> },
            { label: 'Assets',        href: '/assets',         active: false, icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="7" cy="2.5" r="1.5"/><circle cx="2.5" cy="11" r="1.5"/><circle cx="11.5" cy="11" r="1.5"/><path d="M7 4v2.5M7 6.5L3.2 9.8M7 6.5l3.8 3.3"/></svg> },
            { label: 'Digests',       href: '/reports',        active: false, icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 1h7l3 3v9a1 1 0 01-1 1H2a1 1 0 01-1-1V2a1 1 0 011-1z"/><path d="M9 1v3h3M4 6h6M4 8.5h6M4 11h4"/></svg> },
            { label: 'Query Builder', href: '/query-builder',  active: false, icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="2" width="12" height="10" rx="1.5"/><path d="M4 5.5l2 2-2 2M8 9.5h2.5"/></svg> },
            { label: 'Rules',         href: '/rules',          active: false, icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 4h10M2 7h7M2 10h8"/><circle cx="12" cy="10" r="1.5" fill="currentColor" stroke="none"/></svg> },
            { label: 'Agents',        href: '/agents',         active: false, icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="3" width="9" height="7" rx="1.5"/><path d="M5 1.5v1.5M9 1.5v1.5M1 5.5v2M13 5.5v2M5 12.5h4"/><circle cx="5.5" cy="6.3" r=".7" fill="currentColor" stroke="none"/><circle cx="8.5" cy="6.3" r=".7" fill="currentColor" stroke="none"/></svg> },
          ] as { label: string; href: string | null; active: boolean; enterpriseOnly?: boolean; icon: React.ReactNode }[])
            .filter(item => !(deploy.edition === 'personal' && item.enterpriseOnly))
            .map(item => (
            <button key={item.label}
              onClick={() => item.href ? router.push(item.href) : undefined}
              title={sidebarCollapsed ? item.label : undefined}
              style={{ width: '100%', padding: '7px 10px', background: item.active ? 'var(--nav-active-bg)' : 'none', border: `1px solid ${item.active ? 'var(--nav-border)' : 'transparent'}`, borderRadius: 'var(--radius-sm)', cursor: item.href ? 'pointer' : 'default', fontSize: 12, color: item.active ? 'var(--nav-text-strong)' : 'var(--nav-text)', fontWeight: item.active ? 500 : 400, textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: sidebarCollapsed ? 'center' : 'flex-start', gap: 7, fontFamily: 'inherit', transition: 'background .12s', marginBottom: 1 }}
              onMouseEnter={e => { if (!item.active) e.currentTarget.style.background = 'var(--nav-hover)' }}
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5, marginBottom: 6 }}>
                <span style={{ fontSize: 10.5, color: 'var(--nav-muted)' }}>Sort</span>
                <select value={convSort} onChange={e => setConvSort(e.target.value as 'recent' | 'oldest' | 'az')}
                  style={{ fontSize: 11, color: 'var(--nav-text)', background: 'var(--bg)', border: '1px solid var(--nav-border)', borderRadius: 4, padding: '2px 4px', cursor: 'pointer', fontFamily: 'inherit', outline: 'none' }}>
                  <option value="recent">Recent</option>
                  <option value="oldest">Oldest</option>
                  <option value="az">A–Z</option>
                </select>
              </div>
              <style>{`.conv-row:hover .conv-row-btn{opacity:1 !important}`}</style>
              <button onClick={createFolder} title="New folder"
                style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '5px 8px', marginBottom: 6, background: 'none', border: '1px dashed var(--nav-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: 'var(--nav-muted)', fontSize: 11, fontFamily: 'inherit' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--nav-hover)')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M7 3.5v7M3.5 7h7"/></svg> New folder
              </button>
              {(() => {
                const q = convSearch.toLowerCase()
                const match = (c: Conv) => !q || c.title.toLowerCase().includes(q)
                // Sort by chosen order. A brand-new unsaved (local-) chat has no
                // timestamp — treat it as newest so it stays at the top under "Recent".
                const ts = (c: Conv) => c.updatedAt ? Date.parse(c.updatedAt) : (c.id.startsWith('local-') ? Number.MAX_SAFE_INTEGER : 0)
                const sortFn = (a: Conv, b: Conv) => convSort === 'az' ? a.title.localeCompare(b.title) : convSort === 'oldest' ? ts(a) - ts(b) : ts(b) - ts(a)
                const visible = convs.filter(match).slice().sort(sortFn)
                const ungrouped = visible.filter(c => !c.folderId)
                return (
                  <>
                    {folders.map(f => {
                      const items = visible.filter(c => c.folderId === f.id)
                      const open = !collapsedFolders.has(f.id)
                      return (
                        <div key={f.id} style={{ marginBottom: 2 }}>
                          <div onClick={() => toggleFolder(f.id)} className="conv-row"
                            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 6px', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--nav-hover)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                            <span style={{ fontSize: 9, color: 'var(--nav-muted)', width: 10, flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>▶</span>
                            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--nav-muted)', flexShrink: 0 }}><path d="M1 3.5h4l1 1.5h6.5a1 1 0 011 1V11a1 1 0 01-1 1H2a1 1 0 01-1-1V3.5z"/></svg>
                            {renamingFolder === f.id ? (
                              <input autoFocus defaultValue={f.name} onClick={e => e.stopPropagation()}
                                onBlur={e => { renameFolder(f.id, e.target.value); setRenamingFolder(null) }}
                                onKeyDown={e => { if (e.key === 'Enter') { renameFolder(f.id, (e.target as HTMLInputElement).value); setRenamingFolder(null) } if (e.key === 'Escape') setRenamingFolder(null) }}
                                style={{ flex: 1, fontSize: 12, padding: '1px 4px', border: '1px solid var(--border2)', borderRadius: 4, background: 'var(--bg)', color: 'var(--text)', fontFamily: 'inherit', minWidth: 0 }} />
                            ) : (
                              <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--nav-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                            )}
                            <span style={{ fontSize: 10, color: 'var(--nav-muted)', flexShrink: 0 }}>{items.length}</span>
                            <button onClick={e => { e.stopPropagation(); setRenamingFolder(f.id) }} title="Rename folder" className="conv-row-btn"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--nav-muted)', padding: '0 1px', display: 'flex', opacity: 0, flexShrink: 0 }}>
                              <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2l3 3-7 7H2v-3z"/></svg>
                            </button>
                            <button onClick={e => { e.stopPropagation(); if (confirm(`Delete folder "${f.name}"? Chats inside move to Ungrouped (they are not deleted).`)) deleteFolder(f.id) }} title="Delete folder" className="conv-row-btn"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--nav-muted)', padding: '0 1px', display: 'flex', opacity: 0, flexShrink: 0 }}>
                              <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3.5h10M5 3.5V2h4v1.5M3.5 3.5l.6 8.5h5.8l.6-8.5"/></svg>
                            </button>
                          </div>
                          {open && <div style={{ paddingLeft: 10 }}>{items.length ? items.map(renderConvRow) : <div style={{ fontSize: 11, color: 'var(--nav-muted)', padding: '4px 10px' }}>Empty — move chats here from the ⋯ menu</div>}</div>}
                        </div>
                      )
                    })}
                    {folders.length > 0 && ungrouped.length > 0 && <div style={{ fontSize: 10, color: 'var(--nav-muted)', padding: '8px 8px 3px', textTransform: 'uppercase', letterSpacing: '.05em' }}>Ungrouped</div>}
                    {ungrouped.map(renderConvRow)}
                  </>
                )
              })()}
            </>
          )}
        </div>

        {/* User + theme */}
        <div style={{ borderTop: '1px solid var(--nav-border)', padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: sidebarCollapsed ? 'center' : 'space-between', gap: 8 }}>
          <div style={{ position: 'relative', flex: sidebarCollapsed ? 'none' : 1 }}>
            <button onClick={() => setShowUserMenu(v => !v)} title={sidebarCollapsed ? user.name : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', width: '100%' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--nav-hover)', border: '1px solid var(--nav-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: 'var(--nav-text)', flexShrink: 0 }}>
                {user.name.slice(0, 2).toUpperCase()}
              </div>
              {!sidebarCollapsed && (
                <div style={{ textAlign: 'left', overflow: 'hidden', flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--nav-text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--nav-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.role}</div>
                  {deploy.updateAvailable ? (
                    <button onClick={e => { e.stopPropagation(); setShowUpdate(true) }}
                      title={`Version ${deploy.latestVersion} is available`}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 3, padding: '1px 8px', borderRadius: 'var(--radius-pill)', background: 'var(--blue-bg, #eff6ff)', border: '1px solid var(--blue-t)', color: 'var(--blue-t)', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.6 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--blue-t)', display: 'inline-block' }} />
                      Update to v{deploy.latestVersion}
                    </button>
                  ) : (
                    <div style={{ fontSize: 10, color: 'var(--nav-muted)' }}>v{deploy.currentVersion || APP_VERSION}</div>
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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, position: 'relative' }}
        onDragEnter={e => { if (Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); dragDepth.current += 1; setDragging(true) } }}
        onDragOver={e => { if (Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault() }}
        onDragLeave={e => { if (Array.from(e.dataTransfer.types || []).includes('Files')) { dragDepth.current -= 1; if (dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false) } } }}
        onDrop={e => { if (Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); dragDepth.current = 0; setDragging(false); handleFiles(e.dataTransfer.files) } }}>
        {dragging && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 200, background: 'var(--accent-bg, rgba(99,102,241,0.08))', border: '2px dashed var(--accent, #6366f1)', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', backdropFilter: 'blur(1px)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: 'var(--accent, #6366f1)', fontWeight: 600, fontSize: 15 }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>
              Drop files to attach
            </div>
          </div>
        )}

        {/* Mobile top bar — hamburger opens the chat drawer; + starts a new chat. */}
        {isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 'calc(var(--safe-top) + 8px) 12px 8px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
            <button onClick={() => setMobileNav(true)} title="Menu" aria-label="Open menu"
              style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text2)', cursor: 'pointer', flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 4h12M2 8h12M2 12h12"/></svg>
            </button>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 18, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Mosaic</span>
            <button onClick={newConv} title="New chat" aria-label="New chat"
              style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border2)', borderRadius: 'var(--radius-pill)', color: 'var(--text2)', cursor: 'pointer', flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M7 2v10M2 7h10"/></svg>
            </button>
          </div>
        )}

        <SetupBanner isAdmin={user.role === 'admin'} />

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '32px 0' }}>
          <div style={{ maxWidth: 720, margin: '0 auto', padding: isMobile ? '0 16px' : '0 32px' }}>
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

                  {/* Data-source health check — render the structured card from the tool result */}
                  {msg.role === 'assistant' && Array.isArray(msg.tools) && msg.tools
                    .filter(t => t.name === 'check_data_sources' && t.result && typeof t.result === 'object' && Array.isArray((t.result as { sources?: unknown }).sources))
                    .map((t, k) => <SourceHealthCard key={k} data={t.result as HealthData} />)
                  }

                  {/* Files produced by run_code — download chips + inline images */}
                  {msg.role === 'assistant' && <GeneratedFiles files={collectGeneratedFiles(msg.tools)} onOpen={f => setPanel({ kind: 'file', file: f })} />}
                  {msg.role === 'assistant' && msg.dashboardProposal && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                      <button onClick={() => setPanel({ kind: 'dashboard_proposal', proposal: msg.dashboardProposal! })}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1.5" y="1.5" width="11" height="11" rx="1.5"/><path d="M1.5 5.5h11M6 5.5v7"/></svg>
                        Dashboard proposal — review
                      </button>
                      {msg.dashboardSaved && (
                        <button onClick={() => router.push(`/dashboards/${msg.dashboardSaved!.id}`)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--accent-bg)', color: 'var(--accent-fg)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                          Open dashboard: {msg.dashboardSaved.title} →
                        </button>
                      )}
                    </div>
                  )}
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
                      {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
                        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', maxWidth: '100%', paddingBottom: msg.content ? 8 : 0, marginBottom: msg.content ? 2 : 0 }}>
                          {msg.attachments.map((a, ai) => (
                            <span key={ai} title={a.name}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0, maxWidth: 180, padding: '4px 9px', borderRadius: 'var(--radius-pill)', background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 11, fontWeight: 500, color: 'var(--text2)' }}>
                              {a.preview
                                ? <img src={a.preview} alt="" style={{ width: 16, height: 16, borderRadius: 2, objectFit: 'cover', flexShrink: 0 }} />
                                : <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" style={{ flexShrink: 0 }}><path d="M2 1h5l3 3v7H2V1z"/><path d="M7 1v3h3"/></svg>}
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                            </span>
                          ))}
                        </div>
                      )}
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
                            style={{ padding: '5px 13px', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', background: 'var(--surface)', fontSize: 12, color: 'var(--text2)', cursor: 'pointer', fontFamily: 'inherit', boxShadow: 'var(--shadow)', transition: 'background .12s' }}
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
        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)', padding: isMobile ? '10px 12px calc(10px + var(--safe-bottom))' : '14px 24px 18px', flexShrink: 0 }}>
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
                {attachments.map(a => {
                  const isErr = a.status === 'error'
                  const isPending = a.status === 'pending'
                  return (
                    <span key={a.id}
                      title={isErr ? `${a.name} — ${a.error}` : a.name}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 'var(--radius-pill)', background: isErr ? 'var(--red-bg, rgba(220,38,38,0.08))' : 'var(--bg3)', border: `1px solid ${isErr ? 'var(--red-t, #dc2626)' : 'var(--border)'}`, fontSize: 11, fontWeight: 500, color: isErr ? 'var(--red-t, #dc2626)' : 'var(--text2)', opacity: isPending ? 0.65 : 1 }}>
                      {isPending
                        ? <svg width="12" height="12" viewBox="0 0 12 12" style={{ animation: 'spin 0.8s linear infinite' }}><circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="20" strokeDashoffset="12" strokeLinecap="round"/></svg>
                        : isErr
                          ? <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M7 1.5 13 12.5H1L7 1.5z"/><path d="M7 6v2.5M7 10.5v.2"/></svg>
                          : a.preview
                            ? <img src={a.preview} style={{ width: 16, height: 16, borderRadius: 2, objectFit: 'cover' }} alt="" />
                            : <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 1h5l3 3v7H2V1z"/><path d="M7 1v3h3"/></svg>
                      }
                      {a.name.slice(0, 20)}{a.name.length > 20 ? '…' : ''}
                      {isErr && <span style={{ fontSize: 10, opacity: 0.85, fontWeight: 600 }}>· failed</span>}
                      <button onClick={() => setAttachments(x => x.filter(y => y.id !== a.id))} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1, opacity: 0.7 }}>×</button>
                    </span>
                  )
                })}
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
            <input ref={fileInputRef} type="file" multiple accept="image/*,.heic,.heif,.pdf,.csv,.tsv,.xlsx,.xls,.json,.txt,.md,.docx,.pptx" style={{ display: 'none' }}
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

            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '10px 12px', boxShadow: 'var(--shadow)' }}>
              <button onClick={() => { setPlusOpen(o => !o); setPlusSubmenu(null) }}
                style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: plusOpen ? 'var(--bg3)' : 'var(--surface)', color: 'var(--text2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .12s' }}>
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
                <button onClick={() => send(input)} disabled={(!input.trim() && !attachHasReady) || attachPending}
                  title={attachPending ? 'Preparing attachment…' : undefined}
                  style={{ flexShrink: 0, width: 34, height: 34, borderRadius: '50%', border: 'none', background: ((!input.trim() && !attachHasReady) || attachPending) ? 'var(--bg4)' : 'var(--accent-bg)', color: ((!input.trim() && !attachHasReady) || attachPending) ? 'var(--text4)' : 'var(--accent-fg)', cursor: ((!input.trim() && !attachHasReady) || attachPending) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .15s', boxShadow: ((!input.trim() && !attachHasReady) || attachPending) ? 'none' : 'var(--shadow)' }}>
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
      {panel?.kind === 'file' && <FilePreviewPanel file={panel.file} onClose={() => setPanel(null)} panelW={panelWidth} setPanelW={setPanelWidth} mobile={isMobile} />}
      {panel?.kind === 'map' && <MapPanel map={panel.map} onClose={() => setPanel(null)} panelW={panelWidth} setPanelW={setPanelWidth} mobile={isMobile} />}
      {panel?.kind === 'research' && research && <ResearchPanel research={research} onClose={() => setPanel(null)} panelW={panelWidth} setPanelW={setPanelWidth} mobile={isMobile} />}
      {panel?.kind === 'dashboard_proposal' && <DashboardProposalPanel proposal={panel.proposal} onClose={() => setPanel(null)} panelW={panelWidth} setPanelW={setPanelWidth} mobile={isMobile} onOpen={id => router.push(`/dashboards/${id}`)} onSaved={(id, title) => { const prop = panel.proposal; setConvs(ps => ps.map(c => ({ ...c, messages: c.messages.map(m => m.dashboardProposal === prop ? { ...m, dashboardSaved: { id, title } } : m) }))) }} />}
    </div>
  )
}

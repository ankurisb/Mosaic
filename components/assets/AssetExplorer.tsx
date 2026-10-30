'use client'
import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import type { SessionUser } from '@/lib/auth'
import AppShell from '@/components/AppShell'
import PageHeader from '@/components/PageHeader'

// -- types (mirror /api/graph) ------------------------------------------------
type NodeKind = 'plant' | 'line' | 'asset' | 'sensor' | 'gateway' | 'source' | 'dimension' | 'other'
type EdgeType = 'contains' | 'measured_on' | 'same_as' | 'related'
interface GNode { id: string; source_type: string; source_id: string; kind: NodeKind; natural_key: string; label: string; props: Record<string, unknown>; status: string }
interface GEdge { id: string; src: string; dst: string; type: EdgeType; provenance: string; confidence: number | null; status: string; evidence: string }
interface GraphResp { nodes: GNode[]; edges: GEdge[]; run: Record<string, unknown> | null }

// -- visual grammar -----------------------------------------------------------
const KIND: Record<NodeKind, { c: string; label: string; r: number; mono?: boolean }> = {
  plant:     { c: 'var(--accent)', label: 'Plant', r: 24 },
  line:      { c: 'var(--accent)', label: 'Line', r: 20 },
  dimension: { c: 'var(--blue)', label: 'Group', r: 18 },
  asset:     { c: 'var(--text3)', label: 'Asset', r: 21, mono: true },
  sensor:    { c: 'var(--blue)', label: 'Sensor', r: 17, mono: true },
  gateway:   { c: 'var(--blue)', label: 'Gateway', r: 20 },
  source:    { c: 'var(--purple)', label: 'Source', r: 20 },
  other:     { c: 'var(--text4)', label: 'Node', r: 18 },
}
const EDGE: Record<string, { c: string; dash?: string; label: string }> = {
  contains:    { c: 'var(--border2)', label: 'contains' },
  measured_on: { c: 'var(--blue)', dash: '6 4', label: 'measured-on' },
  same_as_v:   { c: 'var(--green)', label: 'same-as · verified' },
  same_as_p:   { c: 'var(--amber)', dash: '5 4', label: 'same-as · pending' },
  same_as_r:   { c: 'var(--text4)', dash: '2 4', label: 'same-as · rejected' },
  related:     { c: 'var(--text3)', label: 'related' },
  manual:      { c: 'var(--purple)', dash: '2 4', label: 'manual' },
}
function edgeStyleKey(e: GEdge): string {
  if (e.provenance === 'manual' && e.type !== 'same_as') return 'manual'
  if (e.type === 'same_as') return e.status === 'verified' ? 'same_as_v' : e.status === 'rejected' ? 'same_as_r' : 'same_as_p'
  return e.type === 'measured_on' ? 'measured_on' : e.type === 'related' ? 'related' : 'contains'
}
const RANK: Record<NodeKind, number> = { plant: 0, source: 1, gateway: 1, line: 1, dimension: 1, asset: 2, other: 2, sensor: 3 }

// -- layout: connected components, laid side by side; layered by kind rank ----
interface Placed extends GNode { x: number; y: number }
function layout(nodes: GNode[], edges: GEdge[]): { placed: Placed[]; width: number; height: number } {
  if (!nodes.length) return { placed: [], width: 400, height: 300 }
  const byId = new Map(nodes.map(n => [n.id, n]))
  const parent = new Map(nodes.map(n => [n.id, n.id]))
  const find = (x: string): string => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)! } return x }
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb) }
  for (const e of edges) { if (e.status !== 'rejected' && byId.has(e.src) && byId.has(e.dst)) union(e.src, e.dst) }
  const comps = new Map<string, GNode[]>()
  for (const n of nodes) { const r = find(n.id); (comps.get(r) || comps.set(r, []).get(r)!).push(n) }

  const ROW_H = 118, COL_W = 150, COMP_GAP = 80, PAD = 48
  const placed: Placed[] = []
  let xCursor = PAD
  let maxRow = 0
  const order = [...comps.values()].sort((a, b) => b.length - a.length || (a[0].label).localeCompare(b[0].label))
  for (const comp of order) {
    const rows = new Map<number, GNode[]>()
    for (const n of comp) { const r = RANK[n.kind] ?? 2; (rows.get(r) || rows.set(r, []).get(r)!).push(n) }
    const rowKeys = [...rows.keys()].sort((a, b) => a - b)
    let compWidth = 0
    rowKeys.forEach(rk => { rows.get(rk)!.sort((a, b) => a.label.localeCompare(b.label)); compWidth = Math.max(compWidth, rows.get(rk)!.length * COL_W) })
    rowKeys.forEach((rk, ri) => {
      const row = rows.get(rk)!
      const rowWidth = row.length * COL_W
      const startX = xCursor + (compWidth - rowWidth) / 2
      row.forEach((n, i) => { placed.push({ ...n, x: startX + i * COL_W + COL_W / 2, y: PAD + ri * ROW_H + 30 }) })
      maxRow = Math.max(maxRow, ri)
    })
    xCursor += compWidth + COMP_GAP
  }
  return { placed, width: Math.max(xCursor - COMP_GAP + PAD, 400), height: PAD + maxRow * ROW_H + 110 }
}

interface View { x: number; y: number; w: number; h: number }

export default function AssetExplorer({ user }: { user: SessionUser }) {
  const isAdmin = user.role === 'admin'
  const [data, setData] = useState<GraphResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    try {
      const r = await fetch('/api/graph', { credentials: 'same-origin' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed to load graph')
      setData(j); setErr(null)
      if (!sel && j.nodes?.length) {
        const firstPending = j.edges?.find((e: GEdge) => e.type === 'same_as' && e.status === 'pending')
        setSel(firstPending ? firstPending.src : j.nodes[0].id)
      }
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [sel])

  useEffect(() => { refetch() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function rebuild() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/graph', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action: 'rebuild' }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Build failed')
      await refetch()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  async function resolve(edgeId: string, confirm: boolean) {
    setBusy(true)
    try {
      await fetch('/api/graph', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action: confirm ? 'confirm' : 'reject', edge_id: edgeId }) })
      await refetch()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const nodes = data?.nodes || []
  const edges = data?.edges || []
  const { placed, width, height } = useMemo(() => layout(nodes, edges), [nodes, edges])
  const posById = useMemo(() => new Map(placed.map(p => [p.id, p])), [placed])
  const pendingCount = edges.filter(e => e.type === 'same_as' && e.status === 'pending').length
  const run = data?.run

  // -- pan / zoom (viewBox-based) ---------------------------------------------
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, w: 960, h: 560 })
  const viewRef = useRef(view); useEffect(() => { viewRef.current = view }, [view])
  const dragRef = useRef<{ sx: number; sy: number; v: View } | null>(null)

  const fit = useCallback(() => {
    setView({ x: -24, y: -16, w: width + 48, h: height + 48 })
  }, [width, height])
  // Re-fit whenever the laid-out graph changes size (new build / confirm / reject).
  useEffect(() => { fit() }, [width, height]) // eslint-disable-line react-hooks/exhaustive-deps

  const clampW = useCallback((w: number) => Math.max(80, Math.min(width * 2.6 + 120, w)), [width])
  const scaleAround = useCallback((factor: number, cx?: number, cy?: number) => {
    const v = viewRef.current
    const nw = clampW(v.w * factor); const k = nw / v.w; const nh = v.h * k
    const ax = cx ?? v.x + v.w / 2, ay = cy ?? v.y + v.h / 2
    setView({ w: nw, h: nh, x: ax - (ax - v.x) * k, y: ay - (ay - v.y) * k })
  }, [clampW])

  // Native wheel listener so we can preventDefault (React onWheel is passive).
  useEffect(() => {
    const el = svgRef.current; if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect(); const v = viewRef.current
      const cx = v.x + ((e.clientX - rect.left) / rect.width) * v.w
      const cy = v.y + ((e.clientY - rect.top) / rect.height) * v.h
      scaleAround(e.deltaY < 0 ? 0.85 : 1.18, cx, cy)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [scaleAround])

  function onPointerDown(e: React.PointerEvent) {
    if ((e.target as Element).closest('.ae-node')) return // let node clicks through
    dragRef.current = { sx: e.clientX, sy: e.clientY, v: viewRef.current }
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current; if (!d) return
    const rect = (e.currentTarget as Element).getBoundingClientRect()
    const dx = ((e.clientX - d.sx) / rect.width) * d.v.w
    const dy = ((e.clientY - d.sy) / rect.height) * d.v.h
    setView({ ...d.v, x: d.v.x - dx, y: d.v.y - dy })
  }
  function onPointerUp() { dragRef.current = null }

  const selNode = sel ? nodes.find(n => n.id === sel) || null : null
  const selNeighbours = useMemo(() => {
    if (!selNode) return []
    const byId = new Map(nodes.map(n => [n.id, n]))
    const out: Array<{ node: GNode; edge: GEdge }> = []
    for (const e of edges) {
      if (e.src === selNode.id && byId.has(e.dst)) out.push({ node: byId.get(e.dst)!, edge: e })
      else if (e.dst === selNode.id && byId.has(e.src)) out.push({ node: byId.get(e.src)!, edge: e })
    }
    return out
  }, [selNode, nodes, edges])
  const selPending = selNeighbours.find(x => x.edge.type === 'same_as' && x.edge.status === 'pending')

  return (
    <AppShell user={user}>
      <style>{AE_CSS}</style>
      <PageHeader
        title="Asset Explorer"
        subtitle={run
          ? `Graph derived from your connected sources · ${String(run.nodes ?? 0)} nodes · ${String(run.edges ?? 0)} edges · ${String(run.sources ?? 0)} sources${run.finished_at ? ` · built ${String(run.finished_at).replace('T', ' ').slice(0, 16)}` : ''}`
          : 'Built automatically from your connected sources — no hand-authoring.'}
        actions={<>
          {pendingCount > 0 && <span className="ae-badge">{pendingCount} to review</span>}
          {isAdmin && <button className="ae-btn primary" onClick={rebuild} disabled={busy}>{busy ? 'Building…' : (nodes.length ? 'Rebuild / Sync' : 'Build graph')}</button>}
        </>}
      />
      <div className="ae-wrap">

        {err && <div className="ae-err">{err}</div>}

        {loading ? (
          <div className="ae-empty">Loading graph…</div>
        ) : !nodes.length ? (
          <div className="ae-empty">
            <div className="ae-empty-title">No graph yet</div>
            <p>The knowledge graph is materialised from whatever sources you’ve connected — it reads their semantic roles and relationships and proposes the links. Nothing is hand-built.</p>
            {isAdmin ? <button className="ae-btn primary" onClick={rebuild} disabled={busy}>{busy ? 'Building…' : 'Build graph'}</button>
                     : <p className="ae-muted">Ask an admin to run the first build (Settings → Knowledge Graph).</p>}
          </div>
        ) : (
          <div className="ae-stage">
            <div className="ae-card ae-canvas">
              <div className="ae-zoombar">
                <button onClick={() => scaleAround(0.8)} title="Zoom in" aria-label="Zoom in">+</button>
                <button onClick={() => scaleAround(1.25)} title="Zoom out" aria-label="Zoom out">−</button>
                <button className="ae-fit" onClick={fit} title="Fit to view">Fit</button>
              </div>
              <svg ref={svgRef} className="ae-svg" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} preserveAspectRatio="xMidYMid meet"
                   onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
                   role="img" aria-label="Asset knowledge graph">
                <g>{edges.filter(e => posById.has(e.src) && posById.has(e.dst)).map(e => {
                  const a = posById.get(e.src)!, b = posById.get(e.dst)!, st = EDGE[edgeStyleKey(e)]
                  const dim = sel && e.src !== sel && e.dst !== sel
                  return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={st.c} strokeWidth={e.type === 'same_as' ? 2.2 : 1.6} strokeDasharray={st.dash || undefined} strokeLinecap="round" opacity={dim ? 0.25 : 1} className={e.status === 'pending' ? 'ae-pulse' : undefined} />
                })}</g>
                <g>{placed.map(n => {
                  const k = KIND[n.kind]; const selected = n.id === sel
                  const hasPending = edges.some(e => e.type === 'same_as' && e.status === 'pending' && (e.src === n.id || e.dst === n.id))
                  return (
                    <g key={n.id} className="ae-node" tabIndex={0} role="button" aria-label={`${n.label}, ${k.label}`}
                       onClick={() => setSel(n.id)} onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setSel(n.id) } }}>
                      {selected && <circle cx={n.x} cy={n.y} r={k.r + 6} fill="none" stroke="var(--accent)" strokeWidth={2} />}
                      <circle cx={n.x} cy={n.y} r={k.r} fill={k.c} stroke="var(--surface)" strokeWidth={2.5} />
                      {hasPending && <><circle cx={n.x + k.r - 3} cy={n.y - k.r + 3} r={7} fill="var(--amber)" stroke="var(--surface)" strokeWidth={2} /><text x={n.x + k.r - 3} y={n.y - k.r + 6.5} textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">!</text></>}
                      <text x={n.x} y={n.y + k.r + 15} textAnchor="middle" className={'ae-nlabel' + (k.mono ? ' mono' : '')}>{trunc(n.label, 16)}</text>
                      <text x={n.x} y={n.y + k.r + 28} textAnchor="middle" className="ae-nsub">{k.label}</text>
                    </g>
                  )
                })}</g>
              </svg>
              <div className="ae-legend">
                <span className="ae-lh">Edges</span>
                <Lg c="var(--border2)" label="contains" />
                <Lg c="var(--green)" label="same-as · verified" />
                <Lg c="var(--amber)" dash label="same-as · pending" />
                <Lg c="var(--blue)" dash label="measured-on" />
                <Lg c="var(--purple)" dash label="manual" />
                <span className="ae-hinttip">scroll to zoom · drag to pan</span>
              </div>
            </div>

            <div className="ae-card ae-insp" aria-live="polite">
              {!selNode ? <p className="ae-muted">Select a node to inspect it.</p> : (
                <>
                  <div className="ae-khead"><span className="ae-kdot" style={{ background: KIND[selNode.kind].c }} /><span className="ae-section">{KIND[selNode.kind].label}</span></div>
                  <h2 className={'ae-h2' + (KIND[selNode.kind].mono ? ' mono' : '')}>{selNode.label}</h2>
                  <div className="ae-chips"><span className="ae-chip">{selNode.source_type}</span>{selNode.props.source ? <span className="ae-chip">{String(selNode.props.source)}</span> : null}</div>

                  {Object.keys(selNode.props).filter(k => k !== 'source').length > 0 && <>
                    <div className="ae-section-l">Properties</div>
                    <div className="ae-kv">{Object.entries(selNode.props).filter(([k]) => k !== 'source').map(([k, v]) => (
                      <div className="ae-row" key={k}><span>{k}</span><span>{String(v)}</span></div>
                    ))}</div>
                  </>}

                  {selNeighbours.length > 0 && <>
                    <div className="ae-section-l">Links ({selNeighbours.length})</div>
                    <div className="ae-links">{selNeighbours.map(({ node, edge }) => (
                      <button key={edge.id} className="ae-lrow" onClick={() => setSel(node.id)}>
                        <span className={KIND[node.kind].mono ? 'mono' : ''}>{trunc(node.label, 22)}</span>
                        <span className="ae-et">{EDGE[edgeStyleKey(edge)].label}</span>
                      </button>
                    ))}</div>
                  </>}

                  {selPending && <div className="ae-review">
                    <div className="ae-rh">⚠ Pending identity match</div>
                    <p>Are these the same physical asset across sources?</p>
                    <div className="ae-ev">{selPending.edge.evidence}{selPending.edge.confidence != null ? ` · confidence ${selPending.edge.confidence.toFixed(2)}` : ''}</div>
                    {isAdmin ? <div className="ae-ra">
                      <button className="ok" disabled={busy} onClick={() => resolve(selPending.edge.id, true)}>Confirm link</button>
                      <button className="no" disabled={busy} onClick={() => resolve(selPending.edge.id, false)}>Reject</button>
                    </div> : <p className="ae-muted">Only an admin can verify matches.</p>}
                  </div>}

                  <div className="ae-hint">The amber “!” marks an unverified cross-source match. Confirming it joins the two records into one asset; rejecting leaves them separate.</div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}

function Lg({ c, dash, label }: { c: string; dash?: boolean; label: string }) {
  return <span className="ae-li"><span className="ae-swl" style={{ borderTopColor: c, borderTopStyle: dash ? 'dashed' : 'solid' }} />{label}</span>
}
function trunc(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + '…' : s }

const AE_CSS = `
.ae-wrap{display:flex;flex-direction:column;flex:1;min-height:0;padding:16px 20px 18px;overflow:hidden}
.ae-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:12px;flex:none}
.ae-h1{margin:0;font-size:20px;font-weight:600;color:var(--text)}
.ae-sub{margin:4px 0 0;font-size:12.5px;color:var(--text3)}
.ae-actions{display:flex;align-items:center;gap:10px}
.ae-badge{font-size:11px;font-weight:600;color:var(--amber-t,var(--amber));background:var(--amber-bg);border:1px solid var(--amber);border-radius:999px;padding:3px 10px}
.ae-btn{font-size:12.5px;font-weight:600;padding:7px 13px;border-radius:var(--radius,8px);border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer}
.ae-btn.primary{background:var(--accent);color:var(--accent-fg,#fff);border-color:var(--accent)}
.ae-btn:disabled{opacity:.6;cursor:default}
.ae-err{background:var(--red-bg);color:var(--red-t,var(--red));border:1px solid var(--red);border-radius:8px;padding:10px 12px;font-size:12.5px;margin-bottom:12px;flex:none}
.ae-empty{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:48px 32px;text-align:center;color:var(--text3);max-width:560px;margin:40px auto}
.ae-empty-title{font-size:16px;font-weight:600;color:var(--text);margin-bottom:8px}
.ae-empty p{font-size:13px;margin:0 0 16px}
.ae-muted{color:var(--text4);font-size:12px}
.ae-stage{display:grid;grid-template-columns:1fr 320px;gap:16px;align-items:stretch;flex:1;min-height:0}
@media (max-width:860px){.ae-stage{grid-template-columns:1fr;overflow:auto}}
.ae-card{background:var(--surface);border:1px solid var(--border);border-radius:14px}
.ae-canvas{position:relative;display:flex;flex-direction:column;min-height:0;overflow:hidden}
.ae-svg{flex:1;min-height:0;width:100%;display:block;cursor:grab;touch-action:none;
  background-color:var(--bg);
  background-image:radial-gradient(var(--border) 0.9px, transparent 0.9px);
  background-size:22px 22px}
.ae-svg:active{cursor:grabbing}
.ae-zoombar{position:absolute;top:10px;left:10px;z-index:5;display:flex;flex-direction:column;gap:5px}
.ae-zoombar button{width:30px;height:30px;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:8px;cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;box-shadow:var(--shadow-sm,0 1px 2px rgba(0,0,0,.1))}
.ae-zoombar button.ae-fit{font-size:11px;font-weight:600;height:26px;width:auto;padding:0 8px}
.ae-zoombar button:hover{border-color:var(--border2)}
.ae-node{cursor:pointer}
.ae-node:focus-visible{outline:none}
.ae-nlabel{font-family:var(--font-sans);font-size:11px;fill:var(--text)}
.ae-nlabel.mono{font-family:var(--font-mono);font-size:10px}
.ae-nsub{font-family:var(--font-sans);font-size:8.5px;fill:var(--text4);letter-spacing:.04em;text-transform:uppercase}
.ae-pulse{animation:aepulse 1.8s ease-in-out infinite}
@keyframes aepulse{0%,100%{opacity:.4}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){.ae-pulse{animation:none}}
.ae-legend{display:flex;flex-wrap:wrap;gap:9px 15px;align-items:center;padding:10px 14px;border-top:1px solid var(--border);flex:none}
.ae-lh{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--text4);font-weight:600}
.ae-li{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text2)}
.ae-swl{width:22px;border-top-width:2px;flex:none}
.ae-hinttip{margin-left:auto;font-size:11px;color:var(--text4)}
.ae-insp{padding:16px;overflow:auto;min-height:0}
.ae-khead{display:flex;align-items:center;gap:8px}
.ae-kdot{width:11px;height:11px;border-radius:50%;flex:none}
.ae-section{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--text4);font-weight:600}
.ae-h2{margin:2px 0 0;font-size:16px;font-weight:600;color:var(--text);word-break:break-all}
.ae-h2.mono{font-family:var(--font-mono);font-size:15px}
.ae-chips{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 4px}
.ae-chip{font-size:10.5px;font-weight:600;padding:3px 8px;border-radius:999px;border:1px solid var(--border);color:var(--text3)}
.ae-section-l{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--text4);font-weight:600;margin:16px 0 6px}
.ae-kv{display:flex;flex-direction:column;gap:5px}
.ae-row{display:flex;justify-content:space-between;gap:12px;font-size:12.5px;border-bottom:1px dashed var(--border);padding-bottom:5px;color:var(--text2)}
.ae-row span:first-child{color:var(--text4)}
.ae-row span:last-child{text-align:right;word-break:break-all}
.ae-links{display:flex;flex-direction:column;gap:6px}
.ae-lrow{display:flex;align-items:center;gap:8px;font-size:12px;background:var(--bg2,var(--surface2));border:1px solid var(--border);border-radius:8px;padding:6px 9px;cursor:pointer;text-align:left;color:var(--text);width:100%}
.ae-lrow:hover{border-color:var(--border2)}
.ae-lrow .mono{font-family:var(--font-mono);font-size:11px}
.ae-et{font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--text4);margin-left:auto;white-space:nowrap}
.ae-review{margin-top:14px;border:1px solid var(--amber);background:var(--amber-bg);border-radius:11px;padding:13px}
.ae-rh{font-size:12px;font-weight:600;color:var(--amber-t,var(--amber))}
.ae-review p{margin:8px 0;font-size:12px;color:var(--text2)}
.ae-ev{font-size:11px;color:var(--text3);margin-bottom:12px}
.ae-ra{display:flex;gap:8px}
.ae-ra button{flex:1;font-size:12px;font-weight:600;padding:7px;border-radius:8px;cursor:pointer;border:1px solid var(--border)}
.ae-ra .ok{background:var(--green);color:#fff;border-color:var(--green)}
.ae-ra .no{background:transparent;color:var(--text)}
.ae-ra button:disabled{opacity:.6}
.ae-hint{font-size:11.5px;color:var(--text4);margin-top:16px;border-top:1px solid var(--border);padding-top:12px}
`

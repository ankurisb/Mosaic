// -- lib/rca.ts ------------------------------------------------------------
// RCA type definitions, intent detection, output parser, system prompt

// -- Per-renderer data shapes ----------------------------------------------

export interface ParetoRow        { cat: string; defects: number; vital: boolean }
export interface BreakdownRow     { cat: string; defects: number; share: number; cumulative: number; cls: 'vital'|'useful' }
export interface SubcauseRow      { cause: string; sub: string; defects: number; share_bone: number; share_all: number; cum: number; cls: 'root'|'vital'|'useful' }
export interface Bone             { name: string; causes: string[] }
export interface WhyStep          { label: string; type: 'problem'|'why'|'root'; head: string; detail: string }
export interface CapAction        { n: number; action: string; cause: string; owner: string; due: string; priority: 'critical'|'high'|'medium'; status: 'progress'|'overdue'|'planned' }
export interface SpcSubgroup      { t: string; mean: number; range: number; oor?: boolean }
export interface FtEvent          { id: string; label: string; prob: number; root?: boolean }
export interface D8Item           { d: string; title: string; color: string; status: 'complete'|'in_progress'|'planned'; body: string }
export interface TrendSeries      { label: string; color: string; points: number[]; axis?: 'left'|'right' }
export interface ScatterPoint     { x: number; y: number }
export interface TimelineEvent    { time: string; type: 'normal'|'alarm'|'action'|'root'; label: string; detail: string; badge?: 'alarm'|'action'|'root' }
export interface FmeaRow          { mode: string; effect: string; cause: string; S: number; O: number; D: number; controls: string; action: string; who: string; due: string }
export interface ComparisonMetric { name: string; vals: string[]; delta: (number|null)[]; good_direction: 'up'|'down'|null }
export interface CapHistBin       { x: number; count: number }
export interface OeeLoss          { name: string; pct: number; kind: 'availability'|'performance'|'quality' }

// -- Renderer payload union ------------------------------------------------

export type RendererPayload =
  | { type: 'pareto';     data: { rows: ParetoRow[]; total: number } }
  | { type: 'breakdown';  data: { rows: BreakdownRow[] } }
  | { type: 'subcause';   data: { bone: string; rows: SubcauseRow[]; total: number } }
  | { type: 'fishbone';   data: { problem: string; bones: Bone[] } }
  | { type: 'five_whys';  data: { drilling: string; chain: WhyStep[] } }
  | { type: 'cap';        data: { root: string; actions: CapAction[] } }
  | { type: 'spc';        data: { title: string; nominal: number; ucl: number; lcl: number; uwl: number; lwl: number; subgroups: SpcSubgroup[]; violations: string[] } }
  | { type: 'fault_tree'; data: { top: string; events: FtEvent[] } }
  | { type: '8d';         data: { problem: string; opened: string; items: D8Item[] } }
  | { type: 'trend';      data: { title: string; series: TrendSeries[]; labels: string[]; event_idx?: number } }
  | { type: 'scatter';    data: { title: string; xLabel: string; yLabel: string; r: number; r2: number; points: ScatterPoint[]; tolerance_y?: number } }
  | { type: 'timeline';   data: { title: string; events: TimelineEvent[] } }
  | { type: 'fmea';       data: { title: string; rows: FmeaRow[] } }
  | { type: 'comparison'; data: { title: string; cols: string[]; metrics: ComparisonMetric[] } }
  | { type: 'capability'; data: { title: string; lsl: number; usl: number; target?: number; mean: number; std: number; cp: number; cpk: number; bins: CapHistBin[]; rating?: string } }
  | { type: 'oee_waterfall'; data: { title: string; oee: number; availability: number; performance: number; quality: number; losses: OeeLoss[]; benchmark?: number } }

export type RcaRendererItem = RendererPayload & { insight?: string }
export interface RcaAction { id: string; label: string }
// A data-aware "next best view" suggestion. The model emits these ONLY when it
// already holds the data to fully populate that renderer, so tapping the chip
// reliably produces a populated view. `renderer` is the RendererPayload type.
export interface SuggestedView { label: string; renderer: string }
export interface RcaBlock { renderers: RcaRendererItem[]; actions?: RcaAction[]; suggested_views?: SuggestedView[] }

// -- Known action IDs (have real handlers in the UI) -----------------------
// All other action IDs are routed back to Claude as a follow-up message
export const KNOWN_ACTION_IDS = ['export_word', 'export_pdf', 'mark_complete', 'share'] as const
export type KnownActionId = typeof KNOWN_ACTION_IDS[number]

// -- Intent detection ------------------------------------------------------

const RCA_KEYWORDS = [
  'root cause','rca','5 why','five why','fishbone','ishikawa',
  'pareto','defect','downtime','failure','fault','rejection',
  'quality issue','why did','what caused','corrective action',
  'fmea','8d','spc','control chart','out of control',
  'oee drop','breakdown analysis','failure analysis',
  'scrap','rework','near miss','incident','bearing failure',
  'capability','cpk','cp k','process capable','meeting spec','out of spec',
  'oee','oee breakdown','oee loss','availability','performance loss',
]

export function isRcaQuery(text: string): boolean {
  const lower = text.toLowerCase()
  return RCA_KEYWORDS.some(kw => lower.includes(kw))
}

// -- Always-on structured-view catalog -------------------------------------
// Injected into EVERY chat (small — one line per renderer). This removes the
// keyword-gate problem: the model always KNOWS these structured manufacturing
// views exist, so it can reach for them by judgement (like any tool) instead of
// only when the user happens to type a magic keyword. The FULL schemas
// (RCA_SYSTEM_PROMPT) are still injected only when the model is actually doing
// structured analysis, to keep the everyday prompt small.
//
// Deliberately CONSERVATIVE: the instruction tells the model to use these only
// for genuine data-grounded manufacturing analysis, not casual questions — and
// the parser drops any renderer it can't fully populate, so a marginal choice
// degrades to prose rather than an empty diagram.
export const RCA_CATALOG = `

## Structured analysis views (manufacturing / quality / operations)
Beyond simple charts (render_chart: bar/line/pie/kpi/table), you can render rich,
domain-specific analysis views by appending an <rca_output> JSON block. Use these
ONLY when the user's question is a genuine operational/quality investigation AND you
have fetched real data that fully populates the view — never for casual or conceptual
questions, and never with invented data. Available views:
- pareto / breakdown / subcause — defect concentration (which causes dominate)
- fishbone — 6M cause categories for a quality problem
- five_whys — iterative root-cause drill-down
- fault_tree — hierarchical failure-path analysis
- spc — statistical process control chart (in/out of control)
- capability — Cp/Cpk histogram vs spec limits (is the process capable)
- oee_waterfall — OEE loss cascade (availability/performance/quality losses)
- trend / scatter — time trend / correlation of two variables
- timeline — event sequence reconstruction
- fmea — failure mode & effects (risk / RPN)
- 8d — formal structured investigation report
- comparison — batch / shift / period comparison table
- cap — corrective action plan

When one of these genuinely fits and your data supports it, produce the full
<rca_output> block (exact schemas will be provided). If a structured view does NOT
clearly fit, just answer normally in prose — do not force one.
`


// -- Parse <rca_output> block from raw assistant text ---------------------

export function parseRcaOutput(raw: string): { text: string; rca: RcaBlock | null } {
  const match = raw.match(/<rca_output>([\s\S]*?)<\/rca_output>/)
  if (!match) return { text: raw, rca: null }
  const text = raw.replace(/<rca_output>[\s\S]*?<\/rca_output>/, '').trim()
  try {
    const rca = JSON.parse(match[1].trim()) as RcaBlock
    // Drop renderers the AI emitted as a type placeholder but never populated (empty
    // or missing the primary data array). Rendering an empty fishbone/5-whys/CAP shell
    // looks broken to the user — better to omit it. Keeps only renderers with real
    // content, so the analysis always looks complete rather than half-empty. Also
    // filter out non-object/null entries so one bad element can't discard the block.
    if (rca && Array.isArray(rca.renderers)) {
      rca.renderers = rca.renderers.filter(r => r && typeof r === 'object' && hasRenderableData(r))
    } else if (rca) {
      rca.renderers = []
    }
    // Sanitise data-aware "next best view" suggestions: keep only valid, known
    // renderer types, never suggest a view already rendered in this response, and
    // hard-cap at 2 so the chips stay a helpful nudge rather than noise. A non-array
    // (or absent) suggested_views is coerced away so the client never .slice()s a string.
    if (rca && Array.isArray(rca.suggested_views)) {
      const rendered = new Set<string>((rca.renderers || []).map(r => r.type as string))
      const seen = new Set<string>()
      rca.suggested_views = rca.suggested_views
        .filter(s => s && typeof s === 'object' && typeof s.renderer === 'string' && VALID_RENDERER_TYPES.has(s.renderer))
        .filter(s => !rendered.has(s.renderer))
        .filter(s => { if (seen.has(s.renderer)) return false; seen.add(s.renderer); return true })
        .map(s => ({ renderer: s.renderer, label: String(s.label || '').slice(0, 40) || defaultViewLabel(s.renderer) }))
        .slice(0, 2)
    } else if (rca) {
      rca.suggested_views = []
    }
    // Nothing renderable AND nothing to suggest → treat as plain prose.
    if ((!rca.renderers || !rca.renderers.length) && (!rca.suggested_views || !rca.suggested_views.length)) {
      return { text, rca: null }
    }
    return { text, rca }
  } catch {
    // Strip the tag even if JSON fails -- don't show raw JSON to user
    return { text, rca: null }
  }
}

const VALID_RENDERER_TYPES = new Set([
  'pareto','breakdown','subcause','fishbone','five_whys','cap','spc','fault_tree',
  '8d','trend','scatter','timeline','fmea','comparison','capability','oee_waterfall',
])

function defaultViewLabel(type: string): string {
  const labels: Record<string, string> = {
    pareto: 'View as Pareto', breakdown: 'View 6M breakdown', subcause: 'Drill into sub-causes',
    fishbone: 'View as fishbone', five_whys: 'Run 5 Whys', cap: 'Build action plan',
    spc: 'View SPC chart', fault_tree: 'View fault tree', '8d': 'Open 8D report',
    trend: 'View trend', scatter: 'View correlation', timeline: 'View timeline',
    fmea: 'Run FMEA', comparison: 'Compare', capability: 'View Cpk analysis',
    oee_waterfall: 'View OEE waterfall',
  }
  return labels[type] || 'View analysis'
}

// The primary content array (or key field) each renderer needs to be worth showing.
// A renderer whose primary array is missing/empty is a placeholder the AI didn't fill.
function hasRenderableData(r: RcaRendererItem): boolean {
  const d = (r as { data?: Record<string, unknown> }).data
  if (!d || typeof d !== 'object') return false
  const nonEmpty = (v: unknown) => Array.isArray(v) && v.length > 0
  switch (r.type) {
    case 'pareto':
    case 'breakdown':
    case 'subcause':
    case 'fmea':      return nonEmpty(d.rows)
    case 'fishbone':  return nonEmpty(d.bones)
    case 'five_whys': return nonEmpty(d.chain)
    case 'cap':       return nonEmpty(d.actions)
    case 'spc':       return nonEmpty(d.subgroups)
    case 'fault_tree':
    case 'timeline':  return nonEmpty(d.events)
    case '8d':        return nonEmpty(d.items)
    case 'trend':     return nonEmpty(d.series) && nonEmpty(d.labels)
    case 'scatter':   return nonEmpty(d.points)
    case 'comparison':return nonEmpty(d.metrics)
    case 'capability':return nonEmpty(d.bins)
    case 'oee_waterfall': return nonEmpty(d.losses)
    default:          return true
  }
}

// -- System prompt injection -----------------------------------------------

export const RCA_SYSTEM_PROMPT = `

## RCA Analysis Mode

When the user asks about root causes, defects, failures, downtime, quality issues, or any manufacturing problem, follow this protocol:

**Step 1 -- Query data first.** Use the available database and API tools to gather real evidence before analysing. Never invent numbers.

**Step 2 -- Select the minimum necessary renderers:**
- "What is causing most defects?"  pareto + breakdown
- "Why did X happen?"  fishbone + five_whys + cap
- "Is the process in control?"  spc
- "What happened in the sequence?"  timeline
- "Full RCA / give me everything"  pareto + fishbone + subcause + five_whys + spc + cap
- "Compare batches / periods"  comparison
- "Risk assessment"  fmea
- "Formal investigation report"  8d
- "Is the process capable / Cpk / meeting spec?"  capability
- "OEE breakdown / where are the losses / OEE drop"  oee_waterfall

**Step 3 -- Write your analysis** as normal conversational text. Do NOT include any suggested next steps, action items, or options for the user to choose from in your text — these go exclusively in the actions array inside <rca_output>. End your text with a summary sentence only.

**Step 4 -- Append a structured JSON block** at the very end, inside <rca_output> tags. This is parsed by the app and rendered as interactive charts -- do not describe the JSON in your text, just append it silently.

### Output format

<rca_output>
{
  "renderers": [
    {
      "type": "pareto",
      "insight": "One sentence key insight -- what this renderer reveals",
      "data": { ... }
    }
  ],
  "actions": [
    { "id": "export_word", "label": "Export as Word doc" },
    { "id": "export_pdf", "label": "Export as PDF report" },
    { "id": "overlay_spc", "label": "Overlay on SPC chart" }
  ],
  "suggested_views": [
    { "renderer": "fishbone", "label": "View as fishbone" }
  ]
}
</rca_output>

### Renderer types and exact data shapes

pareto       { rows: [{cat, defects, vital:bool}], total }
breakdown    { rows: [{cat, defects, share, cumulative, cls:"vital"|"useful"}] }
subcause     { bone:"Measurement", total:248, rows:[{cause, sub, defects, share_bone, share_all, cum, cls:"root"|"vital"|"useful"}] }
fishbone     { problem:"...", bones:[{name:"Machine", causes:["c1","c2","c3"]}, ...] }  // always 6 bones (5M1E)
five_whys    { drilling:"top cause", chain:[{label:"Problem",type:"problem",head:"...",detail:"..."}, ..., {label:"Root",type:"root",...}] }
cap          { root:"root cause statement", actions:[{n,action,cause,owner,due,priority:"critical"|"high"|"medium",status:"progress"|"overdue"|"planned"}] }
spc          { title, nominal, ucl, lcl, uwl, lwl, subgroups:[{t,mean,range,oor?}], violations:["rule description"] }
fault_tree   { top:"top event", events:[{id,label,prob:0-100,root?}] }
8d           { problem, opened:"date string", items:[{d:"D1",title,color:"#hex",status:"complete"|"in_progress"|"planned",body}] }
trend        { title, labels:[...8 strings], event_idx?:number, series:[{label,color:"#hex",points:[...numbers],axis?:"right"}] }
scatter      { title, xLabel, yLabel, r:0.82, r2:0.67, points:[{x,y}], tolerance_y? }
timeline     { title, events:[{time:"HH:MM",type:"normal"|"alarm"|"action"|"root",label,detail,badge?:"alarm"|"action"|"root"}] }
fmea         { title, rows:[{mode,effect,cause,S:1-10,O:1-10,D:1-10,controls,action,who,due}] }
comparison   { title, cols:["Batch A","Batch B",...], metrics:[{name,vals:[...strings],delta:[null|number,...],good_direction:"up"|"down"|null}] }
capability   { title, lsl, usl, target?, mean, std, cp, cpk, rating?, bins:[{x:binCentre, count}] }  // process-capability histogram vs spec limits. Compute cp/cpk from mean/std/lsl/usl. bins: 8-12 histogram bins across the data range.
oee_waterfall{ title, oee, availability, performance, quality, benchmark?, losses:[{name, pct, kind:"availability"|"performance"|"quality"}] }  // OEE loss cascade. availability/performance/quality/oee are 0-100. losses sum with oee to ~100; pct is the % lost to each factor.

### Rules
- CRITICAL: only include a renderer if you FULLY populate its data in the same block. Never emit a renderer with an empty or partial data object — an empty fishbone/five_whys/cap renders as a broken, empty diagram. If you can't fully fill a diagram's data, omit that renderer entirely. Prefer 2 complete diagrams over 5 half-empty ones.
- Always include an "insight" string -- one plain-English sentence per renderer
- never fabricate data -- query connected sources first
- cap always comes last if included
- All numeric values must be numbers not strings
- fishbone bones: use exactly these names when applicable: Machine, Method, Material, Manpower, Measurement, Environment
- fishbone causes are DIAGRAM LABELS, not sentences: each cause MUST be 2-3 words / under 18 characters (e.g. "Tool wear", "Thermal growth", "Gauge drift", "Coolant temp drift"). Longer labels overflow and overlap on the diagram and make it unreadable. Max 3 causes per bone. Put all detail/explanation in your conversational text or the "insight" — NEVER in the cause label. Keep timeline/fault_tree/5-whys head labels equally terse.
- Always include an "actions" array with 2-4 contextually relevant next steps. NEVER add any text after your analysis — no suggested next steps, no export options, no button labels in the text. All next steps go in the actions array only. Built-in IDs: export_word (always include), mark_complete (include when CAP is shown), share. For contextual actions use a short snake_case id and a clear label — unknown IDs route back to you as follow-up messages automatically. End your conversational text before the <rca_output> block — nothing after it.

### Data-aware "next best view" suggestions (suggested_views)
When you answer a DATA-GROUNDED operational/quality question in prose (you queried real data or ran an analysis) but did NOT render a structured view, you MAY suggest 1-2 views the user could open on one tap. STRICT rules:
- ONLY suggest a view if you ALREADY HAVE, in this conversation, the exact data needed to FULLY populate it. If tapping it would require more data you don't have, do NOT suggest it. Never suggest a view you couldn't immediately produce populated.
- Only on data-grounded answers. Never suggest views on casual, conceptual, or non-manufacturing questions.
- Max 2. Never suggest a view you already rendered in this same response.
- Emit them in the suggested_views array inside <rca_output> (you can send an <rca_output> block with ONLY suggested_views and an empty renderers array — that's valid for a prose answer). Use short labels ("View as fishbone", "View Cpk analysis").
- When in doubt, omit — a missing suggestion is fine; a suggestion that opens an empty view is not.
- Do NOT mention these suggestions in your prose text; they render as chips automatically.
`

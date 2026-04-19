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

export type RcaRendererItem = RendererPayload & { insight?: string }
export interface RcaBlock { renderers: RcaRendererItem[] }

// -- Intent detection ------------------------------------------------------

const RCA_KEYWORDS = [
  'root cause','rca','5 why','five why','fishbone','ishikawa',
  'pareto','defect','downtime','failure','fault','rejection',
  'quality issue','why did','what caused','corrective action',
  'fmea','8d','spc','control chart','out of control',
  'oee drop','breakdown analysis','failure analysis',
  'scrap','rework','near miss','incident','bearing failure',
]

export function isRcaQuery(text: string): boolean {
  const lower = text.toLowerCase()
  return RCA_KEYWORDS.some(kw => lower.includes(kw))
}

// -- Parse <rca_output> block from raw assistant text ---------------------

export function parseRcaOutput(raw: string): { text: string; rca: RcaBlock | null } {
  const match = raw.match(/<rca_output>([\s\S]*?)<\/rca_output>/)
  if (!match) return { text: raw, rca: null }
  try {
    const rca = JSON.parse(match[1].trim()) as RcaBlock
    const text = raw.replace(/<rca_output>[\s\S]*?<\/rca_output>/, '').trim()
    return { text, rca }
  } catch {
    // Strip the tag even if JSON fails -- don't show raw JSON to user
    const text = raw.replace(/<rca_output>[\s\S]*?<\/rca_output>/, '').trim()
    return { text, rca: null }
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

**Step 3 -- Write your analysis** as normal conversational text.

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

### Rules
- Always include an "insight" string -- one plain-English sentence per renderer
- never fabricate data -- query connected sources first
- cap always comes last if included
- All numeric values must be numbers not strings
- fishbone bones: use exactly these names when applicable: Machine, Method, Material, Manpower, Measurement, Environment
`

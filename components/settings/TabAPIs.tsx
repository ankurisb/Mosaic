'use client'
import { useState, useEffect, useRef } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, INP, SEL, Btn, Badge, Field, Grid, Alert, Spinner } from './ui'

interface ApiService { id: string; label: string; base_url: string; environment: string; auth_type: string; rate_limit_rpm: number; request_timeout_ms: number; retry_count: number }
interface ApiConn { id: string; service_id: string; label: string; description: string; base_path: string; pagination_style: string }

interface TryItState {
  serviceId: string
  connectionId: string | null
  method: string
  path: string
  queryParams: Array<{ key: string; value: string }>
  bodyText: string
  customHeaders: Array<{ key: string; value: string }>
}

interface TryItResult {
  ok: boolean
  status: number
  statusText?: string
  latencyMs: number
  url: string
  headers?: Record<string, string>
  body?: unknown
  error?: string
}

interface PostmanCollection {
  info: { name: string }
  item: Array<{
    name: string
    request: {
      method: string
      url: { raw: string; path?: string[] }
      auth?: { type: string; bearer?: Array<{ key: string; value: string }> }
      header?: Array<{ key: string; value: string }>
    }
  }>
}

interface ImportPreview {
  serviceName: string
  baseUrl: string
  authType: string
  token: string
  connections: Array<{ name: string; path: string; method: string }>
}

const SVC_EMPTY = { label: '', base_url: '', environment: 'production', auth_type: 'bearer', token: '', header_name: '', header_value: '', username: '', password: '', client_id: '', client_secret: '', token_url: '', refresh_token: '', header_prefix: 'Bearer', custom_headers: '', api_version: '', version_header: '', rate_limit_rpm: '', request_timeout_ms: '30000', retry_count: '3' }
const CONN_EMPTY = { label: '', description: '', base_path: '', pagination_style: 'none', pagination_limit_param: 'limit', pagination_cursor_param: 'cursor', pagination_data_path: '' }

// SAP endpoint definitions with V2 and V4 paths where confirmed.
// V4 paths use SAP's srvd_a2x pattern -- only listed where confirmed in SAP API Business Hub.
// activate_txn = transaction in /IWFND/MAINT_SERVICE to search for (on-prem only).
// v4_activate_txn = /IWBEP/V4_ADMIN (register) + /IWFND/V4_ADMIN (publish) for V4 services.
const SAP_CONNECTIONS: Array<{
  label: string; cat: string; desc: string;
  v2: string; v4: string | null; v4confirmed: boolean;
  activate_svc: string;
  example_filter: string;
}> = [
  // -- Production -------------------------------------------------------------
  {
    label: 'Production Orders',
    cat: 'Production',
    desc: 'Production orders -- status, quantities, dates, plant',
    v2: '/sap/opu/odata/sap/API_PRODUCTION_ORDER_SRV/A_ProductionOrder',
    v4: '/sap/opu/odata4/sap/api_production_order_2/srvd_a2x/sap/productionorder/0001/ProductionOrder',
    v4confirmed: true,
    activate_svc: 'API_PRODUCTION_ORDER_SRV',
    example_filter: "$filter=Plant eq '1000' and SystemStatus eq 'REL'&$top=20",
  },
  {
    label: 'Production Order Operations',
    cat: 'Production',
    desc: 'Operations, work centres, and confirmed quantities per order',
    v2: '/sap/opu/odata/sap/API_PRODUCTION_ORDER_SRV/A_ProductionOrderOperation',
    v4: '/sap/opu/odata4/sap/api_production_order_2/srvd_a2x/sap/productionorder/0001/ProductionOrderOperation',
    v4confirmed: true,
    activate_svc: 'API_PRODUCTION_ORDER_SRV',
    example_filter: "$filter=ManufacturingOrder eq '000010001234'",
  },
  {
    label: 'Manufacturing Orders',
    cat: 'Production',
    desc: 'Manufacturing orders with BOM components and statuses',
    v2: '/sap/opu/odata/sap/API_MANUFACTURING_ORDER_SRV/A_ManufacturingOrder',
    v4: null,
    v4confirmed: false,
    activate_svc: 'API_MANUFACTURING_ORDER_SRV',
    example_filter: "$filter=Plant eq '1000'&$top=50",
  },

  // -- Plant Maintenance --------------------------------------------------------
  {
    label: 'Equipment',
    cat: 'Plant Maintenance',
    desc: 'Technical objects -- machines, instruments, vehicles',
    v2: '/sap/opu/odata/sap/API_EQUIPMENT_SRV/A_Equipment',
    v4: null,
    v4confirmed: false,
    activate_svc: 'API_EQUIPMENT_SRV',
    example_filter: "$filter=Plant eq '1000' and EquipmentCategory eq 'M'&$top=100",
  },
  {
    label: 'Functional Locations',
    cat: 'Plant Maintenance',
    desc: 'Plant structure -- areas, lines, cells in the functional hierarchy',
    v2: '/sap/opu/odata/sap/API_FUNCTIONALLOCATION_SRV/A_FunctionalLocation',
    v4: null,
    v4confirmed: false,
    activate_svc: 'API_FUNCTIONALLOCATION_SRV',
    example_filter: "$filter=Plant eq '1000'",
  },
  {
    label: 'Maintenance Orders',
    cat: 'Plant Maintenance',
    desc: 'PM work orders -- planned, corrective, and preventive maintenance',
    v2: '/sap/opu/odata/sap/API_MAINTENANCEORDER_SRV/MaintenanceOrder',
    v4: null,
    v4confirmed: false,
    activate_svc: 'API_MAINTENANCEORDER_SRV',
    example_filter: "$filter=MaintenancePlant eq '1000' and OrderType eq 'PM01'&$top=20",
  },
  {
    label: 'Maintenance Notifications',
    cat: 'Plant Maintenance',
    desc: 'Breakdowns, malfunctions, and maintenance requests',
    v2: '/sap/opu/odata/sap/API_MAINTNOTIFICATION/MaintenanceNotification',
    v4: null,
    v4confirmed: false,
    activate_svc: 'API_MAINTNOTIFICATION',
    example_filter: "$filter=MaintenancePlant eq '1000' and NotifType eq 'M1'&$top=20",
  },

  // -- Quality Management -------------------------------------------------------
  {
    label: 'Inspection Results',
    cat: 'Quality Management',
    desc: 'Characteristic results and defects per inspection lot',
    v2: '/sap/opu/odata/sap/API_QUALITYINSPECTIONRESULT_SRV/A_InspectionResult',
    v4: null,
    v4confirmed: false,
    activate_svc: 'API_QUALITYINSPECTIONRESULT_SRV',
    example_filter: "$filter=InspectionLot eq '10000001'",
  },
  {
    label: 'Inspection Lots',
    cat: 'Quality Management',
    desc: 'QM inspection lots -- usage decisions and stock postings',
    v2: '/sap/opu/odata/sap/API_INSPECTIONLOT_SRV/A_InspectionLot',
    v4: null,
    v4confirmed: false,
    activate_svc: 'API_INSPECTIONLOT_SRV',
    example_filter: "$filter=Plant eq '1000' and InspectionLotStatus eq 'REL'&$top=20",
  },

  // -- Inventory & Materials ----------------------------------------------------
  {
    label: 'Material Stock',
    cat: 'Inventory',
    desc: 'Stock levels by material, plant, and storage location',
    v2: '/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod',
    v4: null,
    v4confirmed: false,
    activate_svc: 'API_MATERIAL_STOCK_SRV',
    example_filter: "$filter=Material eq 'MAT-001' and Plant eq '1000'",
  },
  {
    label: 'Material Master',
    cat: 'Inventory',
    desc: 'Material master data -- descriptions, units, MRP settings',
    v2: '/sap/opu/odata/sap/API_PRODUCT_SRV/A_Product',
    v4: '/sap/opu/odata4/sap/api_product/srvd_a2x/sap/product/0002/Product',
    v4confirmed: true,
    activate_svc: 'API_PRODUCT_SRV',
    example_filter: "$filter=Plant eq '1000' and MaterialType eq 'FERT'&$top=50",
  },
  {
    label: 'Goods Movements',
    cat: 'Inventory',
    desc: 'Material documents -- GR, GI, and stock transfers (mvt 101/261/262)',
    v2: '/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader',
    v4: '/sap/opu/odata4/sap/api_material_document/srvd_a2x/sap/materialdocument/0001/MaterialDocument',
    v4confirmed: true,
    activate_svc: 'API_MATERIAL_DOCUMENT_SRV',
    example_filter: "$filter=Plant eq '1000' and GoodsMovementCode eq '01'&$top=50",
  },

  // -- Plant Data ---------------------------------------------------------------
  {
    label: 'Work Centres',
    cat: 'Plant Data',
    desc: 'Work centres, capacities, costing, and scheduling data',
    v2: '/sap/opu/odata/sap/API_WORK_CENTER_SRV/A_WorkCenter',
    v4: null,
    v4confirmed: false,
    activate_svc: 'API_WORK_CENTER_SRV',
    example_filter: "$filter=Plant eq '1000'",
  },
  {
    label: 'Plants',
    cat: 'Plant Data',
    desc: 'Plant master data -- addresses, calendars, storage locations',
    v2: '/sap/opu/odata/sap/API_PLANT_SRV/A_Plant',
    v4: null,
    v4confirmed: false,
    activate_svc: 'API_PLANT_SRV',
    example_filter: '$top=20',
  },
]

const PRESETS = [
  { label: 'HubSpot', base_url: 'https://api.hubapi.com', auth_type: 'oauth2_client', color: '#ff7a59', icon: 'H' },
  { label: 'Stripe', base_url: 'https://api.stripe.com', auth_type: 'bearer', color: '#635bff', icon: 'S' },
  { label: 'Salesforce', base_url: 'https://login.salesforce.com', auth_type: 'oauth2_client', color: '#0176d3', icon: 'SF' },
  { label: 'Slack', base_url: 'https://slack.com/api', auth_type: 'bearer', color: '#4a154b', icon: 'Sl' },
  { label: 'GitHub', base_url: 'https://api.github.com', auth_type: 'bearer', color: '#24292e', icon: 'GH' },
  { label: 'Notion', base_url: 'https://api.notion.com', auth_type: 'bearer', color: '#000', icon: 'N' },
  { label: 'Jira', base_url: 'https://yourorg.atlassian.net', auth_type: 'basic', color: '#0052cc', icon: 'J' },
  { label: 'SAP S/4HANA', base_url: '', auth_type: 'basic', color: '#0070f3', icon: 'SAP' },
  { label: 'Custom', base_url: '', auth_type: 'bearer', color: '#6b7280', icon: '+' },
]

function extractBaseUrl(rawUrl: string): { baseUrl: string; path: string } {
  try {
    const u = new URL(rawUrl.split('?')[0])
    const parts = u.pathname.split('/').filter(Boolean)
    // Heuristic: base URL = protocol + host + first path segment (e.g. /api)
    const base = parts.length > 0 ? `${u.protocol}//${u.host}/${parts[0]}` : `${u.protocol}//${u.host}`
    const path = '/' + parts.slice(1).join('/')
    return { baseUrl: base, path }
  } catch {
    return { baseUrl: rawUrl, path: '' }
  }
}

// Detect likely-expired or placeholder tokens in Postman imports
function tokenLooksExpired(token: string): { expired: boolean; warning?: boolean; reason: string | null } {
  if (!token || token.trim().length < 10) return { expired: false, reason: null }
  const t = token.trim()

  // JWT -- decode payload and check exp claim
  if (t.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      if (payload.exp) {
        const expMs = payload.exp * 1000
        const nowMs = Date.now()
        if (expMs < nowMs) {
          const daysAgo = Math.round((nowMs - expMs) / (1000 * 60 * 60 * 24))
          return { expired: true, reason: `JWT expired ${daysAgo === 0 ? 'today' : `${daysAgo} day${daysAgo !== 1 ? 's' : ''} ago`} (${new Date(expMs).toLocaleDateString()})` }
        }
        if (expMs < nowMs + 7 * 24 * 60 * 60 * 1000) {
          const daysLeft = Math.round((expMs - nowMs) / (1000 * 60 * 60 * 24))
          return { expired: false, warning: true, reason: `JWT expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}` }
        }
        return { expired: false, reason: null }
      }
    } catch {}
  }

  // Obvious test/placeholder patterns
  const testPatterns = [/^your[_-]?token/i, /^my[_-]?token/i, /^test[_-]?token/i, /^api[_-]?key/i, /^insert[_-]?token/i, /^replace[_-]?me/i, /^<.*token.*>/i, /^Bearer\s/i, /^\{\{.*\}\}$/, /^example/i, /^placeholder/i, /^xxxx+/i, /^sk_test_/i]
  for (const p of testPatterns) {
    if (p.test(t)) return { expired: true, reason: 'Looks like a placeholder -- replace with a real token before using in chat' }
  }

  if (t.length < 20) return { expired: true, reason: 'Token looks truncated or invalid (too short)' }
  return { expired: false, reason: null }
}

function parsePostmanCollection(json: PostmanCollection): ImportPreview | null {
  try {
    const items = json.item?.filter(i => i.request?.url?.raw) ?? []
    if (!items.length) return null

    // Derive base URL from first item
    const firstUrl = items[0].request.url.raw
    const { baseUrl } = extractBaseUrl(firstUrl)

    // Detect auth from first item that has bearer auth
    let authType = 'bearer'
    let token = ''
    for (const item of items) {
      const auth = item.request.auth
      if (auth?.type === 'bearer' && auth.bearer?.[0]?.value) {
        authType = 'bearer'
        token = auth.bearer[0].value
        break
      }
    }

    const connections = items.map(item => {
      const { path } = extractBaseUrl(item.request.url.raw)
      return {
        name: item.name,
        path: path || '/',
        method: item.request.method || 'GET',
      }
    })

    return {
      serviceName: json.info?.name ?? 'Imported Service',
      baseUrl,
      authType,
      token,
      connections,
    }
  } catch {
    return null
  }
}

export default function TabAPIs({ user }: { user: SessionUser }) {
  const [services, setServices] = useState<ApiService[]>([])
  const [connections, setConnections] = useState<ApiConn[]>([])
  const [loading, setLoading] = useState(true)
  const [showSvcForm, setShowSvcForm] = useState(false)
  const [svcForm, setSvcForm] = useState<Record<string, string>>(SVC_EMPTY)
  const [editingSvc, setEditingSvc] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showConnForm, setShowConnForm] = useState<string | null>(null)
  const [connForm, setConnForm] = useState<Record<string, string>>(CONN_EMPTY)
  const [editingConn, setEditingConn] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Try it state
  const [tryIt, setTryIt] = useState<TryItState | null>(null)
  const [tryResult, setTryResult] = useState<TryItResult | null>(null)
  const [tryLoading, setTryLoading] = useState(false)
  const [tryTab, setTryTab] = useState<'response'|'headers'>('response')
  const [tokenCopied, setTokenCopied] = useState(false)

  // SAP import state
  const [showSapForm, setShowSapForm] = useState(false)
  const [sapOdataVer, setSapOdataVer] = useState<'v2' | 'v4'>('v2')
  const [showSapActivation, setShowSapActivation] = useState(false)
  const [sapHost, setSapHost] = useState('')
  const [sapUser, setSapUser] = useState('')
  const [sapPass, setSapPass] = useState('')
  const [sapSelected, setSapSelected] = useState<Set<number>>(new Set(SAP_CONNECTIONS.map((_,i)=>i)))
  const [sapImporting, setSapImporting] = useState(false)
  const [sapError, setSapError] = useState('')

  // Postman import state
  const fileRef = useRef<HTMLInputElement>(null)
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importError, setImportError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importDragOver, setImportDragOver] = useState(false)

  async function load() { setLoading(true); const r = await fetch('/api/services'); if (r.ok) { const d = await r.json(); setServices(d.services); setConnections(d.connections) }; setLoading(false) }
  useEffect(() => { load() }, [])

  const setSvc = (k: string, v: string) => setSvcForm(p => ({ ...p, [k]: v }))
  const setConn = (k: string, v: string) => setConnForm(p => ({ ...p, [k]: v }))

  function buildAuth() {
    const t = svcForm.auth_type
    if (t === 'bearer') return { token: svcForm.token }
    if (t === 'api_key_header') return { header: svcForm.header_name, key: svcForm.header_value }
    if (t === 'basic') return { username: svcForm.username, password: svcForm.password }
    if (t === 'oauth2_client') return { client_id: svcForm.client_id, client_secret: svcForm.client_secret, token_url: svcForm.token_url, refresh_token: svcForm.refresh_token, header_prefix: svcForm.header_prefix || 'Bearer' }
    try { return JSON.parse(svcForm.custom_headers || '{}') } catch { return {} }
  }

  async function saveSvc() {
    if (!svcForm.label || !svcForm.base_url) { setError('Label and base URL are required'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: editingSvc ? 'updateService' : 'createService', id: editingSvc, ...svcForm, auth_config: buildAuth() }) })
      const d = await r.json().catch(() => ({ error: `Server returned ${r.status} ${r.statusText}` }))
      if (!r.ok) { setError(d.error || 'Save failed'); return }
      setShowSvcForm(false); setEditingSvc(null); setSvcForm(SVC_EMPTY); setError(''); load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error - service may not have saved')
    } finally {
      setSaving(false)
    }
  }

  async function saveConn(serviceId: string) {
    if (!connForm.label) { setError('Label is required'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: editingConn ? 'updateConnection' : 'createConnection', id: editingConn, service_id: serviceId, ...connForm }) })
      const d = await r.json().catch(() => ({ error: `Server returned ${r.status} ${r.statusText}` }))
      if (!r.ok) { setError(d.error || 'Save failed'); return }
      setShowConnForm(null); setEditingConn(null); setConnForm(CONN_EMPTY); setError(''); load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error - connection may not have saved')
    } finally {
      setSaving(false)
    }
  }

  async function delSvc(id: string, label: string) {
    if (!confirm(`Delete service "${label}" and all its connections?`)) return
    await fetch('/api/services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteService', id }) }); load()
  }

  async function delConn(id: string, label: string) {
    if (!confirm(`Delete "${label}"?`)) return
    await fetch('/api/services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteConnection', id }) }); load()
  }

  function handlePostmanFile(file: File) {
    setImportError('')
    setImportPreview(null)
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const json = JSON.parse(e.target?.result as string) as PostmanCollection
        const preview = parsePostmanCollection(json)
        if (!preview) { setImportError('Could not parse collection -- make sure it is a valid Postman v2.1 collection.'); return }
        setImportPreview(preview)
      } catch {
        setImportError('Invalid JSON file.')
      }
    }
    reader.readAsText(file)
  }

  function onFileDrop(e: React.DragEvent) {
    e.preventDefault(); setImportDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handlePostmanFile(file)
  }

  async function confirmImport() {
    if (!importPreview) return
    setImporting(true)
    try {
      // 1. Create the service
      const svcRes = await fetch('/api/services', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createService',
          label: importPreview.serviceName,
          base_url: importPreview.baseUrl,
          environment: 'production',
          auth_type: importPreview.authType,
          auth_config: { token: importPreview.token },
          request_timeout_ms: 30000,
          retry_count: 3,
        }),
      })
      const svcData = await svcRes.json()
      if (!svcRes.ok) throw new Error(svcData.error)
      const serviceId = svcData.id

      // 2. Create each connection
      for (const conn of importPreview.connections) {
        await fetch('/api/services', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'createConnection',
            service_id: serviceId,
            label: conn.name,
            description: `${conn.method} ${conn.path}`,
            base_path: conn.path,
            pagination_style: 'none',
          }),
        })
      }

      setImportPreview(null)
      setExpanded(prev => new Set([...prev, serviceId]))
      load()
    } catch (e) {
      setImportError((e instanceof Error ? e.message : 'Import failed'))
    }
    setImporting(false)
  }

  const toggle = (id: string) => setExpanded(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const envColor = (e: string): 'red'|'amber'|'green' => e === 'production' ? 'red' : e === 'sandbox' ? 'amber' : 'green'
  const preset = (label: string) => PRESETS.find(p => p.label === label)

  const authFields: Record<string, React.ReactNode> = {
    bearer: <Field label="Bearer token" hint="Sent as: Authorization: Bearer <token>"><input style={{ ...INP, fontFamily: 'var(--font-mono)', fontSize: 12 }} type="password" placeholder="Token or API key" value={svcForm.token} onChange={e => setSvc('token', e.target.value)} /></Field>,
    api_key_header: <Grid cols={2}><Field label="Header name"><input style={INP} placeholder="X-API-Key" value={svcForm.header_name} onChange={e => setSvc('header_name', e.target.value)} /></Field><Field label="API key"><input style={{ ...INP, fontFamily: 'var(--font-mono)', fontSize: 12 }} type="password" value={svcForm.header_value} onChange={e => setSvc('header_value', e.target.value)} /></Field></Grid>,
    basic: <Grid cols={2}><Field label="Username"><input style={INP} value={svcForm.username} onChange={e => setSvc('username', e.target.value)} /></Field><Field label="Password"><input style={INP} type="password" value={svcForm.password} onChange={e => setSvc('password', e.target.value)} /></Field></Grid>,
    oauth2_client: <Grid cols={2}><Field label="Client ID"><input style={INP} value={svcForm.client_id} onChange={e => setSvc('client_id', e.target.value)} /></Field><Field label="Client secret"><input style={{ ...INP, fontFamily: 'var(--font-mono)', fontSize: 12 }} type="password" value={svcForm.client_secret} onChange={e => setSvc('client_secret', e.target.value)} /></Field><Field label="Token URL" hint="e.g. https://api.hubapi.com/oauth/v1/token"><input style={INP} placeholder="https://..." value={svcForm.token_url} onChange={e => setSvc('token_url', e.target.value)} /></Field><Field label="Refresh token (optional)" hint="Required for refresh_token grant. Leave blank for client_credentials grant."><input style={{ ...INP, fontFamily: 'var(--font-mono)', fontSize: 12 }} type="password" placeholder="1000.xxx..." value={svcForm.refresh_token} onChange={e => setSvc('refresh_token', e.target.value)} /></Field><Field label="Auth header prefix" hint='Default "Bearer". Override only if your API requires a non-standard prefix.'><input style={INP} placeholder="Bearer" value={svcForm.header_prefix} onChange={e => setSvc('header_prefix', e.target.value)} /></Field><Field label="API version (optional)"><input style={INP} placeholder="e.g. 2024-11-20" value={svcForm.api_version} onChange={e => setSvc('api_version', e.target.value)} /></Field></Grid>,
    custom_headers: <Field label="Custom headers (JSON)"><textarea style={{ ...INP, resize: 'vertical', fontSize: 12, fontFamily: 'var(--font-mono)' }} rows={3} placeholder={'{"X-Custom-Auth": "token"}'} value={svcForm.custom_headers} onChange={e => setSvc('custom_headers', e.target.value)} /></Field>,
  }

  async function runTryIt() {
    if (!tryIt) return
    setTryLoading(true); setTryResult(null)
    try {
      const queryParams: Record<string, string> = {}
      tryIt.queryParams.filter(p => p.key.trim()).forEach(p => { queryParams[p.key] = p.value })
      const customHeaders: Record<string, string> = {}
      tryIt.customHeaders.filter(h => h.key.trim()).forEach(h => { customHeaders[h.key] = h.value })
      let parsedBody: unknown = undefined
      if (['POST','PUT','PATCH'].includes(tryIt.method) && tryIt.bodyText.trim()) {
        try { parsedBody = JSON.parse(tryIt.bodyText) } catch { parsedBody = tryIt.bodyText }
      }
      const r = await fetch('/api/test-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: tryIt.serviceId,
          connection_id: tryIt.connectionId,
          method: tryIt.method,
          path: tryIt.path,
          query_params: queryParams,
          body: parsedBody,
          custom_headers: customHeaders,
        }),
      })
      const data = await r.json()
      setTryResult(data)
      setTryTab('response')
    } catch (e) {
      setTryResult({ ok: false, status: 0, latencyMs: 0, url: '', error: (e instanceof Error ? e.message : 'Request failed') })
    }
    setTryLoading(false)
  }

  function extractToken(body: unknown): string | null {
    if (!body || typeof body !== 'object') return null
    const b = body as Record<string, unknown>
    // Common token field names across APIs
    for (const key of ['access', 'access_token', 'token', 'id_token', 'jwt', 'accessToken', 'auth_token']) {
      if (typeof b[key] === 'string' && (b[key] as string).length > 20) return b[key] as string
    }
    // Nested: { data: { token: ... } } or { tokens: { access: ... } }
    for (const key of ['data', 'tokens', 'result', 'auth']) {
      if (b[key] && typeof b[key] === 'object') {
        const nested = extractToken(b[key])
        if (nested) return nested
      }
    }
    return null
  }

  async function copyTokenToService(serviceId: string, token: string) {
    try {
      // Load existing service auth_config and patch the token
      await fetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'patchServiceAuth', id: serviceId, auth_config: { token } }),
      })
      setTokenCopied(true)
      setTimeout(() => setTokenCopied(false), 3000)
    } catch { /* silent */ }
  }

  async function importSap() {
    if (!sapHost) { setSapError('Host is required'); return }
    setSapImporting(true); setSapError('')
    try {
      const baseUrl = sapHost.startsWith('http') ? sapHost.replace(/\/$/, '') : `https://${sapHost.replace(/\/$/, '')}`
      // Create the service
      const svcRes = await fetch('/api/services', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createService',
          label: 'SAP S/4HANA',
          base_url: baseUrl,
          environment: 'production',
          auth_type: 'basic',
          auth_config: { username: sapUser, password: sapPass },
          request_timeout_ms: 30000,
          retry_count: 3,
        }),
      })
      const svcData = await svcRes.json()
      if (!svcRes.ok) throw new Error(svcData.error)
      // Create selected connections
      const selected = SAP_CONNECTIONS.filter((_, i) => sapSelected.has(i))
      for (const conn of selected) {
        // Use V4 path when selected AND confirmed available; fall back to V2
        const usePath = (sapOdataVer === 'v4' && conn.v4confirmed && conn.v4) ? conn.v4 : conn.v2
        await fetch('/api/services', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'createConnection',
            service_id: svcData.id,
            label: conn.label,
            description: conn.desc,
            base_path: usePath,
            pagination_style: 'none',
          }),
        })
      }
      setShowSapForm(false); setSapHost(''); setSapUser(''); setSapPass('')
      setSapSelected(new Set(SAP_CONNECTIONS.map((_,i)=>i)))
      setExpanded(prev => new Set([...prev, svcData.id]))
      load()
    } catch (e) {
      setSapError((e instanceof Error ? e.message : 'Import failed'))
    }
    setSapImporting(false)
  }

  function openTryIt(svc: ApiService, conn: ApiConn | null) {
    setTryIt({
      serviceId: svc.id,
      connectionId: conn?.id ?? null,
      method: 'GET',
      path: conn?.base_path ?? '/',
      queryParams: [{ key: '', value: '' }],
      bodyText: '',
      customHeaders: [{ key: '', value: '' }],
    })
    setTryResult(null)
  }

  const dropZoneStyle: React.CSSProperties = {
    border: `2px dashed ${importDragOver ? 'var(--blue)' : 'var(--border2)'}`,
    borderRadius: 'var(--radius)',
    padding: '22px 20px',
    textAlign: 'center',
    background: importDragOver ? 'var(--blue-bg)' : 'var(--bg)',
    cursor: 'pointer',
    transition: 'all .15s',
    marginBottom: 16,
  }

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <PageTitle>API connections</PageTitle>
        {user.role === 'admin' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn onClick={() => { fileRef.current?.click() }}> Import Postman</Btn>
            <Btn onClick={() => { setShowSapForm(s => !s); setSapError('') }} style={{ background: 'var(--bg)', border: '1px solid rgba(0,112,243,0.3)', color: '#0070f3' }}> SAP S/4HANA</Btn>
            <Btn variant="primary" onClick={() => { setShowSvcForm(!showSvcForm); setEditingSvc(null); setSvcForm(SVC_EMPTY); setError('') }}>+ Add service</Btn>
          </div>
        )}
      </div>
      <PageSub>Group related endpoints under a service. Auth is shared across all connections within a service.</PageSub>

      <Alert variant="info"> Once connected, ask Mosaic: <em>"Fetch my latest HubSpot contacts"</em> or <em>"Get last month's Stripe revenue"</em></Alert>

      {error && <Alert variant="error">{error}</Alert>}

      {/* -- Postman import drop zone -- */}
      {user.role === 'admin' && !importPreview && (
        <>
          <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handlePostmanFile(f); e.target.value = '' }} />
          <div style={dropZoneStyle}
            onDragOver={e => { e.preventDefault(); setImportDragOver(true) }}
            onDragLeave={() => setImportDragOver(false)}
            onDrop={onFileDrop}
            onClick={() => fileRef.current?.click()}>
            <div style={{ fontSize: 22, marginBottom: 6 }}></div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text2)', marginBottom: 3 }}>Drop a Postman collection here</div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>or click to browse . supports Postman v2.1 JSON</div>
          </div>
          {importError && <Alert variant="error">{importError}</Alert>}
        </>
      )}

      {/* -- SAP S/4HANA setup panel -- */}
      {showSapForm && (
        <div style={{ background: 'var(--surface)', border: '1.5px solid rgba(0,112,243,0.22)', borderRadius: 'var(--radius)', boxShadow: '0 4px 20px rgba(0,112,243,0.08)', padding: 20, marginBottom: 16 }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-sm)', background: '#0070f3', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>SAP</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>Connect SAP S/4HANA</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>
                Creates a service with {SAP_CONNECTIONS.length} pre-configured manufacturing OData endpoints
              </div>
            </div>
            <button onClick={() => setShowSapForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 18, lineHeight: 1 }}></button>
          </div>

          {/* Connection fields */}
          <Grid cols={3}>
            <Field label="S/4HANA host *" hint="e.g. s4hana.company.com or full https://... URL">
              <input style={INP} placeholder="s4hana.company.com" value={sapHost} onChange={e => setSapHost(e.target.value)} />
            </Field>
            <Field label="Username" hint="SAP user -- needs OData read role">
              <input style={INP} placeholder="S4H_API_USER" value={sapUser} onChange={e => setSapUser(e.target.value)} />
            </Field>
            <Field label="Password">
              <input style={{ ...INP, fontFamily: 'var(--font-mono)', fontSize: 12 }} type="password" placeholder="" value={sapPass} onChange={e => setSapPass(e.target.value)} />
            </Field>
          </Grid>

          {/* OData version selector */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 7 }}>OData version</div>
            <div style={{ display: 'flex', gap: 0, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', overflow: 'hidden', width: 'fit-content' }}>
              {(['v2', 'v4'] as const).map(v => (
                <button key={v} onClick={() => setSapOdataVer(v)} style={{
                  padding: '5px 18px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500, fontFamily: 'inherit',
                  background: sapOdataVer === v ? '#0070f3' : 'var(--bg)',
                  color: sapOdataVer === v ? '#fff' : 'var(--text3)',
                  transition: 'all .12s',
                }}>
                  OData {v.toUpperCase()}
                </button>
              ))}
            </div>
            {sapOdataVer === 'v4' && (
              <div style={{ marginTop: 7, fontSize: 11, color: '#92610a', background: '#fffbeb', border: '1px solid rgba(245,158,11,.2)', borderRadius: 'var(--radius-sm)', padding: '5px 10px' }}>
                 V4 is only available for {SAP_CONNECTIONS.filter(c => c.v4confirmed).length} of {SAP_CONNECTIONS.length} endpoints.
                The rest will automatically use V2. Requires SAP S/4HANA 2021+ and <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>/IWBEP/V4_ADMIN</code> activation.
              </div>
            )}
            {sapOdataVer === 'v2' && (
              <div style={{ marginTop: 7, fontSize: 11, color: 'var(--text3)' }}>
                Stable and compatible with all S/4HANA versions from 1709 onwards. Recommended for most deployments.
              </div>
            )}
          </div>

          {/* Endpoint selector */}
          <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 7, display: 'flex', alignItems: 'center', gap: 0 }}>
            <span>Select endpoints ({sapSelected.size}/{SAP_CONNECTIONS.length})</span>
            <button onClick={() => setSapSelected(new Set(SAP_CONNECTIONS.map((_,i)=>i)))} style={{ marginLeft: 10, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--blue-t)', fontFamily: 'inherit' }}>all</button>
            <button onClick={() => setSapSelected(new Set())} style={{ marginLeft: 5, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text3)', fontFamily: 'inherit' }}>none</button>
          </div>

          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', marginBottom: 14, maxHeight: 300, overflowY: 'auto' }}>
            {/* Group by category */}
            {Array.from(new Set(SAP_CONNECTIONS.map(c => c.cat))).map(cat => (
              <div key={cat}>
                <div style={{ padding: '5px 12px', background: 'var(--bg3)', borderBottom: '1px solid var(--border)', fontSize: 9, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>
                  {cat}
                </div>
                {SAP_CONNECTIONS.filter(c => c.cat === cat).map((c, _i) => {
                  const idx = SAP_CONNECTIONS.indexOf(c)
                  const hasV4 = c.v4confirmed && c.v4
                  const willUseV4 = sapOdataVer === 'v4' && hasV4
                  return (
                    <label key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: sapSelected.has(idx) ? 'rgba(0,112,243,0.03)' : 'var(--surface)' }}>
                      <input type="checkbox" checked={sapSelected.has(idx)}
                        onChange={e => setSapSelected(prev => { const n = new Set(prev); e.target.checked ? n.add(idx) : n.delete(idx); return n })}
                        style={{ width: 13, height: 13, cursor: 'pointer', flexShrink: 0, marginTop: 2 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 1 }}>
                          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{c.label}</span>
                          {willUseV4
                            ? <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 99, background: '#eff6ff', border: '1px solid rgba(37,99,235,.2)', color: '#2563eb', fontWeight: 600 }}>V4</span>
                            : <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 99, background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text4)', fontWeight: 600 }}>V2</span>
                          }
                          {sapOdataVer === 'v4' && !hasV4 && (
                            <span style={{ fontSize: 9, color: '#92610a' }}> V2 fallback</span>
                          )}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text3)' }}>{c.desc}</div>
                        <code style={{ fontSize: 9, color: 'var(--text4)', fontFamily: 'var(--font-mono)' }}>
                          {(willUseV4 ? c.v4 : c.v2)?.split('/').slice(-2).join('/')}
                        </code>
                      </div>
                      <code style={{ fontSize: 9, color: 'var(--text4)', background: 'var(--bg3)', padding: '1px 5px', borderRadius: 3, border: '1px solid var(--border)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', flexShrink: 0, alignSelf: 'center' }}>
                        {c.activate_svc}
                      </code>
                    </label>
                  )
                })}
              </div>
            ))}
          </div>

          {/* -- Service Activation Guide (collapsible) -- */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', marginBottom: 14 }}>
            <button onClick={() => setShowSapActivation(s => !s)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: showSapActivation ? 'var(--bg3)' : 'var(--bg)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 500, color: 'var(--text)', textAlign: 'left' }}>
              <span style={{ fontSize: 14 }}></span>
              <span style={{ flex: 1 }}>Service activation guide (on-premise / private cloud only)</span>
              <span style={{ fontSize: 9, color: 'var(--text3)', transition: 'transform .18s', display: 'inline-block', transform: showSapActivation ? 'rotate(90deg)' : 'none' }}></span>
            </button>
            {showSapActivation && (
              <div style={{ padding: '12px 14px', background: 'var(--surface)', borderTop: '1px solid var(--border)', fontSize: 12, lineHeight: 1.7, color: 'var(--text2)' }}>

                <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text)' }}>Not needed for SAP S/4HANA Cloud Public Edition -- services are pre-activated.</div>

                <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text)', marginTop: 10 }}>Activate OData V2 services (per endpoint):</div>
                <ol style={{ paddingLeft: 18, marginBottom: 8 }}>
                  <li>Log in to SAP GUI  run transaction <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg3)', padding: '0 4px', borderRadius: 3 }}>/IWFND/MAINT_SERVICE</code></li>
                  <li>Click <strong>Add Service</strong>  search for the service name (shown on each endpoint row above, e.g. <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>API_PRODUCTION_ORDER_SRV</code>)</li>
                  <li>Select the service, choose a system alias (usually <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>LOCAL</code>), click <strong>Add Selected Services</strong></li>
                  <li>Enable ICF node if prompted -- confirm with ok</li>
                  <li>Assign role <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>/IWFND/RT_GW_USER</code> to your API user via <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>SU01</code></li>
                </ol>

                <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text)', marginTop: 8 }}>Activate OData V4 services (if using V4 above):</div>
                <ol style={{ paddingLeft: 18, marginBottom: 8 }}>
                  <li>Transaction <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg3)', padding: '0 4px', borderRadius: 3 }}>/IWBEP/V4_ADMIN</code>  register the service in the backend</li>
                  <li>Transaction <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg3)', padding: '0 4px', borderRadius: 3 }}>/IWFND/V4_ADMIN</code>  publish to the Gateway hub</li>
                  <li>Requires SAP_BASIS  7.55 (S/4HANA 2021+)</li>
                </ol>

                <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text)', marginTop: 8 }}>HTTPS / SSL (required for production):</div>
                <ol style={{ paddingLeft: 18, marginBottom: 8 }}>
                  <li>Configure SSL certificate via <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>STRUST</code> (SSL Server Standard)</li>
                  <li>Enable HTTPS port via <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>SMICM</code> -- default port 443</li>
                  <li>HTTP is blocked by most corporate firewalls for external access</li>
                </ol>

                <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text)', marginTop: 8 }}>CORS / Network access:</div>
                <ol style={{ paddingLeft: 18 }}>
                  <li>On-prem S/4HANA inside a corporate network: deploy this app inside the same network, or use SAP Cloud Connector to expose the host to the internet securely</li>
                  <li>S/4HANA Private Cloud: open firewall rule from this app's IP to SAP Gateway port (443 or 8443)</li>
                  <li>Requests from Vercel serverless functions go via fixed Vercel egress IPs -- whitelisting is straightforward</li>
                </ol>
              </div>
            )}
          </div>

          {/* -- Other configurations note -- */}
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', marginBottom: 14, fontSize: 11, color: 'var(--text2)', lineHeight: 1.7 }}>
            <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Other configurations to check:</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 16px' }}>
              {[
                ['CSRF tokens', 'Required for any write/POST -- handled by the Try It panel automatically'],
                ['$format=json', 'Always appended by Mosaic -- avoids XML responses'],
                ['SAP Client (mandt)', 'Add ?sap-client=100 to all paths if multi-client system'],
                ['Pagination', 'V4 returns @odata.nextLink -- Claude follows it automatically'],
                ['Auth method', 'Basic auth works for dev; OAuth 2.0 (SOAUTH2) recommended for prod'],
                ['Rate limiting', 'SAP Gateway has no built-in rate limit -- set $top in all queries'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 5, alignItems: 'flex-start', paddingBottom: 2 }}>
                  <span style={{ color: '#0070f3', flexShrink: 0 }}></span>
                  <span><strong>{k}</strong> -- {v}</span>
                </div>
              ))}
            </div>
          </div>

          {sapError && <Alert variant="error">{sapError}</Alert>}

          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="primary" onClick={importSap} disabled={sapImporting || sapSelected.size === 0}>
              {sapImporting ? <><Spinner size={12} /> Connecting...</> : `Add SAP S/4HANA . ${sapOdataVer.toUpperCase()} . ${sapSelected.size} endpoints`}
            </Btn>
            <Btn onClick={() => { setShowSapForm(false); setSapError('') }}>Cancel</Btn>
          </div>
        </div>
      )}

      {/* -- Import preview -- */}
            {/* -- Import preview -- */}
      {importPreview && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 18 }}></span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Import preview</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{importPreview.connections.length} endpoint{importPreview.connections.length !== 1 ? 's' : ''} found</div>
            </div>
            <button onClick={() => setImportPreview(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 18, lineHeight: 1 }}></button>
          </div>

          <Grid cols={2}>
            <Field label="Service name">
              <input style={INP} value={importPreview.serviceName}
                onChange={e => setImportPreview(p => p ? { ...p, serviceName: e.target.value } : p)} />
            </Field>
            <Field label="Base URL">
              <input style={INP} value={importPreview.baseUrl}
                onChange={e => setImportPreview(p => p ? { ...p, baseUrl: e.target.value } : p)} />
            </Field>
          </Grid>

          <Field label="Bearer token (from collection)">
            <div style={{ position: 'relative' }}>
              <input style={{ ...INP, fontFamily: 'var(--font-mono)', fontSize: 11, paddingRight: 60 }} type="password"
                value={importPreview.token}
                onChange={e => setImportPreview(p => p ? { ...p, token: e.target.value } : p)} />
              {importPreview.token && (
                <button
                  onClick={() => setImportPreview(p => p ? { ...p, token: '' } : p)}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text3)', fontFamily: 'inherit' }}>
                  Clear
                </button>
              )}
            </div>
            {(() => {
              const check = tokenLooksExpired(importPreview.token)
              if (!importPreview.token) return (
                <div style={{ fontSize: 11, color: 'var(--amber-t)', marginTop: 4 }}>
                   No token found in collection -- add one manually if this API requires auth.
                </div>
              )
              if (check.expired) return (
                <div style={{ fontSize: 11, color: 'var(--red-t)', marginTop: 4, display: 'flex', alignItems: 'flex-start', gap: 5 }}>
                  <span></span>
                  <span><strong>Token likely invalid:</strong> {check.reason}. Update it now or Mosaic will get 401 errors when calling this API.</span>
                </div>
              )
              if (check.warning) return (
                <div style={{ fontSize: 11, color: 'var(--amber-t)', marginTop: 4, display: 'flex', alignItems: 'flex-start', gap: 5 }}>
                  <span></span>
                  <span><strong>Expiring soon:</strong> {check.reason}. Consider refreshing it before it stops working.</span>
                </div>
              )
              return (
                <div style={{ fontSize: 11, color: 'var(--green-t)', marginTop: 4 }}>
                  ok Token looks valid -- you can update it later in the service settings if it expires.
                </div>
              )
            })()}
          </Field>

          {/* Connection list preview */}
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', marginTop: 4 }}>
            {importPreview.connections.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: i < importPreview.connections.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: c.method === 'GET' ? 'var(--blue-bg)' : c.method === 'POST' ? 'var(--green-bg)' : 'var(--amber-bg)', color: c.method === 'GET' ? 'var(--blue-t)' : c.method === 'POST' ? 'var(--green-t)' : 'var(--amber-t)', minWidth: 36, textAlign: 'center' }}>{c.method}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{c.name}</div>
                  <code style={{ fontSize: 11, color: 'var(--text3)' }}>{c.path}</code>
                </div>
                <button onClick={() => setImportPreview(p => p ? { ...p, connections: p.connections.filter((_, j) => j !== i) } : p)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text4)', fontSize: 15, lineHeight: 1, padding: '2px 4px' }}></button>
              </div>
            ))}
          </div>

          {importError && <Alert variant="error">{importError}</Alert>}

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Btn variant="primary" onClick={confirmImport} disabled={importing}>
              {importing ? <><Spinner size={12} /> Importing...</> : `Import ${importPreview.connections.length} endpoint${importPreview.connections.length !== 1 ? 's' : ''}`}
            </Btn>
            <Btn onClick={() => { setImportPreview(null); setImportError('') }}>Cancel</Btn>
          </div>
        </div>
      )}

      {/* -- Try It panel -- */}
      {tryIt && (() => {
        const svc = services.find(s => s.id === tryIt.serviceId)
        const conn = connections.find(c => c.id === tryIt.connectionId)
        const statusColor = tryResult ? (tryResult.ok ? 'var(--green-t)' : 'var(--red-t)') : 'var(--text3)'
        return (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 20, marginBottom: 20 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 16 }}></span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>Try it -- {svc?.label}{conn ? ` / ${conn.label}` : ''}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>Request is proxied server-side . not saved</div>
              </div>
              <button onClick={() => { setTryIt(null); setTryResult(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 18, lineHeight: 1 }}></button>
            </div>

            {/* Method + Path + Send */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'flex-end' }}>
              <Field label="Method">
                <select style={SEL} value={tryIt.method} onChange={e => setTryIt(p => p ? { ...p, method: e.target.value } : p)}>
                  {['GET','POST','PUT','PATCH','DELETE','HEAD'].map(m => <option key={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="Path">
                <input style={INP} placeholder="/endpoint/path" value={tryIt.path}
                  onChange={e => setTryIt(p => p ? { ...p, path: e.target.value } : p)}
                  onKeyDown={e => { if (e.key === 'Enter') runTryIt() }} />
              </Field>
              <Btn variant="primary" onClick={runTryIt} disabled={tryLoading} style={{ flexShrink: 0, marginBottom: 1 }}>
                {tryLoading ? <><Spinner size={12} /> Sending...</> : 'Send '}
              </Btn>
            </div>

            {/* Query params */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 7 }}>Query params</div>
              {tryIt.queryParams.map((p, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 24px', gap: 6, marginBottom: 5 }}>
                  <input style={{ ...INP, fontSize: 12 }} placeholder="key" value={p.key}
                    onChange={e => setTryIt(s => s ? { ...s, queryParams: s.queryParams.map((r,j) => j===i ? { ...r, key: e.target.value } : r) } : s)} />
                  <input style={{ ...INP, fontSize: 12 }} placeholder="value" value={p.value}
                    onChange={e => setTryIt(s => s ? { ...s, queryParams: s.queryParams.map((r,j) => j===i ? { ...r, value: e.target.value } : r) } : s)} />
                  <button onClick={() => setTryIt(s => s ? { ...s, queryParams: s.queryParams.filter((_,j) => j!==i) } : s)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text4)', fontSize: 16 }}></button>
                </div>
              ))}
              <button onClick={() => setTryIt(s => s ? { ...s, queryParams: [...s.queryParams, { key: '', value: '' }] } : s)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text3)', padding: 0 }}>+ Add param</button>
            </div>

            {/* Body (for POST/PUT/PATCH) */}
            {['POST','PUT','PATCH'].includes(tryIt.method) && (
              <Field label="Request body (JSON)">
                <textarea style={{ ...INP, resize: 'vertical', minHeight: 80, fontFamily: 'var(--font-mono)', fontSize: 12 }}
                  placeholder='{"key": "value"}'
                  value={tryIt.bodyText}
                  onChange={e => setTryIt(s => s ? { ...s, bodyText: e.target.value } : s)} />
              </Field>
            )}

            {/* Custom headers */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 7 }}>Custom headers <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional -- service auth applied automatically)</span></div>
              {tryIt.customHeaders.map((h, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 24px', gap: 6, marginBottom: 5 }}>
                  <input style={{ ...INP, fontSize: 12 }} placeholder="Header-Name" value={h.key}
                    onChange={e => setTryIt(s => s ? { ...s, customHeaders: s.customHeaders.map((r,j) => j===i ? { ...r, key: e.target.value } : r) } : s)} />
                  <input style={{ ...INP, fontSize: 12 }} placeholder="value" value={h.value}
                    onChange={e => setTryIt(s => s ? { ...s, customHeaders: s.customHeaders.map((r,j) => j===i ? { ...r, value: e.target.value } : r) } : s)} />
                  <button onClick={() => setTryIt(s => s ? { ...s, customHeaders: s.customHeaders.filter((_,j) => j!==i) } : s)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text4)', fontSize: 16 }}></button>
                </div>
              ))}
              <button onClick={() => setTryIt(s => s ? { ...s, customHeaders: [...s.customHeaders, { key: '', value: '' }] } : s)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text3)', padding: 0 }}>+ Add header</button>
            </div>

            {/* Response */}
            {tryResult && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                {/* Status bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: statusColor }}>
                    {tryResult.status ? `${tryResult.status} ${tryResult.statusText || ''}` : 'Error'}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>{tryResult.latencyMs}ms</span>
                  <code style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--bg3)', padding: '2px 7px', borderRadius: 4, border: '1px solid var(--border)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tryResult.url}</code>
                  {tryResult.error && <span style={{ fontSize: 12, color: 'var(--red-t)' }}>{tryResult.error}</span>}
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                  {(['response','headers'] as const).map(t => (
                    <button key={t} onClick={() => setTryTab(t)}
                      style={{ padding: '4px 12px', borderRadius: 'var(--radius-pill)', border: `1px solid ${tryTab===t ? 'var(--blue)' : 'var(--border2)'}`, background: tryTab===t ? 'var(--blue-bg)' : 'var(--bg)', color: tryTab===t ? 'var(--blue-t)' : 'var(--text2)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize' }}>
                      {t}
                    </button>
                  ))}
                </div>

                {/* Token detected banner */}
                {tryTab === 'response' && tryResult.ok && (() => {
                  const detectedToken = extractToken(tryResult.body)
                  if (!detectedToken) return null
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--green-bg)', border: '1px solid rgba(22,163,74,.25)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', marginBottom: 10 }}>
                      <span style={{ fontSize: 13 }}></span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--green-t)' }}>Token detected in response</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 340 }}>{detectedToken.slice(0, 48)}...</div>
                      </div>
                      <Btn
                        size="sm"
                        variant={tokenCopied ? 'primary' : undefined}
                        onClick={() => copyTokenToService(tryIt!.serviceId, detectedToken)}
                      >
                        {tokenCopied ? 'ok Applied' : 'Apply to service '}
                      </Btn>
                    </div>
                  )
                })()}

                {/* Response body */}
                {tryTab === 'response' && (
                  <pre style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text2)', overflowX: 'auto', maxHeight: 320, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {tryResult.body !== undefined
                      ? JSON.stringify(tryResult.body, null, 2)
                      : tryResult.error || 'No response body'}
                  </pre>
                )}

                {/* Response headers */}
                {tryTab === 'headers' && tryResult.headers && (
                  <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', maxHeight: 280, overflowY: 'auto' }}>
                    {Object.entries(tryResult.headers).map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', gap: 12, padding: '6px 14px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                        <span style={{ color: 'var(--blue-t)', fontFamily: 'var(--font-mono)', minWidth: 180, flexShrink: 0 }}>{k}</span>
                        <span style={{ color: 'var(--text2)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {/* -- Manual service form -- */}
      {showSvcForm && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 24, marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)', marginBottom: 18 }}>{editingSvc ? 'Edit service' : 'New API service'}</div>

          {!editingSvc && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>Quick start</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {PRESETS.map(p => (
                  <button key={p.label} onClick={() => setSvcForm(f => ({ ...f, label: p.label, base_url: p.base_url, auth_type: p.auth_type }))}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-pill)', cursor: 'pointer', fontSize: 13, color: 'var(--text)', fontFamily: 'inherit', boxShadow: 'var(--shadow)', fontWeight: 500, transition: 'box-shadow .15s' }}
                    onMouseEnter={e => (e.currentTarget.style.boxShadow = 'var(--shadow-md)')}
                    onMouseLeave={e => (e.currentTarget.style.boxShadow = 'var(--shadow)')}>
                    <span style={{ width: 20, height: 20, borderRadius: 5, background: p.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>{p.icon}</span>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Grid cols={2}>
            <Field label="Service name" required><input style={INP} placeholder="HubSpot" value={svcForm.label} onChange={e => setSvc('label', e.target.value)} /></Field>
            <Field label="Environment"><select style={SEL} value={svcForm.environment} onChange={e => setSvc('environment', e.target.value)}><option value="production"> Production</option><option value="sandbox"> Sandbox</option><option value="staging"> Staging</option></select></Field>
          </Grid>
          <Field label="Base URL" required hint="All connection paths are appended to this"><input style={INP} placeholder="https://api.hubapi.com" value={svcForm.base_url} onChange={e => setSvc('base_url', e.target.value)} /></Field>

          <Field label="Authentication type">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {[['bearer','Bearer token'],['api_key_header','API key'],['oauth2_client','OAuth 2.0'],['basic','Basic'],['custom_headers','Custom']].map(([v,l]) => (
                <button key={v} onClick={() => setSvc('auth_type', v)}
                  style={{ padding: '6px 14px', borderRadius: 'var(--radius-pill)', border: `1.5px solid ${svcForm.auth_type === v ? 'var(--purple)' : 'var(--border2)'}`, background: svcForm.auth_type === v ? 'var(--purple-bg)' : 'var(--bg)', color: svcForm.auth_type === v ? 'var(--purple-t)' : 'var(--text2)', fontSize: 12, fontWeight: svcForm.auth_type === v ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s' }}>
                  {l}
                </button>
              ))}
            </div>
            {authFields[svcForm.auth_type]}
          </Field>

          <Grid cols={3}>
            <Field label="Rate limit (req/min)" hint="Client-side throttle"><input style={INP} type="number" placeholder="100" value={svcForm.rate_limit_rpm} onChange={e => setSvc('rate_limit_rpm', e.target.value)} /></Field>
            <Field label="Request timeout (ms)"><input style={INP} type="number" value={svcForm.request_timeout_ms} onChange={e => setSvc('request_timeout_ms', e.target.value)} /></Field>
            <Field label="Retry attempts"><input style={INP} type="number" value={svcForm.retry_count} onChange={e => setSvc('retry_count', e.target.value)} /></Field>
          </Grid>

          <div style={{ display: 'flex', gap: 8, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <Btn variant="primary" onClick={saveSvc} disabled={saving}>{saving ? 'Saving...' : 'Save service'}</Btn>
            <Btn onClick={() => { setShowSvcForm(false); setEditingSvc(null); setError('') }}>Cancel</Btn>
          </div>
        </div>
      )}

      {/* -- Services list -- */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={24} /></div>
      ) : services.length === 0 ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '48px 24px', textAlign: 'center', fontSize: 14, color: 'var(--text3)' }}>
          No API services yet. Add one above or import a Postman collection.
        </div>
      ) : (
        services.map(svc => {
          const svcConns = connections.filter(c => c.service_id === svc.id)
          const isExpanded = expanded.has(svc.id)
          const p = preset(svc.label)
          return (
            <div key={svc.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', marginBottom: 10, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', cursor: 'pointer' }} onClick={() => toggle(svc.id)}>
                <div style={{ width: 34, height: 34, borderRadius: 'var(--radius-sm)', background: p?.color || (svc.label.startsWith('SAP') ? '#0070f3' : 'var(--bg4)'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: svc.label.startsWith('SAP') ? 9 : 12, fontWeight: 700, flexShrink: 0 }}>{svc.label.startsWith('SAP') ? 'SAP' : svc.label.slice(0, 2).toUpperCase()}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{svc.label} <Badge label={svc.environment} color={envColor(svc.environment)} /></div>
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>{svc.base_url} . {svc.auth_type} . {svcConns.length} connection{svcConns.length !== 1 ? 's' : ''}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                  <Btn size="sm" onClick={() => { openTryIt(svc, null) }}> Try</Btn>
                  {user.role === 'admin' && <>
                    <Btn size="sm" onClick={() => { const s = svc as unknown as Record<string,unknown>; setSvcForm({ ...SVC_EMPTY, label: String(s.label||''), base_url: String(s.base_url||''), environment: String(s.environment||'production'), auth_type: String(s.auth_type||'bearer'), rate_limit_rpm: String(s.rate_limit_rpm||''), request_timeout_ms: String(s.request_timeout_ms||30000), retry_count: String(s.retry_count||3) }); setEditingSvc(svc.id); setShowSvcForm(true); window.scrollTo({top:0,behavior:'smooth'}) }}>Edit</Btn>
                    <Btn size="sm" variant="danger" onClick={() => { delSvc(svc.id, svc.label) }}>Delete</Btn>
                  </>}
                </div>
                <span style={{ fontSize: 11, color: 'var(--text4)', transform: isExpanded ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform .2s' }}></span>
              </div>

              {isExpanded && (
                <div style={{ borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 18px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 11, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Shared auth:</span>
                    <span style={{ padding: '2px 9px', borderRadius: 'var(--radius-pill)', background: 'var(--green-bg)', border: '1px solid rgba(22,163,74,.2)', color: 'var(--green-t)', fontWeight: 500 }}>ok {svc.auth_type}</span>
                    {svc.rate_limit_rpm && <span style={{ padding: '2px 9px', borderRadius: 'var(--radius-pill)', background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text3)' }}>{svc.rate_limit_rpm} req/min</span>}
                    <span style={{ padding: '2px 9px', borderRadius: 'var(--radius-pill)', background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text3)' }}>retry {svc.retry_count}</span>
                    <span style={{ marginLeft: 'auto', color: 'var(--text4)' }}>all connections inherit </span>
                  </div>

                  {svcConns.map(c => (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 18px 11px 42px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ width: 6, height: 1, background: 'var(--border2)', flexShrink: 0 }} />
                      <div style={{ width: 22, height: 22, borderRadius: 5, background: 'var(--bg3)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: 'var(--text3)', fontWeight: 600, flexShrink: 0 }}>API</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 1 }}>{c.label}</div>
                        {c.description && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{c.description}</div>}
                      </div>
                      {c.base_path && <code style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--bg3)', padding: '2px 7px', borderRadius: 5, border: '1px solid var(--border)' }}>{c.base_path}</code>}
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-pill)', background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text4)' }}> inherits auth</span>
                      <div style={{ display: 'flex', gap: 5 }}>
                        <Btn size="sm" onClick={() => openTryIt(svc, c)}> Try</Btn>
                        {user.role === 'admin' && <>
                          <Btn size="sm" onClick={() => { setConnForm({ ...CONN_EMPTY, ...(c as unknown as Record<string,string>) }); setEditingConn(c.id); setShowConnForm(svc.id); setExpanded(p => new Set([...p, svc.id])) }}>Edit</Btn>
                          <Btn size="sm" variant="danger" onClick={() => delConn(c.id, c.label)}>Delete</Btn>
                        </>}
                      </div>
                    </div>
                  ))}

                  {user.role === 'admin' && showConnForm !== svc.id && (
                    <div style={{ padding: '10px 18px 10px 42px', cursor: 'pointer', fontSize: 13, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 6 }}
                      onClick={() => { setConnForm(CONN_EMPTY); setEditingConn(null); setShowConnForm(svc.id) }}>
                      <span style={{ fontSize: 16 }}>+</span> Add connection to {svc.label}
                    </div>
                  )}

                  {showConnForm === svc.id && (
                    <div style={{ padding: '18px', borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 14 }}>{editingConn ? 'Edit connection' : `Add connection to ${svc.label}`}</div>
                      <Grid cols={2}>
                        <Field label="Connection label" required><input style={INP} placeholder="Contacts API" value={connForm.label} onChange={e => setConn('label', e.target.value)} /></Field>
                        <Field label="Base path" hint="Appended to service URL"><input style={INP} placeholder="/crm/v3/contacts" value={connForm.base_path} onChange={e => setConn('base_path', e.target.value)} /></Field>
                      </Grid>
                      <Field label="Description"><input style={INP} placeholder="Get, create, and update contacts" value={connForm.description} onChange={e => setConn('description', e.target.value)} /></Field>
                      <Grid cols={3}>
                        <Field label="Pagination">
                          <select style={SEL} value={connForm.pagination_style} onChange={e => setConn('pagination_style', e.target.value)}>
                            <option value="none">none</option>
                            <option value="offset">offset / limit</option>
                            <option value="cursor">cursor</option>
                            <option value="page">page number</option>
                            <option value="link-header">link header</option>
                          </select>
                        </Field>
                        <Field label="Limit param"><input style={INP} placeholder="limit" value={connForm.pagination_limit_param} onChange={e => setConn('pagination_limit_param', e.target.value)} /></Field>
                        <Field label="Data path" hint="e.g. results, data"><input style={INP} placeholder="results" value={connForm.pagination_data_path} onChange={e => setConn('pagination_data_path', e.target.value)} /></Field>
                      </Grid>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Btn variant="primary" onClick={() => saveConn(svc.id)} disabled={saving}>{saving ? 'Saving...' : 'Save connection'}</Btn>
                        <Btn onClick={() => { setShowConnForm(null); setEditingConn(null) }}>Cancel</Btn>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

// lib/ai/edmx.ts
// OData $metadata (EDMX XML) ingestion. SAP on-prem gateways and many OData
// services expose their shape as EDMX XML, not OpenAPI. This turns an EDMX
// document (V2 or V4) into the same OpenApiSummary structure the AI builder and
// discovery already consume, so a dropped $metadata is a first-class input.
//
// What we extract: the entity sets (→ GET collection endpoints), their key
// properties (→ the key-predicate read path), and function/action imports.
// Auth and the host are NOT in $metadata — the base URL is the service root (the
// $metadata URL minus "/$metadata"), and auth must be supplied by the user.

import { XMLParser } from 'fast-xml-parser'
import type { OpenApiSummary, EndpointRef } from './openapi-summary'

export function isEdmx(text: string): boolean {
  if (!text) return false
  const head = text.slice(0, 5000)
  return /<\s*(edmx:)?Edmx[\s>]/i.test(head) && /Entity(Set|Type)|DataServices/i.test(text.slice(0, 40000))
}

const AS_ARRAY = new Set(['Schema', 'EntityType', 'EntitySet', 'Property', 'PropertyRef', 'FunctionImport', 'ActionImport', 'Function', 'Action', 'Parameter', 'EntityContainer'])

type Any = Record<string, unknown>
const arr = <T = Any>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : v == null ? [] : [v as T])
const attr = (o: unknown, name: string): string => (o && typeof o === 'object' ? String((o as Any)[`@_${name}`] ?? '') : '')
const bareType = (t: string): string => t.replace(/^Collection\(/, '').replace(/\)$/, '').split('.').pop() || t

export interface EdmxResult { summary: OpenApiSummary; odataVersion: '2' | '4' | 'unknown' }

export function edmxToSummary(xml: string, serviceUrl?: string): EdmxResult | null {
  let doc: Any
  try {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, isArray: (n) => AS_ARRAY.has(n) })
    doc = parser.parse(xml) as Any
  } catch { return null }

  const edmx = (doc.Edmx || doc['edmx:Edmx']) as Any | undefined
  if (!edmx) return null
  const edmxVersion = attr(edmx, 'Version')
  const ds = edmx.DataServices as Any | undefined
  if (!ds) return null
  const schemas = arr<Any>(ds.Schema)
  if (!schemas.length) return null

  // Detect OData version: edmx Version 4.* → V4; DataServiceVersion 2.0 / the 2008 edm ns → V2.
  const dsv = attr(ds, 'DataServiceVersion') || attr(ds, 'MaxDataServiceVersion')
  let odataVersion: '2' | '4' | 'unknown' = 'unknown'
  if (/^4/.test(edmxVersion)) odataVersion = '4'
  else if (/^2/.test(dsv) || /^1/.test(edmxVersion)) odataVersion = '2'

  // Index entity types by bare name → key property names.
  const keysByType = new Map<string, string[]>()
  const propsByType = new Map<string, string[]>()
  let title = ''
  for (const sch of schemas) {
    if (!title) title = attr(sch, 'Namespace')
    for (const et of arr<Any>(sch.EntityType)) {
      const nm = attr(et, 'Name')
      const keys = arr<Any>((et.Key as Any)?.PropertyRef).map(p => attr(p, 'Name')).filter(Boolean)
      const props = arr<Any>(et.Property).map(p => attr(p, 'Name')).filter(Boolean)
      if (nm) { keysByType.set(nm, keys); propsByType.set(nm, props) }
    }
  }

  const endpoints: EndpointRef[] = []
  const groups = new Set<string>()
  for (const sch of schemas) {
    for (const cont of arr<Any>(sch.EntityContainer)) {
      // Entity sets → a list GET and a keyed read GET.
      for (const es of arr<Any>(cont.EntitySet)) {
        const name = attr(es, 'Name'); if (!name) continue
        groups.add(name)
        const typeName = bareType(attr(es, 'EntityType'))
        const keys = keysByType.get(typeName) || []
        const props = propsByType.get(typeName) || []
        const propNote = props.length ? ` · fields: ${props.slice(0, 12).join(', ')}${props.length > 12 ? '…' : ''}` : ''
        endpoints.push({ method: 'GET', path: `/${name}`, summary: `entity set${keys.length ? ` · keys: ${keys.join(', ')}` : ''}${propNote}`, hasPathParams: false })
        if (keys.length) {
          const pred = keys.map(k => `${k}='{${k}}'`).join(',')
          endpoints.push({ method: 'GET', path: `/${name}(${pred})`, summary: 'read one by key', hasPathParams: true })
        }
      }
      // Function / Action imports → operation endpoints.
      for (const fi of arr<Any>(cont.FunctionImport)) {
        const name = attr(fi, 'Name'); if (!name) continue
        const method = (attr(fi, 'HttpMethod') || 'GET').toUpperCase()
        const params = arr<Any>(fi.Parameter).map(p => attr(p, 'Name')).filter(Boolean)
        endpoints.push({ method, path: `/${name}`, summary: `function${params.length ? ` · params: ${params.join(', ')}` : ''}`, hasPathParams: false })
      }
      for (const ai of arr<Any>(cont.ActionImport)) {
        const name = attr(ai, 'Name'); if (!name) continue
        endpoints.push({ method: 'POST', path: `/${name}`, summary: 'action', hasPathParams: false })
      }
    }
  }
  if (!endpoints.length) return null

  // Base URL: the service root = the $metadata URL without the trailing /$metadata.
  const base = serviceUrl ? serviceUrl.replace(/\/\$metadata.*$/i, '').replace(/\/+$/, '') : undefined

  const summary: OpenApiSummary = {
    ok: true,
    title: title || 'OData service',
    version: odataVersion === 'unknown' ? undefined : `OData V${odataVersion}`,
    servers: base ? [base] : [],
    suggestedBaseUrl: base,
    commonPrefix: '',
    securitySchemes: {},            // EDMX carries no auth
    loginCandidates: [],
    groups: [...groups].sort(),
    endpoints,
    endpointCount: endpoints.length,
  }
  return { summary, odataVersion }
}

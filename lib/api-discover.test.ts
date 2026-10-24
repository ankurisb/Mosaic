// lib/api-discover.test.ts
// Unit tests for the pure discovery parsers — the Django DEBUG route-map parser
// and the collection selector. Uses a fragment shaped like the real FactoryOS
// 404 debug page that motivated this.
import { describe, it, expect } from 'vitest'
import { parseDjangoDebugRoutes, selectCollectionPaths, collectionsFromEdmx, parseSapCatalog, diagnoseSapActivation } from './api-discover'

// Shaped like the REAL FactoryOS page: each <code> block is indented so its
// content starts with a newline (the path is the first non-empty line, the
// [name] a later line), and a bare <code> api/ </code> prefix node repeats
// before every leaf. One row ("assets/") puts the name AFTER </code> to cover
// the alternate layout.
const leaf = (path: string, name: string) => `
          <li>
              <code>
                api/
              </code>
              <code>
                ${path}
                [name='${name}']
              </code>
          </li>`
const DEBUG_PAGE = `
<!DOCTYPE html><html><head><title>Page not found at /api/xyz</title></head><body>
<h1>Page not found <span>(404)</span></h1>
<p>Using the URLconf defined in <code>project_config.urls</code>, Django tried these URL patterns, in this order:</p>
<ol>
  <li><code>
                admin/
              </code></li>
${leaf('openapi.json', 'openapi-json')}
${leaf('docs', 'openapi-view')}
${leaf('mes/shifts/', 'list_shifts')}
${leaf('mes/shifts/', 'create_shift')}
${leaf('mes/shifts/&lt;shift_id&gt;/', 'update_shift')}
${leaf('mes/assets/oee/', 'list_org_oee')}
${leaf('mes/assets/&lt;asset_id&gt;/oee/', 'get_asset_oee')}
${leaf('core/tenants', 'TenantAPIView_list')}
${leaf('core/sites', 'list_sites')}
${leaf('accounts/login', 'login')}
${leaf('accounts/user-menu', 'get_user_menu')}
  <li><code>
                api/
              </code><code>assets/</code> [name='list_assets']</li>
</ol>
</body></html>`

describe('parseDjangoDebugRoutes', () => {
  it('returns [] for a non-debug page', () => {
    expect(parseDjangoDebugRoutes('<html><body>Just a 404</body></html>')).toEqual([])
  })

  it('extracts patterns and their names, decoding &lt;&gt;', () => {
    const routes = parseDjangoDebugRoutes(DEBUG_PAGE)
    const paths = routes.map(r => r.path)
    expect(paths).toContain('mes/shifts/')
    expect(paths).toContain('mes/assets/<asset_id>/oee/')   // &lt;&gt; decoded
    expect(routes.find(r => r.path === 'mes/shifts/' && r.name === 'list_shifts')).toBeTruthy()
  })
})

describe('selectCollectionPaths', () => {
  const cols = selectCollectionPaths(parseDjangoDebugRoutes(DEBUG_PAGE))
  const paths = cols.map(c => c.path)

  it('keeps param-free resource collections, normalised with a leading slash', () => {
    expect(paths).toContain('/mes/shifts')
    expect(paths).toContain('/mes/assets/oee')
    expect(paths).toContain('/core/tenants')
    expect(paths).toContain('/core/sites')
    expect(paths).toContain('/accounts/user-menu')
    expect(paths).toContain('/assets')
  })

  it('drops routes with path parameters', () => {
    expect(paths.some(p => p.includes('<') || p.includes('asset_id') || p.includes('shift_id'))).toBe(false)
    expect(paths).not.toContain('/mes/assets/oee/history')  // only the param-free collection, not the <id> variant
  })

  it('drops admin, docs, spec files and auth actions', () => {
    expect(paths).not.toContain('/admin')
    expect(paths).not.toContain('/docs')
    expect(paths.some(p => p.includes('openapi'))).toBe(false)
    expect(paths).not.toContain('/accounts/login')
  })

  it('de-duplicates list+create on the same path', () => {
    expect(paths.filter(p => p === '/mes/shifts').length).toBe(1)
  })

  it('gives each a label', () => {
    expect(cols.every(c => c.label && c.label.length > 0)).toBe(true)
  })
})

// --- Stage 3: live $metadata (EDMX) → collections --------------------------
const EDMX_V2 = `<?xml version="1.0"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
 <edmx:DataServices m:DataServiceVersion="2.0" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
  <Schema Namespace="ZSVC" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
   <EntityType Name="Product"><Key><PropertyRef Name="ProductID"/></Key>
     <Property Name="ProductID" Type="Edm.String"/><Property Name="Name" Type="Edm.String"/></EntityType>
   <EntityType Name="Order"><Key><PropertyRef Name="OrderID"/></Key>
     <Property Name="OrderID" Type="Edm.String"/></EntityType>
   <EntityContainer Name="C">
     <EntitySet Name="ProductSet" EntityType="ZSVC.Product"/>
     <EntitySet Name="OrderSet" EntityType="ZSVC.Order"/>
   </EntityContainer>
  </Schema>
 </edmx:DataServices>
</edmx:Edmx>`

describe('collectionsFromEdmx (live $metadata)', () => {
  const { collections, odataVersion } = collectionsFromEdmx(EDMX_V2, 'https://sap.host/sap/opu/odata/sap/ZSVC_SRV/$metadata')
  it('detects OData V2', () => { expect(odataVersion).toBe('2') })
  it('lists each entity set as a GET collection, no keyed reads', () => {
    const paths = collections.map(c => c.path).sort()
    expect(paths).toEqual(['/OrderSet', '/ProductSet'])
  })
  it('gives each a label', () => { expect(collections.every(c => c.label.length > 0)).toBe(true) })
  it('returns empty for a non-EDMX body', () => {
    expect(collectionsFromEdmx('<html>not edmx</html>').collections).toEqual([])
  })
})

// --- Stage 3: SAP Gateway catalogue parser ---------------------------------
describe('parseSapCatalog', () => {
  it('parses the OData V2 catalogue shape (d.results)', () => {
    const body = { d: { results: [
      { TechnicalServiceName: 'ZPRODUCT_SRV', Title: 'Products', ServiceUrl: 'https://h/sap/opu/odata/sap/ZPRODUCT_SRV/', TechnicalServiceVersion: '0001' },
      { TechnicalServiceName: 'ZORDER_SRV', ServiceUrl: 'https://h/sap/opu/odata/sap/ZORDER_SRV/$metadata' },
    ] } }
    const svc = parseSapCatalog(body)
    expect(svc).toHaveLength(2)
    expect(svc[0]).toMatchObject({ name: 'ZPRODUCT_SRV', title: 'Products', version: '2' })
    // $metadata suffix stripped from the service URL
    expect(svc[1].serviceUrl).toBe('https://h/sap/opu/odata/sap/ZORDER_SRV')
  })
  it('parses the OData V4 catalogue shape (value[])', () => {
    const body = { value: [ { ServiceId: 'API_PRODUCT', ServiceUrl: 'https://h/sap/opu/odata4/sap/api_product/', ODataVersion: '4.0' } ] }
    const svc = parseSapCatalog(body)
    expect(svc).toHaveLength(1)
    expect(svc[0]).toMatchObject({ name: 'API_PRODUCT', version: '4' })
  })
  it('de-duplicates and tolerates junk', () => {
    const body = { d: { results: [ {}, { TechnicalServiceName: 'A', ServiceUrl: 'u1' }, { TechnicalServiceName: 'A', ServiceUrl: 'u1' } ] } }
    expect(parseSapCatalog(body)).toHaveLength(1)
  })
  it('returns [] for an unrecognised body', () => {
    expect(parseSapCatalog({ foo: 1 })).toEqual([])
    expect(parseSapCatalog(null)).toEqual([])
  })
})

// --- Stage 4: SAP activation signal ----------------------------------------
describe('diagnoseSapActivation', () => {
  it('flags a 404 Gateway "not found for the segment" as not-activated', () => {
    const body = { error: { code: '/IWFND/CM_RMM', message: { value: "Resource not found for the segment 'ZFOO_SRV'" } } }
    const r = diagnoseSapActivation(404, body)
    expect(r.likelyInactive).toBe(true)
    expect(r.message).toMatch(/IWFND\/MAINT_SERVICE/)
  })
  it('flags a 403 "service is not active"', () => {
    expect(diagnoseSapActivation(403, '<error><message>Service is not active</message></error>').likelyInactive).toBe(true)
  })
  it('flags an XML body referencing SICF', () => {
    expect(diagnoseSapActivation(404, '<error>node not found in SICF</error>').likelyInactive).toBe(true)
  })
  it('does NOT flag a plain 404 with an unrelated body', () => {
    expect(diagnoseSapActivation(404, '{"detail":"Not found"}').likelyInactive).toBe(false)
  })
  it('does NOT flag a 2xx', () => {
    expect(diagnoseSapActivation(200, { d: { results: [] } }).likelyInactive).toBe(false)
  })
})

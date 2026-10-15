// lib/api-discover.test.ts
// Unit tests for the pure discovery parsers — the Django DEBUG route-map parser
// and the collection selector. Uses a fragment shaped like the real FactoryOS
// 404 debug page that motivated this.
import { describe, it, expect } from 'vitest'
import { parseDjangoDebugRoutes, selectCollectionPaths } from './api-discover'

const DEBUG_PAGE = `
<!DOCTYPE html><html><head><title>Page not found at /api/xyz</title></head><body>
<h1>Page not found <span>(404)</span></h1>
<p>Using the URLconf defined in <code>project_config.urls</code>, Django tried these URL patterns, in this order:</p>
<ol>
  <li><code>admin/</code></li>
  <li><code>api/</code>
    <ol>
      <li><code>openapi.json</code> [name='openapi-json']</li>
      <li><code>docs</code> [name='openapi-view']</li>
      <li><code>mes/shifts/</code> [name='list_shifts']</li>
      <li><code>mes/shifts/</code> [name='create_shift']</li>
      <li><code>mes/shifts/&lt;shift_id&gt;/</code> [name='update_shift']</li>
      <li><code>mes/assets/oee/</code> [name='list_org_oee']</li>
      <li><code>mes/assets/&lt;asset_id&gt;/oee/</code> [name='get_asset_oee']</li>
      <li><code>core/tenants</code> [name='TenantAPIView_list']</li>
      <li><code>core/sites</code> [name='list_sites']</li>
      <li><code>accounts/login</code> [name='login']</li>
      <li><code>accounts/user-menu</code> [name='get_user_menu']</li>
      <li><code>assets/</code> [name='list_assets']</li>
    </ol>
  </li>
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

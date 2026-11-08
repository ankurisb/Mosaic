import { describe, it, expect } from 'vitest'
import { buildDatabricksConfig, parseDatabricksSchemas } from './databricks'

describe('parseDatabricksSchemas', () => {
  it('a bare schema in the default catalog is labelled catalog.schema', () => {
    expect(parseDatabricksSchemas('sales', 'main')).toEqual([{ catalog: 'main', schema: 'sales', label: 'main.sales' }])
  })
  it('a catalog.schema spec keeps its own catalog', () => {
    expect(parseDatabricksSchemas('other_cat.sales', 'main')).toEqual([{ catalog: 'other_cat', schema: 'sales', label: 'other_cat.sales' }])
  })
  it('splits a comma/;/newline list and de-duplicates', () => {
    expect(parseDatabricksSchemas('sales, marketing ; other_cat.ops\nsales', 'main')).toEqual([
      { catalog: 'main', schema: 'sales', label: 'main.sales' },
      { catalog: 'main', schema: 'marketing', label: 'main.marketing' },
      { catalog: 'other_cat', schema: 'ops', label: 'other_cat.ops' },
    ])
  })
  it('no catalog set → label is the bare schema', () => {
    expect(parseDatabricksSchemas('sales', '')).toEqual([{ catalog: '', schema: 'sales', label: 'sales' }])
  })
  it('empty yields no targets (caller introspects all schemas in the default catalog)', () => {
    expect(parseDatabricksSchemas('', 'main')).toEqual([])
  })
})

// password_enc without an enc2:/enc: prefix is returned verbatim by decrypt().

describe('buildDatabricksConfig', () => {
  it('maps fields and strips the scheme/trailing slash from host', () => {
    const c = buildDatabricksConfig({ host: 'https://abc.cloud.databricks.com/', http_path: '/sql/1.0/warehouses/w1', password_enc: 'dapi-token', database_name: 'main', schema_name: 'default' })
    expect(c.host).toBe('abc.cloud.databricks.com')
    expect(c.path).toBe('/sql/1.0/warehouses/w1')
    expect(c.token).toBe('dapi-token')
    expect(c.catalog).toBe('main')
    expect(c.schema).toBe('default')
  })
  it('leaves catalog/schema undefined when not set', () => {
    const c = buildDatabricksConfig({ host: 'abc.cloud.databricks.com', http_path: '/p', password_enc: 't' })
    expect(c.catalog).toBeUndefined()
    expect(c.schema).toBeUndefined()
  })
})

import { describe, it, expect } from 'vitest'
import { buildDatabricksConfig } from './databricks'

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

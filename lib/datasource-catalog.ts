// Catalog of data sources Mosaic can connect to — the model-first "what do you want to connect
// to?" front door. Each entry knows which connection FLOW it routes to (category → a Data Sources
// sub-tab) and, for databases, which dialect to pre-select. Icons are bundled brand glyphs (see
// datasource-icons-data.ts) keyed by `icon`; entries without one fall back to a monogram.

export type DsCategory = 'database' | 'api' | 'mcp' | 'file' | 'airbyte' | 'prism'

export interface DsEntry {
  id: string
  name: string
  category: DsCategory
  dialect?: string          // for category 'database' — pre-selects the dialect in the form
  icon?: string             // key into BRAND_ICONS; omit for a monogram fallback
  color?: string            // brand colour (data) for the icon tile
  group: string             // section heading in the catalog
  keywords?: string[]       // extra search terms
  blurb?: string            // one-line description under the name
}

// Section display order.
export const DS_GROUPS = ['Data warehouses', 'Databases', 'Search & time-series', 'APIs & connectors', 'Files', 'Industrial'] as const

export const DATA_SOURCES: DsEntry[] = [
  // ---- Data warehouses ----
  { id: 'snowflake', name: 'Snowflake', category: 'database', dialect: 'snowflake', icon: 'snowflake', color: '#29B5E8', group: 'Data warehouses', keywords: ['warehouse', 'cloud'], blurb: 'Cloud data warehouse' },
  { id: 'databricks', name: 'Databricks', category: 'database', dialect: 'databricks', icon: 'databricks', color: '#FF3621', group: 'Data warehouses', keywords: ['lakehouse', 'spark', 'unity catalog'], blurb: 'Lakehouse / SQL warehouse' },
  { id: 'bigquery', name: 'Google BigQuery', category: 'database', dialect: 'bigquery', icon: 'bigquery', color: '#669DF6', group: 'Data warehouses', keywords: ['gcp', 'google', 'warehouse'], blurb: 'Serverless warehouse on GCP' },
  { id: 'redshift', name: 'Amazon Redshift', category: 'database', dialect: 'redshift', icon: 'redshift', color: '#8C4FFF', group: 'Data warehouses', keywords: ['aws', 'warehouse'], blurb: 'AWS data warehouse' },
  { id: 'fabric', name: 'Microsoft Fabric / Synapse', category: 'database', dialect: 'mssql', color: '#0A7BC0', group: 'Data warehouses', keywords: ['azure', 'synapse', 'fabric', 'sql'], blurb: 'Azure SQL / Synapse / Fabric (TDS)' },

  // ---- Databases ----
  { id: 'postgres', name: 'PostgreSQL', category: 'database', dialect: 'postgres', icon: 'postgresql', color: '#4169E1', group: 'Databases', keywords: ['postgres', 'pg'], blurb: 'Relational database' },
  { id: 'mysql', name: 'MySQL', category: 'database', dialect: 'mysql', icon: 'mysql', color: '#4479A1', group: 'Databases', keywords: ['relational'], blurb: 'Relational database' },
  { id: 'mariadb', name: 'MariaDB', category: 'database', dialect: 'mysql', icon: 'mariadb', color: '#C0765A', group: 'Databases', keywords: ['mysql', 'relational'], blurb: 'MySQL-compatible database' },
  { id: 'mssql', name: 'Microsoft SQL Server', category: 'database', dialect: 'mssql', color: '#CC2927', group: 'Databases', keywords: ['sqlserver', 'mssql', 'tds'], blurb: 'Relational database' },
  { id: 'sqlite', name: 'SQLite', category: 'database', dialect: 'sqlite', icon: 'sqlite', color: '#003B57', group: 'Databases', keywords: ['file', 'embedded'], blurb: 'Embedded database file' },
  { id: 'mongodb', name: 'MongoDB', category: 'database', dialect: 'mongodb', icon: 'mongodb', color: '#47A248', group: 'Databases', keywords: ['nosql', 'document'], blurb: 'Document database' },
  { id: 'clickhouse', name: 'ClickHouse', category: 'database', dialect: 'clickhouse', icon: 'clickhouse', color: '#E6B400', group: 'Databases', keywords: ['olap', 'columnar', 'analytics'], blurb: 'Columnar analytics database' },

  // ---- Search & time-series ----
  { id: 'elasticsearch', name: 'Elasticsearch', category: 'database', dialect: 'elasticsearch', icon: 'elasticsearch', color: '#005571', group: 'Search & time-series', keywords: ['search', 'elk', 'lucene'], blurb: 'Search & analytics engine' },
  { id: 'influxdb', name: 'InfluxDB', category: 'database', dialect: 'influxdb', icon: 'influxdb', color: '#22ADF6', group: 'Search & time-series', keywords: ['timeseries', 'metrics', 'iot'], blurb: 'Time-series database' },

  // ---- APIs & connectors ----
  { id: 'rest-api', name: 'REST / HTTP API', category: 'api', color: '#2F8F5B', group: 'APIs & connectors', keywords: ['rest', 'http', 'openapi', 'webhook', 'json'], blurb: 'Connect any HTTP/JSON API' },
  { id: 'mcp', name: 'MCP Server', category: 'mcp', color: '#7A5AF8', group: 'APIs & connectors', keywords: ['model context protocol', 'tools', 'agent'], blurb: 'Model Context Protocol server' },
  { id: 'airbyte', name: 'Airbyte (3rd-party connectors)', category: 'airbyte', icon: 'airbyte', color: '#615EFF', group: 'APIs & connectors', keywords: ['etl', 'connector', 'sync', 'saas'], blurb: '300+ SaaS & DB connectors' },

  // ---- Files ----
  { id: 's3', name: 'Amazon S3', category: 'file', dialect: undefined, icon: 's3', color: '#569A31', group: 'Files', keywords: ['bucket', 'object storage', 'aws', 'file'], blurb: 'Object storage bucket' },
  { id: 'sftp', name: 'SFTP / File server', category: 'file', color: '#5B6472', group: 'Files', keywords: ['ftp', 'files', 'csv', 'excel', 'parquet'], blurb: 'Files over SFTP/FTP' },

  // ---- Industrial ----
  { id: 'prism', name: 'Prism (IIoT)', category: 'prism', color: '#0E9F9F', group: 'Industrial', keywords: ['iiot', 'energy', 'sensors', 'opc', 'historian'], blurb: 'Mosaic PRISM energy / IIoT' },
]

// Map a catalog category to the Data Sources sub-tab that owns its connection flow.
export const CATEGORY_TAB: Record<DsCategory, string> = {
  database: 'databases',
  api: 'apis',
  mcp: 'mcp',
  file: 'files',
  airbyte: 'airbyte',
  prism: 'prism',
}

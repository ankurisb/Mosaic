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
  apiPreset?: string        // for category 'api' — pre-selects this built-in API template (PRESETS label)
  fileTransport?: string    // for category 'file' — pre-selects the file-server transport (smb/sftp/s3/sharepoint/local)
  icon?: string             // key into BRAND_ICONS; omit for a monogram fallback
  color?: string            // brand colour (data) for the icon tile
  group: string             // section heading in the catalog
  keywords?: string[]       // extra search terms
  blurb?: string            // one-line description under the name
}

// Section display order. (Airbyte's 592 connectors are rendered as their own section by the
// catalog component from lib/airbyte-sources.ts, not listed here.)
export const DS_GROUPS = ['Data warehouses', 'Databases', 'Search & time-series', 'Business apps & APIs', 'Files', 'Industrial'] as const

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

  // ---- Business apps & APIs (built-in API templates + the generic flows) ----
  { id: 'rest-api', name: 'REST / HTTP API', category: 'api', apiPreset: 'Custom', color: '#2F8F5B', group: 'Business apps & APIs', keywords: ['rest', 'http', 'openapi', 'webhook', 'json', 'custom'], blurb: 'Connect any HTTP/JSON API' },
  { id: 'salesforce', name: 'Salesforce', category: 'api', apiPreset: 'Salesforce', icon: 'salesforce', color: '#00A1E0', group: 'Business apps & APIs', keywords: ['crm', 'sfdc'], blurb: 'CRM — built-in API template' },
  { id: 'hubspot', name: 'HubSpot', category: 'api', apiPreset: 'HubSpot', icon: 'hubspot', color: '#FF7A59', group: 'Business apps & APIs', keywords: ['crm', 'marketing'], blurb: 'CRM — built-in API template' },
  { id: 'stripe', name: 'Stripe', category: 'api', apiPreset: 'Stripe', icon: 'stripe', color: '#635BFF', group: 'Business apps & APIs', keywords: ['payments', 'billing'], blurb: 'Payments — built-in API template' },
  { id: 'slack', name: 'Slack', category: 'api', apiPreset: 'Slack', icon: 'slack', color: '#4A154B', group: 'Business apps & APIs', keywords: ['chat', 'messaging'], blurb: 'Messaging — built-in API template' },
  { id: 'github', name: 'GitHub', category: 'api', apiPreset: 'GitHub', icon: 'github', color: '#181717', group: 'Business apps & APIs', keywords: ['git', 'repos', 'issues'], blurb: 'Repos & issues — built-in API template' },
  { id: 'notion', name: 'Notion', category: 'api', apiPreset: 'Notion', icon: 'notion', color: '#0A0A0A', group: 'Business apps & APIs', keywords: ['docs', 'wiki'], blurb: 'Docs — built-in API template' },
  { id: 'jira', name: 'Jira', category: 'api', apiPreset: 'Jira', icon: 'jira', color: '#0052CC', group: 'Business apps & APIs', keywords: ['atlassian', 'issues', 'tickets'], blurb: 'Issues — built-in API template' },
  { id: 'sap', name: 'SAP S/4HANA', category: 'api', apiPreset: 'SAP S/4HANA', icon: 'sap', color: '#0FAAFF', group: 'Business apps & APIs', keywords: ['erp', 'odata', 's4hana'], blurb: 'ERP OData — built-in API template' },
  { id: 'mcp', name: 'MCP Server', category: 'mcp', color: '#7A5AF8', group: 'Business apps & APIs', keywords: ['model context protocol', 'tools', 'agent'], blurb: 'Model Context Protocol server' },
  { id: 'airbyte', name: 'Airbyte connector', category: 'airbyte', icon: 'airbyte', color: '#615EFF', group: 'Business apps & APIs', keywords: ['etl', 'connector', 'sync', 'saas'], blurb: '590+ SaaS & DB connectors' },

  // ---- Files (CSV / Excel / PDF / XML / JSON from a share, bucket or path) ----
  { id: 'smb', name: 'SMB / Windows share', category: 'file', fileTransport: 'smb', color: '#1E7FD6', group: 'Files', keywords: ['windows', 'cifs', 'network share', 'files'], blurb: 'Windows / CIFS network share' },
  { id: 'sftp', name: 'SFTP', category: 'file', fileTransport: 'sftp', color: '#5B6472', group: 'Files', keywords: ['ftp', 'ssh', 'files'], blurb: 'Files over SFTP' },
  { id: 's3', name: 'Amazon S3', category: 'file', fileTransport: 's3', icon: 's3', color: '#569A31', group: 'Files', keywords: ['bucket', 'object storage', 'aws'], blurb: 'Object storage bucket' },
  { id: 'sharepoint', name: 'SharePoint', category: 'file', fileTransport: 'sharepoint', color: '#038387', group: 'Files', keywords: ['microsoft', 'office 365', 'documents'], blurb: 'SharePoint document library' },
  { id: 'local', name: 'Local path', category: 'file', fileTransport: 'local', color: '#5B6472', group: 'Files', keywords: ['folder', 'directory', 'disk'], blurb: 'A path on the Mosaic host' },

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

// Catalog of self-hosted MCP servers Mosaic can provision for you (option 2). Each entry is a pure
// DESCRIPTOR — image, port, transport, and the environment the server needs — so adding a new
// managed MCP server is authoring one object here, not writing code. The generic engine
// (mcp-manager + the API route + the form) reads this to render the credential form, encrypt the
// secret fields, start the sidecar, and register the connection.
//
// NOTE: an image added here must ALSO be on the manager's MCP_ALLOWED_IMAGES allowlist (compose) —
// the manager fails closed on anything not explicitly allowed, by design.

export interface McpCatalogField {
  key: string            // env var name set on the sidecar
  label: string          // form label
  secret?: boolean       // stored encrypted; rendered as a password input
  required?: boolean
  placeholder?: string
  help?: string
  group?: string         // optional grouping hint (e.g. 'auth') for the form
}

export interface McpCatalogEntry {
  id: string             // stable catalog id (also the sidecar name prefix)
  name: string
  blurb: string
  image: string          // container image (must be on the manager allowlist)
  port: number           // port the MCP server listens on inside the container
  transport: 'sse' | 'http'
  path: string           // endpoint path (e.g. '/sse')
  icon?: string          // bundled icon key (datasource-icons / connector slug), optional
  color?: string
  fixedEnv: Record<string, string>   // non-editable env the transport/mode needs
  fields: McpCatalogField[]          // user-entered env (some secret)
  authNote?: string      // one-line guidance shown above the auth fields
}

export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: 'thingsboard',
    name: 'ThingsBoard',
    blurb: 'IoT device data, telemetry, alarms and assets from a ThingsBoard instance.',
    image: 'thingsboard/mcp',
    port: 8000,
    transport: 'sse',
    path: '/sse',
    color: '#305680',
    // SSE server mode — fixed, not shown to the user.
    fixedEnv: {
      SPRING_AI_MCP_SERVER_STDIO: 'false',
      SPRING_WEB_APPLICATION_TYPE: 'servlet',
      HTTP_BIND_ADDRESS: '0.0.0.0',
    },
    authNote: 'Use a Tenant Administrator account (the system admin owns no device data). On ThingsBoard 4.3+ you can use an API key instead of username/password.',
    fields: [
      { key: 'THINGSBOARD_URL', label: 'Instance URL', required: true, placeholder: 'https://platform.example.com', help: 'Base URL of your ThingsBoard instance.' },
      { key: 'THINGSBOARD_USERNAME', label: 'Tenant admin email', group: 'auth', placeholder: 'admin@example.com' },
      { key: 'THINGSBOARD_PASSWORD', label: 'Password', secret: true, group: 'auth' },
      { key: 'THINGSBOARD_API_KEY', label: 'API key (ThingsBoard 4.3+)', secret: true, group: 'auth', help: 'Alternative to username/password. Leave the two fields above blank if you use this.' },
    ],
  },
]

export function getCatalogEntry(id: string): McpCatalogEntry | undefined {
  return MCP_CATALOG.find(e => e.id === id)
}

// The internal URL Mosaic uses to reach a provisioned sidecar (by container name on the shared net).
export function sidecarEndpoint(entry: McpCatalogEntry, sidecarName: string): string {
  return `http://${sidecarName}:${entry.port}${entry.path}`
}

// A safe redacted view of the catalog for the browser (no secrets travel outbound; this is metadata
// only, but we also never send fixedEnv values the UI doesn't need).
export function catalogForClient() {
  return MCP_CATALOG.map(e => ({
    id: e.id, name: e.name, blurb: e.blurb, transport: e.transport, color: e.color,
    authNote: e.authNote,
    fields: e.fields.map(f => ({ key: f.key, label: f.label, secret: !!f.secret, required: !!f.required, placeholder: f.placeholder, help: f.help, group: f.group })),
  }))
}

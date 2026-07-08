// lib/surfaces.ts
// Client-safe surface constants (no server imports). Shared by the browser UI
// and the server-side permission logic in lib/permissions.ts.

export const SURFACES = ['n8n', 'superset', 'airbyte', 'ciso'] as const
export type Surface = (typeof SURFACES)[number]

export const SURFACE_LABELS: Record<Surface, string> = {
  n8n: 'Workflow Automation (n8n)',
  superset: 'Analytics (Superset)',
  airbyte: 'Data Pipelines (Airbyte)',
  ciso: 'Compliance (CISO Assistant)',
}

export function isSurface(x: unknown): x is Surface {
  return typeof x === 'string' && (SURFACES as readonly string[]).includes(x)
}

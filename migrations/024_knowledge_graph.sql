-- migrations/024_knowledge_graph.sql
-- Knowledge graph (Asset Explorer).
--
-- A property graph DERIVED from whatever sources a customer has connected — not
-- hand-authored. Every install runs the same materialiser (lib/graph-materialize):
-- introspect each source, read its semantic roles (semantic_descriptions) and the
-- conformed-dimension crosswalk (022), emit entity NODES (identifier/dimension
-- values) and intra-source EDGES (containment/hierarchy), then propose cross-source
-- same_as edges that an admin verifies.
--
-- Design invariant — EVERY EDGE IS EARNED. An edge exists only because the data
-- justifies it (provenance='data') or an admin asserted it (provenance='manual').
-- same_as starts status='pending' and never joins identities until verified. A
-- source with nothing to match stays a disconnected island; that is correct, not a gap.

CREATE TABLE IF NOT EXISTS graph_nodes (
  id           TEXT PRIMARY KEY,          -- deterministic: '<source_type>:<source_id>:<kind>:<natural_key>'
  source_type  TEXT NOT NULL,             -- database | prism | api | file | manual
  source_id    TEXT NOT NULL,             -- the connection/instance id (or 'manual')
  kind         TEXT NOT NULL,             -- plant | line | asset | sensor | gateway | source | dimension | other
  natural_key  TEXT NOT NULL,             -- raw identifier/dimension value as it appears in the source
  label        TEXT NOT NULL,             -- human label (often same as natural_key)
  props        TEXT DEFAULT '{}',         -- JSON: free-form properties (equipment type, unit, last-seen, etc.)
  status       TEXT DEFAULT 'active',     -- active | retired (retired = no longer seen in source)
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_source ON graph_nodes(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_kind   ON graph_nodes(kind);

CREATE TABLE IF NOT EXISTS graph_edges (
  id           TEXT PRIMARY KEY,          -- deterministic for data/auto edges, random for manual
  src          TEXT NOT NULL,             -- -> graph_nodes.id
  dst          TEXT NOT NULL,             -- -> graph_nodes.id
  type         TEXT NOT NULL,             -- contains | measured_on | same_as | related
  provenance   TEXT NOT NULL DEFAULT 'data',   -- data | manual
  confidence   REAL,                      -- 0..1 for proposed same_as, NULL for structural edges
  status       TEXT NOT NULL DEFAULT 'verified', -- verified | pending | rejected
  evidence     TEXT DEFAULT '',           -- why this edge exists (matched tokens, FK name, admin note)
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_graph_edges_src ON graph_edges(src);
CREATE INDEX IF NOT EXISTS idx_graph_edges_dst ON graph_edges(dst);
CREATE INDEX IF NOT EXISTS idx_graph_edges_status ON graph_edges(status);

-- One row per materialisation run, for the Settings → Knowledge Graph status panel.
CREATE TABLE IF NOT EXISTS graph_runs (
  id           TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  started_at   TEXT DEFAULT (datetime('now')),
  finished_at  TEXT,
  status       TEXT DEFAULT 'running',    -- running | ok | error
  nodes        INTEGER DEFAULT 0,
  edges        INTEGER DEFAULT 0,
  pending      INTEGER DEFAULT 0,         -- pending same_as proposals awaiting review
  sources      INTEGER DEFAULT 0,
  detail       TEXT DEFAULT '{}',         -- JSON: per-source counts
  error        TEXT
);

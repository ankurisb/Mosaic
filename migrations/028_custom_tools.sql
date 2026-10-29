-- 028_custom_tools.sql
-- Phase E: admin-authored custom HTTP tools. A registered tool is a named capability (an HTTP
-- endpoint + URL template + input schema) that agents can be given. This widens the trust
-- boundary, so tools are read-only by default and every call is SSRF-checked at run time
-- (lib/custom-tools). agents.custom_tool_ids is a JSON array of the custom_tools attached to an
-- agent; the runner resolves them to definitions and exposes them to the model.
CREATE TABLE IF NOT EXISTS custom_tools (
  id             TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  method         TEXT NOT NULL DEFAULT 'GET',
  url_template   TEXT NOT NULL DEFAULT '',
  headers        TEXT NOT NULL DEFAULT '{}',
  body_template  TEXT,
  read_only      INTEGER NOT NULL DEFAULT 1,
  input_schema   TEXT NOT NULL DEFAULT '{"type":"object","properties":{}}',
  enabled        INTEGER NOT NULL DEFAULT 1,
  created_by     TEXT,
  created_at     TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_tools_name ON custom_tools(name);
ALTER TABLE agents ADD COLUMN custom_tool_ids TEXT NOT NULL DEFAULT '[]';

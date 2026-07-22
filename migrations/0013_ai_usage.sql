-- Tracks every Anthropic API call the app makes, so the admin dashboard can
-- report real usage and an estimated spend instead of a guess. One row per
-- call (see functions/_lib/aiUsage.js) — endpoint identifies which feature
-- made the call (biography, summarize, title, enrich-places, insights),
-- tokens come straight from Anthropic's own response `usage` object.
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id            TEXT PRIMARY KEY,
  endpoint      TEXT NOT NULL,
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  user_id       TEXT,
  user_email    TEXT,
  ok            INTEGER NOT NULL DEFAULT 1,  -- 0 if the upstream call failed (still worth counting — it's spend either way once tokens are billed, and a failure spike is itself worth seeing)
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_endpoint ON ai_usage_log(endpoint, created_at DESC);

-- Durable, append-only activity history — separate from family_tree's
-- tree_json blob so it can never be silently reverted by a client's own
-- merge logic. The blob still carries a capped, fast local `activity` array
-- for the in-app feed's common case; this table is the real record of what
-- happened, kept forever, and is what backs the admin audit log.
CREATE TABLE IF NOT EXISTS activity_log (
  id           TEXT PRIMARY KEY,
  family_id    TEXT NOT NULL REFERENCES family(id),
  author_name  TEXT,
  author_email TEXT,
  type         TEXT NOT NULL,
  person_id    TEXT,
  person_name  TEXT,
  detail       TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_log_family ON activity_log(family_id, created_at DESC);

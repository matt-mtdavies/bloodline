-- Per-user tree blob — stores the full client state as JSON.
-- The normalised person/relationship tables exist for Phase 4 collaboration;
-- for solo use this is the source of truth, fast to read/write, trivial to sync.
CREATE TABLE IF NOT EXISTS user_tree (
  user_id    TEXT PRIMARY KEY REFERENCES user(id),
  tree_json  TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

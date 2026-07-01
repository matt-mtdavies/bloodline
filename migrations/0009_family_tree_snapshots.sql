-- Point-in-time backups of family_tree.tree_json. family_tree itself is a
-- single row per family, overwritten in place on every save — there was no
-- way to recover a previous state before this (the root cause behind an
-- unrecoverable edit reported earlier: a stale device's merge silently
-- reverted someone else's work, and the old value was simply gone).
--
-- One row is archived here right before each overwrite, so any save —
-- including ones that are now locked down to co-admin+ (erase, replace-
-- import, merge, remove person) — can be rolled back if it goes wrong.
-- Pruned to the most recent 30 per family (see functions/api/tree.js).
CREATE TABLE IF NOT EXISTS family_tree_snapshot (
  id          TEXT PRIMARY KEY,
  family_id   TEXT NOT NULL REFERENCES family(id),
  tree_json   TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_snapshot_family ON family_tree_snapshot(family_id, created_at DESC);

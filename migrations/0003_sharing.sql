-- Phase 3: Sharing + collaboration schema
--
-- family_tree replaces user_tree (scoped to the family, not the individual).
-- family_member tracks who belongs to which family and what role they hold.
-- invite gains a role column so the recipient gets the right access on accept.

CREATE TABLE IF NOT EXISTS family_tree (
  family_id  TEXT PRIMARY KEY REFERENCES family(id),
  tree_json  TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS family_member (
  family_id  TEXT NOT NULL REFERENCES family(id),
  user_id    TEXT NOT NULL REFERENCES user(id),
  role       TEXT NOT NULL DEFAULT 'viewer', -- owner|coadmin|editor|contributor|viewer
  invited_by TEXT REFERENCES user(id),
  joined_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (family_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_member_user ON family_member(user_id);

-- Add role to pending invites (default viewer for safety).
ALTER TABLE invite ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer';

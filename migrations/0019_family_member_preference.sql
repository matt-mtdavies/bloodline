-- Family Perimeter (docs/FAMILY-PERIMETER-AND-5000-PERSON-PERFORMANCE.md §9.1,
-- Phase 3) — one row per (family, user) holding that member's own everyday-
-- family-scope setting. Deliberately its OWN table, not folded into
-- user.notification_prefs or the shared family_tree.tree_json blob: this is
-- genuinely per-(family, user), and §4.1's "Personal: your setting affects
-- only your view" promise requires it stay OUT of anything shared — a
-- perimeter level stored in the shared tree JSON would leak one viewer's
-- personal browsing preference onto every other member's screen.
--
-- Absence of a row means "no preference chosen yet." Defaulting that absence
-- to 'everyone' (§3.1: "existing users initially receive Complete family
-- tree," so shipping this feature never silently narrows anyone's current
-- view) is the API layer's job (functions/_lib/familyMemberPreference.js),
-- not this schema's.
--
-- `source` (Codex review, PR #88) distinguishes a row the SYSTEM planted as
-- a starting suggestion from a row the MEMBER actually chose — without it,
-- the moment the "offer Extended family as a recommendation" write (§3.1)
-- lands, it's indistinguishable from a real, explicit choice, so the
-- Profile UI's "Recommended" badge would vanish the instant it appeared,
-- and nothing downstream could ever again tell a suggestion from consent.
-- 'recommended' rows are written only by the ifUnset planting path; any
-- ordinary member-initiated save always writes 'explicit', permanently —
-- there is no path back from 'explicit' to 'recommended'.
CREATE TABLE IF NOT EXISTS family_member_preference (
  family_id           TEXT NOT NULL REFERENCES family(id),
  user_id             TEXT NOT NULL REFERENCES user(id),
  perimeter_level     TEXT NOT NULL DEFAULT 'everyone', -- first|second|third|everyone
  source              TEXT NOT NULL DEFAULT 'explicit', -- explicit|recommended
  preference_version  INTEGER NOT NULL DEFAULT 1,
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (family_id, user_id)
);

-- Audit trail for perimeter changes ONLY (§9.2: "audit the setting change
-- without recording relationship details"). Deliberately separate from the
-- family-visible activity_log (migration 0008): a personal browsing
-- preference is not a family fact — showing "Aunt Carol narrowed her view to
-- Extended family" in everyone else's shared activity feed would contradict
-- the very "affects only your view" promise this feature makes. This table
-- records who changed which level when, and nothing about people,
-- relationships, or tree content — never read by the family activity feed.
CREATE TABLE IF NOT EXISTS family_member_preference_audit (
  id         TEXT PRIMARY KEY,
  family_id  TEXT NOT NULL REFERENCES family(id),
  user_id    TEXT NOT NULL REFERENCES user(id),
  old_level  TEXT,
  new_level  TEXT NOT NULL,
  changed_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_perimeter_audit_family ON family_member_preference_audit(family_id, changed_at DESC);

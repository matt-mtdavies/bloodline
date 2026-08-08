-- Per-(family, user) "recap cutoff" — the timestamp up to which that member
-- has watched/dismissed the "N updates since last visit" recap tour
-- (src/App.jsx's startRecapTour, src/data/store.js's takeRecapCutoff/
-- setRecapCutoff). Previously tracked ONLY in localStorage
-- (RECAP_CUTOFF_KEY), which is genuinely per-DEVICE, not per-user — real
-- feedback: watching the recap on one device still replayed the same batch
-- of updates on another. Same (family_id, user_id) shape as
-- family_member_preference (migration 0019), deliberately its OWN table
-- rather than a new column there — an unrelated concern (recap-seen
-- tracking, not viewing scope) that changes on every ordinary visit rather
-- than a deliberate settings change, so it doesn't need that table's
-- source/audit machinery.
CREATE TABLE IF NOT EXISTS family_member_recap (
  family_id  TEXT NOT NULL REFERENCES family(id),
  user_id    TEXT NOT NULL REFERENCES user(id),
  cutoff_at  INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (family_id, user_id)
);

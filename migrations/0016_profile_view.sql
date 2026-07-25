-- Family Moments slice 4 ("forgotten people") — one row per (viewer, person)
-- pair, upserted on every profile open, so this only ever holds the LATEST
-- view time rather than an unbounded append-only history nobody needs (the
-- insight only ever asks "when did I last look at this profile?", never
-- "how many times", so there's no reason to log every individual view).
--
-- family_id is included alongside person_id (not just viewer_user_id +
-- person_id) because person ids are generated client-side (see store.js's
-- uid()) and are only guaranteed unique WITHIN one family's own tree, not
-- globally across every family in the system — omitting it risks two
-- different families' unrelated people colliding on the same id and
-- corrupting each other's "last viewed" tracking.
--
-- Strictly private to each viewer's own reflection on their own behavior —
-- this table is deliberately never read by any endpoint other than the
-- viewer looking up THEIR OWN rows (functions/api/profile-views.js), never
-- exposed to any other family member, and never surfaced in the admin
-- dashboard. There is no legitimate reading of "who has been looking at
-- whose profile" this feature is meant to answer.
CREATE TABLE IF NOT EXISTS profile_view (
  viewer_user_id TEXT NOT NULL REFERENCES user(id),
  family_id      TEXT NOT NULL REFERENCES family(id),
  person_id      TEXT NOT NULL,
  viewed_at      INTEGER NOT NULL,
  PRIMARY KEY (viewer_user_id, family_id, person_id)
);

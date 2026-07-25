-- Family Moments slice 6 — silent engagement instrumentation. Every time
-- the always-on banner (FamilyMomentBanner.jsx) actually renders a moment
-- on screen, and every time the viewer taps into one, one row is appended
-- here. Nothing in the app reads this table back — no ranking, no
-- personalization, no UI. It exists purely so a future slice (deciding
-- which moment categories are actually worth surfacing more often) has
-- real usage data to work from instead of guessing; see the "learns over
-- time" thread in docs/FAMILY-MOMENTS.md's own product-vision discussion,
-- which explicitly cannot ship day-one without accumulated history like
-- this to learn FROM.
--
-- Deliberately append-only (unlike profile_view's upsert-latest — this
-- slice needs the individual events, not just a "most recent" snapshot) but
-- deliberately low-volume: at most a couple of rows per viewer per day (one
-- "shown" per banner appearance, one "tapped" if they act on it), so an
-- unbounded log is not a growth concern on any realistic timescale.
--
-- family_id is included for the same reason profile_view's migration
-- documents: person/moment ids are only unique WITHIN one family's tree,
-- and family_id lets future analysis be scoped per-family if ever needed.
CREATE TABLE IF NOT EXISTS family_moment_engagement (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  viewer_user_id TEXT NOT NULL REFERENCES user(id),
  family_id      TEXT NOT NULL REFERENCES family(id),
  moment_key     TEXT NOT NULL,
  event          TEXT NOT NULL CHECK (event IN ('shown', 'tapped')),
  occurred_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_family_moment_engagement_family_key
  ON family_moment_engagement (family_id, moment_key);

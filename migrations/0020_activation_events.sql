-- Privacy-preserving, aggregate-only funnel telemetry for the public
-- product foundation (docs/PRODUCTIZATION-BRIEF.md §11.7, §12 Phase B:
-- "Measure funnel events with privacy-preserving, aggregate telemetry:
-- public CTA click, path chosen, onboarding completion, first tree
-- created/import completed, invitation accepted, and first meaningful
-- contribution. Do not record family content.").
--
-- Deliberately carries nothing that could identify a person, family, or
-- account: `event` is one of a small fixed set (enforced server-side in
-- functions/api/activation-event.js, not just here), `path` is an optional
-- short label (e.g. which start-path was chosen), and there is no user id,
-- email, session id, IP, or free-text field of any kind — this table is
-- never joined to `user`/`family`/`person`/`activity_log`, and couldn't be
-- even if someone tried, since it holds no foreign key into any of them.
CREATE TABLE IF NOT EXISTS activation_event (
  id         TEXT PRIMARY KEY,
  event      TEXT NOT NULL,
  path       TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_activation_event_created ON activation_event(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activation_event_type ON activation_event(event, created_at DESC);

-- Birthday calendar subscription. An .ics feed (functions/api/calendar/[token].js)
-- is fetched directly by external calendar apps (Apple Calendar, Google
-- Calendar) on their own periodic schedule — they can't do the magic-link
-- login flow, so there's no session to check. A long, unguessable per-family
-- token in the URL itself is the standard pattern for this (it's how Google
-- Calendar's own "secret address in iCal format" works too). Nullable and
-- generated lazily on first request, not at family creation, so families
-- that never use the feature never have a live token sitting around.
ALTER TABLE family ADD COLUMN calendar_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_family_calendar_token ON family(calendar_token);

-- Curated opt-in list, not "everyone in the tree" — a family with 200 people
-- would otherwise dump 200 recurring reminders into someone's calendar the
-- moment they subscribe. NULL means "not configured yet" (the settings UI
-- shows every eligible person unchecked-by-default until the owner/coadmin
-- picks); a saved JSON array of person ids (including an empty one, `[]`)
-- means the feed should show exactly those people and no others.
ALTER TABLE family ADD COLUMN calendar_person_ids TEXT;

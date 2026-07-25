-- Family Moments slice 3 (geography/distance insights) — a global,
-- family-agnostic cache of resolved place-name -> town/city-centroid
-- coordinates. Shared across every family, not scoped to one: a place
-- string like "Cardiff, Wales" is public geography, not private family
-- data, so there is no reason for two different families who both have a
-- relative born or living in Cardiff to each pay for (and rate-limit
-- against) their own separate geocode lookup.
--
-- Deliberately town/city granularity only — the geocoded input is always
-- whatever's already stored in person.residence/birth_place (e.g. "Cardiff,
-- Wales", never a street address), and this table only ever stores that
-- same granularity of result back. No street-level precision is ever
-- requested from or returned by the geocoding provider.
--
-- status also caches a FAILED lookup ('not_found') so an unresolvable or
-- typo'd place string is never re-queried against the provider on every
-- subsequent request — Nominatim's usage policy is unauthenticated-app
-- rate limited, and a cache that only remembered successes would keep
-- hammering it for the same failure indefinitely.
CREATE TABLE IF NOT EXISTS place_geocode (
  place_key    TEXT PRIMARY KEY, -- normalized (trimmed, lowercased) input place string
  display_name TEXT,             -- the provider's own resolved display name, for debugging/audit only
  lat          REAL,
  lon          REAL,
  status       TEXT NOT NULL CHECK (status IN ('ok', 'not_found')),
  resolved_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

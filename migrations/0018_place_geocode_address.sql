-- Places Lived: structured address grouping. Adds the suburb/state/country
-- breakdown Nominatim already returns (via `addressdetails=1`) alongside the
-- lat/lon this cache already stored — previously discarded entirely (see
-- functions/_lib/geocode.js). Lets residences[] entries (and, going forward,
-- birth_place/residence too, since they share the same cache) be grouped by a
-- provider-normalized state/country rather than whatever spelling/abbreviation
-- a person happened to type ("Vic" vs "Victoria" vs "VIC, Australia").
--
-- Nullable and additive: every existing cached row simply has NULL for the
-- three new columns until it's next resolved (a cache miss re-fetches with
-- the richer request; a cache hit on an old row just has no structured
-- breakdown yet — callers treat that exactly like "not yet grouped", never
-- an error).
ALTER TABLE place_geocode ADD COLUMN suburb TEXT;
ALTER TABLE place_geocode ADD COLUMN state TEXT;
ALTER TABLE place_geocode ADD COLUMN country TEXT;

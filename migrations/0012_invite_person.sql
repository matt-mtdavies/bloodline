-- Personalize invites with the specific person in the tree they're for.
-- A name snapshot captured at send time, not a live join — person records
-- live in family_tree.tree_json, not a relational table here, so there's
-- nothing to foreign-key against. Both nullable: every row created before
-- this column existed reads as NULL, which every consumer already treats
-- as "not personalized" (falls back to the existing invited_email match).
ALTER TABLE invite ADD COLUMN person_id TEXT;
ALTER TABLE invite ADD COLUMN person_name TEXT;

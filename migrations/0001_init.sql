-- Bloodline — initial schema (§3).
-- The core primitive is "a person relative to someone": directional parent and
-- partner edges are stored; siblings are derived. edit_log exists from day one
-- because it powers both the activity feed and conflict resolution later.

CREATE TABLE IF NOT EXISTS family (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_by  TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS person (
  id                 TEXT PRIMARY KEY,
  family_id          TEXT NOT NULL REFERENCES family(id),
  display_name       TEXT NOT NULL,
  given_names        TEXT,
  family_name        TEXT,
  maiden_name        TEXT,
  birth_date         TEXT,            -- partial dates allowed: 'YYYY', 'YYYY-MM', 'YYYY-MM-DD'
  death_date         TEXT,
  is_living          INTEGER NOT NULL DEFAULT 1,
  is_deceased        INTEGER NOT NULL DEFAULT 0,
  is_minor           INTEGER NOT NULL DEFAULT 0,
  gender             TEXT,
  birth_place        TEXT,
  bio                TEXT,
  photo_key          TEXT,            -- R2 object key
  created_by         TEXT,            -- user id
  claimed_by_user_id TEXT,            -- null until the person claims their node
  confidence         TEXT NOT NULL DEFAULT 'confirmed', -- 'confirmed' | 'uncertain'
  created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at         INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_person_family ON person(family_id);

CREATE TABLE IF NOT EXISTS relationship (
  id             TEXT PRIMARY KEY,
  family_id      TEXT NOT NULL REFERENCES family(id),
  from_person    TEXT NOT NULL REFERENCES person(id),
  to_person      TEXT NOT NULL REFERENCES person(id),
  type           TEXT NOT NULL,       -- 'parent' | 'partner'
  qualifier      TEXT DEFAULT 'biological', -- biological|adopted|step|foster|guardian
  partner_status TEXT,                -- current|former|widowed (partner edges only)
  since          TEXT,
  until          TEXT,
  created_by     TEXT,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_rel_family ON relationship(family_id);
CREATE INDEX IF NOT EXISTS idx_rel_from ON relationship(from_person);
CREATE INDEX IF NOT EXISTS idx_rel_to ON relationship(to_person);

CREATE TABLE IF NOT EXISTS user (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  person_id  TEXT REFERENCES person(id),   -- the node they claimed = themselves
  family_id  TEXT REFERENCES family(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen  INTEGER
);

-- Magic-link auth: short-lived single-use tokens. No passwords, ever.
CREATE TABLE IF NOT EXISTS auth_token (
  token      TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  purpose    TEXT NOT NULL DEFAULT 'login', -- 'login' | 'invite'
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS invite (
  id               TEXT PRIMARY KEY,
  family_id        TEXT NOT NULL REFERENCES family(id),
  from_user        TEXT,
  target_person_id TEXT REFERENCES person(id),  -- the node they'll land on (themselves)
  email            TEXT NOT NULL,
  token            TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending', -- pending|accepted|expired
  expires_at       INTEGER NOT NULL,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS claim (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  person_id       TEXT NOT NULL,
  merged_from     TEXT,   -- if claiming resolved a duplicate
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- The spine of the activity feed AND conflict resolution. Built from day one.
CREATE TABLE IF NOT EXISTS edit_log (
  id          TEXT PRIMARY KEY,
  family_id   TEXT NOT NULL,
  actor_user  TEXT,
  entity_type TEXT NOT NULL,   -- 'person' | 'relationship'
  entity_id   TEXT NOT NULL,
  field       TEXT,
  old_value   TEXT,
  new_value   TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_editlog_family ON edit_log(family_id, created_at);

-- Queued micro-asks routed to the person most likely to know (§6).
CREATE TABLE IF NOT EXISTS contribution_prompt (
  id          TEXT PRIMARY KEY,
  family_id   TEXT NOT NULL,
  user_id     TEXT,
  person_id   TEXT,
  kind        TEXT NOT NULL,   -- 'photo' | 'date' | 'memory' | 'confirm'
  prompt      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open', -- open|answered|dismissed
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

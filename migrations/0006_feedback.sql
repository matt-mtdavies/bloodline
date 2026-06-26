-- User feedback submitted via the in-app "Send feedback" form.
CREATE TABLE IF NOT EXISTS feedback (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES user(id),
  email      TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'idea', -- idea | bug | praise | other
  message    TEXT NOT NULL,
  page       TEXT,   -- optional URL/context hint sent by the client
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);

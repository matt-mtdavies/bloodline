-- Track invite email deliverability so the admin dashboard can report a
-- historical "delivered vs failed" metric, not just the accept funnel.
--   email_status: 'sent'   — provider accepted the send
--                 'failed' — provider rejected (see email_error)
--                 'dev'    — suppressed (no provider key in this env)
--                 NULL     — older rows created before this column existed
ALTER TABLE invite ADD COLUMN email_status TEXT;
ALTER TABLE invite ADD COLUMN email_error TEXT;
ALTER TABLE invite ADD COLUMN email_sent_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_invite_email_status ON invite(email_status);

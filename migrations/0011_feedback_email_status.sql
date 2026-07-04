-- Track feedback email deliverability, same idea as 0007_invite_email_status.
-- Also fixes the underlying bug: /api/feedback used to fire the admin
-- notification email without awaiting it, so the Worker could (and
-- apparently did) get torn down before the Brevo request completed —
-- feedback saved fine, notification silently never sent. feedback.js now
-- awaits the send and records the outcome here.
--   email_status: 'sent'   — provider accepted the send
--                 'failed' — provider rejected (see email_error)
--                 'dev'    — suppressed (no provider key in this env)
--                 NULL     — no ADMIN_EMAIL configured, or older rows
ALTER TABLE feedback ADD COLUMN email_status TEXT;
ALTER TABLE feedback ADD COLUMN email_error TEXT;
ALTER TABLE feedback ADD COLUMN email_sent_at INTEGER;

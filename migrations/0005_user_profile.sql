-- Add display_name and notification preferences to the user table.
ALTER TABLE user ADD COLUMN display_name TEXT;
ALTER TABLE user ADD COLUMN notification_prefs TEXT DEFAULT '{"activity":true,"invites":true}';

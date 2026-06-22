-- Track brute-force attempts against a magic-link code.
-- Each failed POST /api/auth/verify increments this; at 5 the code is locked.
ALTER TABLE auth_token ADD COLUMN fail_count INTEGER NOT NULL DEFAULT 0;

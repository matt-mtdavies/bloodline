-- Full family archive export — job ledger + audit trail
-- (docs/FULL-ARCHIVE-EXPORT-COMPLETION-PHASE.md §4). family_export_job is the
-- product-visible progress/status record; the separately-deployed Cloudflare
-- Workflow instance (workflow_instance_id, always equal to the job id — see
-- §7) is the durable execution record. family_export_audit is a distinct,
-- append-only table so no lifecycle/download event can ever be edited or
-- backfilled after the fact — the same "durable, can't be silently reverted"
-- reasoning activity_log already uses (migrations/0008_activity_log.sql).

CREATE TABLE IF NOT EXISTS family_export_job (
  id                     TEXT PRIMARY KEY,
  family_id              TEXT NOT NULL REFERENCES family(id),
  requested_by_user_id   TEXT NOT NULL REFERENCES user(id),
  requested_as           TEXT NOT NULL CHECK (requested_as IN ('owner', 'coadmin', 'site_admin')),
  request_reason         TEXT,
  status                 TEXT NOT NULL,
  workflow_instance_id   TEXT,
  source_tree_updated_at INTEGER,
  source_extra_version   INTEGER,
  source_storage_mode    TEXT,
  expected_files         INTEGER,
  processed_files        INTEGER NOT NULL DEFAULT 0,
  expected_bytes         INTEGER,
  processed_bytes        INTEGER NOT NULL DEFAULT 0,
  warning_count          INTEGER NOT NULL DEFAULT 0,
  error_code             TEXT,
  error_summary          TEXT,
  archive_r2_key         TEXT,
  archive_bytes          INTEGER,
  archive_sha256         TEXT,
  manifest_sha256        TEXT,
  created_at             INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at             INTEGER,
  completed_at           INTEGER,
  expires_at             INTEGER,
  cancelled_at           INTEGER,
  last_heartbeat_at      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_export_job_family ON family_export_job(family_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_job_requester ON family_export_job(requested_by_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_job_status_expiry ON family_export_job(status, expires_at);

-- The concurrency authority (COMPLETION-PHASE.md §4 + the PR #8 review
-- thread that closed this exact gap): one row per family may ever be in a
-- non-terminal running state at a time, across all three authority paths.
-- `cancelling` is DELIBERATELY included alongside queued/snapshotting/
-- inventory/packaging/verifying — the family stays locked until the
-- cancelling job's multipart/staging cleanup actually reaches the terminal
-- `cancelled` state, closing the race window where a second job could
-- otherwise be created the instant cancellation starts, before cleanup
-- finishes. A UNIQUE constraint violation on INSERT is mapped by the
-- caller to `409 export_already_active` — this replaces read-then-insert,
-- it doesn't supplement it (functions/_lib/exportJob.js#createExportJobStatements).
CREATE UNIQUE INDEX IF NOT EXISTS idx_export_job_one_active_per_family
  ON family_export_job(family_id)
  WHERE status IN ('queued', 'snapshotting', 'inventory', 'packaging', 'verifying', 'cancelling');

CREATE TABLE IF NOT EXISTS family_export_audit (
  id                    TEXT PRIMARY KEY,
  job_id                TEXT NOT NULL REFERENCES family_export_job(id),
  family_id             TEXT NOT NULL REFERENCES family(id),
  -- Nullable: several events (started/ready/ready_with_warnings/failed/
  -- expired) are raised by the Workflow or the scheduled cleanup handler,
  -- not by a signed-in person — there is no user to attribute those to.
  actor_user_id         TEXT,
  actor_email_snapshot  TEXT,
  actor_authority       TEXT CHECK (actor_authority IS NULL OR actor_authority IN ('owner', 'coadmin', 'site_admin', 'system')),
  event                 TEXT NOT NULL CHECK (event IN (
                           'requested', 'started', 'ready', 'ready_with_warnings',
                           'failed', 'downloaded', 'cancel_requested', 'cancelled', 'expired'
                         )),
  reason                TEXT,
  created_at            INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_export_audit_job ON family_export_audit(job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_export_audit_family ON family_export_audit(family_id, created_at DESC);

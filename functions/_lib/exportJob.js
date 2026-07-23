import { uid } from './util.js';

/*
 * Shared state-transition module for family_export_job / family_export_audit
 * (docs/FULL-ARCHIVE-EXPORT-COMPLETION-PHASE.md §4,
 * migrations/0014_export_jobs.sql). This is the ONE place either side of the
 * export pipeline is allowed to move a job between states — the Pages
 * Functions under functions/api/exports* (create/list/cancel) and the
 * separately-deployed Workflow Worker (started/ready/failed/expired) both
 * import this exact file, rather than each re-deriving the state graph and
 * risking the two disagreeing about what's legal. The Worker reaches it via
 * a relative import across the workers/export-workflow boundary
 * (../../../functions/_lib/exportJob.js) — Wrangler bundles whatever `main`
 * transitively imports, wherever it lives on disk, and this module touches
 * nothing Workers-incompatible (no Node built-ins, no filesystem access).
 *
 * Every function here returns UNEXECUTED prepared statements for the caller
 * to run via env.DB.batch([...]) — the same convention
 * functions/_lib/treeStore.js already uses (see upsertTreeStatement,
 * snapshotStatements) — so a create or a transition can be committed
 * atomically alongside whatever else the caller needs in the same round
 * trip, and so this module never has an opinion about batching order
 * relative to other, unrelated statements.
 */

export const EXPORT_JOB_STATUSES = Object.freeze({
  QUEUED: 'queued',
  SNAPSHOTTING: 'snapshotting',
  INVENTORY: 'inventory',
  PACKAGING: 'packaging',
  VERIFYING: 'verifying',
  READY: 'ready',
  READY_WITH_WARNINGS: 'ready_with_warnings',
  CANCELLING: 'cancelling',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
  EXPIRED: 'expired',
});

const S = EXPORT_JOB_STATUSES;

// Every non-terminal status a job can be sitting in while "in progress" —
// this is the exact literal set the migration's partial unique index
// enforces (idx_export_job_one_active_per_family). Kept here too, as a
// single source of truth callers can assert against in tests, rather than
// letting the index's WHERE clause be the only place this list is spelled
// out.
export const RUNNING_STATUSES = Object.freeze([
  S.QUEUED, S.SNAPSHOTTING, S.INVENTORY, S.PACKAGING, S.VERIFYING, S.CANCELLING,
]);

export const READY_STATUSES = Object.freeze([S.READY, S.READY_WITH_WARNINGS]);
export const TERMINAL_STATUSES = Object.freeze([S.CANCELLED, S.FAILED, S.EXPIRED]);

// The full legal state graph (§4's "Allowed states"). A status with no entry
// here is terminal — nothing may transition FROM it, enforced structurally
// by canTransition() rather than a separate terminal-state check, so the
// graph itself is the only place "what's legal" is defined.
const ALLOWED_TRANSITIONS = Object.freeze({
  [S.QUEUED]: new Set([S.SNAPSHOTTING, S.CANCELLING, S.FAILED]),
  [S.SNAPSHOTTING]: new Set([S.INVENTORY, S.CANCELLING, S.FAILED]),
  [S.INVENTORY]: new Set([S.PACKAGING, S.CANCELLING, S.FAILED]),
  [S.PACKAGING]: new Set([S.VERIFYING, S.CANCELLING, S.FAILED]),
  [S.VERIFYING]: new Set([S.READY, S.READY_WITH_WARNINGS, S.CANCELLING, S.FAILED]),
  [S.CANCELLING]: new Set([S.CANCELLED]),
  [S.READY]: new Set([S.EXPIRED]),
  [S.READY_WITH_WARNINGS]: new Set([S.EXPIRED]),
});

export function canTransition(fromStatus, toStatus) {
  return ALLOWED_TRANSITIONS[fromStatus]?.has(toStatus) ?? false;
}

// The 11 stable public error codes (§12) — the only values allowed on
// error_code / a serialized job's errorCode. Anything else is an internal
// detail that must never reach a client.
export const EXPORT_ERROR_CODES = Object.freeze([
  'export_not_configured', 'export_already_active', 'export_rate_limited',
  'source_corrupt', 'source_incomplete', 'activity_log_unavailable',
  'requires_segmented_export', 'archive_verification_failed',
  'archive_unavailable', 'workflow_stalled', 'export_failed',
]);

const MAX_SUMMARY_CHARS = 500;

// Caps an internal (never client-facing) error/failure summary at 500 chars
// per §4's state-helper contract — this is the free-text `error_summary`
// column, never the stable `error_code`.
export function capSummary(text) {
  if (!text) return null;
  const s = String(text);
  return s.length > MAX_SUMMARY_CHARS ? `${s.slice(0, MAX_SUMMARY_CHARS - 1)}…` : s;
}

class ExportJobError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'ExportJobError';
    this.code = code;
  }
}
export { ExportJobError };

/*
 * Builds the [INSERT job, INSERT audit] pair for a brand-new export job.
 * Does NOT check for an existing active job itself — that's the partial
 * unique index's job (idx_export_job_one_active_per_family). The caller
 * runs this via env.DB.batch(...) and catches the UNIQUE constraint
 * violation, mapping it to `409 export_already_active` — deliberately
 * read-then-insert-free, per §4.
 */
export function createExportJobStatements(env, {
  familyId, requestedByUserId, requestedAs, requestReason = null, requestedByUserEmail = null, now = Date.now(),
}) {
  if (!['owner', 'coadmin', 'site_admin'].includes(requestedAs)) {
    throw new Error(`invalid requestedAs: ${requestedAs}`);
  }
  const jobId = uid('exp_');
  const nowSec = Math.floor(now / 1000);
  const insertJob = env.DB.prepare(
    `INSERT INTO family_export_job
       (id, family_id, requested_by_user_id, requested_as, request_reason, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(jobId, familyId, requestedByUserId, requestedAs, requestReason, S.QUEUED, nowSec);
  const insertAudit = buildAuditInsertStatement(env, {
    jobId, familyId, actorUserId: requestedByUserId, actorEmailSnapshot: requestedByUserEmail, actorAuthority: requestedAs,
    event: 'requested', reason: requestReason, now,
  });
  return { jobId, statements: [insertJob, insertAudit] };
}

function buildAuditInsertStatement(env, {
  jobId, familyId, actorUserId = null, actorEmailSnapshot = null, actorAuthority = null,
  event, reason = null, now = Date.now(),
}) {
  return env.DB.prepare(
    `INSERT INTO family_export_audit
       (id, job_id, family_id, actor_user_id, actor_email_snapshot, actor_authority, event, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(uid('expa_'), jobId, familyId, actorUserId, actorEmailSnapshot, actorAuthority, event, capSummary(reason), Math.floor(now / 1000));
}

/*
 * Builds the [UPDATE job, INSERT audit] pair for an ordinary lifecycle
 * transition. The UPDATE is an atomic conditional write — `WHERE id = ? AND
 * status IN (fromStatuses)` — the same optimistic-concurrency shape
 * treeStore.js#casUpdateTree already uses: if the job moved to some other
 * status since the caller last read it (a race with the Workflow, or a
 * second cancel request), `meta.changes` on the result is 0 and the caller
 * treats that as "the transition didn't apply," not as license to retry
 * blindly. Throws synchronously (before any I/O) if `toStatus` is not a
 * legal destination from ANY of `fromStatuses` — a programmer error, not a
 * race, so it never becomes a silent 0-row update.
 */
export function transitionJobStatements(env, {
  jobId, fromStatuses, toStatus, now = Date.now(), fields = {}, audit,
}) {
  const froms = Array.isArray(fromStatuses) ? fromStatuses : [fromStatuses];
  if (!froms.some((f) => canTransition(f, toStatus))) {
    throw new Error(`illegal transition to "${toStatus}" from [${froms.join(', ')}]`);
  }
  const setCols = { status: toStatus, ...fields };
  const setSql = Object.keys(setCols).map((k) => `${k} = ?`).join(', ');
  const setVals = Object.keys(setCols).map((k) => setCols[k]);
  const placeholders = froms.map(() => '?').join(', ');
  const updateStmt = env.DB.prepare(
    `UPDATE family_export_job SET ${setSql} WHERE id = ? AND status IN (${placeholders})`,
  ).bind(...setVals, jobId, ...froms);

  const statements = [updateStmt];
  if (audit) {
    statements.push(buildAuditInsertStatement(env, { jobId, now, ...audit }));
  }
  return statements;
}

// Convenience wrapper: runs transitionJobStatements via env.DB.batch and
// returns whether the conditional UPDATE actually matched a row (i.e.
// whether the transition genuinely applied). Callers that need to batch the
// transition alongside OTHER statements (e.g. the Workflow's own R2
// checkpoint bookkeeping) should call transitionJobStatements directly and
// batch it themselves instead.
export async function applyJobTransition(env, args) {
  const statements = transitionJobStatements(env, args);
  const results = await env.DB.batch(statements);
  const changes = results[0]?.meta?.changes ?? results[0]?.changes ?? 0;
  return { applied: changes > 0, results };
}

/*
 * The central serializer (§12) — the only place a job row becomes the JSON
 * shape a client ever sees. `forAdmin` adds family selection metadata/
 * request reason/audit-visible fields for the administrator surface;
 * family-facing responses always omit reason/actor, per §12's own rule.
 * `errorCode` is passed through only when it's one of the 11 stable public
 * codes — an unrecognized value (a bug, or a raw internal message that
 * slipped into the column) becomes `export_failed` rather than leaking
 * whatever string was actually stored.
 */
export function serializeExportJob(job, { forAdmin = false } = {}) {
  const toIso = (unixSeconds) => (unixSeconds == null ? null : new Date(unixSeconds * 1000).toISOString());
  const status = job.status;
  const errorCode = job.error_code && EXPORT_ERROR_CODES.includes(job.error_code) ? job.error_code : (job.error_code ? 'export_failed' : null);

  const base = {
    id: job.id,
    status,
    requestedAs: job.requested_as,
    createdAt: toIso(job.created_at),
    // "snapshotAt" is when the job actually started running (the
    // queued -> snapshotting transition sets started_at) — distinct from
    // createdAt (when it was merely queued). There's no separate DB column
    // for this; started_at IS the moment snapshotting began, since that's
    // always the very first real transition a job makes.
    snapshotAt: toIso(job.started_at),
    completedAt: toIso(job.completed_at),
    expiresAt: toIso(job.expires_at),
    progress: {
      processedFiles: job.processed_files ?? 0,
      expectedFiles: job.expected_files ?? null,
      processedBytes: job.processed_bytes ?? 0,
      expectedBytes: job.expected_bytes ?? null,
    },
    warningCount: job.warning_count ?? 0,
    errorCode,
    canCancel: RUNNING_STATUSES.includes(status) && status !== S.CANCELLING,
    canDownload: READY_STATUSES.includes(status),
    canRetry: status === S.FAILED,
  };

  if (!forAdmin) return base;
  return { ...base, requestReason: job.request_reason ?? null };
}

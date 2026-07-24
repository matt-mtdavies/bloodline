/*
 * Shared full-archive-export domain service
 * (docs/FULL-ARCHIVE-EXPORT-COMPLETION-PHASE.md §6). Every route file under
 * functions/api/exports* and functions/api/admin/exports* calls INTO this
 * module rather than touching D1/the RPC binding/serialization directly —
 * "route files must not reimplement authority or serialization" (§6). This
 * is the one place that rule can ever be violated, so it's the one place
 * worth reviewing closely for it.
 */
import { uid } from './util.js';
import {
  createExportJobStatements, transitionJobStatements, applyJobTransition,
  serializeExportJob, capSummary,
} from './exportJob.js';

const FAMILY_RATE_LIMIT = { count: 3, windowMs: 24 * 60 * 60 * 1000 };
const ADMIN_RATE_LIMIT = { count: 10, windowMs: 60 * 60 * 1000 };
const REASON_MIN = 10;
const REASON_MAX = 500;

export class ExportServiceError extends Error {
  constructor(code, status, message) {
    super(message || code);
    this.name = 'ExportServiceError';
    this.code = code;
    this.status = status;
  }
}

// ── feature readiness (§6, docs/FULL-ARCHIVE-EXPORT-TEST-FAMILY-GATE.md) ──

/*
 * Infrastructure readiness is a fundamentally different question from
 * whether any particular family is allowed to use it — the feature can be
 * entirely undeployed (no Workflow binding, no migration applied) no
 * matter what either rollout flag below says, and this check must not
 * depend on either one (docs/FULL-ARCHIVE-EXPORT-TEST-FAMILY-GATE.md's
 * own "Infrastructure readiness" section). `EXPORT_WORKFLOW_SERVICE` is
 * absent whenever the binding isn't configured (local dev, a preview
 * deploy, or before a human uncomments it in wrangler.toml per Gate 0) —
 * treated identically to a missing migration, never as a separate error
 * path a caller has to distinguish.
 */
export async function isExportInfrastructureReady(env) {
  if (!env.EXPORT_WORKFLOW_SERVICE) return false;
  if (!env.DB) return false;
  try {
    await env.DB.prepare('SELECT 1 FROM family_export_job LIMIT 1').first();
  } catch {
    return false; // migration not applied yet
  }
  return true;
}

export function requireExportInfrastructureReady(ready) {
  if (!ready) throw new ExportServiceError('export_not_configured', 503, 'Full archive export is not enabled on this deployment.');
}

/*
 * docs/FULL-ARCHIVE-EXPORT-TEST-FAMILY-GATE.md — a deny-by-default
 * disposable-family allowlist letting exactly one synthetic family
 * exercise the complete export surface (create/list/status/cancel/
 * download, both owner and site-admin) while `ENABLE_FULL_EXPORT` stays
 * `"false"` for every other family. Comma-separated EXACT family IDs,
 * trimmed, empty entries discarded, compared CASE-SENSITIVELY — family
 * IDs are opaque server-generated identifiers, never user-typed text, so
 * unlike `exportAdminEmailList` there is deliberately no case-folding,
 * prefix, wildcard, or name/email fallback here. Never exposed to the
 * client — nothing in this file ever serializes this list or its
 * membership decision, only the same existing `export_not_configured`
 * response every other "not ready" path already returns.
 */
export function fullExportTestFamilyIds(env) {
  return (env.FULL_EXPORT_TEST_FAMILY_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// Whether `familyId` is currently allowed to use full export, GIVEN that
// infrastructure is already known to be ready — split out from
// isFamilyExportEnabled below purely so list/search endpoints can filter
// many rows without re-running the infra check (a DB round trip) once per
// row; every other caller should use isFamilyExportEnabled instead of this
// directly.
function familyIdIsReleasedOrTestAllowlisted(env, familyId) {
  if (env.ENABLE_FULL_EXPORT === 'true') return true;
  return fullExportTestFamilyIds(env).includes(familyId);
}

/*
 * The per-family enablement decision every operation below gates on:
 * infrastructure must be ready AND (general release is on OR this EXACT
 * family id is on the disposable-family test allowlist). Every caller
 * establishes its own authoritative familyId BEFORE calling this — the
 * caller's server-resolved canonical membership for owner/co-admin
 * operations, or a job/family row freshly re-read from D1 for site-admin
 * operations — never a caller-supplied family name, cached client state,
 * or an unread job id (docs/FULL-ARCHIVE-EXPORT-TEST-FAMILY-GATE.md's own
 * "Server authorization model").
 *
 * `infraReady` (optional) lets a caller that already computed
 * isExportInfrastructureReady(env) a moment ago (every operation below
 * does, via requireExportInfrastructureReady, before resolving its
 * familyId) pass that result straight through instead of this function
 * re-running the same `SELECT 1 FROM family_export_job` D1 round trip a
 * second time in the same request. Omit it (as any standalone caller,
 * e.g. this file's own tests, safely can) and it's computed fresh here —
 * this function is still correct and self-sufficient on its own either way.
 */
export async function isFamilyExportEnabled(env, familyId, { infraReady } = {}) {
  const ready = infraReady !== undefined ? infraReady : await isExportInfrastructureReady(env);
  if (!ready) return false;
  return familyIdIsReleasedOrTestAllowlisted(env, familyId);
}

export function requireFamilyExportEnabled(enabled) {
  if (!enabled) throw new ExportServiceError('export_not_configured', 503, 'Full archive export is not enabled on this deployment.');
}

// ── EXPORT_ADMIN_EMAILS — deliberately separate from ADMIN_EMAILS ───────

export function exportAdminEmailList(env) {
  return (env.EXPORT_ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}
export function isExportAdminEmail(env, email) {
  if (!email) return false;
  return exportAdminEmailList(env).includes(email.toLowerCase());
}

// ── canonical family resolution (mirrors functions/api/tree.js) ─────────

export async function resolveCanonicalFamily(env, userId) {
  const userRow = await env.DB.prepare('SELECT family_id FROM user WHERE id = ?').bind(userId).first();
  const membership = userRow?.family_id
    ? await env.DB.prepare(
        `SELECT fm.family_id, fm.role, f.name AS family_name
           FROM family_member fm JOIN family f ON f.id = fm.family_id
          WHERE fm.user_id = ? AND fm.family_id = ?`,
      ).bind(userId, userRow.family_id).first()
    : await env.DB.prepare(
        `SELECT fm.family_id, fm.role, f.name AS family_name
           FROM family_member fm JOIN family f ON f.id = fm.family_id
          WHERE fm.user_id = ?`,
      ).bind(userId).first();
  return membership || null;
}

// ── rate limiting (same plain COUNT(*) pattern as functions/api/auth/request.js) ─

async function countRecentJobs(env, { familyId, requestedByUserId }, windowMs) {
  const since = Math.floor((Date.now() - windowMs) / 1000);
  if (familyId) {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM family_export_job WHERE family_id = ? AND created_at > ?`,
    ).bind(familyId, since).first();
    return row?.cnt || 0;
  }
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS cnt FROM family_export_job WHERE requested_by_user_id = ? AND requested_as = 'site_admin' AND created_at > ?`,
  ).bind(requestedByUserId, since).first();
  return row?.cnt || 0;
}

// ── RPC (env.EXPORT_WORKFLOW_SERVICE) ────────────────────────────────────

async function startWorkflow(env, jobId, familyId) {
  try {
    await env.EXPORT_WORKFLOW_SERVICE.createExport(jobId);
  } catch (e) {
    await applyJobTransition(env, {
      jobId, fromStatuses: ['queued'], toStatus: 'failed',
      fields: { error_code: 'export_failed', error_summary: capSummary(`workflow_start_failed: ${e.message}`) },
      audit: { familyId, event: 'failed', actorAuthority: 'system' },
    });
    throw new ExportServiceError('export_failed', 502, 'Could not start the export workflow.');
  }
}

// ── Create (owner/coadmin) ───────────────────────────────────────────────

export async function createFamilyExport(env, { userId, userEmail }) {
  const infraReady = await isExportInfrastructureReady(env);
  requireExportInfrastructureReady(infraReady);
  const membership = await resolveCanonicalFamily(env, userId);
  requireFamilyExportEnabled(await isFamilyExportEnabled(env, membership?.family_id, { infraReady }));
  if (!membership || !['owner', 'coadmin'].includes(membership.role)) {
    throw new ExportServiceError('forbidden', 403, 'Only the family owner or a co-admin can prepare a complete archive.');
  }
  const recent = await countRecentJobs(env, { familyId: membership.family_id }, FAMILY_RATE_LIMIT.windowMs);
  if (recent >= FAMILY_RATE_LIMIT.count) {
    throw new ExportServiceError('export_rate_limited', 429, 'Too many archive requests for this family in the last 24 hours.');
  }

  const { jobId, statements } = createExportJobStatements(env, {
    familyId: membership.family_id, requestedByUserId: userId, requestedAs: membership.role, requestedByUserEmail: userEmail,
  });
  try {
    await env.DB.batch(statements);
  } catch (e) {
    if (isUniqueViolation(e)) throw new ExportServiceError('export_already_active', 409, 'An archive is already being prepared for this family.');
    throw e;
  }
  await startWorkflow(env, jobId, membership.family_id);
  return { jobId, familyId: membership.family_id };
}

function isUniqueViolation(e) {
  return /UNIQUE constraint failed/i.test(e?.message || '');
}

// ── Create (site admin) ──────────────────────────────────────────────────

export async function createAdminExport(env, { actorUserId, actorEmail, familyId, reason, confirmFamilyName }) {
  const infraReady = await isExportInfrastructureReady(env);
  requireExportInfrastructureReady(infraReady);
  if (!isExportAdminEmail(env, actorEmail)) {
    throw new ExportServiceError('forbidden', 403, 'Not authorized for administrator exports.');
  }
  if (typeof reason !== 'string' || reason.trim().length < REASON_MIN || reason.length > REASON_MAX) {
    throw new ExportServiceError('bad_request', 400, `Reason must be between ${REASON_MIN} and ${REASON_MAX} characters.`);
  }
  if (!familyId || typeof familyId !== 'string') {
    throw new ExportServiceError('bad_request', 400, 'familyId is required.');
  }

  // Requery the family immediately before creation — never trust search-
  // result metadata the browser sends back (§6).
  const family = await env.DB.prepare('SELECT id, name FROM family WHERE id = ?').bind(familyId).first();
  if (!family) throw new ExportServiceError('bad_request', 400, 'Unknown family.');
  const normalize = (s) => String(s || '').trim().toLowerCase();
  if (normalize(confirmFamilyName) !== normalize(family.name)) {
    throw new ExportServiceError('bad_request', 400, 'Typed family name does not match.');
  }

  // Gated on the REQUERIED family.id (just confirmed to exist and match the
  // typed name above), never the raw `familyId` argument — while general
  // release is off, even an EXPORT_ADMIN_EMAILS-authorized admin can only
  // create an admin export for a family on the disposable-family test
  // allowlist (docs/FULL-ARCHIVE-EXPORT-TEST-FAMILY-GATE.md).
  requireFamilyExportEnabled(await isFamilyExportEnabled(env, family.id, { infraReady }));

  const recent = await countRecentJobs(env, { requestedByUserId: actorUserId }, ADMIN_RATE_LIMIT.windowMs);
  if (recent >= ADMIN_RATE_LIMIT.count) {
    throw new ExportServiceError('export_rate_limited', 429, 'Too many administrator export requests in the last hour.');
  }

  const { jobId, statements } = createExportJobStatements(env, {
    familyId: family.id, requestedByUserId: actorUserId, requestedAs: 'site_admin', requestReason: reason.trim(), requestedByUserEmail: actorEmail,
  });
  try {
    await env.DB.batch(statements);
  } catch (e) {
    if (isUniqueViolation(e)) throw new ExportServiceError('export_already_active', 409, 'An archive is already being prepared for this family.');
    throw e;
  }
  await startWorkflow(env, jobId, familyId);
  return { jobId, familyId };
}

// ── List / get ────────────────────────────────────────────────────────────

const LIST_LIMIT = 20;

// §6's authority table requires current owner/coadmin on create, list,
// status, cancel AND download — not merely family membership. An earlier
// version of list/get only checked membership existed at all, which let
// an editor/contributor/viewer enumerate export history and poll status
// for jobs they have no authority over (a PR #9 review finding).
function requireOwnerOrCoadmin(membership) {
  if (!membership || !['owner', 'coadmin'].includes(membership.role)) {
    throw new ExportServiceError('forbidden', 403, 'Only the family owner or a co-admin can view export history.');
  }
}

export async function listFamilyExports(env, { userId }) {
  const infraReady = await isExportInfrastructureReady(env);
  requireExportInfrastructureReady(infraReady);
  const membership = await resolveCanonicalFamily(env, userId);
  requireFamilyExportEnabled(await isFamilyExportEnabled(env, membership?.family_id, { infraReady }));
  requireOwnerOrCoadmin(membership);
  const { results } = await env.DB.prepare(
    `SELECT * FROM family_export_job WHERE family_id = ? ORDER BY created_at DESC LIMIT ?`,
  ).bind(membership.family_id, LIST_LIMIT).all();
  return (results || []).map((j) => serializeExportJob(j));
}

export async function getFamilyExport(env, { userId, jobId }) {
  const infraReady = await isExportInfrastructureReady(env);
  requireExportInfrastructureReady(infraReady);
  const membership = await resolveCanonicalFamily(env, userId);
  requireOwnerOrCoadmin(membership);
  const job = await env.DB.prepare('SELECT * FROM family_export_job WHERE id = ? AND family_id = ?').bind(jobId, membership.family_id).first();
  if (!job) throw new ExportServiceError('not_found', 404, 'Export not found.');
  requireFamilyExportEnabled(await isFamilyExportEnabled(env, job.family_id, { infraReady }));
  return serializeExportJob(job);
}

// site-admin list/search deliberately FILTER rather than hard-gate (§6's
// "site-admin list/search: return only enabled families/jobs while general
// enablement is false" — an admin can still see the shape of their own
// admin-authored job history, just never a family export isn't currently
// allowed to use).
export async function listAdminExports(env, { actorEmail, familyId }) {
  requireExportInfrastructureReady(await isExportInfrastructureReady(env));
  if (!isExportAdminEmail(env, actorEmail)) throw new ExportServiceError('forbidden', 403, 'Not authorized for administrator exports.');
  const { results } = familyId
    ? await env.DB.prepare(`SELECT * FROM family_export_job WHERE family_id = ? ORDER BY created_at DESC LIMIT ?`).bind(familyId, LIST_LIMIT).all()
    : await env.DB.prepare(`SELECT * FROM family_export_job WHERE requested_as = 'site_admin' ORDER BY created_at DESC LIMIT ?`).bind(LIST_LIMIT).all();
  const visible = (results || []).filter((j) => familyIdIsReleasedOrTestAllowlisted(env, j.family_id));
  return visible.map((j) => serializeExportJob(j, { forAdmin: true }));
}

export async function getAdminExport(env, { actorEmail, jobId }) {
  const infraReady = await isExportInfrastructureReady(env);
  requireExportInfrastructureReady(infraReady);
  if (!isExportAdminEmail(env, actorEmail)) throw new ExportServiceError('forbidden', 403, 'Not authorized for administrator exports.');
  const job = await env.DB.prepare('SELECT * FROM family_export_job WHERE id = ?').bind(jobId).first();
  if (!job) throw new ExportServiceError('not_found', 404, 'Export not found.');
  requireFamilyExportEnabled(await isFamilyExportEnabled(env, job.family_id, { infraReady }));
  return serializeExportJob(job, { forAdmin: true });
}

// §11's "show immutable audit history" — the append-only trail for one
// job. Never includes people/filenames/R2 keys (family_export_audit's own
// schema can't carry them — see migrations/0014_export_jobs.sql).
export async function getAdminExportAudit(env, { actorEmail, jobId }) {
  const infraReady = await isExportInfrastructureReady(env);
  requireExportInfrastructureReady(infraReady);
  if (!isExportAdminEmail(env, actorEmail)) throw new ExportServiceError('forbidden', 403, 'Not authorized for administrator exports.');
  const job = await env.DB.prepare('SELECT id, family_id FROM family_export_job WHERE id = ?').bind(jobId).first();
  if (!job) throw new ExportServiceError('not_found', 404, 'Export not found.');
  requireFamilyExportEnabled(await isFamilyExportEnabled(env, job.family_id, { infraReady }));
  const { results } = await env.DB.prepare(
    `SELECT event, actor_email_snapshot, actor_authority, reason, created_at
       FROM family_export_audit WHERE job_id = ? ORDER BY created_at ASC`,
  ).bind(jobId).all();
  return (results || []).map((r) => ({
    event: r.event, actorEmail: r.actor_email_snapshot, actorAuthority: r.actor_authority,
    reason: r.reason, at: new Date(r.created_at * 1000).toISOString(),
  }));
}

// ── Family search for the admin picker (§6 — selection metadata only) ───

// Filters (not hard-gates) matched families exactly like listAdminExports —
// the picker itself should never surface a family the admin can't
// currently target with createAdminExport anyway.
export async function searchExportFamilies(env, { actorEmail, query }) {
  requireExportInfrastructureReady(await isExportInfrastructureReady(env));
  if (!isExportAdminEmail(env, actorEmail)) throw new ExportServiceError('forbidden', 403, 'Not authorized for administrator exports.');
  const q = String(query || '').trim();
  if (!q) return [];
  const { results } = await env.DB.prepare(
    `SELECT f.id, f.name,
            (SELECT COUNT(*) FROM family_member fm WHERE fm.family_id = f.id) AS memberCount,
            (SELECT u.email FROM family_member fm JOIN user u ON u.id = fm.user_id WHERE fm.family_id = f.id AND fm.role = 'owner' LIMIT 1) AS ownerEmail,
            (SELECT status FROM family_export_job j WHERE j.family_id = f.id ORDER BY j.created_at DESC LIMIT 1) AS lastExportStatus,
            -- A cheap presence check, not a full read: _extraVersion is the
            -- one plumbing field treeStore.js stamps onto a migrated
            -- family's core JSON (docs/TREE-STORAGE.md §6.3) — this LIKE
            -- avoids pulling the whole tree_json blob (which, per this
            -- account's own documented scale, "1000+ people, heavy
            -- documents", can approach D1's 1 MiB row ceiling) just to
            -- answer one boolean question for up to 20 matched families.
            (SELECT CASE WHEN tree_json LIKE '%"_extraVersion"%' THEN 1 ELSE 0 END FROM family_tree ft WHERE ft.family_id = f.id) AS isSplit
       FROM family f
      WHERE f.id = ? OR f.name LIKE ? ESCAPE '\\'
      ORDER BY f.name ASC LIMIT 20`,
  ).bind(q, `%${likeEscape(q)}%`).all();
  const visible = (results || []).filter((r) => familyIdIsReleasedOrTestAllowlisted(env, r.id));
  return visible.map((r) => ({
    id: r.id, name: r.name, memberCount: r.memberCount, ownerEmail: r.ownerEmail || null,
    lastExportStatus: r.lastExportStatus || null, storageMode: r.isSplit == null ? null : (r.isSplit ? 'split' : 'legacy'),
  }));
}
function likeEscape(s) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ── Cancel ────────────────────────────────────────────────────────────────

const RUNNING = ['queued', 'snapshotting', 'inventory', 'packaging', 'verifying'];

// Always returns the RAW job row (never pre-serialized) — callers are the
// only place that calls serializeExportJob, exactly once, with the right
// `forAdmin` flag. An earlier version of this function serialized in its
// own idempotent branch AND left the caller to serialize again on top of
// that already-serialized (camelCase) object — silently corrupting the
// idempotent-repeat response (createdAt/requestedAs would come out
// null/missing, since a serialized object has no snake_case columns for
// serializeExportJob to read a second time). Fixed by never serializing
// here at all.
async function cancelJob(env, job, actorAuthority, { actorUserId = null, actorEmail = null } = {}) {
  if (!RUNNING.includes(job.status)) {
    // Idempotent — cancelling an already-cancelling/terminal job is a no-op
    // success, not an error (§6: "repeated request is idempotent").
    return job;
  }
  const { applied } = await applyJobTransition(env, {
    jobId: job.id, fromStatuses: RUNNING, toStatus: 'cancelling',
    audit: { familyId: job.family_id, event: 'cancel_requested', actorAuthority, actorUserId, actorEmailSnapshot: actorEmail },
  });
  const fresh = applied
    ? { ...job, status: 'cancelling' }
    : await env.DB.prepare('SELECT * FROM family_export_job WHERE id = ?').bind(job.id).first();
  try { await env.EXPORT_WORKFLOW_SERVICE.requestCancellation(job.id); } catch { /* best-effort */ }
  return fresh;
}

export async function cancelFamilyExport(env, { userId, userEmail, jobId }) {
  const infraReady = await isExportInfrastructureReady(env);
  requireExportInfrastructureReady(infraReady);
  const membership = await resolveCanonicalFamily(env, userId);
  if (!membership || !['owner', 'coadmin'].includes(membership.role)) {
    throw new ExportServiceError('forbidden', 403, 'Only the family owner or a co-admin can cancel an archive.');
  }
  const job = await env.DB.prepare('SELECT * FROM family_export_job WHERE id = ? AND family_id = ?').bind(jobId, membership.family_id).first();
  if (!job) throw new ExportServiceError('not_found', 404, 'Export not found.');
  requireFamilyExportEnabled(await isFamilyExportEnabled(env, job.family_id, { infraReady }));
  const cancelled = await cancelJob(env, job, membership.role, { actorUserId: userId, actorEmail: userEmail });
  return serializeExportJob(cancelled);
}

export async function cancelAdminExport(env, { actorUserId, actorEmail, jobId }) {
  const infraReady = await isExportInfrastructureReady(env);
  requireExportInfrastructureReady(infraReady);
  if (!isExportAdminEmail(env, actorEmail)) throw new ExportServiceError('forbidden', 403, 'Not authorized for administrator exports.');
  const job = await env.DB.prepare('SELECT * FROM family_export_job WHERE id = ?').bind(jobId).first();
  if (!job) throw new ExportServiceError('not_found', 404, 'Export not found.');
  requireFamilyExportEnabled(await isFamilyExportEnabled(env, job.family_id, { infraReady }));
  const cancelled = await cancelJob(env, job, 'site_admin', { actorUserId, actorEmail });
  return serializeExportJob(cancelled, { forAdmin: true });
}

// ── Download ──────────────────────────────────────────────────────────────

const READY = ['ready', 'ready_with_warnings'];

async function loadDownloadableJob(env, job) {
  if (!READY.includes(job.status)) throw new ExportServiceError('archive_unavailable', 409, 'This archive is not ready to download.');
  if (job.expires_at != null && job.expires_at < Math.floor(Date.now() / 1000)) {
    throw new ExportServiceError('archive_unavailable', 410, 'This archive has expired.');
  }
  const object = await env.DOCS.get(job.archive_r2_key);
  if (!object) throw new ExportServiceError('archive_unavailable', 404, 'The archive file could not be found.');
  return object;
}

export async function downloadFamilyExport(env, { userId, jobId }) {
  const infraReady = await isExportInfrastructureReady(env);
  requireExportInfrastructureReady(infraReady);
  const membership = await resolveCanonicalFamily(env, userId);
  if (!membership || !['owner', 'coadmin'].includes(membership.role)) {
    throw new ExportServiceError('forbidden', 403, 'Only the family owner or a co-admin can download this archive.');
  }
  const job = await env.DB.prepare('SELECT * FROM family_export_job WHERE id = ? AND family_id = ?').bind(jobId, membership.family_id).first();
  if (!job) throw new ExportServiceError('not_found', 404, 'Export not found.');
  requireFamilyExportEnabled(await isFamilyExportEnabled(env, job.family_id, { infraReady }));
  const object = await loadDownloadableJob(env, job);
  await recordDownloadAudit(env, job, membership.role, userId);
  return object;
}

export async function downloadAdminExport(env, { actorUserId, actorEmail, jobId }) {
  const infraReady = await isExportInfrastructureReady(env);
  requireExportInfrastructureReady(infraReady);
  if (!isExportAdminEmail(env, actorEmail)) throw new ExportServiceError('forbidden', 403, 'Not authorized for administrator exports.');
  const job = await env.DB.prepare('SELECT * FROM family_export_job WHERE id = ?').bind(jobId).first();
  if (!job) throw new ExportServiceError('not_found', 404, 'Export not found.');
  requireFamilyExportEnabled(await isFamilyExportEnabled(env, job.family_id, { infraReady }));
  const object = await loadDownloadableJob(env, job);
  await recordDownloadAudit(env, job, 'site_admin', actorUserId);
  return object;
}

// ── shared HTTP error mapping (thin — genuinely just status/code glue, not
// authority or serialization logic, so route files sharing this isn't a
// violation of §6's "route files must not reimplement authority or
// serialization") ──────────────────────────────────────────────────────

export function exportErrorResponse(json, e) {
  if (e instanceof ExportServiceError) return json({ error: e.code, message: e.message }, { status: e.status });
  console.error('[exportService] unexpected error:', e.message, e.stack);
  return json({ error: 'export_failed' }, { status: 500 });
}

async function recordDownloadAudit(env, job, actorAuthority, actorUserId) {
  await env.DB.prepare(
    `INSERT INTO family_export_audit (id, job_id, family_id, actor_user_id, actor_authority, event, created_at)
     VALUES (?, ?, ?, ?, ?, 'downloaded', ?)`,
  ).bind(uid('expa_'), job.id, job.family_id, actorUserId, actorAuthority, Math.floor(Date.now() / 1000)).run();
}

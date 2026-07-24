/**
 * Unit tests for functions/_lib/exportJob.js — the shared job state-
 * transition/serializer module (docs/FULL-ARCHIVE-EXPORT-COMPLETION-PHASE.md
 * §4, §12). The real-SQLite schema/constraint tests (CHECK constraints, the
 * partial unique index, actual conditional-update behavior) live in
 * workers/export-workflow/tests/exportJobSchema.test.mjs, which needs Node
 * 22.5+'s node:sqlite — this file covers the pure logic that doesn't need a
 * real database at all, so it can run under this repo's Node 20 baseline.
 * Run with: node tests/exportJob.test.mjs
 */
import assert from 'node:assert/strict';
import {
  canTransition, capSummary, serializeExportJob, createExportJobStatements,
  transitionJobStatements, RUNNING_STATUSES, READY_STATUSES, TERMINAL_STATUSES,
  EXPORT_ERROR_CODES, EXPORT_JOB_STATUSES,
} from '../functions/_lib/exportJob.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

function fakeEnv() {
  const calls = [];
  function stmt(sql) {
    let args = [];
    const s = {
      bind(...a) { args = a; return s; },
      __sql: sql,
      __args: () => args,
    };
    return s;
  }
  return { DB: { prepare: (sql) => stmt(sql) }, calls };
}

// ── capSummary ───────────────────────────────────────────────────────────

test('capSummary passes short text through unchanged', () => {
  assert.equal(capSummary('a short reason'), 'a short reason');
});

test('capSummary returns null for null/empty input', () => {
  assert.equal(capSummary(null), null);
  assert.equal(capSummary(''), null);
});

test('capSummary truncates to exactly 500 characters, ellipsis included', () => {
  const long = 'x'.repeat(600);
  const capped = capSummary(long);
  assert.equal(capped.length, 500);
  assert.ok(capped.endsWith('…'));
});

// ── the state graph ──────────────────────────────────────────────────────

test('every RUNNING_STATUSES entry can reach cancelling except cancelling itself, which reaches only cancelled', () => {
  for (const s of RUNNING_STATUSES) {
    if (s === EXPORT_JOB_STATUSES.CANCELLING) {
      assert.equal(canTransition(s, 'cancelled'), true);
      assert.equal(canTransition(s, 'cancelling'), false);
    } else {
      assert.equal(canTransition(s, 'cancelling'), true, `${s} -> cancelling must be legal`);
    }
  }
});

test('every RUNNING_STATUSES entry except cancelling can also fail', () => {
  for (const s of RUNNING_STATUSES) {
    if (s === EXPORT_JOB_STATUSES.CANCELLING) continue;
    assert.equal(canTransition(s, 'failed'), true, `${s} -> failed must be legal`);
  }
});

test('ready states can only ever reach expired', () => {
  for (const s of READY_STATUSES) {
    assert.equal(canTransition(s, 'expired'), true);
    assert.equal(canTransition(s, 'failed'), false);
    assert.equal(canTransition(s, 'cancelling'), false);
  }
});

test('terminal states have no outgoing transitions at all', () => {
  for (const s of TERMINAL_STATUSES) {
    for (const to of Object.values(EXPORT_JOB_STATUSES)) assert.equal(canTransition(s, to), false, `${s} -> ${to} must be illegal`);
  }
});

// ── createExportJobStatements / transitionJobStatements: statement shape ───

test('createExportJobStatements rejects an invalid requestedAs before building anything', () => {
  assert.throws(() => createExportJobStatements(fakeEnv(), { familyId: 'f', requestedByUserId: 'u', requestedAs: 'root' }));
});

test('createExportJobStatements returns exactly one job insert and one audit insert', () => {
  const { jobId, statements } = createExportJobStatements(fakeEnv(), { familyId: 'fam_1', requestedByUserId: 'user_1', requestedAs: 'owner' });
  assert.equal(statements.length, 2);
  assert.match(statements[0].__sql, /INSERT INTO family_export_job/);
  assert.match(statements[1].__sql, /INSERT INTO family_export_audit/);
  assert.ok(jobId.startsWith('exp_'));
});

test('transitionJobStatements omits the audit statement when none is given', () => {
  const statements = transitionJobStatements(fakeEnv(), { jobId: 'exp_1', fromStatuses: ['queued'], toStatus: 'snapshotting' });
  assert.equal(statements.length, 1);
});

test('transitionJobStatements throws on a transition that is not legal from ANY given prior status', () => {
  assert.throws(() => transitionJobStatements(fakeEnv(), { jobId: 'exp_1', fromStatuses: ['ready', 'ready_with_warnings'], toStatus: 'packaging' }));
});

test('transitionJobStatements succeeds when EVERY given prior status can legally reach the destination', () => {
  // cancel is offered from any running state EXCEPT cancelling itself
  // (already cancelling can't be re-cancelled) — the caller passes every
  // OTHER running status as candidates without knowing which one the job
  // is actually in.
  const cancellableFrom = RUNNING_STATUSES.filter((s) => s !== 'cancelling');
  assert.doesNotThrow(() => transitionJobStatements(fakeEnv(), { jobId: 'exp_1', fromStatuses: cancellableFrom, toStatus: 'cancelling' }));
});

test('transitionJobStatements throws on a MIXED fromStatuses list where even one entry cannot legally reach the destination — the exact PR #9 re-review finding', () => {
  // Before this fix, a mixed list like this passed validation via `.some()`
  // (queued/snapshotting/etc really can fail) even though 'cancelling'
  // cannot — and the raw SQL `WHERE status IN (...)` this produces would
  // still match a row whose real status IS 'cancelling', illegally
  // flipping it straight to 'failed' (the state graph only allows
  // cancelling -> cancelled). reconcileStaleJobs had exactly this bug.
  assert.throws(
    () => transitionJobStatements(fakeEnv(), {
      jobId: 'exp_1',
      fromStatuses: ['queued', 'snapshotting', 'inventory', 'packaging', 'verifying', 'cancelling'],
      toStatus: 'failed',
    }),
    /illegal transition/,
  );
});

// ── serializeExportJob ────────────────────────────────────────────────────

function baseRow(overrides = {}) {
  return {
    id: 'exp_1', status: 'packaging', requested_as: 'owner', request_reason: 'a reason',
    created_at: 1700000000, started_at: 1700000100, completed_at: null, expires_at: null,
    processed_files: 10, expected_files: 100, processed_bytes: 1000, expected_bytes: 100000,
    warning_count: 0, error_code: null,
    ...overrides,
  };
}

test('family view omits requestReason entirely; admin view includes it', () => {
  const row = baseRow();
  const familyView = serializeExportJob(row);
  assert.equal('requestReason' in familyView, false);
  const adminView = serializeExportJob(row, { forAdmin: true });
  assert.equal(adminView.requestReason, 'a reason');
});

test('timestamps serialize to ISO strings, and null timestamps stay null', () => {
  const view = serializeExportJob(baseRow());
  assert.equal(view.createdAt, new Date(1700000000 * 1000).toISOString());
  assert.equal(view.snapshotAt, new Date(1700000100 * 1000).toISOString());
  assert.equal(view.completedAt, null);
});

test('canCancel/canDownload/canRetry match the status exactly, for every status value', () => {
  const cases = {
    queued: { canCancel: true, canDownload: false, canRetry: false },
    snapshotting: { canCancel: true, canDownload: false, canRetry: false },
    inventory: { canCancel: true, canDownload: false, canRetry: false },
    packaging: { canCancel: true, canDownload: false, canRetry: false },
    verifying: { canCancel: true, canDownload: false, canRetry: false },
    cancelling: { canCancel: false, canDownload: false, canRetry: false },
    ready: { canCancel: false, canDownload: true, canRetry: false },
    ready_with_warnings: { canCancel: false, canDownload: true, canRetry: false },
    failed: { canCancel: false, canDownload: false, canRetry: true },
    cancelled: { canCancel: false, canDownload: false, canRetry: false },
    expired: { canCancel: false, canDownload: false, canRetry: false },
  };
  for (const [status, expected] of Object.entries(cases)) {
    const view = serializeExportJob(baseRow({ status }));
    assert.equal(view.canCancel, expected.canCancel, `${status}.canCancel`);
    assert.equal(view.canDownload, expected.canDownload, `${status}.canDownload`);
    assert.equal(view.canRetry, expected.canRetry, `${status}.canRetry`);
  }
});

test('an unrecognized stored error_code degrades to export_failed rather than leaking internal text', () => {
  const view = serializeExportJob(baseRow({ status: 'failed', error_code: 'r2_5xx_during_multipart_complete' }));
  assert.equal(view.errorCode, 'export_failed');
});

test('a recognized public error_code passes through unchanged', () => {
  for (const code of EXPORT_ERROR_CODES) {
    const view = serializeExportJob(baseRow({ status: 'failed', error_code: code }));
    assert.equal(view.errorCode, code);
  }
});

test('a null error_code stays null (not "export_failed")', () => {
  const view = serializeExportJob(baseRow({ status: 'packaging', error_code: null }));
  assert.equal(view.errorCode, null);
});

test('progress falls back to 0/null sensibly when a row has not started counting yet', () => {
  const view = serializeExportJob(baseRow({ processed_files: null, expected_files: null, processed_bytes: null, expected_bytes: null }));
  assert.deepEqual(view.progress, { processedFiles: 0, expectedFiles: null, processedBytes: 0, expectedBytes: null });
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

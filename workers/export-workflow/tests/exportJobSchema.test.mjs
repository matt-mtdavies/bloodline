import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  createExportJobStatements, transitionJobStatements, applyJobTransition,
  serializeExportJob, canTransition, RUNNING_STATUSES,
  // Imported across the deploy boundary via a relative path, exactly as the
  // production Workflow Worker will (see exportJob.js's own header comment)
  // — this import succeeding at all is itself part of what this file proves.
} from '../../../functions/_lib/exportJob.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

// Real SQLite (node:sqlite), schema loaded from the ACTUAL migration file —
// these tests run the real generated SQL against the real CHECK constraints
// and the real partial unique index, not a hand-rolled mirror of them, so a
// genuine bug in the migration itself would surface here.
const MIGRATION_SQL = readFileSync(new URL('../../../migrations/0014_export_jobs.sql', import.meta.url), 'utf8');

function makeDb() {
  const db = new DatabaseSync(':memory:');
  // Minimal stub parents for the REFERENCES clauses — this file is only
  // proving family_export_job/family_export_audit's own constraints, not
  // re-testing the rest of the schema.
  db.exec(`
    CREATE TABLE family (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT);
  `);
  db.exec(MIGRATION_SQL);
  db.exec(`INSERT INTO family (id, name) VALUES ('fam_1', 'Test Family'), ('fam_2', 'Other Family')`);
  db.exec(`INSERT INTO user (id, email) VALUES ('user_1', 'a@test.example'), ('user_2', 'b@test.example')`);
  return db;
}

// A minimal D1-shaped adapter over node:sqlite — .prepare().bind().run()/
// .all()/.first(), plus .batch() running statements in one transaction and
// rolling back on any failure (constraint violations included), matching
// D1's own documented batch semantics.
function makeD1(db) {
  function stmt(sql) {
    let args = [];
    const s = {
      bind(...a) { args = a; return s; },
      async run() {
        const info = db.prepare(sql).run(...args);
        return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
      },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async first() { return db.prepare(sql).all(...args)[0] ?? null; },
      __sql: sql,
      __args: () => args,
    };
    return s;
  }
  return {
    prepare: (sql) => stmt(sql),
    async batch(stmts) {
      db.exec('BEGIN');
      try {
        const results = [];
        for (const s of stmts) {
          const info = db.prepare(s.__sql).run(...s.__args());
          results.push({ success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } });
        }
        db.exec('COMMIT');
        return results;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

function readJob(db, id) {
  return db.prepare('SELECT * FROM family_export_job WHERE id = ?').get(id);
}

// ── CHECK constraints ────────────────────────────────────────────────────

test('requested_as rejects a value outside owner|coadmin|site_admin', () => {
  const db = makeDb();
  assert.throws(() => {
    db.prepare(
      `INSERT INTO family_export_job (id, family_id, requested_by_user_id, requested_as, status, created_at)
       VALUES ('exp_x', 'fam_1', 'user_1', 'superadmin', 'queued', 1000)`,
    ).run();
  }, /CHECK constraint failed/);
});

test('family_export_audit.event rejects a value outside the fixed event list', () => {
  const db = makeDb();
  db.exec(`INSERT INTO family_export_job (id, family_id, requested_by_user_id, requested_as, status, created_at)
            VALUES ('exp_x', 'fam_1', 'user_1', 'owner', 'queued', 1000)`);
  assert.throws(() => {
    db.prepare(
      `INSERT INTO family_export_audit (id, job_id, family_id, actor_authority, event, created_at)
       VALUES ('a1', 'exp_x', 'fam_1', 'owner', 'bogus_event', 1000)`,
    ).run();
  }, /CHECK constraint failed/);
});

test('family_export_audit.actor_authority accepts NULL (system-triggered events)', () => {
  const db = makeDb();
  db.exec(`INSERT INTO family_export_job (id, family_id, requested_by_user_id, requested_as, status, created_at)
            VALUES ('exp_x', 'fam_1', 'user_1', 'owner', 'queued', 1000)`);
  assert.doesNotThrow(() => {
    db.prepare(
      `INSERT INTO family_export_audit (id, job_id, family_id, actor_authority, event, created_at)
       VALUES ('a1', 'exp_x', 'fam_1', NULL, 'expired', 1000)`,
    ).run();
  });
});

// ── the partial unique index (the exact PR #8 review finding) ──────────────

test('a second job cannot be created for a family already queued/snapshotting/.../verifying', () => {
  const db = makeDb();
  db.exec(`INSERT INTO family_export_job (id, family_id, requested_by_user_id, requested_as, status, created_at)
            VALUES ('exp_1', 'fam_1', 'user_1', 'owner', 'inventory', 1000)`);
  assert.throws(() => {
    db.prepare(
      `INSERT INTO family_export_job (id, family_id, requested_by_user_id, requested_as, status, created_at)
       VALUES ('exp_2', 'fam_1', 'user_2', 'coadmin', 'queued', 1001)`,
    ).run();
  }, /UNIQUE constraint failed/);
});

test('a second job STILL cannot be created while the first is "cancelling" — the exact race the PR #8 review flagged', () => {
  const db = makeDb();
  db.exec(`INSERT INTO family_export_job (id, family_id, requested_by_user_id, requested_as, status, created_at)
            VALUES ('exp_1', 'fam_1', 'user_1', 'owner', 'cancelling', 1000)`);
  assert.throws(() => {
    db.prepare(
      `INSERT INTO family_export_job (id, family_id, requested_by_user_id, requested_as, status, created_at)
       VALUES ('exp_2', 'fam_1', 'user_2', 'coadmin', 'queued', 1001)`,
    ).run();
  }, /UNIQUE constraint failed/, 'cancelling must still block a new job — cleanup may still be in flight');
});

test('a new job CAN be created once the prior one reaches a terminal state', () => {
  const db = makeDb();
  db.exec(`INSERT INTO family_export_job (id, family_id, requested_by_user_id, requested_as, status, created_at)
            VALUES ('exp_1', 'fam_1', 'user_1', 'owner', 'cancelled', 1000)`);
  assert.doesNotThrow(() => {
    db.prepare(
      `INSERT INTO family_export_job (id, family_id, requested_by_user_id, requested_as, status, created_at)
       VALUES ('exp_2', 'fam_1', 'user_2', 'coadmin', 'queued', 1001)`,
    ).run();
  });
});

test('two DIFFERENT families can each have their own active job simultaneously', () => {
  const db = makeDb();
  db.exec(`INSERT INTO family_export_job (id, family_id, requested_by_user_id, requested_as, status, created_at)
            VALUES ('exp_1', 'fam_1', 'user_1', 'owner', 'queued', 1000)`);
  assert.doesNotThrow(() => {
    db.prepare(
      `INSERT INTO family_export_job (id, family_id, requested_by_user_id, requested_as, status, created_at)
       VALUES ('exp_2', 'fam_2', 'user_2', 'owner', 'queued', 1001)`,
    ).run();
  });
});

// ── createExportJobStatements / transitionJobStatements against the real DB ─

await atest('createExportJobStatements inserts a queued job + a requested audit row atomically', async () => {
  const db = makeDb();
  const d1 = makeD1(db);
  const env = { DB: d1 };
  const { jobId, statements } = createExportJobStatements(env, {
    familyId: 'fam_1', requestedByUserId: 'user_1', requestedAs: 'owner', requestReason: null,
  });
  await d1.batch(statements);
  const job = readJob(db, jobId);
  assert.equal(job.status, 'queued');
  const audit = db.prepare('SELECT * FROM family_export_audit WHERE job_id = ?').get(jobId);
  assert.equal(audit.event, 'requested');
  assert.equal(audit.actor_authority, 'owner');
});

await atest('createExportJobStatements throws the real UNIQUE violation when the family already has an active job', async () => {
  const db = makeDb();
  const d1 = makeD1(db);
  const env = { DB: d1 };
  const first = createExportJobStatements(env, { familyId: 'fam_1', requestedByUserId: 'user_1', requestedAs: 'owner' });
  await d1.batch(first.statements);
  const second = createExportJobStatements(env, { familyId: 'fam_1', requestedByUserId: 'user_2', requestedAs: 'coadmin' });
  await assert.rejects(() => d1.batch(second.statements), /UNIQUE constraint failed/);
  // rollback must have discarded the failed audit insert too — exactly one job row, one audit row remain.
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM family_export_job').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM family_export_audit').get().c, 1);
});

await atest('transitionJobStatements moves queued -> snapshotting and records started_at', async () => {
  const db = makeDb();
  const d1 = makeD1(db);
  const env = { DB: d1 };
  const { jobId, statements } = createExportJobStatements(env, { familyId: 'fam_1', requestedByUserId: 'user_1', requestedAs: 'owner' });
  await d1.batch(statements);

  const { applied } = await applyJobTransition(env, {
    jobId, fromStatuses: ['queued'], toStatus: 'snapshotting', fields: { started_at: 2000 },
    audit: { familyId: 'fam_1', event: 'started', actorAuthority: 'system' },
  });
  assert.equal(applied, true);
  const job = readJob(db, jobId);
  assert.equal(job.status, 'snapshotting');
  assert.equal(job.started_at, 2000);
});

await atest('a conditional transition does NOT apply (0 rows) when the job already moved on — no silent overwrite', async () => {
  const db = makeDb();
  const d1 = makeD1(db);
  const env = { DB: d1 };
  const { jobId, statements } = createExportJobStatements(env, { familyId: 'fam_1', requestedByUserId: 'user_1', requestedAs: 'owner' });
  await d1.batch(statements);
  await applyJobTransition(env, { jobId, fromStatuses: ['queued'], toStatus: 'snapshotting' });

  // Now try to apply the SAME queued->snapshotting transition again — the
  // job is no longer "queued", so this must be a no-op, not an error and
  // not a silent duplicate audit row.
  const { applied } = await applyJobTransition(env, { jobId, fromStatuses: ['queued'], toStatus: 'snapshotting' });
  assert.equal(applied, false);
});

await atest('a replayed transition (prior transition already committed) inserts NO phantom audit row — the exact PR #9 review finding', async () => {
  const db = makeDb();
  const d1 = makeD1(db);
  const env = { DB: d1 };
  const { jobId, statements } = createExportJobStatements(env, { familyId: 'fam_1', requestedByUserId: 'user_1', requestedAs: 'owner' });
  await d1.batch(statements); // 1 audit row ('requested') so far

  const first = await applyJobTransition(env, {
    jobId, fromStatuses: ['queued'], toStatus: 'snapshotting', fields: { started_at: 2000 },
    audit: { familyId: 'fam_1', event: 'started', actorAuthority: 'system' },
  });
  assert.equal(first.applied, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM family_export_audit WHERE job_id = ?').get(jobId).c, 2, 'requested + started');

  // Replay the exact same queued -> snapshotting transition (e.g. a retried
  // Workflow step after its own D1 write already committed). The job is no
  // longer "queued", so BOTH statements in the atomic batch must match 0
  // rows — the conditional audit INSERT's own WHERE EXISTS checks the SAME
  // pre-transition status the UPDATE's WHERE clause does, so it correctly
  // no-ops right alongside it in the same batch (not skipped entirely —
  // see applyJobTransition's own header comment on why both statements
  // always run together now, atomically, rather than the audit being
  // conditionally SKIPPED as a separate follow-up call).
  const replay = await applyJobTransition(env, {
    jobId, fromStatuses: ['queued'], toStatus: 'snapshotting', fields: { started_at: 9999 },
    audit: { familyId: 'fam_1', event: 'started', actorAuthority: 'system' },
  });
  assert.equal(replay.applied, false);
  assert.equal(replay.results.length, 2, 'both statements run together in one atomic batch');
  assert.equal(replay.results[0].meta.changes, 0, 'the conditional audit INSERT must match 0 rows on a replay, same as the UPDATE');

  const job = readJob(db, jobId);
  assert.equal(job.started_at, 2000, 'the replayed UPDATE must not have overwritten the real transition either');
  assert.equal(
    db.prepare('SELECT COUNT(*) AS c FROM family_export_audit WHERE job_id = ?').get(jobId).c,
    2,
    'no phantom third audit row for a transition that never actually happened',
  );
});

await atest('an audit-write failure rolls back the WHOLE transition atomically — no partial state, the exact PR #9 re-review atomicity finding', async () => {
  const db = makeDb();
  const d1 = makeD1(db);
  const env = { DB: d1 };
  const { jobId, statements } = createExportJobStatements(env, { familyId: 'fam_1', requestedByUserId: 'user_1', requestedAs: 'owner' });
  await d1.batch(statements);

  // An earlier split-call design could leave the UPDATE committed with no
  // audit row at all if the second call failed or the Worker died between
  // them — a real accountability gap for administrator export/cancel/
  // download actions. Forcing the audit INSERT to violate the real
  // family_export_audit.event CHECK constraint proves the new atomic
  // batch has no such window: either BOTH statements commit, or NEITHER
  // does.
  await assert.rejects(() => applyJobTransition(env, {
    jobId, fromStatuses: ['queued'], toStatus: 'snapshotting', fields: { started_at: 2000 },
    audit: { familyId: 'fam_1', event: 'not_a_real_event', actorAuthority: 'system' },
  }));

  const job = readJob(db, jobId);
  assert.equal(job.status, 'queued', 'the UPDATE must not have applied either — the batch is all-or-nothing');
  assert.equal(job.started_at, null);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS c FROM family_export_audit WHERE job_id = ?').get(jobId).c,
    1,
    'only the original "requested" row — no partial/duplicate audit from the failed attempt',
  );
});

test('canTransition rejects an out-of-order jump (queued -> verifying)', () => {
  assert.equal(canTransition('queued', 'verifying'), false);
});

test('canTransition rejects any transition FROM a terminal state', () => {
  for (const terminal of ['cancelled', 'failed', 'expired']) {
    for (const to of RUNNING_STATUSES) assert.equal(canTransition(terminal, to), false, `${terminal} -> ${to} must be illegal`);
  }
});

test('transitionJobStatements throws synchronously (before any I/O) on an illegal transition', () => {
  const db = makeDb();
  const d1 = makeD1(db);
  const env = { DB: d1 };
  assert.throws(() => transitionJobStatements(env, { jobId: 'exp_x', fromStatuses: ['queued'], toStatus: 'ready' }));
});

// ── serializer, against a real row shape read back from SQLite ─────────────

await atest('serializeExportJob round-trips a real row into the exact §12 public shape', async () => {
  const db = makeDb();
  const d1 = makeD1(db);
  const env = { DB: d1 };
  const { jobId, statements } = createExportJobStatements(env, { familyId: 'fam_1', requestedByUserId: 'user_1', requestedAs: 'owner', requestReason: 'because' });
  await d1.batch(statements);
  await applyJobTransition(env, { jobId, fromStatuses: ['queued'], toStatus: 'snapshotting', fields: { started_at: 2000 } });

  const job = readJob(db, jobId);
  const familyView = serializeExportJob(job);
  assert.equal(familyView.status, 'snapshotting');
  assert.equal(familyView.requestReason, undefined, 'family responses must omit request reason');
  assert.equal(familyView.canCancel, true);
  assert.equal(familyView.canDownload, false);

  const adminView = serializeExportJob(job, { forAdmin: true });
  assert.equal(adminView.requestReason, 'because');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

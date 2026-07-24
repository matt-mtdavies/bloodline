/**
 * Unit tests for functions/_lib/exportService.js — the shared authority/
 * serialization service every export route file calls into. Uses a
 * lightweight in-memory D1 fake (plain arrays + substring-matched query
 * handlers, same convention as tests/migrate-tree.test.mjs) rather than
 * node:sqlite — this file must stay Node 20-safe (this repo's main-app CI
 * job pins .nvmrc/Node 20, which has no node:sqlite; the real-SQLite
 * constraint/schema tests for family_export_job live in
 * workers/export-workflow/tests/exportJobSchema.test.mjs instead, which
 * pins Node 22.5+ for exactly that reason).
 * Run with: node tests/exportService.test.mjs
 */
import assert from 'node:assert/strict';
import {
  isExportInfrastructureReady, fullExportTestFamilyIds, isFamilyExportEnabled,
  exportAdminEmailList, isExportAdminEmail,
  createFamilyExport, createAdminExport,
  listFamilyExports, getFamilyExport, listAdminExports, getAdminExport,
  searchExportFamilies, cancelFamilyExport, cancelAdminExport,
  downloadFamilyExport, downloadAdminExport, getAdminExportAudit,
  ExportServiceError,
} from '../functions/_lib/exportService.js';

let passed = 0, failed = 0;
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}\n${e.stack?.split('\n').slice(1, 3).join('\n')}`); }
}

/*
 * A minimal in-memory "D1" — real arrays for family/user/family_member/
 * family_export_job/family_export_audit, with query handling done by
 * matching a distinctive substring of each known SQL statement (the same
 * approach tests/migrate-tree.test.mjs already uses) rather than a full SQL
 * parser. Good enough because exportService.js's query set is small and
 * entirely under this file's own control.
 */
function makeFakeEnv({ families = [], users = [], members = [], jobs = [], migrationApplied = true } = {}) {
  const audit = [];
  const jobRows = jobs.map((j) => ({ processed_files: 0, processed_bytes: 0, warning_count: 0, ...j }));

  function first(sql, args) {
    if (sql.includes('SELECT 1 FROM family_export_job')) {
      if (!migrationApplied) throw new Error('no such table: family_export_job');
      return { '1': 1 };
    }
    if (sql.includes('SELECT family_id FROM user WHERE id')) {
      const u = users.find((x) => x.id === args[0]);
      return u ? { family_id: u.family_id } : null;
    }
    if (sql.includes('SELECT fm.family_id, fm.role, f.name AS family_name') && sql.includes('fm.family_id = ?')) {
      const m = members.find((x) => x.user_id === args[0] && x.family_id === args[1]);
      if (!m) return null;
      const f = families.find((x) => x.id === m.family_id);
      return { family_id: m.family_id, role: m.role, family_name: f?.name };
    }
    if (sql.includes('SELECT fm.family_id, fm.role, f.name AS family_name')) {
      const m = members.find((x) => x.user_id === args[0]);
      if (!m) return null;
      const f = families.find((x) => x.id === m.family_id);
      return { family_id: m.family_id, role: m.role, family_name: f?.name };
    }
    if (sql.includes('COUNT(*) AS cnt FROM family_export_job WHERE family_id')) {
      const [familyId, since] = args;
      return { cnt: jobRows.filter((j) => j.family_id === familyId && j.created_at > since).length };
    }
    if (sql.includes("requested_as = 'site_admin' AND created_at")) {
      const [userId, since] = args;
      return { cnt: jobRows.filter((j) => j.requested_by_user_id === userId && j.requested_as === 'site_admin' && j.created_at > since).length };
    }
    if (sql.includes('SELECT id, name FROM family WHERE id')) {
      const f = families.find((x) => x.id === args[0]);
      return f ? { id: f.id, name: f.name } : null;
    }
    if (sql.includes('FROM family_export_job WHERE id = ? AND family_id = ?')) {
      return jobRows.find((j) => j.id === args[0] && j.family_id === args[1]) || null;
    }
    if (sql.includes('FROM family_export_job WHERE id = ?')) {
      return jobRows.find((j) => j.id === args[0]) || null;
    }
    throw new Error(`fakeEnv: unhandled .first() query: ${sql}`);
  }

  function all(sql, args) {
    if (sql.includes('FROM family_export_job WHERE family_id = ? ORDER BY created_at DESC')) {
      const [familyId] = args;
      return jobRows.filter((j) => j.family_id === familyId).sort((a, b) => b.created_at - a.created_at);
    }
    if (sql.includes("requested_as = 'site_admin' ORDER BY created_at DESC")) {
      return jobRows.filter((j) => j.requested_as === 'site_admin').sort((a, b) => b.created_at - a.created_at);
    }
    if (sql.includes('FROM family f') && sql.includes('WHERE f.id = ? OR f.name LIKE')) {
      const [id, likeArg] = args;
      const needle = likeArg.slice(1, -1).toLowerCase();
      return families.filter((f) => f.id === id || f.name.toLowerCase().includes(needle))
        .map((f) => {
          const owner = members.find((m) => m.family_id === f.id && m.role === 'owner');
          const ownerUser = owner && users.find((u) => u.id === owner.user_id);
          return { id: f.id, name: f.name, memberCount: members.filter((m) => m.family_id === f.id).length, ownerEmail: ownerUser?.email || null, lastExportStatus: null, isSplit: 0 };
        });
    }
    if (sql.includes('FROM family_export_audit WHERE job_id')) {
      const [jobId] = args;
      return audit.filter((a) => a.job_id === jobId).sort((a, b) => a.created_at - b.created_at)
        .map((a) => ({ event: a.event, actor_email_snapshot: a.actor_email_snapshot, actor_authority: a.actor_authority, reason: a.reason, created_at: a.created_at }));
    }
    throw new Error(`fakeEnv: unhandled .all() query: ${sql}`);
  }

  function run(sql, args) {
    if (sql.includes('INSERT INTO family_export_job')) {
      const [id, familyId, requestedByUserId, requestedAs, requestReason, status, createdAt] = args;
      if (jobRows.some((j) => j.family_id === familyId && ['queued', 'snapshotting', 'inventory', 'packaging', 'verifying', 'cancelling'].includes(j.status))) {
        throw new Error('UNIQUE constraint failed: family_export_job.family_id');
      }
      jobRows.push({ id, family_id: familyId, requested_by_user_id: requestedByUserId, requested_as: requestedAs, request_reason: requestReason, status, created_at: createdAt, processed_files: 0, processed_bytes: 0, warning_count: 0 });
      return { changes: 1 };
    }
    if (sql.includes('INSERT INTO family_export_audit')) {
      // Three distinct shapes share this table:
      // 1. buildConditionalAuditInsertStatement's `INSERT ... SELECT ...
      //    WHERE EXISTS (...)` — the lifecycle-transition audit, now
      //    conditional on the job's CURRENT (pre-transition — this branch
      //    always runs before the paired UPDATE within the same batch())
      //    status matching fromStatuses, mirroring the real atomic
      //    INSERT...SELECT...WHERE EXISTS + conditional UPDATE pair.
      // 2. buildAuditInsertStatement's unconditional 9-column VALUES
      //    insert (createExportJobStatements' own "requested" audit row).
      // 3. recordDownloadAudit's narrower 7-column one (no
      //    actor_email_snapshot/reason, `event` a SQL literal not bound).
      if (sql.includes('WHERE EXISTS')) {
        const [, jobId, familyId, actorUserId, actorEmailSnapshot, actorAuthority, event, reason, createdAt, existsJobId, ...fromStatuses] = args;
        const job = jobRows.find((j) => j.id === existsJobId);
        if (!job || !fromStatuses.includes(job.status)) return { changes: 0 };
        audit.push({ job_id: jobId, family_id: familyId, actor_user_id: actorUserId, actor_email_snapshot: actorEmailSnapshot, actor_authority: actorAuthority, event, reason, created_at: createdAt });
        return { changes: 1 };
      }
      if (sql.includes('actor_email_snapshot')) {
        const [, jobId, familyId, actorUserId, actorEmailSnapshot, actorAuthority, event, reason, createdAt] = args;
        audit.push({ job_id: jobId, family_id: familyId, actor_user_id: actorUserId, actor_email_snapshot: actorEmailSnapshot, actor_authority: actorAuthority, event, reason, created_at: createdAt });
      } else {
        const [, jobId, familyId, actorUserId, actorAuthority, createdAt] = args;
        audit.push({ job_id: jobId, family_id: familyId, actor_user_id: actorUserId, actor_email_snapshot: null, actor_authority: actorAuthority, event: 'downloaded', reason: null, created_at: createdAt });
      }
      return { changes: 1 };
    }
    if (sql.includes('UPDATE family_export_job SET status')) {
      // transitionJobStatements builds `UPDATE family_export_job SET status = ?, [..other cols] WHERE id = ? AND status IN (...)`
      // args are [...setVals, jobId, ...fromStatuses] — jobId is always the
      // first non-column bind value right after the SET values; since we
      // don't know the exact column count here, find the row by scanning
      // for a job id present in args whose current status is among the
      // trailing args.
      const job = jobRows.find((j) => args.includes(j.id));
      if (!job) return { changes: 0 };
      const fromStatuses = args.slice(args.indexOf(job.id) + 1);
      if (!fromStatuses.includes(job.status)) return { changes: 0 };
      job.status = args[0]; // first SET value is always `status = ?`
      return { changes: 1 };
    }
    throw new Error(`fakeEnv: unhandled .run() query: ${sql}`);
  }

  function stmt(sql) {
    let args = [];
    const s = {
      bind(...a) { args = a; return s; },
      async first() { return first(sql, args); },
      async all() { return { results: all(sql, args) }; },
      async run() { return { success: true, meta: run(sql, args) }; },
      __sql: sql,
      __args: () => args,
    };
    return s;
  }

  const DB = {
    prepare: (sql) => stmt(sql),
    async batch(stmts) {
      const results = [];
      for (const s of stmts) results.push({ success: true, meta: run(s.__sql, s.__args()) });
      return results;
    },
  };

  const DOCS = {
    objects: new Map(),
    async get(key) {
      const o = this.objects.get(key);
      return o ? { text: async () => o, arrayBuffer: async () => new TextEncoder().encode(o).buffer } : null;
    },
  };

  let workflowCalls = { createExport: [], requestCancellation: [] };
  const EXPORT_WORKFLOW_SERVICE = {
    async createExport(jobId) { workflowCalls.createExport.push(jobId); },
    async requestCancellation(jobId) { workflowCalls.requestCancellation.push(jobId); },
  };

  return {
    env: { DB, DOCS, EXPORT_WORKFLOW_SERVICE, ENABLE_FULL_EXPORT: 'true', EXPORT_ADMIN_EMAILS: 'admin@example.test' },
    jobRows, audit, workflowCalls,
  };
}

const FAM = { id: 'fam_1', name: 'Davies Family' };
const OWNER = { id: 'user_owner', family_id: 'fam_1' };
const VIEWER = { id: 'user_viewer', family_id: 'fam_1' };

function baseFixture(overrides = {}) {
  return makeFakeEnv({
    families: [FAM],
    users: [OWNER, VIEWER],
    members: [
      { user_id: OWNER.id, family_id: FAM.id, role: 'owner' },
      { user_id: VIEWER.id, family_id: FAM.id, role: 'viewer' },
    ],
    jobs: [],
    ...overrides,
  });
}

// ── feature readiness ────────────────────────────────────────────────────
//
// docs/FULL-ARCHIVE-EXPORT-TEST-FAMILY-GATE.md splits the old single
// isFullExportReady() gate into two independent concepts: infrastructure
// readiness (never depends on either rollout flag) and per-family
// enablement (infra ready AND (ENABLE_FULL_EXPORT==='true' OR the family
// is on the FULL_EXPORT_TEST_FAMILY_IDS allowlist)).

await atest('isExportInfrastructureReady does NOT depend on ENABLE_FULL_EXPORT — infra can be ready while every family is still disabled', async () => {
  const { env } = baseFixture();
  env.ENABLE_FULL_EXPORT = 'false';
  assert.equal(await isExportInfrastructureReady(env), true);
});

await atest('isExportInfrastructureReady is false when the service binding is missing', async () => {
  const { env } = baseFixture();
  delete env.EXPORT_WORKFLOW_SERVICE;
  assert.equal(await isExportInfrastructureReady(env), false);
});

await atest('isExportInfrastructureReady is false when the DB binding is missing', async () => {
  const { env } = baseFixture();
  delete env.DB;
  assert.equal(await isExportInfrastructureReady(env), false);
});

await atest('isExportInfrastructureReady is false when the migration has not been applied', async () => {
  const { env } = baseFixture({ migrationApplied: false });
  assert.equal(await isExportInfrastructureReady(env), false);
});

await atest('isExportInfrastructureReady is true when everything is configured', async () => {
  const { env } = baseFixture();
  assert.equal(await isExportInfrastructureReady(env), true);
});

// ── fullExportTestFamilyIds — the pure parser ────────────────────────────

await atest('fullExportTestFamilyIds trims whitespace and discards empty entries', () => {
  assert.deepEqual(fullExportTestFamilyIds({ FULL_EXPORT_TEST_FAMILY_IDS: ' fam_1 ,, fam_2 ,' }), ['fam_1', 'fam_2']);
  assert.deepEqual(fullExportTestFamilyIds({}), []);
  assert.deepEqual(fullExportTestFamilyIds({ FULL_EXPORT_TEST_FAMILY_IDS: '' }), []);
});

await atest('fullExportTestFamilyIds compares CASE-SENSITIVELY, with no prefix or wildcard matching — unlike exportAdminEmailList, family IDs are opaque identifiers, not user-typed text', () => {
  const ids = fullExportTestFamilyIds({ FULL_EXPORT_TEST_FAMILY_IDS: 'fam_1' });
  assert.equal(ids.includes('fam_1'), true);
  assert.equal(ids.includes('FAM_1'), false, 'must not case-fold');
  assert.equal(ids.includes('fam_'), false, 'must not prefix-match');
  assert.equal(ids.includes('fam_10'), false, 'must not substring/prefix-match a longer id');
});

// ── isFamilyExportEnabled — the per-family decision ──────────────────────

await atest('isFamilyExportEnabled: flag false + empty test allowlist is disabled for every family — verification requirement #1', async () => {
  const { env } = baseFixture();
  env.ENABLE_FULL_EXPORT = 'false';
  assert.equal(await isFamilyExportEnabled(env, 'fam_1'), false);
});

await atest('isFamilyExportEnabled: flag false + exact canonical family allowlisted is enabled for that family only — verification requirement #2/#3', async () => {
  const { env } = baseFixture();
  env.ENABLE_FULL_EXPORT = 'false';
  env.FULL_EXPORT_TEST_FAMILY_IDS = 'fam_1';
  assert.equal(await isFamilyExportEnabled(env, 'fam_1'), true);
  assert.equal(await isFamilyExportEnabled(env, 'fam_2'), false, 'a different family remains unavailable');
});

await atest('isFamilyExportEnabled: case/prefix/wildcard variants of an allowlisted id do NOT match — verification requirement #4', async () => {
  const { env } = baseFixture();
  env.ENABLE_FULL_EXPORT = 'false';
  env.FULL_EXPORT_TEST_FAMILY_IDS = ' fam_1 , fam_2 ';
  assert.equal(await isFamilyExportEnabled(env, 'fam_1'), true, 'whitespace around the configured entry must still normalize to a match');
  assert.equal(await isFamilyExportEnabled(env, 'FAM_1'), false);
  assert.equal(await isFamilyExportEnabled(env, 'fam_'), false);
  assert.equal(await isFamilyExportEnabled(env, 'fam_10'), false);
});

await atest('isFamilyExportEnabled: ENABLE_FULL_EXPORT=true enables every family regardless of the test allowlist — verification requirement #9', async () => {
  const { env } = baseFixture();
  env.ENABLE_FULL_EXPORT = 'true';
  env.FULL_EXPORT_TEST_FAMILY_IDS = '';
  assert.equal(await isFamilyExportEnabled(env, 'fam_1'), true);
  assert.equal(await isFamilyExportEnabled(env, 'fam_anything_else'), true);
});

await atest('isFamilyExportEnabled: an allowlisted family is still disabled if infrastructure itself is not ready — verification requirement #11', async () => {
  const { env } = baseFixture({ migrationApplied: false });
  env.ENABLE_FULL_EXPORT = 'false';
  env.FULL_EXPORT_TEST_FAMILY_IDS = 'fam_1';
  assert.equal(await isFamilyExportEnabled(env, 'fam_1'), false);
});

await atest('createFamilyExport throws export_not_configured when the feature is off and the caller\'s family is not allowlisted', async () => {
  const { env } = baseFixture();
  env.ENABLE_FULL_EXPORT = 'false';
  await assert.rejects(() => createFamilyExport(env, { userId: OWNER.id }), (e) => e.code === 'export_not_configured' && e.status === 503);
});

await atest('createFamilyExport succeeds with the flag off when the caller\'s EXACT canonical family is test-allowlisted — verification requirement #2', async () => {
  const { env, jobRows } = baseFixture();
  env.ENABLE_FULL_EXPORT = 'false';
  env.FULL_EXPORT_TEST_FAMILY_IDS = 'fam_1';
  const { familyId } = await createFamilyExport(env, { userId: OWNER.id });
  assert.equal(familyId, 'fam_1');
  assert.equal(jobRows.length, 1);
});

await atest('createFamilyExport ignores any caller-supplied familyId — only the server-resolved canonical membership decides enablement, never client input — verification requirement #5', async () => {
  const { env } = baseFixture();
  env.ENABLE_FULL_EXPORT = 'false';
  env.FULL_EXPORT_TEST_FAMILY_IDS = 'fam_1';
  // createFamilyExport's real signature only ever reads {userId, userEmail}
  // — a stray extra property cannot be used to impersonate an allowlisted
  // family; the family is always resolved server-side from userId.
  const result = await createFamilyExport(env, { userId: OWNER.id, familyId: 'fam_spoofed' });
  assert.equal(result.familyId, 'fam_1');
});

// ── EXPORT_ADMIN_EMAILS ──────────────────────────────────────────────────

await atest('exportAdminEmailList normalizes case/whitespace and has no fallback var', () => {
  const env = { EXPORT_ADMIN_EMAILS: ' Admin@Example.test , second@x.test ' };
  assert.deepEqual(exportAdminEmailList(env), ['admin@example.test', 'second@x.test']);
  assert.deepEqual(exportAdminEmailList({}), []);
});
await atest('isExportAdminEmail is case-insensitive and false for empty config', () => {
  assert.equal(isExportAdminEmail({ EXPORT_ADMIN_EMAILS: 'a@x.test' }, 'A@X.TEST'), true);
  assert.equal(isExportAdminEmail({}, 'a@x.test'), false);
});

// ── createFamilyExport ───────────────────────────────────────────────────

await atest('createFamilyExport succeeds for the owner and starts the Workflow', async () => {
  const { env, jobRows, workflowCalls } = baseFixture();
  const { jobId, familyId } = await createFamilyExport(env, { userId: OWNER.id });
  assert.equal(familyId, 'fam_1');
  assert.equal(jobRows.length, 1);
  assert.equal(jobRows[0].status, 'queued');
  assert.deepEqual(workflowCalls.createExport, [jobId]);
});

await atest('createFamilyExport is forbidden for a viewer', async () => {
  const { env } = baseFixture();
  await assert.rejects(() => createFamilyExport(env, { userId: VIEWER.id }), (e) => e.code === 'forbidden' && e.status === 403);
});

await atest('createFamilyExport maps a UNIQUE violation to export_already_active, not a raw 500', async () => {
  const { env } = baseFixture({ jobs: [{ id: 'exp_existing', family_id: 'fam_1', requested_by_user_id: OWNER.id, requested_as: 'owner', status: 'inventory', created_at: Math.floor(Date.now() / 1000) }] });
  await assert.rejects(() => createFamilyExport(env, { userId: OWNER.id }), (e) => e.code === 'export_already_active' && e.status === 409);
});

await atest('createFamilyExport enforces the 3-per-24h family rate limit', async () => {
  const now = Math.floor(Date.now() / 1000);
  const jobs = Array.from({ length: 3 }, (_, i) => ({ id: `exp_old_${i}`, family_id: 'fam_1', requested_by_user_id: OWNER.id, requested_as: 'owner', status: 'ready', created_at: now - 60 }));
  const { env } = baseFixture({ jobs });
  await assert.rejects(() => createFamilyExport(env, { userId: OWNER.id }), (e) => e.code === 'export_rate_limited' && e.status === 429);
});

// ── createAdminExport ─────────────────────────────────────────────────────

const ADMIN_USER = { id: 'user_admin', family_id: null };

await atest('createAdminExport requires an EXPORT_ADMIN_EMAILS match', async () => {
  const { env } = baseFixture();
  await assert.rejects(() => createAdminExport(env, {
    actorUserId: ADMIN_USER.id, actorEmail: 'not-an-admin@example.test', familyId: 'fam_1',
    reason: 'A perfectly valid reason string', confirmFamilyName: 'Davies Family',
  }), (e) => e.code === 'forbidden' && e.status === 403);
});

await atest('createAdminExport validates reason length (10-500 chars)', async () => {
  const { env } = baseFixture();
  await assert.rejects(() => createAdminExport(env, {
    actorUserId: ADMIN_USER.id, actorEmail: 'admin@example.test', familyId: 'fam_1',
    reason: 'short', confirmFamilyName: 'Davies Family',
  }), (e) => e.code === 'bad_request' && e.status === 400);
});

await atest('createAdminExport requires the typed family name to match the CURRENT family name, case/whitespace-insensitively', async () => {
  const { env } = baseFixture();
  await assert.rejects(() => createAdminExport(env, {
    actorUserId: ADMIN_USER.id, actorEmail: 'admin@example.test', familyId: 'fam_1',
    reason: 'A perfectly valid reason string', confirmFamilyName: 'Wrong Family Name',
  }), (e) => e.code === 'bad_request');

  const { env: env2, jobRows } = baseFixture();
  const result = await createAdminExport(env2, {
    actorUserId: ADMIN_USER.id, actorEmail: 'admin@example.test', familyId: 'fam_1',
    reason: 'A perfectly valid reason string', confirmFamilyName: '  davies family  ',
  });
  assert.equal(result.familyId, 'fam_1');
  assert.equal(jobRows[0].requested_as, 'site_admin');
  assert.equal(jobRows[0].request_reason, 'A perfectly valid reason string');
});

await atest('createAdminExport enforces the 10-per-hour admin rate limit', async () => {
  const now = Math.floor(Date.now() / 1000);
  const jobs = Array.from({ length: 10 }, (_, i) => ({ id: `exp_old_${i}`, family_id: `fam_other_${i}`, requested_by_user_id: ADMIN_USER.id, requested_as: 'site_admin', status: 'ready', created_at: now - 60 }));
  const { env } = baseFixture({ jobs });
  await assert.rejects(() => createAdminExport(env, {
    actorUserId: ADMIN_USER.id, actorEmail: 'admin@example.test', familyId: 'fam_1',
    reason: 'A perfectly valid reason string', confirmFamilyName: 'Davies Family',
  }), (e) => e.code === 'export_rate_limited');
});

// ── list / get ────────────────────────────────────────────────────────────

await atest('listFamilyExports/getFamilyExport are scoped to the caller\'s own family and never leak requestReason', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { env } = baseFixture({ jobs: [{ id: 'exp_1', family_id: 'fam_1', requested_by_user_id: OWNER.id, requested_as: 'owner', status: 'ready', created_at: now, request_reason: 'secret internal note' }] });
  const list = await listFamilyExports(env, { userId: OWNER.id });
  assert.equal(list.length, 1);
  assert.equal('requestReason' in list[0], false);
  const got = await getFamilyExport(env, { userId: OWNER.id, jobId: 'exp_1' });
  assert.equal(got.id, 'exp_1');
});

await atest('listFamilyExports/getFamilyExport are forbidden for a viewer — a PR #9 review finding: only membership was checked before, not role', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { env } = baseFixture({ jobs: [{ id: 'exp_1', family_id: 'fam_1', requested_by_user_id: OWNER.id, requested_as: 'owner', status: 'ready', created_at: now }] });
  await assert.rejects(() => listFamilyExports(env, { userId: VIEWER.id }), (e) => e.code === 'forbidden' && e.status === 403);
  await assert.rejects(() => getFamilyExport(env, { userId: VIEWER.id, jobId: 'exp_1' }), (e) => e.code === 'forbidden' && e.status === 403);
});

await atest('getFamilyExport 404s for a job belonging to a different family (no cross-family job-id guessing)', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { env } = baseFixture({
    families: [FAM, { id: 'fam_2', name: 'Other Family' }],
    members: [{ user_id: OWNER.id, family_id: 'fam_1', role: 'owner' }],
    jobs: [{ id: 'exp_other', family_id: 'fam_2', requested_by_user_id: 'someone_else', requested_as: 'owner', status: 'ready', created_at: now }],
  });
  await assert.rejects(() => getFamilyExport(env, { userId: OWNER.id, jobId: 'exp_other' }), (e) => e.code === 'not_found' && e.status === 404);
});

await atest('listAdminExports/getAdminExport require EXPORT_ADMIN_EMAILS and expose requestReason', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { env } = baseFixture({ jobs: [{ id: 'exp_1', family_id: 'fam_1', requested_by_user_id: ADMIN_USER.id, requested_as: 'site_admin', status: 'ready', created_at: now, request_reason: 'audited reason' }] });
  await assert.rejects(() => listAdminExports(env, { actorEmail: 'not-admin@example.test' }), (e) => e.code === 'forbidden');
  const list = await listAdminExports(env, { actorEmail: 'admin@example.test' });
  assert.equal(list[0].requestReason, 'audited reason');
  const got = await getAdminExport(env, { actorEmail: 'admin@example.test', jobId: 'exp_1' });
  assert.equal(got.requestReason, 'audited reason');
});

// ── search ────────────────────────────────────────────────────────────────

await atest('searchExportFamilies requires export-admin authority and returns selection metadata only', async () => {
  const { env } = baseFixture();
  await assert.rejects(() => searchExportFamilies(env, { actorEmail: 'not-admin@example.test', query: 'davies' }), (e) => e.code === 'forbidden');
  const results = await searchExportFamilies(env, { actorEmail: 'admin@example.test', query: 'davies' });
  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'Davies Family');
  assert.equal('tree' in results[0], false);
});

// ── cancel ────────────────────────────────────────────────────────────────

await atest('cancelFamilyExport transitions a running job to cancelling and notifies the Workflow', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { env, jobRows, workflowCalls } = baseFixture({ jobs: [{ id: 'exp_1', family_id: 'fam_1', requested_by_user_id: OWNER.id, requested_as: 'owner', status: 'packaging', created_at: now }] });
  const result = await cancelFamilyExport(env, { userId: OWNER.id, jobId: 'exp_1' });
  assert.equal(result.status, 'cancelling');
  assert.equal(jobRows[0].status, 'cancelling');
  assert.deepEqual(workflowCalls.requestCancellation, ['exp_1']);
});

await atest('cancelFamilyExport is idempotent — cancelling an already-cancelled job is a no-op success, not an error', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { env } = baseFixture({ jobs: [{ id: 'exp_1', family_id: 'fam_1', requested_by_user_id: OWNER.id, requested_as: 'owner', status: 'cancelled', created_at: now }] });
  const result = await cancelFamilyExport(env, { userId: OWNER.id, jobId: 'exp_1' });
  assert.equal(result.status, 'cancelled');
});

await atest('cancelFamilyExport is forbidden for a viewer', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { env } = baseFixture({ jobs: [{ id: 'exp_1', family_id: 'fam_1', requested_by_user_id: OWNER.id, requested_as: 'owner', status: 'packaging', created_at: now }] });
  await assert.rejects(() => cancelFamilyExport(env, { userId: VIEWER.id, jobId: 'exp_1' }), (e) => e.code === 'forbidden');
});

await atest('cancelAdminExport requires export-admin authority regardless of family membership', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { env } = baseFixture({ jobs: [{ id: 'exp_1', family_id: 'fam_1', requested_by_user_id: ADMIN_USER.id, requested_as: 'site_admin', status: 'packaging', created_at: now }] });
  await assert.rejects(() => cancelAdminExport(env, { actorEmail: 'not-admin@example.test', jobId: 'exp_1' }), (e) => e.code === 'forbidden');
  const result = await cancelAdminExport(env, { actorEmail: 'admin@example.test', jobId: 'exp_1' });
  assert.equal(result.status, 'cancelling');
});

// ── download ──────────────────────────────────────────────────────────────

await atest('downloadFamilyExport requires ready/ready_with_warnings and an unexpired job, and records an audit row', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { env, audit } = baseFixture({ jobs: [{ id: 'exp_1', family_id: 'fam_1', requested_by_user_id: OWNER.id, requested_as: 'owner', status: 'ready', created_at: now, expires_at: now + 1000, archive_r2_key: 'exports/exp_1/bloodline-full-archive.zip' }] });
  env.DOCS.objects.set('exports/exp_1/bloodline-full-archive.zip', 'zip-bytes');
  const object = await downloadFamilyExport(env, { userId: OWNER.id, jobId: 'exp_1' });
  assert.ok(object);
  assert.equal(audit.length, 1);
});

await atest('downloadFamilyExport rejects a not-yet-ready job', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { env } = baseFixture({ jobs: [{ id: 'exp_1', family_id: 'fam_1', requested_by_user_id: OWNER.id, requested_as: 'owner', status: 'packaging', created_at: now }] });
  await assert.rejects(() => downloadFamilyExport(env, { userId: OWNER.id, jobId: 'exp_1' }), (e) => e.code === 'archive_unavailable' && e.status === 409);
});

await atest('downloadFamilyExport rejects an expired job even if still marked ready', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { env } = baseFixture({ jobs: [{ id: 'exp_1', family_id: 'fam_1', requested_by_user_id: OWNER.id, requested_as: 'owner', status: 'ready', created_at: now, expires_at: now - 10, archive_r2_key: 'exports/exp_1/x.zip' }] });
  await assert.rejects(() => downloadFamilyExport(env, { userId: OWNER.id, jobId: 'exp_1' }), (e) => e.code === 'archive_unavailable' && e.status === 410);
});

await atest('downloadFamilyExport is forbidden for a viewer, even for a ready job', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { env } = baseFixture({ jobs: [{ id: 'exp_1', family_id: 'fam_1', requested_by_user_id: OWNER.id, requested_as: 'owner', status: 'ready', created_at: now, expires_at: now + 1000, archive_r2_key: 'exports/exp_1/x.zip' }] });
  await assert.rejects(() => downloadFamilyExport(env, { userId: VIEWER.id, jobId: 'exp_1' }), (e) => e.code === 'forbidden');
});

await atest('downloadAdminExport requires export-admin authority independent of family membership', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { env } = baseFixture({ jobs: [{ id: 'exp_1', family_id: 'fam_1', requested_by_user_id: ADMIN_USER.id, requested_as: 'site_admin', status: 'ready', created_at: now, expires_at: now + 1000, archive_r2_key: 'exports/exp_1/x.zip' }] });
  env.DOCS.objects.set('exports/exp_1/x.zip', 'bytes');
  await assert.rejects(() => downloadAdminExport(env, { actorUserId: 'x', actorEmail: 'not-admin@example.test', jobId: 'exp_1' }), (e) => e.code === 'forbidden');
  const object = await downloadAdminExport(env, { actorUserId: ADMIN_USER.id, actorEmail: 'admin@example.test', jobId: 'exp_1' });
  assert.ok(object);
});

// ── audit trail + the cancel-idempotence double-serialization regression ──

await atest('createFamilyExport stamps the requester\'s email onto the "requested" audit row', async () => {
  const { env, audit } = baseFixture();
  await createFamilyExport(env, { userId: OWNER.id, userEmail: 'owner@example.test' });
  assert.equal(audit.length, 1);
  assert.equal(audit[0].event, 'requested');
  assert.equal(audit[0].actor_email_snapshot, 'owner@example.test');
});

await atest('cancelFamilyExport is idempotent AND returns a correctly-serialized job on repeat — the exact double-serialization bug: an earlier version pre-serialized inside cancelJob, then serialized AGAIN on top, silently nulling createdAt and dropping requestedAs', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { env } = baseFixture({ jobs: [{ id: 'exp_1', family_id: 'fam_1', requested_by_user_id: OWNER.id, requested_as: 'owner', status: 'cancelled', created_at: now }] });
  const result = await cancelFamilyExport(env, { userId: OWNER.id, userEmail: 'owner@example.test', jobId: 'exp_1' });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.createdAt, new Date(now * 1000).toISOString(), 'createdAt must survive the idempotent path intact');
  assert.equal(result.requestedAs, 'owner', 'requestedAs must survive the idempotent path intact');
});

await atest('cancelFamilyExport stamps the actor\'s email onto the cancel_requested audit row', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { env, audit } = baseFixture({ jobs: [{ id: 'exp_1', family_id: 'fam_1', requested_by_user_id: OWNER.id, requested_as: 'owner', status: 'packaging', created_at: now }] });
  await cancelFamilyExport(env, { userId: OWNER.id, userEmail: 'owner@example.test', jobId: 'exp_1' });
  const cancelEvent = audit.find((a) => a.event === 'cancel_requested');
  assert.equal(cancelEvent.actor_email_snapshot, 'owner@example.test');
});

await atest('getAdminExportAudit returns the full immutable trail for a job, oldest first, and requires export-admin authority', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { env } = baseFixture({ jobs: [{ id: 'exp_1', family_id: 'fam_1', requested_by_user_id: OWNER.id, requested_as: 'owner', status: 'packaging', created_at: now }] });
  await assert.rejects(() => getAdminExportAudit(env, { actorEmail: 'not-admin@example.test', jobId: 'exp_1' }), (e) => e.code === 'forbidden');
  await cancelFamilyExport(env, { userId: OWNER.id, userEmail: 'owner@example.test', jobId: 'exp_1' });
  const events = await getAdminExportAudit(env, { actorEmail: 'admin@example.test', jobId: 'exp_1' });
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'cancel_requested');
  assert.equal(events[0].actorEmail, 'owner@example.test');
});

await atest('getAdminExportAudit 404s for an unknown job id', async () => {
  const { env } = baseFixture();
  await assert.rejects(() => getAdminExportAudit(env, { actorEmail: 'admin@example.test', jobId: 'exp_nope' }), (e) => e.code === 'not_found');
});

// ── disposable-family rollout gate (docs/FULL-ARCHIVE-EXPORT-TEST-FAMILY-GATE.md) ──
// The remaining numbered "Verification" requirements from the brief that
// need a real job/family fixture to exercise meaningfully (readiness- and
// createFamilyExport-level requirements #1/#2/#3/#4/#5/#9/#11 are covered
// above, right next to the readiness primitives they test).

function gateFixture({ allowlist = '', flag = 'false', jobStatus = 'ready' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const { env, jobRows } = baseFixture({
    jobs: [{
      id: 'exp_1', family_id: 'fam_1', requested_by_user_id: OWNER.id, requested_as: 'owner',
      status: jobStatus, created_at: now, expires_at: now + 1000, archive_r2_key: 'exports/exp_1/x.zip',
    }],
  });
  env.ENABLE_FULL_EXPORT = flag;
  env.FULL_EXPORT_TEST_FAMILY_IDS = allowlist;
  env.DOCS.objects.set('exports/exp_1/x.zip', 'zip-bytes');
  return { env, jobRows };
}

await atest('a job belonging to a non-allowlisted family cannot be read, cancelled, or downloaded through the OWNER endpoints while the flag is off — verification requirement #6', async () => {
  const { env } = gateFixture({ allowlist: '' }); // fam_1 NOT allowlisted
  await assert.rejects(() => getFamilyExport(env, { userId: OWNER.id, jobId: 'exp_1' }), (e) => e.code === 'export_not_configured' && e.status === 503);
  await assert.rejects(() => cancelFamilyExport(env, { userId: OWNER.id, jobId: 'exp_1' }), (e) => e.code === 'export_not_configured' && e.status === 503);
  await assert.rejects(() => downloadFamilyExport(env, { userId: OWNER.id, jobId: 'exp_1' }), (e) => e.code === 'export_not_configured' && e.status === 503);
});

await atest('a job belonging to a non-allowlisted family cannot be read, cancelled, or downloaded through the ADMIN endpoints while the flag is off, even by a genuinely authorized admin — verification requirement #6', async () => {
  const { env } = gateFixture({ allowlist: '' }); // fam_1 NOT allowlisted
  await assert.rejects(() => getAdminExport(env, { actorEmail: 'admin@example.test', jobId: 'exp_1' }), (e) => e.code === 'export_not_configured' && e.status === 503);
  await assert.rejects(() => cancelAdminExport(env, { actorEmail: 'admin@example.test', jobId: 'exp_1' }), (e) => e.code === 'export_not_configured' && e.status === 503);
  await assert.rejects(() => downloadAdminExport(env, { actorUserId: ADMIN_USER.id, actorEmail: 'admin@example.test', jobId: 'exp_1' }), (e) => e.code === 'export_not_configured' && e.status === 503);
  await assert.rejects(() => getAdminExportAudit(env, { actorEmail: 'admin@example.test', jobId: 'exp_1' }), (e) => e.code === 'export_not_configured' && e.status === 503);
});

await atest('the SAME job succeeds through every owner and admin endpoint once fam_1 is on the test allowlist, flag still off', async () => {
  const { env } = gateFixture({ allowlist: 'fam_1' });
  const got = await getFamilyExport(env, { userId: OWNER.id, jobId: 'exp_1' });
  assert.equal(got.id, 'exp_1');
  const adminGot = await getAdminExport(env, { actorEmail: 'admin@example.test', jobId: 'exp_1' });
  assert.equal(adminGot.id, 'exp_1');
  const object = await downloadFamilyExport(env, { userId: OWNER.id, jobId: 'exp_1' });
  assert.ok(object);
  const events = await getAdminExportAudit(env, { actorEmail: 'admin@example.test', jobId: 'exp_1' });
  assert.ok(Array.isArray(events));
});

await atest('createAdminExport on the test allowlist still requires EXPORT_ADMIN_EMAILS, a valid reason, and the typed family name to match — verification requirement #7', async () => {
  const { env: envNoAdmin } = gateFixture({ allowlist: 'fam_1', jobStatus: 'cancelled' });
  await assert.rejects(() => createAdminExport(envNoAdmin, {
    actorUserId: ADMIN_USER.id, actorEmail: 'not-an-admin@example.test', familyId: 'fam_1',
    reason: 'A perfectly valid reason string', confirmFamilyName: 'Davies Family',
  }), (e) => e.code === 'forbidden' && e.status === 403);

  const { env: envBadReason } = gateFixture({ allowlist: 'fam_1', jobStatus: 'cancelled' });
  await assert.rejects(() => createAdminExport(envBadReason, {
    actorUserId: ADMIN_USER.id, actorEmail: 'admin@example.test', familyId: 'fam_1',
    reason: 'short', confirmFamilyName: 'Davies Family',
  }), (e) => e.code === 'bad_request');

  const { env: envBadName } = gateFixture({ allowlist: 'fam_1', jobStatus: 'cancelled' });
  await assert.rejects(() => createAdminExport(envBadName, {
    actorUserId: ADMIN_USER.id, actorEmail: 'admin@example.test', familyId: 'fam_1',
    reason: 'A perfectly valid reason string', confirmFamilyName: 'Wrong Name',
  }), (e) => e.code === 'bad_request');

  const { env: envOk, jobRows } = gateFixture({ allowlist: 'fam_1', jobStatus: 'cancelled' });
  const result = await createAdminExport(envOk, {
    actorUserId: ADMIN_USER.id, actorEmail: 'admin@example.test', familyId: 'fam_1',
    reason: 'A perfectly valid reason string', confirmFamilyName: 'Davies Family',
  });
  assert.equal(result.familyId, 'fam_1');
  assert.equal(jobRows.filter((j) => j.requested_as === 'site_admin').length, 1);
});

await atest('createAdminExport still fails closed when fam_1 is NOT on the test allowlist and the flag is off, even for a fully-authorized admin', async () => {
  const { env } = gateFixture({ allowlist: '', jobStatus: 'cancelled' });
  await assert.rejects(() => createAdminExport(env, {
    actorUserId: ADMIN_USER.id, actorEmail: 'admin@example.test', familyId: 'fam_1',
    reason: 'A perfectly valid reason string', confirmFamilyName: 'Davies Family',
  }), (e) => e.code === 'export_not_configured' && e.status === 503);
});

await atest('listAdminExports and searchExportFamilies are FILTERED to allowlisted families while the flag is false — verification requirement #8', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { env } = baseFixture({
    families: [FAM, { id: 'fam_2', name: 'Other Family' }],
    members: [
      { user_id: OWNER.id, family_id: 'fam_1', role: 'owner' },
      { user_id: 'user_other_owner', family_id: 'fam_2', role: 'owner' },
    ],
    users: [OWNER, VIEWER, { id: 'user_other_owner', family_id: 'fam_2' }],
    jobs: [
      { id: 'exp_1', family_id: 'fam_1', requested_by_user_id: ADMIN_USER.id, requested_as: 'site_admin', status: 'ready', created_at: now },
      { id: 'exp_2', family_id: 'fam_2', requested_by_user_id: ADMIN_USER.id, requested_as: 'site_admin', status: 'ready', created_at: now },
    ],
  });
  env.ENABLE_FULL_EXPORT = 'false';
  env.FULL_EXPORT_TEST_FAMILY_IDS = 'fam_1';

  const list = await listAdminExports(env, { actorEmail: 'admin@example.test' });
  assert.deepEqual(list.map((j) => j.id), ['exp_1'], 'only the allowlisted family\'s job may appear while the flag is off');

  const searched = await searchExportFamilies(env, { actorEmail: 'admin@example.test', query: 'family' }); // matches both by name
  assert.deepEqual(searched.map((f) => f.id), ['fam_1'], 'only the allowlisted family may appear in the picker while the flag is off');

  env.ENABLE_FULL_EXPORT = 'true';
  const listAll = await listAdminExports(env, { actorEmail: 'admin@example.test' });
  assert.deepEqual(listAll.map((j) => j.id).sort(), ['exp_1', 'exp_2'], 'general release must show every family again, unfiltered');
});

await atest('removing the family id from the test allowlist revokes create, history, status, cancel, audit, and download access on the very next request — verification requirement #10', async () => {
  const { env, jobRows } = gateFixture({ allowlist: 'fam_1', jobStatus: 'packaging' });

  // Confirm access genuinely works first — otherwise "revoked" would be
  // trivially true for the wrong reason.
  const list = await listFamilyExports(env, { userId: OWNER.id });
  assert.equal(list.length, 1);
  const got = await getFamilyExport(env, { userId: OWNER.id, jobId: 'exp_1' });
  assert.equal(got.id, 'exp_1');

  // Revoke.
  env.FULL_EXPORT_TEST_FAMILY_IDS = '';

  await assert.rejects(() => createFamilyExport(env, { userId: OWNER.id }), (e) => e.code === 'export_not_configured');
  await assert.rejects(() => listFamilyExports(env, { userId: OWNER.id }), (e) => e.code === 'export_not_configured');
  await assert.rejects(() => getFamilyExport(env, { userId: OWNER.id, jobId: 'exp_1' }), (e) => e.code === 'export_not_configured');
  await assert.rejects(() => cancelFamilyExport(env, { userId: OWNER.id, jobId: 'exp_1' }), (e) => e.code === 'export_not_configured');
  await assert.rejects(() => downloadFamilyExport(env, { userId: OWNER.id, jobId: 'exp_1' }), (e) => e.code === 'export_not_configured');
  await assert.rejects(() => getAdminExportAudit(env, { actorEmail: 'admin@example.test', jobId: 'exp_1' }), (e) => e.code === 'export_not_configured');

  // The job itself must be untouched by the revocation — access is denied,
  // not the underlying data mutated or deleted.
  assert.equal(jobRows.find((j) => j.id === 'exp_1').status, 'packaging');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

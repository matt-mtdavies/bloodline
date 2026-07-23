import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  authorizeJobStep, captureSourceStep, readCapturedTree,
  captureActivityBoundStep, captureActivityPageStep,
  buildInventoryStep, resolveInventoryShardStep, resolveKeepsakesStep,
  SourceCorruptError, SourceIncompleteError,
} from '../src/workflowSteps.js';
import { createExportJobStatements } from '../../../functions/_lib/exportJob.js';
import { ActivityLogUnavailableError } from '../src/lib/activityLog.js';

let passed = 0, failed = 0;
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}\n${e.stack?.split('\n').slice(1, 3).join('\n')}`); }
}

const MIGRATION_JOBS = new URL('../../../migrations/0014_export_jobs.sql', import.meta.url);
const { readFileSync } = await import('node:fs');

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE family (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT);
    CREATE TABLE family_tree (family_id TEXT PRIMARY KEY, tree_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE activity_log (
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL, author_name TEXT, author_email TEXT,
      type TEXT NOT NULL, person_id TEXT, person_name TEXT, detail TEXT, created_at TEXT NOT NULL
    );
  `);
  db.exec(readFileSync(MIGRATION_JOBS, 'utf8'));
  db.exec(`INSERT INTO family (id, name) VALUES ('fam_1', 'Test Family')`);
  db.exec(`INSERT INTO user (id, email) VALUES ('user_1', 'a@test.example')`);
  return db;
}

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
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

// A minimal in-memory R2 fake — get/put/head/list — matching the surface
// workflow.js's steps actually call.
function makeR2() {
  const store = new Map(); // key -> { body: string, size, etag }
  let etagCounter = 0;
  return {
    store,
    async put(key, value) {
      const body = typeof value === 'string' ? value : String(value);
      store.set(key, { body, size: body.length, etag: `"etag-${++etagCounter}"` });
    },
    async get(key) {
      const o = store.get(key);
      if (!o) return null;
      return { text: async () => o.body, json: async () => JSON.parse(o.body) };
    },
    async head(key) {
      const o = store.get(key);
      if (!o) return null;
      return { size: o.size, etag: o.etag, httpMetadata: { contentType: 'application/octet-stream' } };
    },
    async list({ prefix }) {
      return { objects: [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.size, etag: o.etag })) };
    },
    async delete(key) { store.delete(key); },
  };
}

function makeEnv() {
  const db = makeDb();
  return { db, env: { DB: makeD1(db), DOCS: makeR2() } };
}

async function seedQueuedJob(env, db, { familyId = 'fam_1' } = {}) {
  const { jobId, statements } = createExportJobStatements(env, { familyId, requestedByUserId: 'user_1', requestedAs: 'owner' });
  await env.DB.batch(statements);
  return jobId;
}

// ── authorizeJobStep ─────────────────────────────────────────────────────

await atest('authorizeJobStep transitions queued -> snapshotting and returns the family id', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const result = await authorizeJobStep(env, { jobId });
  assert.equal(result.alreadyStarted, false);
  assert.equal(result.familyId, 'fam_1');
  const row = db.prepare('SELECT * FROM family_export_job WHERE id = ?').get(jobId);
  assert.equal(row.status, 'snapshotting');
  assert.ok(row.started_at > 0);
});

await atest('authorizeJobStep on an already-progressed job returns alreadyStarted, does not error', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  await authorizeJobStep(env, { jobId });
  const result = await authorizeJobStep(env, { jobId }); // replayed Workflow instance
  assert.equal(result.alreadyStarted, true);
  assert.equal(result.status, 'snapshotting');
});

// ── captureSourceStep ────────────────────────────────────────────────────

await atest('captureSourceStep writes the exact logical tree to staging and records source metadata on the job row', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const tree = { people: [{ id: 'p1', display_name: 'James' }], relationships: [] };
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify(tree)}', 5000)`);

  const result = await captureSourceStep(env, { jobId, familyId: 'fam_1' });
  assert.equal(result.storageMode, 'legacy');
  assert.equal(result.treeUpdatedAt, 5000);

  const staged = await readCapturedTree(env, jobId);
  assert.deepEqual(staged, tree);

  const row = db.prepare('SELECT * FROM family_export_job WHERE id = ?').get(jobId);
  assert.equal(row.source_storage_mode, 'legacy');
  assert.equal(row.source_tree_updated_at, 5000);
});

await atest('captureSourceStep fails source_corrupt on invalid core JSON', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', 'not json', 5000)`);
  await assert.rejects(() => captureSourceStep(env, { jobId, familyId: 'fam_1' }), SourceCorruptError);
});

await atest('captureSourceStep fails source_incomplete when a migrated family\'s R2 extra is missing', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const core = { people: [], relationships: [], _extraVersion: 1 }; // no matching tree-extra/fam_1/1.json ever written
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify(core)}', 5000)`);
  await assert.rejects(() => captureSourceStep(env, { jobId, familyId: 'fam_1' }), SourceIncompleteError);
});

// ── activity capture ─────────────────────────────────────────────────────

await atest('captureActivityBoundStep + repeated captureActivityPageStep page through the whole activity_log deterministically', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  for (let i = 0; i < 5; i++) {
    db.exec(`INSERT INTO activity_log (id, family_id, type, created_at) VALUES ('act_${i}', 'fam_1', 'person_added', '2026-01-0${i + 1}T00:00:00.000Z')`);
  }

  const bound = await captureActivityBoundStep(env, { jobId, familyId: 'fam_1' });
  assert.equal(bound.done, false);
  assert.ok(bound.upperBound);

  let cursor = null, pageIndex = 0, totalRows = 0;
  for (;;) {
    const page = await captureActivityPageStep(env, { jobId, familyId: 'fam_1', pageIndex, lowerCursor: cursor });
    totalRows += page.rowCount;
    if (page.done) break;
    cursor = page.nextCursor;
    pageIndex += 1;
  }
  assert.equal(totalRows, 5);
  const shard = await env.DOCS.get(`export-staging/${jobId}/activity/00000.ndjson`);
  assert.ok(shard, 'the first shard must exist in staging');
});

await atest('a family with zero activity rows completes activity capture with no pages', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const bound = await captureActivityBoundStep(env, { jobId, familyId: 'fam_1' });
  assert.equal(bound.done, true);
  assert.equal(bound.upperBound, null);
});

await atest('a missing activity_log table surfaces as ActivityLogUnavailableError, not a generic crash', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE family (id TEXT PRIMARY KEY, name TEXT); CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT);`);
  db.exec(readFileSync(MIGRATION_JOBS, 'utf8'));
  db.exec(`INSERT INTO family (id, name) VALUES ('fam_1', 'x')`);
  db.exec(`INSERT INTO user (id, email) VALUES ('user_1', 'a@test.example')`);
  const env = { DB: makeD1(db), DOCS: makeR2() };
  const jobId = await seedQueuedJob(env, db);
  await assert.rejects(() => captureActivityBoundStep(env, { jobId, familyId: 'fam_1' }), ActivityLogUnavailableError);
});

// ── inventory build + resolve ────────────────────────────────────────────

await atest('buildInventoryStep shards media references and transitions snapshotting -> inventory; resolveInventoryShardStep resolves each shard', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  await authorizeJobStep(env, { jobId }); // -> snapshotting
  const tree = {
    people: [
      { id: 'p1', display_name: 'James', photo: 'data:image/jpeg;base64,YWJj' }, // included
      { id: 'p2', display_name: 'Megan', photo: '/api/photos/missing-key' }, // missing (no R2 object)
    ],
    relationships: [],
  };
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify(tree)}', 1000)`);
  await captureSourceStep(env, { jobId, familyId: 'fam_1' });

  const plan = await buildInventoryStep(env, { jobId, familyId: 'fam_1' });
  assert.equal(plan.mediaRefCount, 2);
  assert.equal(plan.shardCount, 1);
  const row = db.prepare('SELECT status FROM family_export_job WHERE id = ?').get(jobId);
  assert.equal(row.status, 'inventory');

  const resolved = await resolveInventoryShardStep(env, { jobId, familyId: 'fam_1', shardIndex: 0 });
  assert.equal(resolved.entryCount, 2);
  assert.equal(resolved.warningCount, 1); // the missing photo

  const stored = await env.DOCS.get(`export-staging/${jobId}/inventory/resolved-0.json`);
  const entries = JSON.parse(await stored.text());
  const included = entries.find((e) => e.id === 'p1');
  const missing = entries.find((e) => e.id === 'p2');
  assert.equal(included.status, 'included');
  assert.equal(missing.status, 'missing');
});

await atest('buildInventoryStep produces multiple shards once media references exceed the 100-entry budget', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  await authorizeJobStep(env, { jobId });
  const people = Array.from({ length: 150 }, (_, i) => ({ id: `p${i}`, display_name: `Person ${i}`, photo: 'data:image/jpeg;base64,YWJj' }));
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify({ people, relationships: [] })}', 1000)`);
  await captureSourceStep(env, { jobId, familyId: 'fam_1' });

  const plan = await buildInventoryStep(env, { jobId, familyId: 'fam_1' });
  assert.equal(plan.mediaRefCount, 150);
  assert.equal(plan.shardCount, 2);

  const first = await resolveInventoryShardStep(env, { jobId, familyId: 'fam_1', shardIndex: 0 });
  const second = await resolveInventoryShardStep(env, { jobId, familyId: 'fam_1', shardIndex: 1 });
  assert.equal(first.entryCount + second.entryCount, 150);
});

await atest('resolveKeepsakesStep lists only the exact family/person prefix, never the flat bucket', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const tree = { people: [{ id: 'p1', display_name: 'James' }], relationships: [] };
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify(tree)}', 1000)`);
  await captureSourceStep(env, { jobId, familyId: 'fam_1' });

  await env.DOCS.put('keepsake/fam_1/p1/latest.json', JSON.stringify({ narrative: null }));
  await env.DOCS.put('keepsake/fam_OTHER/p9/latest.json', JSON.stringify({ narrative: null })); // must never be listed

  const result = await resolveKeepsakesStep(env, { jobId, familyId: 'fam_1' });
  assert.equal(result.keepsakeEntryCount, 1);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

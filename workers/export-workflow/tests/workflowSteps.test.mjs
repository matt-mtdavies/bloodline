import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  authorizeJobStep, captureSourceStep, readCapturedTree,
  captureActivityBoundStep, captureActivityPageStep,
  buildInventoryStep, resolveInventoryShardStep, resolveKeepsakesStep,
  startMultipartStep, packageStep, completeMultipartStep, verifyArchiveStep,
  finalizeJobStep, sendCompletionEmailStep, cleanStagingStep,
  isCancellationRequested, handleCancellation,
  expireReadyJobs, reconcileStaleJobs, sweepOrphanStaging, runCleanupSweep,
  SourceCorruptError, SourceIncompleteError, ArchiveVerificationError,
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

// A minimal in-memory R2 fake — get/put/head/list/multipart — matching the
// surface workflowSteps.js's steps actually call. Always stores real bytes
// (never a naive String(value) on a Uint8Array, which would silently
// corrupt binary content into a comma-joined number list).
function makeR2() {
  const store = new Map(); // key -> { bytes: Uint8Array, etag }
  const multipartUploads = new Map(); // uploadId -> { key, parts: Map<partNumber, Uint8Array>, aborted }
  let etagCounter = 0;
  let uploadIdCounter = 0;

  function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    return new TextEncoder().encode(String(value));
  }

  return {
    store,
    async put(key, value) {
      const bytes = toBytes(value);
      store.set(key, { bytes, etag: `"etag-${++etagCounter}"` });
    },
    async get(key) {
      const o = store.get(key);
      if (!o) return null;
      return {
        text: async () => new TextDecoder().decode(o.bytes),
        json: async () => JSON.parse(new TextDecoder().decode(o.bytes)),
        arrayBuffer: async () => o.bytes.buffer.slice(o.bytes.byteOffset, o.bytes.byteOffset + o.bytes.byteLength),
        etag: o.etag,
      };
    },
    async head(key) {
      const o = store.get(key);
      if (!o) return null;
      return { size: o.bytes.byteLength, etag: o.etag, httpMetadata: { contentType: 'application/octet-stream' } };
    },
    async list({ prefix, limit = 1000 }) {
      const all = [...store.entries()].filter(([k]) => k.startsWith(prefix));
      const page = all.slice(0, limit);
      return {
        objects: page.map(([key, o]) => ({ key, size: o.bytes.byteLength, etag: o.etag })),
        truncated: all.length > limit,
      };
    },
    async delete(key) { store.delete(key); },
    async createMultipartUpload(key) {
      const uploadId = `upload-${++uploadIdCounter}`;
      multipartUploads.set(uploadId, { key, parts: new Map(), aborted: false });
      return { key, uploadId };
    },
    resumeMultipartUpload(key, uploadId) {
      return {
        key,
        uploadId,
        async uploadPart(partNumber, bytes) {
          const up = multipartUploads.get(uploadId);
          if (!up) throw new Error(`no such multipart upload: ${uploadId}`);
          up.parts.set(partNumber, toBytes(bytes));
          return { partNumber, etag: `"part-etag-${partNumber}"` };
        },
        async complete(uploadedParts) {
          const up = multipartUploads.get(uploadId);
          if (!up) throw new Error(`no such multipart upload: ${uploadId}`);
          const total = uploadedParts.reduce((n, p) => n + up.parts.get(p.partNumber).byteLength, 0);
          const merged = new Uint8Array(total);
          let offset = 0;
          for (const p of uploadedParts) {
            const bytes = up.parts.get(p.partNumber);
            merged.set(bytes, offset);
            offset += bytes.byteLength;
          }
          store.set(up.key, { bytes: merged, etag: `"final-etag-${up.key}"` });
          multipartUploads.delete(uploadId);
          return { etag: `"final-etag-${up.key}"` };
        },
        async abort() {
          const up = multipartUploads.get(uploadId);
          if (up) { up.aborted = true; multipartUploads.delete(uploadId); }
        },
      };
    },
    multipartUploads,
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

// ── full pipeline: authorize -> ... -> clean-staging, verified with unzip ──

const { execFileSync } = await import('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const path = await import('node:path');

function toTempFile(bytes) {
  const dir = mkdtempSync(path.join(tmpdir(), 'workflow-e2e-'));
  const file = path.join(dir, 'archive.zip');
  writeFileSync(file, bytes);
  return { dir, file };
}
function verifyWithUnzip(file) {
  execFileSync('unzip', ['-t', file], { stdio: 'pipe' });
  return execFileSync('zipinfo', ['-1', file], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
}

async function runFullPipeline(env, db, jobId, familyId, { maxIterations = 200 } = {}) {
  await authorizeJobStep(env, { jobId });
  await captureSourceStep(env, { jobId, familyId });

  const bound = await captureActivityBoundStep(env, { jobId, familyId });
  if (!bound.done) {
    let cursor = null, pageIndex = 0;
    for (;;) {
      const page = await captureActivityPageStep(env, { jobId, familyId, pageIndex, lowerCursor: cursor });
      if (page.done) break;
      cursor = page.nextCursor;
      pageIndex += 1;
    }
  }

  const plan = await buildInventoryStep(env, { jobId, familyId });
  for (let i = 0; i < plan.shardCount; i++) await resolveInventoryShardStep(env, { jobId, familyId, shardIndex: i });
  await resolveKeepsakesStep(env, { jobId, familyId });

  await startMultipartStep(env, { jobId, familyId, family: { id: familyId, name: 'Test Family' }, requestedAs: 'owner' });
  for (let i = 0; i < maxIterations; i++) {
    const result = await packageStep(env, { jobId });
    if (result.done) break;
  }
  await completeMultipartStep(env, { jobId, familyId: 'fam_1' });
  const verify = await verifyArchiveStep(env, { jobId });
  await finalizeJobStep(env, { jobId, familyId, warningCount: verify.warningCount });
  return verify;
}

await atest('the full pipeline produces a valid, verifiable ZIP containing tree.json, activity-log.json, manifest.json, content-index.json, tree-data.js and every included photo', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const tree = {
    people: [
      { id: 'p1', display_name: 'James', photo: 'data:image/jpeg;base64,YWJj' },
      { id: 'p2', display_name: 'Megan' },
    ],
    relationships: [{ id: 'r1', from_person: 'p1', to_person: 'p2', type: 'partner' }],
  };
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify(tree)}', 1000)`);
  db.exec(`INSERT INTO activity_log (id, family_id, type, created_at) VALUES ('act_1', 'fam_1', 'person_added', '2026-01-01T00:00:00.000Z')`);

  const verify = await runFullPipeline(env, db, jobId, 'fam_1');
  assert.ok(verify.archiveSha256);
  assert.equal(verify.warningCount, 0);

  const archiveObj = await env.DOCS.get(`exports/${jobId}/bloodline-full-archive.zip`);
  const { dir, file } = toTempFile(new Uint8Array(await archiveObj.arrayBuffer()));
  const names = verifyWithUnzip(file);
  assert.deepEqual([...names].sort(), ['activity-log.json', 'content-index.json', 'manifest.json', 'photos/p1_James.jpg', 'tree-data.js', 'tree.json']);

  const job = db.prepare('SELECT * FROM family_export_job WHERE id = ?').get(jobId);
  assert.equal(job.status, 'ready');
  assert.ok(job.archive_bytes > 0);
  assert.ok(job.expires_at > job.completed_at);
  rmSync(dir, { recursive: true, force: true });
});

await atest('a missing R2 photo becomes a manifest warning, and the job finishes ready_with_warnings rather than failing', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const tree = {
    people: [{ id: 'p1', display_name: 'James', photo: '/api/photos/does-not-exist' }],
    relationships: [],
  };
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify(tree)}', 1000)`);

  const verify = await runFullPipeline(env, db, jobId, 'fam_1');
  assert.equal(verify.warningCount, 1);
  const job = db.prepare('SELECT * FROM family_export_job WHERE id = ?').get(jobId);
  assert.equal(job.status, 'ready_with_warnings');
});

await atest('packaging genuinely checkpoints across multiple small steps for a many-file tree, and the resulting archive is still valid', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const people = Array.from({ length: 120 }, (_, i) => ({ id: `p${i}`, display_name: `Person ${i}`, photo: 'data:image/jpeg;base64,YWJj' }));
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify({ people, relationships: [] })}', 1000)`);

  await authorizeJobStep(env, { jobId });
  await captureSourceStep(env, { jobId, familyId: 'fam_1' });
  await captureActivityBoundStep(env, { jobId, familyId: 'fam_1' });
  const plan = await buildInventoryStep(env, { jobId, familyId: 'fam_1' });
  for (let i = 0; i < plan.shardCount; i++) await resolveInventoryShardStep(env, { jobId, familyId: 'fam_1', shardIndex: i });
  await resolveKeepsakesStep(env, { jobId, familyId: 'fam_1' });
  await startMultipartStep(env, { jobId, familyId: 'fam_1', family: { id: 'fam_1', name: 'Test' }, requestedAs: 'owner' });

  let iterations = 0;
  for (;;) {
    const result = await packageStep(env, { jobId });
    iterations += 1;
    if (result.done) break;
    if (iterations > 500) throw new Error('packaging never completed — infinite loop guard tripped');
  }
  assert.ok(iterations > 1, 'a 120-entry archive with maxEntriesPerStep=100 default must take more than one packaging step');

  await completeMultipartStep(env, { jobId, familyId: 'fam_1' });
  const verify = await verifyArchiveStep(env, { jobId });
  const archiveObj = await env.DOCS.get(`exports/${jobId}/bloodline-full-archive.zip`);
  const { dir, file } = toTempFile(new Uint8Array(await archiveObj.arrayBuffer()));
  const names = verifyWithUnzip(file);
  assert.equal(names.filter((n) => n.startsWith('photos/')).length, 120);
  rmSync(dir, { recursive: true, force: true });
});

await atest('sendCompletionEmailStep is best-effort: a missing recipient is reported, not thrown', async () => {
  const { env } = makeEnv();
  const result = await sendCompletionEmailStep(env, { jobId: 'exp_x', toEmail: null, requestedAs: 'owner', appUrl: 'https://example.test' });
  assert.equal(result.sent, false);
});

await atest('cleanStagingStep deletes every staged object for the job and nothing outside its prefix', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  await env.DOCS.put(`export-staging/${jobId}/source/tree.json`, '{}');
  await env.DOCS.put(`export-staging/${jobId}/inventory/_plan.json`, '{}');
  await env.DOCS.put(`export-staging/other-job/source/tree.json`, '{}');

  const result = await cleanStagingStep(env, { jobId });
  assert.equal(result.deletedCount, 2);
  assert.equal(await env.DOCS.get(`export-staging/${jobId}/source/tree.json`), null);
  assert.notEqual(await env.DOCS.get(`export-staging/other-job/source/tree.json`), null);
});

// ── cancellation ─────────────────────────────────────────────────────────

await atest('isCancellationRequested reflects the job row status exactly', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  assert.equal(await isCancellationRequested(env, jobId), false);
  db.exec(`UPDATE family_export_job SET status = 'cancelling' WHERE id = '${jobId}'`);
  assert.equal(await isCancellationRequested(env, jobId), true);
});

await atest('handleCancellation aborts an in-progress multipart upload, cleans staging, and transitions to cancelled', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const tree = { people: [{ id: 'p1', display_name: 'James', photo: 'data:image/jpeg;base64,YWJj' }], relationships: [] };
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify(tree)}', 1000)`);

  await authorizeJobStep(env, { jobId });
  await captureSourceStep(env, { jobId, familyId: 'fam_1' });
  await captureActivityBoundStep(env, { jobId, familyId: 'fam_1' });
  const plan = await buildInventoryStep(env, { jobId, familyId: 'fam_1' });
  for (let i = 0; i < plan.shardCount; i++) await resolveInventoryShardStep(env, { jobId, familyId: 'fam_1', shardIndex: i });
  await resolveKeepsakesStep(env, { jobId, familyId: 'fam_1' });
  await startMultipartStep(env, { jobId, familyId: 'fam_1', family: { id: 'fam_1', name: 'Test' }, requestedAs: 'owner' });

  db.exec(`UPDATE family_export_job SET status = 'cancelling' WHERE id = '${jobId}'`);
  await handleCancellation(env, { jobId, familyId: 'fam_1' });

  const job = db.prepare('SELECT * FROM family_export_job WHERE id = ?').get(jobId);
  assert.equal(job.status, 'cancelled');
  assert.ok(job.cancelled_at > 0);
  assert.equal(env.DOCS.multipartUploads.size, 0, 'the multipart upload must have been aborted');
  const remainingStaging = [...env.DOCS.store.keys()].filter((k) => k.startsWith(`export-staging/${jobId}/`));
  assert.equal(remainingStaging.length, 0, 'staging must be fully cleaned on cancellation');
});

// ── §8 cleanup/reconciliation ────────────────────────────────────────────

await atest('expireReadyJobs expires a ready job past its 72h window, deletes the archive object, and audits once', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const now = Date.now();
  const nowSec = Math.floor(now / 1000);
  await env.DOCS.put(`exports/${jobId}/bloodline-full-archive.zip`, 'zip-bytes');
  db.exec(`UPDATE family_export_job SET status='ready', archive_r2_key='exports/${jobId}/bloodline-full-archive.zip', expires_at=${nowSec - 10} WHERE id='${jobId}'`);

  const result = await expireReadyJobs(env, { now });
  assert.equal(result.expiredCount, 1);
  const job = db.prepare('SELECT * FROM family_export_job WHERE id = ?').get(jobId);
  assert.equal(job.status, 'expired');
  assert.equal(await env.DOCS.get(`exports/${jobId}/bloodline-full-archive.zip`), null);
  const audit = db.prepare(`SELECT * FROM family_export_audit WHERE job_id = ? AND event = 'expired'`).all(jobId);
  assert.equal(audit.length, 1);
});

await atest('expireReadyJobs leaves a not-yet-expired ready job untouched', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const nowSec = Math.floor(Date.now() / 1000);
  db.exec(`UPDATE family_export_job SET status='ready', expires_at=${nowSec + 10000} WHERE id='${jobId}'`);
  const result = await expireReadyJobs(env, {});
  assert.equal(result.expiredCount, 0);
});

await atest('expireReadyJobs treats a missing archive object as idempotent success (§5)', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const nowSec = Math.floor(Date.now() / 1000);
  db.exec(`UPDATE family_export_job SET status='ready', archive_r2_key='exports/${jobId}/gone.zip', expires_at=${nowSec - 10} WHERE id='${jobId}'`);
  const result = await expireReadyJobs(env, {});
  assert.equal(result.expiredCount, 1);
});

await atest('reconcileStaleJobs fails a running job with no heartbeat for 30+ minutes as workflow_stalled', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const now = Date.now();
  const staleSec = Math.floor((now - 40 * 60 * 1000) / 1000);
  db.exec(`UPDATE family_export_job SET status='packaging', started_at=${staleSec}, last_heartbeat_at=${staleSec} WHERE id='${jobId}'`);

  const result = await reconcileStaleJobs(env, { now });
  assert.equal(result.reconciledCount, 1);
  const job = db.prepare('SELECT * FROM family_export_job WHERE id = ?').get(jobId);
  assert.equal(job.status, 'failed');
  assert.equal(job.error_code, 'workflow_stalled');
});

await atest('reconcileStaleJobs leaves a recently-active job alone', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const now = Date.now();
  const recentSec = Math.floor((now - 5 * 60 * 1000) / 1000);
  db.exec(`UPDATE family_export_job SET status='packaging', started_at=${recentSec}, last_heartbeat_at=${recentSec} WHERE id='${jobId}'`);
  const result = await reconcileStaleJobs(env, { now });
  assert.equal(result.reconciledCount, 0);
});

await atest('sweepOrphanStaging aborts an old orphaned multipart upload and deletes its staging', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const now = Date.now();
  const oldSec = Math.floor((now - 8 * 24 * 60 * 60 * 1000) / 1000);
  db.exec(`UPDATE family_export_job SET created_at=${oldSec} WHERE id='${jobId}'`);
  const upload = await env.DOCS.createMultipartUpload(`exports/${jobId}/bloodline-full-archive.zip`);
  await env.DOCS.put(`export-staging/${jobId}/checkpoint.json`, JSON.stringify({ uploadId: upload.uploadId, key: upload.key }));
  await env.DOCS.put(`export-staging/${jobId}/source/tree.json`, '{}');

  const result = await sweepOrphanStaging(env, { now });
  assert.equal(result.sweptCount, 1);
  assert.equal(env.DOCS.multipartUploads.size, 0);
  const remaining = [...env.DOCS.store.keys()].filter((k) => k.startsWith(`export-staging/${jobId}/`));
  assert.equal(remaining.length, 0);
});

await atest('sweepOrphanStaging never touches a recent job\'s staging', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  await env.DOCS.put(`export-staging/${jobId}/source/tree.json`, '{}');
  const result = await sweepOrphanStaging(env, {});
  assert.equal(result.sweptCount, 0);
  assert.notEqual(await env.DOCS.get(`export-staging/${jobId}/source/tree.json`), null);
});

await atest('runCleanupSweep runs all three passes and returns their combined counts', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const nowSec = Math.floor(Date.now() / 1000);
  db.exec(`UPDATE family_export_job SET status='ready', expires_at=${nowSec - 10} WHERE id='${jobId}'`);
  const result = await runCleanupSweep(env, {});
  assert.equal(result.expired.expiredCount, 1);
  assert.equal(result.reconciled.reconciledCount, 0);
  assert.equal(result.swept.sweptCount, 0);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import {
  authorizeJobStep, captureSourceStep, readCapturedTree,
  captureActivityBoundStep, captureActivityPageStep,
  buildInventoryStep, resolveInventoryShardStep, resolveKeepsakeShardStep,
  startMultipartStep, packageStep, completeMultipartStep, verifyArchiveStep,
  writeActivityLogStream,
  finalizeJobStep, sendCompletionEmailStep, cleanStagingStep,
  isCancellationRequested, handleCancellation,
  expireReadyJobs, reconcileStaleJobs, sweepOrphanStaging, runCleanupSweep,
  runExportWorkflowSteps,
  SourceCorruptError, SourceIncompleteError, ArchiveVerificationError,
} from '../src/workflowSteps.js';
import { createExportJobStatements } from '../../../functions/_lib/exportJob.js';
import { ActivityLogUnavailableError } from '../src/lib/activityLog.js';
import { BUDGETS } from '../src/lib/budgets.js';

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
    CREATE TABLE family (id TEXT PRIMARY KEY, name TEXT, created_at INTEGER);
    CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT);
    CREATE TABLE family_tree (family_id TEXT PRIMARY KEY, tree_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE activity_log (
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL, author_name TEXT, author_email TEXT,
      type TEXT NOT NULL, person_id TEXT, person_name TEXT, detail TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE family_member (
      family_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer',
      invited_by TEXT, joined_at INTEGER NOT NULL, PRIMARY KEY (family_id, user_id)
    );
    CREATE TABLE invite (
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL, from_user TEXT, target_person_id TEXT,
      email TEXT NOT NULL, token TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer',
      status TEXT NOT NULL DEFAULT 'pending', expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
  `);
  db.exec(readFileSync(MIGRATION_JOBS, 'utf8'));
  db.exec(`INSERT INTO family (id, name, created_at) VALUES ('fam_1', 'Test Family', 900)`);
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

  // Real R2 accepts a ReadableStream as a put() value and drains it fully
  // before resolving — workflowSteps.js's writeActivityLogStream relies on
  // exactly this (it streams shard-by-shard rather than building one big
  // in-memory string), so this fake must genuinely read the stream rather
  // than falling through to toBytes' `String(value)` (which would silently
  // store the literal text "[object ReadableStream]").
  async function toBytesAsync(value) {
    if (value instanceof ReadableStream) {
      const reader = value.getReader();
      const chunks = [];
      let total = 0;
      for (;;) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        chunks.push(bytes);
        total += bytes.byteLength;
      }
      const out = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
      return out;
    }
    return toBytes(value);
  }

  return {
    store,
    async put(key, value) {
      const bytes = await toBytesAsync(value);
      store.set(key, { bytes, etag: `"etag-${++etagCounter}"` });
    },
    // Real R2 supports a `{ range: { offset, length } | { suffix } }` option
    // on get() — verifyArchiveStep's bounded-range-read rewrite (a PR #9
    // review fix) depends on this fake genuinely slicing rather than always
    // returning the whole object, or its own tests would pass for the wrong
    // reason (reading everything and just pretending it was bounded).
    async get(key, opts) {
      const o = store.get(key);
      if (!o) return null;
      let bytes = o.bytes;
      if (opts?.range) {
        const { offset, length, suffix } = opts.range;
        if (suffix != null) bytes = o.bytes.subarray(Math.max(0, o.bytes.byteLength - suffix));
        else bytes = o.bytes.subarray(offset, offset + length);
      }
      return {
        text: async () => new TextDecoder().decode(bytes),
        json: async () => JSON.parse(new TextDecoder().decode(bytes)),
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        etag: o.etag,
      };
    },
    async head(key) {
      const o = store.get(key);
      if (!o) return null;
      return { size: o.bytes.byteLength, etag: o.etag, httpMetadata: { contentType: 'application/octet-stream' } };
    },
    // Genuinely cursor-paginated (like real R2) — a caller that ignores
    // `truncated`/`cursor` and only reads one page will get an incomplete
    // list against this fake too, the same way it silently would against
    // real R2 with more than one page of objects.
    async list({ prefix, limit = 1000, cursor }) {
      const all = [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([key, o]) => ({ key, size: o.bytes.byteLength, etag: o.etag }));
      const startIndex = cursor ? Number(cursor) : 0;
      const page = all.slice(startIndex, startIndex + limit);
      const truncated = startIndex + limit < all.length;
      return { objects: page, truncated, cursor: truncated ? String(startIndex + limit) : undefined };
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

// resolveKeepsakeShardStep is now itself a repeated, page-checkpointed
// step (one R2 list() page of one person's prefix per call) — this helper
// drives it to completion for callers that just need the shard fully
// resolved and don't care about the granular per-page checkpointing
// (tests exercising that mechanism directly call the step function in a
// loop themselves instead of using this).
async function resolveKeepsakeShard(env, { jobId, familyId, shardIndex }) {
  let result;
  do {
    result = await resolveKeepsakeShardStep(env, { jobId, familyId, shardIndex });
  } while (!result.done);
  return result;
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

await atest('a REAL R2-backed photo/document resolves as included — regression for the PR #9 review finding that the resolver invented a photos//documents/ prefix real uploads never use', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  await authorizeJobStep(env, { jobId });
  // functions/api/photos.js / documents.js both `env.DOCS.put(key, ...)`
  // with NO route prefix — the key itself (from uid('ph_')/uid('doc_')) is
  // the entire, flat storage key. Seeding the fake bucket exactly like a
  // real upload would, at that flat key, is the point of this test.
  await env.DOCS.put('ph_abc123.jpg', new Uint8Array([1, 2, 3, 4]));
  await env.DOCS.put('doc_xyz789.pdf', new Uint8Array([5, 6, 7]));
  const tree = {
    people: [{ id: 'p1', display_name: 'James', photo: '/api/photos/ph_abc123.jpg' }],
    relationships: [],
    documents: [{ id: 'd1', title: 'Birth Certificate', person_id: 'p1', src: '/api/documents/doc_xyz789.pdf' }],
  };
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify(tree)}', 1000)`);
  await captureSourceStep(env, { jobId, familyId: 'fam_1' });
  await buildInventoryStep(env, { jobId, familyId: 'fam_1' });
  const resolved = await resolveInventoryShardStep(env, { jobId, familyId: 'fam_1', shardIndex: 0 });
  assert.equal(resolved.warningCount, 0, 'a real R2-backed photo/document at its actual flat key must resolve as included, not missing');

  const stored = await env.DOCS.get(`export-staging/${jobId}/inventory/resolved-0.json`);
  const entries = JSON.parse(await stored.text());
  assert.ok(entries.every((e) => e.status === 'included'), JSON.stringify(entries.map((e) => ({ id: e.id, status: e.status }))));
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

await atest('resolveKeepsakeShardStep lists only the exact family/person prefix, never the flat bucket', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const tree = { people: [{ id: 'p1', display_name: 'James' }], relationships: [] };
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify(tree)}', 1000)`);
  await captureSourceStep(env, { jobId, familyId: 'fam_1' });

  await env.DOCS.put('keepsake/fam_1/p1/latest.json', JSON.stringify({ narrative: null }));
  await env.DOCS.put('keepsake/fam_OTHER/p9/latest.json', JSON.stringify({ narrative: null })); // must never be listed

  const plan = await buildInventoryStep(env, { jobId, familyId: 'fam_1' });
  assert.equal(plan.keepsakeShardCount, 1, 'one person fits in a single shard');
  const result = await resolveKeepsakeShardStep(env, { jobId, familyId: 'fam_1', shardIndex: 0 });
  assert.equal(result.keepsakeEntryCount, 1);
  assert.equal(result.done, true, 'a single object with no pagination needed must resolve in one call');
});

await atest('resolveKeepsakeShardStep checkpoints across MULTIPLE calls when a person has more Keepsakes than fit in one R2 list() page — the PR #9 re-review pagination finding', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const tree = { people: [{ id: 'p1', display_name: 'James' }], relationships: [] };
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify(tree)}', 1000)`);
  await captureSourceStep(env, { jobId, familyId: 'fam_1' });

  // 5 real retained editions for one person — enough to force multiple
  // pages once list() is artificially limited to 2 per call below (real
  // R2 caps a single list() response at 1,000 objects, which this
  // transparently simulates without needing 1,000+ real test objects).
  for (let i = 0; i < 5; i++) {
    await env.DOCS.put(`keepsake/fam_1/p1/edition-${i}.json`, JSON.stringify({ narrative: null, editionNumber: i }));
  }
  const realList = env.DOCS.list.bind(env.DOCS);
  env.DOCS.list = (opts) => realList({ ...opts, limit: 2 });

  await buildInventoryStep(env, { jobId, familyId: 'fam_1' });

  // Each call now resolves exactly ONE page — with 5 objects at a 2-per-
  // page limit, that's 3 calls (2 + 2 + 1), the first two explicitly NOT
  // done yet (proving the checkpoint boundary is real, not just an
  // internal detail the caller never observes).
  const first = await resolveKeepsakeShardStep(env, { jobId, familyId: 'fam_1', shardIndex: 0 });
  assert.equal(first.done, false, 'the first page alone must not resolve the whole person');
  const second = await resolveKeepsakeShardStep(env, { jobId, familyId: 'fam_1', shardIndex: 0 });
  assert.equal(second.done, false);
  const third = await resolveKeepsakeShardStep(env, { jobId, familyId: 'fam_1', shardIndex: 0 });
  assert.equal(third.done, true, 'the third call exhausts the listing and finalizes this person');
  assert.equal(third.keepsakeEntryCount, 5, 'every edition must be found across multiple list() pages, not just the first');
});

await atest('a person with THOUSANDS of retained editions spanning MULTIPLE full 1,000-object R2 list() pages is resolved across many small checkpointed calls, fetching a body for AT MOST ONE edition — the PR #9 4th-review finding that person-level sharding alone did not bound a single person\'s own prefix', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const tree = { people: [{ id: 'p1', display_name: 'James' }], relationships: [] };
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify(tree)}', 1000)`);
  await captureSourceStep(env, { jobId, familyId: 'fam_1' });

  // 2,500 real retained editions for ONE person, plus a standalone
  // latest.json matching none of them — enough to span THREE full
  // 1,000-object R2 list() pages at the fake's real (unshrunk) default
  // page size, the exact "not representative" gap the reviewer called
  // out in the earlier 40-object/single-page test this replaces.
  const EDITION_COUNT = 2500;
  for (let i = 0; i < EDITION_COUNT; i++) {
    await env.DOCS.put(`keepsake/fam_1/p1/edition-${String(i).padStart(4, '0')}.json`, JSON.stringify({ narrative: null, editionNumber: i }));
  }
  await env.DOCS.put('keepsake/fam_1/p1/latest.json', JSON.stringify({ narrative: null, editionNumber: 'current' }));

  let listCalls = 0;
  const realList = env.DOCS.list.bind(env.DOCS);
  env.DOCS.list = (opts) => { listCalls += 1; return realList(opts); };

  let bodyGets = 0;
  const realGet = env.DOCS.get.bind(env.DOCS);
  env.DOCS.get = async (key, opts) => {
    if (key.startsWith('keepsake/')) bodyGets += 1;
    return realGet(key, opts);
  };

  await buildInventoryStep(env, { jobId, familyId: 'fam_1' });

  let stepCalls = 0;
  let result;
  do {
    result = await resolveKeepsakeShardStep(env, { jobId, familyId: 'fam_1', shardIndex: 0 });
    stepCalls += 1;
  } while (!result.done);

  assert.equal(result.keepsakeEntryCount, EDITION_COUNT + 1, 'every hashed edition PLUS the standalone latest.json entry must be resolved');
  assert.ok(listCalls >= 3, `must have paged through at least 3 full list() calls (2,501 objects / 1,000 per page), saw ${listCalls}`);
  assert.ok(stepCalls >= 3, `must have taken at least 3 separate checkpointed step invocations to resolve this one person, saw ${stepCalls} — proving no single call ever held the whole prefix`);
  assert.equal(bodyGets, 1, 'exactly ONE body must ever be fetched (the standalone latest.json, since it matches no hashed edition here) — never one per historical edition, no matter how many exist');
});

await atest('writeActivityLogStream produces a byte-valid JSON array spanning multiple shards, in order, without ever parsing a row — the PR #9 review finding about full-history in-memory materialization', async () => {
  const { env } = makeEnv();
  const jobId = 'exp_activity_stream_test';
  // Three shards, mirroring how captureActivityPageStep actually names them
  // (zero-padded, one ndjson row per line) — deliberately more than one
  // shard so the streaming reconstruction has to cross a shard boundary,
  // not just read a single file.
  await env.DOCS.put(`export-staging/${jobId}/activity/00000.ndjson`, [
    JSON.stringify({ id: 'a1', type: 'person_added', created_at: '2026-01-01T00:00:00.000Z' }),
    JSON.stringify({ id: 'a2', type: 'person_added', created_at: '2026-01-02T00:00:00.000Z' }),
  ].join('\n'));
  await env.DOCS.put(`export-staging/${jobId}/activity/00001.ndjson`, [
    JSON.stringify({ id: 'a3', type: 'photo_added', created_at: '2026-01-03T00:00:00.000Z' }),
  ].join('\n'));
  // No 00002.ndjson — the function must stop cleanly, not error, on the
  // first missing shard.

  const key = `export-staging/${jobId}/derived/activity-log.json`;
  const byteLength = await writeActivityLogStream(env, jobId, key);

  const written = await env.DOCS.get(key);
  const text = await written.text();
  const parsed = JSON.parse(text); // must be valid JSON — proves the raw-text concatenation produced a well-formed array
  assert.deepEqual(parsed.map((r) => r.id), ['a1', 'a2', 'a3'], 'rows must appear in shard/line order across the shard boundary');
  assert.equal(byteLength, new TextEncoder().encode(text).byteLength, 'the returned byte count must match what was actually written');
});

await atest('writeActivityLogStream produces a valid empty array when there are no activity shards at all', async () => {
  const { env } = makeEnv();
  const jobId = 'exp_activity_stream_empty';
  const key = `export-staging/${jobId}/derived/activity-log.json`;
  const byteLength = await writeActivityLogStream(env, jobId, key);
  const written = await env.DOCS.get(key);
  assert.equal(await written.text(), '[]');
  assert.equal(byteLength, 2);
});

// ── full pipeline: authorize -> ... -> clean-staging, verified with unzip ──

const { execFileSync } = await import('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const path = await import('node:path');
const { fileURLToPath } = await import('node:url');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
function extractFromZip(file, entryPath) {
  return execFileSync('unzip', ['-p', file, entryPath], { encoding: 'utf8' });
}

async function runFullPipeline(env, db, jobId, familyId, { maxIterations = 200 } = {}) {
  const authorized = await authorizeJobStep(env, { jobId });
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
  for (let i = 0; i < plan.keepsakeShardCount; i++) await resolveKeepsakeShard(env, { jobId, familyId, shardIndex: i });

  await startMultipartStep(env, { jobId, familyId, family: authorized.family, requestedAs: authorized.requestedAs });
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
  // The PR #9 review's exact P0 finding: the archive plan only ever
  // included 5 fixed JSON files at the archive ROOT — none of the
  // promised viewer bundle, family.json, or reports/ ever actually shipped
  // in a real export, and tree.json/activity-log.json/content-index.json/
  // tree-data.js lived at the wrong path (root, not data/) relative to
  // docs/FULL-ARCHIVE-EXPORT.md §3.2's own directory layout.
  assert.deepEqual([...names].sort(), [
    'README.txt',
    'START-HERE.html',
    'data/activity-log.json',
    'data/content-index.json',
    'data/family.json',
    'data/tree-data.js',
    'data/tree.json',
    'manifest.json',
    'photos/p1_James.jpg',
    'reports/integrity-report.html',
    'reports/missing-files.txt',
    'viewer/app.js',
    'viewer/fonts/fraunces-latin-400.woff2',
    'viewer/fonts/fraunces-latin-600.woff2',
    'viewer/fonts/hanken-grotesk-latin-400.woff2',
    'viewer/fonts/hanken-grotesk-latin-600.woff2',
    'viewer/licenses/Fraunces-OFL.txt',
    'viewer/licenses/Hanken-Grotesk-OFL.txt',
    'viewer/logo.svg',
    'viewer/styles.css',
  ]);

  // PR #9 review finding: manifest.json was built with a hardcoded
  // `status: 'packaging'` baked in forever, and `files` was reduced to a
  // near-useless {path, id, status} triple. The manifest ACTUALLY inside
  // the finished archive must reflect the real outcome and carry the real,
  // already-computed per-entry metadata.
  const packagedManifest = JSON.parse(extractFromZip(file, 'manifest.json'));
  assert.equal(packagedManifest.status, 'ready', 'the manifest baked into a warning-free archive must say ready, not packaging');
  const photoEntry = packagedManifest.files.find((f) => f.path === 'photos/p1_James.jpg');
  assert.ok(photoEntry, 'the manifest files list must include the media entry');
  assert.equal(photoEntry.mimeType, 'image/jpeg');
  assert.ok(photoEntry.sha256, 'an embedded data_url photo has a real sha256 available at inventory time and it must survive into the manifest');
  assert.ok('originalReference' in photoEntry, '§3.6 requires "original reference" on every archived binary — a PR #9 re-review finding that this was wrongly dropped');
  assert.ok(!('r2Key' in photoEntry), 'the raw internal R2 storage key must never leak into the manifest, even though etag/originalReference now do per §3.6');

  // The other half of the PR #9 P0 finding: the offline viewer bundle,
  // family.json, and the reports/ folder must genuinely be inside the real
  // packaged archive — not just present in the plan but actually resolvable
  // bytes, byte-identical to the real static source files.
  const realAppJs = readFileSync(path.join(__dirname, '../src/viewer/app.js'), 'utf8');
  assert.equal(extractFromZip(file, 'viewer/app.js'), realAppJs, 'viewer/app.js inside the archive must be byte-identical to the real source file');
  const realStartHere = readFileSync(path.join(__dirname, '../src/START-HERE.html'), 'utf8');
  assert.equal(extractFromZip(file, 'START-HERE.html'), realStartHere);

  const familyRecord = JSON.parse(extractFromZip(file, 'data/family.json'));
  assert.equal(familyRecord.familyId, 'fam_1');
  assert.equal(familyRecord.requestedAs, 'owner');
  assert.equal(familyRecord.familyName, 'Test Family');

  const missingFilesText = extractFromZip(file, 'reports/missing-files.txt');
  assert.match(missingFilesText, /No missing, unreadable, or unsupported files/);
  const integrityHtml = extractFromZip(file, 'reports/integrity-report.html');
  assert.match(integrityHtml, /Archive integrity report/);

  // A regular owner export must NEVER include administration/ (§3.4).
  assert.throws(() => extractFromZip(file, 'data/administration/members.json'));

  const job = db.prepare('SELECT * FROM family_export_job WHERE id = ?').get(jobId);
  assert.equal(job.status, 'ready');
  assert.ok(job.archive_bytes > 0);
  assert.ok(job.expires_at > job.completed_at);
  // PR #9 review finding: nothing ever wrote last_heartbeat_at/processed_bytes,
  // so a healthy in-progress export was indistinguishable from a stalled one,
  // and progress.processedBytes always showed 0 no matter how far along a job
  // actually was. processed_bytes is written from the ZipStreamWriter's own
  // cumulative offset (see packageStep's comment), so by the time the archive
  // is complete it must equal the real final archive size exactly.
  assert.ok(job.last_heartbeat_at > 0, 'last_heartbeat_at must have been recorded during the pipeline');
  assert.equal(job.processed_bytes, job.archive_bytes, 'processed_bytes must track the real bytes written, matching the final archive size');
  rmSync(dir, { recursive: true, force: true });
});

await atest('the manifest packaged INSIDE the archive carries a real, ledger-backed sha256 for an R2-backed photo — the PR #9 re-review finding that only embedded data_url media ever got one', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const photoBytes = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
  await env.DOCS.put('ph_real123.jpg', photoBytes);
  const tree = {
    people: [{ id: 'p1', display_name: 'James', photo: '/api/photos/ph_real123.jpg' }],
    relationships: [],
  };
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify(tree)}', 1000)`);

  const verify = await runFullPipeline(env, db, jobId, 'fam_1');
  assert.equal(verify.warningCount, 0);

  const archiveObj = await env.DOCS.get(`exports/${jobId}/bloodline-full-archive.zip`);
  const { dir, file } = toTempFile(new Uint8Array(await archiveObj.arrayBuffer()));
  const packagedManifest = JSON.parse(extractFromZip(file, 'manifest.json'));
  const photoEntry = packagedManifest.files.find((f) => f.recordType === 'photo' || f.path.startsWith('photos/'));
  assert.ok(photoEntry, 'the manifest must list the R2-backed photo');
  const expectedSha256 = createHash('sha256').update(photoBytes).digest('hex');
  assert.equal(photoEntry.sha256, expectedSha256, 'the manifest baked into the archive must carry the REAL sha256 of the actual archived bytes, not be silently absent for an R2-backed entry');
  assert.equal(photoEntry.etag, '"etag-1"', 'the R2 ETag must also survive into the manifest per §3.6');

  // Also prove the packaged manifest.json's OWN checksum (recorded in D1)
  // matches what's actually inside the archive, not the pre-final "base"
  // version — the whole point of finalizing it last.
  const job = db.prepare('SELECT * FROM family_export_job WHERE id = ?').get(jobId);
  const { computeManifestChecksum } = await import('../src/lib/manifest.js');
  assert.equal(job.manifest_sha256, computeManifestChecksum(packagedManifest), 'the recorded manifest_sha256 must match the manifest genuinely packaged inside the archive');
  rmSync(dir, { recursive: true, force: true });
});

await atest('the packaged manifest.files carries a real ledger-backed entry for EVERY archived file, not just media/Keepsakes, and integrity-report.html displays the SAME final checksum D1 recorded — the PR #9 3rd-review finding', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const tree = { people: [{ id: 'p1', display_name: 'James' }], relationships: [] };
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify(tree)}', 1000)`);

  const verify = await runFullPipeline(env, db, jobId, 'fam_1');
  assert.equal(verify.warningCount, 0);

  const archiveObj = await env.DOCS.get(`exports/${jobId}/bloodline-full-archive.zip`);
  const { dir, file } = toTempFile(new Uint8Array(await archiveObj.arrayBuffer()));
  const packagedManifest = JSON.parse(extractFromZip(file, 'manifest.json'));
  const filesByPath = new Map(packagedManifest.files.map((f) => [f.path, f]));

  // Before this fix, manifest.files was only ever populated from media/
  // Keepsake inventory entries — a fixed archive file like tree.json had
  // NO entry in the shipped manifest at all, even though it's a real file
  // sitting right there in the ZIP with a real, ledger-computed hash.
  const treeBytes = new TextEncoder().encode(JSON.stringify(tree));
  const expectedTreeSha256 = createHash('sha256').update(treeBytes).digest('hex');
  for (const [path, expectedSha256] of [
    ['data/tree.json', expectedTreeSha256],
    ['data/activity-log.json', null], // content varies; just prove the entry exists with a real hash
    ['data/content-index.json', null],
    ['data/tree-data.js', null],
    ['data/family.json', null],
    ['reports/missing-files.txt', null],
    ['viewer/app.js', null],
    ['README.txt', null],
  ]) {
    const entry = filesByPath.get(path);
    assert.ok(entry, `manifest.files must include a record for "${path}"`);
    assert.ok(entry.sha256, `"${path}"'s manifest record must carry a real sha256`);
    assert.ok(entry.byteLength > 0, `"${path}"'s manifest record must carry a real byteLength`);
    if (expectedSha256) assert.equal(entry.sha256, expectedSha256, `"${path}"'s sha256 must be the real hash of its actual archived bytes`);
  }

  // manifest.json cannot describe its own bytes (unavoidable self-
  // reference), and reports/integrity-report.html is deliberately packaged
  // one entry AFTER manifest.json specifically so it can describe the real
  // final manifest — so neither appears inside manifest.files itself.
  assert.equal(filesByPath.has('manifest.json'), false);
  assert.equal(filesByPath.has('reports/integrity-report.html'), false);

  // The archived report must be the FINAL one — generated from this exact
  // packaged manifest, not the stale pre-packaging "base" version — so its
  // displayed checksum matches both the manifest actually shipped AND the
  // checksum D1 recorded for this job.
  const { computeManifestChecksum } = await import('../src/lib/manifest.js');
  const finalChecksum = computeManifestChecksum(packagedManifest);
  const job = db.prepare('SELECT * FROM family_export_job WHERE id = ?').get(jobId);
  assert.equal(job.manifest_sha256, finalChecksum);

  const integrityHtml = extractFromZip(file, 'reports/integrity-report.html');
  assert.match(integrityHtml, new RegExp(finalChecksum), 'the packaged integrity report must display the SAME final checksum as the manifest actually shipped and the one D1 recorded — not a stale pre-packaging checksum');
  assert.match(integrityHtml, new RegExp(`Entries: ${packagedManifest.files.length}`), 'the report\'s displayed entry count must reflect the real final files list, not the incomplete pre-packaging one');

  rmSync(dir, { recursive: true, force: true });
});

await atest('a family with more people than fit in one Keepsake shard is resolved across MULTIPLE checkpointed shard steps, each retaining only its own shard in memory — the PR #9 3rd-review finding that the whole family was materialized in one non-checkpointed step', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  // 25 people, each with a real retained Keepsake edition — enough to span
  // 3 shards at the 10-people-per-shard default (buildInventoryStep's
  // KEEPSAKE_PEOPLE_PER_SHARD), the exact scenario the reviewer asked to
  // be tested: multiple full shards, not one small fake.
  const PEOPLE_COUNT = 25;
  const people = Array.from({ length: PEOPLE_COUNT }, (_, i) => ({ id: `p${i}`, display_name: `Person ${i}` }));
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify({ people, relationships: [] })}', 1000)`);
  await captureSourceStep(env, { jobId, familyId: 'fam_1' });
  for (let i = 0; i < PEOPLE_COUNT; i++) {
    await env.DOCS.put(`keepsake/fam_1/p${i}/latest.json`, JSON.stringify({ narrative: null, personId: `p${i}` }));
  }

  const plan = await buildInventoryStep(env, { jobId, familyId: 'fam_1' });
  assert.equal(plan.keepsakeShardCount, 3, '25 people at 10/shard must produce exactly 3 shards (10, 10, 5)');
  assert.equal(plan.keepsakePersonCount, PEOPLE_COUNT);

  let totalEntries = 0;
  const seenPersonIds = new Set();
  for (let i = 0; i < plan.keepsakeShardCount; i++) {
    const result = await resolveKeepsakeShard(env, { jobId, familyId: 'fam_1', shardIndex: i });
    totalEntries += result.keepsakeEntryCount;
    const shard = JSON.parse(await (await env.DOCS.get(`export-staging/${jobId}/inventory/keepsakes-${i}.json`)).text());
    // Each shard's own staged result must be small (its own people only),
    // proving the whole family was never accumulated as one in-memory
    // batch — the exact P1 finding this fix addresses.
    assert.ok(shard.entries.length <= 10, `shard ${i} must only contain its own (≤10) people's entries, saw ${shard.entries.length}`);
    for (const e of shard.entries) seenPersonIds.add(e.ownerId);
  }
  assert.equal(totalEntries, PEOPLE_COUNT, 'every person across every shard must be resolved, none dropped, none duplicated');
  assert.equal(seenPersonIds.size, PEOPLE_COUNT, 'every distinct person must appear in exactly one shard');

  // And the aggregated result actually reaches the packaged archive —
  // proving the sharded resolution is correctly stitched back together by
  // startMultipartStep/buildByPathIndex, not just correct in isolation.
  await startMultipartStep(env, { jobId, familyId: 'fam_1', family: { id: 'fam_1', name: 'Test' }, requestedAs: 'owner' });
  for (;;) { const r = await packageStep(env, { jobId }); if (r.done) break; }
  await completeMultipartStep(env, { jobId, familyId: 'fam_1' });
  const verify = await verifyArchiveStep(env, { jobId });
  assert.equal(verify.warningCount, 0);
  const archiveObj = await env.DOCS.get(`exports/${jobId}/bloodline-full-archive.zip`);
  const { dir, file } = toTempFile(new Uint8Array(await archiveObj.arrayBuffer()));
  const names = verifyWithUnzip(file);
  assert.equal(names.filter((n) => n.startsWith('keepsakes/')).length, PEOPLE_COUNT, 'every shard\'s Keepsake editions must end up in the final archive');
  rmSync(dir, { recursive: true, force: true });
});

await atest('administration/ files (members.json, invitations.json) appear ONLY for a site_admin export, never for owner/coadmin, per §3.4', async () => {
  const { db, env } = makeEnv();
  db.exec(`INSERT INTO user (id, email) VALUES ('user_2', 'member2@test.example')`);
  db.exec(`INSERT INTO family_member (family_id, user_id, role, invited_by, joined_at) VALUES ('fam_1', 'user_1', 'owner', NULL, 1000), ('fam_1', 'user_2', 'viewer', 'user_1', 2000)`);
  db.exec(`INSERT INTO invite (id, family_id, from_user, email, token, role, status, expires_at, created_at) VALUES ('inv_1', 'fam_1', 'user_1', 'pending@test.example', 'secret-token-xyz', 'contributor', 'pending', 9999, 3000)`);
  const tree = { people: [{ id: 'p1', display_name: 'James' }], relationships: [] };
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify(tree)}', 1000)`);

  const { jobId: adminJobId, statements } = createExportJobStatements(env, { familyId: 'fam_1', requestedByUserId: 'user_1', requestedAs: 'site_admin' });
  await env.DB.batch(statements);
  const verify = await runFullPipeline(env, db, adminJobId, 'fam_1');
  assert.equal(verify.warningCount, 0);

  const archiveObj = await env.DOCS.get(`exports/${adminJobId}/bloodline-full-archive.zip`);
  const { dir, file } = toTempFile(new Uint8Array(await archiveObj.arrayBuffer()));

  const members = JSON.parse(extractFromZip(file, 'data/administration/members.json'));
  assert.equal(members.length, 2);
  assert.deepEqual(members.map((m) => m.userId).sort(), ['user_1', 'user_2']);
  const member2 = members.find((m) => m.userId === 'user_2');
  assert.equal(member2.email, 'member2@test.example');
  assert.equal(member2.role, 'viewer');
  assert.equal(member2.invitedBy, 'user_1');

  const invitations = JSON.parse(extractFromZip(file, 'data/administration/invitations.json'));
  assert.equal(invitations.length, 1);
  assert.equal(invitations[0].email, 'pending@test.example');
  assert.ok(!('token' in invitations[0]), 'the raw invite token must never appear inside an exported archive');
  rmSync(dir, { recursive: true, force: true });

  // A plain owner export of the SAME family must not carry administration/ at all.
  db.exec(`INSERT INTO family (id, name, created_at) VALUES ('fam_2', 'Other Family', 900)`);
  const ownerJobId = await seedQueuedJob(env, db, { familyId: 'fam_2' });
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_2', '${JSON.stringify(tree)}', 1000)`);
  await runFullPipeline(env, db, ownerJobId, 'fam_2');
  const ownerArchiveObj = await env.DOCS.get(`exports/${ownerJobId}/bloodline-full-archive.zip`);
  const { dir: dir2, file: file2 } = toTempFile(new Uint8Array(await ownerArchiveObj.arrayBuffer()));
  assert.throws(() => extractFromZip(file2, 'data/administration/members.json'));
  rmSync(dir2, { recursive: true, force: true });
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

  const archiveObj = await env.DOCS.get(`exports/${jobId}/bloodline-full-archive.zip`);
  const { dir, file } = toTempFile(new Uint8Array(await archiveObj.arrayBuffer()));
  const packagedManifest = JSON.parse(extractFromZip(file, 'manifest.json'));
  assert.equal(packagedManifest.status, 'ready_with_warnings', 'the manifest baked into the archive must reflect the real warned outcome, not a stale "packaging" placeholder');
  rmSync(dir, { recursive: true, force: true });
});

await atest('packaging genuinely checkpoints across multiple small steps for a many-file tree, and the resulting archive is still valid', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  // p0/p1 are real R2-backed photos (sorting first among 'photos/...'
  // paths, so they're packaged in an EARLY checkpoint — proving their
  // ledger records survive being resumed across checkpoints all the way
  // to the manifest finalization at the very end, not just the
  // same-call case a smaller, single-checkpoint test already covers).
  const r2PhotoBytes = { p0: new Uint8Array([1, 1, 2, 3]), p1: new Uint8Array([5, 8, 13, 21]) };
  await env.DOCS.put('ph_p0.jpg', r2PhotoBytes.p0);
  await env.DOCS.put('ph_p1.jpg', r2PhotoBytes.p1);
  const people = [
    { id: 'p0', display_name: 'Person 0', photo: '/api/photos/ph_p0.jpg' },
    { id: 'p1', display_name: 'Person 1', photo: '/api/photos/ph_p1.jpg' },
    ...Array.from({ length: 118 }, (_, i) => ({ id: `p${i + 2}`, display_name: `Person ${i + 2}`, photo: 'data:image/jpeg;base64,YWJj' })),
  ];
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify({ people, relationships: [] })}', 1000)`);

  await authorizeJobStep(env, { jobId });
  await captureSourceStep(env, { jobId, familyId: 'fam_1' });
  await captureActivityBoundStep(env, { jobId, familyId: 'fam_1' });
  const plan = await buildInventoryStep(env, { jobId, familyId: 'fam_1' });
  for (let i = 0; i < plan.shardCount; i++) await resolveInventoryShardStep(env, { jobId, familyId: 'fam_1', shardIndex: i });
  for (let i = 0; i < plan.keepsakeShardCount; i++) await resolveKeepsakeShard(env, { jobId, familyId: 'fam_1', shardIndex: i });
  await startMultipartStep(env, { jobId, familyId: 'fam_1', family: { id: 'fam_1', name: 'Test' }, requestedAs: 'owner' });

  let iterations = 0;
  let lastProcessedBytes = -1;
  const processedBytesSamples = [];
  for (;;) {
    const result = await packageStep(env, { jobId });
    iterations += 1;
    // Each checkpoint must move processed_bytes strictly forward on the job
    // row itself (not just in the step's own return value) — proving
    // progress is genuinely visible mid-export, not only once the whole
    // thing finishes (the PR #9 review's exact complaint).
    const job = db.prepare('SELECT processed_bytes FROM family_export_job WHERE id = ?').get(jobId);
    assert.ok(job.processed_bytes > lastProcessedBytes, 'processed_bytes must advance on every packaging checkpoint');
    processedBytesSamples.push(job.processed_bytes);
    lastProcessedBytes = job.processed_bytes;
    if (result.done) break;
    if (iterations > 500) throw new Error('packaging never completed — infinite loop guard tripped');
  }
  assert.ok(iterations > 1, 'a 120-entry archive with maxEntriesPerStep=100 default must take more than one packaging step');
  assert.ok(processedBytesSamples.length > 1 && processedBytesSamples[0] > 0, 'progress must be visible before the final checkpoint, not just at completion');

  await completeMultipartStep(env, { jobId, familyId: 'fam_1' });
  const verify = await verifyArchiveStep(env, { jobId });
  const archiveObj = await env.DOCS.get(`exports/${jobId}/bloodline-full-archive.zip`);
  const { dir, file } = toTempFile(new Uint8Array(await archiveObj.arrayBuffer()));
  const names = verifyWithUnzip(file);
  assert.equal(names.filter((n) => n.startsWith('photos/')).length, 120);

  // The R2-backed photos packaged in an EARLY checkpoint must still have
  // their real sha256 in the manifest FINALIZED at the very end — proving
  // the ledger genuinely survives being resumed across checkpoints all
  // the way through to manifest finalization, not just within one call.
  const packagedManifest = JSON.parse(extractFromZip(file, 'manifest.json'));
  for (const [personId, bytes] of Object.entries(r2PhotoBytes)) {
    const entry = packagedManifest.files.find((f) => f.id === personId);
    assert.ok(entry, `manifest must list ${personId}'s photo`);
    assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'), `${personId}'s photo sha256 must survive across a checkpoint boundary into the finalized manifest`);
  }
  rmSync(dir, { recursive: true, force: true });
});

await atest('verifyArchiveStep catches a genuine packaging-ledger mismatch (wrong byte count) — the PR #9 review\'s "validate manifest/file counts and checksums from the packaging ledger" requirement', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const tree = { people: [{ id: 'p1', display_name: 'James' }], relationships: [] };
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify(tree)}', 1000)`);

  await authorizeJobStep(env, { jobId });
  await captureSourceStep(env, { jobId, familyId: 'fam_1' });
  await captureActivityBoundStep(env, { jobId, familyId: 'fam_1' });
  const plan = await buildInventoryStep(env, { jobId, familyId: 'fam_1' });
  for (let i = 0; i < plan.shardCount; i++) await resolveInventoryShardStep(env, { jobId, familyId: 'fam_1', shardIndex: i });
  for (let i = 0; i < plan.keepsakeShardCount; i++) await resolveKeepsakeShard(env, { jobId, familyId: 'fam_1', shardIndex: i });
  await startMultipartStep(env, { jobId, familyId: 'fam_1', family: { id: 'fam_1', name: 'Test' }, requestedAs: 'owner' });
  for (;;) { const r = await packageStep(env, { jobId }); if (r.done) break; }
  await completeMultipartStep(env, { jobId, familyId: 'fam_1' });

  // Tamper with the checkpoint's own ledger the same way a real bug (or
  // real mid-flight corruption) would show up: one entry's recorded
  // byteLength no longer matches what the archive plan expected.
  const checkpointKey = `export-staging/${jobId}/checkpoint.json`;
  const checkpoint = JSON.parse(await (await env.DOCS.get(checkpointKey)).text());
  checkpoint.ledger = checkpoint.ledger.map((r, i) => (i === 0 ? { ...r, byteLength: r.byteLength + 999 } : r));
  await env.DOCS.put(checkpointKey, JSON.stringify(checkpoint));

  await assert.rejects(() => verifyArchiveStep(env, { jobId }), (e) => e.name === 'ArchiveVerificationError');
});

await atest('verifyArchiveStep never fetches the whole final archive object in one go — every single read against it is a bounded range read', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const people = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, display_name: `Person ${i}`, photo: 'data:image/jpeg;base64,YWJjZGVmZ2hpams=' }));
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify({ people, relationships: [] })}', 1000)`);

  await authorizeJobStep(env, { jobId });
  await captureSourceStep(env, { jobId, familyId: 'fam_1' });
  await captureActivityBoundStep(env, { jobId, familyId: 'fam_1' });
  const plan = await buildInventoryStep(env, { jobId, familyId: 'fam_1' });
  for (let i = 0; i < plan.shardCount; i++) await resolveInventoryShardStep(env, { jobId, familyId: 'fam_1', shardIndex: i });
  for (let i = 0; i < plan.keepsakeShardCount; i++) await resolveKeepsakeShard(env, { jobId, familyId: 'fam_1', shardIndex: i });
  await startMultipartStep(env, { jobId, familyId: 'fam_1', family: { id: 'fam_1', name: 'Test' }, requestedAs: 'owner' });
  for (;;) { const r = await packageStep(env, { jobId }); if (r.done) break; }
  await completeMultipartStep(env, { jobId, familyId: 'fam_1' });

  const finalKey = `exports/${jobId}/bloodline-full-archive.zip`;
  const realGet = env.DOCS.get.bind(env.DOCS);
  const reads = [];
  env.DOCS.get = async (key, opts) => {
    if (key === finalKey) reads.push(opts?.range ?? null);
    return realGet(key, opts);
  };

  await verifyArchiveStep(env, { jobId });

  assert.ok(reads.length > 1, 'verify must genuinely split its reads (tail window + central directory + hash pass), not fetch the archive in one shot');
  assert.ok(reads.every((r) => r !== null), 'every single read against the final archive must be a bounded range read (offset/length or suffix), never a bare whole-object get()');
});

// ── runExportWorkflowSteps: the full orchestration + top-level failure handling ──

// A minimal step.do fake: real Cloudflare Workflows retries a step
// internally on transient failure, but for proving runExportWorkflowSteps'
// OWN orchestration/error-handling logic, one straight pass-through
// (matching how every individual-step test above already calls step
// functions directly) is exactly what's needed — it still genuinely runs
// every step function for real, against the real fakes.
const fakeStep = { async do(name, fn) { return fn(); } };

await atest('runExportWorkflowSteps runs the full pipeline end-to-end through the SAME orchestration workflow.js uses, producing a ready job', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const tree = {
    people: [{ id: 'p1', display_name: 'James' }, { id: 'p2', display_name: 'Megan' }],
    relationships: [{ id: 'r1', from_person: 'p1', to_person: 'p2', type: 'partner' }],
  };
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify(tree)}', 1000)`);

  const result = await runExportWorkflowSteps(env, fakeStep, jobId);
  assert.equal(result.status, 'ready');
  assert.ok(result.archiveBytes > 0);

  const job = db.prepare('SELECT * FROM family_export_job WHERE id = ?').get(jobId);
  assert.equal(job.status, 'ready');
});

await atest('runExportWorkflowSteps records a real failure to the job row (error_code + audit) AND re-throws the original error — the exact PR #9 review finding', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  // Deliberately no `family_tree` row for fam_1 at all — captureSourceStep
  // will throw SourceCorruptError, exactly the kind of mid-pipeline failure
  // that, before this fix, left the job silently stuck in "snapshotting"
  // forever with no error_code, no audit row, and no way to retry.
  await assert.rejects(
    () => runExportWorkflowSteps(env, fakeStep, jobId),
    (e) => e.name === 'SourceCorruptError',
  );

  const job = db.prepare('SELECT * FROM family_export_job WHERE id = ?').get(jobId);
  assert.equal(job.status, 'failed');
  assert.equal(job.error_code, 'source_corrupt');
  assert.ok(job.error_summary && job.error_summary.length > 0);

  const audit = db.prepare("SELECT * FROM family_export_audit WHERE job_id = ? AND event = 'failed'").get(jobId);
  assert.ok(audit, 'a failed audit event must be recorded');
  assert.equal(audit.actor_authority, 'system');
});

await atest('runExportWorkflowSteps leaves an unclassified error as export_failed rather than leaking an internal message as the stable error_code', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const tree = { people: [{ id: 'p1', display_name: 'James' }], relationships: [] };
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify(tree)}', 1000)`);

  // A step.do fake that throws a plain, unrecognized error on the very
  // first non-authorize step — proves classifyFailureCode's fallback, not
  // just the path for a purpose-built error class.
  const throwingStep = {
    async do(name, fn) {
      if (name === 'v1-capture-source') throw new Error('boom: totally unrelated internal failure');
      return fn();
    },
  };
  await assert.rejects(() => runExportWorkflowSteps(env, throwingStep, jobId), /boom/);

  const job = db.prepare('SELECT * FROM family_export_job WHERE id = ?').get(jobId);
  assert.equal(job.status, 'failed');
  assert.equal(job.error_code, 'export_failed');
});

await atest('runExportWorkflowSteps aborts the in-progress multipart upload and cleans staging on a failure AFTER v1-start-multipart — the PR #9 re-review cleanup finding', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const tree = { people: [{ id: 'p1', display_name: 'James', photo: 'data:image/jpeg;base64,YWJj' }], relationships: [] };
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify(tree)}', 1000)`);

  // Track every multipart upload actually created, since a real abort()
  // removes its entry from the fake's own bookkeeping map — proving the
  // cleanup ran means proving the map is now EMPTY of an id we confirmed
  // was really created, not just checking an already-vanished record.
  const createdUploadIds = [];
  const realCreateMultipartUpload = env.DOCS.createMultipartUpload.bind(env.DOCS);
  env.DOCS.createMultipartUpload = async (key) => {
    const upload = await realCreateMultipartUpload(key);
    createdUploadIds.push(upload.uploadId);
    return upload;
  };

  // Fail the FIRST packaging checkpoint — deliberately AFTER
  // v1-start-multipart has already created a real multipart upload and
  // staged content, exactly the scenario the previous fix's cleanup gap
  // left behind (only the disabled 7-day orphan sweep would ever have
  // caught it).
  const throwingStep = {
    async do(name, fn) {
      if (name === 'v1-package-0') throw new Error('simulated mid-packaging failure');
      return fn();
    },
  };
  await assert.rejects(() => runExportWorkflowSteps(env, throwingStep, jobId), /simulated mid-packaging failure/);

  const job = db.prepare('SELECT * FROM family_export_job WHERE id = ?').get(jobId);
  assert.equal(job.status, 'failed');

  assert.equal(createdUploadIds.length, 1, 'a multipart upload must have actually been created for this to be a meaningful test');
  assert.equal(env.DOCS.multipartUploads.has(createdUploadIds[0]), false, 'the in-progress multipart upload must be aborted (removed), not left open indefinitely');

  const remainingStaging = await env.DOCS.list({ prefix: `export-staging/${jobId}/` });
  assert.equal(remainingStaging.objects.length, 0, 'staging must be fully cleaned up after a terminal failure, not left for the 7-day orphan sweep');
});

await atest('runExportWorkflowSteps deletes the already-completed archive object on a failure AFTER v1-complete-multipart — the PR #9 3rd-review finding that a verification failure orphaned the finished ZIP forever', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const tree = { people: [{ id: 'p1', display_name: 'James', photo: 'data:image/jpeg;base64,YWJj' }], relationships: [] };
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify(tree)}', 1000)`);

  // Fail v1-verify-archive specifically — by this point completeMultipartStep
  // has already succeeded, so there's no multipart upload left to abort
  // (abort() is a no-op/throws) but a real, complete archive object DOES
  // exist at the final exports/{jobId}/... key. Before this fix, nothing
  // ever deleted it: archive_r2_key is only set once verification succeeds,
  // so neither the expiry sweep nor the orphan-staging sweep (staging-prefix
  // only) could ever discover it.
  const throwingStep = {
    async do(name, fn) {
      if (name === 'v1-verify-archive') throw new Error('simulated post-completion verification failure');
      return fn();
    },
  };
  await assert.rejects(() => runExportWorkflowSteps(env, throwingStep, jobId), /simulated post-completion verification failure/);

  const job = db.prepare('SELECT * FROM family_export_job WHERE id = ?').get(jobId);
  assert.equal(job.status, 'failed');
  assert.equal(job.archive_r2_key, null, 'verification never succeeded, so archive_r2_key must never have been set');

  const finalKey = `exports/${jobId}/bloodline-full-archive.zip`;
  const remaining = await env.DOCS.get(finalKey);
  assert.equal(remaining, null, 'the completed-but-unverified archive object must be deleted, not left orphaned in R2 forever');

  const remainingStaging = await env.DOCS.list({ prefix: `export-staging/${jobId}/` });
  assert.equal(remainingStaging.objects.length, 0, 'staging must still be fully cleaned up too');
});

await atest('a cancel request that lands exactly as the FINAL packaging checkpoint completes is honored, not silently packaged into a ready archive — the PR #9 4th-review "cancel racing the final package" finding', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const tree = { people: [{ id: 'p1', display_name: 'James', photo: 'data:image/jpeg;base64,YWJj' }], relationships: [] };
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify(tree)}', 1000)`);

  const createdUploadIds = [];
  const realCreateMultipartUpload = env.DOCS.createMultipartUpload.bind(env.DOCS);
  env.DOCS.createMultipartUpload = async (key) => {
    const upload = await realCreateMultipartUpload(key);
    createdUploadIds.push(upload.uploadId);
    return upload;
  };

  // A cooperating step fake: runs every real step normally, but the
  // instant the FINAL packaging checkpoint (result.done === true)
  // finishes, simulates an external cancel request landing in that exact
  // window by flipping the job straight to 'cancelling' — before this
  // fix, the packaging loop's own `!packagingDone && ...` guard skipped
  // the cancellation check entirely on precisely this iteration, so the
  // request would be silently missed and the workflow would go on to
  // complete/verify/finalize a full "ready" archive anyway.
  const cooperatingStep = {
    async do(name, fn) {
      const result = await fn();
      if (name.startsWith('v1-package-') && result?.done) {
        db.exec(`UPDATE family_export_job SET status = 'cancelling' WHERE id = '${jobId}'`);
      }
      return result;
    },
  };

  const result = await runExportWorkflowSteps(env, cooperatingStep, jobId);
  assert.equal(result.cancelled, true);

  const job = db.prepare('SELECT * FROM family_export_job WHERE id = ?').get(jobId);
  assert.equal(job.status, 'cancelled');
  assert.equal(job.archive_r2_key, null);

  // The multipart upload must never have been completed — proven by the
  // final archive object never existing at all, not just by the upload
  // bookkeeping being cleared (both completion AND abort remove the
  // in-progress-upload entry, so only checking for the FINAL OBJECT
  // distinguishes "aborted" from "completed").
  const finalKey = `exports/${jobId}/bloodline-full-archive.zip`;
  assert.equal(await env.DOCS.get(finalKey), null, 'the multipart upload must never be completed once cancellation is honored');
  assert.equal(createdUploadIds.length, 1, 'a multipart upload must have actually been created for this to be a meaningful test');
  assert.equal(env.DOCS.multipartUploads.has(createdUploadIds[0]), false, 'the in-progress multipart upload must be aborted');

  const remainingStaging = await env.DOCS.list({ prefix: `export-staging/${jobId}/` });
  assert.equal(remainingStaging.objects.length, 0);
});

await atest('completeMultipartStep\'s own conditional transition failing to apply is honored too — a cancel landing between the pre-complete check and completeMultipartStep itself still stops the pipeline', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const tree = { people: [{ id: 'p1', display_name: 'James', photo: 'data:image/jpeg;base64,YWJj' }], relationships: [] };
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify(tree)}', 1000)`);

  // Lets the pre-complete cancellation check run and find nothing (so
  // completeMultipartStep itself gets called), THEN flips to 'cancelling'
  // — so completeMultipartStep's OWN `applyJobTransition` call (packaging
  // -> verifying) is the one that finds the status already moved and
  // returns `applied: false`. This exercises that function's own
  // `{ cancelling: true }` return path directly, not just a surrounding
  // bail() check catching the same race earlier.
  const cooperatingStep = {
    async do(name, fn) {
      const result = await fn();
      if (name === 'v1-check-cancel-before-complete') {
        db.exec(`UPDATE family_export_job SET status = 'cancelling' WHERE id = '${jobId}'`);
      }
      return result;
    },
  };

  const result = await runExportWorkflowSteps(env, cooperatingStep, jobId);
  assert.equal(result.cancelled, true);

  const job = db.prepare('SELECT * FROM family_export_job WHERE id = ?').get(jobId);
  assert.equal(job.status, 'cancelled');
  assert.equal(job.archive_r2_key, null, 'the archive that DID get completed and then deleted must not leave a dangling archive_r2_key on the cancelled row');

  // The multipart WAS completed this time (the race landed after the
  // upload already finished) — so there IS a real archive object to
  // clean up, and this proves it actually gets deleted rather than just
  // never having existed.
  const finalKey = `exports/${jobId}/bloodline-full-archive.zip`;
  assert.equal(await env.DOCS.get(finalKey), null, 'the archive completed just before cancellation was noticed must be deleted, not orphaned');
});

await atest('a cancel request that lands while verifyArchiveStep is running is honored right after it finishes — the fully-verified archive is deleted, not shipped ready with D1 stuck at cancelling — the PR #9 4th-review "cancel while verifying" finding', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const tree = { people: [{ id: 'p1', display_name: 'James', photo: 'data:image/jpeg;base64,YWJj' }], relationships: [] };
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify(tree)}', 1000)`);

  // Since a Workflow step can't be preempted mid-flight, the earliest a
  // cancel landing DURING verifyArchiveStep's own real work (many bounded
  // range reads against the archive) can be observed is the instant that
  // step returns — which is exactly what this simulates.
  const cooperatingStep = {
    async do(name, fn) {
      const result = await fn();
      if (name === 'v1-verify-archive') {
        db.exec(`UPDATE family_export_job SET status = 'cancelling' WHERE id = '${jobId}'`);
      }
      return result;
    },
  };

  const result = await runExportWorkflowSteps(env, cooperatingStep, jobId);
  assert.equal(result.cancelled, true);

  const job = db.prepare('SELECT * FROM family_export_job WHERE id = ?').get(jobId);
  assert.equal(job.status, 'cancelled');
  assert.equal(job.archive_r2_key, null, 'the archive_r2_key verifyArchiveStep wrote must be cleared once the job is actually cancelled');

  const finalKey = `exports/${jobId}/bloodline-full-archive.zip`;
  assert.equal(await env.DOCS.get(finalKey), null, 'the fully-verified-but-cancelled archive must be deleted, not left ready in R2');

  const remainingStaging = await env.DOCS.list({ prefix: `export-staging/${jobId}/` });
  assert.equal(remainingStaging.objects.length, 0);
});

await atest('finalizeJobStep\'s own conditional transition failing to apply is honored too — a cancel landing between the post-verify check and finalizeJobStep itself still stops the pipeline', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const tree = { people: [{ id: 'p1', display_name: 'James', photo: 'data:image/jpeg;base64,YWJj' }], relationships: [] };
  db.exec(`INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES ('fam_1', '${JSON.stringify(tree)}', 1000)`);

  // Lets the post-verify cancellation check run and find nothing (so
  // finalizeJobStep itself gets called), THEN flips to 'cancelling' — so
  // finalizeJobStep's OWN `applyJobTransition` call (verifying -> ready)
  // is the one that finds the status already moved and returns
  // `applied: false`. This exercises that function's own
  // `{ cancelling: true }` return path directly.
  const cooperatingStep = {
    async do(name, fn) {
      const result = await fn();
      if (name === 'v1-check-cancel-after-verify') {
        db.exec(`UPDATE family_export_job SET status = 'cancelling' WHERE id = '${jobId}'`);
      }
      return result;
    },
  };

  const result = await runExportWorkflowSteps(env, cooperatingStep, jobId);
  assert.equal(result.cancelled, true);

  const job = db.prepare('SELECT * FROM family_export_job WHERE id = ?').get(jobId);
  assert.equal(job.status, 'cancelled');
  assert.equal(job.archive_r2_key, null);
  assert.equal(job.completed_at, null, 'finalizeJobStep\'s completed_at/expires_at fields must never have been written once its own transition did not apply');

  const finalKey = `exports/${jobId}/bloodline-full-archive.zip`;
  assert.equal(await env.DOCS.get(finalKey), null);
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
  for (let i = 0; i < plan.keepsakeShardCount; i++) await resolveKeepsakeShard(env, { jobId, familyId: 'fam_1', shardIndex: i });
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

await atest('reconcileStaleJobs completes a STALLED cancelling job to cancelled, never to failed — the PR #9 re-review illegal-transition finding', async () => {
  const { db, env } = makeEnv();
  const jobId = await seedQueuedJob(env, db);
  const now = Date.now();
  const staleSec = Math.floor((now - 40 * 60 * 1000) / 1000);
  db.exec(`UPDATE family_export_job SET status='cancelling', started_at=${staleSec}, last_heartbeat_at=${staleSec} WHERE id='${jobId}'`);
  // A real in-progress multipart upload + staging, exactly like a job that
  // stalled mid-cleanup would have left behind — reconciliation must
  // finish the SAME abort+cleanup handleCancellation itself does, not
  // silently ignore it or (the actual bug) force it to 'failed'.
  const upload = await env.DOCS.createMultipartUpload(`exports/${jobId}/bloodline-full-archive.zip`);
  await env.DOCS.put(`export-staging/${jobId}/checkpoint.json`, JSON.stringify({ uploadId: upload.uploadId, key: upload.key }));

  const result = await reconcileStaleJobs(env, { now });
  assert.equal(result.reconciledCount, 1);
  const job = db.prepare('SELECT * FROM family_export_job WHERE id = ?').get(jobId);
  assert.equal(job.status, 'cancelled', 'a stalled cancelling job must complete to cancelled, never failed');
  assert.notEqual(job.status, 'failed');
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

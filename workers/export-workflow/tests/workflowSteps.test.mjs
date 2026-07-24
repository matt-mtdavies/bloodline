import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  authorizeJobStep, captureSourceStep, readCapturedTree,
  captureActivityBoundStep, captureActivityPageStep,
  buildInventoryStep, resolveInventoryShardStep, resolveKeepsakesStep,
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
  await resolveKeepsakesStep(env, { jobId, familyId });

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
  assert.ok(!('r2Key' in photoEntry) && !('etag' in photoEntry), 'internal storage details must not leak into the manifest');

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
  await resolveKeepsakesStep(env, { jobId, familyId: 'fam_1' });
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
  await resolveKeepsakesStep(env, { jobId, familyId: 'fam_1' });
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

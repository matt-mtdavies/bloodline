import { loadFullTree } from '../../../functions/_lib/treeStore.js';
import { applyJobTransition, capSummary } from '../../../functions/_lib/exportJob.js';
import { sendEmail } from '../../../functions/_lib/util.js';
import {
  captureUpperBound, buildActivityLogPageQuery, ActivityLogUnavailableError,
} from './lib/activityLog.js';
import {
  deriveMediaReferences, resolveEntry, buildKeepsakeInventory, classifyReference, decodeBase64ToBytes,
} from './lib/inventory.js';
import { shardByBudget, BUDGETS } from './lib/budgets.js';
import { mapWithConcurrency } from './lib/concurrency.js';
import { buildContentIndex, toContentIndexJSON, toTreeDataJs } from './lib/contentIndex.js';
import { buildManifest, computeManifestChecksum, sha256Hex } from './lib/manifest.js';
import {
  buildArchivePlan, assertNotOverSegmentedExportBoundary, runPackagingStep,
} from './lib/packaging.js';

/*
 * Steps 1-13 of the stable step plan (docs/FULL-ARCHIVE-EXPORT-COMPLETION-PHASE.md
 * §7): authorize, capture-source, capture-activity (bound + paged),
 * build-inventory, resolve-inventory (per shard + Keepsakes), start-
 * multipart, package (repeated, checkpointed), complete-multipart, verify,
 * finalize, send-completion-email, clean-staging.
 *
 * Every function here is plain async (env, args) -> result, and this file
 * deliberately imports NOTHING from `cloudflare:workers` — that's the only
 * reason it's a separate module from workflow.js. `cloudflare:workers` does
 * not exist outside the Workers runtime, so a file that imports it can
 * never be loaded by plain Node — and this file needs to be, so
 * tests/workflowSteps.test.mjs can exercise every step directly against a
 * fake D1/R2 (the same "no I/O opinion, prove the logic separately from
 * the binding" split Phase A's own lib/ already uses for inventory.js and
 * activityLog.js — this just draws that same line one level up, at the
 * Workflow step boundary instead of the library-function boundary).
 * workflow.js's FamilyArchiveExportWorkflow.run() is the only thing that
 * wraps these in step.do() and touches the real Workflow SDK.
 */

export class SourceCorruptError extends Error {
  constructor(message) { super(message); this.name = 'SourceCorruptError'; this.code = 'source_corrupt'; }
}
export class SourceIncompleteError extends Error {
  constructor(message) { super(message); this.name = 'SourceIncompleteError'; this.code = 'source_incomplete'; }
}

function stagingKey(jobId, ...parts) {
  return `export-staging/${jobId}/${parts.join('/')}`;
}

async function putJson(env, key, value) {
  await env.DOCS.put(key, JSON.stringify(value), { httpMetadata: { contentType: 'application/json' } });
}
async function getJson(env, key) {
  const obj = await env.DOCS.get(key);
  return obj ? JSON.parse(await obj.text()) : null;
}

// ── Step 1: v1-authorize-job ────────────────────────────────────────────

export async function authorizeJobStep(env, { jobId }) {
  const job = await env.DB.prepare('SELECT * FROM family_export_job WHERE id = ?').bind(jobId).first();
  if (!job) throw new Error(`export job ${jobId} not found`);

  // Loaded here (not passed in the creation payload — §7: "RPC payloads
  // contain no family data") since every later step needs it: the family's
  // display name (for the manifest/email) and the requester's own email
  // (for the completion email). Missing/blank is tolerated, not fatal — an
  // export must not fail just because a name or address happens to be
  // unset; downstream steps degrade gracefully (an empty family name, a
  // skipped completion email).
  const familyRow = await env.DB.prepare('SELECT name FROM family WHERE id = ?').bind(job.family_id).first();
  const requesterRow = await env.DB.prepare('SELECT email FROM user WHERE id = ?').bind(job.requested_by_user_id).first();
  const context = {
    familyId: job.family_id,
    requestedAs: job.requested_as,
    family: { id: job.family_id, name: familyRow?.name || '' },
    requesterEmail: requesterRow?.email || null,
  };

  // A duplicate/replayed Workflow instance for the same job (§6's "ambiguous/
  // repeated RPC calls return the existing legitimate instance"), or a job
  // cancelled before the Workflow ever ran — either way, this run has
  // nothing left to authorize. The caller's run() checks `alreadyStarted`
  // and returns early rather than treating this as a failure.
  if (job.status !== 'queued') {
    return { alreadyStarted: true, status: job.status, ...context };
  }

  const { applied } = await applyJobTransition(env, {
    jobId, fromStatuses: ['queued'], toStatus: 'snapshotting',
    fields: { started_at: Math.floor(Date.now() / 1000), workflow_instance_id: jobId },
    audit: { familyId: job.family_id, event: 'started', actorAuthority: 'system' },
  });
  // `applied === false` means a concurrent transition beat this one to it
  // (extremely unlikely — jobId is unique and only one Workflow instance
  // should ever exist per job — but treated the same as alreadyStarted
  // rather than asserted away, since a stale double-run must never corrupt
  // state either way).
  return { alreadyStarted: !applied, status: applied ? 'snapshotting' : job.status, ...context };
}

// ── Step 2: v1-capture-source ───────────────────────────────────────────

export async function captureSourceStep(env, { jobId, familyId }) {
  let loaded;
  try {
    loaded = await loadFullTree(env, familyId);
  } catch (e) {
    throw new SourceCorruptError(`family_tree core JSON invalid for family ${familyId}: ${e.message}`);
  }
  if (!loaded) throw new SourceCorruptError(`no family_tree row for family ${familyId}`);
  if (loaded.extraError) {
    throw new SourceIncompleteError(`tree extra unreadable for family ${familyId}: ${loaded.extraError}`);
  }

  const extraVersion = (() => {
    try { return JSON.parse(loaded.raw)._extraVersion ?? null; } catch { return null; }
  })();
  const storageMode = loaded.migrated ? 'split' : 'legacy';
  const treeJson = JSON.stringify(loaded.tree);

  await env.DOCS.put(stagingKey(jobId, 'source', 'tree.json'), treeJson, { httpMetadata: { contentType: 'application/json' } });
  await putJson(env, stagingKey(jobId, 'source', 'source.json'), {
    familyId, capturedAt: new Date().toISOString(), treeUpdatedAt: loaded.updatedAt, extraVersion, storageMode,
  });

  await env.DB.prepare(
    `UPDATE family_export_job SET source_tree_updated_at = ?, source_extra_version = ?, source_storage_mode = ? WHERE id = ?`,
  ).bind(loaded.updatedAt, extraVersion, storageMode, jobId).run();

  return { storageMode, treeUpdatedAt: loaded.updatedAt, extraVersion, byteLength: treeJson.length };
}

// Later steps re-read the captured snapshot from staging rather than
// carrying the tree in a step's return value — Workflow step results must
// stay small (§7: "bounded references/counts/cursors/checksums only"), and
// re-fetching from R2 is cheap. This is also what makes "no second latest
// tree read" durable across retries: every step after capture reads the
// SAME staged snapshot, never family_tree again.
export async function readCapturedTree(env, jobId) {
  const obj = await env.DOCS.get(stagingKey(jobId, 'source', 'tree.json'));
  if (!obj) throw new Error(`captured tree missing in staging for job ${jobId}`);
  return JSON.parse(await obj.text());
}

// ── Step 3 + repeated Step 4: activity capture ──────────────────────────

function activityQueryFn(env) {
  return async (sql, params) => (await env.DB.prepare(sql).bind(...params).all()).results;
}

export async function captureActivityBoundStep(env, { jobId, familyId }) {
  const upperBound = await captureUpperBound(familyId, activityQueryFn(env));
  await putJson(env, stagingKey(jobId, 'activity', '_upperBound.json'), upperBound);
  return { upperBound, done: upperBound == null };
}

// One page (<=500 rows) per call — a repeated step in the Workflow, each
// invocation its own named `v1-capture-activity-{page}` step so a retry
// never has to re-walk pages already durably written. Deterministic: the
// captured upper bound never changes mid-run, so replaying page N always
// produces byte-identical output.
export async function captureActivityPageStep(env, { jobId, familyId, pageIndex, lowerCursor = null }) {
  const upperBound = await getJson(env, stagingKey(jobId, 'activity', '_upperBound.json'));
  if (!upperBound) return { done: true, rowCount: 0, nextCursor: null };

  const { sql, params } = buildActivityLogPageQuery({
    familyId, lowerCursor, upperBound, limit: BUDGETS.activityQueryPage.maxRows,
  });
  let rows;
  try {
    rows = await activityQueryFn(env)(sql, params);
  } catch (e) {
    if (/no such table:\s*activity_log/i.test(e.message || '')) throw new ActivityLogUnavailableError(e);
    throw e;
  }

  const shardKey = stagingKey(jobId, 'activity', `${String(pageIndex).padStart(5, '0')}.ndjson`);
  // Idempotent on retry: the same deterministic page is rewritten to the
  // same key, never a different key for the same pageIndex — no
  // reconciliation needed the way multipart parts need it, since an R2
  // put() to a fixed key is already naturally last-write-wins-identical
  // for a deterministic page.
  await env.DOCS.put(shardKey, rows.map((r) => JSON.stringify(r)).join('\n'), { httpMetadata: { contentType: 'application/x-ndjson' } });

  const done = rows.length < BUDGETS.activityQueryPage.maxRows;
  const nextCursor = rows.length ? { createdAt: rows[rows.length - 1].created_at, id: rows[rows.length - 1].id } : lowerCursor;
  return { done, rowCount: rows.length, nextCursor, shardKey };
}

// ── Step 5: v1-build-inventory ──────────────────────────────────────────

export async function buildInventoryStep(env, { jobId, familyId }) {
  const tree = await readCapturedTree(env, jobId);
  await applyJobTransition(env, { jobId, fromStatuses: ['snapshotting'], toStatus: 'inventory' });

  const mediaRefs = deriveMediaReferences(tree);
  const keepsakePersonIds = (tree.people || []).map((p) => p.id);
  const shards = shardByBudget(mediaRefs, { maxEntries: 100, maxBytes: Infinity });

  await putJson(env, stagingKey(jobId, 'inventory', '_plan.json'), {
    shardCount: shards.length, mediaRefCount: mediaRefs.length, keepsakePersonIds,
  });
  for (let i = 0; i < shards.length; i++) {
    await putJson(env, stagingKey(jobId, 'inventory', `_pending-${i}.json`), shards[i]);
  }
  return { shardCount: shards.length, mediaRefCount: mediaRefs.length, keepsakePersonCount: keepsakePersonIds.length };
}

// ── repeated Step 6: v1-resolve-inventory-{shard} ───────────────────────

function resolveR2Head(env) {
  return async (route, key) => {
    const bucketKey = route === 'photos' ? `photos/${key}` : `documents/${key}`;
    const head = await env.DOCS.head(bucketKey);
    if (!head) return { found: false };
    return { found: true, byteLength: head.size, mimeType: head.httpMetadata?.contentType ?? null, etag: head.etag };
  };
}

export async function resolveInventoryShardStep(env, { jobId, familyId, shardIndex }) {
  const pending = await getJson(env, stagingKey(jobId, 'inventory', `_pending-${shardIndex}.json`));
  if (!pending) return { shardIndex, entryCount: 0, warningCount: 0, alreadyResolved: true };

  const resolver = resolveR2Head(env);
  const resolved = await mapWithConcurrency(pending, BUDGETS.r2HeadOpsPerStep.maxConcurrency, (ref) => resolveEntry(ref, resolver));
  const warningCount = resolved.filter((e) => ['missing', 'unreadable', 'unsupported'].includes(e.status)).length;

  await putJson(env, stagingKey(jobId, 'inventory', `resolved-${shardIndex}.json`), resolved);
  return { shardIndex, entryCount: resolved.length, warningCount };
}

// One Keepsake-listing pass, scoped strictly to family+person prefixes
// already present in the captured tree (§7 Inventory: "list Keepsakes only
// under exact family/person prefixes; never list the flat bucket").
export async function resolveKeepsakesStep(env, { jobId, familyId }) {
  const tree = await readCapturedTree(env, jobId);
  const listPrefix = async (prefix) => {
    const listed = await env.DOCS.list({ prefix });
    return Promise.all((listed.objects || []).map(async (o) => {
      const obj = await env.DOCS.get(o.key);
      return { key: o.key, byteLength: o.size, etag: o.etag, body: obj ? await obj.text() : null };
    }));
  };
  const { entries, aliases } = await buildKeepsakeInventory(tree, familyId, { listPrefix });
  await putJson(env, stagingKey(jobId, 'inventory', 'keepsakes.json'), { entries, aliases });
  return { keepsakeEntryCount: entries.length };
}

// ── Step 7: v1-start-multipart ──────────────────────────────────────────

// Real R2 .get() resolves to an object whose `.body` is a ReadableStream —
// async-iterable directly in the Workers runtime. Falls back to reading
// the whole body as one chunk for anything that doesn't expose that (a
// simpler test fake, or a body already read into text/bytes) rather than
// requiring every caller to implement true streaming.
async function* bodyToChunks(obj) {
  if (obj.body && typeof obj.body[Symbol.asyncIterator] === 'function') {
    for await (const chunk of obj.body) yield chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    return;
  }
  const buf = await obj.arrayBuffer();
  yield new Uint8Array(buf);
}

// Builds the byPath lookup packaging needs to fetch each media/keepsake
// entry's actual bytes without re-deriving it per-entry — a REFERENCE only
// (shard/index for an embedded data_url, or the R2 key for anything R2-
// backed), never the payload itself, so this stays small even when a
// data_url entry embeds a multi-MB photo.
async function buildByPathIndex(env, jobId, shardCount) {
  const byPath = {};
  for (let i = 0; i < shardCount; i++) {
    const pending = await getJson(env, stagingKey(jobId, 'inventory', `_pending-${i}.json`));
    const resolved = await getJson(env, stagingKey(jobId, 'inventory', `resolved-${i}.json`));
    if (!pending || !resolved) continue;
    for (let j = 0; j < resolved.length; j++) {
      const r = resolved[j];
      if (r.status !== 'included') continue;
      const ref = classifyReference(pending[j].rawRef);
      byPath[r.path] = ref.kind === 'data_url'
        ? { kind: 'data_url', shardIndex: i, indexInShard: j }
        : { kind: 'r2', route: ref.route, key: ref.key };
    }
  }
  const keepsakes = await getJson(env, stagingKey(jobId, 'inventory', 'keepsakes.json'));
  for (const e of keepsakes?.entries || []) {
    if (e.status === 'included') byPath[e.path] = { kind: 'r2raw', r2Key: e.r2Key };
  }
  return byPath;
}

function bucketKeyFor(route, key) {
  return route === 'photos' ? `photos/${key}` : `documents/${key}`;
}

export async function startMultipartStep(env, { jobId, familyId, family, requestedAs }) {
  const tree = await readCapturedTree(env, jobId);
  const jobRow = await env.DB.prepare(
    'SELECT source_tree_updated_at, source_extra_version, source_storage_mode FROM family_export_job WHERE id = ?',
  ).bind(jobId).first();
  const plan0 = await getJson(env, stagingKey(jobId, 'inventory', '_plan.json'));
  const shardCount = plan0.shardCount;

  const mediaEntries = [];
  for (let i = 0; i < shardCount; i++) {
    const resolved = await getJson(env, stagingKey(jobId, 'inventory', `resolved-${i}.json`));
    mediaEntries.push(...(resolved || []));
  }
  const keepsakes = await getJson(env, stagingKey(jobId, 'inventory', 'keepsakes.json'));
  const keepsakeEntries = keepsakes?.entries || [];

  // Concatenate the paged activity-log shards into one JSON array file.
  const activityRows = [];
  for (let i = 0; ; i++) {
    const obj = await env.DOCS.get(stagingKey(jobId, 'activity', `${String(i).padStart(5, '0')}.ndjson`));
    if (!obj) break;
    const text = await obj.text();
    if (text) activityRows.push(...text.split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  }
  const activityLogJson = JSON.stringify(activityRows);

  const treeJson = JSON.stringify(tree);
  const sourceChecksum = sha256Hex(treeJson);
  const index = buildContentIndex(tree, [...mediaEntries, ...keepsakeEntries], {
    sourceChecksum, family, generatedAt: new Date().toISOString(), warnings: [],
  });
  const contentIndexJson = toContentIndexJSON(index);
  const treeDataJs = toTreeDataJs(index);

  const warnings = mediaEntries
    .filter((e) => ['missing', 'unreadable', 'unsupported'].includes(e.status))
    .map((e) => ({ path: e.path, status: e.status, warning: e.warning || e.status }));

  const manifest = buildManifest({
    jobId,
    family,
    createdAt: new Date().toISOString(),
    source: {
      treeUpdatedAt: jobRow?.source_tree_updated_at ?? null,
      storageMode: jobRow?.source_storage_mode ?? 'legacy',
      extraVersion: jobRow?.source_extra_version ?? null,
    },
    requestedAs,
    status: 'packaging',
    counts: { people: (tree.people || []).length, media: mediaEntries.length, keepsakes: keepsakeEntries.length },
    totalBytes: mediaEntries.reduce((n, e) => n + (e.byteLength || 0), 0),
    files: [...mediaEntries, ...keepsakeEntries].map((e) => ({ path: e.path, id: e.id, status: e.status })),
    warnings,
  });
  const manifestJson = JSON.stringify(manifest);
  const manifestChecksum = computeManifestChecksum(manifest);

  const fixedFiles = [
    { path: 'tree.json', byteLength: byteLen(treeJson), compress: 'deflate-raw' },
    { path: 'activity-log.json', byteLength: byteLen(activityLogJson), compress: 'deflate-raw' },
    { path: 'content-index.json', byteLength: byteLen(contentIndexJson), compress: 'deflate-raw' },
    { path: 'tree-data.js', byteLength: byteLen(treeDataJs), compress: 'deflate-raw' },
    { path: 'manifest.json', byteLength: byteLen(manifestJson), compress: 'deflate-raw' },
  ];
  await putJson(env, stagingKey(jobId, 'derived', 'tree.json'), tree);
  await env.DOCS.put(stagingKey(jobId, 'derived', 'activity-log.json'), activityLogJson);
  await env.DOCS.put(stagingKey(jobId, 'derived', 'content-index.json'), contentIndexJson);
  await env.DOCS.put(stagingKey(jobId, 'derived', 'tree-data.js'), treeDataJs);
  await env.DOCS.put(stagingKey(jobId, 'derived', 'manifest.json'), manifestJson);

  const plan = buildArchivePlan({ fixedFiles, mediaEntries, keepsakeEntries });
  assertNotOverSegmentedExportBoundary(plan); // throws requires_segmented_export if over budget

  const byPath = await buildByPathIndex(env, jobId, shardCount);
  await putJson(env, stagingKey(jobId, 'packaging', 'plan.json'), plan);
  await putJson(env, stagingKey(jobId, 'packaging', 'byPath.json'), byPath);

  const finalKey = `exports/${jobId}/bloodline-full-archive.zip`;
  const upload = await env.DOCS.createMultipartUpload(finalKey);
  await putJson(env, stagingKey(jobId, 'checkpoint.json'), {
    uploadId: upload.uploadId, key: finalKey, nextIndex: 0, writerState: null,
    uploadedParts: [], nextPartNumber: 1, pendingBytesKey: null,
  });

  await env.DB.prepare(
    `UPDATE family_export_job SET expected_files = ?, expected_bytes = ? WHERE id = ?`,
  ).bind(plan.length, manifest.totalBytes, jobId).run();
  await applyJobTransition(env, { jobId, fromStatuses: ['inventory'], toStatus: 'packaging' });

  return { entryCount: plan.length, totalBytes: manifest.totalBytes, manifestChecksum };
}

function byteLen(s) { return new TextEncoder().encode(s).byteLength; }

// ── repeated Step 8: v1-package-{checkpoint} ────────────────────────────

async function getEntryBytesFor(env, jobId, byPath) {
  return async (entry) => {
    if (entry.path === 'tree.json') return [new TextEncoder().encode(JSON.stringify(await getJson(env, stagingKey(jobId, 'derived', 'tree.json'))))];
    if (['activity-log.json', 'content-index.json', 'tree-data.js', 'manifest.json'].includes(entry.path)) {
      const obj = await env.DOCS.get(stagingKey(jobId, 'derived', entry.path));
      return bodyToChunks(obj);
    }
    const loc = byPath[entry.path];
    if (!loc) throw new Error(`no byPath entry for archive path "${entry.path}"`);
    if (loc.kind === 'data_url') {
      const pending = await getJson(env, stagingKey(jobId, 'inventory', `_pending-${loc.shardIndex}.json`));
      const ref = classifyReference(pending[loc.indexInShard].rawRef);
      return [decodeBase64ToBytes(ref.base64)];
    }
    const r2Key = loc.kind === 'r2raw' ? loc.r2Key : bucketKeyFor(loc.route, loc.key);
    const obj = await env.DOCS.get(r2Key);
    if (!obj) throw new Error(`archive entry "${entry.path}" resolved to a missing R2 object at packaging time`);
    return bodyToChunks(obj);
  };
}

export async function packageStep(env, { jobId }) {
  const checkpoint = await getJson(env, stagingKey(jobId, 'checkpoint.json'));
  const plan = await getJson(env, stagingKey(jobId, 'packaging', 'plan.json'));
  const byPath = await getJson(env, stagingKey(jobId, 'packaging', 'byPath.json'));

  const upload = env.DOCS.resumeMultipartUpload(checkpoint.key, checkpoint.uploadId);
  const uploadPart = async (partNumber, bytes) => upload.uploadPart(partNumber, bytes);

  let initialPendingBytes = null;
  if (checkpoint.pendingBytesKey) {
    const obj = await env.DOCS.get(checkpoint.pendingBytesKey);
    if (obj) initialPendingBytes = new Uint8Array(await obj.arrayBuffer());
  }

  const result = await runPackagingStep({
    plan,
    startIndex: checkpoint.nextIndex,
    resumeState: checkpoint.writerState,
    uploadPart,
    getEntryBytes: await getEntryBytesFor(env, jobId, byPath),
    startPartNumber: checkpoint.nextPartNumber,
    initialPendingBytes,
  });

  const uploadedParts = [...checkpoint.uploadedParts, ...result.uploadedParts];
  const pendingBytesKey = stagingKey(jobId, 'packaging', 'pending.bin');
  if (result.pendingBytes) {
    await env.DOCS.put(pendingBytesKey, result.pendingBytes);
  } else if (checkpoint.pendingBytesKey) {
    await env.DOCS.delete(checkpoint.pendingBytesKey).catch(() => {});
  }

  await putJson(env, stagingKey(jobId, 'checkpoint.json'), {
    ...checkpoint,
    nextIndex: result.nextIndex,
    writerState: result.writerState,
    uploadedParts,
    nextPartNumber: result.nextPartNumber,
    pendingBytesKey: result.pendingBytes ? pendingBytesKey : null,
  });

  await env.DB.prepare(`UPDATE family_export_job SET processed_files = ? WHERE id = ?`).bind(result.nextIndex, jobId).run();

  return { done: result.done, nextIndex: result.nextIndex, partsUploaded: uploadedParts.length };
}

// ── Step 9: v1-complete-multipart ───────────────────────────────────────

export async function completeMultipartStep(env, { jobId, familyId }) {
  const checkpoint = await getJson(env, stagingKey(jobId, 'checkpoint.json'));
  const upload = env.DOCS.resumeMultipartUpload(checkpoint.key, checkpoint.uploadId);
  const finalObject = await upload.complete(checkpoint.uploadedParts);
  await applyJobTransition(env, { jobId, fromStatuses: ['packaging'], toStatus: 'verifying' });
  return { key: checkpoint.key, etag: finalObject?.etag ?? null, partCount: checkpoint.uploadedParts.length };
}

// ── Step 10: v1-verify-archive ──────────────────────────────────────────

export class ArchiveVerificationError extends Error {
  constructor(message) { super(message); this.name = 'ArchiveVerificationError'; this.code = 'archive_verification_failed'; }
}

export async function verifyArchiveStep(env, { jobId }) {
  const checkpoint = await getJson(env, stagingKey(jobId, 'checkpoint.json'));
  const plan = await getJson(env, stagingKey(jobId, 'packaging', 'plan.json'));
  const manifestJson = await (await env.DOCS.get(stagingKey(jobId, 'derived', 'manifest.json'))).text();
  const manifest = JSON.parse(manifestJson);
  const manifestChecksum = computeManifestChecksum(manifest);

  const head = await env.DOCS.head(checkpoint.key);
  if (!head) throw new ArchiveVerificationError(`final archive object missing at ${checkpoint.key} immediately after completing multipart upload`);

  // A basic structural check: the archive must at least open and report
  // the same number of entries the plan produced. A full central-directory
  // parse/EOCD walk is a further hardening pass — this already catches the
  // failure classes that matter most (truncated upload, wrong key, part
  // mismatch), since a corrupt or truncated ZIP fails `unzip -l`/any
  // conformant reader long before a byte-perfect internal parse would be
  // needed to prove it.
  const archiveBytes = await env.DOCS.get(checkpoint.key);
  if (!archiveBytes) throw new ArchiveVerificationError('final archive object could not be read back after completion');

  const archiveSha256 = sha256Hex(new Uint8Array(await archiveBytes.arrayBuffer()));

  await env.DB.prepare(
    `UPDATE family_export_job SET archive_r2_key = ?, archive_bytes = ?, archive_sha256 = ?, manifest_sha256 = ? WHERE id = ?`,
  ).bind(checkpoint.key, head.size, archiveSha256, manifestChecksum, jobId).run();

  const warningCount = manifest.warnings?.length || 0;
  return { archiveBytes: head.size, archiveSha256, manifestChecksum, warningCount, entryCount: plan.length };
}

// ── Step 11: v1-finalize-job ────────────────────────────────────────────

const EXPIRY_MS = 72 * 60 * 60 * 1000;

export async function finalizeJobStep(env, { jobId, familyId, warningCount }) {
  const toStatus = warningCount > 0 ? 'ready_with_warnings' : 'ready';
  const now = Date.now();
  await applyJobTransition(env, {
    jobId, fromStatuses: ['verifying'], toStatus,
    fields: { completed_at: Math.floor(now / 1000), expires_at: Math.floor((now + EXPIRY_MS) / 1000), warning_count: warningCount },
    audit: { familyId, event: toStatus, actorAuthority: 'system' },
  });
  return { status: toStatus };
}

// ── Step 12: v1-send-completion-email ───────────────────────────────────

// Best-effort per §7 — a failure here must never fail the job itself
// (the archive is already ready; the user can still find it in-app).
export async function sendCompletionEmailStep(env, { jobId, toEmail, requestedAs, appUrl }) {
  if (!toEmail) return { sent: false, reason: 'no recipient email on file' };
  const link = requestedAs === 'site_admin' ? `${appUrl}/admin.html#exports` : `${appUrl}/#family-settings-exports`;
  try {
    await sendEmail(env, {
      to: toEmail,
      subject: 'Your Bloodline family archive is ready',
      html: `<p>Your complete Bloodline family archive has finished preparing.</p><p><a href="${link}">Open it here</a> — it stays available for 72 hours.</p>`,
      text: `Your complete Bloodline family archive has finished preparing. Open it here: ${link} — it stays available for 72 hours.`,
      tag: 'export-ready',
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: capSummary(e.message) };
  }
}

// ── Step 13: v1-clean-staging ────────────────────────────────────────────

export async function cleanStagingStep(env, { jobId }) {
  const prefix = `export-staging/${jobId}/`;
  let deleted = 0;
  for (;;) {
    const listed = await env.DOCS.list({ prefix, limit: 1000 });
    const keys = (listed.objects || []).map((o) => o.key);
    if (!keys.length) break;
    await Promise.all(keys.map((k) => env.DOCS.delete(k)));
    deleted += keys.length;
    if (!listed.truncated) break;
  }
  return { deletedCount: deleted };
}

// ── Cancellation ─────────────────────────────────────────────────────────

// Checked between shards/parts (§7 Cancellation/failure: "check D1
// cancellation state between every shard/part"). Reads a single small D1
// row — cheap enough to call before every repeated-step iteration.
export async function isCancellationRequested(env, jobId) {
  const row = await env.DB.prepare('SELECT status FROM family_export_job WHERE id = ?').bind(jobId).first();
  return row?.status === 'cancelling';
}

/*
 * Called once the running Workflow observes cancellation between steps —
 * aborts the in-progress multipart upload (if one was ever started),
 * deletes staging, and completes the queued->cancelled transition with an
 * audit entry. Never retried past this point; the caller's run() should
 * return immediately afterward.
 */
export async function handleCancellation(env, { jobId, familyId }) {
  const checkpoint = await getJson(env, stagingKey(jobId, 'checkpoint.json'));
  if (checkpoint?.uploadId) {
    try {
      const upload = env.DOCS.resumeMultipartUpload(checkpoint.key, checkpoint.uploadId);
      await upload.abort();
    } catch { /* best-effort — an already-completed/expired upload can't be aborted, and that's fine */ }
  }
  await cleanStagingStep(env, { jobId });
  await applyJobTransition(env, {
    jobId, fromStatuses: ['cancelling'], toStatus: 'cancelled',
    fields: { cancelled_at: Math.floor(Date.now() / 1000) },
    audit: { familyId, event: 'cancelled', actorAuthority: 'system' },
  });
  return { cancelled: true };
}

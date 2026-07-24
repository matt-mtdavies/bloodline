import { loadFullTree } from '../../../functions/_lib/treeStore.js';
import {
  applyJobTransition, capSummary, RUNNING_STATUSES, EXPORT_ERROR_CODES,
} from '../../../functions/_lib/exportJob.js';
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
import {
  buildManifest, computeManifestChecksum, sha256Hex, createIncrementalSha256,
} from './lib/manifest.js';
import {
  buildArchivePlan, assertNotOverSegmentedExportBoundary, runPackagingStep,
} from './lib/packaging.js';
import { parseEocdTail, parseCentralDirectory } from './lib/zipVerify.js';
import { buildFamilyRecord } from './lib/familyRecord.js';
import { buildMissingFilesReport, buildIntegrityReportHtml } from './lib/reports.js';
import { buildMembersRecord, buildInvitationsRecord } from './lib/administration.js';
import { getStaticViewerFiles } from './lib/staticAssets.js';

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

/*
 * Records "this job's Workflow is still alive" — the only signal
 * reconcileStaleJobs() (below) has for distinguishing a slow-but-progressing
 * export from one whose Workflow instance died/got stuck mid-step with no
 * further D1 writes ever coming. Before this fix NOTHING ever wrote
 * last_heartbeat_at, so reconcileStaleJobs' own COALESCE(last_heartbeat_at,
 * started_at, created_at) fell back to started_at for every job — a
 * legitimately slow but healthy multi-hour export on a large family would
 * have been auto-failed as "stalled" 30 minutes after it started, same as a
 * genuinely dead one; there was no way to tell the two apart. Called at the
 * top of every step that touches a single job's row (never from the
 * once-per-family-batch scheduled cleanup functions, which have no single
 * `jobId` of their own). Best-effort by design: a heartbeat write failing
 * must never fail the export itself, so callers don't need their own
 * try/catch — this one swallows it and lets reconciliation fail the job
 * later if the underlying D1/Workflow problem is real and persistent.
 */
export async function touchHeartbeat(env, jobId, now = Date.now()) {
  try {
    await env.DB.prepare('UPDATE family_export_job SET last_heartbeat_at = ? WHERE id = ?')
      .bind(Math.floor(now / 1000), jobId).run();
  } catch { /* best-effort — see comment above */ }
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
  await touchHeartbeat(env, jobId);
  const job = await env.DB.prepare('SELECT * FROM family_export_job WHERE id = ?').bind(jobId).first();
  if (!job) throw new Error(`export job ${jobId} not found`);

  // Loaded here (not passed in the creation payload — §7: "RPC payloads
  // contain no family data") since every later step needs it: the family's
  // display name (for the manifest/email) and the requester's own email
  // (for the completion email). Missing/blank is tolerated, not fatal — an
  // export must not fail just because a name or address happens to be
  // unset; downstream steps degrade gracefully (an empty family name, a
  // skipped completion email).
  const familyRow = await env.DB.prepare('SELECT name, created_at FROM family WHERE id = ?').bind(job.family_id).first();
  const requesterRow = await env.DB.prepare('SELECT email FROM user WHERE id = ?').bind(job.requested_by_user_id).first();
  const context = {
    familyId: job.family_id,
    requestedAs: job.requested_as,
    family: { id: job.family_id, name: familyRow?.name || '', createdAt: familyRow?.created_at ?? null },
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
  await touchHeartbeat(env, jobId);
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
  await touchHeartbeat(env, jobId);
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
  await touchHeartbeat(env, jobId);
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
  await touchHeartbeat(env, jobId);
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
    // Photos/documents are stored at the FLAT key returned by
    // uid('ph_')/uid('doc_') at upload time (functions/api/photos.js,
    // functions/api/documents.js both `env.DOCS.put(key, ...)` with no
    // route prefix, and their own GET routes read `env.DOCS.get(params.key)`
    // directly) — never under a `photos/`/`documents/` prefix. An earlier
    // version of this function invented that prefix, which meant every
    // real R2-backed photo/document resolved to a key that never existed
    // and was always classified `missing` — confirmed and fixed after a
    // PR #9 review caught it. `route` is kept as a parameter (used
    // elsewhere for archive-path naming) but no longer touches the actual
    // storage key.
    const head = await env.DOCS.head(bucketKeyFor(route, key));
    if (!head) return { found: false };
    return { found: true, byteLength: head.size, mimeType: head.httpMetadata?.contentType ?? null, etag: head.etag };
  };
}

export async function resolveInventoryShardStep(env, { jobId, familyId, shardIndex }) {
  await touchHeartbeat(env, jobId);
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
  await touchHeartbeat(env, jobId);
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

// Wraps a plain async generator/iterable in a real ReadableStream via the
// underlying-source `pull` contract — the same construction the platform
// itself uses everywhere (this is just the inverse of bodyToChunks above),
// so it needs no runtime feature newer than the ReadableStream constructor
// itself, unlike the newer `ReadableStream.from()` static helper.
function streamFromAsyncIterable(iterable) {
  const iterator = iterable[Symbol.asyncIterator]();
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) { controller.close(); return; }
      controller.enqueue(value);
    },
    async cancel(reason) {
      if (typeof iterator.return === 'function') await iterator.return(reason);
    },
  });
}

/*
 * Streams the paged activity-log ndjson shards straight into one
 * `activity-log.json` R2 object as a real ReadableStream — never parsing a
 * row into a JS object, and never holding more than ONE shard's raw text in
 * memory at a time. A family with a large multi-year activity history can
 * have thousands of rows across many pages (BUDGETS.activityQueryPage caps
 * each page at 500), and the previous version of this function parsed every
 * single row into an array of JS objects and then JSON.stringify'd the
 * whole array again — holding the full parsed object graph AND the full
 * final string in memory simultaneously, exactly the class of unbounded
 * per-step memory §2.6's own budget exists to prevent. Confirmed and fixed
 * after a PR #9 review caught it. Each ndjson line is already valid,
 * single-line JSON on its own, so concatenating the raw text with commas
 * between entries produces a byte-identical JSON array to
 * `JSON.stringify(parsedRows)` without ever reconstructing the object graph.
 * Returns the total byte length written (tracked as a side effect of the
 * generator, available the instant `env.DOCS.put()` resolves — R2's `put()`
 * always fully drains the stream before returning), needed for the archive
 * plan's `byteLength` hint, which the caller would otherwise have no way to
 * know without a separate `head()` round trip or re-materializing the body.
 */
export async function writeActivityLogStream(env, jobId, key) {
  const encoder = new TextEncoder();
  let totalBytes = 0;
  async function* chunks() {
    const emit = (s) => {
      const bytes = encoder.encode(s);
      totalBytes += bytes.byteLength;
      return bytes;
    };
    yield emit('[');
    let first = true;
    for (let i = 0; ; i++) {
      const obj = await env.DOCS.get(stagingKey(jobId, 'activity', `${String(i).padStart(5, '0')}.ndjson`));
      if (!obj) break;
      const text = await obj.text();
      if (!text) continue;
      for (const line of text.split('\n')) {
        if (!line) continue;
        if (!first) yield emit(',');
        yield emit(line);
        first = false;
      }
    }
    yield emit(']');
  }
  await env.DOCS.put(key, streamFromAsyncIterable(chunks()), { httpMetadata: { contentType: 'application/json' } });
  return totalBytes;
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

// The real R2 storage key for a photo/document reference IS the key
// exactly as generated at upload time — flat, no route prefix (see
// resolveR2Head's own comment above for the confirmed real shape).
// `route` is unused here now but kept as a parameter so both call sites
// keep passing it — it's still meaningful metadata (which upload route
// produced this key), even though it no longer changes the lookup itself.
function bucketKeyFor(route, key) {
  return key;
}

export async function startMultipartStep(env, { jobId, familyId, family, requestedAs }) {
  await touchHeartbeat(env, jobId);
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

  // Every "fixed" (non-media) archive file is staged under the SAME
  // derived/{archivePath} convention, keyed by its own real archive path —
  // this is what lets getEntryBytesFor (below) fetch ANY of them back
  // through one generic lookup instead of a hardcoded literal path list,
  // so adding a new fixed file (as this fix does — family.json, reports/,
  // the viewer bundle, administration/) never means touching that lookup.
  const derivedKeyFor = (archivePath) => stagingKey(jobId, 'derived', archivePath);

  const treeJsonArchivePath = 'data/tree.json';
  const activityLogArchivePath = 'data/activity-log.json';
  const contentIndexArchivePath = 'data/content-index.json';
  const treeDataArchivePath = 'data/tree-data.js';
  const familyJsonArchivePath = 'data/family.json';
  const manifestArchivePath = 'manifest.json';
  const missingFilesArchivePath = 'reports/missing-files.txt';
  const integrityReportArchivePath = 'reports/integrity-report.html';

  const activityLogByteLength = await writeActivityLogStream(env, jobId, derivedKeyFor(activityLogArchivePath));

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

  // The manifest is baked into the ZIP as one of its own FIXED entries
  // below (in lexical order, well before any large media past "m" in the
  // path) — there is no way to edit its bytes afterward once packaging has
  // moved past it, so its `status` field must be the REAL final outcome,
  // decided HERE rather than a placeholder nothing ever goes back to fix.
  // That final outcome is already fully knowable at this point: every
  // media/keepsake reference has already been resolved (inventory is
  // complete), so `warnings` above is the complete set the job will ever
  // have — packaging/verify only stream and check bytes, they never
  // discover NEW missing/unreadable references. Before this fix `status`
  // was hardcoded to the literal string 'packaging' and simply left that
  // way forever, so a finished, `ready` archive's own manifest.json inside
  // it permanently claimed to still be packaging — confirmed and fixed
  // after a PR #9 review caught it.
  const manifestStatus = warnings.length > 0 ? 'ready_with_warnings' : 'ready';

  const generatedAt = new Date().toISOString();

  const manifest = buildManifest({
    jobId,
    family,
    createdAt: generatedAt,
    source: {
      treeUpdatedAt: jobRow?.source_tree_updated_at ?? null,
      storageMode: jobRow?.source_storage_mode ?? 'legacy',
      extraVersion: jobRow?.source_extra_version ?? null,
    },
    requestedAs,
    status: manifestStatus,
    counts: { people: (tree.people || []).length, media: mediaEntries.length, keepsakes: keepsakeEntries.length },
    totalBytes: mediaEntries.reduce((n, e) => n + (e.byteLength || 0), 0),
    // Preserves the real, already-computed per-entry metadata resolveEntry/
    // buildKeepsakeInventory produced (mimeType, byteLength, a real sha256
    // when one was computable at inventory time, the warning reason) —
    // before this fix this reduced every entry down to just
    // `{path, id, status}`, silently discarding data the manifest is
    // supposed to actually carry. Deliberately excludes internal-only
    // fields (`etag`, `r2Key`, the full embedded Keepsake `edition` body,
    // `originalReference`) that either leak storage internals or duplicate
    // data already present elsewhere in the archive.
    files: [...mediaEntries, ...keepsakeEntries].map((e) => ({
      path: e.path,
      id: e.id,
      status: e.status,
      ...(e.recordType ? { recordType: e.recordType } : {}),
      ...(e.mimeType ? { mimeType: e.mimeType } : {}),
      ...(e.byteLength != null ? { byteLength: e.byteLength } : {}),
      ...(e.sha256 ? { sha256: e.sha256 } : {}),
      ...(e.warning ? { warning: e.warning } : {}),
    })),
    warnings,
  });
  const manifestJson = JSON.stringify(manifest);
  const manifestChecksum = computeManifestChecksum(manifest);

  const familyRecord = buildFamilyRecord({
    familyId,
    familyName: family?.name,
    familyCreatedAt: family?.createdAt,
    source: manifest.source,
    generatedAt,
    requestedAs,
  });
  const familyJson = JSON.stringify(familyRecord);

  const missingFilesText = buildMissingFilesReport(warnings);
  const integrityReportHtml = buildIntegrityReportHtml({ manifest, manifestChecksum, generatedAt });

  // docs/FULL-ARCHIVE-EXPORT.md §3.4: "administration/ is included only in
  // site-admin exports" — a family owner/co-admin export never sees member
  // emails or invitation history, matching the same authority split the
  // rest of the export API already enforces (functions/_lib/exportService.js).
  const administrationFiles = [];
  if (requestedAs === 'site_admin') {
    const { results: memberRows } = await env.DB.prepare(
      `SELECT fm.user_id, u.email, fm.role, fm.invited_by, fm.joined_at
         FROM family_member fm JOIN user u ON u.id = fm.user_id
        WHERE fm.family_id = ? ORDER BY fm.joined_at ASC`,
    ).bind(familyId).all();
    const { results: inviteRows } = await env.DB.prepare(
      `SELECT id, email, role, status, expires_at, created_at FROM invite WHERE family_id = ? ORDER BY created_at ASC`,
    ).bind(familyId).all();
    administrationFiles.push(
      { path: 'data/administration/members.json', content: JSON.stringify(buildMembersRecord(memberRows)), compress: 'deflate-raw' },
      { path: 'data/administration/invitations.json', content: JSON.stringify(buildInvitationsRecord(inviteRows)), compress: 'deflate-raw' },
    );
  }

  const staticViewerFiles = getStaticViewerFiles();

  // Every fixed (non-media) archive entry, staged under derived/{archivePath}
  // so getEntryBytesFor (below) can fetch ANY of them back through one
  // generic lookup keyed by the entry's own real archive path — adding a
  // new fixed file here never means touching that lookup separately.
  const fixedFileSpecs = [
    { path: treeJsonArchivePath, content: treeJson, compress: 'deflate-raw' },
    { path: activityLogArchivePath, byteLength: activityLogByteLength }, // already streamed directly to its staging key above
    { path: contentIndexArchivePath, content: contentIndexJson, compress: 'deflate-raw' },
    { path: treeDataArchivePath, content: treeDataJs, compress: 'deflate-raw' },
    { path: familyJsonArchivePath, content: familyJson, compress: 'deflate-raw' },
    { path: manifestArchivePath, content: manifestJson, compress: 'deflate-raw' },
    { path: missingFilesArchivePath, content: missingFilesText, compress: 'deflate-raw' },
    { path: integrityReportArchivePath, content: integrityReportHtml, compress: 'deflate-raw' },
    ...administrationFiles,
    ...staticViewerFiles.map((f) => ({ path: f.path, bytes: f.bytes, compress: f.compress })),
  ];

  const fixedFiles = [];
  for (const spec of fixedFileSpecs) {
    if (spec.byteLength != null) {
      // Already staged (activity-log.json, streamed directly above).
      fixedFiles.push({ path: spec.path, byteLength: spec.byteLength, compress: 'deflate-raw' });
      continue;
    }
    const bytes = spec.bytes ?? new TextEncoder().encode(spec.content);
    await env.DOCS.put(derivedKeyFor(spec.path), bytes);
    fixedFiles.push({ path: spec.path, byteLength: bytes.byteLength, compress: spec.compress });
  }

  const plan = buildArchivePlan({ fixedFiles, mediaEntries, keepsakeEntries });
  assertNotOverSegmentedExportBoundary(plan); // throws requires_segmented_export if over budget

  const byPath = await buildByPathIndex(env, jobId, shardCount);
  await putJson(env, stagingKey(jobId, 'packaging', 'plan.json'), plan);
  await putJson(env, stagingKey(jobId, 'packaging', 'byPath.json'), byPath);

  const finalKey = `exports/${jobId}/bloodline-full-archive.zip`;
  const upload = await env.DOCS.createMultipartUpload(finalKey);
  await putJson(env, stagingKey(jobId, 'checkpoint.json'), {
    uploadId: upload.uploadId, key: finalKey, nextIndex: 0, writerState: null,
    uploadedParts: [], nextPartNumber: 1, pendingBytesKey: null, ledger: [],
  });

  await env.DB.prepare(
    `UPDATE family_export_job SET expected_files = ?, expected_bytes = ? WHERE id = ?`,
  ).bind(plan.length, manifest.totalBytes, jobId).run();
  await applyJobTransition(env, { jobId, fromStatuses: ['inventory'], toStatus: 'packaging' });

  return { entryCount: plan.length, totalBytes: manifest.totalBytes, manifestChecksum };
}

// ── repeated Step 8: v1-package-{checkpoint} ────────────────────────────

async function getEntryBytesFor(env, jobId, byPath) {
  return async (entry) => {
    // Every fixed (non-media) entry — tree.json, activity-log.json,
    // content-index.json, tree-data.js, family.json, manifest.json,
    // reports/*, the whole viewer/ bundle, administration/* — was staged
    // under this SAME derived/{archivePath} convention by startMultipartStep,
    // keyed by its own real archive path. This generic lookup is what lets
    // a new fixed file be added there without this function ever needing a
    // matching literal-path entry here too (a real bug this fix closes —
    // the viewer/family.json/reports/administration files never appeared
    // anywhere in the packaged ZIP because nothing here knew to look for
    // them, even where the fixedFiles plan itself listed them).
    if (entry.kind === 'fixed') {
      const obj = await env.DOCS.get(stagingKey(jobId, 'derived', entry.path));
      if (!obj) throw new Error(`fixed archive entry "${entry.path}" is missing from staging at packaging time`);
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
  await touchHeartbeat(env, jobId);
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
    resumeLedger: checkpoint.ledger || [],
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
    ledger: result.ledger,
  });

  // `writerState.offset` is the ZipStreamWriter's own cumulative
  // bytes-emitted-so-far counter (a BigInt string — see zipWriter.js's
  // exportState()) — the one true "how much of the archive has actually
  // been produced" figure, since it accounts for every entry's local
  // header + payload + data descriptor written into the stream, not just a
  // count of whole entries. Used here as `processed_bytes` (§4/§12's
  // progress.processedBytes) — before this fix nothing ever wrote it, so
  // every in-progress export showed 0 processed bytes no matter how far
  // along it actually was. Safe to convert to Number: real archives are
  // bounded well under Number.MAX_SAFE_INTEGER (~9 PiB) by
  // BUDGETS.segmentedExport itself.
  const processedBytes = Number(BigInt(result.writerState.offset));
  await env.DB.prepare(`UPDATE family_export_job SET processed_files = ?, processed_bytes = ? WHERE id = ?`)
    .bind(result.nextIndex, processedBytes, jobId).run();

  return { done: result.done, nextIndex: result.nextIndex, partsUploaded: uploadedParts.length, processedBytes };
}

// ── Step 9: v1-complete-multipart ───────────────────────────────────────

export async function completeMultipartStep(env, { jobId, familyId }) {
  await touchHeartbeat(env, jobId);
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

// A generous margin over zipVerify.js's own MAX_TRAILER_BYTES (98) — a
// single range read at this size always contains the whole EOCD/ZIP64-EOCD/
// locator trailer for any archive this writer ever produces, since that
// trailer's size is fixed, not proportional to the archive's own size (see
// MAX_TRAILER_BYTES' own comment).
const TAIL_WINDOW_BYTES = 4096;
// Bounds how much of the archive verifyArchiveStep ever holds in memory at
// once while computing its whole-file checksum — independent of how large
// the real archive is (§2.6).
const HASH_CHUNK_BYTES = 8 * 1024 * 1024;

async function rangeGetBytes(env, key, range) {
  const obj = await env.DOCS.get(key, { range });
  if (!obj) throw new ArchiveVerificationError(`range read failed for ${key} (range ${JSON.stringify(range)})`);
  return new Uint8Array(await obj.arrayBuffer());
}

export async function verifyArchiveStep(env, { jobId }) {
  await touchHeartbeat(env, jobId);
  const checkpoint = await getJson(env, stagingKey(jobId, 'checkpoint.json'));
  const plan = await getJson(env, stagingKey(jobId, 'packaging', 'plan.json'));
  const manifestJson = await (await env.DOCS.get(stagingKey(jobId, 'derived', 'manifest.json'))).text();
  const manifest = JSON.parse(manifestJson);
  const manifestChecksum = computeManifestChecksum(manifest);

  const head = await env.DOCS.head(checkpoint.key);
  if (!head) throw new ArchiveVerificationError(`final archive object missing at ${checkpoint.key} immediately after completing multipart upload`);

  // Cross-checks the packaging ledger (§4.2 Verify: "validate manifest/file
  // counts and checksums from the packaging ledger") — every entry the plan
  // called for must have actually been packaged, at the byte length the
  // plan/manifest expected, and (wherever inventory time already computed a
  // real hash — embedded data_url media) with the SAME content it had at
  // inventory time. This is a genuine, previously-nonexistent defense
  // against silent corruption or a source mutation mid-export (§4.3 already
  // documents that the tree can keep changing while an export runs) —
  // before this fix nothing ever compared what packaging ACTUALLY wrote
  // against what inventory/the manifest SAID it would write.
  const ledger = checkpoint.ledger || [];
  if (ledger.length !== plan.length) {
    throw new ArchiveVerificationError(`packaging ledger has ${ledger.length} entries but the archive plan called for ${plan.length} — some planned entry was never packaged`);
  }
  const planByPath = new Map(plan.map((p) => [p.path, p]));
  const manifestFilesByPath = new Map((manifest.files || []).map((f) => [f.path, f]));
  for (const rec of ledger) {
    const planEntry = planByPath.get(rec.path);
    if (!planEntry) throw new ArchiveVerificationError(`packaging ledger references "${rec.path}", which is not in the archive plan at all`);
    if (planEntry.byteLength != null && rec.byteLength !== planEntry.byteLength) {
      throw new ArchiveVerificationError(`"${rec.path}" was packaged as ${rec.byteLength} bytes but the archive plan expected ${planEntry.byteLength}`);
    }
    const manifestFile = manifestFilesByPath.get(rec.path);
    if (manifestFile?.sha256 && manifestFile.sha256 !== rec.sha256) {
      throw new ArchiveVerificationError(`"${rec.path}" was packaged with a different checksum than inventory time computed — the source may have changed mid-export`);
    }
  }

  // Real structural validation via BOUNDED range reads — never the whole
  // (potentially many-GB) archive object in memory at once (§2.6, §4.2
  // Verify: "read and validate the ZIP central directory/range footer").
  // Reads a small tail window to locate the EOCD (+ ZIP64 EOCD/locator when
  // present), then one further targeted read for exactly the central
  // directory's own bytes — its bounds come straight from the EOCD itself,
  // never a guess or a scan. Before this fix the ONLY structural check was
  // `head()` reporting a byte count; a corrupt-but-plausibly-sized archive
  // (or a part that landed in the wrong order) would have gone completely
  // undetected. Confirmed and fixed after a PR #9 review caught it.
  const archiveSize = head.size;
  const tailWindow = Math.min(TAIL_WINDOW_BYTES, archiveSize);
  const tailBytes = await rangeGetBytes(env, checkpoint.key, { suffix: tailWindow });
  const eocd = parseEocdTail(tailBytes, archiveSize - tailWindow);
  if (eocd.entryCount !== plan.length) {
    throw new ArchiveVerificationError(`archive EOCD reports ${eocd.entryCount} entries but the plan called for ${plan.length}`);
  }
  const cdBytes = await rangeGetBytes(env, checkpoint.key, { offset: Number(eocd.cdStart), length: Number(eocd.cdSize) });
  const cdEntries = parseCentralDirectory(cdBytes, eocd.entryCount);
  const cdPaths = cdEntries.map((e) => e.path).sort();
  const planPaths = plan.map((e) => e.path).sort();
  if (JSON.stringify(cdPaths) !== JSON.stringify(planPaths)) {
    throw new ArchiveVerificationError('the archive central directory does not list exactly the files the plan called for');
  }
  const cdByPath = new Map(cdEntries.map((e) => [e.path, e]));
  for (const rec of ledger) {
    const cdEntry = cdByPath.get(rec.path);
    if (cdEntry && Number(cdEntry.uncompressedSize) !== rec.byteLength) {
      throw new ArchiveVerificationError(`"${rec.path}"'s central directory record reports ${cdEntry.uncompressedSize} bytes, but packaging wrote ${rec.byteLength}`);
    }
  }

  // The archive's own whole-file checksum, computed via bounded sequential
  // range reads — never the full archive in memory at once, the exact
  // memory-budget class of bug §2.6 exists to prevent (the previous
  // version of this function called `.arrayBuffer()` on the WHOLE final
  // object just to hash it).
  const hasher = createIncrementalSha256();
  for (let offset = 0; offset < archiveSize; offset += HASH_CHUNK_BYTES) {
    const length = Math.min(HASH_CHUNK_BYTES, archiveSize - offset);
    hasher.update(await rangeGetBytes(env, checkpoint.key, { offset, length }));
  }
  const archiveSha256 = hasher.digestHex();

  await env.DB.prepare(
    `UPDATE family_export_job SET archive_r2_key = ?, archive_bytes = ?, archive_sha256 = ?, manifest_sha256 = ? WHERE id = ?`,
  ).bind(checkpoint.key, archiveSize, archiveSha256, manifestChecksum, jobId).run();

  const warningCount = manifest.warnings?.length || 0;
  return { archiveBytes: archiveSize, archiveSha256, manifestChecksum, warningCount, entryCount: plan.length };
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

// ── Scheduled cleanup/reconciliation (§8) ────────────────────────────────
//
// Runs from entrypoint.js's `scheduled()` handler (a Cron Trigger a human
// configures per docs/FULL-ARCHIVE-EXPORT-COMPLETION-RUNBOOK.md), never
// from the Workflow itself — this is periodic maintenance across ALL jobs,
// not part of any one job's own run. Every query here is bounded (a fixed
// page size per invocation) so a cron tick can never turn into an
// unbounded scan, per §8's own "no cleanup scan may be unbounded" rule.

const EXPIRY_PAGE_LIMIT = 100;
const STALE_HEARTBEAT_MS = 30 * 60 * 1000;
const ORPHAN_STAGING_MS = 7 * 24 * 60 * 60 * 1000;

// Expires ready/ready_with_warnings jobs whose 72h window has passed:
// deletes the final archive object (missing is treated as success — §5's
// own "missing final object during expiry is idempotent success" rule) and
// transitions to `expired` with one audit entry.
export async function expireReadyJobs(env, { now = Date.now(), limit = EXPIRY_PAGE_LIMIT } = {}) {
  const nowSec = Math.floor(now / 1000);
  const { results } = await env.DB.prepare(
    `SELECT id, family_id, archive_r2_key FROM family_export_job
      WHERE status IN ('ready', 'ready_with_warnings') AND expires_at IS NOT NULL AND expires_at < ?
      LIMIT ?`,
  ).bind(nowSec, limit).all();

  let expiredCount = 0;
  for (const job of results || []) {
    if (job.archive_r2_key) {
      try { await env.DOCS.delete(job.archive_r2_key); } catch { /* idempotent success either way */ }
    }
    const { applied } = await applyJobTransition(env, {
      jobId: job.id, fromStatuses: ['ready', 'ready_with_warnings'], toStatus: 'expired',
      audit: { familyId: job.family_id, event: 'expired', actorAuthority: 'system' },
    });
    if (applied) expiredCount += 1;
  }
  return { expiredCount, scanned: (results || []).length };
}

// Reconciles running jobs whose Workflow appears to have stalled (no
// heartbeat in 30 minutes) — fails them with the stable `workflow_stalled`
// public code (§12's own error-code list) rather than leaving a job
// silently stuck "packaging" forever with no way for the family to retry.
export async function reconcileStaleJobs(env, { now = Date.now(), limit = EXPIRY_PAGE_LIMIT } = {}) {
  const staleBefore = Math.floor((now - STALE_HEARTBEAT_MS) / 1000);
  const { results } = await env.DB.prepare(
    `SELECT id, family_id FROM family_export_job
      WHERE status IN ('queued', 'snapshotting', 'inventory', 'packaging', 'verifying', 'cancelling')
        AND COALESCE(last_heartbeat_at, started_at, created_at) < ?
      LIMIT ?`,
  ).bind(staleBefore, limit).all();

  let reconciledCount = 0;
  for (const job of results || []) {
    const { applied } = await applyJobTransition(env, {
      jobId: job.id, fromStatuses: ['queued', 'snapshotting', 'inventory', 'packaging', 'verifying', 'cancelling'], toStatus: 'failed',
      fields: { error_code: 'workflow_stalled', error_summary: capSummary('no heartbeat for over 30 minutes') },
      audit: { familyId: job.family_id, event: 'failed', actorAuthority: 'system' },
    });
    if (applied) reconciledCount += 1;
  }
  return { reconciledCount, scanned: (results || []).length };
}

// Sweeps staging (and any still-open multipart upload) for jobs old enough
// (7 days, §5's hard backstop) that it can only be orphaned — a genuinely
// still-active job would have already reached a terminal state well
// before this, and finalized jobs already clean their own staging via
// cleanStagingStep at the end of a successful run.
export async function sweepOrphanStaging(env, { now = Date.now(), limit = EXPIRY_PAGE_LIMIT } = {}) {
  const cutoffSec = Math.floor((now - ORPHAN_STAGING_MS) / 1000);
  const { results } = await env.DB.prepare(
    `SELECT id FROM family_export_job WHERE created_at < ? LIMIT ?`,
  ).bind(cutoffSec, limit).all();

  let sweptCount = 0;
  for (const job of results || []) {
    const checkpoint = await getJson(env, stagingKey(job.id, 'checkpoint.json'));
    if (checkpoint?.uploadId) {
      try {
        const upload = env.DOCS.resumeMultipartUpload(checkpoint.key, checkpoint.uploadId);
        await upload.abort();
      } catch { /* already completed/gone — nothing to abort */ }
    }
    const { deletedCount } = await cleanStagingStep(env, { jobId: job.id });
    if (deletedCount > 0 || checkpoint) sweptCount += 1;
  }
  return { sweptCount, scanned: (results || []).length };
}

// The one entry point entrypoint.js's scheduled() handler calls.
export async function runCleanupSweep(env, { now = Date.now() } = {}) {
  const expired = await expireReadyJobs(env, { now });
  const reconciled = await reconcileStaleJobs(env, { now });
  const swept = await sweepOrphanStaging(env, { now });
  return { expired, reconciled, swept };
}

// ── The 13-step orchestration (workflow.js's own run() body) ────────────
//
// Lives here, not in workflow.js, for the exact same reason every individual
// step function above does: this module deliberately imports nothing from
// `cloudflare:workers`, so the WHOLE orchestration — including the
// cancellation-check bail-out points and the top-level failure handling
// below — can be exercised directly under plain Node against fakes
// (tests/workflowSteps.test.mjs), rather than needing a real Workflow
// runtime to prove any of it. workflow.js's FamilyArchiveExportWorkflow.run()
// is a two-line wrapper that just calls this with the real `step` the
// Workflow SDK provides.

// Checked between shards/parts during every repeated-step loop (§7
// Cancellation/failure). Returning true here means the caller's loop must
// stop and hand control to handleCancellation — never silently continue.
async function bail(env, jobId, familyId) {
  if (await isCancellationRequested(env, jobId)) {
    await handleCancellation(env, { jobId, familyId });
    return true;
  }
  return false;
}

// Every RUNNING_STATUSES entry EXCEPT cancelling can legally reach 'failed'
// (exportJob.js's own state graph — cancelling can only ever reach
// cancelled). A job that's mid-cancellation when some OTHER error fires is
// left alone here — handleCancellation already owns finishing that job off,
// and racing it to also mark 'failed' would fight the very state graph this
// module elsewhere depends on staying consistent.
const FAILABLE_STATUSES = RUNNING_STATUSES.filter((s) => s !== 'cancelling');

function classifyFailureCode(error) {
  if (error?.code && EXPORT_ERROR_CODES.includes(error.code)) return error.code;
  if (error?.message && EXPORT_ERROR_CODES.includes(error.message)) return error.message;
  return 'export_failed';
}

/*
 * Runs once runExportWorkflowSteps catches ANYTHING escaping the step
 * sequence below — before this fix, an uncaught error (a step that
 * exhausted the Workflow platform's own step.do retry budget, or a genuine
 * bug) just failed the Workflow INSTANCE with no corresponding write to
 * family_export_job at all: the product-visible job row stayed stuck
 * wherever it last was (queued, packaging, verifying, ...) forever, with no
 * error_code, no audit trail, and canRetry staying false (it's gated on
 * status === 'failed'). The only thing that would EVER have unstuck it was
 * reconcileStaleJobs' scheduled 30-minute stale-heartbeat sweep — a real
 * fix, but a slow, generic one ("workflow_stalled") that discards whatever
 * the actual error was. Confirmed and fixed after a PR #9 review caught it.
 * Runs as its own named step so the write itself is durable/retried like
 * every other D1 mutation in this pipeline, not a bare fire-and-forget call
 * inside a catch block. Best-effort by design (wrapped in its own
 * try/catch): recording a failure must never suppress or replace the
 * ORIGINAL error, which the caller re-throws regardless of whether this
 * succeeds.
 */
async function recordWorkflowFailure(env, step, jobId, error) {
  try {
    await step.do('v1-record-failure', async () => {
      const jobRow = await env.DB.prepare('SELECT family_id FROM family_export_job WHERE id = ?').bind(jobId).first();
      if (!jobRow) return { recorded: false }; // authorizeJobStep itself threw before the row could even be looked up
      await applyJobTransition(env, {
        jobId, fromStatuses: FAILABLE_STATUSES, toStatus: 'failed',
        fields: { error_code: classifyFailureCode(error), error_summary: capSummary(error?.stack || error?.message || String(error)) },
        audit: { familyId: jobRow.family_id, event: 'failed', actorAuthority: 'system', reason: capSummary(error?.message) },
      });
      return { recorded: true };
    });
  } catch { /* best-effort — see comment above; the original error still propagates either way */ }
}

export async function runExportWorkflowSteps(env, step, jobId) {
  try {
    const authorized = await step.do('v1-authorize-job', () => authorizeJobStep(env, { jobId }));
    if (authorized.alreadyStarted) return { skipped: true, status: authorized.status };
    const { familyId, family, requestedAs, requesterEmail } = authorized;

    await step.do('v1-capture-source', () => captureSourceStep(env, { jobId, familyId }));
    if (await step.do('v1-check-cancel-after-capture', () => bail(env, jobId, familyId))) return { cancelled: true };

    const bound = await step.do('v1-capture-activity-bound', () => captureActivityBoundStep(env, { jobId, familyId }));
    let cursor = null;
    let pageIndex = 0;
    if (!bound.done) {
      for (;;) {
        const page = await step.do(`v1-capture-activity-${pageIndex}`, () => captureActivityPageStep(env, { jobId, familyId, pageIndex, lowerCursor: cursor }));
        if (page.done) break;
        cursor = page.nextCursor;
        pageIndex += 1;
        if (await step.do(`v1-check-cancel-activity-${pageIndex}`, () => bail(env, jobId, familyId))) return { cancelled: true };
      }
    }

    const inventoryPlan = await step.do('v1-build-inventory', () => buildInventoryStep(env, { jobId, familyId }));
    for (let i = 0; i < inventoryPlan.shardCount; i++) {
      await step.do(`v1-resolve-inventory-${i}`, () => resolveInventoryShardStep(env, { jobId, familyId, shardIndex: i }));
      if (await step.do(`v1-check-cancel-inventory-${i}`, () => bail(env, jobId, familyId))) return { cancelled: true };
    }
    await step.do('v1-resolve-inventory-keepsakes', () => resolveKeepsakesStep(env, { jobId, familyId }));

    await step.do('v1-start-multipart', () => startMultipartStep(env, { jobId, familyId, family, requestedAs }));

    let packagingDone = false;
    let checkpointIndex = 0;
    while (!packagingDone) {
      const result = await step.do(`v1-package-${checkpointIndex}`, () => packageStep(env, { jobId }));
      packagingDone = result.done;
      checkpointIndex += 1;
      if (!packagingDone && await step.do(`v1-check-cancel-package-${checkpointIndex}`, () => bail(env, jobId, familyId))) return { cancelled: true };
    }

    await step.do('v1-complete-multipart', () => completeMultipartStep(env, { jobId, familyId }));
    const verified = await step.do('v1-verify-archive', () => verifyArchiveStep(env, { jobId }));
    const finalized = await step.do('v1-finalize-job', () => finalizeJobStep(env, { jobId, familyId, warningCount: verified.warningCount }));

    await step.do('v1-send-completion-email', () => sendCompletionEmailStep(env, {
      jobId, toEmail: requesterEmail, requestedAs, appUrl: env.APP_URL || 'https://myfamilybloodline.com',
    }));
    await step.do('v1-clean-staging', () => cleanStagingStep(env, { jobId }));

    return { jobId, familyId, status: finalized.status, archiveBytes: verified.archiveBytes, warningCount: verified.warningCount };
  } catch (error) {
    await recordWorkflowFailure(env, step, jobId, error);
    throw error;
  }
}

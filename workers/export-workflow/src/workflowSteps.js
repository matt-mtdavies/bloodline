import { loadFullTree } from '../../../functions/_lib/treeStore.js';
import { applyJobTransition } from '../../../functions/_lib/exportJob.js';
import {
  captureUpperBound, buildActivityLogPageQuery, ActivityLogUnavailableError,
} from './lib/activityLog.js';
import { deriveMediaReferences, resolveEntry, buildKeepsakeInventory } from './lib/inventory.js';
import { shardByBudget, BUDGETS } from './lib/budgets.js';
import { mapWithConcurrency } from './lib/concurrency.js';

/*
 * Steps 1-6 of the stable step plan (docs/FULL-ARCHIVE-EXPORT-COMPLETION-PHASE.md
 * §7): authorize, capture-source, capture-activity (bound + paged),
 * build-inventory, resolve-inventory (per shard + Keepsakes). Steps 7-13
 * (multipart packaging/verification/finalize/email/cleanup) are a later
 * slice.
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

  // A duplicate/replayed Workflow instance for the same job (§6's "ambiguous/
  // repeated RPC calls return the existing legitimate instance"), or a job
  // cancelled before the Workflow ever ran — either way, this run has
  // nothing left to authorize. The caller's run() checks `alreadyStarted`
  // and returns early rather than treating this as a failure.
  if (job.status !== 'queued') {
    return { alreadyStarted: true, status: job.status, familyId: job.family_id };
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
  return { alreadyStarted: !applied, status: applied ? 'snapshotting' : job.status, familyId: job.family_id };
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

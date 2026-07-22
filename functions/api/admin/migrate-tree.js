import { json } from '../../_lib/util.js';
import { adminEmailList, isAdminEmail } from '../../_lib/adminAuth.js';
import { loadTree, upsertTreeStatement, snapshotStatements, splitTree, reassembleTree, putExtra } from '../../_lib/treeStore.js';

/*
 * POST /api/admin/migrate-tree  — { familyId }
 *
 * The one-time, per-family migration step docs/TREE-STORAGE.md's Phase 2
 * has been building toward: moves one family from the legacy single-blob
 * shape to core (D1) + extra (R2). Deliberately NOT automatic, NOT batched,
 * and NOT wired into any request path a normal save goes through — every
 * other Phase 2 change (tree.js, the snapshot-restore endpoint, admin/
 * stats.js) already treats "is this family migrated" as a fact to read,
 * never to decide. This is the one place that fact gets SET, and it's
 * meant to be run by a human, one family_id at a time, watching the
 * result — see docs/TREE-STORAGE.md §9's staged rollout order (a
 * disposable test family, then this account specifically, then everyone
 * else in small batches).
 *
 * Safety, in order:
 *   1. Idempotent — a family that's already migrated returns immediately,
 *      untouched.
 *   2. Verify BEFORE writing anything: splitTree then reassembleTree, and
 *      only proceed if the result is deep-equal to the original tree —
 *      pure, in-memory, no I/O, so a mismatch is caught before a single
 *      byte moves anywhere. A verification failure touches nothing: this
 *      family is exactly as it was, safe to leave for review and retry
 *      later once the mismatch is understood.
 *   3. A fresh family_tree_snapshot archive of the pre-migration row,
 *      taken immediately before this write, same as any other overwrite
 *      of the live row (docs/TREE-STORAGE.md §7 mechanism 1) — on top of
 *      the one-time, whole-database `wrangler d1 export` backup a human
 *      takes before running this against real families at all (§7
 *      mechanism 2, an operational step, not something this endpoint can
 *      do for you).
 *   4. R2-before-D1 (§6.3): extra is written first; the D1 write is the
 *      single commit point. A failure between the two just leaves a
 *      harmless, unreferenced R2 object.
 */
export async function onRequestPost({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });
  if (!env.DOCS) return json({ error: 'Storage not configured' }, { status: 503 });
  if (!adminEmailList(env).length) return json({ error: 'ADMIN_EMAILS not configured' }, { status: 503 });
  if (!isAdminEmail(env, data.user.email)) return json({ error: 'Forbidden' }, { status: 403 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, { status: 400 });
  }
  const familyId = body?.familyId;
  if (!familyId || typeof familyId !== 'string') {
    return json({ error: 'familyId is required' }, { status: 400 });
  }

  try {
    const row = await loadTree(env, familyId);
    if (!row) return json({ error: 'No family_tree row for that family' }, { status: 404 });

    let tree;
    try {
      tree = JSON.parse(row.raw);
    } catch (e) {
      return json({ error: "This family's tree_json is corrupt — cannot safely migrate", detail: e.message }, { status: 500 });
    }

    if (tree._extraVersion != null) {
      return json({ ok: true, familyId, alreadyMigrated: true });
    }

    const { core, extra } = splitTree(tree);
    const reassembled = reassembleTree(core, extra);

    if (!deepEqual(reassembled, tree)) {
      console.error('[admin/migrate-tree] verification failed for', familyId, '— nothing written');
      return json({
        ok: false,
        familyId,
        error: 'Verification failed — the reassembled tree did not exactly match the original. Nothing was written.',
      }, { status: 500 });
    }

    const now = Math.floor(Date.now() / 1000);

    // Archive the pre-migration row, exactly like any other overwrite of
    // the live row — this is what makes "revert this specific family" a
    // real option even after a successful migration turns out to need
    // undoing for an unrelated reason. Same benign-vs-genuine classification
    // as tree.js's PUT: a not-yet-migrated family_tree_snapshot table must
    // never block the migration itself.
    let snapshotIssue = null;
    try {
      const snap = snapshotStatements(env, familyId, row.raw, now);
      if (snap) await env.DB.batch(snap);
    } catch (e) {
      if (/no such table/i.test(e.message || '')) {
        console.warn('[admin/migrate-tree] snapshot skipped — family_tree_snapshot not migrated yet:', e.message);
      } else {
        snapshotIssue = e.message || 'unknown error';
        console.error('[admin/migrate-tree] CRITICAL: pre-migration snapshot failed:', snapshotIssue);
      }
    }

    await putExtra(env, familyId, extra, now);
    const coreJsonString = JSON.stringify({ ...core, _extraVersion: now });
    await upsertTreeStatement(env, familyId, coreJsonString, now).run();

    return json({
      ok: true,
      familyId,
      alreadyMigrated: false,
      extraVersion: now,
      coreBytes: new TextEncoder().encode(coreJsonString).length,
      extraBytes: new TextEncoder().encode(JSON.stringify(extra)).length,
      snapshotIssue,
    });
  } catch (e) {
    console.error('[admin/migrate-tree] error:', e.message, e.stack);
    return json({ error: 'Server error', detail: e.message }, { status: 500 });
  }
}

// A plain structural deep-equal — no node:assert dependency (this runs in
// a Cloudflare Worker, not Node) and no reliance on key insertion order.
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

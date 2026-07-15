import { uid } from './util.js';

/*
 * Everything that reads or writes family_tree in one place (docs/TREE-
 * STORAGE.md Phase 1). This is a PURE REFACTOR — every function here does
 * exactly what its caller's hand-rolled SQL did before, byte for byte, one
 * column, nothing new stored anywhere. The point isn't behavior change; it's
 * that Phase 2's actual core/R2 split only has to change what's INSIDE these
 * functions, not every one of the nine places that used to touch this table
 * directly.
 *
 * Deliberately NOT covered here: functions/api/admin/stats.js (a cross-
 * family aggregate query, not a per-family load — a fundamentally different
 * shape of access that Phase 2 will need to rework on its own terms) and
 * functions/api/tree/snapshots.js (the snapshot LIST endpoint — reads only
 * family_tree_snapshot, never family_tree, and has no duplicated SQL
 * anywhere else worth centralizing).
 */

// Raw row read for one family — { raw, updatedAt }, or null when there's no
// row yet. Deliberately does NOT parse tree_json: every existing caller has
// its own idea of what to fall back to on missing/corrupt JSON (throw and
// 500, default to an empty shape, skip silently), and those genuinely
// differ from caller to caller today — so that decision stays with the
// caller. This function's only job is the SQL.
export async function loadTree(env, familyId) {
  const row = await env.DB.prepare(
    'SELECT tree_json, updated_at FROM family_tree WHERE family_id = ?',
  ).bind(familyId).first();
  return row ? { raw: row.tree_json, updatedAt: row.updated_at } : null;
}

// The plain unconditional upsert — functions/api/tree.js's normal save path.
// Returns the prepared statement (not executed) so the caller can batch it
// alongside its own extra statements (e.g. the family-name sync) in one
// round trip, exactly like today.
export function upsertTreeStatement(env, familyId, treeJsonString, updatedAt) {
  return env.DB.prepare(
    `INSERT INTO family_tree (family_id, tree_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT (family_id) DO UPDATE
       SET tree_json = excluded.tree_json,
           updated_at = excluded.updated_at`,
  ).bind(familyId, treeJsonString, updatedAt);
}

// functions/api/merge.js's compare-and-swap update: resolves with a
// changes:0 result if the row moved since it was read (a genuine
// concurrent save), exactly like today — the caller treats that as a 409.
export async function casUpdateTree(env, familyId, treeJsonString, updatedAt, expectedUpdatedAt) {
  return env.DB.prepare(
    `UPDATE family_tree SET tree_json = ?, updated_at = ?
      WHERE family_id = ? AND updated_at = ?`,
  ).bind(treeJsonString, updatedAt, familyId, expectedUpdatedAt).run();
}

// merge.js's "no row yet" path — a plain INSERT (no ON CONFLICT) so a
// genuine race — this family's very first save landing concurrently —
// throws and is treated as a conflict by the caller, exactly like today.
export async function insertOnlyTree(env, familyId, treeJsonString, updatedAt) {
  return env.DB.prepare(
    `INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES (?, ?, ?)`,
  ).bind(familyId, treeJsonString, updatedAt).run();
}

// functions/_lib/invite.js's unconditional update — only ever called when
// the row is already known to exist, so no upsert/insert branch is needed.
export async function updateTree(env, familyId, treeJsonString, updatedAt) {
  return env.DB.prepare(
    `UPDATE family_tree SET tree_json = ?, updated_at = ? WHERE family_id = ?`,
  ).bind(treeJsonString, updatedAt, familyId).run();
}

// The pre-write archive both tree.js's PUT and the snapshot-restore
// endpoint need before overwriting the live row. Returns the two
// statements to batch (the insert, and pruning to the most recent 30 per
// family) — or null when there's nothing to archive yet (a family's very
// first save), so the caller can skip batching an empty group exactly
// like today.
export function snapshotStatements(env, familyId, existingTreeJson, now) {
  if (!existingTreeJson) return null;
  return [
    env.DB.prepare(
      `INSERT INTO family_tree_snapshot (id, family_id, tree_json, created_at) VALUES (?, ?, ?, ?)`,
    ).bind(uid('snap_'), familyId, existingTreeJson, now),
    env.DB.prepare(
      `DELETE FROM family_tree_snapshot WHERE family_id = ? AND id NOT IN (
         SELECT id FROM family_tree_snapshot WHERE family_id = ? ORDER BY created_at DESC LIMIT 30
       )`,
    ).bind(familyId, familyId),
  ];
}

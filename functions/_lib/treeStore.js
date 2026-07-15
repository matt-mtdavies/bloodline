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

// ── The core/extra split (docs/TREE-STORAGE.md §6) ─────────────────────────
//
// splitTree/reassembleTree are pure, I/O-free functions: the actual target
// shape Phase 2 stores (core in D1, extra in R2), built and proven correct
// here BEFORE any storage plumbing is wired to them. The load-bearing
// property every test in tests/tree-split.test.mjs checks is:
//
//   reassembleTree(...Object.values(splitTree(tree))) deep-equals tree
//
// for any tree shape the real client ever produces — not merely a shape
// that happens to be convenient.

// The exact allowlist for D1-resident "core" per §6.1 — everything else on
// a person object is "extra". Deliberately an allowlist, not a denylist: an
// unrecognized future field falls into extra (no ceiling) by default,
// never silently swelling core (which has one). Shared verbatim with
// functions/api/debug/tree.js's byte-breakdown diagnostic — both must
// agree on the same boundary, or the diagnostic could report a split that
// the real one wouldn't actually make.
export const CORE_PERSON_FIELDS = new Set([
  'id', 'display_name', 'photo', 'gender', 'is_living', 'is_deceased',
  'is_minor', 'birth_date', 'death_date', 'visibility', 'confidence',
  'claimed_by_user_id',
]);

// Top-level scalars small enough, and needed synchronously enough (graph
// topology, family identity), to stay in core. `people` and `_deleted` are
// handled separately below since both need decomposing, not a straight
// copy. Everything else present on the tree — memories, photos, documents,
// activity, and any future top-level key nobody's added yet — defaults to
// extra, the same "unknown things aren't core" principle as the person
// allowlist above.
const CORE_TOP_LEVEL_KEYS = new Set(['relationships', 'myPersonId', 'familyName', 'hasCompletedOnboarding', '_seq']);

// _deleted's tombstone kinds correspond 1:1 with the top-level collection
// they tombstone — people/relationships stay with core, everything else
// (memories/photos/documents, and any future kind) follows its collection
// into extra.
const CORE_DELETED_KINDS = new Set(['people', 'relationships']);

/*
 * Splits one full logical tree object into { core, extra } — core is what
 * D1 stores (small, forever); extra is what R2 stores (unbounded). Only
 * copies keys that are ACTUALLY PRESENT on the input — a legacy tree
 * missing a field that didn't exist when it was created stays missing on
 * both sides, rather than this function inventing a default value nothing
 * ever asked for. (memories/photos/documents/activity/people are always
 * present on any tree that has been through src/data/store.js's `EMPTY`
 * shape, so this precision matters most for older/optional scalars and
 * per-person fields, not for those six collections.)
 */
export function splitTree(tree) {
  const core = {};
  const extra = {};

  for (const [key, value] of Object.entries(tree)) {
    if (key === 'people' || key === '_deleted') continue;
    (CORE_TOP_LEVEL_KEYS.has(key) ? core : extra)[key] = value;
  }

  if ('people' in tree) {
    const peopleDetail = {};
    core.people = tree.people.map((person) => {
      const corePerson = {};
      const detail = {};
      for (const [k, v] of Object.entries(person)) {
        (CORE_PERSON_FIELDS.has(k) ? corePerson : detail)[k] = v;
      }
      if (Object.keys(detail).length) peopleDetail[person.id] = detail;
      return corePerson;
    });
    if (Object.keys(peopleDetail).length) extra.peopleDetail = peopleDetail;
  }

  if ('_deleted' in tree) {
    const coreDeleted = {};
    const extraDeleted = {};
    for (const [kind, map] of Object.entries(tree._deleted || {})) {
      (CORE_DELETED_KINDS.has(kind) ? coreDeleted : extraDeleted)[kind] = map;
    }
    // _deleted is always attached to core when present on the source tree
    // (even empty — `_deleted: {}` is the fresh-tree default in store.js's
    // EMPTY shape), so that presence round-trips faithfully; extra only
    // carries its half when there's actually something in it.
    core._deleted = coreDeleted;
    if (Object.keys(extraDeleted).length) extra._deleted = extraDeleted;
  }

  return { core, extra };
}

/*
 * The exact inverse of splitTree — reassembles core + extra into the one
 * logical tree object every existing caller already expects, unchanged
 * from what it receives today. `extra` may be `null`/`undefined` (an
 * unmigrated family, or an R2 read that came back empty) — every one of
 * its collections then degrades to absent, never to a thrown error.
 */
export function reassembleTree(core, extra) {
  const tree = {};

  for (const [k, v] of Object.entries(core || {})) {
    if (k === 'people' || k === '_deleted') continue;
    tree[k] = v;
  }
  for (const [k, v] of Object.entries(extra || {})) {
    if (k === 'peopleDetail' || k === '_deleted') continue;
    tree[k] = v;
  }

  if (core?.people) {
    const detail = extra?.peopleDetail || {};
    tree.people = core.people.map((p) => (detail[p.id] ? { ...p, ...detail[p.id] } : p));
  }

  if (core && '_deleted' in core) {
    tree._deleted = { ...core._deleted, ...(extra?._deleted || {}) };
  }

  return tree;
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

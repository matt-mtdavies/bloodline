import { json } from '../../_lib/util.js';

/*
 * GET /api/debug/tree
 *
 * Read-only diagnostic: returns the authenticated user's family context and
 * tree metadata. No writes. Used to triage "Not saved" errors in production,
 * and — since docs/TREE-STORAGE.md Phase 0 — to measure exactly where a real
 * tree's bytes go before locking in the core/extra split boundary in Phase 2.
 *
 * Returns: family_id, role, tree size (bytes), ETag, whether key rows exist
 * in the DB, and a `breakdown` of the tree by top-level key plus a per-person
 * split between the fields the graph/visualization needs synchronously
 * ("core", per docs/TREE-STORAGE.md §6.1) and everything else ("extra").
 * Safe to expose to any logged-in user — same bar as the rest of this file.
 */

// The exact allowlist proposed for D1-resident "core" in docs/TREE-STORAGE.md
// §6.1 — everything else on a person object counts as "extra" for this
// measurement. Deliberately an allowlist, not a denylist: an unrecognized
// future field falls into "extra" (no ceiling) by default, never silently
// swelling "core" (which has one).
const CORE_PERSON_FIELDS = new Set([
  'id', 'display_name', 'photo', 'gender', 'is_living', 'is_deceased',
  'is_minor', 'birth_date', 'death_date', 'visibility', 'confidence',
  'claimed_by_user_id',
]);

const enc = new TextEncoder();
function bytesOf(v) {
  return v === undefined ? 0 : enc.encode(JSON.stringify(v)).length;
}

// Splits one person's fields into a core-shaped object and an extra-shaped
// object, then measures each as its own JSON value — this estimates what
// the two would actually cost once they're real, separate stored objects
// (§6.1/§6.2), not just a proportion of today's combined bytes.
function splitPersonBytes(person) {
  const core = {}, extra = {};
  for (const [k, v] of Object.entries(person || {})) {
    (CORE_PERSON_FIELDS.has(k) ? core : extra)[k] = v;
  }
  return { core: bytesOf(core), extra: bytesOf(extra) };
}

function breakdownOf(tree) {
  const people = Array.isArray(tree.people) ? tree.people : [];
  const relationships = Array.isArray(tree.relationships) ? tree.relationships : [];
  const memories = Array.isArray(tree.memories) ? tree.memories : [];
  const photos = Array.isArray(tree.photos) ? tree.photos : [];
  const documents = Array.isArray(tree.documents) ? tree.documents : [];
  const activity = Array.isArray(tree.activity) ? tree.activity : [];

  const peopleSplit = people.reduce((acc, p) => {
    const { core, extra } = splitPersonBytes(p);
    acc.core += core;
    acc.extra += extra;
    return acc;
  }, { core: 0, extra: 0 });

  const round = (n, d) => (d ? Math.round(n / d) : 0);

  return {
    people: {
      count: people.length,
      totalBytes: bytesOf(people),
      coreBytes: peopleSplit.core,
      extraBytes: peopleSplit.extra,
      avgCoreBytesPerPerson: round(peopleSplit.core, people.length),
      avgExtraBytesPerPerson: round(peopleSplit.extra, people.length),
    },
    relationships: { count: relationships.length, totalBytes: bytesOf(relationships) },
    memories: { count: memories.length, totalBytes: bytesOf(memories) },
    photos: { count: photos.length, totalBytes: bytesOf(photos) },
    documents: {
      count: documents.length,
      totalBytes: bytesOf(documents),
      // Isolated specifically because docs/TREE-STORAGE.md §3 names this as
      // the prime suspect for real bloat — never migrated to R2 unlike src.
      thumbBytes: documents.reduce((sum, d) => sum + bytesOf(d?.thumb), 0),
      extractedBytes: documents.reduce((sum, d) => sum + bytesOf(d?.extracted), 0),
    },
    activity: { count: activity.length, totalBytes: bytesOf(activity) },
    deletedBytes: bytesOf(tree._deleted),
  };
}
export async function onRequestGet({ env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  const uid = data.user.uid;

  try {
    // 1. user row
    const userRow = await env.DB.prepare(
      'SELECT id, email, family_id FROM user WHERE id = ?',
    ).bind(uid).first();

    if (!userRow) {
      return json({ ok: false, issue: 'user_not_found', uid });
    }

    // 2. family_member row (using canonical family_id if set)
    const membership = userRow.family_id
      ? await env.DB.prepare(
          'SELECT family_id, role FROM family_member WHERE user_id = ? AND family_id = ?',
        ).bind(uid, userRow.family_id).first()
      : await env.DB.prepare(
          'SELECT family_id, role FROM family_member WHERE user_id = ?',
        ).bind(uid).first();

    if (!membership) {
      return json({
        ok: false,
        issue: 'no_family_membership',
        uid,
        user_family_id: userRow.family_id || null,
      });
    }

    // 3. family row
    const familyRow = await env.DB.prepare(
      'SELECT id, name FROM family WHERE id = ?',
    ).bind(membership.family_id).first();

    // 4. family_tree row — the full column, not just LENGTH(tree_json): the
    // byte breakdown below needs the actual content, and computing size via
    // TextEncoder here (rather than trusting SQLite's LENGTH(), which counts
    // characters, not bytes, for TEXT columns) matches exactly how tree.js's
    // own SIZE_WARN_BYTES/SIZE_HARD_STOP_BYTES check measures a save — this
    // diagnostic should never be able to report a different number than the
    // logic that actually enforces the limit.
    const treeRow = await env.DB.prepare(
      'SELECT updated_at, tree_json FROM family_tree WHERE family_id = ?',
    ).bind(membership.family_id).first();

    let bytes = null;
    let breakdown = null;
    if (treeRow?.tree_json) {
      bytes = new TextEncoder().encode(treeRow.tree_json).length;
      try {
        breakdown = breakdownOf(JSON.parse(treeRow.tree_json));
      } catch (e) {
        console.error('[debug/tree] tree_json unparseable, breakdown skipped:', e.message);
      }
    }

    // Can this user write?
    const canWrite = ['owner', 'coadmin', 'editor'].includes(membership.role);

    return json({
      ok: true,
      uid,
      email: data.user.email,
      family_id: membership.family_id,
      role: membership.role,
      can_write: canWrite,
      family_exists: !!familyRow,
      family_name: familyRow?.name || null,
      tree_exists: !!treeRow,
      tree_size_bytes: bytes,
      tree_size_kb: bytes != null ? Math.round(bytes / 1024) : null,
      etag: treeRow ? `"${treeRow.updated_at}"` : null,
      breakdown,
    });
  } catch (e) {
    console.error('[debug/tree] error:', e.message, e.stack);
    return json({ ok: false, issue: 'db_error', detail: e.message }, { status: 500 });
  }
}

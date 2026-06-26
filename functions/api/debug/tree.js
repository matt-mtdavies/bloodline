import { json } from '../../_lib/util.js';

/*
 * GET /api/debug/tree
 *
 * Read-only diagnostic: returns the authenticated user's family context and
 * tree metadata. No writes. Used to triage "Not saved" errors in production.
 *
 * Returns: family_id, role, tree size (bytes), ETag, and whether key rows
 * exist in the DB. Safe to expose to any logged-in user.
 */
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

    // 4. family_tree row
    const treeRow = await env.DB.prepare(
      'SELECT updated_at, LENGTH(tree_json) AS bytes FROM family_tree WHERE family_id = ?',
    ).bind(membership.family_id).first();

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
      tree_size_bytes: treeRow?.bytes ?? null,
      tree_size_kb: treeRow ? Math.round(treeRow.bytes / 1024) : null,
      etag: treeRow ? `"${treeRow.updated_at}"` : null,
    });
  } catch (e) {
    console.error('[debug/tree] error:', e.message, e.stack);
    return json({ ok: false, issue: 'db_error', detail: e.message }, { status: 500 });
  }
}

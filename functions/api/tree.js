import { json, uid } from '../_lib/util.js';

/*
 * GET /api/tree  — load the authenticated user's family tree.
 * PUT /api/tree  — save the authenticated user's family tree.
 *
 * Trees are scoped to a family (family_tree table). On the first PUT, if the
 * user has no family yet, one is auto-created and they become the owner.
 * When a user is invited, they share the inviting family's tree.
 */

export async function onRequestGet({ env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  const membership = await env.DB.prepare(
    `SELECT fm.family_id, fm.role, f.name as family_name
       FROM family_member fm JOIN family f ON f.id = fm.family_id
      WHERE fm.user_id = ?`,
  ).bind(data.user.uid).first();

  if (!membership) return json(null); // new user — client shows onboarding

  const row = await env.DB.prepare(
    'SELECT tree_json FROM family_tree WHERE family_id = ?',
  ).bind(membership.family_id).first();

  if (!row) return json(null);

  return json(
    { ...JSON.parse(row.tree_json), _meta: { familyId: membership.family_id, role: membership.role } },
    { headers: { 'cache-control': 'private, no-store' } },
  );
}

export async function onRequestPut({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  const tree = await request.json();
  const now = Math.floor(Date.now() / 1000);

  let membership = await env.DB.prepare(
    'SELECT family_id, role FROM family_member WHERE user_id = ?',
  ).bind(data.user.uid).first();

  if (!membership) {
    // First save — create the family and make this user the owner.
    const familyId = uid('f_');
    const familyName = tree.familyName || 'My Family';
    await env.DB.prepare(
      `INSERT INTO family (id, name, created_by, created_at) VALUES (?, ?, ?, ?)`,
    ).bind(familyId, familyName, data.user.uid, now).run();
    await env.DB.prepare(
      `INSERT INTO family_member (family_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)`,
    ).bind(familyId, data.user.uid, now).run();
    await env.DB.prepare(
      `UPDATE user SET family_id = ? WHERE id = ?`,
    ).bind(familyId, data.user.uid).run();
    membership = { family_id: familyId, role: 'owner' };
  }

  // Editors and above can write; contributors and viewers cannot.
  if (!['owner', 'coadmin', 'editor'].includes(membership.role)) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  await env.DB.prepare(
    `INSERT INTO family_tree (family_id, tree_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT (family_id) DO UPDATE
       SET tree_json = excluded.tree_json,
           updated_at = excluded.updated_at`,
  ).bind(membership.family_id, JSON.stringify(tree), now).run();

  return json({ ok: true, familyId: membership.family_id, role: membership.role });
}

import { json } from '../../_lib/util.js';

const ROLE_ORDER = { owner: 0, coadmin: 1, editor: 2, contributor: 3, viewer: 4 };

/*
 * GET  /api/family/members — list members + pending invites for the caller's family.
 * POST /api/family/members — update a member's role or remove them.
 */
export async function onRequestGet({ env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ members: [], invites: [] });

  const membership = await env.DB.prepare(
    `SELECT fm.family_id, fm.role, f.name as family_name
       FROM family_member fm JOIN family f ON f.id = fm.family_id
      WHERE fm.user_id = ?`,
  ).bind(data.user.uid).first();

  if (!membership) return json({ members: [], invites: [] });

  const [{ results: members }, { results: invites }] = await Promise.all([
    env.DB.prepare(
      `SELECT u.id, u.email, u.display_name, fm.role, fm.joined_at
         FROM family_member fm JOIN user u ON u.id = fm.user_id
        WHERE fm.family_id = ?
        ORDER BY fm.joined_at ASC`,
    ).bind(membership.family_id).all(),
    env.DB.prepare(
      `SELECT id, email, role, status, created_at, expires_at
         FROM invite WHERE family_id = ? AND status = 'pending'
        ORDER BY created_at DESC`,
    ).bind(membership.family_id).all(),
  ]);

  return json({
    familyId: membership.family_id,
    familyName: membership.family_name,
    myId: data.user.uid,
    myRole: membership.role,
    members: members.sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)),
    invites,
  });
}

export async function onRequestPost({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  const membership = await env.DB.prepare(
    'SELECT family_id, role FROM family_member WHERE user_id = ?',
  ).bind(data.user.uid).first();

  if (!membership || !['owner', 'coadmin'].includes(membership.role)) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  let action, targetUserId, newRole;
  try {
    ({ action, userId: targetUserId, role: newRole } = await request.json());
  } catch {
    return json({ error: 'Bad request' }, { status: 400 });
  }

  if (action === 'update-role') {
    if (!['coadmin', 'editor', 'contributor', 'viewer'].includes(newRole)) {
      return json({ error: 'Invalid role' }, { status: 400 });
    }
    // Only owner can promote to/demote from coadmin.
    if (newRole === 'coadmin' && membership.role !== 'owner') {
      return json({ error: 'Only the owner can set Co-Admin' }, { status: 403 });
    }
    await env.DB.prepare(
      `UPDATE family_member SET role = ? WHERE family_id = ? AND user_id = ?`,
    ).bind(newRole, membership.family_id, targetUserId).run();
  } else if (action === 'remove') {
    const target = await env.DB.prepare(
      'SELECT role FROM family_member WHERE family_id = ? AND user_id = ?',
    ).bind(membership.family_id, targetUserId).first();
    // Can't remove the owner; coadmin can't remove another coadmin.
    if (target?.role === 'owner') return json({ error: 'Cannot remove owner' }, { status: 403 });
    if (target?.role === 'coadmin' && membership.role !== 'owner') {
      return json({ error: 'Only the owner can remove Co-Admins' }, { status: 403 });
    }
    await env.DB.prepare(
      `DELETE FROM family_member WHERE family_id = ? AND user_id = ?`,
    ).bind(membership.family_id, targetUserId).run();
  }

  return json({ ok: true });
}

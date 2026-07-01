import { json } from '../../_lib/util.js';

/*
 * POST /api/families/switch  { family_id }
 * Repoints user.family_id to a family the user is already a member of.
 * Used by the family switcher in UserProfile — the client reloads the tree
 * from the server after this succeeds.
 */
export async function onRequestPost({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  let family_id;
  try { ({ family_id } = await request.json()); }
  catch { return json({ error: 'Bad request' }, { status: 400 }); }
  if (!family_id) return json({ error: 'family_id required' }, { status: 400 });

  const membership = await env.DB.prepare(
    'SELECT role FROM family_member WHERE family_id = ? AND user_id = ?',
  ).bind(family_id, data.user.uid).first();
  if (!membership) return json({ error: 'Not a member of that family' }, { status: 403 });

  await env.DB.prepare('UPDATE user SET family_id = ? WHERE id = ?')
    .bind(family_id, data.user.uid).run();

  return json({ ok: true, role: membership.role });
}

import { json } from '../../_lib/util.js';

/*
 * GET /api/families
 * Lists every family this user belongs to (family_member rows), so the
 * client can offer a switcher for people who are members of more than one
 * tree (e.g. their own side and a spouse's side, or someone who was invited
 * to a family after already starting their own).
 */
export async function onRequestGet({ env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  try {
    const userRow = await env.DB.prepare('SELECT family_id FROM user WHERE id = ?')
      .bind(data.user.uid).first();

    const rows = await env.DB.prepare(
      `SELECT fm.family_id, fm.role, f.name AS family_name, fm.joined_at,
              (SELECT COUNT(*) FROM family_member WHERE family_id = fm.family_id) AS member_count
         FROM family_member fm JOIN family f ON f.id = fm.family_id
        WHERE fm.user_id = ?
        ORDER BY fm.joined_at ASC`,
    ).bind(data.user.uid).all();

    const families = (rows.results || []).map((r) => ({
      family_id: r.family_id,
      name: r.family_name,
      role: r.role,
      member_count: r.member_count,
      is_current: r.family_id === userRow?.family_id,
    }));

    return json({ families });
  } catch (e) {
    return json({ error: 'Server error', detail: e.message }, { status: 500 });
  }
}

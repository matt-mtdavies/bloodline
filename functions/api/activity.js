import { json } from '../_lib/util.js';

/*
 * GET /api/activity?limit=30&before=<ISO timestamp>
 *
 * Paginated read of the family's durable activity_log — the append-only
 * server-side history (see migration 0008), immune to the client's own
 * peer-to-peer tree merge. Backs both the "load more" admin audit log and
 * can be used to recover the fast-path client cache in family_tree.tree_json
 * if that ever falls behind.
 *
 * Restricted to family members with coadmin+ role (same bar as inviting).
 */
export async function onRequestGet({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  try {
    const userRow = await env.DB.prepare(`SELECT family_id FROM user WHERE id = ?`)
      .bind(data.user.uid).first();
    if (!userRow?.family_id) return json({ items: [], hasMore: false });

    const membership = await env.DB.prepare(
      `SELECT role FROM family_member WHERE user_id = ? AND family_id = ?`,
    ).bind(data.user.uid, userRow.family_id).first();
    if (!membership) return json({ items: [], hasMore: false });
    if (!['owner', 'coadmin'].includes(membership.role)) {
      return json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '30', 10), 1), 200);
    const before = url.searchParams.get('before');

    const stmt = before
      ? env.DB.prepare(
          `SELECT * FROM activity_log WHERE family_id = ? AND created_at < ?
           ORDER BY created_at DESC LIMIT ?`,
        ).bind(userRow.family_id, before, limit + 1)
      : env.DB.prepare(
          `SELECT * FROM activity_log WHERE family_id = ?
           ORDER BY created_at DESC LIMIT ?`,
        ).bind(userRow.family_id, limit + 1);

    const { results } = await stmt.all();
    const rows = results || [];
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => ({
      id: r.id,
      authorName: r.author_name,
      authorEmail: r.author_email,
      type: r.type,
      personId: r.person_id,
      personName: r.person_name,
      detail: r.detail,
      created_at: r.created_at,
    }));

    return json({ items, hasMore });
  } catch (e) {
    console.error('[activity] GET error:', e.message);
    return json({ error: 'Server error' }, { status: 500 });
  }
}

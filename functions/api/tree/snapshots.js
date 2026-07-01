import { json } from '../../_lib/util.js';

/*
 * GET /api/tree/snapshots
 *
 * Lists point-in-time backups of this family's tree (see migration 0009 —
 * family_tree_snapshot is archived automatically before every save). Newest
 * first, capped at the 30 kept per family. Restricted to owner/coadmin, same
 * bar as the other tree-management actions in functions/api/tree.js.
 */
export async function onRequestGet({ env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  try {
    const userRow = await env.DB.prepare(`SELECT family_id FROM user WHERE id = ?`)
      .bind(data.user.uid).first();
    if (!userRow?.family_id) return json({ items: [] });

    const membership = await env.DB.prepare(
      `SELECT role FROM family_member WHERE user_id = ? AND family_id = ?`,
    ).bind(data.user.uid, userRow.family_id).first();
    if (!membership || !['owner', 'coadmin'].includes(membership.role)) {
      return json({ error: 'Forbidden' }, { status: 403 });
    }

    const { results } = await env.DB.prepare(
      `SELECT id, tree_json, created_at FROM family_tree_snapshot
        WHERE family_id = ? ORDER BY created_at DESC LIMIT 30`,
    ).bind(userRow.family_id).all();

    // Surface just enough to tell snapshots apart — full people count, not
    // the whole blob — so the list stays small and fast to render.
    const items = (results || []).map((r) => {
      let peopleCount = null;
      let relationshipCount = null;
      try {
        const parsed = JSON.parse(r.tree_json);
        peopleCount = Array.isArray(parsed.people) ? parsed.people.length : null;
        relationshipCount = Array.isArray(parsed.relationships) ? parsed.relationships.length : null;
      } catch { /* unparseable — list it without counts rather than dropping it */ }
      return {
        id: r.id,
        created_at: new Date(r.created_at * 1000).toISOString(),
        peopleCount,
        relationshipCount,
      };
    });

    return json({ items });
  } catch (e) {
    console.error('[tree/snapshots] GET error:', e.message);
    return json({ error: 'Server error' }, { status: 500 });
  }
}

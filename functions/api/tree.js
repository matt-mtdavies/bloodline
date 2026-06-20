import { json } from '../_lib/util.js';

/*
 * GET /api/tree  — load the authenticated user's full tree state.
 * PUT /api/tree  — save the authenticated user's full tree state.
 *
 * The tree is stored as a JSON blob in user_tree so the client store shape
 * can evolve freely. Normalised D1 tables (person, relationship) exist for
 * Phase 4 collaboration; for solo use this is the source of truth.
 */

export async function onRequestGet({ env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  const row = await env.DB.prepare(
    'SELECT tree_json FROM user_tree WHERE user_id = ?',
  ).bind(data.user.uid).first();

  // null means new user — client shows onboarding.
  return json(row ? JSON.parse(row.tree_json) : null, {
    headers: { 'cache-control': 'private, no-store' },
  });
}

export async function onRequestPut({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  const tree = await request.json();
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO user_tree (user_id, tree_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE
       SET tree_json = excluded.tree_json,
           updated_at = excluded.updated_at`,
  ).bind(data.user.uid, JSON.stringify(tree), now).run();

  return json({ ok: true });
}

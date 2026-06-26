import { json } from '../../_lib/util.js';

/*
 * GET /api/user/profile
 * Returns the current user's profile: display_name, email, claimed person_id,
 * and notification preferences.
 */
export async function onRequestGet({ env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  const row = await env.DB.prepare(
    'SELECT id, email, display_name, person_id, notification_prefs FROM user WHERE id = ?',
  ).bind(data.user.uid).first();

  if (!row) return json({ error: 'User not found' }, { status: 404 });

  let notifPrefs = { activity: true, invites: true };
  try {
    if (row.notification_prefs) notifPrefs = JSON.parse(row.notification_prefs);
  } catch { /* leave defaults */ }

  return json({
    uid: row.id,
    email: row.email,
    display_name: row.display_name ?? null,
    person_id: row.person_id ?? null,
    notification_prefs: notifPrefs,
  });
}

/*
 * PATCH /api/user/profile  { display_name?, notification_prefs?, person_id? }
 * Updates any subset of profile fields.  Pass person_id: null to unclaim a bubble.
 */
export async function onRequestPatch({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request' }, { status: 400 }); }

  const sets = [];
  const binds = [];

  if ('display_name' in body) {
    const name = body.display_name ? String(body.display_name).trim().slice(0, 100) : null;
    sets.push('display_name = ?');
    binds.push(name);
  }

  if ('notification_prefs' in body && body.notification_prefs && typeof body.notification_prefs === 'object') {
    sets.push('notification_prefs = ?');
    binds.push(JSON.stringify(body.notification_prefs));
  }

  if ('person_id' in body) {
    sets.push('person_id = ?');
    binds.push(body.person_id ?? null);
  }

  if (!sets.length) return json({ ok: true });

  sets.push('last_seen = ?');
  binds.push(Math.floor(Date.now() / 1000));
  binds.push(data.user.uid);

  await env.DB.prepare(
    `UPDATE user SET ${sets.join(', ')} WHERE id = ?`,
  ).bind(...binds).run();

  return json({ ok: true });
}

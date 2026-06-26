import { json } from '../../_lib/util.js';

/*
 * GET /api/user/profile
 * Returns the current user's profile: display_name, email, claimed person_id,
 * and notification preferences.
 */
export async function onRequestGet({ env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  // Fall back to a basic query if migration 0005 hasn't been applied yet.
  let row;
  try {
    row = await env.DB.prepare(
      'SELECT id, email, display_name, person_id, notification_prefs FROM user WHERE id = ?',
    ).bind(data.user.uid).first();
  } catch {
    row = await env.DB.prepare(
      'SELECT id, email FROM user WHERE id = ?',
    ).bind(data.user.uid).first();
  }

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
    const personId = body.person_id ?? null;
    // person.family_id and person.display_name are both NOT NULL, so the stub
    // row that satisfies the user.person_id FK needs real values for both.
    if (personId) {
      const fm = await env.DB.prepare(
        'SELECT family_id FROM family_member WHERE user_id = ?',
      ).bind(data.user.uid).first();
      if (!fm?.family_id) {
        return json({ error: 'No family found — cannot claim bubble' }, { status: 400 });
      }
      const displayName = body.person_name ? String(body.person_name).trim().slice(0, 200) : personId;
      const stubNow = Math.floor(Date.now() / 1000);
      await env.DB.prepare(
        `INSERT OR IGNORE INTO person (id, family_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      ).bind(personId, fm.family_id, displayName, stubNow, stubNow).run();
    }
    sets.push('person_id = ?');
    binds.push(personId);
  }

  if (!sets.length) return json({ ok: true });

  const now = Math.floor(Date.now() / 1000);
  sets.push('last_seen = ?');
  binds.push(now);
  binds.push(data.user.uid);

  try {
    await env.DB.prepare(
      `UPDATE user SET ${sets.join(', ')} WHERE id = ?`,
    ).bind(...binds).run();
  } catch (e) {
    const msg = String(e?.message ?? '');
    if (msg.includes('no such column')) {
      return json({ error: 'Migration pending — run 0005_user_profile.sql' }, { status: 503 });
    }
    return json({ error: msg || 'Database error' }, { status: 500 });
  }

  return json({ ok: true });
}

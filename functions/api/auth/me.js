import { json } from '../../_lib/util.js';
import { isAdminEmail } from '../../_lib/adminAuth.js';

/*
 * GET /api/auth/me
 * Returns the current session user, or 401 if not authenticated.
 * If BREVO_API_KEY is not set, auth is not configured — returns { bypass: true }
 * so the client skips the login gate and falls back to localStorage mode.
 */
export async function onRequestGet({ env, data }) {
  if (!env.BREVO_API_KEY) {
    return json({ bypass: true });
  }
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });

  let display_name = null;
  let person_id = null;
  if (env.DB) {
    try {
      const row = await env.DB.prepare(
        'SELECT display_name, person_id FROM user WHERE id = ?',
      ).bind(data.user.uid).first();
      display_name = row?.display_name ?? null;
      person_id = row?.person_id ?? null;
    } catch { /* migration may not be applied yet — skip gracefully */ }
  }

  // Surface admin status (compared server-side so the allowlist never leaves
  // the server) — the client uses this to reveal the Admin Dashboard link.
  const isAdmin = isAdminEmail(env, data.user.email);

  // Return any pending invites for this email address so the client can
  // auto-accept them (empty tree) or show a banner (non-empty tree).
  let pendingInvites = [];
  if (env.DB) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const rows = await env.DB.prepare(
        `SELECT i.token, i.role, f.name AS family_name, u2.email AS from_email
         FROM invite i
         JOIN family f ON f.id = i.family_id
         LEFT JOIN user u2 ON u2.id = i.from_user
         WHERE i.email = ? AND i.status = 'pending' AND i.expires_at > ?
         ORDER BY i.created_at DESC LIMIT 5`,
      ).bind(data.user.email, now).all();
      pendingInvites = rows.results || [];
    } catch { /* migration may not be applied yet — skip gracefully */ }
  }

  return json({ uid: data.user.uid, email: data.user.email, display_name, person_id, isAdmin, pendingInvites });
}

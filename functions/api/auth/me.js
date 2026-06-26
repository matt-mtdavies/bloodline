import { json } from '../../_lib/util.js';

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
  if (env.DB) {
    const row = await env.DB.prepare(
      'SELECT display_name FROM user WHERE id = ?',
    ).bind(data.user.uid).first();
    display_name = row?.display_name ?? null;
  }

  return json({ uid: data.user.uid, email: data.user.email, display_name });
}

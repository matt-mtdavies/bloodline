import { json } from '../../_lib/util.js';

/*
 * GET /api/admin/feedback
 * Returns recent feedback rows for the admin dashboard.
 * Restricted to ADMIN_EMAIL, same as /api/admin/stats.
 */
export async function onRequestGet({ env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB)    return json({ error: 'Database not configured' }, { status: 503 });

  const adminEmail = env.ADMIN_EMAIL;
  if (!adminEmail) return json({ error: 'ADMIN_EMAIL not configured' }, { status: 503 });
  if (data.user.email.toLowerCase() !== adminEmail.trim().toLowerCase()) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const result = await env.DB.prepare(
      `SELECT type, email, message, created_at
         FROM feedback
        ORDER BY created_at DESC
        LIMIT 50`,
    ).all();

    return json({
      rows: (result.results || []).map((r) => ({
        type:       r.type,
        email:      r.email,
        message:    r.message,
        created_at: new Date(r.created_at * 1000).toISOString(),
      })),
    });
  } catch (e) {
    console.error('[admin/feedback] error:', e.message);
    return json({ error: 'Server error' }, { status: 500 });
  }
}

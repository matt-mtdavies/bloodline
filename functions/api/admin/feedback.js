import { json } from '../../_lib/util.js';
import { adminEmailList, isAdminEmail } from '../../_lib/adminAuth.js';

/*
 * GET /api/admin/feedback
 * Returns recent feedback rows for the admin dashboard.
 * Restricted to the ADMIN_EMAILS allowlist, same as /api/admin/stats.
 */
export async function onRequestGet({ env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB)    return json({ error: 'Database not configured' }, { status: 503 });

  if (!adminEmailList(env).length) return json({ error: 'ADMIN_EMAILS not configured' }, { status: 503 });
  if (!isAdminEmail(env, data.user.email)) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const result = await env.DB.prepare(
      `SELECT type, email, message, created_at, email_status, email_error
         FROM feedback
        ORDER BY created_at DESC
        LIMIT 50`,
    ).all();

    return json({
      rows: (result.results || []).map((r) => ({
        type:         r.type,
        email:        r.email,
        message:      r.message,
        created_at:   new Date(r.created_at * 1000).toISOString(),
        email_status: r.email_status,
        email_error:  r.email_error,
      })),
    });
  } catch (e) {
    console.error('[admin/feedback] error:', e.message);
    return json({ error: 'Server error' }, { status: 500 });
  }
}

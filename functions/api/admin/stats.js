import { json } from '../../_lib/util.js';

/*
 * GET /api/admin/stats
 *
 * Site-owner dashboard: user counts, family counts, invite funnel,
 * weekly signup trend, and most recently active users.
 *
 * Access is restricted to the email set in the ADMIN_EMAIL environment
 * variable (Pages → Settings → Environment variables). Must be logged in.
 */
export async function onRequestGet({ env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  const adminEmail = env.ADMIN_EMAIL;
  if (!adminEmail) return json({ error: 'ADMIN_EMAIL not configured' }, { status: 503 });
  if (data.user.email.toLowerCase() !== adminEmail.trim().toLowerCase()) return json({ error: 'Forbidden' }, { status: 403 });

  try {
    const now = Math.floor(Date.now() / 1000);
    const day = 86400;
    const week = day * 7;

    const [
      totalUsers,
      newUsers7d,
      newUsers30d,
      activeUsers7d,
      activeUsers30d,
      totalFamilies,
      inviteCounts,
      totalInvites,
      weeklySignups,
      recentUsers,
      treeSizes,
    ] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS n FROM user').first(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM user WHERE created_at > ?').bind(now - week).first(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM user WHERE created_at > ?').bind(now - day * 30).first(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM user WHERE last_seen > ?').bind(now - week).first(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM user WHERE last_seen > ?').bind(now - day * 30).first(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM family').first(),
      env.DB.prepare(`
        SELECT status, COUNT(*) AS n FROM invite GROUP BY status
      `).all(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM invite').first(),
      env.DB.prepare(`
        SELECT
          CAST((created_at - (created_at % ${week})) / ${week} AS INTEGER) AS week_num,
          COUNT(*) AS signups
        FROM user
        WHERE created_at > ?
        GROUP BY week_num
        ORDER BY week_num ASC
      `).bind(now - day * 84).all(), // 12 weeks
      env.DB.prepare(`
        SELECT u.email, u.created_at, u.last_seen,
               f.name AS family_name
        FROM user u
        LEFT JOIN family_member fm ON fm.user_id = u.id
        LEFT JOIN family f ON f.id = fm.family_id AND fm.role = 'owner'
        ORDER BY u.created_at DESC
        LIMIT 20
      `).all(),
      env.DB.prepare(`
        SELECT ft.family_id, f.name AS family_name,
               LENGTH(ft.tree_json) AS bytes
        FROM family_tree ft
        LEFT JOIN family f ON f.id = ft.family_id
        ORDER BY bytes DESC
        LIMIT 10
      `).all(),
    ]);

    // Shape the invite funnel into a plain object
    const invites = { pending: 0, accepted: 0, expired: 0 };
    for (const row of (inviteCounts.results || [])) {
      invites[row.status] = row.n;
    }

    // Email deliverability breakdown (migration 0007). Defensive: older DBs
    // without the email_status column just report nulls instead of erroring.
    let emailDelivery = null;
    try {
      const { results } = await env.DB.prepare(
        `SELECT email_status AS s, COUNT(*) AS n FROM invite
          WHERE email_status IS NOT NULL GROUP BY email_status`,
      ).all();
      emailDelivery = { sent: 0, failed: 0, dev: 0, tracked: 0 };
      for (const r of (results || [])) {
        if (r.s in emailDelivery) emailDelivery[r.s] = r.n;
        emailDelivery.tracked += r.n;
      }
    } catch { /* column not migrated yet */ }

    // Most recent failed invite emails — actionable triage for the admin.
    let recentFailures = [];
    try {
      const { results } = await env.DB.prepare(
        `SELECT email, email_error, created_at FROM invite
          WHERE email_status = 'failed' ORDER BY created_at DESC LIMIT 10`,
      ).all();
      recentFailures = (results || []).map((r) => ({
        email: r.email,
        error: r.email_error || null,
        when: new Date(r.created_at * 1000).toISOString(),
      }));
    } catch { /* column not migrated yet */ }

    // Label weekly signup rows with a readable date
    const signupsByWeek = (weeklySignups.results || []).map((r) => ({
      week: new Date(r.week_num * week * 1000).toISOString().slice(0, 10),
      signups: r.signups,
    }));

    const totalInviteCount = totalInvites?.n ?? 0;
    const acceptanceRate = totalInviteCount > 0
      ? Math.round((invites.accepted / totalInviteCount) * 100)
      : 0;

    return json({
      generated_at: new Date().toISOString(),
      email: {
        brevo_configured: !!env.BREVO_API_KEY,
        from_email: env.FROM_EMAIL || null,
        app_url: env.APP_URL || null,
        delivery: emailDelivery,
        recent_failures: recentFailures,
      },
      users: {
        total: totalUsers?.n ?? 0,
        new_7d: newUsers7d?.n ?? 0,
        new_30d: newUsers30d?.n ?? 0,
        active_7d: activeUsers7d?.n ?? 0,
        active_30d: activeUsers30d?.n ?? 0,
      },
      families: {
        total: totalFamilies?.n ?? 0,
      },
      invites: {
        ...invites,
        total: totalInviteCount,
        acceptance_rate: acceptanceRate,
      },
      signups_by_week: signupsByWeek,
      recent_users: (recentUsers.results || []).map((u) => ({
        email: u.email,
        family_name: u.family_name || null,
        joined: new Date(u.created_at * 1000).toISOString(),
        last_seen: u.last_seen ? new Date(u.last_seen * 1000).toISOString() : null,
      })),
      largest_trees: (treeSizes.results || []).map((t) => ({
        family_id: t.family_id,
        family_name: t.family_name || t.family_id,
        size_kb: Math.round(t.bytes / 1024),
      })),
    });
  } catch (e) {
    console.error('[admin/stats] error:', e.message);
    return json({ error: 'Server error' }, { status: 500 });
  }
}

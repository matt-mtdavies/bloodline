import { json } from '../../_lib/util.js';
import { adminEmailList, isAdminEmail } from '../../_lib/adminAuth.js';
import { estimateCostUsd } from '../../_lib/aiUsage.js';

/*
 * GET /api/admin/stats
 *
 * Site-owner dashboard: user counts, family counts, invite funnel,
 * weekly signup trend, most recently active users, AI spend, engagement,
 * and platform-wide content totals.
 *
 * Access is restricted to the ADMIN_EMAILS allowlist (see _lib/adminAuth.js).
 * Must be logged in.
 */
export async function onRequestGet({ env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  if (!adminEmailList(env).length) return json({ error: 'ADMIN_EMAILS not configured' }, { status: 503 });
  if (!isAdminEmail(env, data.user.email)) return json({ error: 'Forbidden' }, { status: 403 });

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

    // AI usage & estimated spend (migration 0013). Defensive: the table is
    // new, so an unmigrated environment reports an empty section rather than
    // a 500. Cost is estimated from Anthropic's own per-call token counts
    // (see _lib/aiUsage.js) — never a guess at usage itself, just the price.
    let ai = { total_calls_30d: 0, estimated_cost_30d_usd: 0, by_endpoint: [], by_day: [] };
    try {
      const [byEndpoint, byDay] = await Promise.all([
        env.DB.prepare(
          `SELECT endpoint, model, COUNT(*) AS n,
                  SUM(input_tokens) AS in_tok, SUM(output_tokens) AS out_tok,
                  SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failures
             FROM ai_usage_log WHERE created_at > ?
             GROUP BY endpoint, model ORDER BY n DESC`,
        ).bind(now - day * 30).all(),
        env.DB.prepare(
          `SELECT strftime('%Y-%m-%d', created_at, 'unixepoch') AS day,
                  COUNT(*) AS n, SUM(input_tokens) AS in_tok, SUM(output_tokens) AS out_tok
             FROM ai_usage_log WHERE created_at > ?
             GROUP BY day ORDER BY day ASC`,
        ).bind(now - day * 30).all(),
      ]);

      let totalCalls = 0, totalCost = 0;
      const byEndpointRows = (byEndpoint.results || []).map((r) => {
        const cost = estimateCostUsd(r.model, r.in_tok || 0, r.out_tok || 0) || 0;
        totalCalls += r.n;
        totalCost += cost;
        return {
          endpoint: r.endpoint, model: r.model, calls: r.n, failures: r.failures || 0,
          input_tokens: r.in_tok || 0, output_tokens: r.out_tok || 0,
          estimated_cost_usd: Math.round(cost * 10000) / 10000,
        };
      });

      // Re-derive each day's cost from a per-model split so mixed-model days
      // still price correctly — cheap enough at 30 rows and avoids the
      // "average price across all models" error a single flat rate would give.
      const dayModelCost = await env.DB.prepare(
        `SELECT strftime('%Y-%m-%d', created_at, 'unixepoch') AS day, model,
                SUM(input_tokens) AS in_tok, SUM(output_tokens) AS out_tok
           FROM ai_usage_log WHERE created_at > ?
           GROUP BY day, model`,
      ).bind(now - day * 30).all();
      const costByDay = new Map();
      for (const r of (dayModelCost.results || [])) {
        const c = estimateCostUsd(r.model, r.in_tok || 0, r.out_tok || 0) || 0;
        costByDay.set(r.day, (costByDay.get(r.day) || 0) + c);
      }

      ai = {
        total_calls_30d: totalCalls,
        estimated_cost_30d_usd: Math.round(totalCost * 100) / 100,
        by_endpoint: byEndpointRows,
        by_day: (byDay.results || []).map((r) => ({
          day: r.day,
          calls: r.n,
          input_tokens: r.in_tok || 0,
          output_tokens: r.out_tok || 0,
          estimated_cost_usd: Math.round((costByDay.get(r.day) || 0) * 10000) / 10000,
        })),
      };
    } catch (e) { console.error('[admin/stats] ai usage skipped:', e.message); }

    // Engagement — durable activity_log (migration 0008), not just logins.
    // created_at there is an ISO string, so cutoffs are ISO strings too.
    let engagement = { activity_7d: 0, activity_30d: 0, by_type_30d: [], by_day_30d: [], most_active_families_30d: [] };
    try {
      const cutoff7 = new Date((now - week) * 1000).toISOString();
      const cutoff30 = new Date((now - day * 30) * 1000).toISOString();
      const [count7, count30, byType, byDay, activeFamilies] = await Promise.all([
        env.DB.prepare('SELECT COUNT(*) AS n FROM activity_log WHERE created_at > ?').bind(cutoff7).first(),
        env.DB.prepare('SELECT COUNT(*) AS n FROM activity_log WHERE created_at > ?').bind(cutoff30).first(),
        env.DB.prepare(
          `SELECT type, COUNT(*) AS n FROM activity_log WHERE created_at > ?
             GROUP BY type ORDER BY n DESC`,
        ).bind(cutoff30).all(),
        env.DB.prepare(
          `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n, COUNT(DISTINCT author_email) AS actors
             FROM activity_log WHERE created_at > ?
             GROUP BY day ORDER BY day ASC`,
        ).bind(cutoff30).all(),
        env.DB.prepare(
          `SELECT al.family_id, f.name AS family_name, COUNT(*) AS n
             FROM activity_log al LEFT JOIN family f ON f.id = al.family_id
             WHERE al.created_at > ?
             GROUP BY al.family_id ORDER BY n DESC LIMIT 8`,
        ).bind(cutoff30).all(),
      ]);
      engagement = {
        activity_7d: count7?.n ?? 0,
        activity_30d: count30?.n ?? 0,
        by_type_30d: (byType.results || []).map((r) => ({ type: r.type || 'other', n: r.n })),
        by_day_30d: (byDay.results || []).map((r) => ({ day: r.day, events: r.n, active_people: r.actors })),
        most_active_families_30d: (activeFamilies.results || []).map((r) => ({
          family_name: r.family_name || r.family_id, events: r.n,
        })),
      };
    } catch (e) { console.error('[admin/stats] engagement skipped:', e.message); }

    // Platform-wide content totals — the tree itself is a JSON blob per
    // family, so these come from D1's JSON1 functions rather than a table.
    let content = { total_people: 0, total_photos: 0, total_memories: 0, total_documents: 0 };
    try {
      const row = await env.DB.prepare(
        `SELECT
           SUM(json_array_length(tree_json, '$.people')) AS people,
           SUM(json_array_length(tree_json, '$.photos')) AS photos,
           SUM(json_array_length(tree_json, '$.memories')) AS memories,
           SUM(json_array_length(tree_json, '$.documents')) AS documents
         FROM family_tree`,
      ).first();
      content = {
        total_people: row?.people ?? 0,
        total_photos: row?.photos ?? 0,
        total_memories: row?.memories ?? 0,
        total_documents: row?.documents ?? 0,
      };
    } catch (e) { console.error('[admin/stats] content totals skipped:', e.message); }

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
      ai,
      engagement,
      content,
    });
  } catch (e) {
    console.error('[admin/stats] error:', e.message);
    return json({ error: 'Server error' }, { status: 500 });
  }
}

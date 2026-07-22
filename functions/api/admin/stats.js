import { json } from '../../_lib/util.js';
import { adminEmailList, isAdminEmail } from '../../_lib/adminAuth.js';
import { estimateCostUsd } from '../../_lib/aiUsage.js';
import { resolveTreeFromRaw, extraKey } from '../../_lib/treeStore.js';

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
               GROUP_CONCAT(DISTINCT f.name) AS family_names
        FROM user u
        LEFT JOIN family_member fm ON fm.user_id = u.id
        LEFT JOIN family f ON f.id = fm.family_id
        GROUP BY u.id
        ORDER BY u.created_at DESC
        LIMIT 20
      `).all(),
      env.DB.prepare(`
        SELECT ft.family_id, f.name AS family_name,
               LENGTH(ft.tree_json) AS bytes,
               json_extract(ft.tree_json, '$._extraVersion') AS extra_version
        FROM family_tree ft
        LEFT JOIN family f ON f.id = ft.family_id
        ORDER BY bytes DESC
        LIMIT 10
      `).all(),
    ]);

    // A migrated family's tree_json column only holds "core" (docs/TREE-
    // STORAGE.md §6) — LENGTH() above measures just that half. Add each
    // migrated row's R2 extra size (a cheap metadata-only head(), no body
    // download) so the reported figure is the family's true total. This
    // doesn't fix the top-10 RANKING itself — a family with a tiny core but
    // a huge extra could rank below the cutoff and never show up here — an
    // accepted, documented gap (docs/TREE-STORAGE.md §9) until enough
    // families are migrated for that to matter.
    const treeSizeRows = await Promise.all((treeSizes.results || []).map(async (t) => {
      if (t.extra_version == null) return { ...t, totalBytes: t.bytes, migrated: false };
      try {
        const head = await env.DOCS.head(extraKey(t.family_id, t.extra_version));
        return { ...t, totalBytes: t.bytes + (head?.size || 0), migrated: true };
      } catch (e) {
        console.error('[admin/stats] largest_trees: extra size lookup failed for', t.family_id, e.message);
        return { ...t, totalBytes: t.bytes, migrated: true };
      }
    }));

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
    // A migrated family's tree_json is core-only: photos/memories/documents
    // live in R2 (people stays present, just per-person-detail-trimmed, so
    // its count is unaffected). The bulk SQL SUM below only counts
    // non-migrated rows; each migrated row (expected to be few during the
    // staged rollout, docs/TREE-STORAGE.md §9) is reassembled individually
    // and its real counts added back in, so this total stays exact
    // regardless of how many families have been migrated.
    let content = { total_people: 0, total_photos: 0, total_memories: 0, total_documents: 0 };
    try {
      const bulkRow = await env.DB.prepare(
        `SELECT
           SUM(CASE WHEN json_extract(tree_json, '$._extraVersion') IS NULL THEN json_array_length(tree_json, '$.people') ELSE 0 END) AS people,
           SUM(CASE WHEN json_extract(tree_json, '$._extraVersion') IS NULL THEN json_array_length(tree_json, '$.photos') ELSE 0 END) AS photos,
           SUM(CASE WHEN json_extract(tree_json, '$._extraVersion') IS NULL THEN json_array_length(tree_json, '$.memories') ELSE 0 END) AS memories,
           SUM(CASE WHEN json_extract(tree_json, '$._extraVersion') IS NULL THEN json_array_length(tree_json, '$.documents') ELSE 0 END) AS documents,
           SUM(CASE WHEN json_extract(tree_json, '$._extraVersion') IS NOT NULL THEN json_array_length(tree_json, '$.people') ELSE 0 END) AS migrated_people
         FROM family_tree`,
      ).first();
      content = {
        total_people: (bulkRow?.people ?? 0) + (bulkRow?.migrated_people ?? 0),
        total_photos: bulkRow?.photos ?? 0,
        total_memories: bulkRow?.memories ?? 0,
        total_documents: bulkRow?.documents ?? 0,
      };

      const { results: migratedRows } = await env.DB.prepare(
        `SELECT family_id, tree_json FROM family_tree WHERE json_extract(tree_json, '$._extraVersion') IS NOT NULL`,
      ).all();
      for (const row of (migratedRows || [])) {
        try {
          const resolved = await resolveTreeFromRaw(env, row.family_id, row.tree_json);
          if (resolved.extraError) {
            console.error('[admin/stats] content totals: extra unreadable for', row.family_id, resolved.extraError);
            continue;
          }
          content.total_photos += resolved.tree.photos?.length || 0;
          content.total_memories += resolved.tree.memories?.length || 0;
          content.total_documents += resolved.tree.documents?.length || 0;
        } catch (e) {
          console.error('[admin/stats] content totals: corrupt migrated family', row.family_id, e.message);
        }
      }
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
      // GROUP_CONCAT above already covers every family a user belongs to,
      // not just one they own (a user with no membership at all — signed up
      // via the plain site link, never created or joined a tree — is the
      // only case this is genuinely null for) — join with ", " since
      // SQLite's DISTINCT form of GROUP_CONCAT only supports a bare comma.
      recent_users: (recentUsers.results || []).map((u) => ({
        email: u.email,
        family_name: u.family_names ? u.family_names.split(',').join(', ') : null,
        joined: new Date(u.created_at * 1000).toISOString(),
        last_seen: u.last_seen ? new Date(u.last_seen * 1000).toISOString() : null,
      })),
      largest_trees: treeSizeRows.map((t) => ({
        family_id: t.family_id,
        family_name: t.family_name || t.family_id,
        size_kb: Math.round(t.totalBytes / 1024),
        migrated: t.migrated,
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

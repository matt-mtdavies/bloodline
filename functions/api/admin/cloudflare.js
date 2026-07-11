import { json } from '../../_lib/util.js';
import { adminEmailList, isAdminEmail } from '../../_lib/adminAuth.js';

/*
 * GET /api/admin/cloudflare   (admin only)
 *
 * Real edge traffic for the site — requests, bandwidth, cache rate, threats
 * blocked, unique visitors — straight from Cloudflare's own GraphQL
 * Analytics API (the same data the Cloudflare dashboard's Analytics tab
 * shows), not a guess or a third-party tracker. Kept as its own endpoint
 * (like email-diagnostic.js) since it's an external, possibly-slow call the
 * core dashboard shouldn't have to wait on.
 *
 * Requires two secrets neither of which exist by default — see wrangler.toml
 * for how to create them. Reports { configured: false } gracefully, same
 * pattern as the email diagnostics, until both are set.
 */
export async function onRequestGet({ env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!adminEmailList(env).length) return json({ error: 'ADMIN_EMAILS not configured' }, { status: 503 });
  if (!isAdminEmail(env, data.user.email)) return json({ error: 'Forbidden' }, { status: 403 });

  const token = env.CLOUDFLARE_API_TOKEN;
  const zoneTag = env.CLOUDFLARE_ZONE_ID;
  if (!token || !zoneTag) {
    return json({
      configured: false,
      missing: [!token && 'CLOUDFLARE_API_TOKEN', !zoneTag && 'CLOUDFLARE_ZONE_ID'].filter(Boolean),
    });
  }

  const until = new Date();
  const since = new Date(until.getTime() - 30 * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);

  const query = `
    query Traffic($zoneTag: String!, $since: Date!, $until: Date!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequests1dGroups(
            limit: 31
            filter: { date_geq: $since, date_leq: $until }
            orderBy: [date_ASC]
          ) {
            dimensions { date }
            sum { requests bytes cachedRequests cachedBytes threats }
            uniq { uniques }
          }
        }
      }
    }
  `;

  let res, body;
  try {
    res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: { zoneTag, since: fmt(since), until: fmt(until) },
      }),
    });
    body = await res.json().catch(() => ({}));
  } catch (e) {
    return json({ configured: true, error: `Network error: ${e.message}` }, { status: 502 });
  }

  if (!res.ok || body.errors?.length) {
    return json({
      configured: true,
      error: body.errors?.[0]?.message || `Cloudflare API error ${res.status}`,
    }, { status: 502 });
  }

  const rows = body.data?.viewer?.zones?.[0]?.httpRequests1dGroups || [];
  const byDay = rows.map((r) => ({
    day: r.dimensions.date,
    requests: r.sum.requests,
    bandwidth_bytes: r.sum.bytes,
    cached_requests: r.sum.cachedRequests,
    cached_bytes: r.sum.cachedBytes,
    threats: r.sum.threats,
    uniques: r.uniq.uniques,
  }));

  const totals = byDay.reduce((acc, r) => ({
    requests: acc.requests + r.requests,
    bandwidth_bytes: acc.bandwidth_bytes + r.bandwidth_bytes,
    cached_requests: acc.cached_requests + r.cached_requests,
    threats: acc.threats + r.threats,
  }), { requests: 0, bandwidth_bytes: 0, cached_requests: 0, threats: 0 });

  return json({
    configured: true,
    since: fmt(since),
    until: fmt(until),
    totals: {
      requests: totals.requests,
      bandwidth_gb: Math.round((totals.bandwidth_bytes / 1e9) * 100) / 100,
      cache_hit_rate: totals.requests > 0 ? Math.round((totals.cached_requests / totals.requests) * 100) : 0,
      threats_blocked: totals.threats,
      // Cloudflare's `uniques` metric isn't additive day-to-day (someone visiting
      // twice in a week counts once per day, not once overall) — the peak day
      // is a reasonable "how many distinct visitors on a busy day" proxy
      // rather than a fabricated sum that overcounts returning visitors.
      peak_daily_uniques: byDay.length ? Math.max(...byDay.map((r) => r.uniques)) : 0,
    },
    by_day: byDay,
  });
}

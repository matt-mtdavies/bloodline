import { json } from '../../_lib/util.js';

/*
 * GET /api/admin/email-diagnostic   (admin only)
 *
 * Asks Brevo directly about the state of email delivery so we can see WHY
 * invites aren't arriving — without guessing:
 *   • account plan + remaining email credits (are we out / throttled?)
 *   • sender verification (is FROM_EMAIL an active, verified sender?)
 *   • domain authentication (is the sending domain DKIM/SPF authenticated?
 *     unauthenticated domains get spam-foldered, especially by hotmail/icloud)
 *   • recent transactional events (delivered / bounced / blocked / spam) so we
 *     can see exactly what happened to the most recent invite emails.
 */
export async function onRequestGet({ env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  const adminEmail = env.ADMIN_EMAIL;
  if (!adminEmail) return json({ error: 'ADMIN_EMAIL not configured' }, { status: 503 });
  if (data.user.email.toLowerCase() !== adminEmail.trim().toLowerCase()) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!env.BREVO_API_KEY) return json({ error: 'BREVO_API_KEY not configured' }, { status: 503 });

  const h = { 'api-key': env.BREVO_API_KEY, accept: 'application/json' };
  const get = async (url) => {
    try {
      const r = await fetch(url, { headers: h });
      const body = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, body };
    } catch (e) {
      return { ok: false, status: 0, body: { error: String(e.message || e) } };
    }
  };

  const fromEmail = (env.FROM_EMAIL || '').toLowerCase();
  const fromDomain = fromEmail.split('@')[1] || null;

  const [account, senders, domains, events] = await Promise.all([
    get('https://api.brevo.com/v3/account'),
    get('https://api.brevo.com/v3/senders'),
    get('https://api.brevo.com/v3/senders/domains'),
    get('https://api.brevo.com/v3/smtp/statistics/events?limit=60&days=30'),
  ]);

  // ── Sender verification ────────────────────────────────────────────────
  const senderList = (senders.body?.senders || []).map((s) => ({
    email: s.email, name: s.name, active: !!s.active,
  }));
  const matchedSender = senderList.find((s) => s.email?.toLowerCase() === fromEmail);

  // ── Domain authentication ──────────────────────────────────────────────
  const domainList = (domains.body?.domains || domains.body || []);
  const matchedDomain = Array.isArray(domainList)
    ? domainList.find((d) => (d.domain_name || d.domain || '').toLowerCase() === fromDomain)
    : null;
  const domainAuthenticated = matchedDomain
    ? !!(matchedDomain.authenticated ?? matchedDomain.verified ?? matchedDomain.dkim)
    : null;

  // ── Recent delivery events ─────────────────────────────────────────────
  const evs = (events.body?.events || []).map((e) => ({
    email: e.email, event: e.event, date: e.date, subject: e.subject || null, reason: e.reason || null,
  }));
  const counts = {};
  for (const e of evs) counts[e.event] = (counts[e.event] || 0) + 1;

  return json({
    from_email: env.FROM_EMAIL || null,
    from_domain: fromDomain,
    account: account.ok ? {
      plan: account.body?.plan?.[0]?.type ?? account.body?.plan ?? null,
      credits: account.body?.plan?.[0]?.credits ?? null,
    } : { error: `account ${account.status}`, detail: account.body },
    sender_verified: matchedSender ? matchedSender.active : false,
    sender_found: !!matchedSender,
    senders: senderList,
    domain_authenticated: domainAuthenticated,
    domain_found: !!matchedDomain,
    event_counts: counts,
    recent_events: evs.slice(0, 40),
    _raw_status: { account: account.status, senders: senders.status, domains: domains.status, events: events.status },
  });
}

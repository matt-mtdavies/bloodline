import { uid, json, signSession, sessionCookie } from '../../_lib/util.js';
import { processInvite } from '../../_lib/invite.js';

/*
 * GET /api/auth/verify?token=…&invite=…
 * Consumes a magic-link token, finds-or-creates the user, sets a signed
 * httpOnly session cookie, and redirects into the app.
 * If an invite token is present, the user is added to that family.
 */
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const t = url.searchParams.get('token');
  const inviteToken = url.searchParams.get('invite');
  const home = env.APP_URL || '/';

  if (!t || !env.DB) {
    return Response.redirect(`${home}/?auth=error`, 302);
  }

  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    `SELECT email, expires_at, used_at FROM auth_token WHERE token = ?`,
  ).bind(t).first();

  if (!row || row.used_at || row.expires_at < now) {
    return Response.redirect(`${home}/?auth=expired`, 302);
  }

  await env.DB.prepare(`UPDATE auth_token SET used_at = ? WHERE token = ?`).bind(now, t).run();

  let user = await env.DB.prepare(`SELECT id FROM user WHERE email = ?`).bind(row.email).first();
  if (!user) {
    const id = uid('u_');
    await env.DB.prepare(`INSERT INTO user (id, email, last_seen) VALUES (?, ?, ?)`)
      .bind(id, row.email, now).run();
    user = { id };
  } else {
    await env.DB.prepare(`UPDATE user SET last_seen = ? WHERE id = ?`).bind(now, user.id).run();
  }

  const session = await signSession(
    { uid: user.id, email: row.email, iat: now },
    env.SESSION_SECRET || 'dev',
  );

  // Process the invite; if the user already has a tree, signal merge wizard.
  if (inviteToken) {
    const merge = await processInvite(env.DB, inviteToken, user.id, now);
    if (merge?.needsMerge) {
      return new Response(null, {
        status: 302,
        headers: {
          location: `${home}/?pending_invite=${encodeURIComponent(merge.token)}`,
          'set-cookie': sessionCookie(session),
        },
      });
    }
  }

  return new Response(null, {
    status: 302,
    headers: { location: `${home}/`, 'set-cookie': sessionCookie(session) },
  });
}

/*
 * POST /api/auth/verify  { email, code, invite? }
 * Validates a 6-digit code entered in the login screen. On success, sets the
 * session cookie and returns { ok: true } so the client can reload in place.
 *
 * Brute-force protection: each wrong attempt increments fail_count on the
 * active token. At 5 failures the code is locked and a new one must be requested.
 */
export async function onRequestPost({ request, env }) {
  let email, code, invite;
  try {
    ({ email, code, invite } = await request.json());
  } catch {
    return json({ error: 'Bad request' }, { status: 400 });
  }

  if (!email || !code || !/^\d{6}$/.test(String(code))) {
    return json({ error: 'Email and 6-digit code required' }, { status: 400 });
  }
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  const now = Math.floor(Date.now() / 1000);

  // Find the most-recent active token for this email.
  const tokenRow = await env.DB.prepare(
    `SELECT token FROM auth_token
      WHERE email = ? AND purpose = 'login' AND used_at IS NULL AND expires_at > ?
      ORDER BY expires_at DESC LIMIT 1`,
  ).bind(email.toLowerCase(), now).first();

  if (!tokenRow) return json({ error: 'Invalid or expired code' }, { status: 401 });

  // Brute-force protection: lock after 5 wrong guesses.
  // Requires migration 0004_auth_hardening.sql — skipped gracefully if not yet applied.
  try {
    const fc = await env.DB.prepare(
      `SELECT fail_count FROM auth_token WHERE token = ?`,
    ).bind(tokenRow.token).first();
    if (fc && fc.fail_count >= 5) {
      return json({ error: 'Too many attempts. Request a new code.' }, { status: 429 });
    }
  } catch { /* fail_count column not yet in schema — brute-force check skipped */ }

  // Tokens are stored as <48 random hex chars><6-digit code> — verify the suffix.
  if (!tokenRow.token.endsWith(String(code))) {
    try {
      await env.DB.prepare(
        `UPDATE auth_token SET fail_count = fail_count + 1 WHERE token = ?`,
      ).bind(tokenRow.token).run();
    } catch { /* migration not yet applied */ }
    return json({ error: 'Invalid or expired code' }, { status: 401 });
  }

  const row = tokenRow; // code matched — alias for clarity below

  await env.DB.prepare(`UPDATE auth_token SET used_at = ? WHERE token = ?`)
    .bind(now, row.token).run();

  let user = await env.DB.prepare(`SELECT id FROM user WHERE email = ?`)
    .bind(email.toLowerCase()).first();
  if (!user) {
    const id = uid('u_');
    await env.DB.prepare(`INSERT INTO user (id, email, last_seen) VALUES (?, ?, ?)`)
      .bind(id, email.toLowerCase(), now).run();
    user = { id };
  } else {
    await env.DB.prepare(`UPDATE user SET last_seen = ? WHERE id = ?`).bind(now, user.id).run();
  }

  const session = await signSession(
    { uid: user.id, email: email.toLowerCase(), iat: now },
    env.SESSION_SECRET || 'dev',
  );

  let personId = null;
  if (invite) {
    const merge = await processInvite(env.DB, invite, user.id, now);
    if (merge?.needsMerge) {
      return json(
        { ok: true, pendingInvite: merge.token },
        { headers: { 'set-cookie': sessionCookie(session) } },
      );
    }
    personId = merge?.personId ?? null;
  }

  return json({ ok: true, personId }, { headers: { 'set-cookie': sessionCookie(session) } });
}


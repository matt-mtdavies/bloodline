import { uid, signSession, sessionCookie, json } from '../../_lib/util.js';

/*
 * POST /api/auth/verify-code  { email, code }
 * Verifies a 6-digit OTP entered directly in the app.
 * Sets the session cookie in the JSON response so no redirect is needed —
 * the fetch() call happens in-page, which Safari treats as first-party and
 * always stores the Set-Cookie header reliably.
 */
export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  let email, code;
  try {
    ({ email, code } = await request.json());
  } catch {
    return json({ error: 'Bad request' }, { status: 400 });
  }

  if (!email || !code) return json({ error: 'Bad request' }, { status: 400 });

  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    `SELECT token, expires_at, used_at FROM auth_token
      WHERE email = ? AND code = ? AND purpose = 'login'
      ORDER BY created_at DESC LIMIT 1`,
  ).bind(email.toLowerCase(), String(code).replace(/\s/g, '')).first();

  if (!row) return json({ error: 'Invalid code' }, { status: 401 });
  if (row.used_at) return json({ error: 'Code already used' }, { status: 401 });
  if (row.expires_at < now) return json({ error: 'Code expired' }, { status: 401 });

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

  // Return the session value in the body so the client can store it in
  // localStorage and pass it via X-Bl-Session header — bypasses iOS Safari's
  // cookie restrictions on fetch() responses entirely.
  return new Response(JSON.stringify({ ok: true, session }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': sessionCookie(session), // kept for desktop/cookie-capable browsers
    },
  });
}

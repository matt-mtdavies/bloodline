import { uid, signSession, sessionCookie } from '../../_lib/util.js';

/*
 * GET /api/auth/verify?token=…
 * Consumes a magic-link token, finds-or-creates the user, sets a signed
 * httpOnly session cookie, and redirects into the app.
 */
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const t = url.searchParams.get('token');
  const home = env.APP_URL || '/';

  if (!t || !env.DB) {
    return Response.redirect(`${home}/?auth=error`, 302);
  }

  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    `SELECT email, expires_at, used_at FROM auth_token WHERE token = ?`,
  )
    .bind(t)
    .first();

  if (!row || row.used_at || row.expires_at < now) {
    return Response.redirect(`${home}/?auth=expired`, 302);
  }

  await env.DB.prepare(`UPDATE auth_token SET used_at = ? WHERE token = ?`).bind(now, t).run();

  let user = await env.DB.prepare(`SELECT id FROM user WHERE email = ?`).bind(row.email).first();
  if (!user) {
    const id = uid('u_');
    await env.DB.prepare(`INSERT INTO user (id, email, last_seen) VALUES (?, ?, ?)`)
      .bind(id, row.email, now)
      .run();
    user = { id };
  } else {
    await env.DB.prepare(`UPDATE user SET last_seen = ? WHERE id = ?`).bind(now, user.id).run();
  }

  const session = await signSession({ uid: user.id, email: row.email, iat: now }, env.SESSION_SECRET || 'dev');

  return new Response(null, {
    status: 302,
    headers: { location: `${home}/`, 'set-cookie': sessionCookie(session) },
  });
}

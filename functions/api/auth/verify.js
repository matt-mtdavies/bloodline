import { uid, signSession, sessionCookie } from '../../_lib/util.js';

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

  if (!row || row.expires_at < now) {
    return Response.redirect(`${home}/?auth=expired`, 302);
  }
  // Token already used — the session was already created on the first tap.
  // Redirect silently so tapping the link twice doesn't confuse the user.
  if (row.used_at) {
    return Response.redirect(`${home}/`, 302);
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

  // Process the family invite if one was carried through the magic link.
  if (inviteToken) {
    await processInvite(env.DB, inviteToken, user.id, now);
  }

  const session = await signSession(
    { uid: user.id, email: row.email, iat: now },
    env.SESSION_SECRET || 'dev',
  );

  // Return an HTML page that sets the cookie then redirects via JS.
  // A bare 302 with Set-Cookie is silently dropped by Safari on iOS when the
  // link is opened from Mail (cross-app navigation context / ITP).
  const dest = `${home}/`;
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8">
<title>Signing in…</title>
<meta http-equiv="refresh" content="0;url=${dest}">
<script>window.location.replace(${JSON.stringify(dest)})</script>
</head><body style="font-family:sans-serif;padding:40px;text-align:center;color:#666">
Signing you in…
</body></html>`,
    {
      status: 200,
      headers: {
        'content-type': 'text/html;charset=utf-8',
        'set-cookie': sessionCookie(session),
        'cache-control': 'no-store',
      },
    },
  );
}

async function processInvite(db, inviteToken, userId, now) {
  const invite = await db.prepare(
    `SELECT id, family_id, from_user, role, status, expires_at FROM invite WHERE token = ?`,
  ).bind(inviteToken).first();

  if (!invite || invite.status !== 'pending' || invite.expires_at < now) return;

  // Already a member? Just update their role.
  const existing = await db.prepare(
    `SELECT user_id FROM family_member WHERE family_id = ? AND user_id = ?`,
  ).bind(invite.family_id, userId).first();

  if (existing) {
    await db.prepare(
      `UPDATE family_member SET role = ? WHERE family_id = ? AND user_id = ?`,
    ).bind(invite.role, invite.family_id, userId).run();
  } else {
    await db.prepare(
      `INSERT INTO family_member (family_id, user_id, role, invited_by, joined_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(invite.family_id, userId, invite.role, invite.from_user, now).run();
  }

  await db.prepare(`UPDATE user SET family_id = ? WHERE id = ?`).bind(invite.family_id, userId).run();
  await db.prepare(`UPDATE invite SET status = 'accepted' WHERE id = ?`).bind(invite.id).run();
}

import { json, token, sendEmail } from '../../_lib/util.js';

/*
 * POST /api/auth/request  { email }
 * Mints a single-use magic-link token and emails it. No passwords (§2).
 * Invites land people directly on themselves in the tree (Phase 3) — the same
 * token mechanism carries an optional invite person id.
 */
export async function onRequestPost({ request, env }) {
  let email;
  try {
    ({ email } = await request.json());
  } catch {
    return json({ error: 'Bad request' }, { status: 400 });
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'A valid email is required' }, { status: 400 });
  }

  const t = token();
  const expires = Math.floor(Date.now() / 1000) + 60 * 30; // 30 minutes

  if (env.DB) {
    await env.DB.prepare(
      `INSERT INTO auth_token (token, email, purpose, expires_at) VALUES (?, ?, 'login', ?)`,
    )
      .bind(t, email.toLowerCase(), expires)
      .run();
  }

  const link = `${env.APP_URL || ''}/api/auth/verify?token=${t}`;
  await sendEmail(env, {
    to: email,
    subject: 'Your link to your family',
    html: `<p>Tap to open your family's tree:</p>
           <p><a href="${link}">Open Bloodline</a></p>
           <p>This link expires in 30 minutes.</p>`,
  });

  // Never reveal whether an account exists; always respond the same.
  return json({ ok: true });
}

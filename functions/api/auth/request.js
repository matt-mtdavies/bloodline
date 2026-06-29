import { json, token, sendEmail } from '../../_lib/util.js';

/*
 * POST /api/auth/request  { email, invite? }
 * Generates a 6-digit sign-in code and emails it. The DB token is the
 * random token suffixed with the display code so it can be found by
 * (email, code) without a schema change. Any prior unused codes for this
 * email are invalidated first so only the latest code is valid.
 *
 * Rate limit: max 3 code requests per email per hour to prevent email spam.
 */
export async function onRequestPost({ request, env }) {
  let email, invite;
  try {
    ({ email, invite } = await request.json());
  } catch {
    return json({ error: 'Bad request' }, { status: 400 });
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'A valid email is required' }, { status: 400 });
  }

  const displayCode = String(Math.floor(100000 + Math.random() * 900000));
  const t = token() + displayCode;
  const now = Math.floor(Date.now() / 1000);
  const expires = now + 60 * 15; // 15 min

  if (env.DB) {
    // Rate limit: max 5 code requests per email per hour.
    const oneHourAgo = now - 3600;
    const recent = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM auth_token WHERE email = ? AND purpose = 'login' AND created_at > ?`,
    ).bind(email.toLowerCase(), oneHourAgo).first();
    if ((recent?.cnt ?? 0) >= 5) {
      return json(
        { error: 'Too many code requests. Please wait a little while, then try again.' },
        { status: 429 },
      );
    }

    // Invalidate any prior unused codes for this email.
    await env.DB.prepare(
      `DELETE FROM auth_token WHERE email = ? AND purpose = 'login' AND used_at IS NULL`,
    ).bind(email.toLowerCase()).run();
    await env.DB.prepare(
      `INSERT INTO auth_token (token, email, purpose, expires_at) VALUES (?, ?, 'login', ?)`,
    ).bind(t, email.toLowerCase(), expires).run();
  }

  // Send the code. If the email service fails, roll back the token we just
  // created so this failed attempt doesn't count against the rate limit, and
  // return the real reason instead of an opaque 500.
  try {
    await sendEmail(env, {
      to: email,
      subject: `${displayCode} — your Bloodline sign-in code`,
      html: codeEmail(displayCode),
    });
  } catch (e) {
    console.error('[auth/request] sendEmail failed:', e.message);
    if (env.DB) {
      await env.DB.prepare(`DELETE FROM auth_token WHERE token = ?`).bind(t).run().catch(() => {});
    }
    return json(
      { error: "We couldn't send your sign-in code right now. Please try again in a moment." },
      { status: 502 },
    );
  }

  return json({ ok: true });
}

function codeEmail(code) {
  const digits = code.split('');
  const box = (d) =>
    `<span style="display:inline-block;width:44px;height:52px;line-height:52px;text-align:center;font-size:28px;font-weight:700;color:#241f1c;background:#f5f0ea;border-radius:10px;margin:0 3px;">${d}</span>`;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:48px 24px;">
  <div style="text-align:center;margin-bottom:28px;">
    <svg width="36" height="36" viewBox="0 0 56 56" fill="none"><circle cx="28" cy="14" r="10" fill="#c2603a"/><circle cx="14" cy="40" r="8" fill="#c2603a" opacity=".7"/><circle cx="42" cy="40" r="8" fill="#c2603a" opacity=".5"/><line x1="28" y1="24" x2="14" y2="32" stroke="#c2603a" stroke-width="2.5" opacity=".6"/><line x1="28" y1="24" x2="42" y2="32" stroke="#c2603a" stroke-width="2.5" opacity=".6"/></svg>
    <div style="margin-top:10px;font-size:20px;font-weight:700;color:#241f1c;">Bloodline</div>
  </div>
  <div style="background:#fff;border-radius:24px;padding:40px 36px;box-shadow:0 4px 32px rgba(0,0,0,0.07);text-align:center;">
    <p style="margin:0 0 6px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#a09590;">Your sign-in code</p>
    <h1 style="margin:0 0 28px;font-size:15px;color:#6b6260;font-weight:400;line-height:1.5;">
      Enter this code in Bloodline. It expires in 15 minutes.
    </h1>
    <div style="margin:0 0 32px;letter-spacing:0;">
      ${digits.map(box).join('')}
    </div>
    <p style="margin:0;font-size:12px;color:#c0b8b4;line-height:1.6;">
      If you didn't request this, you can safely ignore it.
    </p>
  </div>
</div>
</body>
</html>`;
}

import { json, token, sendEmail } from '../../_lib/util.js';

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

  const t = token();
  const code = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit OTP
  const expires = Math.floor(Date.now() / 1000) + 60 * 30; // 30 min

  if (env.DB) {
    await env.DB.prepare(
      `INSERT INTO auth_token (token, email, purpose, expires_at, code) VALUES (?, ?, 'login', ?, ?)`,
    ).bind(t, email.toLowerCase(), expires, code).run();
  }

  const base = `${env.APP_URL || ''}/api/auth/verify?token=${t}`;
  const link = invite ? `${base}&invite=${encodeURIComponent(invite)}` : base;

  await sendEmail(env, {
    to: email,
    subject: `${code} is your Bloodline code`,
    html: loginEmail(link, code),
  });

  return json({ ok: true });
}

function loginEmail(link, code) {
  const display = `${code.slice(0, 3)} ${code.slice(3)}`;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0ea;font-family:-apple-system,sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:48px 24px;">
  <div style="text-align:center;margin-bottom:32px;">
    <svg width="36" height="36" viewBox="0 0 56 56" fill="none"><circle cx="28" cy="14" r="10" fill="#c2603a"/><circle cx="14" cy="40" r="8" fill="#c2603a" opacity=".7"/><circle cx="42" cy="40" r="8" fill="#c2603a" opacity=".5"/><line x1="28" y1="24" x2="14" y2="32" stroke="#c2603a" stroke-width="2.5" opacity=".6"/><line x1="28" y1="24" x2="42" y2="32" stroke="#c2603a" stroke-width="2.5" opacity=".6"/></svg>
    <div style="margin-top:10px;font-size:20px;font-weight:700;color:#241f1c;">Bloodline</div>
  </div>
  <div style="background:#fff;border-radius:24px;padding:40px 36px;box-shadow:0 4px 32px rgba(0,0,0,0.07);">
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#241f1c;">Your sign-in code</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#6b6260;line-height:1.5;">
      Enter this code on the Bloodline website, or tap the button below.
    </p>
    <div style="text-align:center;margin-bottom:28px;">
      <span style="display:inline-block;font-size:42px;font-weight:800;letter-spacing:0.12em;color:#241f1c;background:#f5f0ea;border-radius:16px;padding:16px 28px;line-height:1;">${display}</span>
      <p style="margin:10px 0 0;font-size:13px;color:#9b9290;">Expires in 30 minutes</p>
    </div>
    <a href="${link}" style="display:block;text-align:center;background:#c2603a;color:#fff;font-size:16px;font-weight:600;padding:16px;border-radius:12px;text-decoration:none;">
      Or tap to open Bloodline →
    </a>
    <p style="margin:20px 0 0;text-align:center;font-size:12px;color:#c0b8b4;">
      If you didn't request this, you can safely ignore it.
    </p>
  </div>
</div>
</body>
</html>`;
}

/*
 * GET /invite/[token]
 * Branded landing page for family invitations. Server-rendered HTML — no React.
 * Shows who invited you, to which family, in what role, and a feature showcase,
 * then collects an email to send the magic-link sign-in.
 */
export async function onRequestGet({ params, env }) {
  const { token } = params;
  const home = env.APP_URL || '/';

  if (!env.DB) {
    return page(errorHtml('Service unavailable', 'Please try again later.', home));
  }

  const now = Math.floor(Date.now() / 1000);
  const invite = await env.DB.prepare(
    `SELECT i.id, i.email, i.role, i.status, i.expires_at,
            f.name  AS family_name,
            u.email AS from_email
       FROM invite i
       JOIN family f ON f.id = i.family_id
       LEFT JOIN user u ON u.id = i.from_user
      WHERE i.token = ?`,
  ).bind(token).first();

  if (!invite) {
    return page(errorHtml('Invitation not found', 'This link may have already been used or doesn\'t exist.', home));
  }
  if (invite.status !== 'pending' || invite.expires_at < now) {
    return page(errorHtml('Invitation expired', 'Ask the family owner to send you a new invitation.', home));
  }

  const roleLabels = { owner: 'Owner', coadmin: 'Co-Admin', editor: 'Editor', contributor: 'Contributor', viewer: 'Viewer' };
  const roleLabel = roleLabels[invite.role] || invite.role;

  return page(landingHtml({ token, invite, roleLabel, home }));
}

function page(html) {
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function errorHtml(title, body, home) {
  return shell(`
    <div class="card">
      <div class="brand"><svg-logo></svg-logo><span>Bloodline</span></div>
      <div class="error-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 9v4M12 17h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></div>
      <h1>${title}</h1>
      <p class="sub">${body}</p>
      <a href="${home}" class="btn-secondary">Go to Bloodline</a>
    </div>
  `);
}

function landingHtml({ token, invite, roleLabel, home }) {
  const fromName = invite.from_email
    ? invite.from_email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : 'Someone';

  return shell(`
    <div class="card">
      <div class="brand">
        <svg width="36" height="36" viewBox="0 0 56 56" fill="none" aria-hidden="true">
          <circle cx="28" cy="14" r="10" fill="#c2603a"/>
          <circle cx="14" cy="40" r="8" fill="#c2603a" opacity="0.7"/>
          <circle cx="42" cy="40" r="8" fill="#c2603a" opacity="0.5"/>
          <line x1="28" y1="24" x2="14" y2="32" stroke="#c2603a" stroke-width="2.5" opacity="0.6"/>
          <line x1="28" y1="24" x2="42" y2="32" stroke="#c2603a" stroke-width="2.5" opacity="0.6"/>
        </svg>
        <span>Bloodline</span>
      </div>

      <p class="eyebrow">You've been invited</p>
      <h1>${invite.family_name}</h1>
      <p class="invite-meta">
        ${fromName} has invited you to join the family tree
        as <strong class="role-chip">${roleLabel}</strong>
      </p>

      <div class="features">
        <div class="feature">
          <div class="feature__icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="4" r="2.2" stroke="currentColor" stroke-width="1.7"/><circle cx="5" cy="19" r="2.2" stroke="currentColor" stroke-width="1.7"/><circle cx="19" cy="19" r="2.2" stroke="currentColor" stroke-width="1.7"/><path d="M12 6.2v5M12 11.2l-5.5 5.3M12 11.2l5.5 5.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></div>
          <div>
            <div class="feature__title">Family tree</div>
            <div class="feature__desc">An interactive portrait of everyone and how they connect.</div>
          </div>
        </div>
        <div class="feature">
          <div class="feature__icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg></div>
          <div>
            <div class="feature__title">Memories</div>
            <div class="feature__desc">Stories, moments, and things that should never be forgotten.</div>
          </div>
        </div>
        <div class="feature">
          <div class="feature__icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="13" r="4" stroke="currentColor" stroke-width="1.7"/></svg></div>
          <div>
            <div class="feature__title">Photos</div>
            <div class="feature__desc">A gallery of faces and places across the generations.</div>
          </div>
        </div>
      </div>

      <div class="divider"></div>

      <div id="form-wrap">
        <label class="label" for="email">Enter your email to accept</label>
        <input id="email" type="email" class="input" placeholder="you@example.com" autocomplete="email">
        <button id="submit" class="btn" onclick="send()">Accept invitation →</button>
        <p id="hint" class="hint"></p>
      </div>

      <div id="sent-wrap" style="display:none;text-align:center;padding:12px 0;">
        <div class="sent-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M22 6l-10 7L2 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></div>
        <p class="sent-title">Check your inbox</p>
        <p class="sent-body">We sent a sign-in code to <strong id="sent-email"></strong>.<br>Enter it to open the family tree.</p>
        <p class="sent-spam">Can't find it? Check your <strong>spam</strong> or <strong>junk</strong> folder — and mark it &ldquo;not spam&rdquo; so the rest come through.</p>
      </div>
    </div>

    <script>
    const INVITE_TOKEN = ${JSON.stringify(token)};
    async function send() {
      const email = document.getElementById('email').value.trim();
      if (!email) return;
      const btn = document.getElementById('submit');
      const hint = document.getElementById('hint');
      btn.disabled = true;
      btn.textContent = 'Sending…';
      hint.textContent = '';
      try {
        const res = await fetch('/api/auth/request', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, invite: INVITE_TOKEN }),
        });
        if (!res.ok) throw new Error();
        // Hand off to the main app's LoginScreen which will collect the OTP.
        // We carry both the invite token and the email so it can skip the
        // email entry step and go straight to the code input.
        window.location.href = '/?invite=' + encodeURIComponent(INVITE_TOKEN)
          + '&auth_email=' + encodeURIComponent(email);
      } catch {
        hint.textContent = 'Something went wrong. Please try again.';
        btn.disabled = false;
        btn.textContent = 'Accept invitation →';
      }
    }
    document.getElementById('email').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    </script>
  `);
}

function shell(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>You're invited — Bloodline</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@600;700&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --accent: #c2603a;
    --ink: #241f1c;
    --ink-soft: #6b6260;
    --ground: #f5f0ea;
    --hairline: #ebedf0;
  }
  body {
    min-height: 100dvh;
    background: var(--ground);
    font-family: 'Hanken Grotesk', -apple-system, sans-serif;
    -webkit-font-smoothing: antialiased;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    color: var(--ink);
  }
  .card {
    background: #fff;
    border-radius: 28px;
    padding: 44px 40px 40px;
    width: min(480px, 100%);
    box-shadow: 0 8px 48px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.05);
  }
  @media (max-width: 520px) { .card { padding: 36px 28px 32px; } }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: 'Fraunces', Georgia, serif;
    font-size: 22px;
    font-weight: 700;
    color: var(--accent);
    margin-bottom: 32px;
    letter-spacing: -0.02em;
  }
  .eyebrow {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--ink-soft);
    margin-bottom: 8px;
  }
  h1 {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 32px;
    font-weight: 700;
    line-height: 1.1;
    color: var(--ink);
    margin-bottom: 12px;
    letter-spacing: -0.02em;
  }
  .invite-meta {
    font-size: 15px;
    color: var(--ink-soft);
    line-height: 1.5;
    margin-bottom: 28px;
  }
  .role-chip {
    color: var(--accent);
    font-weight: 700;
  }
  .features {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-bottom: 28px;
  }
  .feature {
    display: flex;
    gap: 14px;
    align-items: flex-start;
  }
  .feature__icon { width: 22px; height: 22px; flex-shrink: 0; margin-top: 2px; color: var(--accent); }
  .feature__title { font-size: 14px; font-weight: 600; color: var(--ink); margin-bottom: 2px; }
  .feature__desc { font-size: 13px; color: var(--ink-soft); line-height: 1.4; }
  .divider { height: 1px; background: var(--hairline); margin-bottom: 28px; }
  .label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-soft);
    margin-bottom: 10px;
    letter-spacing: 0.01em;
  }
  .input {
    display: block;
    width: 100%;
    border: 1.5px solid var(--hairline);
    border-radius: 12px;
    padding: 14px 16px;
    font-size: 16px;
    font-family: 'Hanken Grotesk', sans-serif;
    color: var(--ink);
    background: #fff;
    outline: none;
    margin-bottom: 12px;
    transition: border-color 0.15s;
    -webkit-appearance: none;
  }
  .input:focus { border-color: var(--accent); }
  .btn {
    display: block;
    width: 100%;
    padding: 16px;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 12px;
    font-size: 17px;
    font-family: 'Hanken Grotesk', sans-serif;
    font-weight: 600;
    cursor: pointer;
    letter-spacing: 0.01em;
    box-shadow: 0 4px 20px rgba(194,96,58,0.28);
    transition: opacity 0.15s, transform 0.15s;
  }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn:not(:disabled):active { transform: scale(0.98); }
  .btn-secondary {
    display: inline-block;
    margin-top: 16px;
    font-size: 15px;
    color: var(--accent);
    font-family: 'Hanken Grotesk', sans-serif;
    font-weight: 600;
    text-decoration: none;
  }
  .hint { margin-top: 12px; font-size: 13px; color: #c0392b; }
  .error-icon { margin: 16px 0 20px; color: #c2603a; }
  .sub { font-size: 15px; color: var(--ink-soft); line-height: 1.5; margin-top: 12px; }
  .sent-icon { margin-bottom: 16px; color: #3a8a4a; }
  .sent-title { font-family: 'Fraunces', serif; font-size: 22px; font-weight: 700; margin-bottom: 10px; }
  .sent-body { font-size: 15px; color: var(--ink-soft); line-height: 1.6; }
  .sent-spam { margin-top: 16px; font-size: 13px; color: var(--ink-soft); line-height: 1.5; background: #f7f3ec; border-radius: 12px; padding: 12px 14px; }
  .sent-spam strong { color: var(--ink); }
</style>
</head>
<body>${content}</body>
</html>`;
}

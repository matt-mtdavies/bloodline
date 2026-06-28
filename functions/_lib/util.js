// Shared helpers for Bloodline's Pages Functions.

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) },
  });
}

export function uid(prefix = '') {
  return prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

export function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// HMAC-sign a session payload for an httpOnly cookie (no passwords anywhere).
export async function signSession(payload, secret) {
  if (secret === 'dev') {
    console.warn('[auth] SESSION_SECRET is unset — sessions are signed with "dev". Set it immediately: Pages → Settings → Environment variables → SESSION_SECRET (secret).');
  }
  const body = btoa(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${body}.${sigB64}`;
}

// Verify a signed session cookie value. Returns the payload or null.
export async function verifySession(cookieHeader, secret) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/bl_session=([^;]+)/);
  if (!match) return null;
  const [body, sig] = match[1].split('.');
  if (!body || !sig) return null;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const sigBytes = Uint8Array.from(atob(sig), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      'HMAC', key, sigBytes, new TextEncoder().encode(body),
    );
    if (!valid) return null;
    return JSON.parse(atob(body));
  } catch {
    return null;
  }
}

export function sessionCookie(value) {
  // 30-day signed, httpOnly session cookie.
  return `bl_session=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`;
}

export function clearSessionCookie() {
  return 'bl_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
}

// Record an invite's email-delivery outcome for the admin deliverability
// metric. Best-effort and self-contained: if migration 0007 hasn't added the
// columns yet (or DB is absent), it silently no-ops so invite creation is
// never affected.
export async function recordEmailStatus(env, inviteId, status, error, sentAt) {
  if (!env.DB || !inviteId) return;
  try {
    await env.DB.prepare(
      `UPDATE invite SET email_status = ?, email_error = ?, email_sent_at = ? WHERE id = ?`,
    ).bind(status, error ? String(error).slice(0, 300) : null, sentAt ?? null, inviteId).run();
  } catch {
    /* columns not migrated yet — the metric simply won't populate */
  }
}

// Send a transactional email via Brevo.
// Pass `text` alongside `html` — emails with a plain-text alternative score
// significantly better in spam filters (Hotmail, Exchange, APG corporate, etc.)
export async function sendEmail(env, { to, subject, html, text, replyTo, tag }) {
  if (!env.BREVO_API_KEY) {
    console.log('[dev] email suppressed (no BREVO_API_KEY):', subject, '->', to);
    return { dev: true };
  }
  // A missing/blank sender makes Brevo reject every send with an opaque 400.
  // Fail loudly with an actionable message instead so the cause is obvious.
  if (!env.FROM_EMAIL) {
    throw new Error('FROM_EMAIL is not configured — set it in wrangler.toml / Pages env vars.');
  }
  const body = {
    sender: { name: 'Bloodline', email: env.FROM_EMAIL },
    to: [{ email: to }],
    subject,
    htmlContent: html,
  };
  if (text) body.textContent = text;
  // A real reply-to (the inviter) reads as a genuine personal message and lifts
  // inbox placement; tags let us see per-type delivery in Brevo's dashboard.
  if (replyTo) body.replyTo = { email: replyTo };
  if (tag) body.tags = [tag];
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Brevo ${res.status}: ${detail}`);
  }
  return res.json();
}

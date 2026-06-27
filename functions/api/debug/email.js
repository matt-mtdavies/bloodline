import { json, sendEmail } from '../../_lib/util.js';

/*
 * Email deliverability diagnostic — triage for "invite emails not arriving".
 *
 * GET  /api/debug/email
 *   Reports whether the email sender is configured, WITHOUT exposing secrets:
 *   { brevoConfigured, fromEmailConfigured, fromEmail }. Any logged-in user.
 *
 * POST /api/debug/email
 *   Sends a real test email to the CALLER'S OWN address only (never an
 *   arbitrary recipient — no spam vector) so delivery can be confirmed
 *   end-to-end. Returns { ok, sent, error }.
 */
export async function onRequestGet({ env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  return json({
    brevoConfigured: !!env.BREVO_API_KEY,
    fromEmailConfigured: !!env.FROM_EMAIL,
    fromEmail: env.FROM_EMAIL || null,
    appUrl: env.APP_URL || null,
  });
}

export async function onRequestPost({ env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  const to = data.user.email;
  if (!to) return json({ error: 'No email on your account' }, { status: 400 });

  try {
    const result = await sendEmail(env, {
      to,
      subject: 'Bloodline email test ✓',
      html: `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;padding:24px;color:#241f1c;">
        <h2 style="color:#c2603a;">Bloodline email is working</h2>
        <p>If you're reading this, transactional email (the same path invites use) is delivering to your inbox.</p>
        <p style="color:#8a8480;font-size:13px;">Sent ${new Date().toISOString()}</p>
      </body></html>`,
      text: 'Bloodline email is working. If you received this, invite emails should deliver too.',
    });
    return json({ ok: true, sent: !result?.dev, dev: !!result?.dev, to });
  } catch (e) {
    return json({ ok: false, sent: false, error: String(e.message || e).slice(0, 300) });
  }
}

import { json, sendEmail, recordEmailStatus } from '../../_lib/util.js';

const ROLE_LABELS = {
  coadmin: 'Co-Admin',
  editor: 'Editor',
  contributor: 'Contributor',
  viewer: 'Viewer',
};

/*
 * POST /api/invite/resend  { id }
 * Re-sends the invite email for an existing pending invite (same token, same link).
 * Caller must be owner or coadmin of the family.
 */
export async function onRequestPost({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  let id;
  try { ({ id } = await request.json()); } catch { return json({ error: 'Bad request' }, { status: 400 }); }

  const membership = await env.DB.prepare(
    `SELECT fm.family_id, fm.role, f.name as family_name
       FROM family_member fm JOIN family f ON f.id = fm.family_id
      WHERE fm.user_id = ?`,
  ).bind(data.user.uid).first();

  if (!membership || !['owner', 'coadmin'].includes(membership.role)) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  const invite = await env.DB.prepare(
    `SELECT id, email, role, token FROM invite WHERE id = ? AND family_id = ? AND status = 'pending'`,
  ).bind(id, membership.family_id).first();

  if (!invite) return json({ error: 'Invite not found or already accepted' }, { status: 404 });

  const inviteUrl = `${env.APP_URL || 'https://myfamilybloodline.com'}/invite/${invite.token}`;
  const roleLabel = ROLE_LABELS[invite.role] || invite.role;
  const familyName = membership.family_name;
  const fromEmail = data.user.email;

  let emailSent = false;
  let emailError = null;
  let emailStatus = 'failed';
  try {
    const result = await sendEmail(env, {
      to: invite.email,
      subject: `You're invited to join ${familyName} on Bloodline`,
      html: inviteHtml({ inviteUrl, fromEmail, familyName, roleLabel }),
      text: inviteText({ inviteUrl, fromEmail, familyName, roleLabel }),
    });
    emailSent = true;
    emailStatus = result?.dev ? 'dev' : 'sent';
  } catch (e) {
    console.error('[invite/resend] email failed:', e.message);
    emailError = String(e.message || 'Email delivery failed').slice(0, 200);
  }

  await recordEmailStatus(env, invite.id, emailStatus, emailError, emailSent ? Math.floor(Date.now() / 1000) : null);

  return json({ ok: true, emailSent, emailError });
}

function inviteText({ inviteUrl, fromEmail, familyName, roleLabel }) {
  return [
    `You're invited to join ${familyName} on Bloodline`,
    '',
    `${fromEmail} has invited you to join the family tree as ${roleLabel}.`,
    '',
    'Bloodline is a living portrait of your family — an interactive tree, stories, memories and photos across generations.',
    '',
    'Accept your invitation here:',
    inviteUrl,
    '',
    'This link expires in 7 days.',
    '',
    "If you weren't expecting this you can safely ignore this email.",
  ].join('\n');
}

function inviteHtml({ inviteUrl, fromEmail, familyName, roleLabel }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>You're invited to ${familyName}</title>
</head>
<body style="margin:0;padding:0;background:#f5f0ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:520px;margin:0 auto;padding:48px 24px 64px;">
  <div style="text-align:center;margin-bottom:36px;">
    <div style="font-size:24px;font-weight:700;color:#c2603a;letter-spacing:-0.02em;">Bloodline</div>
    <div style="margin-top:4px;font-size:13px;color:#a09590;letter-spacing:0.08em;text-transform:uppercase;">Your family, preserved forever</div>
  </div>
  <div style="background:#ffffff;border-radius:24px;padding:44px 40px;box-shadow:0 4px 32px rgba(0,0,0,0.07);">
    <p style="margin:0 0 6px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#a09590;">You've been invited</p>
    <h1 style="margin:0 0 8px;font-size:28px;font-weight:700;color:#241f1c;line-height:1.2;">${familyName}</h1>
    <p style="margin:0 0 32px;font-size:15px;color:#6b6260;line-height:1.5;">
      <strong style="color:#241f1c;">${fromEmail}</strong> has invited you to join the family tree
      as <span style="color:#c2603a;font-weight:600;">${roleLabel}</span>.
    </p>
    <a href="${inviteUrl}"
       style="display:block;text-align:center;background:#c2603a;color:#ffffff;font-size:17px;font-weight:600;padding:18px 24px;border-radius:14px;text-decoration:none;letter-spacing:0.01em;box-shadow:0 4px 20px rgba(194,96,58,0.3);">
      Accept invitation &rarr;
    </a>
    <p style="margin:16px 0 0;text-align:center;font-size:13px;color:#b0a9a5;">This link expires in 7 days.</p>
  </div>
  <p style="margin-top:28px;text-align:center;font-size:12px;color:#c0b8b4;line-height:1.6;">
    If you weren't expecting this you can safely ignore it.<br>
    <a href="${inviteUrl}" style="color:#c0b8b4;">${inviteUrl}</a>
  </p>
</div>
</body>
</html>`;
}

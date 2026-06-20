import { json, uid, token, sendEmail } from '../../_lib/util.js';

const VALID_ROLES = ['coadmin', 'editor', 'contributor', 'viewer'];
const ROLE_LABELS = {
  coadmin: 'Co-Admin',
  editor: 'Editor',
  contributor: 'Contributor',
  viewer: 'Viewer',
};

/*
 * POST /api/invite  { email, role }
 * Creates a pending invite and emails a branded landing-page link.
 * Requires the caller to be owner or coadmin of their family.
 */
export async function onRequestPost({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  let email, role;
  try {
    ({ email, role } = await request.json());
  } catch {
    return json({ error: 'Bad request' }, { status: 400 });
  }

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'A valid email is required' }, { status: 400 });
  }
  if (!VALID_ROLES.includes(role)) {
    return json({ error: 'Invalid role' }, { status: 400 });
  }

  const membership = await env.DB.prepare(
    `SELECT fm.family_id, fm.role, f.name as family_name
       FROM family_member fm JOIN family f ON f.id = fm.family_id
      WHERE fm.user_id = ?`,
  ).bind(data.user.uid).first();

  if (!membership) return json({ error: 'No family found' }, { status: 404 });
  if (!['owner', 'coadmin'].includes(membership.role)) {
    return json({ error: 'Only owners and co-admins can invite' }, { status: 403 });
  }

  const t = token();
  const inviteId = uid('inv_');
  const now = Math.floor(Date.now() / 1000);
  const expires = now + 60 * 60 * 24 * 7; // 7 days

  await env.DB.prepare(
    `INSERT INTO invite (id, family_id, from_user, email, token, role, status, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).bind(inviteId, membership.family_id, data.user.uid, email.toLowerCase(), t, role, expires, now).run();

  const inviteUrl = `${env.APP_URL || ''}/invite/${t}`;
  const roleLabel = ROLE_LABELS[role];
  const fromEmail = data.user.email;
  const familyName = membership.family_name;

  await sendEmail(env, {
    to: email,
    subject: `You're invited to join ${familyName} on Bloodline`,
    html: inviteEmail({ inviteUrl, fromEmail, familyName, roleLabel }),
  });

  return json({ ok: true, inviteId });
}

/*
 * GET /api/invite  — list pending invites for the caller's family.
 */
export async function onRequestGet({ env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  const membership = await env.DB.prepare(
    'SELECT family_id, role FROM family_member WHERE user_id = ?',
  ).bind(data.user.uid).first();

  if (!membership || !['owner', 'coadmin'].includes(membership.role)) {
    return json({ invites: [], members: [] });
  }

  const [{ results: invites }, { results: members }] = await Promise.all([
    env.DB.prepare(
      `SELECT id, email, role, status, created_at, expires_at
         FROM invite WHERE family_id = ? AND status = 'pending'
        ORDER BY created_at DESC`,
    ).bind(membership.family_id).all(),
    env.DB.prepare(
      `SELECT u.id, u.email, fm.role, fm.joined_at
         FROM family_member fm JOIN user u ON u.id = fm.user_id
        WHERE fm.family_id = ?
        ORDER BY fm.joined_at ASC`,
    ).bind(membership.family_id).all(),
  ]);

  return json({ invites, members });
}

function inviteEmail({ inviteUrl, fromEmail, familyName, roleLabel }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>You're invited to ${familyName}</title>
</head>
<body style="margin:0;padding:0;background:#f5f0ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;">
<div style="max-width:520px;margin:0 auto;padding:48px 24px 64px;">

  <!-- Brand -->
  <div style="text-align:center;margin-bottom:36px;">
    <svg width="40" height="40" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="28" cy="14" r="10" fill="#c2603a"/>
      <circle cx="14" cy="40" r="8" fill="#c2603a" opacity="0.7"/>
      <circle cx="42" cy="40" r="8" fill="#c2603a" opacity="0.5"/>
      <line x1="28" y1="24" x2="14" y2="32" stroke="#c2603a" stroke-width="2" opacity="0.5"/>
      <line x1="28" y1="24" x2="42" y2="32" stroke="#c2603a" stroke-width="2" opacity="0.5"/>
    </svg>
    <div style="margin-top:10px;font-size:20px;font-weight:700;color:#241f1c;letter-spacing:-0.02em;">Bloodline</div>
    <div style="margin-top:4px;font-size:13px;color:#a09590;letter-spacing:0.08em;text-transform:uppercase;">Your family, preserved forever</div>
  </div>

  <!-- Card -->
  <div style="background:#ffffff;border-radius:24px;padding:44px 40px;box-shadow:0 4px 32px rgba(0,0,0,0.07);">
    <p style="margin:0 0 6px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#a09590;">You've been invited</p>
    <h1 style="margin:0 0 8px;font-size:28px;font-weight:700;color:#241f1c;line-height:1.2;">${familyName}</h1>
    <p style="margin:0 0 32px;font-size:15px;color:#6b6260;line-height:1.5;">
      <strong style="color:#241f1c;">${fromEmail}</strong> has invited you to join the family tree
      as <span style="color:#c2603a;font-weight:600;">${roleLabel}</span>.
    </p>

    <!-- Features -->
    <div style="border-top:1px solid #ebedf0;border-bottom:1px solid #ebedf0;padding:24px 0;margin-bottom:32px;">
      ${featureRow('🌳', 'Family tree', 'An interactive map of everyone and how they connect.')}
      ${featureRow('💬', 'Memories', 'Stories, moments, and things worth remembering.')}
      ${featureRow('📷', 'Photos', 'A gallery of faces and places across the generations.')}
    </div>

    <a href="${inviteUrl}"
       style="display:block;text-align:center;background:#c2603a;color:#ffffff;font-size:17px;font-weight:600;padding:18px 24px;border-radius:14px;text-decoration:none;letter-spacing:0.01em;box-shadow:0 4px 20px rgba(194,96,58,0.3);">
      Accept invitation →
    </a>

    <p style="margin:16px 0 0;text-align:center;font-size:13px;color:#b0a9a5;">
      This link expires in 7 days.
    </p>
  </div>

  <!-- Footer -->
  <p style="margin-top:28px;text-align:center;font-size:12px;color:#c0b8b4;line-height:1.6;">
    If you weren't expecting this invitation you can safely ignore it.<br>
    <a href="${inviteUrl}" style="color:#c0b8b4;">${inviteUrl}</a>
  </p>

</div>
</body>
</html>`;
}

function featureRow(icon, title, desc) {
  return `<div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:16px;">
  <div style="font-size:22px;line-height:1;flex-shrink:0;">${icon}</div>
  <div>
    <div style="font-size:14px;font-weight:600;color:#241f1c;margin-bottom:2px;">${title}</div>
    <div style="font-size:13px;color:#8a8480;line-height:1.4;">${desc}</div>
  </div>
</div>`;
}

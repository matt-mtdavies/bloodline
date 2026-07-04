import { json, uid, token, sendEmail, recordEmailStatus } from '../../_lib/util.js';

const VALID_ROLES = ['coadmin', 'editor', 'contributor', 'viewer'];
const ROLE_LABELS = {
  coadmin: 'Co-Admin',
  editor: 'Editor',
  contributor: 'Contributor',
  viewer: 'Viewer',
};
// Lower number = more access. A member may only invite someone at their own
// level or below, so nobody can grant more access than they hold themselves.
const ROLE_RANK = { owner: 0, coadmin: 1, editor: 2, contributor: 3, viewer: 4 };

/*
 * POST /api/invite  { email, role }
 * Creates a pending invite and emails a branded landing-page link.
 * Requires the caller to be owner or coadmin of their family.
 */
export async function onRequestPost({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  let email, role, notify, person_id, person_name;
  try {
    ({ email, role, notify, person_id, person_name } = await request.json());
  } catch {
    return json({ error: 'Bad request' }, { status: 400 });
  }
  // Optional — every existing caller/flow that doesn't send these keeps
  // working exactly as before (NULL, generic email copy, email-match-only
  // suggestion on accept).
  const personId = (typeof person_id === 'string' && person_id.trim()) ? person_id.trim() : null;
  const personName = (typeof person_name === 'string' && person_name.trim())
    ? person_name.trim().slice(0, 120)
    : null;

  // notify defaults to true (email invite). When false, we just mint a share
  // link and skip the email — email is then optional.
  const wantsEmail = notify !== false;
  email = (email || '').trim().toLowerCase();
  if (wantsEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'A valid email is required' }, { status: 400 });
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'That email doesn’t look right' }, { status: 400 });
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
  // Any family member can share, but can't grant more access than they have.
  const callerRank = ROLE_RANK[membership.role] ?? ROLE_RANK.viewer;
  if ((ROLE_RANK[role] ?? ROLE_RANK.viewer) < callerRank) {
    return json(
      { error: "You can only invite people at your own access level or below." },
      { status: 403 },
    );
  }

  // Supersede existing pending invites for this email so there's at most one
  // live invite per address. Skip for link-only invites with no email, so each
  // generated link stands on its own.
  if (email) {
    await env.DB.prepare(
      `UPDATE invite SET status = 'superseded' WHERE family_id = ? AND email = ? AND status = 'pending'`,
    ).bind(membership.family_id, email).run();
  }

  const t = token();
  const inviteId = uid('inv_');
  const now = Math.floor(Date.now() / 1000);
  const expires = now + 60 * 60 * 24 * 7; // 7 days

  await env.DB.prepare(
    `INSERT INTO invite (id, family_id, from_user, email, token, role, status, expires_at, created_at, person_id, person_name)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
  ).bind(inviteId, membership.family_id, data.user.uid, email, t, role, expires, now, personId, personName).run();

  const inviteUrl = `${env.APP_URL || 'https://myfamilybloodline.com'}/invite/${t}`;
  const roleLabel = ROLE_LABELS[role];
  const fromEmail = data.user.email;
  const familyName = membership.family_name;

  let emailSent = false;
  let emailError = null;
  let emailStatus = 'link'; // link-only invite unless we actually send below
  if (wantsEmail && email) {
    emailStatus = 'failed';
    try {
      const result = await sendEmail(env, {
        to: email,
        subject: `${fromEmail.split('@')[0]} invited you to ${familyName} on Bloodline`,
        html: inviteEmail({ inviteUrl, fromEmail, familyName, roleLabel, personName }),
        text: inviteEmailText({ inviteUrl, fromEmail, familyName, roleLabel, personName }),
        replyTo: fromEmail,
        tag: 'invite',
      });
      emailSent = true;
      emailStatus = result?.dev ? 'dev' : 'sent';
    } catch (e) {
      // Invite row is already in D1 — don't 500. The client surfaces the warning
      // and offers the link instead; return the reason so it can be shown/logged.
      console.error('[invite] email delivery failed:', e.message);
      emailError = String(e.message || 'Email delivery failed').slice(0, 200);
    }
  }

  await recordEmailStatus(env, 'invite', inviteId, emailStatus, emailError, emailSent ? now : null);

  // Return the link too so the client can offer copy / share — handy when the
  // inviter would rather text it than rely on email.
  return json({ ok: true, inviteId, emailSent, emailError, inviteUrl });
}

/*
 * DELETE /api/invite?id=inv_xxx  — cancel a pending invite.
 */
export async function onRequestDelete({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  const inviteId = new URL(request.url).searchParams.get('id');
  if (!inviteId) return json({ error: 'id required' }, { status: 400 });

  const membership = await env.DB.prepare(
    'SELECT family_id, role FROM family_member WHERE user_id = ?',
  ).bind(data.user.uid).first();

  if (!membership || !['owner', 'coadmin'].includes(membership.role)) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  // Look up the email for this invite so we can cancel all pending duplicates too.
  const invite = await env.DB.prepare(
    `SELECT email FROM invite WHERE id = ? AND family_id = ?`,
  ).bind(inviteId, membership.family_id).first();

  if (!invite) return json({ error: 'Invite not found' }, { status: 404 });

  // Cancel every pending invite for this email in the family (clears duplicates).
  await env.DB.prepare(
    `UPDATE invite SET status = 'cancelled' WHERE family_id = ? AND email = ? AND status = 'pending'`,
  ).bind(membership.family_id, invite.email).run();

  return json({ ok: true });
}

/*
 * PATCH /api/invite  { id, role } — update the role on a pending invite.
 */
export async function onRequestPatch({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  let id, role;
  try {
    ({ id, role } = await request.json());
  } catch {
    return json({ error: 'Bad request' }, { status: 400 });
  }

  if (!VALID_ROLES.includes(role)) return json({ error: 'Invalid role' }, { status: 400 });

  const membership = await env.DB.prepare(
    'SELECT family_id, role FROM family_member WHERE user_id = ?',
  ).bind(data.user.uid).first();

  if (!membership || !['owner', 'coadmin'].includes(membership.role)) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  await env.DB.prepare(
    `UPDATE invite SET role = ? WHERE id = ? AND family_id = ? AND status = 'pending'`,
  ).bind(role, id, membership.family_id).run();

  return json({ ok: true });
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
      `SELECT id, email, role, status, created_at, expires_at, token
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

  // Attach a shareable link to each pending invite (owners/coadmins only, which
  // this branch already enforces). Drop the raw token from the payload.
  const base = env.APP_URL || 'https://myfamilybloodline.com';
  const invitesWithLinks = (invites || []).map(({ token, ...inv }) => ({
    ...inv,
    invite_url: `${base}/invite/${token}`,
  }));

  return json({ invites: invitesWithLinks, members });
}

function inviteEmailText({ inviteUrl, fromEmail, familyName, roleLabel, personName }) {
  const forLine = personName
    ? `${fromEmail} has invited you to join the family tree as ${roleLabel}, to help tell ${personName}'s story.`
    : `${fromEmail} has invited you to join the family tree as ${roleLabel}.`;
  return [
    `You're invited to join ${familyName} on Bloodline`,
    '',
    forLine,
    '',
    'Bloodline is a living portrait of your family — an interactive tree, stories, memories and photos across generations.',
    '',
    'Accept your invitation here:',
    inviteUrl,
    '',
    'This link expires in 7 days.',
    '',
    'If you weren\'t expecting this invitation you can safely ignore this email.',
  ].join('\n');
}

function inviteEmail({ inviteUrl, fromEmail, familyName, roleLabel, personName }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>You're invited to ${familyName}</title>
</head>
<body style="margin:0;padding:0;background:#f5f0ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:520px;margin:0 auto;padding:48px 24px 64px;">

  <!-- Brand (text-only — SVG blocks some spam filters) -->
  <div style="text-align:center;margin-bottom:36px;">
    <div style="font-size:24px;font-weight:700;color:#c2603a;letter-spacing:-0.02em;">Bloodline</div>
    <div style="margin-top:4px;font-size:13px;color:#a09590;letter-spacing:0.08em;text-transform:uppercase;">Your family, preserved forever</div>
  </div>

  <!-- Card -->
  <div style="background:#ffffff;border-radius:24px;padding:44px 40px;box-shadow:0 4px 32px rgba(0,0,0,0.07);">
    <p style="margin:0 0 6px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#a09590;">You've been invited</p>
    <h1 style="margin:0 0 8px;font-size:28px;font-weight:700;color:#241f1c;line-height:1.2;">${familyName}</h1>
    <p style="margin:0 0 32px;font-size:15px;color:#6b6260;line-height:1.5;">
      <strong style="color:#241f1c;">${fromEmail}</strong> has invited you to join the family tree
      as <span style="color:#c2603a;font-weight:600;">${roleLabel}</span>${personName ? `, to help tell <strong style="color:#241f1c;">${personName}</strong>'s story` : ''}.
    </p>

    <a href="${inviteUrl}"
       style="display:block;text-align:center;background:#c2603a;color:#ffffff;font-size:17px;font-weight:600;padding:18px 24px;border-radius:14px;text-decoration:none;letter-spacing:0.01em;box-shadow:0 4px 20px rgba(194,96,58,0.3);">
      Accept invitation &rarr;
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

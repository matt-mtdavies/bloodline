import { json } from '../_lib/util.js';

/*
 * GET /api/merge?invite=TOKEN
 * Returns the target family's tree so the client merge wizard can preview it.
 *
 * POST /api/merge  { invite, tree }
 * Finalises the merge: adds the user to the target family, saves the merged
 * tree, and marks the invite accepted. The merged tree is computed client-side
 * by the MergeWizard; we just persist whatever the client sends.
 */

export async function onRequestGet({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  const inviteToken = new URL(request.url).searchParams.get('invite');
  if (!inviteToken) return json({ error: 'invite required' }, { status: 400 });

  const now = Math.floor(Date.now() / 1000);
  const invite = await env.DB.prepare(
    `SELECT i.id, i.family_id, i.role, i.status, i.expires_at,
            f.name  AS family_name,
            u.email AS from_email
       FROM invite i
       JOIN family f ON f.id = i.family_id
       LEFT JOIN user u ON u.id = i.from_user
      WHERE i.token = ?`,
  ).bind(inviteToken).first();

  if (!invite) return json({ error: 'Invite not found' }, { status: 404 });
  if (invite.status !== 'pending' || invite.expires_at < now) {
    return json({ error: 'Invite expired' }, { status: 410 });
  }

  const treeRow = await env.DB.prepare(
    `SELECT tree_json FROM family_tree WHERE family_id = ?`,
  ).bind(invite.family_id).first();

  const tree = treeRow ? JSON.parse(treeRow.tree_json) : { people: [], relationships: [] };

  return json({
    familyId: invite.family_id,
    familyName: invite.family_name,
    role: invite.role,
    fromEmail: invite.from_email,
    tree,
  });
}

export async function onRequestPost({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  let inviteToken, mergedTree;
  try {
    ({ invite: inviteToken, tree: mergedTree } = await request.json());
  } catch {
    return json({ error: 'Bad request' }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const invite = await env.DB.prepare(
    `SELECT id, family_id, from_user, role, status, expires_at FROM invite WHERE token = ?`,
  ).bind(inviteToken).first();

  if (!invite || invite.status !== 'pending' || invite.expires_at < now) {
    return json({ error: 'Invite not valid or expired' }, { status: 410 });
  }

  // Add user to the target family.
  const alreadyMember = await env.DB.prepare(
    `SELECT user_id FROM family_member WHERE family_id = ? AND user_id = ?`,
  ).bind(invite.family_id, data.user.uid).first();

  if (!alreadyMember) {
    await env.DB.prepare(
      `INSERT INTO family_member (family_id, user_id, role, invited_by, joined_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(invite.family_id, data.user.uid, invite.role, invite.from_user, now).run();
  } else {
    await env.DB.prepare(
      `UPDATE family_member SET role = ? WHERE family_id = ? AND user_id = ?`,
    ).bind(invite.role, invite.family_id, data.user.uid).run();
  }

  await env.DB.prepare(`UPDATE user SET family_id = ? WHERE id = ?`)
    .bind(invite.family_id, data.user.uid).run();
  await env.DB.prepare(`UPDATE invite SET status = 'accepted' WHERE id = ?`)
    .bind(invite.id).run();

  // Persist the merged tree.
  await env.DB.prepare(
    `INSERT INTO family_tree (family_id, tree_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT (family_id) DO UPDATE
       SET tree_json = excluded.tree_json,
           updated_at = excluded.updated_at`,
  ).bind(invite.family_id, JSON.stringify(mergedTree), now).run();

  if (mergedTree.familyName) {
    await env.DB.prepare(`UPDATE family SET name = ? WHERE id = ?`)
      .bind(mergedTree.familyName, invite.family_id).run();
  }

  return json({ ok: true, familyId: invite.family_id });
}

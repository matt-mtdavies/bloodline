/*
 * Shared invite-processing logic used by both the OTP verify flow and the
 * direct accept endpoint (for users who are already logged in).
 *
 * Returns null on success, or { needsMerge: true, token } when the invitee
 * already belongs to a different family that has tree data.
 */
export async function processInvite(db, inviteToken, userId, now) {
  const invite = await db.prepare(
    `SELECT id, family_id, from_user, role, status, expires_at FROM invite WHERE token = ?`,
  ).bind(inviteToken).first();

  if (!invite || invite.status !== 'pending' || invite.expires_at < now) return null;

  // If the user already has a DIFFERENT family with tree data, hold off and
  // let the client run the merge wizard rather than silently overwriting.
  const otherFamily = await db.prepare(
    `SELECT fm.family_id FROM family_member fm
      WHERE fm.user_id = ? AND fm.family_id != ?`,
  ).bind(userId, invite.family_id).first();

  if (otherFamily) {
    const treeRow = await db.prepare(
      `SELECT tree_json FROM family_tree WHERE family_id = ?`,
    ).bind(otherFamily.family_id).first();
    if (treeRow) {
      try {
        const tree = JSON.parse(treeRow.tree_json);
        if ((tree.people?.length ?? 0) > 0) return { needsMerge: true, token: inviteToken };
      } catch { /* corrupt JSON — fall through to normal join */ }
    }
  }

  // Already a member of the target family? Just update their role.
  const existing = await db.prepare(
    `SELECT user_id FROM family_member WHERE family_id = ? AND user_id = ?`,
  ).bind(invite.family_id, userId).first();

  if (existing) {
    await db.prepare(
      `UPDATE family_member SET role = ? WHERE family_id = ? AND user_id = ?`,
    ).bind(invite.role, invite.family_id, userId).run();
  } else {
    await db.prepare(
      `INSERT INTO family_member (family_id, user_id, role, invited_by, joined_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(invite.family_id, userId, invite.role, invite.from_user, now).run();
  }

  await db.prepare(`UPDATE user SET family_id = ? WHERE id = ?`).bind(invite.family_id, userId).run();
  await db.prepare(`UPDATE invite SET status = 'accepted' WHERE id = ?`).bind(invite.id).run();
  return null;
}

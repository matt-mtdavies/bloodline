import { uid } from './util.js';
import { loadTree, loadFullTree, updateTree, splitTree, putExtra } from './treeStore.js';

/*
 * Shared invite-processing logic used by both the OTP verify flow and the
 * direct accept endpoint (for users who are already logged in).
 *
 * Returns null when there's no valid invite to process, { needsMerge: true,
 * token } when the invitee already belongs to a different family that has
 * tree data, or { personId } on a normal successful join — personId is the
 * person this invite was created for (see invite/index.js), or null for an
 * invite sent without one (a generic link-only share, or one created before
 * this field existed). Existing callers that only ever checked
 * `result?.needsMerge` keep working unchanged either way.
 */
export async function processInvite(env, inviteToken, userId, now) {
  const db = env.DB;
  const invite = await db.prepare(
    `SELECT id, family_id, from_user, role, status, expires_at, person_id FROM invite WHERE token = ?`,
  ).bind(inviteToken).first();

  if (!invite || invite.status !== 'pending' || invite.expires_at < now) return null;

  // If the user already has a DIFFERENT family with tree data, hold off and
  // let the client run the merge wizard rather than silently overwriting.
  const otherFamily = await db.prepare(
    `SELECT fm.family_id FROM family_member fm
      WHERE fm.user_id = ? AND fm.family_id != ?`,
  ).bind(userId, invite.family_id).first();

  if (otherFamily) {
    const treeRow = await loadTree(env, otherFamily.family_id);
    if (treeRow) {
      try {
        const tree = JSON.parse(treeRow.raw);
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

    // Append a member_joined event to the shared activity feed (tree_json).
    // `activity` is extra-owned (docs/TREE-STORAGE.md §6.2), so a migrated
    // family's row must be reassembled (loadFullTree, not a raw JSON.parse)
    // before mutating it, and re-split + written R2-before-D1 on the way
    // back out — otherwise this write would silently overwrite a migrated
    // family's core row with a legacy-shaped blob missing _extraVersion,
    // orphaning its real data in R2 with nothing left pointing to it.
    try {
      const joiner = await db.prepare(
        `SELECT email, display_name FROM user WHERE id = ?`,
      ).bind(userId).first();
      const full = await loadFullTree(env, invite.family_id);
      if (full && !full.extraError && joiner) {
        const tree = full.tree;
        const authorName = joiner.display_name
          || (joiner.email ? joiner.email.split('@')[0] : 'Someone');
        const event = {
          id: uid('act_'),
          type: 'member_joined',
          authorEmail: joiner.email,
          authorName,
          personId: null,
          personName: authorName,
          detail: invite.role,
          created_at: new Date(now * 1000).toISOString(),
        };
        tree.activity = [event, ...(tree.activity ?? [])].slice(0, 100);

        if (full.migrated) {
          const { core, extra } = splitTree(tree);
          await putExtra(env, invite.family_id, extra, now);
          await updateTree(env, invite.family_id, JSON.stringify({ ...core, _extraVersion: now }), now);
        } else {
          await updateTree(env, invite.family_id, JSON.stringify(tree), now);
        }
      }
    } catch { /* non-fatal — join still succeeds without the activity event */ }
  }

  await db.prepare(`UPDATE user SET family_id = ? WHERE id = ?`).bind(invite.family_id, userId).run();
  await db.prepare(`UPDATE invite SET status = 'accepted' WHERE id = ?`).bind(invite.id).run();
  return { personId: invite.person_id || null };
}

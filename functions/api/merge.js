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
    `SELECT tree_json, updated_at FROM family_tree WHERE family_id = ?`,
  ).bind(invite.family_id).first();

  let tree = { people: [], relationships: [] };
  if (treeRow) {
    try { tree = JSON.parse(treeRow.tree_json); } catch { /* corrupt — return empty */ }
  }

  return json({
    familyId: invite.family_id,
    familyName: invite.family_name,
    role: invite.role,
    fromEmail: invite.from_email,
    tree,
    // Lets the client detect, on submit, whether this family's tree changed
    // while the merge wizard was open — see the check in onRequestPost below.
    treeUpdatedAt: treeRow?.updated_at ?? null,
  });
}

export async function onRequestPost({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  let inviteToken, mergedTree, baseUpdatedAt;
  try {
    ({ invite: inviteToken, tree: mergedTree, baseUpdatedAt } = await request.json());
  } catch {
    return json({ error: 'Bad request' }, { status: 400 });
  }
  if (!inviteToken || !mergedTree || !Array.isArray(mergedTree.people)) {
    return json({ error: 'invite and tree.people required' }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const invite = await env.DB.prepare(
    `SELECT id, family_id, from_user, role, status, expires_at FROM invite WHERE token = ?`,
  ).bind(inviteToken).first();

  if (!invite || invite.status !== 'pending' || invite.expires_at < now) {
    return json({ error: 'Invite not valid or expired' }, { status: 410 });
  }

  // mergedTree was computed client-side (MergeWizard) against a snapshot of
  // the target family's tree fetched by GET above — potentially minutes
  // earlier, while the user reviewed which people to match. If anyone in
  // that family saved a change in the meantime, writing mergedTree straight
  // over the current row would silently erase it with no conflict ever
  // detected — unlike every other write path here (PUT /api/tree uses
  // ETag/If-Match specifically to prevent this). Guard the same way: compare
  // against the current row's updated_at, and if it moved, refuse the write
  // so the client can recompute the merge against the fresh tree and retry.
  // Checked here, before any of the membership/invite writes below, so a 409
  // leaves nothing mutated and the whole request is safely retryable — doing
  // this check only right before the tree write would leave the invite
  // already marked accepted, breaking a retry with a spurious 410.
  const currentTree = await env.DB.prepare(
    `SELECT tree_json, updated_at FROM family_tree WHERE family_id = ?`,
  ).bind(invite.family_id).first();
  if (currentTree && currentTree.updated_at !== baseUpdatedAt) {
    let freshTree = { people: [], relationships: [] };
    try { freshTree = JSON.parse(currentTree.tree_json); } catch { /* corrupt — fall through to empty */ }
    return json(
      { error: 'conflict', detail: 'The family tree changed while merging.', tree: freshTree, treeUpdatedAt: currentTree.updated_at },
      { status: 409 },
    );
  }

  // Add user to the target family. Idempotent — safe to re-run if the tree
  // write below hits a conflict and the client retries this whole request.
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

  // Leave any previous families so GET /api/tree returns the correct family.
  await env.DB.prepare(
    `DELETE FROM family_member WHERE user_id = ? AND family_id != ?`,
  ).bind(data.user.uid, invite.family_id).run();

  await env.DB.prepare(`UPDATE user SET family_id = ? WHERE id = ?`)
    .bind(invite.family_id, data.user.uid).run();

  // Persist the merged tree with a real compare-and-swap, not the earlier
  // read-then-write check above (which still leaves a gap between that read
  // and this write — small, but real, since several awaited queries run in
  // between for the membership updates). Deliberately NOT marking the invite
  // accepted until this succeeds: if it conflicts, the invite must still
  // read as 'pending' so the client's retry (recomputed merge, fresh
  // baseUpdatedAt) doesn't get rejected by the status check at the top of
  // this function. The membership writes above are harmless to repeat.
  let persisted;
  if (currentTree) {
    persisted = await env.DB.prepare(
      `UPDATE family_tree SET tree_json = ?, updated_at = ?
        WHERE family_id = ? AND updated_at = ?`,
    ).bind(JSON.stringify(mergedTree), now, invite.family_id, currentTree.updated_at).run();
  } else {
    try {
      await env.DB.prepare(
        `INSERT INTO family_tree (family_id, tree_json, updated_at) VALUES (?, ?, ?)`,
      ).bind(invite.family_id, JSON.stringify(mergedTree), now).run();
      persisted = { meta: { changes: 1 } };
    } catch {
      // A row appeared between the early check and here (e.g. this family's
      // very first save happened concurrently) — treat as a conflict below.
      persisted = { meta: { changes: 0 } };
    }
  }

  if (!persisted?.meta?.changes) {
    const freshRow = await env.DB.prepare(
      `SELECT tree_json, updated_at FROM family_tree WHERE family_id = ?`,
    ).bind(invite.family_id).first();
    let freshTree = { people: [], relationships: [] };
    try { freshTree = freshRow ? JSON.parse(freshRow.tree_json) : freshTree; } catch { /* corrupt — fall through to empty */ }
    return json(
      { error: 'conflict', detail: 'The family tree changed while merging.', tree: freshTree, treeUpdatedAt: freshRow?.updated_at ?? null },
      { status: 409 },
    );
  }

  await env.DB.prepare(`UPDATE invite SET status = 'accepted' WHERE id = ?`)
    .bind(invite.id).run();

  if (mergedTree.familyName) {
    await env.DB.prepare(`UPDATE family SET name = ? WHERE id = ?`)
      .bind(mergedTree.familyName, invite.family_id).run();
  }

  return json({ ok: true, familyId: invite.family_id });
}

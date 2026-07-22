import { json } from '../_lib/util.js';
import { loadTree, casUpdateTree, insertOnlyTree, resolveTreeFromRaw, splitTree, putExtra } from '../_lib/treeStore.js';

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

  const treeRow = await loadTree(env, invite.family_id);

  // The merge wizard computes its whole preview against this response, so
  // a migrated family's row must be reassembled (core + R2 extra), not read
  // as raw JSON — otherwise the preview (and the merge computed from it)
  // would silently be missing memories/photos/documents/rich person fields.
  // Unlike the "corrupt JSON -> empty" fallback below, a genuinely unreadable
  // extra fails the request outright: a client that merges against an
  // incomplete tree could write that incompleteness right back on submit.
  let tree = { people: [], relationships: [] };
  if (treeRow) {
    try {
      const resolved = await resolveTreeFromRaw(env, invite.family_id, treeRow.raw);
      if (resolved.extraError) {
        console.error('[merge] GET: extra unreadable, failing clean:', resolved.extraError);
        return json({ error: 'Server error', detail: 'Tree data temporarily unavailable — please retry' }, { status: 503 });
      }
      tree = resolved.tree;
    } catch { /* corrupt — return empty */ }
  }

  return json({
    familyId: invite.family_id,
    familyName: invite.family_name,
    role: invite.role,
    fromEmail: invite.from_email,
    tree,
    // Lets the client detect, on submit, whether this family's tree changed
    // while the merge wizard was open — see the check in onRequestPost below.
    treeUpdatedAt: treeRow?.updatedAt ?? null,
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
  const currentTree = await loadTree(env, invite.family_id);
  if (currentTree && currentTree.updatedAt !== baseUpdatedAt) {
    let freshTree = { people: [], relationships: [] };
    try {
      const resolved = await resolveTreeFromRaw(env, invite.family_id, currentTree.raw);
      if (!resolved.extraError) freshTree = resolved.tree;
    } catch { /* corrupt — fall through to empty */ }
    return json(
      { error: 'conflict', detail: 'The family tree changed while merging.', tree: freshTree, treeUpdatedAt: currentTree.updatedAt },
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

  // Whether to write in legacy or migrated (core+R2) mode is a fact read
  // off the CURRENT row, never decided by mergedTree (the client's
  // computed payload) — same rule as every other Phase 2 write path. No
  // currentTree at all means this family's very first save, which always
  // starts legacy (migration is a separate, deliberate step, never
  // automatic here).
  let migratedMode = false;
  if (currentTree?.raw) {
    try { migratedMode = JSON.parse(currentTree.raw)._extraVersion != null; } catch { /* corrupt -> treat as legacy */ }
  }

  let jsonToStore;
  let extraToWrite = null;
  if (migratedMode) {
    const split = splitTree(mergedTree);
    extraToWrite = split.extra;
    jsonToStore = JSON.stringify({ ...split.core, _extraVersion: now });
  } else {
    jsonToStore = JSON.stringify(mergedTree);
  }

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
    // R2-before-D1 (docs/TREE-STORAGE.md §6.3): if this throws, the CAS
    // below never runs and D1 is untouched, exactly like any other failed
    // save. A CAS that then loses the race just leaves a harmless,
    // unreferenced R2 object.
    if (migratedMode) await putExtra(env, invite.family_id, extraToWrite, now);
    persisted = await casUpdateTree(env, invite.family_id, jsonToStore, now, currentTree.updatedAt);
  } else {
    try {
      await insertOnlyTree(env, invite.family_id, jsonToStore, now);
      persisted = { meta: { changes: 1 } };
    } catch {
      // A row appeared between the early check and here (e.g. this family's
      // very first save happened concurrently) — treat as a conflict below.
      persisted = { meta: { changes: 0 } };
    }
  }

  if (!persisted?.meta?.changes) {
    const freshRow = await loadTree(env, invite.family_id);
    let freshTree = { people: [], relationships: [] };
    try {
      if (freshRow) {
        const resolved = await resolveTreeFromRaw(env, invite.family_id, freshRow.raw);
        if (!resolved.extraError) freshTree = resolved.tree;
      }
    } catch { /* corrupt — fall through to empty */ }
    return json(
      { error: 'conflict', detail: 'The family tree changed while merging.', tree: freshTree, treeUpdatedAt: freshRow?.updatedAt ?? null },
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

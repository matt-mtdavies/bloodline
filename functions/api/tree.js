import { json, uid } from '../_lib/util.js';

/*
 * GET /api/tree  — load the authenticated user's family tree.
 * PUT /api/tree  — save the authenticated user's family tree.
 *
 * Trees are scoped to a family (family_tree table). On the first PUT, if the
 * user has no family yet, one is auto-created and they become the owner.
 * When a user is invited, they share the inviting family's tree.
 */

export async function onRequestGet({ env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  try {
    // Use user.family_id as the canonical pointer — handles users who belong to
    // multiple families (e.g. after a tree merge) without returning a random row.
    const userRow = await env.DB.prepare(`SELECT family_id FROM user WHERE id = ?`)
      .bind(data.user.uid).first();

    const membership = userRow?.family_id
      ? await env.DB.prepare(
          `SELECT fm.family_id, fm.role, f.name as family_name
             FROM family_member fm JOIN family f ON f.id = fm.family_id
            WHERE fm.user_id = ? AND fm.family_id = ?`,
        ).bind(data.user.uid, userRow.family_id).first()
      : await env.DB.prepare(
          `SELECT fm.family_id, fm.role, f.name as family_name
             FROM family_member fm JOIN family f ON f.id = fm.family_id
            WHERE fm.user_id = ?`,
        ).bind(data.user.uid).first();

    if (!membership) return json(null); // new user — client shows onboarding

    const row = await env.DB.prepare(
      'SELECT tree_json, updated_at FROM family_tree WHERE family_id = ?',
    ).bind(membership.family_id).first();

    if (!row) return json(null);

    const etag = `"${row.updated_at}"`;
    return json(
      { ...JSON.parse(row.tree_json), _meta: { familyId: membership.family_id, role: membership.role } },
      { headers: { 'cache-control': 'private, no-store', 'ETag': etag } },
    );
  } catch (e) {
    console.error('[tree] GET error:', e.message);
    return json({ error: 'Server error' }, { status: 500 });
  }
}

export async function onRequestPut({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  let tree;
  try {
    tree = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);

  try {
    // Same canonical lookup as GET — use user.family_id to pick the right family.
    const putUserRow = await env.DB.prepare(`SELECT family_id FROM user WHERE id = ?`)
      .bind(data.user.uid).first();

    let membership = putUserRow?.family_id
      ? await env.DB.prepare(
          'SELECT family_id, role FROM family_member WHERE user_id = ? AND family_id = ?',
        ).bind(data.user.uid, putUserRow.family_id).first()
      : await env.DB.prepare(
          'SELECT family_id, role FROM family_member WHERE user_id = ?',
        ).bind(data.user.uid).first();

    if (!membership) {
      // First save — create the family and make this user the owner.
      const familyId = uid('f_');
      const familyName = tree.familyName || 'My Family';
      await env.DB.prepare(
        `INSERT INTO family (id, name, created_by, created_at) VALUES (?, ?, ?, ?)`,
      ).bind(familyId, familyName, data.user.uid, now).run();
      await env.DB.prepare(
        `INSERT INTO family_member (family_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)`,
      ).bind(familyId, data.user.uid, now).run();
      await env.DB.prepare(
        `UPDATE user SET family_id = ? WHERE id = ?`,
      ).bind(familyId, data.user.uid).run();
      membership = { family_id: familyId, role: 'owner' };
    }

    // Write permissions:
    //   • owner / coadmin / editor → may change the whole tree
    //   • contributor               → may add/change memories & photos only
    //   • viewer                    → read-only
    const canEditAll = ['owner', 'coadmin', 'editor'].includes(membership.role);
    const canContribute = membership.role === 'contributor';
    if (!canEditAll && !canContribute) {
      return json({ error: 'Forbidden' }, { status: 403 });
    }

    // Optimistic concurrency: if the client sent If-Match, check it against the
    // current updated_at. Reject with 409 if someone else saved since the client
    // last loaded, so they can merge before overwriting.
    const ifMatch = request.headers.get('If-Match');
    if (ifMatch && ifMatch !== '*') {
      const current = await env.DB.prepare(
        'SELECT updated_at FROM family_tree WHERE family_id = ?',
      ).bind(membership.family_id).first();
      if (current && `"${current.updated_at}"` !== ifMatch) {
        return json({ error: 'Conflict — tree was updated by another editor' }, { status: 409 });
      }
    }

    const existingTree = await env.DB.prepare(
      'SELECT tree_json FROM family_tree WHERE family_id = ?',
    ).bind(membership.family_id).first();
    let prev = null;
    if (existingTree) {
      try { prev = JSON.parse(existingTree.tree_json); } catch { /* unparseable — ignore */ }
    }

    // Contributors can't alter structure: keep the stored tree and accept only
    // their memories & photos (plus deletions of those). Everything else — people,
    // relationships, documents, family name — is preserved from the server copy.
    let toStore = tree;
    if (!canEditAll) {
      const base = prev || {};
      const deletedIn = tree._deleted || {};
      toStore = {
        ...base,
        memories: Array.isArray(tree.memories) ? tree.memories : (base.memories || []),
        photos: Array.isArray(tree.photos) ? tree.photos : (base.photos || []),
        _deleted: {
          ...(base._deleted || {}),
          memories: { ...((base._deleted || {}).memories || {}), ...(deletedIn.memories || {}) },
          photos: { ...((base._deleted || {}).photos || {}), ...(deletedIn.photos || {}) },
        },
        _seq: ((base._seq || 0) + 1), // bump so other clients pick up the change
      };
    }

    // myPersonId is each viewer's OWN perspective (resolved per-user on load),
    // not a shared property. Pin the blob's value to whatever the family already
    // has (set by the owner on first save) so a member's save can't repoint
    // everyone else's seat to themselves.
    if (prev && prev.myPersonId != null) toStore.myPersonId = prev.myPersonId;

    await env.DB.prepare(
      `INSERT INTO family_tree (family_id, tree_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (family_id) DO UPDATE
         SET tree_json = excluded.tree_json,
             updated_at = excluded.updated_at`,
    ).bind(membership.family_id, JSON.stringify(toStore), now).run();

    // Keep family.name in sync so invite emails always show the current name.
    if (canEditAll && toStore.familyName) {
      await env.DB.prepare(`UPDATE family SET name = ? WHERE id = ?`)
        .bind(toStore.familyName, membership.family_id).run();
    }

    return json(
      { ok: true, familyId: membership.family_id, role: membership.role },
      { headers: { 'ETag': `"${now}"` } },
    );
  } catch (e) {
    console.error('[tree] PUT error:', e.message, e.stack);
    return json({ error: 'Server error', detail: e.message }, { status: 500 });
  }
}

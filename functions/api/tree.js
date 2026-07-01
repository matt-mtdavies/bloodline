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

    // Hard-to-undo, whole-tree-shape changes — erasing the tree, a
    // replace-mode import, merging duplicate people, or removing a person
    // outright — all manifest the same way: a person who existed before is
    // missing from the incoming payload. Rather than gating each of those
    // actions individually, reject that shape of change from a plain
    // 'editor' (below co-admin) in one place. This is the actual backstop —
    // hiding the buttons client-side only helps with the UI, not a direct
    // API call or a bug in it.
    if (membership.role === 'editor' && prev?.people?.length) {
      const incomingIds = new Set((tree.people || []).map((p) => p.id));
      const removed = prev.people.filter((p) => !incomingIds.has(p.id));
      if (removed.length > 0) {
        return json({
          error: 'Forbidden',
          detail: 'Only a co-admin or owner can remove people, merge duplicates, replace-import, or erase this tree.',
        }, { status: 403 });
      }
    }

    // Contributors can't alter structure: keep the stored tree and accept only
    // their memories & photos (plus deletions of those). Everything else — people,
    // relationships, documents, family name — is preserved from the server copy.
    let toStore = tree;
    if (!canEditAll) {
      const base = prev || {};
      const deletedIn = tree._deleted || {};
      // A contributor's own activity events (e.g. "added a memory") must be
      // folded in here too, not just dropped — this branch is the only place
      // their save is persisted to tree_json, so if their new events aren't
      // merged into base.activity now, the fast in-app feed never sees them
      // (even though activity_log below durably records them regardless).
      const priorActivityIds = new Set((base.activity || []).map((e) => e?.id).filter(Boolean));
      const newActivity = (Array.isArray(tree.activity) ? tree.activity : [])
        .filter((e) => e?.id && !priorActivityIds.has(e.id));
      toStore = {
        ...base,
        memories: Array.isArray(tree.memories) ? tree.memories : (base.memories || []),
        photos: Array.isArray(tree.photos) ? tree.photos : (base.photos || []),
        activity: [...newActivity, ...(base.activity || [])]
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(0, 100),
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

    // Archive the value we're about to overwrite, so any save — a mistake,
    // a bug, or a legitimate co-admin action like erasing/replacing the
    // tree — can be recovered. Wrapped defensively: this table is new
    // (migration 0009) and applying a migration is a separate manual step
    // from deploying this code, so a not-yet-migrated table must never
    // block the actual save.
    try {
      if (existingTree?.tree_json) {
        await env.DB.prepare(
          `INSERT INTO family_tree_snapshot (id, family_id, tree_json, created_at) VALUES (?, ?, ?, ?)`,
        ).bind(uid('snap_'), membership.family_id, existingTree.tree_json, now).run();
        // Keep only the most recent 30 snapshots per family.
        await env.DB.prepare(
          `DELETE FROM family_tree_snapshot WHERE family_id = ? AND id NOT IN (
             SELECT id FROM family_tree_snapshot WHERE family_id = ? ORDER BY created_at DESC LIMIT 30
           )`,
        ).bind(membership.family_id, membership.family_id).run();
      }
    } catch (e) {
      console.error('[tree] snapshot write skipped:', e.message);
    }

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

    // Durably log any activity events this save introduced. This is separate
    // from tree_json's own `activity` array (which is just a capped, fast
    // local cache the client merges peer-to-peer) — writing straight into
    // D1 here means it's append-only and can never be silently reverted by
    // another device's merge the way the blob's copy can.
    // Wrapped defensively: this table is new (migration 0008) and applying a
    // migration is a separate manual step from deploying this code, so there
    // can be a window where activity_log doesn't exist yet. That must never
    // break the actual tree save.
    try {
      if (Array.isArray(tree.activity) && tree.activity.length) {
        const priorIds = new Set((prev?.activity || []).map((e) => e?.id).filter(Boolean));
        const freshEvents = tree.activity.filter((e) => e?.id && !priorIds.has(e.id));
        for (const e of freshEvents) {
          await env.DB.prepare(
            `INSERT OR IGNORE INTO activity_log
               (id, family_id, author_name, author_email, type, person_id, person_name, detail, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            e.id, membership.family_id, e.authorName || null, e.authorEmail || null,
            e.type || null, e.personId || null, e.personName || null, e.detail || null,
            e.created_at || new Date().toISOString(),
          ).run();
        }
      }
    } catch (e) {
      console.error('[tree] activity_log write skipped:', e.message);
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

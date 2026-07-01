import { json, uid } from '../../../_lib/util.js';

/*
 * POST /api/tree/snapshots/:id  — restore this snapshot as the current tree.
 *
 * Owner/coadmin only (same bar as the other tree-management actions). The
 * current tree is archived as a fresh snapshot first — a restore is just
 * another save, so it must be undoable exactly like any other change; if
 * the wrong snapshot gets picked, restoring again undoes it.
 *
 * Every restored record's updated_at is stamped to "now". Without this, the
 * per-record recency merge (src/data/store.js _mergeByRecency) — which
 * exists specifically so a stale device can't clobber a newer edit — would
 * see the restored (deliberately OLD) data as the stale side and let any
 * device with a more-recently-touched local cache silently overwrite the
 * restore the next time it syncs. Stamping "now" makes the restore
 * unambiguously the newest version of everything, which is the correct
 * intent: this is the true state as of right now.
 */
export async function onRequestPost({ params, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  const snapshotId = params.id;

  try {
    const userRow = await env.DB.prepare(`SELECT family_id FROM user WHERE id = ?`)
      .bind(data.user.uid).first();
    if (!userRow?.family_id) return json({ error: 'Forbidden' }, { status: 403 });

    const membership = await env.DB.prepare(
      `SELECT role FROM family_member WHERE user_id = ? AND family_id = ?`,
    ).bind(data.user.uid, userRow.family_id).first();
    if (!membership || !['owner', 'coadmin'].includes(membership.role)) {
      return json({ error: 'Forbidden' }, { status: 403 });
    }

    const snapshot = await env.DB.prepare(
      `SELECT tree_json FROM family_tree_snapshot WHERE id = ? AND family_id = ?`,
    ).bind(snapshotId, userRow.family_id).first();
    if (!snapshot) return json({ error: 'Snapshot not found' }, { status: 404 });

    let restored;
    try {
      restored = JSON.parse(snapshot.tree_json);
    } catch {
      return json({ error: 'Snapshot is corrupted' }, { status: 500 });
    }

    const now = Math.floor(Date.now() / 1000);
    const current = await env.DB.prepare(
      `SELECT tree_json FROM family_tree WHERE family_id = ?`,
    ).bind(userRow.family_id).first();

    let currentSeq = 0;
    if (current?.tree_json) {
      currentSeq = 0;
      try { currentSeq = JSON.parse(current.tree_json)._seq || 0; } catch { /* ignore */ }

      // Archive what's about to be replaced, same as a normal save would.
      await env.DB.prepare(
        `INSERT INTO family_tree_snapshot (id, family_id, tree_json, created_at) VALUES (?, ?, ?, ?)`,
      ).bind(uid('snap_'), userRow.family_id, current.tree_json, now).run();
      await env.DB.prepare(
        `DELETE FROM family_tree_snapshot WHERE family_id = ? AND id NOT IN (
           SELECT id FROM family_tree_snapshot WHERE family_id = ? ORDER BY created_at DESC LIMIT 30
         )`,
      ).bind(userRow.family_id, userRow.family_id).run();
    }

    const restoredAtMs = Date.now();
    const stamp = (arr) => (Array.isArray(arr) ? arr.map((x) => ({ ...x, updated_at: restoredAtMs })) : arr);
    restored.people = stamp(restored.people);
    restored.relationships = stamp(restored.relationships);
    restored.memories = stamp(restored.memories);
    restored.photos = stamp(restored.photos);
    restored.documents = stamp(restored.documents);
    restored._seq = currentSeq + 1;

    await env.DB.prepare(
      `INSERT INTO family_tree (family_id, tree_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (family_id) DO UPDATE
         SET tree_json = excluded.tree_json,
             updated_at = excluded.updated_at`,
    ).bind(userRow.family_id, JSON.stringify(restored), now).run();

    return json({ ok: true }, { headers: { ETag: `"${now}"` } });
  } catch (e) {
    console.error('[tree/snapshots restore] error:', e.message);
    return json({ error: 'Server error' }, { status: 500 });
  }
}

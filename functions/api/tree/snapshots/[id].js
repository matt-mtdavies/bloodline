import { json } from '../../../_lib/util.js';
import { loadTree, upsertTreeStatement, snapshotStatements } from '../../../_lib/treeStore.js';

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
 *
 * restored.activity is NOT taken from the snapshot — the snapshot's copy is
 * frozen at whatever point it was archived, but activity_log (migration
 * 0008) keeps recording new events the whole time regardless of what the
 * tree looks like. Using the snapshot's stale array here would make the
 * quick "Family Activity" feed silently jump backwards to the snapshot's
 * age, even though nothing else about a restore should touch history that
 * already happened. So it's repopulated from activity_log instead, which
 * stays complete and correct across restores.
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
    const current = await loadTree(env, userRow.family_id);

    let currentSeq = 0;
    if (current?.raw) {
      currentSeq = 0;
      try { currentSeq = JSON.parse(current.raw)._seq || 0; } catch { /* ignore */ }

      // Archive what's about to be replaced, same as a normal save would.
      // Two separate calls (not batched), matching this endpoint's existing
      // behavior exactly — see functions/api/tree.js's PUT for the batched
      // version used there.
      const [insertStmt, pruneStmt] = snapshotStatements(env, userRow.family_id, current.raw, now);
      await insertStmt.run();
      await pruneStmt.run();
    }

    const restoredAtMs = Date.now();
    const stamp = (arr) => (Array.isArray(arr) ? arr.map((x) => ({ ...x, updated_at: restoredAtMs })) : arr);
    restored.people = stamp(restored.people);
    restored.relationships = stamp(restored.relationships);
    restored.memories = stamp(restored.memories);
    restored.photos = stamp(restored.photos);
    restored.documents = stamp(restored.documents);
    restored._seq = currentSeq + 1;

    try {
      const { results: activityRows } = await env.DB.prepare(
        `SELECT * FROM activity_log WHERE family_id = ? ORDER BY created_at DESC LIMIT 100`,
      ).bind(userRow.family_id).all();
      restored.activity = (activityRows || []).map((r) => ({
        id: r.id,
        authorName: r.author_name,
        authorEmail: r.author_email,
        type: r.type,
        personId: r.person_id,
        personName: r.person_name,
        detail: r.detail,
        created_at: r.created_at,
      }));
    } catch (e) {
      console.error('[tree/snapshots restore] activity_log read skipped:', e.message);
    }

    await upsertTreeStatement(env, userRow.family_id, JSON.stringify(restored), now).run();

    return json({ ok: true }, { headers: { ETag: `"${now}"` } });
  } catch (e) {
    console.error('[tree/snapshots restore] error:', e.message);
    return json({ error: 'Server error' }, { status: 500 });
  }
}

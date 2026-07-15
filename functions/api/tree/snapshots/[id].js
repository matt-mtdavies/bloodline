import { json } from '../../../_lib/util.js';
import {
  loadTree, upsertTreeStatement, snapshotStatements,
  resolveTreeFromRaw, splitTree, putExtra,
} from '../../../_lib/treeStore.js';

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

    // A snapshot taken while this family was migrated is itself just the
    // archived core JSON — it carries its own `_extraVersion` for free, so
    // no separate schema column was ever needed to link a snapshot back to
    // its R2 half (docs/TREE-STORAGE.md §9). resolveTreeFromRaw reassembles
    // exactly like a live row's loadFullTree would.
    let resolved;
    try {
      resolved = await resolveTreeFromRaw(env, userRow.family_id, snapshot.tree_json);
    } catch {
      return json({ error: 'Snapshot is corrupted' }, { status: 500 });
    }
    if (resolved.extraError) {
      console.error('[tree/snapshots restore] snapshot extra unreadable, failing clean:', resolved.extraError);
      return json({ error: 'Server error', detail: 'Snapshot data temporarily unavailable — please retry' }, { status: 503 });
    }
    const restored = resolved.tree;

    const now = Math.floor(Date.now() / 1000);
    const current = await loadTree(env, userRow.family_id);

    let currentSeq = 0;
    // Whether to write the restore back in legacy or migrated mode is a
    // fact about what this family currently IS, not about the snapshot
    // being restored — same rule functions/api/tree.js's PUT follows, and
    // for the same reason: this phase's code never migrates a family on
    // its own.
    let migratedMode = false;
    if (current?.raw) {
      try {
        const parsedCurrentCore = JSON.parse(current.raw);
        currentSeq = parsedCurrentCore._seq || 0;
        migratedMode = parsedCurrentCore._extraVersion != null;
      } catch { /* ignore */ }

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

    // R2-before-D1, same ordering rule as tree.js's PUT: if the R2 write
    // throws, nothing below it runs and D1 is never touched.
    let jsonToStore;
    if (migratedMode) {
      const { core, extra } = splitTree(restored);
      await putExtra(env, userRow.family_id, extra, now);
      jsonToStore = JSON.stringify({ ...core, _extraVersion: now });
    } else {
      jsonToStore = JSON.stringify(restored);
    }

    await upsertTreeStatement(env, userRow.family_id, jsonToStore, now).run();

    return json({ ok: true }, { headers: { ETag: `"${now}"` } });
  } catch (e) {
    console.error('[tree/snapshots restore] error:', e.message);
    return json({ error: 'Server error' }, { status: 500 });
  }
}

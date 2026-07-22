import { json, sendEmail } from '../_lib/util.js';
import { createFamily } from '../_lib/family.js';
import { loadTree, loadFullTree, upsertTreeStatement, snapshotStatements, splitTree, putExtra } from '../_lib/treeStore.js';

/*
 * GET /api/tree  — load the authenticated user's family tree.
 * PUT /api/tree  — save the authenticated user's family tree.
 *
 * Trees are scoped to a family (family_tree table). On the first PUT, if the
 * user has no family yet, one is auto-created and they become the owner.
 * When a user is invited, they share the inviting family's tree.
 */

// D1 caps a single row at 1 MiB, and the whole tree — every person, memory,
// document summary, activity entry — lives in ONE row's tree_json column.
// That's not something a paid plan raises; it's the actual ceiling on how
// much one family can store. Warn well before it (SIZE_WARN_BYTES, a
// non-blocking heads-up on an otherwise-successful save) and refuse cleanly
// once truly at risk (SIZE_HARD_STOP_BYTES, left with real headroom below
// the actual 1 MiB limit) — a save rejected with a clear reason beats one
// that dies with an opaque D1 error, and either way nothing is touched
// until this check passes.
const D1_ROW_LIMIT_BYTES = 1_048_576;
const SIZE_WARN_BYTES = 800_000;
const SIZE_HARD_STOP_BYTES = 990_000;

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

    const loaded = await loadFullTree(env, membership.family_id);

    if (!loaded) return json(null);

    // docs/TREE-STORAGE.md §6.3: a migrated family's extra genuinely
    // unreadable (R2 hiccup, or D1 naming a version R2 doesn't have) must
    // fail the request rather than quietly serve a tree that's missing its
    // memories/photos/documents — that risk isn't in GET itself, it's that
    // this same object would round-trip back out on the client's next PUT.
    if (loaded.extraError) {
      console.error('[tree] GET: extra unreadable, failing clean:', loaded.extraError);
      return json({ error: 'Server error', detail: 'Tree data temporarily unavailable — please retry' }, { status: 503 });
    }

    const parsed = loaded.tree;

    // Self-heal the fast in-app activity feed on every read: tree_json.activity
    // is just a capped cache, and any code path that fails to keep it in sync
    // (e.g. the contributor write path used to silently drop new events)
    // would otherwise freeze the feed indefinitely. activity_log is the
    // durable, always-correct source, so fold its latest rows in here rather
    // than trusting whatever's frozen in the blob. Wrapped defensively since
    // activity_log (migration 0008) may not exist yet in every environment.
    try {
      const { results: logRows } = await env.DB.prepare(
        `SELECT * FROM activity_log WHERE family_id = ? ORDER BY created_at DESC LIMIT 100`,
      ).bind(membership.family_id).all();
      const fromLog = (logRows || []).map((r) => ({
        id: r.id,
        authorName: r.author_name,
        authorEmail: r.author_email,
        type: r.type,
        personId: r.person_id,
        personName: r.person_name,
        detail: r.detail,
        created_at: r.created_at,
      }));
      const knownIds = new Set(fromLog.map((e) => e.id));
      const extra = (parsed.activity || []).filter((e) => e?.id && !knownIds.has(e.id));
      parsed.activity = [...fromLog, ...extra]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 100);
    } catch (e) {
      console.error('[tree] GET activity_log merge skipped:', e.message);
    }

    // tree_json.familyName is what the client actually displays and lets the
    // owner rename via Settings — but it's a separate field from family.name
    // (set once at family creation, e.g. from an invite/signup default) that
    // never gets backfilled. A family that never explicitly renamed via
    // Settings has an empty tree_json.familyName forever, which falls back
    // client-side to the focused person's first name — confusing, and not
    // even the same string as the perfectly good name already sitting in
    // family.name. Prefer the real family.name over that empty string here.
    const familyName = parsed.familyName || membership.family_name || '';

    const etag = `"${loaded.updatedAt}"`;
    return json(
      { ...parsed, familyName, _meta: { familyId: membership.family_id, role: membership.role } },
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
      const created = await createFamily(env, data.user.uid, tree.familyName);
      membership = { family_id: created.family_id, role: created.role };
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

    // The optimistic-concurrency check and "what's there now" (used below for
    // the snapshot, the contributor merge base, and the editor-can't-remove
    // guard) read the exact same row — one SELECT for both instead of two
    // saves a full D1 round trip on every single save, which matters most on
    // a large tree over a slow connection (the most common way a save ends
    // up racing whatever timeout produces a 503). loadFullTree also
    // transparently reassembles a migrated family's R2 extra back onto core,
    // so `prev` below is always the FULL logical tree regardless of storage
    // mode — every existing business rule below (editor guard, contributor
    // merge base, myPersonId pinning) needs the complete tree, not just core.
    let existingFull;
    try {
      existingFull = await loadFullTree(env, membership.family_id);
    } catch (e) {
      // Corrupt core JSON on an already-stored row — same fallback as
      // before this refactor: don't let a damaged row wedge every future
      // save, but still keep the raw string/timestamp (needed below for
      // prevBytes and snapshot archival) rather than losing them too.
      console.warn('[tree] PUT: existing tree_json unparseable, treating as absent:', e.message);
      const rawRow = await loadTree(env, membership.family_id).catch(() => null);
      existingFull = rawRow
        ? { tree: null, raw: rawRow.raw, updatedAt: rawRow.updatedAt, migrated: false, extraError: null }
        : null;
    }

    // A migrated family's extra genuinely unreadable must fail the save
    // outright, not proceed on a `prev` that's silently missing memories/
    // photos/documents — see loadFullTree's own comment for why that risk
    // is worse on a write than a read (a merge below could persist that
    // emptiness right back over the family's real R2 data).
    if (existingFull?.extraError) {
      console.error('[tree] PUT: existing extra unreadable, failing clean:', existingFull.extraError);
      return json({ error: 'Server error', detail: 'Tree data temporarily unavailable — please retry' }, { status: 503 });
    }

    // Optimistic concurrency: if the client sent If-Match, check it against the
    // current updated_at. Reject with 409 if someone else saved since the client
    // last loaded, so they can merge before overwriting.
    const ifMatch = request.headers.get('If-Match');
    if (ifMatch && ifMatch !== '*' && existingFull && `"${existingFull.updatedAt}"` !== ifMatch) {
      return json({ error: 'Conflict — tree was updated by another editor' }, { status: 409 });
    }

    const prev = existingFull?.tree ?? null;

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

    // Whether to write in legacy (whole tree in one D1 row, exactly as
    // before this phase) or migrated (core in D1 + extra in R2) mode is a
    // fact about THIS family, decided once by a prior, separate migration
    // step — never here. A brand-new family (existingFull is null) or one
    // that's never been migrated writes in legacy mode, unchanged.
    const migratedMode = !!existingFull?.migrated;

    // Measure what's actually about to be written, in bytes (not UTF-16 code
    // units — the D1 limit is byte-based, and this data isn't all ASCII).
    // Computed once here and reused for the actual write below. prevBytes
    // (the row we're about to overwrite) lets the warning fire only on the
    // save that newly CROSSES the threshold, not on every save afterward.
    // In migrated mode this measures CORE alone — the whole point of the
    // split — so `jsonToStore` (not `toStore`) is what's actually compared
    // against the D1 ceiling and what's written to the row below.
    let jsonToStore;
    let extraToWrite = null;
    if (migratedMode) {
      const split = splitTree(toStore);
      extraToWrite = split.extra;
      jsonToStore = JSON.stringify({ ...split.core, _extraVersion: now });
    } else {
      jsonToStore = JSON.stringify(toStore);
    }
    const treeJsonBytes = new TextEncoder().encode(jsonToStore).length;
    const prevBytes = existingFull?.raw
      ? new TextEncoder().encode(existingFull.raw).length
      : 0;
    if (treeJsonBytes > SIZE_HARD_STOP_BYTES) {
      const mb = (n) => (n / (1024 * 1024)).toFixed(2);
      return json({
        error: 'Tree too large to save',
        detail: `This family tree (${mb(treeJsonBytes)} MB) is at the database's 1 MB per-family storage limit. Nothing has been lost — this save was rejected before touching anything. Removing some older documents or memories will free up room.`,
        bytes: treeJsonBytes,
        limitBytes: D1_ROW_LIMIT_BYTES,
      }, { status: 413 });
    }

    // Archive the value we're about to overwrite, so any save — a mistake,
    // a bug, or a legitimate co-admin action like erasing/replacing the
    // tree — can be recovered. Wrapped defensively: this table is new
    // (migration 0009) and applying a migration is a separate manual step
    // from deploying this code, so a not-yet-migrated table must never
    // block the actual save. The insert and its cleanup are batched into one
    // round trip via D1's batch() — still just as defensive: batch() aborts
    // the whole group on the first failure, exactly like the sequential
    // calls did before (the insert already threw before the cleanup could
    // ever run), so a missing table skips both the same way it always did.
    // snapshotIssue distinguishes an expected, harmless case (the table
    // hasn't been migrated in this environment yet) from a genuine failure —
    // most plausibly this exact row being too large for D1 to also store a
    // full copy of alongside the live one (docs/TREE-STORAGE.md §4: this
    // safety net shares the live tree's 1MB-per-row ceiling). A genuine
    // failure is surfaced in the size-warning email below rather than left
    // as a console.error nobody is looking at — the whole point of a
    // backup is that it's there when someone needs it, so silently having
    // none is worth a human learning about it.
    let snapshotIssue = null;
    try {
      const snap = snapshotStatements(env, membership.family_id, existingFull?.raw, now);
      if (snap) await env.DB.batch(snap);
    } catch (e) {
      if (/no such table/i.test(e.message || '')) {
        console.warn('[tree] snapshot skipped — family_tree_snapshot not migrated yet:', e.message);
      } else {
        snapshotIssue = e.message || 'unknown error';
        console.error('[tree] CRITICAL: snapshot backup failed — this save has no rollback point:', snapshotIssue);
      }
    }

    // In migrated mode, extra goes to R2 BEFORE D1 is touched at all
    // (docs/TREE-STORAGE.md §6.3): D1's write below is the single commit
    // point for this save, so a failed R2 write here throws straight to the
    // outer catch with nothing written anywhere, exactly like any other
    // failed save today. A failed D1 write after this succeeds just leaves
    // a harmless, unreferenced R2 object — nothing ever names a version D1
    // didn't itself just write.
    if (migratedMode) {
      await putExtra(env, membership.family_id, extraToWrite, now);
    }

    // The actual save and the family-name sync are batched into one round
    // trip — neither was ever defensively wrapped (a failure here is a real
    // error, same as before), so this is a pure latency win, plus a small
    // correctness improvement: batch() runs both in one transaction, so a
    // failed name update can no longer leave the tree_json write committed
    // on its own while the client is told the whole save failed.
    const writeStatements = [
      upsertTreeStatement(env, membership.family_id, jsonToStore, now),
    ];
    // Keep family.name in sync so invite emails always show the current name.
    if (canEditAll && toStore.familyName) {
      writeStatements.push(
        env.DB.prepare(`UPDATE family SET name = ? WHERE id = ?`)
          .bind(toStore.familyName, membership.family_id),
      );
    }
    await env.DB.batch(writeStatements);

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
        // One batched round trip for every new event in this save, rather
        // than one round trip per event — a save introducing several events
        // at once (a bulk import, a merge) used to pay for each one
        // separately, and sequentially at that.
        if (freshEvents.length) {
          await env.DB.batch(freshEvents.map((e) =>
            env.DB.prepare(
              `INSERT OR IGNORE INTO activity_log
                 (id, family_id, author_name, author_email, type, person_id, person_name, detail, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).bind(
              e.id, membership.family_id, e.authorName || null, e.authorEmail || null,
              e.type || null, e.personId || null, e.personName || null, e.detail || null,
              e.created_at || new Date().toISOString(),
            ),
          ));
        }
      }
    } catch (e) {
      console.error('[tree] activity_log write skipped:', e.message);
    }

    // This is an admin-actionable warning (only an owner/coadmin can decide
    // to prune content or otherwise deal with storage), so:
    //   • the on-screen toast is only handed back when the SAVING member is
    //     themselves owner/coadmin — anyone else's save can still be the one
    //     that crosses the line, so this alone won't reach every admin;
    //   • the moment a save newly crosses the threshold (prevBytes didn't,
    //     this one does), email every owner/coadmin directly — regardless of
    //     who made the save that tipped it over.
    // A snapshot failure observed on THIS save (see above) rides along in
    // the same email rather than getting its own — both share one root
    // cause (the tree is too large) and one already-deduped trigger, so a
    // second notification path would just be a second way to spam the
    // same admins for the same reason.
    const isAdmin = ['owner', 'coadmin'].includes(membership.role);
    if (prevBytes <= SIZE_WARN_BYTES && treeJsonBytes > SIZE_WARN_BYTES) {
      try {
        const familyName = toStore.familyName || 'your family tree';
        const mb = (n) => (n / (1024 * 1024)).toFixed(2);
        const vars = { familyName, usedMb: mb(treeJsonBytes), limitMb: mb(D1_ROW_LIMIT_BYTES), snapshotIssue };
        await emailAdmins(env, membership.family_id, {
          subject: `${familyName} is approaching its storage limit on Bloodline`,
          html: sizeWarningEmail(vars),
          text: sizeWarningEmailText(vars),
          tag: 'tree-size-warning',
        });
      } catch (e) {
        // Best-effort — the save above already succeeded either way.
        console.error('[tree] size-warning email skipped:', e.message);
      }
    }

    return json(
      {
        ok: true,
        familyId: membership.family_id,
        role: membership.role,
        // Non-blocking heads-up — the save above succeeded either way.
        ...(isAdmin && treeJsonBytes > SIZE_WARN_BYTES
          ? { sizeWarning: { bytes: treeJsonBytes, limitBytes: D1_ROW_LIMIT_BYTES } }
          : {}),
      },
      { headers: { 'ETag': `"${now}"` } },
    );
  } catch (e) {
    console.error('[tree] PUT error:', e.message, e.stack);
    return json({ error: 'Server error', detail: e.message }, { status: 500 });
  }
}

// Every owner/coadmin of a family, one email each — shared by every admin
// notification this endpoint sends (storage warnings, backup failures).
async function emailAdmins(env, familyId, { subject, html, text, tag }) {
  const admins = await env.DB.prepare(
    `SELECT u.email FROM family_member fm JOIN user u ON u.id = fm.user_id
      WHERE fm.family_id = ? AND fm.role IN ('owner', 'coadmin')`,
  ).bind(familyId).all();
  for (const { email } of admins.results || []) {
    if (!email) continue;
    await sendEmail(env, { to: email, subject, html, text, tag });
  }
}

function sizeWarningEmailText({ familyName, usedMb, limitMb, snapshotIssue }) {
  return [
    `${familyName} is approaching its storage limit on Bloodline`,
    '',
    `This family tree is now using ${usedMb} MB of its ${limitMb} MB storage limit.`,
    '',
    'Removing some older documents or memories will free up room. You\'re receiving this because you\'re an owner or co-admin of this tree.',
    ...(snapshotIssue ? ['', 'One more thing: the automatic backup taken before this save did not succeed, so this particular change has no rollback point yet. Freeing up room will also restore that protection.'] : []),
    '',
    'Open Bloodline: https://myfamilybloodline.com',
  ].join('\n');
}

function sizeWarningEmail({ familyName, usedMb, limitMb, snapshotIssue }) {
  const appUrl = 'https://myfamilybloodline.com';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${familyName} is approaching its storage limit</title>
</head>
<body style="margin:0;padding:0;background:#f5f0ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:520px;margin:0 auto;padding:48px 24px 64px;">

  <div style="text-align:center;margin-bottom:36px;">
    <div style="font-size:24px;font-weight:700;color:#c2603a;letter-spacing:-0.02em;">Bloodline</div>
    <div style="margin-top:4px;font-size:13px;color:#a09590;letter-spacing:0.08em;text-transform:uppercase;">Your family, preserved forever</div>
  </div>

  <div style="background:#ffffff;border-radius:24px;padding:44px 40px;box-shadow:0 4px 32px rgba(0,0,0,0.07);">
    <p style="margin:0 0 6px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#a09590;">Storage notice</p>
    <h1 style="margin:0 0 8px;font-size:26px;font-weight:700;color:#241f1c;line-height:1.25;">${familyName} is approaching its storage limit</h1>
    <p style="margin:0 0 28px;font-size:15px;color:#6b6260;line-height:1.5;">
      This family tree is now using <strong style="color:#241f1c;">${usedMb} MB</strong> of its
      <strong style="color:#241f1c;">${limitMb} MB</strong> storage limit. Removing some older
      documents or memories will free up room.
    </p>
    ${snapshotIssue ? `<p style="margin:0 0 28px;font-size:14px;color:#a44d2c;line-height:1.5;background:#fdf1ea;border-radius:12px;padding:14px 18px;">
      One more thing: the automatic backup taken before this save did not succeed, so this
      particular change has no rollback point yet. Freeing up room will also restore that
      protection.
    </p>` : ''}

    <a href="${appUrl}"
       style="display:block;text-align:center;background:#c2603a;color:#ffffff;font-size:17px;font-weight:600;padding:18px 24px;border-radius:14px;text-decoration:none;letter-spacing:0.01em;box-shadow:0 4px 20px rgba(194,96,58,0.3);">
      Open Bloodline &rarr;
    </a>

    <p style="margin:16px 0 0;text-align:center;font-size:13px;color:#b0a9a5;">
      You're receiving this because you're an owner or co-admin of this tree.
    </p>
  </div>

</div>
</body>
</html>`;
}

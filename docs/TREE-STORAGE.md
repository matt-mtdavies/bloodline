# The tree_json blob split — scoping

Status: **scoping only — nothing in this document has been implemented.**
Written in response to a real, live warning: this account's tree (562
people) is already past the 800KB soft-warn threshold against D1's 1MB
per-row hard cap. This is a critical, hard-to-reverse-if-botched piece of
infrastructure — a family's entire tree lives in it — so this document is
long and paranoid on purpose. Read section 6 (backup & rollback) before
anything else if you're skimming.

## 0. The one sentence that matters

**The client's contract never changes.** One `GET /api/tree` returns the
whole logical tree; one `PUT /api/tree` sends the whole logical tree back.
Every risk in this project is confined to *where those bytes physically
live on the server* — not to the shape the app already depends on. This
single constraint is what makes the rest of this plan tractable and
low-risk, and it should not be relaxed without a separate, explicit
decision (see §8, non-goals).

Why that constraint is non-negotiable rather than just convenient:
`src/data/graph.js#buildGraph` synchronously builds adjacency maps —
parents, children, partners, and *derived* siblings — from the full
`people[]` and `relationships[]` arrays, in memory, every time the app
loads. The camera-fit framing, the generation bands, the whole "the tree
is navigation" thesis in CLAUDE.md depends on having the complete graph
before it can draw a single bubble. Lazy-loading or paginating the tree
itself would be a fundamentally different, much larger rewrite than what's
needed to fix a size ceiling — see §8.

## 1. What's actually in the blob today (verified, not assumed)

One row, `family_tree.tree_json` (migration `0003_sharing.sql`), one
column, holds the entire client store shape (`src/data/store.js` `EMPTY`):

```
{ people, relationships, memories, photos, documents, activity,
  hasCompletedOnboarding, familyName, myPersonId, _seq, _deleted }
```

Walking through what's actually likely driving the size, in descending
order of suspicion:

- **`documents[].thumb`** — a permanent inline base64 JPEG data URL (a
  "page-1 preview" for PDFs), generated once at upload and **never**
  migrated to R2. This is the one glaring inconsistency: `documents[].src`
  and every photo's `src`/`photo` field *do* get moved to R2 short URLs by
  `migrateDocsToR2`/`migratePhotosToR2` — but `thumb` was never given the
  same treatment. Given this account's heavy use of the Documents feature
  (military records, letters, certificates), this is the prime suspect for
  real bloat and is the single highest-value, lowest-risk fix available —
  see Phase 0.
- **`documents[].extracted`** — structured AI extraction per document:
  a summary string, a `facts[]` array (each with a `year`/`title`/`detail`
  and a verbatim `quote` — quotes can be long), up to 7 `profile_fields`
  (each `{value, quote}`), `medals[]`, `peopleMentioned[]`. This is
  genuinely rich, permanently-stored data, not ephemeral — real content,
  not waste, but a meaningful per-document cost.
- **`memories[]`** — free-text family memories, unbounded length per entry.
- **`people[]`** — bio, tags, life events, military fields, marriage
  metadata. Likely moderate per-record; could dominate if bios/events are
  long, but each record is otherwise fairly compact.
- **`photos[]`** metadata (captions/dates/R2 URLs) — already small per
  item since binaries live in R2.
- **`activity[]`** — capped at 100 entries (`tree.js` `.slice(0, 100)`),
  bounded, not a growth risk.
- **`_deleted` tombstones** — `{ [kind]: { [id]: timestamp } }`, small per
  entry (~40–60 bytes) but **never pruned**. Grows forever across years of
  edits. Not the dominant contributor today, but a genuine unbounded-growth
  item worth fixing eventually (out of scope for v1 — see §8).
- **`photo_thumb`** (per-person) — turned out *not* to be a standing
  concern: it's an upload-in-flight preview, explicitly cleared to `null`
  once R2 upload confirms (`App.jsx:2368`, `store.js:1668`). Only a residual
  concern for accounts where a past upload silently failed to migrate.

**Before choosing exact split boundaries, measure this account's actual
breakdown** rather than trusting the above ordering — see Phase 0.

## 2. A finding that raises the stakes: the safety net is already fraying

`family_tree_snapshot` (migration `0009`, comment: *"the root cause behind
an unrecoverable edit reported earlier: a stale device's merge silently
reverted someone else's work, and the old value was simply gone"*) already
gives every family a real undo — the full previous `tree_json` is archived
before every save, 30 kept, restorable today via
`/api/tree/snapshots` → `/api/tree/snapshots/:id`.

But that snapshot row is subject to **the exact same 1MB D1 per-row cap**
as the live tree. The insert is wrapped in a defensive try/catch (so a
failure there can never block the actual save) — which also means it can
**silently stop protecting history for exactly the accounts large enough
to need it most**, with nothing surfaced anywhere. This should be verified
and fixed (at minimum: logged/alerted, not silent) regardless of anything
else in this document, and reinforces why this project matters now rather
than "eventually."

## 3. Every place that touches `family_tree` today (the full blast radius)

Nine call sites, found by grepping the whole `functions/` tree — every one
of these has to keep working, unmodified in behavior, through this project:

| File | Reads/writes | Why it matters here |
|---|---|---|
| `functions/api/tree.js` | GET + PUT | The main path. Role checks (owner/coadmin/editor/contributor/viewer), contributor merge-in-place, editor can't-remove-people guard, size warn/hard-stop, auto-snapshot, `activity_log` write, ETag/`If-Match` concurrency. The most complex, must-not-regress logic lives here. |
| `functions/api/merge.js` | GET + POST | Duplicate-family merge wizard. Reads/writes the **full** tree directly with its **own** compare-and-swap on `updated_at` — a separate concurrency mechanism from tree.js's ETag, same underlying column. Easy to forget; must be updated in lockstep. |
| `functions/_lib/invite.js` | read + write | Reads `people` to decide whether an invitee's *other* family has real data (gates the merge wizard); appends one `member_joined` activity event directly into `tree_json` on a successful join. |
| `functions/api/calendar/[token].js`, `functions/api/calendar-token.js` | read only | Read `tree_json.people` only, for the ICS calendar feed. Since `people` stays in "core" either way, these need only a light audit, not a rewrite. |
| `functions/api/tree/snapshots.js`, `functions/api/tree/snapshots/[id].js` | read + write (snapshot table) | List/restore. The restore path **writes the full tree back** — if snapshots ever capture only part of the split tree, a restore would silently drop the rest. Single easiest place to get this wrong. |
| `functions/api/debug/tree.js` | read only | Diagnostic (`tree_size_bytes`). Should become the vehicle for Phase 0's size breakdown and stay the ongoing monitoring instrument afterward. |
| `functions/api/admin/stats.js` | read only (aggregate) | Cross-family admin dashboard, using raw SQL JSON path expressions (`json_array_length(tree_json, '$.photos')` etc.) directly against the column. Will need rework or an explicit temporary caveat once data moves out of that column. Not user-facing, not urgent, but must not be silently forgotten. |

Rather than touch all nine independently (nine chances to introduce a
subtle inconsistency), the plan below extracts one shared module first
and funnels every caller through it — see Phase 1. This also matches this
codebase's own established habit (`docs` show prior work explicitly
extracting shared helpers for family-creation and the tree PUT path) —
not a new pattern for this project, an existing one applied here.

## 4. Recommended target shape

**Core** (stays in `family_tree.tree_json`, same table/column, always
loaded on every session because `buildGraph` needs it):
`people`, `relationships`, `myPersonId`, `familyName`,
`hasCompletedOnboarding`, `_seq`, `_deleted.people`, `_deleted.relationships`,
and **one** authoritative version/`updated_at` that every write bumps, no
matter which physical shard actually changed.

**Extra** (moves to a new home — phased, see below):
`memories`, `photos`, `documents` (with `thumb` moved to R2 first — Phase
0), `activity`, `_deleted.memories`, `_deleted.photos`, `_deleted.documents`.

Why this split and not some other: core is precisely what the
visualization needs unconditionally; extra is only ever touched when a
specific person's memories/photos/documents/activity feed is actually
opened in the UI — the same instinct that already sent Keepsake editions
and photo/document binaries to R2 instead of the D1 row.

One correctness note that falls out of this split for free: the
`contributor` role in `tree.js` is *already* restricted to writing only
`memories`/`photos`/`activity`/their tombstones — under this split, a
contributor's save touches only the "extra" store and never needs to
rewrite `people`/`relationships` at all. A nice incidental efficiency win,
and a good sign the split boundary matches how the app already thinks
about permissions.

## 5. Phased plan — each phase independently shippable and independently revertible

### Phase 0 — Measure, and take the free win (low risk, ships first)

- Extend `/api/debug/tree` with a byte breakdown per top-level key
  (`people`/`relationships`/`memories`/`photos`/`documents`/`activity`/
  `_deleted`), so the split boundaries below are chosen from this
  account's real numbers, not the suspicion-ordering in §1.
- Move `documents[].thumb` to R2, exactly the way `migratePhotosToR2` /
  `migrateDocsToR2` already move `src` — same upload endpoint, same
  best-effort/opportunistic pattern, fully backward compatible (an
  unmigrated inline thumb keeps rendering exactly as it does today until
  it's replaced).
- Verify (and fix) the silent snapshot-write-can-fail-near-the-cap issue
  from §2 — at minimum, log it so it's never silently invisible again.

**Acceptance:** no schema change, no client change, nothing new to back up
(still one row). Rollback = revert the deploy; no data was ever touched
differently than before.

### Phase 1 — Extract `functions/_lib/treeStore.js` (pure refactor, zero behavior change)

- One module: `loadTree(env, familyId)` → the full logical tree object
  (identical shape to today), `saveTree(env, familyId, tree, {
  expectedVersion })` → writes it back with the same CAS semantics
  `tree.js` and `merge.js` each currently hand-roll separately, plus a
  `snapshotBeforeWrite(...)` helper.
- Every one of the nine touch points in §3 is rewritten to call this
  module instead of its own SQL. The module's behavior is defined to be
  **byte-for-byte identical** to today — same single `family_tree.tree_json`
  column, same shape, nothing new stored anywhere. Only *where the SQL
  lives* changes.
- This is the derisking step. Once it's landed, regression-tested, and
  has baked in production for a period, the actual split in Phase 2
  becomes an internal change to one file's guts — not a simultaneous
  nine-file change with nine chances to disagree with each other.

**Acceptance:** full existing test suite green with no behavior
differences; new fake-D1 tests covering `merge.js`'s CAS path and
`invite.js`'s activity-append path through the new module (mirroring the
existing `tests/tree-save.test.mjs` fake-D1 pattern for `tree.js`); no
migration, nothing to back up beyond what already exists.

### Phase 2 — The actual split (the real fix — the most careful phase)

- Add `family_tree_extra` (`family_id` PK, `extra_json TEXT`,
  `updated_at`) — a second D1 row per family. This alone roughly doubles
  total effective capacity (~2MB spread across two rows) with **zero**
  client-visible change.
- `treeStore.js#loadTree` reassembles core + extra into the one object
  every caller already expects; `#saveTree` splits it back apart, writing
  both rows, but keeps a **single** authoritative version number (stored
  in core) so ETag/`If-Match` conflict detection is unchanged from the
  client's perspective no matter how many physical rows back it.
- **Dual-read compatibility, always:** a family with no `family_tree_extra`
  row yet is simply treated as "everything is still in core" (today's
  shape, unchanged). Nothing is forced. A family can be skipped or fail its
  migration and keep working exactly as it does today, forever if needed.
- **The migration script** (one-time, per-family, idempotent, resumable —
  not tied to any deploy):
  1. Snapshot first — both the existing per-save mechanism and, before
     touching *any* row for the whole run, a full `wrangler d1 export
     bloodline --remote` as the nuclear whole-database rollback (see §6).
  2. Split the row into core/extra.
  3. **Never commit** unless a verification pass proves the reassembled
     (core + extra) content is deep-equal to the original `tree_json` for
     that family. On any mismatch: abort, leave that family's row
     completely untouched, log it for manual review. A failed migration
     is a no-op, never a data-loss event, by construction.
- **Rollout order:** ship the dual-mode code first, verified in production
  reading *only* pre-migration data for a bake-in period (this is a no-op
  from every user's perspective) → migrate one disposable test family →
  migrate **this account specifically**, deliberately, with a snapshot in
  hand and someone watching, since it's the one actually at risk today →
  migrate everyone else in small batches, watching error rates between
  batches.
- **Must-fix side effects bundled into this phase** (the easiest places to
  get subtly wrong):
  - `family_tree_snapshot` must snapshot the **full reassembled** tree
    (core + extra), never a partial shard — or a restore would silently
    lose memories/photos/documents/activity. This is the single most
    important correctness trap in the whole project.
  - `admin/stats.js`'s raw SQL against `tree_json` needs the same
    reassembly, or an explicit, temporary "counts only reflect core"
    caveat while the rollout is in progress.

**Acceptance:**
- Round-trip unit tests — `reassemble(split(x))` deep-equals `x` — across
  a wide battery of fixtures: empty tree, a large synthetic tree, a tree
  missing fields that didn't exist in older schema versions, a
  deliberately corrupt/partial tree.
- Fake-D1 (and fake-extra-row) tests for all nine touch points in dual
  mode, extending the existing `tests/tree-save.test.mjs` pattern.
- A full Playwright pass against a migrated *test* family: add a memory,
  upload a photo, upload a document, edit a person field, open Documents /
  Keepsake / Memories / the Activity feed, run the merge-wizard preview —
  everything must behave identically to an unmigrated family.
- A manual, byte-for-byte comparison of this account's real tree against a
  `wrangler d1 export` copy, reassembled locally, **before** this
  account's migration step is ever run against production.

### Phase 3 — optional, later: move "extra" to R2 instead of a second D1 row

Only pursued if Phase 2's doubled ceiling stops being enough as the tree
keeps growing. Follows the exact precedent already proven and shipped by
Keepsake editions (`functions/api/keepsake.js` — same `DOCS` R2 bucket,
same hash/pointer-plus-latest-object pattern). Deliberately **not**
bundled into this rewrite: it introduces network calls into the hot
GET/PUT path and no cross-store atomicity between D1 and R2 — real added
risk that should only be taken on once Phase 2's simpler doubling is
proven insufficient, not preemptively.

## 6. Backup & rollback, concretely, at every layer

1. **Already exists, today:** `family_tree_snapshot` — automatic, every
   save, 30 kept per family, restorable right now via
   `/api/tree/snapshots`. Must be fixed (§2) to never silently fail near
   the size cap, and (§5, Phase 2) to always snapshot the full reassembled
   tree once the split lands.
2. **New, one-time:** a full `wrangler d1 export bloodline --remote`
   backup taken immediately before Phase 2's migration script runs against
   *any* row — the nuclear, whole-database rollback option, kept for a
   deliberate retention window (suggest 90 days) after the migration is
   proven stable.
3. **Structural, by construction:** the migration script never commits a
   family's split unless verification proves no data was lost. A failure
   mode here is always "this family is untouched, try again later," never
   "this family lost data."
4. **Every phase is its own revertible deploy.** Phases 0 and 1 touch no
   schema at all — a bad deploy is a plain code revert, no data was ever
   written differently. Phase 2's dual-read design means even a bad Phase-2
   deploy can be rolled back (redeploy the prior version) before it has
   migrated a single family, because migration is a separate, deliberately
   un-automatic step from the deploy itself.

## 7. Testing strategy summary

- Pure-function round-trip tests for split/reassemble (Phase 2) across
  edge-case fixtures, run in isolation from any D1/R2 binding.
- Fake-D1 unit tests (extending the existing `tests/tree-save.test.mjs`
  pattern already used for `tree.js`) for every one of the nine touch
  points, in both legacy (unmigrated) and split (migrated) modes.
- A full regression pass (`node --test tests/*.test.mjs`, `npm run build`,
  `tests/smoke.mjs`) after every phase, same bar as every other change in
  this codebase.
- A Playwright "day in the life" pass on a migrated test family before
  Phase 2 ever touches a real account.
- Manual byte-for-byte verification against a real `wrangler d1 export`
  copy of this account specifically, before this account is migrated.

## 8. Explicitly out of scope for this rewrite (non-goals)

- **No client-side lazy-loading or pagination of the tree.** `buildGraph`
  needs the complete `people`/`relationships` graph in memory, always —
  changing that is a fundamentally different, much larger project than
  fixing a storage ceiling, and isn't needed to solve the problem at hand.
- **No revival of the normalized `person`/`relationship` SQL tables** from
  migration `0001_init.sql`. They exist in the schema but are confirmed
  unused for live tree data today (only `person.claimed_by_user_id`/a stub
  insert in `user/profile.js` touches `person`, and nothing touches
  `relationship`). Reviving true relational storage for the whole tree
  would be a far larger and riskier rewrite than this project — not
  warranted just to raise a size ceiling.
- **No forced or blocking migration.** Every family not yet migrated keeps
  working exactly as today, indefinitely if necessary. Migration is always
  additive, always resumable, always safe to skip.
- **No deletion of old snapshots or pre-migration data** during or shortly
  after the transition.
- **Pruning `_deleted` tombstones** (§1) is a real, separate, unbounded-
  growth item — deliberately deferred rather than bundled in here, since
  safely pruning requires confidence every client has synced past the
  prune point first (a different, smaller piece of work, best done on its
  own).

## 9. Suggested order of work, if/when you say go

1. **Phase 0** — measure + the documents-thumb-to-R2 quick win. Days, not
   weeks. Ships independently and immediately starts reducing bytes.
2. **Phase 1** — extract `treeStore.js` as a pure refactor. A few days,
   full regression coverage, zero schema change.
3. **Phase 2** — the actual split, migration script, and the staged
   rollout above — the real project, done deliberately, with this
   account migrated on purpose rather than swept in with everyone else.
4. **Phase 3** — only if and when Phase 2's doubled headroom stops being
   enough.

# The tree_json blob split — architecture & plan

Status: **planning only — nothing in this document has been implemented.**
Written in response to a real, live warning: this account's tree (562
people) is already past the 800KB soft-warn threshold against D1's 1MB
per-row hard cap, and the explicit goal is a fix that holds for years at
1000+ people and heavy document/photo usage — not a patch that needs
redoing in a few months. This is a critical, hard-to-reverse-if-botched
piece of infrastructure — a family's entire tree lives in it — so this
document is long and paranoid on purpose. Read §7 (backup & rollback)
first if you're skimming.

## 0. The recommendation, in one paragraph

Move everything that isn't strictly needed to *draw the tree* out of D1
and into R2 — not into a second D1 row. A second row would only double
the ceiling (to ~2MB), which back-of-envelope math (§2) suggests gets
exhausted on a similar timescale to how the current one was reached, once
usage grows the way you've described. R2 has no comparable per-object
ceiling for this use case, so this is a fix you build once. The design
below (§4–§5) also happens to solve the *other* problem that got us here —
the Workers CPU-time 503s — because the thing D1 has to parse and write on
every save gets structurally smaller, not just relocated.

## 1. The one constraint that makes this tractable

**The client's GET/PUT contract never changes.** One `GET /api/tree`
returns the whole logical tree; one `PUT /api/tree` sends the whole
logical tree back. Every risk in this project is confined to *where those
bytes physically live on the server* — never to the shape the app already
depends on.

Why that constraint holds regardless of how ambitious the backend rework
gets: `src/data/graph.js#buildGraph` synchronously builds adjacency maps —
parents, children, partners, and *derived* siblings — from the full
`people[]` and `relationships[]` arrays, in memory, every time the app
loads. The camera-fit framing, the generation bands, the whole "the tree
is navigation" thesis in CLAUDE.md depends on having the complete graph
before it can draw a single bubble. `HoverCard.jsx` also reads bio, tags,
occupation, residence, and military fields **synchronously on hover, for
any person, with no loading state** — confirmed by reading the component,
not assumed. Both facts together mean: whatever the server does
internally, the client must still receive one complete, fully-merged tree
object before it renders anything. Lazy-loading or paginating what the
*client* receives is a fundamentally different, much larger project than
fixing a storage ceiling — see §8.

## 2. Why a second D1 row isn't the fix, quantified

Your tree is ~800KB at 562 people — roughly 1.4KB/person across the whole
blob today. Two rows would give ~2MB total. But the growth you've told me
to plan for compounds:

- **People, at 1000+ with rich profiles** (bio, tags, life events,
  military fields, marriage metadata): a generously-detailed person record
  is plausibly 1.2–1.5KB once JSON field-name overhead is included. At
  1000 people, `people[]` *alone* could approach or exceed 1MB — before
  `relationships[]`, before a single memory, photo, or document.
- **Documents, which you told me will grow substantially**: each one
  carries a `summary`, a `facts[]` array with verbatim quotes, up to 7
  `profile_fields`, and — until fixed — a permanent inline base64 thumbnail
  that was never migrated to R2 the way `src` already was. This is
  unbounded per-document growth, not fixed overhead.

A second D1 row delays the wall; it doesn't remove it, and given these two
trends specifically, "delay" here likely means a comparable timescale to
how you reached the *current* ceiling — which directly contradicts "I
don't want to do this again in a few months." Moving the unbounded parts
into R2 removes the wall rather than moving it.

## 3. What's actually in the blob today (verified, not assumed)

One row, `family_tree.tree_json` (migration `0003_sharing.sql`), one
column, holds the entire client store shape (`src/data/store.js` `EMPTY`):

```
{ people, relationships, memories, photos, documents, activity,
  hasCompletedOnboarding, familyName, myPersonId, _seq, _deleted }
```

- **`documents[].thumb`** — a permanent inline base64 JPEG data URL,
  generated once at upload, **never** migrated to R2 unlike `src`/`photo`.
  Given this account's heavy Documents usage, the prime suspect for real
  bloat today, and a fix with an exact existing precedent
  (`migratePhotosToR2`/`migrateDocsToR2`).
- **`documents[].extracted`** — summary, `facts[]` (with verbatim quotes),
  up to 7 `profile_fields`, `medals[]`, `peopleMentioned[]`. Real, rich,
  permanently-stored content — the biggest structural growth vector as
  document count rises.
- **`memories[]`** — free-text, unbounded per entry.
- **`people[]`** — bio, tags, life events, military fields, marriage
  metadata. The other big structural growth vector at 1000+ people (§2).
- **`photos[]`** metadata — already small; binaries are already in R2.
- **`activity[]`** — capped at 100 entries, bounded, not a growth risk.
- **`_deleted` tombstones** — small per entry, but never pruned. A real,
  separate, slow unbounded-growth item — deliberately deferred, see §8.
- **`photo_thumb`** (per-person) — *not* a standing concern: an
  upload-in-flight preview, explicitly cleared to `null` once R2 confirms
  (`App.jsx:2368`, `store.js:1668`).

## 4. A finding that raises the stakes: the safety net is already fraying

`family_tree_snapshot` (migration `0009`) already gives every family a
real undo — the full previous `tree_json` archived before every save, 30
kept, restorable via `/api/tree/snapshots` → `/api/tree/snapshots/:id`.
Built specifically because *"a stale device's merge silently reverted
someone else's work, and the old value was simply gone."*

That snapshot row is subject to **the same 1MB D1 per-row cap** as the
live tree, and its insert is wrapped in a defensive try/catch — meaning it
can already be silently failing to protect exactly the accounts large
enough to need it. Fix this regardless of everything else here (§9,
Phase 0).

## 5. Every place that touches `family_tree` today (the full blast radius)

Nine call sites, every one of which must keep working, unmodified in
behavior, through this project:

| File | Reads/writes | Why it matters here |
|---|---|---|
| `functions/api/tree.js` | GET + PUT | The main path: role checks, contributor merge-in-place, editor can't-remove-people guard, size warn/hard-stop, auto-snapshot, `activity_log` write, ETag/`If-Match` concurrency. |
| `functions/api/merge.js` | GET + POST | Duplicate-family merge wizard. Reads/writes the **full** tree with its **own** compare-and-swap on `updated_at` — a separate concurrency mechanism from tree.js's ETag, same underlying column. Easy to forget. |
| `functions/_lib/invite.js` | read + write | Reads `people` to gate the merge wizard; appends one `member_joined` activity event directly into `tree_json` on join. |
| `functions/api/calendar/[token].js`, `functions/api/calendar-token.js` | read only | Confirmed by reading both: use only `id`, `display_name`, `birth_date`, `visibility`, `is_minor`, `is_deceased` — pure "graph-shape" fields (§6). These stay simple, D1-only, R2-free reads after the split. |
| `functions/api/tree/snapshots.js`, `functions/api/tree/snapshots/[id].js` | read + write | List/restore. Restore **writes the full tree back** — must restore both stores together as one action, see §6. |
| `functions/api/debug/tree.js` | read only | Diagnostic. Becomes the size/latency monitoring instrument going forward. |
| `functions/api/admin/stats.js` | read only (aggregate) | Cross-family dashboard using raw SQL JSON path expressions against the column. Needs rework or an explicit temporary caveat. Not urgent, must not be forgotten. |

Rather than touch all nine independently, the plan funnels every caller
through one shared module first (§9, Phase 1) — matching this codebase's
own established habit of extracting shared helpers before changing
behavior underneath them.

## 6. The target architecture

### 6.1 Core (D1, `family_tree` table — unchanged location) stays genuinely small, forever

Everything `buildGraph`, the camera/layout code, and the calendar feed
need synchronously, and nothing else:

- **Per person** (a fixed, deliberately narrow allowlist): `id`,
  `display_name`, `photo` (an R2 URL, already short), `gender`,
  `is_living`, `is_deceased`, `is_minor`, `birth_date`, `death_date`,
  `visibility`, `confidence`, `claimed_by_user_id`.
- **Every relationship**, in full (`from_person`, `to_person`, `type`,
  `qualifier`, `partner_status`, `since`, `until`, `is_married`,
  `marriage_date`, `marriage_place`) — these are needed synchronously by
  the graph and the pedigree chart's marriage strip, and are not a growth
  risk the way per-person profile content or documents are.
- Scalars: `myPersonId`, `familyName`, `hasCompletedOnboarding`, and
  **one** authoritative version counter that every write bumps, no matter
  which store actually changed.
- `_deleted.people`, `_deleted.relationships`.

At 1000 people this is, conservatively, in the hundreds-of-KB range —
comfortably under the 1MB cap with real margin, not a razor's edge.
**Phase 0's measurement step (§9) will calibrate this estimate against
this account's real bytes-per-person/relationship before Phase 2 locks in
the exact allowlist** — the number matters less than the principle: core
excludes every field that's rich, free-text, or grows per-item over time.

### 6.2 Extra (R2, new) — no comparable ceiling

Everything else: per-person `bio`, `tags[]`, `occupation`, `residence`,
`cause_of_death`, `events[]` (life-events timeline), military fields —
keyed by person id in a `peopleDetail` map — plus `memories[]`,
`photos[]`, `documents[]` (with `thumb` also referencing R2, not inline —
folded into this design from day one rather than shipped as a separate
interim fix), `activity[]`, and `_deleted.memories/photos/documents`.

This is **not** lazy-loaded. It's fetched in full, eagerly, on every load
— just from R2 instead of a D1 row. That's the detail that resolves the
apparent conflict with §1: HoverCard's synchronous need for bio/tags/
occupation/military data is satisfied because the server reassembles core
+ extra into one object *before* it ever reaches the client, exactly as
today. Moving these fields to R2 costs nothing in the UI; it only removes
them from D1's byte budget.

Why split *within* a person record rather than just moving whole
top-level collections: at 1000+ richly-profiled people, `people[]` alone
was the second identified risk in §2. A collection-level split (move
`memories`/`photos`/`documents`/`activity`, leave `people`/`relationships`
whole) still leaves `people[]` growing unboundedly with exactly the kind
of content — bios, tags, life events, military detail — that has no
natural size limit. Splitting the person record itself is what makes core
durably small regardless of how rich individual profiles get, not just
regardless of how many documents exist.

### 6.3 Storage keys and the write-order that makes this safe without distributed transactions

- `tree-extra/{familyId}/current.json` — the live pointer, read on every
  GET. Mirrors the exact pattern already proven in production by
  `functions/api/keepsake.js`'s `latest.json`.
- `tree-extra/{familyId}/history/{version}.json` — written alongside
  every save, pruned to the most recent 30 per family (matching
  `family_tree_snapshot`'s existing retention exactly, so this doesn't
  introduce a new unbounded-growth pattern while fixing an old one).
- `family_tree_snapshot` gains one column, `extra_key`, recording exactly
  which `history/{version}.json` was current at that snapshot's moment —
  so a restore pulls core and extra back together as one coordinated
  action, reusing nearly all of the existing restore endpoint.

**Write path (PUT), in order:**
1. Business logic (role checks, contributor restrictions, editor guard,
   conflict detection) runs exactly as it does today, against the one
   reassembled tree object — unchanged.
2. Split the result into core + extra.
3. Write extra to R2 first (`current.json` and the `history/{version}.json`
   copy).
4. Only once that succeeds, write core to D1 — including the existing
   `family_tree_snapshot` insert, unchanged.

This ordering is the whole safety mechanism, and it needs no distributed
transaction: **D1's write is the commit point.** If the R2 write fails,
D1 (the single source of truth for "what version is current") is never
touched — the save cleanly fails and the client retries, exactly like any
other failed save today. If R2 succeeds but the D1 write then fails
(rare), the R2 object is a harmless, unreferenced orphan — nothing reads
it until a D1 row points to it.

**Read path (GET):** fetch core (D1) and extra's `current.json` (R2) **in
parallel** (`Promise.all`), not sequentially — added latency is bounded by
the slower of the two, not their sum. Both stores are already the same
Cloudflare region (EU) per `wrangler.toml`, so this is a small, bounded
cost, not a chain of round trips. If the R2 read ever fails, degrade
gracefully: return core with extra empty and a clear, non-fatal banner,
rather than fail the whole load — a strict improvement over today, where
one row's failure means nothing loads at all.

### 6.4 The performance win this also delivers

The original incident behind the Workers CPU-time 503s was `JSON.stringify`/
`parse` cost on one large blob, on every save, against the free tier's
10ms ceiling (since papered over by the Workers Paid upgrade, which raised
the ceiling but never fixed the underlying cost). Under this architecture,
the only JSON D1 ever parses or writes is the small, bounded core object —
the CPU cost structurally drops regardless of how large "extra" grows,
because writing extra to R2 is a string `PUT` (I/O-bound), not a D1 row
write that has to validate/store a huge TEXT value. This durably fixes the
performance problem too, not just the storage ceiling — worth stating
plainly since it was the more urgent complaint a few weeks ago.

## 7. Backup & rollback, concretely, at every layer

1. **Already exists, today:** `family_tree_snapshot` — automatic, every
   save, 30 kept, restorable now. Fixed (§4, Phase 0) to never silently
   fail near the size cap, and (§6.3) extended with `extra_key` so restores
   remain complete once the split lands.
2. **New, one-time:** a full `wrangler d1 export bloodline --remote`
   backup taken immediately before the migration script (§9, Phase 2)
   touches *any* row — the nuclear, whole-database rollback, kept for a
   deliberate retention window (suggest 90 days) after the migration is
   proven stable.
3. **Structural, by construction:** the migration script never commits a
   family's split unless verification proves the reassembled result is
   deep-equal to the original `tree_json`. A failure mode here is always
   "this family is untouched, try again later," never "this family lost
   data."
4. **Every phase is its own revertible deploy.** Phase 0/1 touch no schema
   — a bad deploy is a plain code revert. Phase 2's dual-read design means
   even a bad deploy there can be rolled back before it has migrated a
   single family, because migration is a separate, deliberately
   un-automatic step from the deploy itself.

## 8. Explicitly out of scope (non-goals)

- **No client-side lazy-loading or pagination of the tree.** `buildGraph`
  and `HoverCard` both need the complete, merged object synchronously —
  confirmed by reading the code, not assumed. This remains true regardless
  of where the server stores the bytes. If a family's "extra" payload ever
  gets large enough that *download/parse time* (not storage) becomes the
  bottleneck — plausible only at extreme scale (many thousands of
  documents) — per-person lazy fetching becomes available **as a pure
  client-side follow-on, without any further backend migration**, because
  the data is already sitting in R2 as JSON by then; restructuring it into
  smaller keyed objects is a low-stakes, additive change once you're out of
  D1's hard cap entirely. Not needed now, not blocked by anything built
  here.
- **No revival of the normalized `person`/`relationship` SQL tables** from
  migration `0001_init.sql` — confirmed unused for live tree data today.
  Reviving true relational storage would be a far larger, riskier rewrite
  than fixing a size ceiling warrants.
- **No forced or blocking migration.** Every family not yet migrated keeps
  working exactly as today, indefinitely if necessary.
- **No deletion of old snapshots or pre-migration data** during or shortly
  after the transition.
- **Pruning `_deleted` tombstones** — real, separate, slow-growing —
  deliberately deferred; safely pruning needs confidence every client has
  synced past the prune point, a different, smaller piece of work.

## 9. Phased implementation order — each phase independently shippable and revertible

### Phase 0 — Measure, and take the free win ✅ done

- Extend `/api/debug/tree` with a byte breakdown per top-level key, and
  per-person-field sampling, to calibrate §6.1's core allowlist against
  this account's real numbers before Phase 2 locks it in.
- Move `documents[].thumb` to R2 immediately, using the exact
  `migratePhotosToR2`/`migrateDocsToR2` pattern — this doesn't need to
  wait for anything else and starts reducing bytes right away.
- Fix the silent snapshot-write-can-fail-near-the-cap issue (§4) — at
  minimum, log it.

**Acceptance:** no schema change, no client change. Rollback = revert the
deploy.

### Phase 1 — Extract `functions/_lib/treeStore.js` (pure refactor, zero behavior change) ✅ done

- One module: `loadTree(env, familyId)` → `{ raw, updatedAt } | null` (the
  raw row, deliberately unparsed — every caller keeps its own parse/
  fallback behavior, which genuinely differs from caller to caller today),
  `upsertTreeStatement`/`casUpdateTree`/`insertOnlyTree`/`updateTree` (the
  four distinct write shapes the nine call sites actually use), and
  `snapshotStatements` (the pre-write archive, shared by tree.js's PUT and
  the snapshot-restore endpoint, which no longer duplicate that SQL).
- Seven of the nine touch points in §5 now go through this module:
  `tree.js` (GET+PUT), `merge.js` (GET+POST, its own CAS preserved exactly),
  `_lib/invite.js` (both the merge-wizard gate read and the activity-append
  write — its signature changed from taking a raw `db` to the full `env`,
  updated at its 3 call sites), both calendar endpoints, `debug/tree.js`,
  and the snapshot-restore endpoint (which keeps its pre-existing
  un-batched two-call archive, deliberately not "improved" to match
  tree.js's batched version — that's a real behavior difference, not a
  refactor). `admin/stats.js` (a cross-family aggregate query, a
  fundamentally different shape of access) and the snapshot list endpoint
  (reads only `family_tree_snapshot`, no duplicated logic anywhere) were
  deliberately left untouched — see §5.
- This is the derisking step: once it's landed and proven stable, the
  actual split in Phase 2 becomes an internal change to this one module's
  guts, not a simultaneous nine-file change.

**Verified:** 21 new fake-D1 tests (merge.js's CAS/insert-only paths and
the TOCTOU race its own comments describe; invite.js's merge-wizard gate
and activity-append, including a non-fatal write failure; the snapshot-
restore endpoint's un-batched archive and `_seq`/`updated_at` stamping),
all existing tests still green with zero behavior differences, build and
smoke green.

**Acceptance:** full existing test suite green, zero behavior differences;
new fake-D1 tests covering `merge.js`'s CAS path and `invite.js`'s
activity-append path through the new module.

### Phase 2 — The real split: core stays in D1, extra moves to R2

- Implement §6's target shape: the person-record split, the R2 key
  scheme, the write-order-as-commit-point, the parallel-read reassembly.
- **Dual-read compatibility, always:** a family with no `_extraVersion` on
  its stored core JSON is treated as "everything is still in the legacy
  single blob." Nothing is forced; a family can be skipped indefinitely
  and keep working exactly as today.
- **The migration script** (one-time, per-family, idempotent, resumable):
  snapshot first (both mechanisms in §7) → split → reassemble → **commit
  only if the reassembled result is deep-equal to the original** → on any
  mismatch, abort, leave that family's row completely untouched, log for
  review.
- **Rollout order:** ship the dual-mode code, bake it in production
  reading only pre-migration data (a no-op from every user's perspective)
  → migrate one disposable test family → migrate **this account
  specifically**, deliberately, with a snapshot in hand and someone
  watching → migrate everyone else in small batches, watching error rates.
- **Bundled fixes:** `admin/stats.js` needs its own reassembly awareness,
  or an explicit temporary caveat while rollout is in progress.

**Two refinements made during implementation, superseding this section's
original wording:**
- **No separate `current.json` pointer file, and no `family_tree_snapshot`
  schema change.** The version pointer (`_extraVersion`) is embedded
  directly in the same core JSON string D1 already stores — not a second
  file that could drift out of sync with what D1 says is current. This
  also means a snapshot of a migrated family's row (already just an
  archival copy of that same core JSON) carries its own `_extraVersion`
  for free, so `family_tree_snapshot` needs no new column — the
  snapshot-restore endpoint derives which R2 version to fetch by parsing
  the snapshot's own stored core JSON.
- **Fail-clean, not graceful degradation, when a migrated family's extra
  can't be read.** A genuine R2 read failure or a named version missing
  from R2 surfaces as `extraError` (functions/_lib/treeStore.js
  `loadFullTree`), which both GET and PUT in `tree.js` turn into a 503 —
  never a tree silently missing its memories/photos/documents. The reason:
  GET/PUT round-trip the whole logical tree, so an incomplete tree served
  once could get written straight back over the family's real R2 data on
  the client's next, unrelated save.

**Progress:**
- ✅ `splitTree`/`reassembleTree` — pure, I/O-free, round-trip-tested
  (`tests/tree-split.test.mjs`).
- ✅ `loadFullTree`/`putExtra`/`writeExtraToR2`/`pruneExtraVersions` — the
  R2-backed read/write layer, dual-read and fail-clean as above
  (`tests/tree-r2.test.mjs`).
- ✅ `functions/api/tree.js`'s GET and PUT wired to the above: legacy
  families are provably untouched (byte-for-byte, never touch R2); a
  migrated family's GET reassembles transparently; its PUT re-splits once,
  writes R2 before D1, and measures the size-limit check against core's
  bytes alone (`tests/tree-r2-save.test.mjs`, plus the full pre-existing
  `tests/tree-save.test.mjs` suite green unchanged). Crucially, **nothing
  in this code path migrates a family itself** — `migratedMode` is read
  purely from whether the stored core already carries `_extraVersion`.
- ✅ The snapshot-restore endpoint's `_extraVersion`-aware restore path
  (`functions/api/tree/snapshots/[id].js`): a snapshot taken while migrated
  is reassembled via the shared `resolveTreeFromRaw` helper (also
  extracted from `loadFullTree` in this step, so both the live row and an
  archived one apply the exact same dual-read/fail-clean rules) before
  restoring; the restore is then written back in whichever mode the
  family *currently* is (never decided by the snapshot's own vintage —
  restoring a pre-migration snapshot into a since-migrated family still
  writes core+R2, and vice versa), with the same R2-before-D1 ordering and
  `extraError` → 503 fail-clean as `tree.js` (`tests/snapshot-
  restore.test.mjs`, plus the full pre-existing suite green unchanged).
- ⬜ The actual migration script (snapshot → split → verify deep-equal →
  commit-or-abort).
- ⬜ `admin/stats.js` reassembly awareness.
- ⬜ Staged rollout, ending with this account's tree migrated on purpose.

**Acceptance:**
- Round-trip unit tests (`reassemble(split(x))` deep-equals `x`) across a
  wide battery of fixtures: empty tree, large synthetic tree, a person
  missing every optional field (the stub records `user/profile.js`
  creates), a tree with fields from before the current schema existed. ✅
- Fake-D1-and-R2 tests for the GET/PUT and snapshot-restore touch points,
  in both legacy and split modes, extending the existing `tests/tree-
  save.test.mjs` pattern. ✅ (the remaining six touch points — merge.js,
  invite.js, both calendar endpoints, debug/tree.js, admin/stats.js, the
  migration script itself — still need the same treatment before
  rollout.)
- A full Playwright pass against a migrated *test* family covering every
  feature that touches the tree: memories, photos, documents, person
  edits, Keepsake, the Activity feed, the merge-wizard preview.
- A manual, byte-for-byte comparison of this account's real tree against a
  `wrangler d1 export` copy, reassembled locally, before this account's
  migration step runs against production.
- `npm run build`, `node --test tests/*.test.mjs`, `tests/smoke.mjs` green
  throughout, same bar as every other change in this codebase. ✅ so far.

## 10. Suggested order of work, if/when you say go

1. **Phase 0** — measure + the documents-thumb-to-R2 quick win. Days.
2. **Phase 1** — extract `treeStore.js`. A few days, full regression
   coverage, zero schema change.
3. **Phase 2** — the real split, migration script, and staged rollout —
   the actual project, done once, with this account migrated on purpose
   rather than swept in with everyone else. This is the phase that removes
   the ceiling for good; there is no Phase 3 to come back for.

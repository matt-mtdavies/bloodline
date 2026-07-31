# Phase 0: Complete-Tree Consumer Inventory

Status: research artifact for the Family Perimeter / 5,000-person performance ADR
Companion to: `docs/PHASE0-BENCHMARK-REPORT.md` (real timings/sizes at 100/500/1100/5000 people)
Scope: every place in `functions/` (server) and `src/` (client) that consumes, loads, or
processes the **complete** family tree — every person, every relationship — in one shot,
as opposed to a scoped/paginated/filtered subset.

This exists so the Family Perimeter ADR can answer, concretely, "if we introduce a
perimeter (people within N degrees of a viewer), which of today's ~30 full-tree touch
points would need to change, which are safe to leave alone, and which are actively
dangerous to scope naively?" Every finding below cites a real file and, where useful,
a line number.

---

## Server-side (`functions/`)

`functions/_lib/treeStore.js` is the shared storage module (`loadTree` reads the raw D1
row; `loadFullTree` reassembles core + R2 "extra" into the logical tree). Every server
file below either calls one of those two, or reads `family_tree`/`family_tree_snapshot`
directly.

| File | What it does | Whole-tree dependency | Classification |
|---|---|---|---|
| `functions/api/tree.js` (GET/PUT) | The main sync endpoint. GET returns the full reassembled tree; PUT accepts a full tree, diffs `prev.people` vs incoming to block silent deletions by non-admins, merges contributor edits onto the stored base, and writes the whole thing back (split into core/extra if migrated). | Yes — this **is** the authoritative single-row store today; every read/write is whole-tree by construction. | Genuinely needs the whole tree *under the current storage model* — but is the #1 file a perimeter/pagination redesign would have to touch (see "risky" section: its editor-removal guard and contributor-merge base both assume the PUT payload is the complete tree). |
| `functions/api/merge.js` (GET/POST) | Two-family merge flow: GET returns the target family's full tree for the wizard's preview; POST does a compare-and-swap (`casUpdateTree`/`insertOnlyTree`) writing the client-computed merged tree. | Yes — merging duplicate people safely requires seeing every person/relationship on both sides. | Genuinely needs the whole tree. |
| `functions/_lib/invite.js` (`processInvite`) | On invite-accept: checks whether the invitee's *other* family already has tree data (to route to the merge wizard), and appends a `member_joined` activity event onto the target family's full tree (read via `loadFullTree`, re-split, re-written). | Technically yes (must reassemble core+extra to safely round-trip), but the actual payload change is one small appended event. | Could plausibly work with a scoped subset — this is a full read/write purely to append one array entry; a dedicated "append activity event" RPC wouldn't need the rest of the tree at all. |
| `functions/api/calendar-token.js` (GET/POST) | Owner/coadmin birthday-feed settings: reads the full row, extracts `people`, filters to a birthday-eligible subset (`birth_date`, not private, not a living minor) for the picker UI. | Reads the whole row via `loadTree`, but only ever *uses* `birth_date`/`display_name`/`is_deceased`/`visibility`/`is_minor` per person. | Could plausibly work with a scoped subset (a narrow per-person projection), though today's cost is one D1 row read, not a scan problem. |
| `functions/api/calendar/[token].js` (GET, public/unauthenticated) | Public `.ics` birthday feed. Reads the full row, filters to the family's saved `calendar_person_ids` selection. | Same shape as calendar-token.js — full row read, narrow field use, output already selection-scoped. | Could plausibly work with a scoped subset. |
| `functions/api/debug/tree.js` (GET) | Read-only diagnostic: byte-size breakdown of the tree by top-level key and core/extra split per person (used to validate the storage-split boundary). | Yes, by design — the whole point is measuring the whole tree's shape. | Genuinely needs the whole tree (it's a diagnostic *about* the whole tree). |
| `functions/api/admin/migrate-tree.js` (POST) | One-time per-family migration from legacy single-blob storage to core(D1)+extra(R2): splits, reassembles, verifies deep-equality, then writes. | Yes — verification requires the complete tree round-tripping exactly. | Genuinely needs the whole tree. |
| `functions/api/tree/snapshots.js` (GET) | Lists a family's last 30 backups; parses each snapshot's JSON *only* to report `people.length`/`relationship.length` counts. | Parses the full blob per snapshot row but discards everything except two counts. | Could plausibly work with a scoped subset (counts could be precomputed/stored rather than parsed on every list request), though bounded to 30 rows so low urgency. |
| `functions/api/tree/snapshots/[id].js` (POST restore) | Restores an archived snapshot as the live tree: reassembles it, stamps every record's `updated_at` to now, repopulates `activity` from `activity_log`, re-splits and writes. | Yes — a restore is a full-tree replace by definition. | Genuinely needs the whole tree. |
| `functions/api/admin/stats.js` (GET) | Site-owner dashboard: cross-family aggregates (largest trees by byte size, platform-wide people/photo/memory/document totals). Deliberately excluded from the treeStore.js refactor per that file's own comment ("a cross-family aggregate query, not a per-family load — a fundamentally different shape of access"). | Reads `LENGTH(tree_json)` for every family (top-10 ranking) and reassembles every *migrated* family's tree individually to add exact photo/memory/document counts. | Genuinely needs the whole tree, repeated **across every family** — this is not a per-viewer perimeter concern at all; it's a platform-admin aggregate and out of scope for a viewer-perimeter feature. |
| `workers/export-workflow/src/workflowSteps.js` (`captureTree` step, imports `loadFullTree` from `functions/_lib/treeStore.js`) | The Full Archive Export pipeline's capture step — the one place besides `tree.js` that reads a family's complete logical tree, staged once into R2 so every later packaging step re-reads the staged copy instead of hitting `family_tree` again. | Yes, explicitly and permanently — this is a full, lossless archive export. | Genuinely needs the whole tree — and per the Family Perimeter plan's own non-goals ("Replace GEDCOM or the complete lossless archive"), this must **never** be scoped by a perimeter. |

**Already scoped / not applicable** (checked and found to not read `tree_json` at all):
- `functions/api/keepsake.js`, `functions/api/ancestry-story.js` — the client assembles a
  privacy-filtered per-person fact sheet (`src/lib/keepsake.js#buildKeepsakeFacts`,
  `src/lib/ancestryStory.js`) and POSTs just that; the server never touches `family_tree`.
- `functions/api/insights.js` — the client computes aggregate stats locally
  (`src/lib/insights.js#computeInsights`) and POSTs only the aggregates; same pattern.
- `functions/api/family/members.js`, `functions/api/activity.js` — separate tables
  (`family_member`, `activity_log`), never touch `family_tree`.

---

## Client-side (`src/`)

### Graph construction (`buildGraph` call sites)

There is exactly **one** call site in the whole client:

- `src/App.jsx:254` — `const graph = useMemo(() => buildGraph(data.people, data.relationships), [data.people, data.relationships]);`
  Built once per top-level render from the store's full `people`/`relationships` arrays,
  then threaded as a prop into nearly every other component (`BubbleTree`, `AccessibleTree`,
  `PersonSheet`, `TreeInsights`, `SearchOverlay`, etc.). This single call site is why the
  inventory below is so wide: almost every "full-tree consumer" in the client is a
  consumer of *this one graph object*, not a second independent full-tree load.

### Full-array scans doing real work

| Consumer | File | What it does over the whole tree | Classification |
|---|---|---|---|
| `buildGraph` | `src/data/graph.js:52` | Builds `byId`, and derives `parentsOf`/`childrenOf`/`partnersOf`/**`siblingsOf`** from every relationship and every person. | Genuinely needs the whole tree today — see "risky" section, siblingsOf is the sharpest correctness risk in this whole inventory. |
| `computeGenerations` | `src/data/graph.js:121` | Longest-path generation index from every root ancestor; multi-pass partner-leveling and parent/child-cascade convergence loops bounded by `graph.people.length`. Drives BubbleTree's vertical bands and the insights strata. | Genuinely needs the whole tree — a perimeter cut could pull a person's generation band from the wrong reference frame. |
| `relationshipCategories` | `src/data/graph.js:311` | `for (const p of graph.people)` buckets **every** person into immediate/grandparents/aunts-uncles/cousins/descendants/everyone-else/in-laws relative to one viewer, for the search overlay's filter chips. | Could plausibly work with a scoped subset (the categories nearest the viewer matter most; the "everyone_else" bucket is the only one that needs full reach). |
| `computeInsights` | `src/lib/insights.js:50` | Full pass for portrait/bio/birth-date completeness, earliest/latest-born, most-connected person ("heart"), etc. — feeds the aggregates POSTed to `/api/insights`. | Genuinely needs the whole tree for family-wide statistics (completeness %, earliest ancestor) — though see benchmark note below, cost scales linearly and is cheap. |
| `computeInsightModules` (15+ modules) | `src/lib/insightModules.js` | Wave 1/2 Tree Insights: living/remembered counts (`:987-988`), missing-photo list (`:1898`), trade lineage (`:1425`), name-frequency, birthday-twins, and — the standout — `bridges()`, an O(people × edges) "cut-point" scan that removes each person once and BFS's the remainder. | **Mixed** — many modules (surname frequency, lifespan trend, birthplace) are genuinely whole-family statistics; but per `docs/PHASE0-BENCHMARK-REPORT.md`, `bridges()` alone is ~82% of a 7-second `computeInsightModules` pass at 5,000 people (29ms → 57ms → 217ms → 7,041ms across 100→500→1100→5000, i.e. ~2 orders of magnitude worse than linear). This is the single largest computation-cost finding in the whole inventory and a natural first target for either scoping or algorithmic fixing, independent of the storage ADR. |
| `findDuplicatePairs` | `src/lib/duplicates.js:46` | Groups every person by normalized name, compares every pair within a name-group for corroborating evidence (shared parent/child/partner, matching birth year, thin-stub heuristic). | Genuinely needs the whole tree — a duplicate can exist anywhere in the family, not just near the viewer; scoping this to a perimeter would silently miss duplicates in out-of-scope branches (see "risky" section). |
| `rankPeopleByName` | `src/lib/search.js:93` | Scores every person against a free-text query across name/birth-name/middle-name/occupation/place. Backs the search overlay. | Could plausibly work with a scoped subset for the *default/ranked* results (perimeter-near people first), but the Family Perimeter plan's own goal #4 ("everyone globally searchable") means a full fallback pass must remain available — so this is "could be layered, never fully removed." |
| `storeToGedcom` | `src/lib/gedcom.js:411` | Full GEDCOM export — every person becomes an `INDI` record, every relationship a `FAM` record. | Genuinely needs the whole tree — GEDCOM export is explicitly a non-goal-to-break in the Family Perimeter plan ("Replace GEDCOM or the complete lossless archive"). |
| `dedupeMergeImport` | `src/lib/duplicates.js:151` | Cross-references an entire incoming GEDCOM/FamilySearch import against the entire existing tree to collapse exact re-adds. | Genuinely needs the whole tree on both sides — same reasoning as `findDuplicatePairs`. |
| Bubble node/simulation setup | `src/viz/BubbleTree.jsx:264` (`graph.people.filter(visibleRef...)`), `:1902-1903` (`g.people.length` for reveal-fraction) | Simulation nodes are already lazily created only for the *visible* set (an existing scoping mechanism, see below) — but `computeGenerations(graph)` (full-tree) runs once up front to seed Y-positions, and `relSignature(graph.relationships)` (full-tree scan) reruns on every `sync()` to detect structural changes. | Partially already scoped (render/simulation cost), but its inputs (`computeGenerations`, relationship-change detection) are still full-tree passes. |
| Directory filter/sort | `src/components/AccessibleTree.jsx:130-146` | `graph.people.filter(...).sort(...)` on every query keystroke/filter change, feeding a `useVirtualizer` list. | Already scoped for *render* (virtualized rows), but the filter/sort computation itself is a full O(n log n) scan on every keystroke. |
| `toggleExpandAll` ("reveal all") | `src/App.jsx:1030-1064` | `distancesFromMany(graph, expanded)` BFS over the **whole graph**, then caps the candidate set at `MAX_BUBBLE_REVEAL` (250) sorted by distance, revealed in ripple layers. | Already partially scoped — this is the existing precedent for perimeter-style thinking: a hard cap plus distance-sorted reveal, added specifically because "a large real tree (1000+ people) spikes CPU/GPU/memory hard enough to crash the tab." A future perimeter feature should look like a generalization of this, not a new mechanism. |
| Places list | `src/App.jsx:2107` | `graph.people.map((p) => p.residence)` deduped and capped at 50, for a map filter. | Already scoped (output capped at 50; input scan is O(n) but cheap). |
| Merge wizard | `src/components/MergeWizard.jsx` (e.g. `:421-470`) | Builds the merged `{ people, relationships }` client-side from both full trees before POSTing to `/api/merge`. | Genuinely needs both whole trees — this is the client half of the server-side merge described above. |
| GEDCOM/FamilySearch import | `src/components/GedcomImport.jsx:25`, `src/components/FamilySearchImport.jsx:26` | Runs `dedupeMergeImport` (full existing tree vs. full incoming set) before committing an import. | Genuinely needs the whole existing tree, same as `dedupeMergeImport` above. |
| Keepsake / Ancestry Story fact assembly | `src/lib/keepsake.js` (`buildKeepsakeFacts`, `constellationLayout`), `src/lib/ancestryStory.js` | Walks ancestors/descendants of **one** focal person; `graph.people.length` is read once for a `recordCount` total but the actual facts sheet is person-bounded. | Already scoped — genuinely bounded to one person's lineage, not the whole tree (confirms the server-side classification above). |
| `chartLayout.js` / `pedigreeLayout.js` | `src/viz/chartLayout.js:282` (`computeChartLayout`), `src/viz/pedigreeLayout.js:256` (`computePedigree`) | Both take a `focalId` and recursively build ancestor/descendant "pods"/cards from that one person outward — never iterate `graph.people` as a whole. | Already scoped — focal-bounded traversal, confirmed by reading both functions. |

### Persistence / sync

- **`src/data/store.js`** is the client's single source of truth, and it is *structurally*
  a whole-tree store:
  - `commit()` (`:652-692`) calls `JSON.stringify(state)` and `localStorage.setItem(KEY, serialized)`
    on **every single mutation** — one person's photo edit re-serializes and re-persists
    the entire tree (people, relationships, memories, photos, documents, activity) to
    localStorage every time.
  - `putTree()` (`:336`) does `JSON.stringify(stripForServer(s))` and `PUT /api/tree` with
    the **whole tree** (minus inline base64 data URLs) on every server save, with retry/backoff
    and a 409-conflict merge-and-retry loop.
  - `loadFromServer()` (`:742`) does `GET /api/tree`, fetching the whole tree, then
    reconciles per-record via `_mergeByRecency`/`_mergeById`/`_mergeActivity` (`:414-463`),
    each of which iterates the **full** local and server arrays to build a merged result.
  - `hasUnsyncedContent()` (`:724`) JSON-stringifies six full top-level keys to decide
    whether a post-merge save is even worth sending.
  - This is the file a perimeter/scoped-loading redesign would touch most fundamentally:
    today's wire format and conflict-resolution model (README: "the shape deliberately
    mirrors the D1 API schema") assume one PUT/GET round-trip *is* the complete tree.
  - Secondary note (not itself a "full-tree scan" but compounds with tree size): nearly
    every single-person mutator in this file (`updatePerson`, `setPhoto`, `addResidence`,
    etc.) does `state.people.find((p) => p.id === id)` — an O(n) linear scan per edit,
    dozens of call sites (`:1197`, `:1244`, `:1376-1512`, `:1718-2398` and many more).
    Individually cheap, but every edit action pays this cost, and it scales with tree size.

---

## Consumers that would be risky to scope down

These are the places where a naive perimeter cut (excluding people beyond N degrees from
the viewer) would not just show *less* — it would silently compute something **wrong**,
which is a materially worse failure mode than an honest "not shown" gap.

1. **`buildGraph`'s sibling derivation** (`src/data/graph.js:83-99`). Siblings are derived,
   never stored: two people are "full" siblings if they share 2+ biological/adoptive
   parents, "half" if they share exactly one. If a perimeter includes person A and one of
   their parents but excludes that parent's *other* co-parent (who sits just outside the
   perimeter), any half-sibling who is only connected through that excluded co-parent
   would either vanish from A's sibling list entirely, or — worse, if partially present —
   get silently reclassified from "full" to "half" or from "half" to no relationship at
   all, purely because of which relationships happen to be in scope, not because the
   family data changed.

2. **`computeGenerations`'s partner-leveling and cascade convergence** (`src/data/graph.js:121-193`).
   The algorithm levels active partners onto the same generation band and then cascades
   children below their parents until convergence, walking the **whole** `graph.people`
   array each pass. A perimeter that cuts the graph into a disconnected "island" (a person
   present, but their route back to a shared reference generation is out of scope) could
   converge to a plausible-looking but wrong generation index — visually indistinguishable
   from a correct one, so a bug here would be very hard to spot in review.

3. **`bloodRelativesOf` / `relationshipCategories`** (`src/data/graph.js:273-357`). The
   "blood or adoptive relative" classification does a strict two-pass walk (all ancestors,
   then everyone descended from those ancestors). If a perimeter excludes an ancestor
   above N degrees, a genuine blood relative reachable only through that excluded ancestor
   would fall through to the `blood.has(id) ? 'everyone_else' : 'in_laws'` branch and get
   mislabeled as an **in-law** — a real relative shown as no relation at all, not merely
   omitted.

4. **`relationLabel` / `buildRelationCrumbs`** (`src/data/graph.js:492-787`). Kinship-term
   resolution ("2nd cousin once removed", "Paternal Great-grandfather's Grandson") depends
   on finding the nearest **common ancestor** by walking both people's ancestor chains. If
   the common ancestor sits outside the perimeter, today's code has no "the path continues
   beyond what I can see" case — it would either return the generic fallback `'Relative'`
   or, in the worse case, resolve to whatever partial chain it *can* see and produce a
   plausible-but-wrong label (e.g. undercounting "greats" if an intermediate ancestor is
   missing).

5. **`functions/api/tree.js`'s editor-removal guard** (`:213-222`). This safety check
   compares `prev.people` (from `loadFullTree`) against the incoming PUT payload's people
   list; anyone present in `prev` but missing from the incoming array is treated as an
   intentional removal and blocked unless the actor is co-admin+. **This check assumes
   the PUT payload is the complete tree.** If a perimeter-aware client ever started
   sending only its in-scope people on a save (rather than the whole tree), every
   out-of-perimeter person would look "removed" and this guard would misfire — either
   blocking every editor's save outright, or (if disabled) silently deleting everyone
   outside the saving device's perimeter. Any perimeter design that touches the wire
   format between client and `/api/tree` must explicitly account for this.

6. **`src/data/store.js`'s recency-merge model** (`_mergeByRecency`, `_mergeById`,
   `hasUnsyncedContent`, `:414-735`). The whole conflict-resolution scheme is built on
   "both sides hold the full array, diff by id." Under the current contract, an id
   missing from a payload *means* deleted (see tombstones, `withTombstones`). A
   perimeter-scoped payload breaks this assumption at the root: "not in this payload"
   would need to mean "out of scope," not "deleted" — a fundamentally different meaning
   for the same wire shape, and a likely source of silent data loss if conflated.

7. **`findDuplicatePairs` / `dedupeMergeImport`** (`src/lib/duplicates.js`). Both are
   explicitly whole-tree-safety features (catching accidental double-entry, deduping
   re-imports). Scoping either to a perimeter would silently miss duplicates or
   double-imports in out-of-scope branches — these should be flagged as **must stay
   whole-tree** in the ADR, not candidates for scoping.

8. **Full Archive Export** (`workers/export-workflow`, via `loadFullTree`) and **GEDCOM
   export** (`src/lib/gedcom.js#storeToGedcom`). Both are explicit non-goals-to-break in
   the Family Perimeter plan ("Preserve full archive export, snapshots and recovery";
   "Replace GEDCOM or the complete lossless archive" is listed as a non-goal). These must
   remain full-tree operations regardless of what a viewer's perimeter setting is.

9. **`bridges()` in `computeInsightModules`** (`src/lib/insightModules.js`). Not a
   correctness risk, but the sharpest *performance* risk found: ~82% of a 7-second
   `computeInsightModules` pass at 5,000 people, per `docs/PHASE0-BENCHMARK-REPORT.md`.
   Any perimeter feature that re-triggers a full insights recompute on every
   viewport/anchor change would inherit this cost verbatim — worth flagging as a
   dependency for whatever the ADR proposes for Insights scoping.

10. **`functions/api/admin/stats.js`**. Not perimeter-related at all — it is a
    cross-family, platform-wide aggregate (every family's tree size, content totals). A
    per-viewer perimeter concept has no natural mapping onto this endpoint; the ADR should
    explicitly carve it out as out-of-scope rather than let it be an ambiguous edge case.

---

## Summary counts

- **Server-side files with a genuine full-tree dependency:** 9 —
  `tree.js`, `merge.js`, `invite.js`, `debug/tree.js`, `admin/migrate-tree.js`,
  `tree/snapshots/[id].js`, `admin/stats.js` (cross-family), `workers/export-workflow`'s
  capture step, plus the shared `_lib/treeStore.js` they all route through.
- **Server-side files reading the full row but only using a narrow projection
  (plausibly scopable):** 3 — `calendar-token.js`, `calendar/[token].js`, `tree/snapshots.js`.
- **Server-side endpoints already scoped / not touching `tree_json` at all:** 5 —
  `keepsake.js`, `ancestry-story.js`, `insights.js`, `family/members.js`, `activity.js`.
- **Client `buildGraph` call sites:** 1 (`src/App.jsx:254`) — but it fans out to nearly
  every other consumer via the shared `graph` prop, which is why the client-side surface
  is wide despite there being only one graph-construction point.
- **Client full-array-scan consumers doing real work:** ~14 distinct files/functions
  (`graph.js` ×3 functions, `insights.js`, `insightModules.js`, `duplicates.js` ×2,
  `search.js`, `gedcom.js`, `BubbleTree.jsx`, `AccessibleTree.jsx`, `App.jsx` ×2,
  `MergeWizard.jsx`, `GedcomImport.jsx`/`FamilySearchImport.jsx`).
- **Client consumers already scoped/focal-bounded:** 3 — `keepsake.js`/`ancestryStory.js`
  fact assembly, `chartLayout.js`, `pedigreeLayout.js`.
- **Consumers flagged as risky to scope naively (correctness, not just performance):** 6 —
  sibling derivation, generation-leveling cascade, blood-relative classification, kinship
  labeling, the tree.js editor-removal guard, and store.js's recency-merge model.
- **Consumers explicitly flagged as must-remain-whole-tree regardless of perimeter:** 4 —
  duplicate detection, merge-import dedup, GEDCOM export, Full Archive Export.
- **Single largest performance hotspot found:** `bridges()` inside
  `computeInsightModules` — ~82% of a 7,041ms pass at 5,000 people (see
  `docs/PHASE0-BENCHMARK-REPORT.md`), worth a scoped fix independent of the storage ADR.
- **Existing precedent for perimeter-style scoping already in the codebase:**
  `MAX_BUBBLE_REVEAL` (250-person hard cap with distance-sorted, ripple-layered reveal)
  in `src/App.jsx`'s `toggleExpandAll`, and `BubbleTree.jsx`'s lazy per-visible-person
  simulation-node creation — both added specifically to survive large real trees, and
  both a reasonable starting shape for what a formal perimeter feature should generalize.

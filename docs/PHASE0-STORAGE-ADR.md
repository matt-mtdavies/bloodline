# Phase 0 ADR: Storage Architecture for the Family Perimeter / 5,000-Person Work

Status: proposed, for review alongside PR #84 (`docs/FAMILY-PERIMETER-AND-5000-PERSON-PERFORMANCE.md`)
Evidence base: `docs/PHASE0-BENCHMARK-REPORT.md` (real timings/sizes, regenerable via
`npm run benchmark:phase0`) and `docs/PHASE0-TREE-CONSUMER-INVENTORY.md` (every complete-tree
consumer, client and server). No production data was read, exported, or referenced to reach
any conclusion in this document — every number below comes from deterministic synthetic
fixtures (`src/lib/fixtureGenerator.js`).

## 1. The question

The spec (§5, §6.2, §9.3) already narrows this to one question, correctly: **extend the
existing `functions/_lib/treeStore.js` core/R2-extra split, or replace it with something new**
— and it already sets the bar for replacing it high: "Extend the existing core/R2-extra/
manifest-pointer pattern unless Phase 0 measurements demonstrate a concrete reason to replace
it." This ADR answers that question with real measurements.

## 2. Decision

**Extend `treeStore.js`. Do not replace it.** The measurements below show a real, concrete gap
at 5,000-person scale — but the gap is that the *existing split doesn't go far enough yet*, not
that its design is wrong. The fix is to deepen the same pattern (deterministic, bounded chunks
instead of one core object and one extra object), not to invent a new storage model.

### 2.1 What the measurements show

| Size | Legacy whole-blob (pre-migration) | Migrated core (D1, today's `treeStore.js`) | Migrated extra (R2) |
|---|---|---|---|
| 100 | 66.0 KB (6.4% of 1 MiB) | 41.3 KB (4.0%) | 25.8 KB |
| 500 | 325.1 KB (31.7%) | 214.0 KB (20.9%) | 117.4 KB |
| 1,100 | 723.2 KB (70.6%) | 474.7 KB (46.4%) | 262.4 KB |
| 5,000 | 3.26 MB (325.6%) | **2.13 MB (212.7%)** | 1.20 MB |

(Regenerated live via `functions/_lib/treeStore.js`'s own `splitTree`, run against each fixture,
with `reassembleTree` verified deep-equal to the original at every size — the split code itself
is not in question, only whether one D1 row is enough to hold what it currently puts in `core`.)

**The core finding: today's `treeStore.js` split already buys real headroom (a 5,000-person
family's core is ~35% smaller than the legacy whole blob), but it is not sufficient on its own
at 5,000 people — the core row itself is already 212.7% of the 1 MiB ceiling.** This is not a
marginal case worth deferring; a family in the range this project is explicitly scoped for
(§2.2's engineering goals target exactly this size) would already fail to save under the
*current, already-migrated* storage path.

**Why core is still this large, broken down** (5,000-person fixture, `core` = 2.13 MB total):

| Contributor | Bytes | % of core |
|---|---|---|
| `core.people` (already slimmed to `CORE_PERSON_FIELDS`) | 1,139,377 | 51.1% |
| `core.relationships` (100% unsplit — every relationship, always) | 1,090,511 | 48.9% |

`splitTree` (`functions/_lib/treeStore.js:106`, `CORE_TOP_LEVEL_KEYS`) treats `relationships` as
an atomic top-level key that goes to core in its entirety — there is no per-relationship
slimming or chunking today, unlike `people`, which already has a real core/detail split via
`CORE_PERSON_FIELDS`. At ~147 bytes/relationship and 7,407 relationships in the 5,000-person
fixture (a realistic edge density — 2 parent edges + partner edges per person, not an
adversarial worst case), relationships alone are approaching half the ceiling on their own,
independent of how many people exist. **Any extension of `treeStore.js` needs to chunk
relationships, not just people** — a gap the spec's §6.2 chunk-manifest design (bounded by byte
size, not person count) already anticipates in principle, but which this measurement makes
concrete rather than hypothetical.

### 2.2 Why not replace it (the two neutral options the earlier spec draft considered)

The spec's own revision history (per the reviewed PR #84) already moved away from presenting
three neutral options and toward "extend unless proven otherwise" — this section records why
that call holds up under real measurement, for anyone revisiting the decision later:

- **A second D1 row / secondary table per family.** Rejected for the same reason
  `docs/TREE-STORAGE.md` already rejected it when the original core/R2 split was designed: it
  only doubles the ceiling. The relationships-alone number above (1.09 MB at 5,000 people) shows
  doubling isn't enough headroom even today, and this project's own goals (§2.2) name larger
  trees as the reason to build this at all — a fixed multiplier is the wrong shape of fix for an
  unbounded-growth problem.
- **A wholesale new storage engine / different database.** No measurement here justifies this.
  The *access pattern* problem (one eager whole-tree read/write) and the *ceiling* problem
  (unbounded relationships/people in one JSON blob) are both solvable by chunking within the
  existing D1(pointer)+R2(chunks) shape — nothing measured points to D1 or R2 themselves being
  the wrong primitives, only to the current all-in-one-object framing of what goes in them.
- **Extending `treeStore.js`** keeps everything already proven in production: the
  `_extraVersion`-embedded-in-D1-core pointer convention, R2-before-D1 write ordering,
  round-trip verification, snapshot-first human-triggered migration, and fail-clean (503, never
  silent-degrade) read behavior. All of this prior art carries forward unchanged; only the
  *shape* of what core/extra each contain needs to deepen from "two objects" to "a manifest plus
  N deterministic chunks," exactly as spec §6.2 already proposes.

## 3. What "extend" concretely means, given these numbers

Per spec §6.2, the manifest-and-chunks design is already specified; these measurements answer
the "should we build it, and what should the first chunk boundary be" questions:

1. **Relationships need their own chunk axis, not just people.** The 49/51 split above means a
   people-only chunking scheme (e.g. "500 people per chunk") would still leave one unbounded
   relationships blob as the residual risk. Chunk boundaries should be defined per spec §6.2's
   own "deterministic and bounded by byte size, not an arbitrary person count" — this measurement
   confirms byte-size bounding is the right call over a person-count heuristic, since edge density
   (not just people count) is what actually drives the overflow.
2. **The D1 core row itself must shrink further even after chunking relationships and people
   into R2** — `treeStore.js`'s current design keeps `core` as the authoritative pointer/summary
   row, which is correct, but `core.people` at 1.14 MB for 5,000 people (even *after* stripping
   to `CORE_PERSON_FIELDS`) shows the per-person core allowlist itself may need a second look, or
   the summary-index layer proposed in spec §6.1 needs to genuinely live outside the D1 row (not
   merely be a stripped-down copy of it).
3. **At 100–1,100 people, today's already-shipped split is comfortably sufficient** (4.0%–46.4%
   of the ceiling) — there is no urgency to touch anything below roughly 2,000–2,500 people by
   this linear-ish trend, which matters for sequencing: this is a scale problem, not an
   immediate-crisis problem, and the delivery sequence in spec §10 (Phase 0 baseline → Phase 7
   progressive architecture, well after the user-facing perimeter phases) is appropriately paced
   relative to what these numbers show.

## 4. Independent finding: a real computation-cost cliff, separate from storage

`docs/PHASE0-BENCHMARK-REPORT.md` and `docs/PHASE0-TREE-CONSUMER-INVENTORY.md` both flag
`bridges()` inside `src/lib/insightModules.js` (a "cut-point" family-structure insight) as
~82% of a 7-second `computeInsightModules` pass at 5,000 people — timings across the four
fixture sizes are dramatically worse than linear (order of a hundred-fold increase across a
50x growth in people). **This is a computation-cost problem, not a payload-size problem, and
the storage ADR above does not fix it.** It matters here because spec §6.9 (Insights) and §6.5
(background worker for graph/insight computation) both touch this exact code path — whatever
Phase 6/7 does for insights needs to either bound or move `bridges()`'s exhaustive
removal-and-BFS scan off the interactive path, independent of whatever storage chunking ships.
Flagged as a scoped follow-up, not blocking this ADR's decision.

## 5. Consequences for existing consumers (see the full inventory for detail)

Per `docs/PHASE0-TREE-CONSUMER-INVENTORY.md`, extending `treeStore.js`'s chunking does **not**
by itself require touching most of the ~30 complete-tree consumers catalogued there — chunking
is a storage-layer change behind `loadFullTree`/`loadTree`, and every consumer that calls those
(or receives the reassembled tree from them) keeps working unchanged, the same way today's
core/R2 split is already invisible to every caller above it. The consumers that *do* need
deliberate design attention when perimeter/progressive-loading work begins (a later phase, not
this ADR) are the six flagged as "risky to scope down" in the inventory — sibling derivation,
generation-leveling, blood-relative classification, kinship labeling, `tree.js`'s
editor-removal guard (assumes the PUT payload is the complete tree — a real design constraint
on the wire format any future progressive/perimeter-aware save path must respect), and
`store.js`'s whole recency-merge/tombstone model (id-absent-currently-means-deleted, which
breaks under a partial/scoped payload unless redefined). None of these need to change for the
storage-chunking extension proposed here; all of them need explicit design in the later
perimeter/progressive-loading phases the spec already sequences separately (§6.2 vs. §6.3/§6.7).

## 6. Recommendation summary

- **Storage:** extend `treeStore.js`'s manifest+chunk design (spec §6.2) to cover both people
  and relationships, chunked by byte size; do not introduce a second storage engine or a second
  D1 row.
- **Sequencing:** no urgent action needed below ~2,000–2,500 people; the chunking work should
  land before this project's user-facing perimeter phases reach families in that range, which
  the existing phased delivery plan (spec §10) already accounts for.
- **Separate, non-blocking follow-up:** `bridges()`'s computation cost in
  `computeInsightModules` should get its own scoped fix (lazy/on-demand invocation, or a bounded
  neighborhood scan) before any perimeter feature starts triggering insight recomputation more
  often than today's "once per tree load."
- **Do not start:** the perimeter UI or any progressive-storage client changes yet, per the
  original Phase 0 scope constraint — this ADR is a recommendation for review, not
  authorization to build Phase 1+.

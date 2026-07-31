# Bloodline Family Perimeter and 5,000-Person Performance Plan

Status: implementation brief for review  
Audience: product owner, Codex design review, Claude implementation review  
Baseline: current Bloodline `main` as reviewed 30 July 2026  
Target: a responsive, trustworthy everyday experience for family trees containing up to 5,000 people

---

## 1. Executive decision

Bloodline should build Family Perimeter and the 5,000-person performance programme as one coordinated initiative, but not as one large code change.

The two concerns are related:

- Family Perimeter determines which part of the complete family is brought forward for everyday browsing and personal insights.
- The performance programme ensures the complete archive remains searchable, editable and recoverable without loading, processing, simulating or rewriting all 5,000 rich profiles for every interaction.

Family Perimeter is not a deletion, access-control or privacy mechanism. It is a personal perspective over the complete shared family graph.

The product promise should be:

> Family Perimeter brings the people most connected to your everyday family experience forward. The complete family tree remains intact, searchable and available at all times.

The technical promise should be:

> The same deterministic perspective calculation powers Tree, Search, profiles, Home, Insights and future derived experiences. The application never silently omits a person, changes shared data or presents a perimeter-scoped statistic as a complete-tree statistic.

The 5,000-person baseline is an engineering acceptance target, not a promise that all 5,000 portrait bubbles can usefully appear on one animated canvas. The complete population must be searchable and manageable; the visual tree should render a deliberately bounded working set.

---

## 2. Goals

### 2.1 Product goals

1. Keep a large collaborative tree emotionally personal.
2. Let every member choose their own everyday family scope.
3. Preserve the complete family tree without deletion or permanent hiding.
4. Keep everyone globally searchable.
5. Prevent heavily populated distant branches from dominating personal insights.
6. Explain inclusion and exclusion in language ordinary family members can understand.
7. Treat biological and adoptive family lines equally.
8. Include stepfamily and partners respectfully without allowing marriages and blended-family links to expand indefinitely.
9. Allow intentional exploration outside the saved perimeter without changing the preference.
10. Preserve a complete-tree option for genealogists and administrators.

### 2.2 Engineering goals

For a realistic 5,000-person family:

1. Initial app shell and immediate family experience must not wait for every rich profile detail or media record.
2. Search must cover all 5,000 people.
3. Graph topology and perspective calculations must remain deterministic.
4. Normal tree interactions must render a bounded number of Pixi objects.
5. Editing one person must not serialize, upload, merge and rewrite the entire logical family archive.
6. Background synchronization must be incremental and conflict-safe.
7. Personal settings must not be stored inside shared tree data.
8. Every new storage representation must preserve full archive export, snapshots and recovery.
9. Benchmarks must be repeatable in Chromium and WebKit, including mobile-class conditions.
10. No production data may be copied into fixtures, logs, prompts or third-party tools.

### 2.3 Non-goals

The initial programme does not:

- Display all 5,000 people simultaneously in the force-directed canvas.
- Change who is authorized to see a person.
- Remove records outside a perimeter from Search or export.
- Use Family Perimeter as a security boundary.
- Infer biological, adoptive, step or partner relationships that are not recorded.
- Introduce arbitrary advanced sliders or graph-query controls.
- Promise exact `+N relatives` collapsed-node counts before boundary ownership is proven.
- Replace GEDCOM or the complete lossless archive.

---

## 3. User-facing model

### 3.1 Setting

Location:

`Your profile → Family Perimeter`

Options:

- **Close family** — through 1st cousins
- **Extended family** — through 2nd cousins
- **Wider family** — through 3rd cousins
- **Complete family tree** — everyone

Supporting copy:

> Choose how much of your family Bloodline brings forward during everyday browsing. People outside your perimeter remain part of the complete family tree and are always searchable.

Existing users initially receive `Complete family tree` so an update does not silently change their current view. New users should be offered `Extended family` as the recommended starting point after they claim their own person.

If a member has not claimed a person in the family, show:

> Link your profile to your person in the tree to create a personal Family Perimeter.

Until then, use `Complete family tree`.

### 3.2 Two equal household anchors

The viewer and each current partner are equal anchors.

For a selected perimeter level, Bloodline calculates the same genealogical perimeter from:

- the viewer; and
- each recorded current partner.

The results are combined. This makes the everyday tree represent both sides of a current household instead of treating one partner as an attachment.

Former partners with shared children are included as part of the family unit, but do not automatically become equal anchors. Their complete genealogy is included only if they are a current partner, independently fall within a perimeter, are explicitly included in a later personal-inclusion feature, or the member chooses Everyone.

### 3.3 Relationship behaviour

The engine separates lineage from family context.

| Relationship | Visible as family | Receives immediate-family treatment | Propagates ancestry and cousin degree |
|---|---:|---:|---:|
| Biological parent/child | Yes | Yes | Yes |
| Adoptive parent/child | Yes | Yes | Yes |
| Step parent/child | Yes | Yes | No |
| Current partner | Yes | Yes | No, except when the partner is a household anchor |
| Former partner | Yes when needed to explain a family unit | Limited | No |

This is not a value judgement. Biological and adoptive relationships establish genealogy. Step and partner relationships establish family membership and context.

### 3.4 The three inclusion layers

Every person in the everyday view can qualify through more than one route. The engine retains all qualifying reasons for diagnostics, but assigns one canonical reason for ordinary explanation using this strict precedence: **anchor/primary perimeter > family halo > partner context ring > temporary reveal**. A weaker route never overwrites a stronger route. Within one tier, choose the closest supported relationship and then a stable identifier-based tie-break, so results are independent of graph input order.

The inclusion layers are:

1. **Primary perimeter**
   - Viewer or current-partner anchor.
   - Direct biological/adoptive ancestor.
   - Direct biological/adoptive descendant.
   - Collateral biological/adoptive relative within the selected cousin degree.

2. **Family halo**
   - Parent, sibling, child, step-relative, current partner or relevant former partner of a primary-perimeter person.
   - Added in one pass.
   - Does not recursively create another halo.

3. **Partner context ring**
   - Parent, sibling or child of a partner included through the family halo.
   - Added to make socially meaningful family units legible.
   - Does not expand further.

The UI should not burden people with these engineering terms during normal use. They exist so behaviour is deterministic, testable and explainable when someone asks why a person is present.

### 3.5 Definitive inclusion algorithm

Inputs:

- complete relationship graph;
- viewer person ID;
- current partner IDs derived from recorded relationship status;
- selected cousin degree `1`, `2`, `3` or `everyone`;
- optional Bloodline-only state;
- optional temporary reveal IDs;
- future explicit personal inclusions.

Output:

- `primaryIds`;
- `familyHaloIds`;
- `partnerContextIds`;
- `perimeterIds`, the union of the three;
- `outsideIds`;
- `inclusionReasonById`;
- `relationshipById`;
- `boundaryEdges`;
- `minimumRevealPathById`;
- `insightCohortIds`.

Algorithm:

1. Validate that the viewer ID exists.
2. Build anchors from the viewer plus recorded current partners.
3. If the setting is Everyone, mark every person as primary and skip cousin calculation.
4. For each anchor:
   1. Traverse biological and adoptive parent edges upward to all ancestors.
   2. Traverse biological and adoptive child edges downward to all descendants.
   3. Calculate collateral relatives through the selected cousin degree.
   4. Union the results into `primaryIds`.
5. For each primary person, add one family halo:
   - parents;
   - siblings;
   - children;
   - step-parents, step-siblings and stepchildren;
   - current partners;
   - former partners where a shared child or recorded relationship makes them necessary to understand the unit.
6. For each partner added in step 5, add one partner context ring:
   - their parents;
   - their siblings;
   - their children.
7. Do not repeat steps 5 or 6 for halo-only or context-only people. Apply the canonical-reason precedence rule from section 3.4 after all candidates are collected.
8. If Bloodline-only is active, produce a narrowed presentation set containing biological/adoptive lineage members. Do not overwrite the saved perimeter.
9. Add temporary reveal paths to the presentation set for the current navigation session. Do not overwrite the saved perimeter or insight cohort.

### 3.6 Cousin calculation

Do not use generic graph-hop distance as cousin degree. Reuse or factor the existing `graph.js` biological/adoptive predicate, sibling classification and common-ancestor/cousin primitives; Family Perimeter must not create a second competing interpretation of lineage, half siblings, cousin degree or removed cousins.

For each candidate and anchor, use biological/adoptive parent-child paths to find a nearest qualifying common ancestor:

- `upA`: generations from the anchor to the common ancestor;
- `upB`: generations from the candidate to the common ancestor;
- cousin degree: `min(upA, upB) - 1`;
- removal: `abs(upA - upB)`.

Direct ancestors and descendants are always included.

The selected cousin degree includes removals:

- Close family includes 1st cousins at any removal.
- Extended family includes 1st and 2nd cousins at any removal.
- Wider family includes 1st, 2nd and 3rd cousins at any removal.

Where multiple routes exist, choose the closest valid relationship for inclusion and retain enough diagnostic information to explain the winning route. Cycles and corrupt edges must terminate safely and surface a diagnostic rather than hanging the application.

### 3.7 Bloodline-only interaction

Family Perimeter and Bloodline-only remain independent:

- Family Perimeter answers: “How wide is my everyday family?”
- Bloodline-only answers: “Temporarily show only biological and adoptive lineage.”

Bloodline-only:

- operates within the current perimeter;
- includes adoptive lineage;
- removes step-only, partner-only and context-only people from the current presentation;
- does not change the saved perimeter;
- does not change global search;
- restores the prior view when turned off.

Supporting copy should explicitly state:

> Bloodline view includes biological and adoptive family lines.

### 3.8 Search and temporary reveal

Search always queries the complete family index.

Every result may show:

- relationship to the viewer;
- inclusion state;
- a plain-language reason.

Example:

> John William Smith  
> Third cousin  
> Outside your current Family Perimeter

Selecting an outside result:

1. Finds the minimum understandable connection path from the nearest anchor.
2. Adds that path and the target’s local family unit to a temporary reveal set.
3. Animates or navigates to the target.
4. Leaves the saved perimeter unchanged.
5. Leaves perimeter-scoped insight totals unchanged.

The temporary reveal lasts until the member:

- chooses “Return to my perimeter”;
- changes primary view;
- starts another outside navigation; or
- ends the session, subject to later usability testing.

### 3.9 Boundary UI

Phase 1 uses honest, non-numeric boundary affordances:

- `More family beyond your perimeter`
- `Explore this branch`

Do not initially show `+247 relatives`. Exact counts are unsafe when:

- branches reconnect;
- a person has multiple parents or partners;
- pedigree collapse produces multiple paths;
- adoptive and biological routes overlap;
- one hidden component touches multiple visible boundary people.

Exact aggregate nodes may be added after the boundary-component algorithm can assign or deduplicate hidden people deterministically. A count must represent unique people and provide a stable result independent of traversal order.

### 3.10 Profiles and explanations

Outside-person profiles show:

> Outside your Family Perimeter

An information action should explain:

> This person remains part of the complete family tree. They are outside the everyday scope you selected in Your profile.

For support and debugging, an optional “Why am I seeing this person?” explanation can use `inclusionReasonById`:

- “Your partner’s second cousin.”
- “Partner of your first cousin.”
- “Parent of your cousin’s partner.”
- “Temporarily shown from Search.”

Never display an explanation the engine cannot substantiate from recorded relationships.

### 3.11 Future personal inclusions

Do not include exceptions in the first release.

If repeated research shows a need, add:

> Keep in my everyday tree

The bounded behaviour should be:

- include the selected person;
- include that person’s immediate-family halo;
- do not include their complete branch automatically;
- store the choice per user and family;
- show the inclusion on the person’s profile;
- manage all choices under `Your profile → Family Perimeter → Always included`.

Do not initially offer “include this entire branch”; branch ownership is ambiguous in a graph.

---

## 4. Trust and explainability contract

Trust is a release requirement, not copy polish after implementation.

### 4.1 Five promises visible in the product

1. **Complete:** “All 5,000 people remain in the complete family tree.”
2. **Personal:** “Your setting affects only your view.”
3. **Searchable:** “Search always covers the complete tree.”
4. **Non-destructive:** “Changing the perimeter never edits relationships or deletes people.”
5. **Transparent statistics:** “Every count says whether it covers your perimeter or the complete tree.”

### 4.2 Vocabulary

Use:

- Family Perimeter
- within your perimeter
- outside your perimeter
- complete family tree
- temporarily showing
- bring forward
- explore

Avoid:

- excluded
- irrelevant
- hidden family
- distant/less important person
- filtered out
- removed

### 4.3 Count labels

Never display an unlabeled count such as `742 family members` when the cohort could be ambiguous.

Use:

- `186 people within your Family Perimeter`
- `5,000 people in the complete family tree`
- `142 profiles within your perimeter have photos`

Where useful, show both:

> 186 in your perimeter · 5,000 in the complete tree

### 4.4 Insight cohorts

Every derived module declares one cohort:

| Cohort | Purpose |
|---|---|
| `personal` | Primary perimeter plus family halo; default for personal insights |
| `context` | Partner-context people; visible but normally excluded from personal aggregate statistics |
| `complete` | Administration, archive health, duplicates, export and explicitly complete-tree reporting |
| `directLine` | Viewer/current-partner direct ancestors and descendants |
| `temporaryReveal` | Navigation only; never silently changes saved totals |

Examples:

- Surnames, occupations, origins, longevity and AI narrative: `personal`.
- Direct ancestral span and lineage migration: `directLine`.
- Duplicate review and complete archive export: `complete`.
- Tree rendering: `personal + context + temporaryReveal`, bounded by rendering policy.

Each insight module must declare and test its cohort. It may not default to `graph.people`.

Enforcement is required, not merely a review convention: insight modules must be registered through one shared wrapper that requires an explicit cohort declaration, and a test must enumerate the registered modules and fail when any module lacks one. A module may receive a cohort iterator or ID set, but may not silently substitute the complete graph.

### 4.5 Data provenance

The perimeter engine uses recorded relationship type and qualifier only.

It must not:

- guess that an unqualified partner is current;
- infer adoption or stepfamily from names;
- treat shared surnames as proof of lineage;
- invent missing parent-child edges;
- convert ambiguous imports silently.

If relationship data is insufficient, include conservatively through the immediate-family/context layer or leave the person globally searchable. Diagnostics may flag ambiguous records for editors without changing them automatically.

---

## 5. Current architecture and 5,000-person gaps

The current application has already introduced useful large-tree protections:

- Pixi creates bubbles only for revealed people.
- “Show all” is capped at the nearest 250 people on large trees.
- Reveals are chunked.
- force-relationship scans are cached and Barnes–Hut is tuned.
- name labels are created lazily.
- List view is virtualized.
- graph reconstruction is memoized to people/relationship reference changes.

These changes reduce canvas crashes. They do not yet make the whole system a 5,000-person architecture.

Current scaling gaps:

1. D1 stores the complete graph core in one `family_tree.tree_json` row.
2. R2 stores rich extra data in one versioned object.
3. `GET /api/tree` eagerly loads and reassembles both halves.
4. The client parses and retains the entire rich logical tree.
5. the client builds complete graph adjacency and derived siblings synchronously.
6. The store writes the entire state to localStorage after commits.
7. The client sends and merges whole collections during synchronization.
8. Several traversals use array `shift()`, which becomes unnecessarily costly at scale.
9. Duplicate detection is derived eagerly from complete people and relationships.
10. Search builds viewer-relative categories across everyone.
11. Many insight modules scan all people or relationships and some perform nested graph work.
12. Full R2 extra and complete-tree serialization can exceed practical mobile memory and localStorage limits before reaching 5,000 rich profiles.

The existing `treeStore` core/R2-extra split is a production-tested foundation, not a greenfield design: it uses an explicit core allowlist, an `_extraVersion` pointer embedded in the D1 record, R2-before-D1 writes, round-trip verification and snapshot-first human-triggered migration. Keepsake editions also already use a separate R2 namespace. The single D1 core row and one monolithic R2 extra object are nevertheless unlikely to be a permanent 5,000-person representation: the core row retains its fixed 1 MiB limit and the server currently reassembles the whole extra before responding.

---

## 6. Target performance architecture

### 6.1 Separate topology, summary, detail and media

The client should no longer require one complete rich tree object before rendering.

Use four logical layers:

1. **Topology index**
   - person ID;
   - parent/child/partner edges;
   - relationship qualifiers and statuses;
   - authoritative family revision;
   - enough information to calculate perimeter and paths.

2. **Person summary index**
   - ID;
   - display name;
   - compact portrait reference;
   - living/deceased/minor/privacy state;
   - birth/death year or compact dates needed by search and layout;
   - normalized search fields where appropriate.

3. **Rich detail records**
   - biography;
   - full events;
   - occupation, residences, education, military details;
   - memories, documents, photos and Keepsakes metadata;
   - loaded for the current working set and on profile demand.

4. **Media objects**
   - existing R2 binaries and derived thumbnails;
   - never embedded in topology or summary payloads.

The server may expose topology and summary together if benchmarks prove the combined compressed payload is safe. Their persistence should still be chunkable and versioned.

### 6.2 Versioned chunked graph storage

Extend the existing core/R2-extra/manifest-pointer pattern unless Phase 0 measurements demonstrate a concrete reason to replace it. The existing `treeStore` write ordering, pointer ownership, failure behaviour, migration verification and recovery posture are required prior art, not optional inspiration.

The question is how to remove the permanent assumption that all core data fits one D1 JSON row and all detail fits one R2 extra object.

Recommended design:

- D1 `family_tree` remains the authoritative revision/pointer record.
- Versioned graph chunks live in R2 or normalized/chunk tables, selected after measurement.
- Chunks are deterministic and bounded by byte size, not an arbitrary person count.
- A manifest records:
  - schema version;
  - family revision;
  - chunk keys;
  - object hashes;
  - person and relationship counts;
  - summary index key;
  - rich-detail partition keys.
- Write all new immutable chunks first.
- Commit the D1 manifest pointer/revision last.
- Readers use only the version named by D1.
- Failed pre-commit writes are unreachable orphans and can be pruned.
- Snapshot/restore stores and restores the manifest pointer plus immutable version references.

Do not perform this storage migration until real 1,100-person byte measurements and generated 5,000-person fixtures establish:

- topology bytes per person;
- summary bytes per person;
- edge density;
- rich detail distribution;
- compression benefit;
- D1 versus R2 latency;
- typical and worst chunk counts.

### 6.3 Progressive API

Introduce versioned endpoints while preserving the legacy endpoint during migration:

- `GET /api/tree/bootstrap`
  - membership and role;
  - family metadata and revision;
  - viewer person ID;
  - topology and person summaries, possibly paged/chunked;
  - personal perimeter preference;
  - complete-tree counts.

- `GET /api/tree/people?ids=...`
  - rich person detail for a bounded ID set;
  - privacy/authorization applied server-side.

- `GET /api/tree/content?personId=...`
  - memories, photos, documents and Keepsake metadata required by a profile.

- `GET /api/tree/search-index`
  - compact complete-family search index, if not included in bootstrap.

- `PATCH /api/tree/records`
  - explicit record-level changes with base family revision or record version.

- `GET /api/tree/changes?since=...`
  - incremental changes and tombstones after a revision.

Endpoint names are provisional. The contract matters more than the spelling.

The old `GET/PUT /api/tree` remains available during compatibility rollout, then is retired only after all callers—including merge, invites, snapshots, calendar, admin and export—use the shared storage layer.

### 6.4 Client stores

Replace one monolithic persisted object with:

- `topologyStore`;
- `summaryStore`;
- `detailCache`;
- `contentCache`;
- `pendingMutationJournal`;
- `perspectiveStore`;
- `sessionRevealStore`.

Use IndexedDB for bounded, versioned offline caches. Do not depend on localStorage for multi-megabyte family data.

Keep localStorage only for tiny device preferences and migration markers.

The pending mutation journal must:

- record explicit operations;
- survive refresh/offline use;
- be idempotent;
- retain base record/revision information;
- clear only after server acknowledgement;
- never contain R2 media binaries;
- surface conflicts rather than silently overwriting newer data.

### 6.5 Background worker for graph and insight computation

Move expensive pure computations to a Web Worker:

- topology index construction;
- sibling derivation;
- Family Perimeter calculation;
- viewer-relative relationship labels;
- minimum paths;
- relationship categories;
- insight cohort preparation;
- selected aggregate insight calculations;
- duplicate candidate blocking.

The worker protocol should use:

- one family revision;
- compact serializable arrays or transferable typed structures where worthwhile;
- cancellation/version rejection so stale results cannot replace current state;
- performance marks;
- deterministic output.

Do not move Pixi itself into the first worker phase. Measure before considering OffscreenCanvas.

### 6.6 Shared Perspective Index

Build one pure module, tentatively:

`src/lib/perspectiveIndex.js`

Responsibilities:

- anchors;
- cousin degree;
- inclusion layers;
- inclusion explanations;
- insight cohorts;
- boundary edges;
- Bloodline-only projection;
- temporary path calculation;

Cache identity:

`familyRevision + viewerPersonId + perimeterLevel + currentPartnerSet + bloodlineOnly`

Personal-inclusion cache state is deliberately excluded until Phase 8 defines that feature's data model and invalidation semantics.

All product surfaces consume this output. No component may reimplement perimeter logic.

### 6.7 Search

Search operates over compact summaries for all 5,000 people.

Requirements:

- normalized token index built once per family revision;
- name, alternate/maiden names where recorded, key places and dates as explicitly supported;
- result virtualization;
- bounded result ranking;
- relationship labels resolved lazily for visible results or precomputed in the worker;
- perimeter status available without rich-detail fetch;
- rich profile fetched only after selection.

Do not run a full relationship-category calculation on every keystroke.

### 6.8 Duplicate detection

Remove eager complete-family duplicate detection from initial `App` render.

Use:

- cheap normalized-name blocking index;
- birth-year/relative evidence within blocks;
- worker or server-side calculation;
- run after idle, after import, or when Duplicate Review opens;
- cache by family revision;
- incremental invalidation for affected records.

The top-bar count may use a previously calculated result and show a neutral pending state rather than blocking startup.

### 6.9 Insights

Refactor each insight module to accept:

- graph/index access;
- an explicit cohort ID set or iterator;
- precomputed shared aggregates where appropriate.

Rules:

- no module silently scans `graph.people` when presented as personal;
- expensive modules compute only when their surface is opened or scheduled during idle;
- Home uses a small preselected set, not the full Insights suite;
- AI receives cohort-labelled aggregates only, never raw complete-family data;
- cache keys include family revision, viewer ID and perimeter setting;
- temporary reveals do not invalidate personal narrative caches.

### 6.10 Pixi tree

Maintain a bounded canvas working set.

Recommended budgets, subject to benchmark:

- default visible working set target: 80–150 people;
- soft warning/transition above 200;
- hard animated-canvas maximum: 250;
- complete population available through Search and virtualized List;
- portrait textures loaded only near the viewport or current path;
- release textures and Pixi objects when they leave the retained working set;
- labels created only for active, hovered and nearby bubbles;
- no full-tree force simulation;
- no requirement that “Everyone” means simultaneous canvas materialization.

When the perimeter contains more than the working-set budget:

- show the nearest meaningful region;
- present boundary exploration;
- keep List/Search complete;
- explain that the complete tree remains available.

### 6.11 Chart, List, Timeline and Places

- **Chart:** focal, progressively expanded pedigree; never lay out all 5,000 cards.
- **List:** virtualized complete-family view; filters and counts may be complete or perimeter-scoped but must be labelled.
- **Timeline:** query or calculate by cohort and date window; virtualize entries.
- **Places:** aggregate by explicit cohort; fetch/render map points in bounded clusters.
- **Activity:** page durable activity records; do not embed an ever-growing feed in the tree payload.

### 6.12 Synchronization

Move from complete-object reconciliation toward record/operation synchronization.

Requirements:

- family-wide monotonic revision;
- stable record IDs;
- per-record updated version/time;
- explicit tombstones with retention/compaction policy;
- optimistic concurrency;
- idempotency keys for mutations;
- server acknowledgement of applied operations;
- conflict UX for overlapping edits;
- R2-before-D1 pointer ordering for versioned objects;
- no stale client can round-trip an incomplete detail cache and erase server data.

This is a high-risk architecture stage and must have a written recovery runbook before production migration.

### 6.13 Complete archive and administrative access

Full archive export, administrator reporting and recovery always use the complete family dataset, independent of Family Perimeter.

The export worker must read the authoritative manifest/version and all chunks. A member’s perimeter must never alter archive contents.

Administrative statistics must distinguish:

- complete stored people;
- active members/users;
- optional aggregated perimeter adoption, without exposing individual preferences unnecessarily.

---

## 7. Performance budgets

Budgets should be measured on:

- a representative modern desktop;
- a mid-range mobile profile;
- iPhone/WebKit through the existing WebKit smoke path where feasible;
- warm and cold cache;
- simulated moderate network latency;
- 100, 500, 1,100 and 5,000-person fixtures.

Initial proposed acceptance budgets:

| Measure | 1,100 people | 5,000 people |
|---|---:|---:|
| App shell visible | ≤ 1.5 s | ≤ 1.5 s |
| Immediate family usable, warm cache | ≤ 1.5 s | ≤ 2.0 s |
| Immediate family usable, cold moderate network | ≤ 3.0 s | ≤ 4.0 s |
| Search index ready | ≤ 2.5 s | ≤ 4.0 s |
| Search response after index ready | ≤ 100 ms | ≤ 150 ms |
| Perimeter calculation in worker | ≤ 100 ms | ≤ 300 ms |
| Focus navigation response | ≤ 100 ms main-thread blocking | ≤ 100 ms main-thread blocking |
| Profile summary open | ≤ 150 ms | ≤ 200 ms |
| Rich profile detail, warm | ≤ 200 ms | ≤ 250 ms |
| Long task | no routine task > 100 ms | no routine task > 100 ms |
| Animated Pixi objects | ≤ 250 | ≤ 250 |
| Main-thread steady animation | target 55–60 fps | target 55–60 fps |
| Memory | no unbounded growth across 20 navigations | same |

These are starting budgets. Benchmark work may refine them, but changing a budget requires a recorded reason; it must not be relaxed merely to make a failing implementation pass.

The 5,000-person perimeter budget must be measured for the viewer plus four current-partner anchors as the standard multi-anchor case, and reported separately for an eight-anchor stress case. Bloodline must support every recorded current partner; this is a benchmark assumption, not a hidden product cap.

Payload budgets:

- Bootstrap topology + summaries should target less than 1.5 MB compressed at 5,000 people.
- Initial rich detail should contain only the visible working set.
- No individual JSON storage object should approach a platform hard ceiling.
- Chunk target should retain substantial headroom; choose after measurement.

---

## 8. Benchmark and observability plan

### 8.1 Synthetic fixtures

Create deterministic, privacy-safe generators for:

- 100 people;
- 500 people;
- 1,100 people;
- 5,000 people.

Each size needs variants:

- narrow/deep ancestry;
- wide cousin-heavy family;
- multiple current/former partners, including a four-current-partner standard case and an eight-anchor stress case;
- adoptive and step relationships;
- pedigree collapse/reconnected branches;
- rich profiles and documents metadata;
- sparse profiles;
- malformed cycle fixture for defensive termination.

Never derive fixtures from the production family.

### 8.2 Instrumentation

Development and opt-in aggregate telemetry should measure:

- bootstrap request duration and bytes;
- chunk count and cache hit;
- JSON parse duration;
- graph worker build duration;
- perimeter duration and cohort sizes;
- relationship-path duration;
- search-index build and query duration;
- duplicate detection duration;
- insight module duration;
- React commit duration where measurable;
- Pixi object/texture counts;
- first useful family view;
- long tasks;
- detail fetch count and bytes;
- mutation acknowledgement latency;
- IndexedDB read/write duration;
- memory trend in automated browser runs where supported.

Do not log:

- names;
- person IDs in third-party telemetry;
- family IDs in third-party telemetry;
- relationship paths;
- profile content;
- search terms;
- photos, documents or export URLs.

### 8.3 Performance gates

Add CI jobs that:

1. Generate fixtures.
2. Run pure algorithm benchmarks.
3. Run Chromium smoke tests at 1,100 and 5,000.
4. Run a focused WebKit large-tree smoke test.
5. Fail on functional regressions.
6. Report performance trends.

Initially warn rather than fail on timing variance until the runners are calibrated. Promote stable percentile thresholds to blocking checks.

---

## 9. Data model and API changes

### 9.1 Personal preference

Add a family-membership preference record rather than storing perimeter in:

- shared tree JSON;
- global user profile only;
- browser localStorage only.

Recommended schema:

```sql
CREATE TABLE family_member_preference (
  family_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  perimeter_level TEXT NOT NULL DEFAULT 'everyone',
  preference_version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (family_id, user_id),
  FOREIGN KEY (family_id, user_id)
    REFERENCES family_member(family_id, user_id)
);
```

Allowed levels:

- `first`
- `second`
- `third`
- `everyone`

The API validates values server-side. Future personal inclusions should use a separate table rather than overloading one JSON preference field.

### 9.2 Preference endpoint

Preferred:

- include preference in authenticated bootstrap;
- update through a scoped membership-preference endpoint;
- authorize that a user can update only their own preference;
- return the canonical saved value;
- audit the setting change without recording relationship details.

### 9.3 Storage evolution

Before implementing chunked storage, produce an Architecture Decision Record that starts from the existing `treeStore` core/R2-extra/manifest-pointer implementation and compares:

1. Extending the existing R2 extra plus D1 manifest pointer into immutable topology/summary chunks at per-collection or per-person granularity.
2. Replacing it with normalized D1 person and relationship tables plus R2 rich detail.
3. Replacing it with a hybrid of normalized/indexed D1 summaries plus R2 chunked full records.

Evaluate:

- atomicity;
- D1 row and query limits;
- read latency;
- incremental update cost;
- snapshot/restore complexity;
- export complexity;
- search;
- admin aggregates;
- migration and rollback;
- operating cost at 5,000 people.

Do not select a design solely because it requires the fewest initial code changes.

---

## 10. Delivery sequence

Each numbered item should normally be its own reviewable PR or a very small related set. The programme may use one umbrella issue/spec, but not one implementation PR.

### Phase 0 — Baseline and specification lock

Deliver:

- this reviewed brief;
- current 1,100-person measurements;
- deterministic fixtures through 5,000;
- benchmark harness;
- relationship semantics decision table;
- plain-language examples approved by product owner;
- inventory of all complete-tree consumers;
- initial storage-size report;
- a read-only statement of whether the motivating production family is on the migrated core/R2-extra path, recorded without collecting or logging family content; if production diagnostics are not authorized, record that status as unknown.

Exit criteria:

- timings and bytes are measured, not estimated;
- synthetic 5,000 fixture passes data-integrity validation;
- no production data used;
- perimeter examples have expected results recorded.

### Phase 1 — Low-risk performance relief

Deliver:

- queue-index BFS implementations instead of `shift()`;
- lazy/idle duplicate detection;
- worker-ready pure graph functions;
- cached search normalization;
- insight computation only when needed;
- Pixi texture/object lifecycle audit and fixes;
- instrumentation around current pipeline;
- protection against unnecessary full-state serialization where safely possible.

Exit criteria:

- no user-facing perimeter yet;
- current behaviour unchanged;
- 1,100-person benchmark materially improves or identifies the true dominant cost;
- no sync/data integrity regression.

### Phase 2 — Pure Perspective Index

Deliver:

- `perspectiveIndex` pure implementation;
- biological/adoptive cousin calculation;
- reuse or extraction of the existing `graph.js` lineage and cousin primitives;
- two equal current-partner anchors;
- one family halo;
- one partner context ring;
- Bloodline-only projection;
- temporary reveal paths;
- explainable inclusion reasons;
- canonical reason precedence and stable tie-break tests;
- worker execution;
- exhaustive fixtures and property tests.

Exit criteria:

- deterministic independent of input order;
- no infinite traversal on cycles;
- biological and adoptive examples match;
- step/partner propagation stops exactly where specified;
- 5,000-person calculation meets worker budget;
- no shared data mutation.

### Phase 3 — Per-user persistence and profile UI

Deliver:

- migration;
- read/update endpoint;
- Profile setting;
- unclaimed-person handling;
- existing-user `everyone` migration;
- new-user recommendation;
- accessibility and responsive validation;
- audit event.

Exit criteria:

- one user’s setting cannot change another’s;
- preference works across devices;
- failure falls back safely and visibly;
- setting changes no tree records.

### Phase 4 — Tree perimeter experience

Deliver:

- perimeter-based initial working set;
- bounded canvas policy;
- boundary exploration without numeric counts;
- return-to-perimeter action;
- Bloodline-only interaction;
- List/Chart consistency;
- reduced-motion behaviour;
- performance and accessibility tests.

Exit criteria:

- complete tree remains available;
- canvas never exceeds the agreed hard maximum;
- no sudden disappearance is presented as deletion;
- changing perimeter is smooth but not blocking;
- 5,000-person test remains usable.

### Phase 5 — Global Search and temporary reveal

Deliver:

- complete summary search index;
- virtualized results;
- perimeter badges;
- minimum-path temporary reveal;
- temporary target profile;
- reset/return behaviour;
- rich detail on demand.

Exit criteria:

- every fixture person is searchable;
- selecting an outside person does not change preference;
- no permanent insight-count change;
- relationship explanation is grounded.

### Phase 6 — Cohort-aware Home and Insights

Deliver:

- explicit cohort contract for every module;
- registered-module enforcement and a test enumerating every insight module's declared cohort;
- perimeter-scoped personal aggregates;
- direct-line modules;
- complete-tree administrative modules;
- labelled totals;
- AI aggregate cohort metadata;
- cache invalidation by revision/viewer/perimeter;
- Timeline and Places adaptations.

Exit criteria:

- no ambiguous counts;
- context-only populated branch cannot dominate personal results;
- Everyone reproduces complete-tree results;
- temporary reveal does not alter saved narrative/statistics;
- modules never silently default to all people.

### Phase 7 — Progressive data architecture

Deliver:

- approved ADR;
- versioned bootstrap/detail APIs;
- chunked or normalized topology/summary persistence;
- IndexedDB caches;
- mutation journal;
- incremental change feed;
- compatibility adapter;
- snapshot, merge, invite, calendar, admin and export integration;
- migration tooling;
- rollback runbook.

Exit criteria:

- cold 5,000-person budgets met;
- edit does not upload/rewrite complete archive;
- stale clients cannot erase unloaded detail;
- complete archive round-trip remains lossless;
- migration can be halted and rolled back safely;
- old and new readers cannot corrupt one another.
- populated IndexedDB cache passes the WebKit path; unavailable, private-browsing, quota-failure and evicted-cache conditions degrade safely without silent loss of a pending mutation.

### Phase 8 — Exact collapsed components and personal inclusions

Only after usage and graph correctness are proven:

- exact unique hidden-component counts;
- aggregate boundary nodes;
- personal “Keep in my everyday tree”;
- preference management;
- explanation and removal.

Exit criteria:

- no double counts on reconnected graphs;
- counts independent of traversal order;
- exceptions remain personal;
- no recursive explosion.

### Phase 9 — Rollout

Use feature flags:

- internal synthetic families;
- selected test family;
- staff/owner opt-in;
- small percentage;
- general availability.

At every gate compare:

- errors;
- latency;
- long tasks;
- mutation conflicts;
- storage failures;
- support feedback;
- perimeter cohort sizes;
- search success;
- rollback readiness.

Do not use the owner’s normal production tree as the first mutation test.

---

## 11. Verification matrix

### 11.1 Relationship cases

Tests must cover:

- viewer alone;
- current partner with separate ancestry;
- four current partners plus an eight-anchor stress case;
- former partner with shared children;
- former partner without children;
- biological child;
- adopted child and adopted descendants;
- stepchild and stepchild’s other parent;
- full, half and step siblings;
- first/second/third cousins;
- cousins at removals;
- cousin’s partner;
- cousin’s partner’s parents, siblings and children;
- multiple marriages;
- two paths to one person;
- pedigree collapse;
- same person qualifying through viewer and partner;
- missing qualifier;
- missing current/former partner status;
- disconnected people;
- corrupt cycle.

For every case, assert:

- primary/halo/context/outside classification;
- plain-language reason;
- Bloodline-only result;
- Search availability;
- temporary path;
- insight cohort membership.

### 11.2 Security and privacy

Assert:

- server authorization remains authoritative;
- perimeter never grants access;
- private/summary visibility rules still apply;
- viewer cannot update another member’s preference;
- unloaded private detail cannot leak through search summaries;
- logs and telemetry contain no family content;
- exports ignore perimeter and remain owner/co-admin gated.

### 11.3 Data integrity

Assert:

- changing perimeter produces zero tree mutations;
- progressive load cannot be saved back as a partial tree;
- snapshots restore all chunks/detail;
- merge/import preserves relationships;
- archive export includes everyone and all details;
- stale clients cannot resurrect tombstoned records;
- R2 failure fails clearly rather than returning a silently partial editable tree.

### 11.4 UX and accessibility

Test:

- 320 px mobile;
- common iPhone WebKit viewport;
- tablet;
- desktop;
- keyboard;
- screen reader labels;
- reduced motion;
- low memory/reload;
- offline cached view;
- slow detail fetch;
- setting save failure;
- outside-person search flow;
- return to perimeter.

---

## 12. Risks and mitigations

### Risk: perimeter behaves unpredictably

Mitigation:

- one pure shared engine;
- deterministic tests;
- stored inclusion reasons;
- no component-specific logic.

### Risk: partner anchoring creates a very large personal cohort

Mitigation:

- union results but retain bounded canvas working set;
- show cohort counts before/after setting changes;
- benchmark multi-anchor cases, including the four-anchor standard budget and eight-anchor stress fixture;
- keep context people out of personal aggregate insights.

### Risk: stepfamily feels demoted

Mitigation:

- include stepfamily in family halo;
- use respectful product language;
- distinguish lineage propagation from belonging;
- make Bloodline-only optional and explicitly inclusive of adoption.

### Risk: progressive loading causes data loss

Mitigation:

- never PUT a partial logical tree;
- explicit mutation operations;
- versioned server authority;
- mutation journal;
- compatibility tests;
- rollback runbook.

### Risk: infrastructure programme delays the user-facing feature

Mitigation:

- release perimeter engine and bounded rendering against current storage first;
- do not claim 5,000-person cold-load readiness until progressive architecture ships;
- keep phases independently useful.

### Risk: exact hidden counts are wrong

Mitigation:

- no numeric boundary nodes in first release;
- add only after component deduplication tests.

### Risk: insights still become skewed

Mitigation:

- explicit cohort parameter required by API/module signature;
- labelled totals;
- tests using an intentionally huge distant/context branch.

---

## 13. Required design and architecture decisions before coding

Product owner must approve:

1. Current partners are equal anchors.
2. Former partners are not automatically equal anchors.
3. Biological and adoptive relationships propagate lineage identically.
4. Step relationships belong in the family halo but do not propagate cousin degree.
5. Partner-context parents, siblings and children are visible but non-recursive.
6. Personal insights normally exclude context-only people.
7. Existing users default to Everyone.
8. New users are recommended Extended family.
9. Removed cousins are included by cousin degree.
10. First release uses non-numeric boundary exploration.
11. Personal inclusions are deferred.

Engineering must approve through an ADR:

1. topology/summary persistence;
2. chunk size and version manifest;
3. progressive endpoint contracts;
4. IndexedDB caching;
5. mutation protocol;
6. snapshot/restore;
7. migration and rollback;
8. 5,000-person budgets.

---

## 14. Definition of complete

This programme is complete when:

1. A member can understand and set their Family Perimeter.
2. Current partners receive equal anchor treatment.
3. Adoptive lineage behaves like biological lineage.
4. Step and partner families remain visible without recursive expansion.
5. Search reliably reaches any of 5,000 people.
6. Outside navigation is temporary and clearly explained.
7. Every statistic declares its scope.
8. A distant well-populated branch cannot silently dominate personal insights.
9. A 5,000-person family meets the agreed cold/warm performance budgets on Chromium and WebKit test profiles.
10. Ordinary edits no longer require rewriting the complete family archive.
11. Full archive export, snapshots and recovery remain complete and lossless.
12. No perimeter action changes shared family records or authorization.
13. Production rollout has a tested rollback path.

---

## 15. Recommended immediate next action

Do not begin with UI implementation.

The next PR should be documentation and measurement only:

1. Add this brief to `docs/`.
2. Add the deterministic 100/500/1,100/5,000 fixture generator.
3. Add current-pipeline performance marks and a benchmark report.
4. Record actual topology, summary and rich-detail sizes.
5. Have Claude review the proposal against current code, tests, Cloudflare constraints and all complete-tree callers.
6. Resolve the product and ADR decisions in section 13.

Then implement Phase 1 and Phase 2 as separate, reviewable changes.

# Bloodline — project memory

A family-tree PWA where **the visualization and the feeling are the product**.
The thesis (from the V2 brief): _the tree is navigation, the profile is the
destination, the stories are the product._ Modern, clean, "wow-factor" UX.
Live at **myfamilybloodline.com** (Cloudflare Pages, GitHub-connected).

## How to work here

- **Branch:** develop on `claude/bloodline-family-tree-p1ly95`. Never push elsewhere without permission.
- **Commit footer:** end messages with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` and the
  `Claude-Session:` line. Do NOT put the model id anywhere in the repo.
- **Don't open a PR unless asked.** Commit + push to the branch.
- **Model identity:** this agent is `claude-opus-4-8` (chat only — never in artifacts).

### Run / verify (no human can see the screen — self-verify with screenshots)
- Dev server: `npm run dev` (run in background; picks the first free port, usually 5173).
- Build check: `npm run build`.
- Headless smoke + screenshots: `BASE_URL=http://localhost:<port>/ node tests/smoke.mjs`
  - Uses pre-installed Playwright/Chromium via project-local `playwright-core`.
  - **Quirk:** ad-hoc Playwright scripts must live IN the project dir (e.g. `tests/_foo.mjs`),
    not `/tmp`, or they resolve the wrong Chromium build and fail.
  - Screenshots land in `tests/screenshots/` (gitignored) — Read them to eyeball the look.
- **Sandbox blocks external images** (randomuser.me, pravatar.cc, etc.): demo faces/photos
  render blank in headless but load on the live site (faces are proxied same-origin via
  `functions/faces`). To verify layout of an `<img>`, measure its `boundingBox()` instead.

## Status — what's built

- **Phase 1 ✅:** rich profile destination (hero, kin-to-viewer, tags, About, key-life-events
  timeline, grouped relationships, completeness meter), expanded person records
  (`occupation`, `residence`, `tags[]`, `events[]`), graph scaling.
- **Layout / fill-the-screen:** camera frames the **bounding box of the visible family**
  (biased ~⅓ toward the active person), zoom fills the safe area. Tall generation bands
  (`GEN_GAP=400`) + gentle charge (`-560`) so the shape matches a tall phone; `MAX_ZOOM=1.5`.
- **Phase 2 🟡:** Memories (upvotable, contributable), Timeline (editable), Photos gallery
  (lightbox, caption, set-as-portrait, delete, 1800px downscale), Onboarding (cinematic intro,
  questionnaire, setupTree), Privacy schema (visibility field, bubble treatments, profile
  enforcement). **Remaining:** Documents + Voice & Video (need R2 storage).
- **Tree lines:** merged co-parent lines from the couple band; 2+ siblings share a
  stem→junction→branches trunk (junction at 72 % toward children). Toggle in Legend.
  Divorced co-parents get a V-junction. Name label visible on every bubble.
- **Store fixes:** portrait photos preserved across server-sync reloads; localStorage quota
  errors surfaced as a toast; `addRelationship()` links existing people; bio-parent
  constraints (at most 1 bio mother + 1 bio father per person).
- **Military profile fields + medals are now manually editable/removable** (real user report:
  a document accepted onto the wrong person left branch/rank/service-number/medals stuck —
  there's no live link from an accepted fact back to its source document, so reassigning or
  deleting the document afterward does nothing to what it already wrote). `EditPersonSheet`
  gained a Military section (branch pill-pick, served-with/rank/service-number text fields,
  clear buttons, a read-only "Military" row group in the profile view) — the same generic
  `updatePerson` pass-through everything else in that form already uses, no new plumbing.
  `store.js` gained `removeMedal(personId, index)` (medals carry no id, so this is index-based
  like the timeline editor's own row removal); `MilitaryService.jsx` shows a per-medal "×" with
  the same are-you-sure confirm the document-quote dismiss already used. This is a manual fix,
  not automatic retraction — accepting a document fact still writes plain data with no
  `sourceDocId`, so a future real fix would tag accepted facts with their source document and
  let deleting that document offer to clean up what it produced.

- **The Keepsake ✅ Phases 0–5** (spec: `docs/KEEPSAKE.md`): the marquee endgame feature —
  a regenerating magazine-style illustrated biography per person. Data layer
  (`src/lib/keepsake.js`, 13 spreads, constellation layout, facts hash), full-screen reader
  (`src/components/Keepsake/`), AI narrative engine (`functions/api/keepsake.js`, editions in
  R2 `keepsake/{familyId}/{personId}/`, never tree_json), scroll-driven motion
  (reduced-motion safe), browser-native print (`@page`, full-bleed cover, body.ks-has-print
  scope), home-hub nudge card + `keepsake_generated` activity. Per-section narrative
  editing (PUT /api/keepsake, quiet pencils, one edit sheet). **Page-turn reader is the
  default** and is now a TYPESET magazine: `lib/typeset.js` (blocksOf → offscreen measure →
  paginate; pure, unit-tested) composes fixed canonical pages — print folio 780×1040
  (desktop/tablet), pocket folio 360×640 (phones) — **no page ever scrolls**; overflow
  becomes the next page. KeepsakeBook scales the sheet down to fit (never up) via
  `.ks-scale`; BookPage.jsx renders the `.ks-pg` design system (running heads, folios,
  Fraunces serif body, drop caps, ghost roman chapter numerals, quote wells, full-bleed
  album hero, DARK constellation night page, magazine cover: fitted stacked name +
  masthead + credit block + cover line + grain). The strip-canvas page curl + SVG
  foreignObject snapshot pipeline (pageCurl/) was DELETED — an SVG data-URI document
  can't fetch external resources, so photos blanked and fonts fell back mid-curl; both
  layouts now share the live-DOM leaf turn (shine, cast shadow, velocity-scaled inertia).
  The scroll reader (`ks_reader_mode` toggle) is now KeepsakePager.jsx — the SAME typeset
  pages as a vertical pager, one page per screen, `scroll-snap mandatory` + `snap-stop
  always` (a swipe always lands exactly one page), soft rise-and-settle on arrival; only
  the print pipeline still uses the old spreads.jsx components. Finish pass: fake CSS
  page-curl overlays + hard gloss band DELETED (a fake fold pasted over a photo always
  reads as a sticker); rest splash is now a photographed object — warm-stone backdrop
  (noise grain + vignette), drifting dappled foliage light (.ks-dapple, soft-light,
  scene-wide), tight contact shadow (.ks-contact) under the sheet, near-square 4-6px
  print corners, and the open-me invitation is the sheet itself gently breathing at the
  spine (.ks-sheet--breathe). Edit pencils hide on the rest splash and are hover-revealed
  on pointer devices. Wide desktop (≥1140px) reads as a true verso/recto spread. Phase 6
  (whole-family bound edition, print-service handoff) deliberately later.

- **Tree storage rewrite** (plan: `docs/TREE-STORAGE.md`) — fixing the D1 1MiB-per-row
  ceiling for good, not just buying headroom. Target: core (people/relationships, a
  deliberately narrow per-person allowlist) stays in D1; everything rich or growing
  per-item (bios/tags/life-events/military fields, memories, photos, documents, activity)
  moves to R2, which has no comparable ceiling — chosen over a second D1 row because that
  only doubles the wall, and this account's own growth (1000+ people, heavy documents)
  would likely hit it again on a similar timescale. **Phase 0 ✅**: `/api/debug/tree` byte
  breakdown + core/extra person-field split; `documents[].thumb` (a permanent inline
  base64 preview, unlike `src`) now uploads to R2 at creation and via `migrateDocThumbsToR2`;
  snapshot-write failures now distinguish benign "not migrated yet" from genuine failures,
  folded into the admin size-warning email. **Phase 1 ✅**: `functions/_lib/treeStore.js`
  (`loadTree`/`upsertTreeStatement`/`casUpdateTree`/`insertOnlyTree`/`updateTree`/
  `snapshotStatements`) — a pure, zero-behavior-change refactor consolidating 7 of the 9
  places that touched `family_tree` directly (`tree.js`, `merge.js`, `_lib/invite.js`, both
  calendar endpoints, `debug/tree.js`, the snapshot-restore endpoint); `admin/stats.js` and
  the snapshot list endpoint deliberately untouched (see doc §5). **Phase 2 🟡 in progress**:
  `splitTree`/`reassembleTree` (pure, round-trip tested) + `loadFullTree`/`putExtra`/
  `writeExtraToR2`/`pruneExtraVersions` (the R2-backed layer, dual-read via a `_extraVersion`
  marker embedded in D1's own core JSON — no separate pointer file) are done and wired into
  `functions/api/tree.js`'s GET/PUT: a legacy family is untouched (never touches R2); a
  migrated family's GET reassembles core+R2 transparently, its PUT re-splits once and writes
  R2-before-D1 with the size ceiling measured against core alone. A migrated family's extra
  failing to read fails the request clean (503), never silently degrades. The snapshot-restore
  endpoint (`tree/snapshots/[id].js`) shares that same fail-clean rule via a new
  `resolveTreeFromRaw` helper (extracted from `loadFullTree`), and writes the restore back in
  whichever mode the family *currently* is — never decided by the snapshot's own vintage.
  `admin/stats.js`'s content totals and largest-trees size report are now reassembly-aware too
  (a migrated family's photos/memories/documents are summed via R2, its true size via a cheap
  `head()` call) — one documented gap remains, the largest-trees *ranking* is still by D1 core
  bytes only. `merge.js` (duplicate-family merge wizard) and `_lib/invite.js` (member_joined
  activity-append) — the last two of the original 9 touch points — turned out to have a REAL
  bug once audited: both wrote raw `tree_json` directly, which for a migrated family would have
  silently orphaned its R2 extra (data loss) the first time anyone accepted an invite or ran the
  merge wizard against one. Fixed to the same loadFullTree-read / splitTree+putExtra-write
  pattern as everywhere else. Both calendar endpoints and `debug/tree.js` were audited too and
  are safe as-is (read-only, core-fields-only). The one-time per-family migration script now
  exists: `POST /api/admin/migrate-tree` (admin-gated, one `familyId` per call, idempotent,
  verifies `reassembleTree(splitTree(tree))` deep-equals the original **before any write**,
  archives a snapshot, R2-before-D1). **Nothing auto-migrates a family** — this endpoint is the
  only place that happens, and only when a human calls it. **All Phase 2 code is done, tested,
  and pushed.** The only thing left is the staged rollout itself, and it needs real Cloudflare
  credentials (`wrangler login`, a deployed build, an authenticated admin session) that don't
  exist in an agent sandbox — a step-by-step runbook for a human to follow lives in
  `docs/TREE-STORAGE.md` §11 (backup → deploy → one disposable test family → this account,
  deliberately → everyone else in small batches).
  Full design + progress tracked in `docs/TREE-STORAGE.md` §9.

## Architecture / key files

- `src/App.jsx` — orchestration. `activeId` + `expanded` Set (additive reveal);
  `visibleIds` = expanded ∪ neighbours. Modal/overlay state lives here.
- `src/data/store.js` — localStorage store (`useSyncExternalStore`), shape
  `{ people, relationships, memories, photos }`. Actions: addRelative, updatePerson, setPhoto,
  addMemory/toggleMemoryVote/removeMemory, addPhoto/setPhotoCaption/removePhoto. **Migrations
  are additive & non-destructive** (seed only for people who still exist; never clobber edits).
- `src/data/seed.js` — Davies demo family (deliberately messy: divorce, remarriage, step,
  adopted, widowed, deceased). `memories`, `photos` seeds. `DEFAULT_FOCUS='james'`.
- `src/data/graph.js` — builds adjacency; siblings DERIVED (shared parents), never stored.
  `relationLabel`, `distancesFrom`.
- `src/viz/BubbleTree.jsx` — PixiJS v8 + d3-force. Ego camera (Spring), additive reveal,
  zoom-to-fit framing, mount-once + `sync(graph)` reconciliation. Constants at top
  (BASE_RADIUS, GEN_GAP, ORGANIC_CHARGE, SPREAD_X, MAX_ZOOM). Passes `mergeParents` to drawLinks.
- `src/viz/links.js` — all the lines. Couple "pods" + parent links + the merge/trunk logic.
- `src/viz/bubble.js` — Bubble class (monogram silhouette, photo load for data: and URL, rings).
- `src/components/` — PersonSheet (the profile), Lightbox, MemorySheet, TimelineEditor,
  AddRelativeSheet, EditPersonSheet, PhotoCropper, Legend (holds the merge toggle), TopBar,
  FocusNameplate, Splash, AccessibleTree.
- `src/lib/` — profile.js (completeness + lifeEvents), image.js (`fileToDataUrl`), dates.js,
  spring.js, color.js.
- `functions/` — Cloudflare Pages Functions: `faces/[g]/[n].js` (same-origin face proxy for
  WebGL CORS), `api/tree.js`, `api/auth/{request,verify}.js` (magic links, server-side only).
- `tests/smoke.mjs` — headless boot + interactions (canvas, profile, memories, gallery,
  lightbox, re-centre, drag). Keep it green.

## Hard constraints (from the original brief)

- Anthropic API key **server-side only** (Workers), never in the client.
- **Magic-link auth only**, no passwords. No data sale, no ad tracking; living
  people / children stay private.
- iOS dark mode: **hardcoded hex**, `color-scheme: light only` (see `theme.css`).
- Stack: React + Vite PWA, PixiJS/WebGL + d3-force, Cloudflare Pages/Workers/D1/R2,
  Resend magic links, Anthropic server-side.

## Full build plan

The complete phased plan — all six phases, every profile section, the new views
(Lineage / Timeline / Story), the six AI features, collaboration/roles, engagement
loops, design direction — lives in **`docs/BUILD-PLAN.md`** (annotated with
done/partial/not-started). Read it before planning a new sprint.

## Open thread / likely next steps

- **Phase 2 remaining:** Documents (letters, certificates, military records) + Voice & Video —
  both need R2 storage. Create R2 bucket, update wrangler.toml, build upload Worker endpoint,
  then build the Documents UI (list + lightbox) and Voice & Video player.
- **Phase 3 AI sprint:** Biography Generator → Interview Generator → Smart Onboarding.
  Requires wiring first server-side Worker + Anthropic key. Model plan in `docs/BUILD-PLAN.md`.
- **Phase 4 Collaboration:** in-app invite flow, role enforcement in UI, claimed profiles,
  activity feed. D1 schema ready; bindings need to be uncommented in `wrangler.toml`.
- **Phase 5 Views:** Lineage mode visual treatment (button + pathBetween exist; full fade +
  accent pass ⬜), Timeline mode, Story mode.
- **Phase 6 Output:** Family Historian AI, Smart Search, legacy books, PDF exports.

## Cloudflare notes

- D1 created + migrated (id `96e94723-103f-4c4f-a1b0-797810e7dfc9`); DB binding active in `wrangler.toml`.
- R2 bucket `bloodline-docs` ✅ live (EU jurisdiction). Bound via `wrangler.toml` `[[r2_buckets]]`
  with `jurisdiction = "eu"` — Pages uses wrangler.toml for bindings when the file is present, so
  the dashboard binding UI is read-only. `migratePhotosToR2()` runs on login and upgrades any
  remaining data: URL photos to R2 URLs. `/api/photos/health` (no auth) confirms R2 is reachable.

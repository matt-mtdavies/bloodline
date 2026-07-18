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
  the same are-you-sure confirm the document-quote dismiss already used.
- **Document-fact provenance + cascade retraction (the root-cause fix for the above)**: every
  document-derived write is now tagged with the document that produced it, so deleting the
  document retracts exactly what it wrote instead of leaving it stuck forever. `addLifeEvent`/
  `addMedal` (`store.js`) accept an optional `sourceDocId` stamped onto the event/medal item;
  a separate `person.field_sources` map (`{ fieldName: docId }`) tracks scalar profile fields
  a document last wrote (occupation, birth_place, residence, the military_* fields,
  cause_of_death — see `DOC_TRACKABLE_FIELDS` in `App.jsx`). `App.jsx`'s `applyDocumentFact`/
  `applyDocumentMedal`/`applyDocumentField` all tag provenance on accept; `handleSave` (the
  ordinary manual edit form) clears a field's `field_sources` entry the instant a human retypes
  it by hand, so a later document deletion can never clobber a real correction. `store.js`
  gained `retractDocumentContributions(personId, docId)` — filters out tagged events/medals and
  clears any fields still attributed to that document — wired into `onRemoveDocument` in
  `App.jsx` so deleting a document now cleans up after itself. Deliberately scoped to one
  person and deliberately does NOT cascade into relationships a document confirmed (those have
  their own separate confirm step; auto-severing a family link as a side effect of a document
  delete is a bigger, cross-person consequence than clearing a field). `PersonSheet.jsx`'s
  document-delete confirm now previews the blast radius ("Remove this document — and the 3
  facts it added to this profile?") via `documentContributionCount`. Also closed 3 confirm-step
  gaps found auditing "every deletion needs a confirm step": `EnrichSheet.jsx`'s document- and
  relationship-finding dismiss, and `DocViewer`'s fact/field dismiss, all previously fired
  immediately — now use the same inline confirm-swap pattern as everywhere else. Covered by
  4 new unit tests in `tests/store.test.mjs` and verified live against a seeded document via a
  temporary debug hook (confirm copy + resulting store state + Military section correctly
  disappearing once its last field/medal is retracted).

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

- **Custom grandparent names** (user feedback: "can I change Grandmother/Grandfather to
  Nonno/Nonna, Oma/Opa, etc?"). `src/lib/kinTerms.js` — a small `useSyncExternalStore` pref
  store (same convention as `store.js`) holding `{ paternalPackId, maternalPackId,
  customPaternal, customMaternal }`, localStorage-backed and **per-viewer, not tree data** —
  two people in the same family can each see their own term for the same grandparent, and
  it's never synced to the server. Six built-in packs (English formal/informal, Italian,
  German, Spanish, French) plus a Custom pack with free-text male/female terms.
  Side-aware, not just a single swap: `resolveGrandparentTerm(kinTerms, side, gender)` picks
  the paternal or maternal pack independently, so a paternal-Italian/maternal-German family
  can run both at once — `side` is exactly `graph.js`'s existing `parentSide()` output
  ('Paternal'/'Maternal'/null), already computed for the "Paternal Grandmother" style labels.
  `relationLabel`/`buildRelationCrumbs` (`graph.js`) take an optional trailing `kinTerms` arg,
  applied ONLY at the direct-grandparent branch — deliberately not threaded into Step-/
  Adoptive-/Great-/cousin-degree wording, which doesn't have a clean cultural-pack equivalent
  and isn't the emotionally-loaded part; omitted, every label is byte-identical to before, so
  no existing call site or test needed to change. The side prefix still shows with a custom
  term ("Paternal Nonna") since it's genuinely useful and swapping the noun shouldn't silently
  drop it. Wired into every relation-label call site (PersonSheet's kin-to-viewer badge and
  its Grandparents/Grandchildren extended groups, HoverCard, AccessibleTree, FlightCaption,
  LineageBanner) via the `useKinTerms()` hook; BubbleTree's Focus-mode canvas captions read it
  imperatively via `kinTermsStore.getState()` since that whole render loop is mount-once/
  non-React, with a store subscription clearing its relationship-label cache on change.
  Settings UI lives in `UserProfile.jsx` (a new "Grandparent names" section, two side pickers
  + custom text fields) — deliberately NOT gated behind the `/api/user/profile` round trip
  the rest of that sheet uses, since this is pure localStorage. Covered by 10 unit tests
  (`tests/kinTerms.test.mjs`) and verified live via a temporary debug hook that fakes a
  logged-in session (UserProfile is login-gated and this sandbox has no backend) — confirmed
  the settings UI renders and saves correctly, and that switching packs immediately updates
  the real PersonSheet's "Grandparents" group to "Paternal Nonno / Paternal Nonna / Maternal
  Opa / Maternal Oma".

- **Search now matches middle names** (user report: "old names commonly use the middle as
  the preferred name"). `middle_name` was already a real, separately-edited person field
  (`EditPersonSheet.jsx`, woven into `lib/profile.js`'s `fullName()` for the profile heading)
  but had never been wired into `SearchOverlay.jsx`'s matching at all — searching "James" for
  someone whose `display_name` is "Robert Mercer" and `middle_name` is "James" found nothing.
  Extracted the whole scoring/ranking pass out of the component into `src/lib/search.js`
  (`scoreText`, `rankPeopleByName`) — pure and unit-tested (`tests/search.test.mjs`), same
  refactor motivation as the rest of the codebase's `lib/*.js` split. `rankPeopleByName` now
  scores `display_name`, `birth_name`/`maiden_name`, AND `middle_name` and takes the max, so a
  middle-name match ranks exactly like any other name match (an exact display-name match still
  outranks a middle-name substring hit). Matched people carry `_middleName` back to the
  component, which shows a "· middle name {name}" hint under the result — same
  `search-result__nee` styling and same "show it whenever present and not already visible in
  display_name, regardless of which field actually matched" convention the existing birth-name
  "née" hint already used, so the fix reads as consistent rather than a bolted-on special case.

- **"Saving…" no longer flashes on every single app open** (real user feedback: "do we actually
  need to see the spinning wheel every time you open Bloodline... it looks like a loading icon
  so I wait till it's done before doing anything"). Root cause: `loadFromServer()`'s merge step
  unconditionally re-PUT the reconciled tree back to the server after every load —
  `if (state.people?.length > 0) scheduleServerSave(merged)` — regardless of whether the merge
  actually produced anything the server didn't already have. For an actively multi-edited
  family that's nearly always a no-op round trip that still flashes the pill. `store.js` gained
  `hasUnsyncedContent(merged, serverData)` — compares every field capable of carrying genuine
  local-only content (people, relationships, memories, photos, documents, activity, tombstones,
  familyName, hasCompletedOnboarding) and only reports "needs saving" on a proven difference;
  any doubt (an unexpected shape, a thrown comparison) fails safe to "save it", matching the old
  behaviour — this only ever SKIPS a save on an exact, verified match, never the reverse.
  Deliberately excludes two fields that would otherwise defeat the whole check: `_seq` (bumped
  independently by the server on every save — carries no user content, would never match) and
  `myPersonId` (NOT shared content — re-resolved fresh, identically, per viewer on every load
  from their own login identity; two different family members always resolve it to two
  different values by design, so comparing it would make the check pass to nearly nothing in a
  multi-editor family while losing no real data by skipping it). Given the data-integrity
  stakes, covered unusually thoroughly: 14 unit tests on `hasUnsyncedContent` itself (one per
  content field, both exclusions, and a fail-safe-on-malformed-input case) plus 2 true
  integration tests that mock the network and count real PUT calls through the actual
  `loadFromServer` merge pipeline (`tests/sync-nosave.test.mjs`), on top of the full existing
  suite passing unchanged. Paired with a visual fix for when a save genuinely does happen: the
  topbar's "Saving" pill swapped its generic `.pill-spinner` CSS ring for `Logo.jsx`'s existing
  `loading` variant (the three-bubble family mark breathing, already built for the splash screen
  "so the wait has a bit of the same 'family, connected' idea... rather than a generic
  spinner" — just never reused here) — so on the rare occasion it does show, it reads as the
  app quietly doing something, not a system loading cue asking you to wait.

- **Insight spotlight (`IdleFactHint`, the ambient "did you know" hint while idle-browsing the
  tree): more variety, and panning no longer dismisses it** (user feedback: "they are great and
  we need more of them with lots of variety" + "if you scroll when [it] is showing, it removes
  [it] — it should keep it there for the required X secs"). Two independent fixes:
  1. **Variety**: `computeInsightModules` (`lib/insightModules.js`) always computed 13 modules,
     but the candidate-sentence builder only ever turned 8 of them into "did you know" text —
     `handshakes`, `strata`, `fullestYear`, `brood`, and `serviceRecords` were computed and then
     silently discarded. That builder is now `highlightCandidates(modules)`, exported and shared
     by both consumers, with all 13 wired up (`pickDailyHighlight` — the home hub's one stable
     pick per day — is now a thin wrapper around it, unchanged in behavior). `IdleFactHint` no
     longer takes one pre-picked string; it takes the whole pool and — backed by a
     `sessionStorage` set of already-shown sentences (generalizing the old single boolean flag)
     — cycles through a different, not-yet-seen fact each time it re-arms, for the rest of the
     browsing session, rather than showing exactly one fact ever.
  2. **Scroll/pan dismiss bug**: the dismiss listener was a bare `window.addEventListener
     ('pointerdown', hide, { once: true })` — the same pointerdown that *starts* a pan/drag/pinch
     gesture on the canvas bubbles up to window before Pixi's own gesture code ever determines
     it's not a tap, so the very first touch of any interaction (not just a deliberate dismiss)
     hid the hint mid-sentence. Now tracks pointerdown position and only dismisses on pointerup
     if the movement was under `TAP_SLOP_PX` (8px) — a real tap-to-dismiss still works instantly,
     but panning/zooming past the hint no longer cuts short the `VISIBLE_MS` (11s) it's owed.
     `IntroHint.jsx` (the separate, one-shot "tap a face" onboarding nudge) was deliberately left
     alone — the report was specifically about the fact-based spotlights, and dismissing the
     moment you touch the tree at all is arguably correct for that one.
  Verified live end-to-end (idle → fact appears → simulated pan gesture → still showing the same
  fact → auto-hides at the full 11s → re-arms with a genuinely different second fact → a real
  no-movement tap dismisses instantly) and with 10 new unit tests covering every new candidate
  template plus the with/without-viewer split (`tests/insightModules.test.mjs`).

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

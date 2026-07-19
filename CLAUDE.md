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

- **Fixed: clicking during the search flyover animation locked up the whole canvas** (real user
  report: "if someone clicks while it is in progress, the screen pauses and locks up... to get
  out of it, you need to search again and let it play out"). Root cause was an asymmetric guard
  in `BubbleTree.jsx`'s `endGesture` tap router: the `'bubble'`-tap branch already checked `if
  (!drag.moved && flight)` and ignored the tap mid-flyover, but the sibling `'pan' && !drag.moved`
  branch — which handles every tap that lands on empty canvas, or on a bubble too zoomed-out to
  drag (see `BUBBLE_DRAG_MIN_ZOOM`; the flyover deliberately zooms out to a wide "drone" travel
  view, so this is the likely path for almost any mid-flight tap) — had no such guard, and fell
  through to `deselect()`/`activate()`/`openPerson()`. Those call `state.enterFree()`/
  `enterFollow()`, which flip `camMode` away from `'flight'` without ever clearing the `flight`
  variable itself — freezing the camera mid-glide (the ticker's flight-driving block only runs
  under `camMode === 'flight'`), permanently blocking all further bubble taps (the `'bubble'`
  branch's own guard now saw a stale, undying `flight`), and skipping `onLand()` forever (so
  `flightCaption.landed` never flips true and the Done button never renders) — exactly the
  reported "screen pauses, can't click anybody, no Done pill" lockup, escapable only by starting
  a fresh search (which unconditionally resets both `flightCaption` and `flight`/`camMode`).
  Fixed by adding the identical `flight` guard to the `'pan'` branch, so a tap during a flyover
  is ignored everywhere, not just on bubbles, letting the flight land naturally. Also fixed a
  related, non-locking gap: a genuine drag/pinch that interrupts a flyover already correctly
  cleared `flight` and handed the camera back (no freeze), but never called `onLand()`, leaving
  the `FlightCaption` card stuck showing an in-progress crumb-trail with no Done button. Added a
  new `onAbort` callback on the `flight` object (parallel to `onSegment`/`onLand`), fired at
  every place `flight` is discarded without a natural landing — the pinch-start interrupt, the
  real-pan-drag interrupt, and the render ticker's own try/catch error-recovery block — wired in
  `App.jsx`'s `flyToSearchResult` to `setFlightCaption(null)`, so an abandoned journey clears the
  caption instead of being left in limbo. Verified live via two dedicated Playwright
  reproductions against the real dev server: one taps empty canvas mid-flyover and confirms the
  flight still lands (Done button appears) and the canvas stays responsive afterward (a second
  tap opens a profile); the other performs a real drag mid-flyover and confirms the caption
  clears instead of sticking. Both scripts, plus the full unit suite, `npm run build`, and the
  standard smoke test, passed clean before shipping.

- **Fixed: the "possible duplicates" count pill and the review sheet disagreed, and dismissing
  a pair never updated the pill** (real user report: "the 'review 1 possible duplicate' pill is
  seen, though when i click on it, there are none... I also just saw three to review. there were
  only 2. i dismissed them but now it still says three to review"). Root cause: two completely
  separate computations of "how many duplicates exist," with no shared source of truth. The
  topbar's pill (`TopBar.jsx`'s `StatsPopover`) read `duplicatePairs.length` from `App.jsx`,
  which called `findDuplicatePairs(data.people, data.relationships)` raw — every candidate the
  heuristic still detects, with zero awareness of anything ever dismissed. `DuplicatesSheet.jsx`,
  meanwhile, kept its OWN dismissed-pairs set (`bl_dup_dismissed` in localStorage, loaded into its
  own local `useState`) and filtered its displayed list through that — correctly hiding dismissed
  pairs, and correctly showing "tree looks tidy" once none were left, but never telling `App.jsx`
  it had done so. That explains both halves of the report: pairs dismissed in an earlier session
  were still counted by the pill (App's memo never consulted `bl_dup_dismissed` at all) while the
  sheet correctly hid them ("pill says 1, sheet says none"); and dismissing in the sheet only
  mutated the sheet's own local state + localStorage, never `data.people`/`data.relationships` —
  the pill's only memo dependencies — so it never recomputed ("dismissed 2 of 3, pill still says
  3"). Fixed by making dismissal-tracking the one shared thing both sides read: the
  `bl_dup_dismissed` load/save helpers moved from `DuplicatesSheet.jsx` into `lib/duplicates.js`
  (`loadDismissedDuplicates`/`saveDismissedDuplicates`, alongside the existing `pairKey`) so
  there's exactly one implementation. `App.jsx` now owns the dismissed set as real state
  (`dismissedDuplicates`, seeded from localStorage on mount) and filters `duplicatePairs` through
  it before `.length` is computed for the pill — the same filter the sheet used to apply alone —
  and exposes `dismissDuplicatePair(key)`, which updates that state (triggering an immediate
  pill recompute) and persists to localStorage. `DuplicatesSheet.jsx` no longer tracks dismissal
  at all: it receives `pairs` already filtered by the caller and an `onDismiss` callback, so the
  "Not a duplicate" button and the post-merge auto-dismiss (the dropped id would otherwise leave
  a stale pair) both just call the prop — one list, one count, always in agreement, in both
  directions. Verified live via a dedicated Playwright script (seeded two synthetic duplicate
  pairs via `addInitScript`, since demo mode seeds fresh in-memory state and never touches
  localStorage until a mutation commits): pill and sheet agreed on count before touching anything
  (2 and 2), dismissing one via "Not a duplicate" dropped the sheet to 1 AND the pill to 1 in the
  same render pass, and a full page reload (a fresh "session") still showed 1 — the dismissal had
  genuinely persisted, not just changed in-memory. Full unit suite and `npm run build` passed
  clean; the standard smoke test passed with zero console errors.

- **Redesigned the Keepsake edition banner** (real user reaction to a screenshot: "That
  notification button is disgraceful. Design and make that button gorgeous and on brand" — the
  small compile/weave-in/error bar at the top of the reader, previously a flat white pill with
  plain sans-serif text and a bare bold-orange text link, reading as a generic OS toast rather
  than part of the Keepsake object). `KeepsakeView.jsx`'s `.ks-banner` is now a small mastheaded
  card that borrows the cover's own typographic language (`docs/KEEPSAKE.md`'s "constellation of
  Bloodline design decisions" — Fraunces serif italic, uppercase letter-spaced kicker flanked by
  the cover masthead's ◆ diamond glyphs, terracotta accents, subtle paper grain) instead of
  looking like a system notification: a circular icon badge (quill / sparkle / alert / spinner,
  one new small inline SVG per state, matching the existing `BookModeIcon`/`PrintIcon` style
  already in the file) sits beside an uppercase kicker ("First edition" / "New chapters" /
  "Trouble compiling" / "Compiling") and the original note sentence set in serif italic below
  it; the CTA is now a genuine full-width terracotta-gradient pill button with a warm drop shadow
  (`Compile the first edition` / `Weave in the changes` / `Try again`) rather than a bare text
  link — no copy changed beyond the new kicker labels, only the visual treatment. The error state
  deliberately desaturates the badge/kicker to a muted ink-gray rather than reaching for a red
  the rest of the palette doesn't have (see `theme.css` — deliberately no error/red token, only
  terracotta/sage/memorial-violet) — restrained rather than alarming, and the CTA button stays the
  same terracotta as every other state so "try again" doesn't read as a different, scarier action.
  A narrow-viewport CSS override that used to fight the old row layout (stacking the note above
  the button once it got squeezed on phones) is gone — the new layout is column-stacked by
  default, so the override was dead weight once the redesign made it unconditional. Verified live
  via Playwright against all four states (mocking `/api/keepsake`'s GET/POST responses, since
  plain `npm run dev` has no Cloudflare Pages Functions to actually compile against): screenshots
  of "First edition" (quill badge, terracotta), "New chapters" (sparkle badge), "Trouble
  compiling" (alert badge, desaturated kicker, CTA still terracotta), and "Compiling…" (spinning
  ring badge, no button) all confirmed against `docs/KEEPSAKE.md`'s stated design language.
  `prefers-reduced-motion: reduce` freezes the new spinner alongside the file's other motion
  overrides. Keepsake unit + API test suites and `npm run build` passed clean; the standard smoke
  test passed with zero console errors.

- **Desktop "just start typing" search** (feature request, discussed and agreed before building:
  "on PC, in the tree view, if you just start typing on the keyboard, it should automatically
  open the search bar and search" — a Gmail/Linear/Notion-style shortcut). A global `keydown`
  listener in `App.jsx`, placed right after `anyOverlayOpen`'s own declaration (the file's one
  consolidated "is anything already showing" flag — the same one gating the hover card and
  `IdleFactHint`), opens `SearchOverlay` the instant a bare printable key is pressed with nothing
  else open and nothing already focused: `e.ctrlKey || e.metaKey || e.altKey` bails out (every
  browser/OS shortcut — copy, reload, tab-switch — passes through completely untouched), a
  non-printable or multi-char `e.key` (arrows, Enter, Escape, function keys) bails out, and
  `document.activeElement` must be the plain body or the canvas itself (typing into any real
  input/textarea elsewhere, in any sheet, is never hijacked). `SearchOverlay.jsx` gained an
  `initialQuery` prop — seeded once into its `query` state on the mount this shortcut triggers
  (every other open path, the search icon and the lineage banner's search button, passes nothing
  and starts blank as before), with the caret explicitly placed after the seeded text so the very
  next keystroke extends it rather than landing at position 0. **Found and fixed one real bug
  along the way**: the same triggering keydown's native default action (inserting the character)
  was firing a SECOND time into the just-focused search input once it existed in the DOM — every
  typed-to-open search opened seeded with the letter doubled ("r" → "rr") — fixed with a single
  `e.preventDefault()` once the shortcut decides to act. **Also fixed a related latent gap**
  spotted while reading `anyOverlayOpen`'s own definition: `keepsakeId` (the full-screen Keepsake
  reader) was missing from that consolidated flag — exactly the class of bug its own comment
  warns about ("every new sheet added over time needs to be remembered... it only takes missing
  one") — added it, which also correctly quiets the hover card/idle-fact-hint/recap-nudge/
  home-nudge that flag already gates whenever a Keepsake is open, not just this new shortcut.
  Deliberately reuses the existing, already-polished `SearchOverlay` sheet rather than building
  new UI — the ask was for this to feel "beautiful and elegant," and the most elegant answer was
  one more door into a component that already animates in cleanly and needed no visual changes at
  all. Verified live via Playwright: typing with nothing focused opens the sheet pre-seeded with
  the typed letter (and confirmed NOT doubled, post-fix); continuing to type extends the query
  and returns live results; Escape closes it; Ctrl+A does NOT open search (confirmed the native
  select-all still fires untouched); typing while a person's profile sheet is open does NOT
  hijack; and a direct DOM-level probe (a real focused `<input>`) confirms a focused field always
  wins regardless of which sheet it lives in. Full unit suite, `npm run build`, and the standard
  smoke test all passed clean.

- **Marriage/separation captured at creation time, plus a visible chip label** (feature request,
  discussed and agreed before building: "adding this info on creation of partner profile —
  'Married?' tick box, date... on creation of an ex-partner, 'were you married?', date, and year
  separated... there is a married component of the partner piece in relationships, but it's not
  obvious"). Confirmed the complaint against the actual code first: `is_married`/`marriage_date`/
  `marriage_place` already existed, but only reachable by opening a profile → finding the
  partner's relationship chip → tapping the "⋮" manage-relationship button — three taps into a
  menu most people would never discover, and the chip itself gave no visible hint the fields
  existed or were already filled in. Three changes, agreed incrementally:
  1. **Creation-time capture**: `AddRelativeSheet.jsx` gained the same "They married" checkbox +
     date field already used there for birthplace/residence/deceased (a deliberate exception —
     see the file's own header comment — to the "everything else lives in the edit form"
     philosophy, extended to marriage for the same reason). For a new ex-partner specifically, an
     independent "Year separated" field is offered too — independent of the married checkbox,
     since a relationship can end whether or not it was ever a marriage. Deliberately scoped to
     the "new person" flow only, not "link an existing person as a partner" (a fundamentally
     different picker UI where cramming in marriage fields would be a bigger change than asked).
  2. **A new `separation_date` field**, which didn't exist before at all (only marriage fields
     did) — threaded through `store.js` end to end: `partnerEdge()` now takes an optional
     marriage-meta object stamped straight onto the edge at creation (`addRelative` builds it from
     the new `is_married`/`marriage_date`/`marriage_place`/`separation_date` params and passes it
     through `edgesFor`), and `updatePartnerMeta()` (the existing later-edit path) now persists
     `separation_date` too, independent of `is_married` exactly as at creation. `graph.js`'s
     `partners()` projection carries the new field through alongside the existing three so
     nothing downstream needs a separate store lookup.
  3. **The buried edit menu is now visible, not moved** — deliberately kept the actual editing UI
     in the existing "⋮" manage-relationship menu (already the one place relationship metadata
     gets edited, alongside the Biological/Step/Adopted qualifier for parent-child edges) rather
     than fragmenting it across three locations, but the relationship chip itself now shows a
     " · Married {year}" / " · Separated {year}" sub-label whenever those fields are set — visible
     at a glance without opening anything, reusing `lib/dates.js`'s existing `yearOf` helper.
     `MarriageDetailsEditor` (the menu's own editor) gained the matching "Separated" field for
     ex-partners, save-in-one-click alongside the existing marriage fields.
  Covered by 6 new unit tests in `tests/store.test.mjs` (creation-time stamping for a married
  partner, a married-and-separated ex-partner, a never-married-but-separated ex-partner, a plain
  partner with no marriage fields at all, and `updatePartnerMeta` persisting/clearing a
  separation date). Verified live end-to-end via Playwright: added a new married partner and
  confirmed "Married 2010" on the chip; added a new ex-partner with both a marriage and
  separation year and confirmed both appeared on the chip; opened the "⋮" menu and confirmed it
  correctly reflected the just-created state (checkbox checked, both dates populated, the new
  "Separated" field present only for the ex-partner); edited the separation year through the menu
  and confirmed the chip updated to match. Also incidentally confirmed against the seed data
  itself — an existing partner (Megan Mercer, married 2016) already showed the new chip label
  correctly, with no migration needed since the fields were always additive. Full unit suite,
  `npm run build`, and the standard smoke test all passed clean.

- **Keepsake pill retitled, and the first compile now needs a minimally-filled profile**
  (feedback, agreed before building: rename the entry pill "Their Keepsake" → "Keepsake" — it
  reads oddly on your own profile, since you're not "they" to yourself — and gate "Compile the
  first edition" behind a completeness threshold, since a book compiled from a bare name and
  birth year undersells the whole feature). `PersonSheet.jsx`'s `.ks-entry` pill is the one-word
  fix. The gate reuses infrastructure rather than inventing new: `lib/profile.js`'s existing
  `profileCompleteness()` score (the same one driving the profile's own completeness meter) is
  computed for the Keepsake's subject in `KeepsakeView.jsx`, gated at a forgiving
  `MIN_COMPLETENESS_FOR_FIRST_EDITION = 40` — enough to rule out a stub, not so strict it blocks
  a decent profile missing a couple of minor fields — mirroring `lib/military.js`'s
  `canGenerateMilitaryStory()`, an existing "is there enough raw material" gate on that other
  AI-narrative feature. Deliberately scoped to the FIRST compile only: `!edition &&
  !readyForFirstEdition` is a new, distinct banner state ("Almost there", desaturated like the
  error state, no CTA button) that sits alongside — and never touches — the existing `stale`
  branch, so an edition that already exists stays freely updatable via "Weave in the changes"
  regardless of the current score; nobody's existing book gets locked mid-edit by a score dip.
  The not-ready note reuses the completeness meter's own copy convention verbatim ("Add
  {missing.slice(0,2).join(', ').toLowerCase()}…") instead of inventing new phrasing, so it reads
  as a nudge with a concrete next step, not an unexplained wall. Verified live via Playwright
  against three seeded profiles: a richly-filled person (89% — "First edition" state, CTA
  present), a bare-stub person with only a name and one relationship (11% — "Almost there", no
  CTA, correct missing-fields note), and that same stub person WITH an existing edition already
  compiled (confirmed the gate does not apply — "New chapters" / "Weave in the changes" renders
  normally regardless of the low score). Full unit suite, `npm run build`, and the standard
  smoke test all passed clean.

- **Creator attribution + duplicate-merge safety** (real user report: "Is there a way to trace
  who created which profile? ... there are currently 2 Peter Johnstons, possible duplicates. If
  there has been a mistake made, it would be good to know who added them and why... I accidently
  merged Ashley last week and it caused some confusion — because it merged, I couldn't tell whos
  kids belonged to who easily. Maybe in the review duplicates, there be a pill for 'show both in
  tree' before you can merge?"). Investigated first: `person.created_by` turned out to be dead
  data — always a hardcoded literal (`'me'`/`'familysearch'`/`'import'`), never read back
  anywhere — but the activity log's `person_added` event already carries a REAL author
  (`authorEmail`/`authorName`), it just wasn't surfaced on the profile itself. `DuplicatesSheet`
  separately had zero relationship context on its candidate cards and zero confirm step —
  Merge fired on the very first tap, exactly matching the accidental-merge report. Four fixes:
  1. **Added-by line**: `PersonSheet.jsx` finds that person's `person_added` activity event and
     renders "Added by {name} · {when}" under the hero location line, reusing `ActivityFeed.jsx`'s
     `dayLabel` and its `nameByEmail` re-resolution convention — the author's CURRENT
     `display_name` is looked up fresh from `graph.people` by matching the event's stored
     `authorEmail`, rather than trusting the name string frozen at add-time, so a later name
     correction (or the stale-guessed name a first-touch account sometimes gets) is reflected
     correctly here too.
  2. **Relationship preview on duplicate cards**: `DuplicatesSheet.jsx`'s `relNames()` helper
     lists first names (capped at 3) of each candidate's parents/children/partners directly on
     the card — the actual gap that caused the reported confusion ("couldn't tell whose kids
     belonged to who"); a bare count wouldn't have prevented that, seeing "Children: Alice" vs
     "Children: Bob" on the two cards would have.
  3. **Confirm step before merge commits**: a new `confirmKey` state swaps the action row for a
     `.dups__confirm` block stating exactly what moves ("This moves {dropped}'s N relationships
     (parents, children, partners) onto {kept}'s and can't be easily undone") with Merge/Cancel —
     mirrors the existing `confirmUnlinkId` remove-relationship pattern already used elsewhere in
     `PersonSheet.jsx` rather than inventing new interaction UI.
  4. **"Show both in tree"**: a new button on each pair calls `App.jsx`'s
     `showDuplicatePairInTree(aId, bId)` — closes the duplicates sheet, adds both candidate ids to
     the `expanded` set (guaranteeing both bubbles render even if unconnected, which is often
     exactly why true duplicates go undetected), activates the first, switches to bubble view if
     needed (same view-switch-and-poll-for-`viewApi`-readiness pattern as the existing
     `flyToPersonFromAnywhere`), then calls `viewApi.current.refocus(0.6)` — re-clustering every
     currently-visible node into a tight circle around the active node at a fixed zoom, so both
     candidates end up visually adjacent regardless of their real tree position. Chosen over
     `spotlightTour` (built for RecapTour's slower sequential narrative, not simultaneous
     comparison) and a path-based flight (duplicate candidates are frequently NOT connected by any
     path — that disconnection is often exactly why they were never merged or noticed as the same
     person). Verified live via Playwright against a seeded family with two duplicate pairs (one
     with divergent children per candidate, one left unmerged): the added-by line correctly
     re-resolved a deliberately stale stored author name to the current one; the relationship
     preview correctly distinguished the two candidates' children; clicking Merge showed the
     confirm block without merging, Cancel reverted cleanly, and confirming actually committed the
     merge (pair count dropped by exactly one); "Show both in tree" on the remaining pair closed
     the sheet and navigated the camera to the candidates. Full unit suite, `npm run build`, and
     the standard smoke test all passed clean.

- **List view row action: "view in chart" next to "view in tree"** (feature request: "next to
  [the circle to view in tree], should be a chart option?"). Discussed first — the user's
  follow-up idea was to collapse both into one icon behind a popover menu to reduce clutter; I
  recommended against it (two destinations don't justify a menu's extra tap, worse discoverability,
  and real added complexity positioning a popover inside `AccessibleTree.jsx`'s virtualized
  directory rows) and suggested hover-reveal on desktop instead if density was the actual concern.
  User asked for the original two-icon version, unchanged on both mobile and desktop (no
  hover-reveal). `AccessibleTree.jsx` gained a second per-row circle, `.person-row__chart`, next to
  the existing `.person-row__map` tree circle, in both places that circle already appeared (the
  focused person's immediate-family group rows and the virtualized full directory rows) — its icon
  is the same `ChartModeIcon` glyph as the topbar's own Tree/Chart/List switcher (rectangular cards
  on rows, not TreeIcon's circles-and-branches), so the pair reads as "same family of action,
  different destination." Wired through a new `onShowInChart` prop to a new `App.jsx` callback,
  `showPersonInChart` — deliberately simpler than the existing `flyToPersonFromAnywhere` (the tree
  circle's handler): `ChartTree` re-roots itself off `activeId` via its own effect, so there's no
  canvas-mount polling needed, just `setView('bubbles')` + `setLayout('chart')` +
  `setBloodlineOnly(true)` (matching the topbar's own chart-switch default) + `activateNormal`.
  **Found and fixed a related, pre-existing latent bug while verifying**: `flyToPersonFromAnywhere`
  never reset `layout` back to `'organic'` — if `layout` was left on `'chart'` from an earlier
  switch, clicking the ORIGINAL "view in tree" circle silently did nothing (it polled for
  `viewApi.current`, which never populates because `BubbleTree` doesn't mount under chart layout,
  so the poll just timed out after ~1.5s with no visible failure). This bug already existed before
  this feature — reachable via topbar Chart → List → tree circle — but the new chart circle makes
  it trivial to trigger (list → chart circle → back to list → tree circle), so it would have made
  the just-shipped feature look broken. Fixed by also forcing `setLayout('organic')` whenever
  `flyToPersonFromAnywhere` needs to switch canvases; every call site (this row action, the
  profile's own "Show in tree", the "back to me" locate pill) already means "fly to them in the
  organic tree," so the fix is correct for all of them, not just this one. Verified live via
  Playwright: clicking the new chart circle switches to the pedigree chart re-rooted on exactly the
  clicked person (confirmed via the focal card's own name); clicking the tree circle afterward
  correctly lands back on the organic canvas (confirmed via `canvas` presence and the absence of
  `.chart-tree` — this assertion caught the latent bug above before the fix, and passed clean
  after). Full unit suite, `npm run build`, and the standard smoke test all passed clean.

- **`IdleFactHint` rewrite: fixed a real double-schedule bug, made "idle" genuine, added a
  cooldown** (real user report: "the insight pops up... are too much... popping up every 3-4
  seconds and scrolling through mid pop up. it looks odd"). Two real bugs, not a perception issue.
  1. The old arm effect's dependency array included `visible` but never guarded against
     rescheduling while a fact was already showing — and since `IDLE_MS` (8s) was shorter than
     `VISIBLE_MS` (11s), every single hint silently swapped its own text for a different fact
     partway through its own display window, with no re-entrance animation (same DOM node) — this
     is what "scrolling through mid pop-up" actually was.
  2. Despite the name and the file's own comment ("waits out a long settled pause"), the idle
     timer was armed the instant browse mode was entered and never reset on real activity —
     panning/zooming/dragging never touched it — so it fired on a fixed clock regardless of
     whether the user was actively mid-scroll, not only once they'd genuinely stopped.
  `IdleFactHint.jsx` was rewritten: the arm effect now bails out early if a fact is already
  `visible` (kills bug 1 outright); the countdown is rearmed from scratch on every real
  `pointerdown`/`pointermove`/`wheel` (kills bug 2 — a continuously-panning session now never
  triggers it, only a genuine pause does); `IDLE_MS` raised to 14s of true stillness; and a new
  `COOLDOWN_MS` (20s), tracked in a ref (not state — it's only ever read inside the timer
  scheduling, so a render would be wasted) rather than a rescheduled fact, so one hint hiding can't
  immediately re-arm the next. Verified live via Playwright at the real timer scale (no mocked
  clock): 16s of continuous simulated pointer movement never showed a hint; stopping the movement
  produced one after ~13.5s (matching the new 14s wait); the SAME fact text was confirmed
  byte-identical 9s into its display (proving the swap bug is gone); it auto-hid at ~12s; and it
  stayed hidden through a further 15s (inside the 20s cooldown, confirming no immediate re-arm).
  Full unit suite (`insightModules.test.mjs` unaffected — the fix is purely in the consuming
  component's timing logic, not the underlying fact-selection code), `npm run build`, and the
  standard smoke test all passed clean.

- **Fixed List view row overflow on mobile Safari** (real user report, with a screenshot: some
  rows' right edge bled flush off the screen with no rounded corner or margin, right after the
  "view in chart" row action shipped — while other rows in the very same list looked fine). Could
  not reproduce in this sandbox's Chromium (every row measured well within the 390px viewport), but
  the screenshot was a real iPhone — WebKit is strict about a well-known flex/grid quirk that
  Chromium is more forgiving of: a flex or grid item's own minimum size defaults to `auto`, not
  `0`, at EVERY level of nesting, so a container's content can force it past its parent's box
  unless every level in the chain explicitly opts out with `min-width: 0`. `.person-row` (the
  card itself, a flex container for the avatar/text/two action circles) gained `min-width: 0` and
  a defensive `overflow: hidden` (a safety clamp so a row visually can never bleed past its own
  rounded rectangle regardless of any remaining shrink miscalculation — box-shadow is unaffected,
  since `overflow: hidden` only clips a box's content, not its own shadow). The `<li>` grid items
  in both `.listview__group` and `.listview__directory`'s `<ul>` (themselves `display: grid`)
  gained the same `min-width: 0`, since grid items have the identical default-`auto` behavior as
  flex items. Verified the fix doesn't regress the demo tree (row bounding boxes measured
  identically before and after, all comfortably inside the viewport) via Playwright; the real
  WebKit-only failure mode isn't reproducible in this sandbox's Chromium, so this is a
  spec-conformant, standard fix for the documented bug class rather than a locally-reproduced
  regression test. Full unit suite, `npm run build`, and the standard smoke test all passed clean.

- **Custom grandparent names extended to Great-grandparents and beyond** (real user report: "it
  has not changed the Great-Oma?? still says great-grandma"). The original feature deliberately
  scoped the custom-term swap to the direct-grandparent branch only (see `kinTerms.js`'s own
  header comment at the time) — in hindsight too conservative, since "Great-" is just a prefix on
  the same term, not a different cultural concept the packs don't cover. `kinTerms.js` gained
  `resolveAncestorTerm(kinTerms, side, gender, greats)` — reuses `resolveGrandparentTerm` under
  the hood and prepends `'Great-' + 'great-'.repeat(greats - 1)`, the same stacking convention
  `graph.js`'s own plain-English `ascendingTerm()` already used for "Great-great-grandparent" —
  but, unlike that plain-English path, never lowercases the resolved term before appending it:
  these packs store proper address terms ("Oma", "Nonna"), not common nouns continuing an English
  compound word, and the direct-grandparent branch already treated them the same way ("Paternal
  Nonna" — the noun is never touched). Wired into two places in `relationLabel`: the specific
  great-grandparent block (now calls `resolveAncestorTerm(kinTerms, parentSide(p), gender, 1)`,
  preserving that block's existing no-side-prefix shape) and the general N-generations-up fallback
  used for great-great-grandparent and beyond (preserving ITS existing side-prefix shape) — each
  path keeps its own pre-existing structure, only the terminal word changes. Deliberately still
  NOT threaded into descendant-direction terms (great-grandchildren aren't addressed BY a
  grandparent-style term, so there's nothing to swap) or step/adoptive great-grandparents (no
  gender split to swap, same as step/adoptive direct grandparents already). One disclosed,
  deliberate side effect: for anyone still on the untouched default English pack, a
  great-grandparent's label capitalization shifts slightly, from "Great-grandmother" (lowercase
  compound tail) to "Great-Grandmother" (the pack's own always-capitalized term) — the same
  trade-off already accepted for the direct-grandparent branch, now applied one level further
  back for internal consistency, rather than adding special-case logic to preserve an arguably
  arbitrary capitalization quirk. Covered by 7 new unit tests in `tests/kinTerms.test.mjs`
  (`resolveAncestorTerm`'s greats=0/1/2/3 stacking, a real `relationLabel` great-grandparent case
  swapping to "Great-Opa"/"Great-Oma", a great-great-grandparent case confirming the side prefix
  and further stacking, the no-kinTerms-passed byte-identical case, and step/adoptive
  great-grandparents staying untouched) and verified live via Playwright against the real seed
  data (`florence`, james's actual paternal great-grandmother) with a German pack set — confirmed
  the profile's kin-to-viewer badge resolves to "Great-Oma". Full unit suite (including the
  existing `relations.test.mjs` regression suite, unaffected), `npm run build`, and the standard
  smoke test all passed clean.

- **Redesigned the topbar "Saving" indicator: the logo IS the indicator now, not a second icon
  beside it** (real user feedback on a screenshot: "it still looks odd having the two" — the
  earlier fix had swapped the saving pill's generic spinner for the Logo mark's own `loading`
  breathe, but that left TWO instances of the same three-bubble mark sitting side by side in the
  topbar, the real brand logo and the pill's copy of it). Discussed the fix first: rather than
  overlaying a ring on the real logo (the user's own suggestion) or keeping a separate pill at
  all, `Logo.jsx` already had exactly the two states this needed built in — `idle` (the
  permanent barely-there topbar drift) and `loading` (the more pronounced breathe, previously
  only used on the splash screen and the now-removed pill) — so the fix is to make the ONE
  persistent brand-mark instance in `.topbar__brand` switch between them live:
  `loading={syncStatus === 'saving'}` / `idle={syncStatus !== 'saving'}`, `animate={false}` (a
  persistent header logo never needs its one-shot entrance pop replayed — the app's own splash
  screen already played that moment; `Home.jsx`'s equivalent small logo already sets `animate=
  {false}` for the same reason). `TopBar.jsx`'s separate `.pill--saving` and `.pill--saved`
  blocks (and the now-unused `SavedCheckIcon`) were deleted outright — no second icon ever
  appears, and per the user's own "perhaps no tick" instinct, there's deliberately no checkmark
  on completion either: the logo just eases from the loading breathe back to the quiet idle
  drift the instant `syncStatus` leaves `'saving'`, since a fresh burst of motion right as things
  go quiet would undercut the whole point of going quiet. Their matching dead CSS (`.pill--saving`,
  `.pill--saved`, `@keyframes saved-pop`) was removed too. Accessibility is preserved without a
  visible element: a new `.visually-hidden` `aria-live="polite"` span (reusing the existing
  utility class from `global.css`) announces "Saving…"/"Saved" to screen readers on the same
  transitions, decoupled from anything being visibly on screen. The error states
  (`error`/`error-auth`/`error-forbidden`/`error-toolarge`) were deliberately left exactly as
  they were — a real save failure needs its own noticeable, tappable retry control, not folded
  into a passive breathing logo where it could go unnoticed. Verified live via Playwright: since
  `?demo` mode never calls `enableServerSync()` (no real login, so there's no way to trigger a
  genuine save to test against), used a temporary `__debugSetSyncStatus` export on `store.js` to
  drive the transition directly, confirmed exactly one `.logo` element in the brand button at
  every stage, confirmed its classes correctly switch `logo--idle` → `logo--loading` → back to
  `logo--idle` (no checkmark pill ever appearing), confirmed the live region text tracks
  Saving…/Saved/empty, and confirmed zero `.pill--saving`/`.pill--saved` elements ever render —
  then reverted the temporary export before committing (confirmed via a clean `git diff` on
  `store.js`). Full unit suite, `npm run build`, and the standard smoke test all passed clean.

- **Unified "back to the tree" across every full-screen subpage, plus a new Time-mode exit
  pill** (design discussion: "do we need a way to quickly get back to the tree? What ideas do
  you have that look amazing?" — I pitched a concept board reusing the topbar's own breathing
  Logo mark everywhere instead of the ~15 bespoke close-button treatments scattered across the
  app; user: "Yes. Go for it."). Audited every full-screen destination first (a background
  research pass) and found a real constraint the pitch had to respect: `HowItWorks`/
  `FamilyTrees` deliberately close back to the **Home hub**, not the bare tree (they're nested
  one level under it — see the existing `App.jsx` comment "reached only from the hub, so their
  back button always returns there"), while `TreeInsights`/`FamilySettings`/`UserProfile`/
  `ActivityFeed`/`FamilyTimeline` (a bottom sheet, not to be confused with the unrelated inline
  Time-mode slider) all close straight to the tree. Scoped this to a **visual and interaction**
  unification, not a navigation change: every file's `onClose` still fires exactly whatever it
  already fired — only what the button looks like changed. New shared `ReturnMark.jsx` (a small
  button wrapping `Logo` with `idle` breathing, icon-only, no wordmark — every one of these
  pages already has its own title text beside it) replaces `.subpage__close` (a back-chevron
  circle), `.icon-btn` (a rounded-square close, used by three different sheets), and
  `.activity-panel__close` (a third circle variant) — three different existing visual languages,
  now one. `Home.jsx` itself needed no new component: its already-present but non-interactive
  `.home__brand` (Logo + "Bloodline" wordmark) became the actual clickable control, and the
  separate `.home__close` X beside it was deleted outright — "the mark is already here, it just
  needed to be tappable," exactly as pitched. Four sheet-style headers (`ti__head`/`fs__head`/
  `tl__head`/`activity-panel__header`) had their title+close order reversed (mark now leads,
  title follows) and `justify-content: space-between` swapped for a plain `gap`, since the old
  layout assumed the close button sat on the right. One disclosed simplification from the
  original pitch: the concept board's mockup described the Time-mode pill "fading in only after
  real wandering" (a few slider drags) before appearing — built as a fixed heuristic like that,
  it would have been unproven complexity for uncertain benefit; shipped instead as simply
  always-visible whenever `timeMode` is on, matching `LineageBanner`'s own existing behavior
  (which has no such delay either) rather than inventing a new standard just for this one pill.
  New `ReturnToTreePill.jsx` (mirroring `HomeToMe.jsx`'s two-phase mount/animate mechanics)
  fills a real, asymmetric gap the audit turned up: Lineage mode already had a working
  contextual exit (`LineageBanner`'s own "Done" button, wired through the existing
  `toggleLineage`), but Time mode had *only* the dock's clock icon — no equivalent banner at
  all. The pill sits at the same top-centre position `LineageBanner` already uses, carries the
  same breathing mark, and calls a new shared `exitTimeMode` callback (extracted so the dock
  button's own "tap a second time to leave" path and the new pill both leave Time mode
  identically, rather than duplicating the same three state-resets in two places). Deliberately
  did **not** touch `PersonSheet.jsx`, `Lightbox.jsx`, or any of the small in-context edit/confirm
  sheets (`EditPersonSheet`, `EnrichSheet`, `InviteSheet`, `GedcomImport`, `DuplicatesSheet`,
  `Legend`, ...) — those are contextual dialogs and forms bound to specific content, not
  full-screen destinations you navigate away to, and folding a generic brand mark into "Cancel"
  or "Done" on a form would blur what those controls actually do. Verified live via Playwright
  across all eight touched surfaces plus the new pill (each opened, confirmed exactly one
  `.return-mark`/no orphaned old close-button class, clicked, confirmed the correct destination —
  Home for the two nested subpages, the bare tree for the rest — landed); Time mode specifically
  confirmed the pill is absent before entering, appears the instant the dock's clock icon is
  tapped, and clicking it both hides the pill and turns Time mode off via the same dock button
  state. Full unit suite, `npm run build`, and the standard smoke test all passed clean.

- **Fixed: no way to undo marking a partner as "ex" + the existing-person picker never showed
  middle names** (real user report: "Cant change relationship back to partners from ex partners.
  i made a mistake and couldnt go back. had to remove relationship and re add. also, while
  re adding, already in tree does not show middle names. it should. sooooo many sampson
  chynoweth's. impossible to know which is which"). Two independent, unrelated bugs in the same
  report.
  1. **Ex-partner → partner reversal**: `setRelationshipKind` (`store.js`) and `partnerEdge`
     were already fully bidirectional — `kind: 'partner'` writes `partner_status: 'current'` and
     `kind: 'ex_partner'` writes `'former'`, symmetrically, with `graph.js`'s `partners()`
     projection passing either straight through. The bug was purely a missing menu option:
     `PersonSheet.jsx`'s `changeOptions` (the "⋮" manage-relationship menu's "Change to" list)
     had one hardcoded array for every `relType === 'partner'` chip, and it never included
     `{ kind: 'partner', label: 'Partner' }` — so a relationship already marked "ex" had no way
     back except the delete-and-re-add workaround the report describes. Fixed by branching on
     the item's current `status`: `item.status === 'former'` now offers `Partner`/`Parent`/`Child`
     (the reversal, plus the two kind-changes every partner-type chip already offered); a current
     partner still offers `Ex-partner`/`Parent`/`Child` exactly as before. No store/graph changes
     needed — this was always a one-directional UI omission on top of a fully bidirectional data
     layer.
  2. **Middle names in the "already in tree" picker**: `AddRelativeSheet.jsx`'s existing-person
     search built its own `hay` string from `display_name`/`birth_name`/`given_names`/
     `family_name` — `middle_name` (a real, separately-edited field, and already wired into
     `SearchOverlay.jsx`'s main search via `lib/search.js`'s `rankPeopleByName` in an earlier
     fix this session) was never part of it, so two same-named people were indistinguishable
     here specifically, and searching by a middle name alone (the exact "so many Sampson
     Chynoweths" scenario) found nothing. Added `p.middle_name` to the filter `hay`, and each
     candidate row now shows a " · {middle name}" hint next to the name (new `.link-existing__
     namewrap`/`.link-existing__middle` CSS, styled after `SearchOverlay.jsx`'s own `.search-
     result__nee` convention) whenever the middle name isn't already visible in `display_name` —
     same "show it as a disambiguating hint, not a duplicate" rule as the main search overlay.
  Verified live via Playwright against the real dev server (not mocked): opened James's profile,
  confirmed his ex-partner Rachel Carter's manage-relationship menu offered "Partner" (not
  offered before the fix), clicked it, reopened the menu and confirmed it now offered
  "Ex-partner" instead (the flip actually took, both directions); separately, created a new
  sibling "Sampson · Alpha · Chynoweth", reopened Add Relative from James for an unrelated
  relationship type, switched to "Already in tree", searched the bare middle name "Alpha" (which
  appears nowhere in the display name), and confirmed the picker both found him and rendered
  " · Alpha" next to his name. Full unit suite (the pre-existing, unrelated step-niece failure
  in `relations.test.mjs` aside), `npm run build`, and the standard smoke test all passed clean.

- **Fixed: the "back to you" pill never reappeared after the recap tour finished** (real user
  report: "After the 'XX no. of updates since last visit' sequence has finished, the back to me
  icon is not displayed. It should be because it lands you on the latest updated profile.").
  `HomeToMe.jsx`'s pill is gated visible on `!lineageMode && !timeMode && !flightCaption &&
  !anyOverlayOpen && recapQueue.length === 0` (`App.jsx`) — the `recapQueue.length === 0` half is
  meant only to keep the pill off the screen *while the recap tour overlay is up*. But
  `onDone` (fired when the tour's camera lands on its last stop) only ever maps every queue item's
  `status` to `'done'` — `setRecapQueue((q) => q.map((item) => ({ ...item, status: 'done' })))` —
  it never empties the array itself, and `closeRecapAll` (wired as both `RecapTour`'s `onClose`,
  the 3.4s auto-close once the tour finishes, and `onCloseAll`, the manual "stop the tour" X) only
  ever reset `recapOpen` to `false`, never the queue either. So the very first recap tour played
  in a session left `recapQueue` permanently non-empty (all `'done'`, but still N items) for the
  rest of that session — silently disabling the `=== 0` check forever after, exactly matching the
  report: the tour correctly lands `activeId` on the last-updated profile (`onDone`'s
  `setActiveId(lastId)`, already working), but the pill that should then offer a way back to your
  own profile never appears, no matter how many more times you open and finish the tour. Fixed by
  adding `setRecapQueue([])` to `closeRecapAll`, so the queue is actually cleared the moment the
  tour's own UI closes, not just marked internally done. Verified live via Playwright against the
  real dev server: seeded `localStorage`'s `bloodline:recapCutoffAt` key (read directly by
  `takeRecapCutoff()`, independent of the demo tree's own in-memory-only state) to 40 days ago so
  the seed family's activity log counted as unseen, opened the Activity feed, tapped "Show me" to
  start the tour, and let it play out to natural completion (`.recap-tour` fully detaching from
  the DOM, not manually stopped mid-way — the bug is specifically about the tour *finishing*, and
  a manual stop never reaches `onDone` at all) — confirmed the `.hometome` pill was present,
  animated in, and correctly labelled "Back to James" afterward; reverted the fix via `git stash`
  and reran the identical script to confirm the pill count was 0 beforehand, reproducing the
  exact reported bug before restoring the fix. Full unit suite (the pre-existing, unrelated
  step-niece failure in `relations.test.mjs` aside), `npm run build`, and the standard smoke test
  all passed clean.

- **"Show both in tree" now highlights BOTH duplicate candidates, not just one** (real user
  feedback on the feature above: "only one is selected/highlighted... the second one does not
  stand out at all"). Discussed first — I opined that the single glowing/scaled "active" bubble
  is baked into the ego-camera system (it needs exactly one center) and can't itself go dual, but
  the recap tour's separate lingering gold ring (`setRecapGlow`) is a non-exclusive primitive
  already proven to mark an arbitrary SET of bubbles at once — reusing it was the natural fix
  rather than inventing new visual language. User agreed to reuse the existing gold ring for
  both. `BubbleTree.jsx` gained `spotlightSetGlow(ids)`, a `viewApi` method mirroring the existing
  `spotlightClearGlow(ids)` — calls `ensureVisible(ids)` first (same as `spotlightTour`, since a
  same-render reveal may not have spawned the bubbles yet) then lights `setRecapGlow(true)` on
  each id directly, no camera choreography. `showDuplicatePairInTree` (`App.jsx`) now calls it
  with `[aId, bId]` right alongside the existing `refocus()` call — `activateNormal(aId)` still
  makes only `aId` the single ego-camera "active" bubble (scaled/lifted, and the one the camera
  centres on), but both now wear the same gold ring, so the second candidate no longer disappears
  next to it. A new `compareGlowIdsRef` tracks whichever pair is currently lit so a later "Show
  both in tree" tap on a DIFFERENT pair clears the previous ring first, rather than old rings
  piling up across repeated uses. Confirmed the reused ring is safe outside its original context:
  the recap tour's own `recapVisited`-based dimming/legibility logic in the render loop is gated
  behind `camMode === 'recap' && recap`, so lighting bubbles via `spotlightSetGlow` during normal
  browsing has no effect on unrelated rendering paths. Verified live via Playwright against the
  real dev server: created two same-named synthetic siblings ("Duplicate Testerson" ×2, which
  `findDuplicatePairs`' name-key grouping picks up same as any real duplicate), opened the
  duplicates sheet, tapped "Show both in tree", and confirmed via a high-resolution screenshot
  that both bubbles — the larger centred/active one and the smaller one off to the side — carry
  the identical warm gold ring, clearly distinguishing both from every other (unringed) bubble on
  screen. Full unit suite (the pre-existing, unrelated step-niece failure in `relations.test.mjs`
  aside), `npm run build`, and the standard smoke test all passed clean.

- **"Show both in tree" now highlights BOTH duplicate candidates the SAME way the single active
  person already is** (real user follow-up, with a screenshot: the ring fix above wasn't enough —
  "the selected profile is not faded, it is vivid, larger, with a gold ring... you can see its
  immediate family... both of the duplicates should be shown this way... all the other bubbles
  faded. I should not need to unselect and manually search to locate the other one."). Root cause:
  the ring was never the whole story — the per-frame distance-based fade/scale (`visualForDistance`
  + `focusAlpha` in `BubbleTree.jsx`'s render loop) is computed from a single-source BFS,
  `distancesFrom(graph, activeId)`, so only ONE person (and THEIR immediate family) ever reads as
  `d≤1` and gets the full-size/undimmed treatment — the second duplicate, wherever it happened to
  sit relative to the literal active person, faded like any unrelated stranger, exactly as
  reported. Fixed with a second, independent distance map: `setCompareFocus(ids)` (new `viewApi`
  method) runs its own `distancesFrom` from EACH id in the pair and merges them by per-person
  MINIMUM, stored in a new `compareDist` closure variable — completely decoupled from `dist`/
  `activeRef.current`, so it works regardless of whether the two candidates are connected by any
  path at all (real report from the earlier duplicate-safety feature: "duplicate candidates are
  frequently NOT connected by any path"). The per-frame `d` used for rendering folds in
  `Math.min(rawD, compareDist)` right where it's computed, BEFORE the branch dispatch — so it
  flows through to the existing `visualForDistance(d)` unchanged (scale 1.38/alpha 1 at d=0, same
  as "active" already gets) and `focusAlpha` unchanged, with zero new fade logic to maintain.
  Deliberately does NOT touch the separate `computeRadialTargets` layout function (has its own
  independent local `dist` computation) or anything keyed on the literal `id === activeRef.current`
  check (nameplate-hiding, the terracotta "active" ring, chart-mode sizing, camera centring) — only
  ONE bubble is still the literal ego-camera active node; the fix is purely "which bubbles get to
  look prominent," not "which bubble the camera centres on" or "which one owns the floating
  nameplate." `showDuplicatePairInTree` (`App.jsx`) calls `setCompareFocus([aId, bId])` right
  alongside the existing `spotlightSetGlow` ring call, and `clearCompareFocus()` alongside
  `spotlightClearGlow` when a later "Show both in tree" replaces the pair — always kept in
  lockstep with the ring so there's never a lit-but-dim or dim-but-unlit mismatch. Verified live
  via Playwright against the real dev server with two different scenarios: (1) both duplicates
  sharing the same parents (both read identically vivid/full-size/ringed, immediate family visible
  for both — matching the screenshot); (2) a genuinely DISCONNECTED pair — one duplicate added as
  James's own sibling, the other added as a child of Rachel Carter (James's ex-partner, not a blood
  relative at all) via her relationship-chip nav (`.rel-chip__nav`, a reliable DOM navigation path
  discovered along the way — clicking a person's chip on an open profile opens THEIRS directly,
  sidestepping the canvas/camera coordinate-guessing multi-hop search flights otherwise require) —
  confirmed Rachel herself rendered vivid/undimmed (she's the second duplicate's own parent, d=1
  via `compareDist`, despite being outside James's blood line entirely) while James's actual
  children Oliver and Chloe, unrelated to either duplicate, correctly faded. Full unit suite (the
  pre-existing, unrelated step-niece failure in `relations.test.mjs` aside), `npm run build`, and
  the standard smoke test all passed clean.

- **Marriage/separation discoverability + military fields collapsed by default** (real user
  feedback on the marriage/separation feature above: "not sure where this feature lives now? Only
  on creation? So when you go into edit profile, there's nothing there for it? It's not all that
  clear yet to add marriage or separation?" — plus, while looking, "not sure I like having the
  military data fields. Maybe a drop down? The 98% of people won't have that."). Discussed both
  first; agreed on the fixes below rather than a full relocation of either feature.
  1. **Marriage/separation stays in the "⋮" manage-relationship menu** (it's a fact about the
     *couple*, not one person, so it doesn't belong in the single-person Edit Profile form — that
     part was deliberate, not a gap), but the entry point itself was too quiet: a bare "⋮" icon
     gave no hint that marriage info lived behind it. Partner-type relationship chips now show a
     new "+ Add marriage details" link (`.rel-chip__add-marriage`, `PersonSheet.jsx`) whenever
     neither marriage nor separation info is set — `hasMarriageInfo` checks the exact same
     `is_married`/`marriage_date`/`separation_date` fields the existing "· Married {year}" sub-label
     already reads, so the two are mutually exclusive (a chip shows one or the other, never both,
     never neither with no way in). Tapping it opens the identical "⋮" menu (`relMenuId` state) —
     no new UI surface, just a second, louder door into the one that already existed. Rendered as
     its own row below the nav+menu-button row (`.rel-chip`'s existing `flex-wrap` already puts
     `.rel-menu` on its own line the same way), since it can't nest inside the `.rel-chip__nav`
     button itself (that's already a full-row interactive element navigating to the person).
  2. **Military fields collapsed by default in `EditPersonSheet.jsx`** — the four fields (branch,
     served-with, rank, service number) sat always-visible in the main form for every profile
     regardless of relevance. Wrapped in the exact same disclosure pattern the Privacy section
     already uses (`privacy-section`/`privacy-section__toggle`/`__cur`/`__caret`/`__body` — fully
     generic CSS, no lock-specific styling to fight), swapping the lock icon for `MilitaryIcons.jsx`'s
     existing `MedalIcon` and the "current visibility" summary for the branch label when set.
     `militaryOpen` starts **open** only when the person already has something in at least one of
     the four fields (a document-accepted fact, or an earlier manual entry) — an existing record is
     never hidden behind an extra tap the first time the form opens; it only collapses for the
     blank case the feedback was actually about. Verified live via Playwright against the real dev
     server: confirmed exactly one "+ Add marriage details" hint on James's profile (his former
     partner Rachel Carter, who has `is_married: true` in the seed but no `marriage_date` — a real
     married-but-incomplete case, correctly surfaced) and zero for his current partner Megan
     (already showing "· Married 2016"); clicking the hint opened the Marriage editor directly;
     separately confirmed the Rank input has zero matches before expanding the new Military
     disclosure and exactly one after, with the toggle correctly closed by default on James's
     mostly-empty seed profile. Full unit suite (the pre-existing, unrelated step-niece failure in
     `relations.test.mjs` aside), `npm run build`, and the standard smoke test all passed clean.

- **Keepsake first-edition gate tightened: a real life story is now required too, and the bar
  went from 40% to 67%** (real user follow-up on the completeness-gate feature above: "I think a
  life story is a minimum requirement as well. Also, 40% is very lean, was thinking at least 70%.
  John Davies has next to no info but meets the 40% requirement."). Discussed first — confirmed
  both complaints were real: `profileCompleteness()`'s 9-check score never checks for a life story
  at all (`person.story`, the separate AI-generated narrative field — distinct from the plain `bio`
  field the score's "Biography" check already covers), so a profile with just birth date +
  birthplace + occupation + relationships and nothing else (no photo, bio, story, memories, tags,
  or events) cleared the old 40% bar at 44%, exactly the John Davies complaint. On the number: with
  9 checks the rounded score can only land on {0,11,22,...,100} — 70 isn't reachable, and would
  silently demand 7/9 instead of the intended ~6/9 — agreed on 67 (the true 6/9 value) instead.
  `KeepsakeView.jsx`: `MIN_COMPLETENESS_FOR_FIRST_EDITION` raised to 67; a life story is now a
  second, independent requirement (`hasStory = !!person?.story`) rather than folded into the score
  itself — `profileCompleteness()` is shared with the profile's own completeness meter and
  `lib/military.js`'s narrative gate, and changing what IT means wasn't the ask, just what Keepsake
  additionally requires. `scoreBlocking`/`storyBlocking` are tracked separately so the "Almost
  there" banner only names what's actually still missing: a profile that's already past the score
  threshold but has no story now correctly says "add life story" alone (not a stale list of
  completeness fields that aren't really blocking anything anymore), and a genuinely sparse profile
  still gets the original missing-fields message, with "Life story" folded into that same list
  (subject to the existing two-item-plus-ellipsis truncation) when both are blocking at once.
  Verified live via Playwright against the real dev server (mocking `/api/keepsake`'s GET, since
  plain `npm run dev` has no Cloudflare Pages Functions): James — a fully-filled seed profile
  (photo, bio, birth date/place, occupation, tags, life events, memories, relationships; 100% on
  the 9-check score) but with no `person.story`, since nothing in the seed ever pre-generates one —
  correctly showed "Almost there — 100% complete — add life story to compile a Keepsake." with no
  compile button, proving the story requirement bites independently of a maxed-out score, and that
  the banner copy doesn't regress into the old "add " + empty-string bug. The score-blocking path
  was confirmed via `profileCompleteness()` directly (a bare-stub profile — birth date, birthplace,
  bio only — scores 44%, still well under the new 67% bar), preserving the original message shape.
  Full unit suite (the pre-existing, unrelated step-niece failure in `relations.test.mjs` aside),
  `npm run build`, and the standard smoke test all passed clean.

- **Fixed: "erase tree" wiped local state but the tree came back** (real user report, owner of
  the tree: "it looks as though it's started again, and reloaded the initial welcome page but
  hasn't actually wiped the family tree"). Root cause: `resetTree()` (`store.js`) just did
  `commit({ ...EMPTY })` — clears local state and localStorage fine, but records nowhere that any
  of it was *deliberately* deleted. `removePerson()` already tombstones what it removes
  (`withTombstones`/`_deleted`) so a later sync merge can't resurrect it; `resetTree()` never did
  the same for a full wipe. So the very next merge — a stale-ETag 409 conflict retry on the erase's
  own save, the 60s background poll, or the next login — saw "no local record for this id" and, per
  `_mergeByRecency`'s own logic, just kept whatever the server still had: the whole tree came back,
  and `hasCompletedOnboarding` (a deliberate one-way ratchet for the *opposite* case — a genuinely
  fresh device shouldn't clobber a real family) flipped back to `true` right along with it. Matches
  the report exactly: the welcome screen was real (the local flag flip is instant), the "hasn't
  actually wiped" was also real (nothing durable ever recorded the deletion).
  Two fixes, agreed together:
  1. **`resetTree()` now tombstones everything** — every existing person/relationship/memory/
     photo/document id, the same `withTombstones` call `removePerson` already makes, just for the
     whole tree at once — then forces the very next save to be authoritative immediately
     (`_serverEtag = '*'` + `flushPendingSave()`, reusing the existing tab-close/backgrounding
     force-save helper) instead of the normal 1.5s-debounced save. This means the erase can never
     enter the merge-and-retry path at all (`If-Match: '*'` bypasses the server's conflict check
     unconditionally — `tree.js`'s own existing rule, already used by `putTree`'s own
     deadlock-breaking third attempt), so there's no window where a stale ETag could trigger a
     merge that ratchets `hasCompletedOnboarding` back on. A no-op when server sync isn't enabled
     (demo mode) — `flushPendingSave()` only acts if a save was actually armed.
  2. **A stronger confirmation** (discussed and agreed alongside the root-cause fix): the old
     `window.confirm()` was a single OK tap for an action that permanently wipes the *entire
     shared* family tree, for every member, with no undo — clearly too easy to clear by accident,
     and the same session's own "every deletion needs a confirm step" audit already treats this
     class of action as needing more friction than a plain Yes/No. `FamilySettings.jsx`'s danger
     zone now swaps the button for an inline panel (matching the sheet's own `fs__confirm-inline`
     convention, scaled up) stating exactly what's about to happen and requiring the family's own
     name to be typed back before "Erase everything" enables — a much higher bar to clear
     unintentionally than a single native dialog.
  Covered by 2 new unit tests in `tests/store.test.mjs`: one confirms every person/relationship/
  memory/photo/document created before a reset is tombstoned afterward; the other directly
  simulates the exact bug scenario (a stale "server" copy still holding a since-erased person)
  and confirms the tombstone means that person can never survive a merge with it. Verified live
  via Playwright against the real dev server: the danger-zone button now opens the inline confirm
  (not a native dialog); "Erase everything" stays disabled typing the wrong text and enables the
  instant the real family name is typed; Cancel dismisses without touching anything; and — the
  actual bug reproduction — the reset UI correctly closes to the onboarding screen after erasing.
  Full unit suite (the pre-existing, unrelated step-niece failure in `relations.test.mjs` aside),
  `npm run build`, and the standard smoke test all passed clean.

- **Import pipeline review + fixes** (real user report: "Someone used the import function to
  create [a] tree of 600 people. They cited many duplicates created."). Full code review of the
  GEDCOM (`lib/gedcom.js`) and FamilySearch (`lib/familysearch.js`) import pipelines turned up
  two real duplication bugs plus three gaps, all fixed:
  1. **FamilySearch subject-duplication bug** (`lib/familysearch.js`) — `fetchTree()` fetches the
     logged-in user's ancestry and their spouses/children in parallel, both starting from the same
     FamilySearch person id. `ancestryToStore` and `spousesToStore` each built their OWN
     independent `idMap` keyed by a fresh `uid()` per FS person id, so the subject person — present
     in both responses — got two different internal ids: one copy ended up with parents attached,
     the other with the spouse/children, on every single FamilySearch import. Fixed by sharing one
     `idMap` (threaded through `fetchAncestry`/`fetchSpousesAndChildren` as an optional param,
     built once in `fetchTree` and passed to both) — safe across the `Promise.all` concurrency
     since neither store-conversion function awaits internally, so their synchronous id-building
     never actually interleaves.
  2. **FamilySearch pedigree-collapse bug** (`lib/familysearch.js`, same file) — `ancestryToStore`
     assigned `idMap[p.id] = uid()` unconditionally per entry in `data.persons`, so an ancestor
     occupying more than one Ahnentafel position (pedigree collapse — e.g. cousins who married)
     had its id silently overwritten on the second occurrence; the final `people` array (built via
     a late `idMap` lookup AFTER the loop) picked up the LAST-written id for every occurrence,
     while relationships built from the earlier, now-stale `ahnMap` snapshot pointed at an id that
     no longer existed anywhere — a dangling, silently-dropped relationship. New shared
     `internalIdFor(idMap, fsId)` helper resolves and stably caches one id per FS id, never
     overwriting; `people` is now deduplicated by FS id in the same pass.
  3. **`importFromGedcom`'s un-tombstoned "Replace" wipe** (`store.js`) — the exact same bug just
     fixed in `resetTree()` (see above): the `merge:false` branch swapped in `{...EMPTY, people:
     newPeople, ...}` with no tombstones, so a later sync merge (a conflict retry, a background
     poll, the next login) could silently resurrect the pre-import tree underneath the freshly
     imported one. Now tombstones every old person/relationship/memory/photo/document before
     swapping in the import, and forces the result to become the authoritative server copy
     immediately (`_serverEtag = '*'` + `flushPendingSave()`) — identical reasoning to `resetTree`.
  4. **Proactive duplicate detection at import preview** (design gap — merge mode previously just
     said "Duplicate people may appear" with no way to know how many before committing).
     `GedcomImport.jsx` and `FamilySearchImport.jsx` now compute a `duplicateCount` via
     `findDuplicatePairs` (`lib/duplicates.js`) at the Preview step: merge mode compares the
     union of the existing tree + the parsed batch, filtered to pairs touching at least one NEW
     person (pre-existing duplicates already have their own review path, so they're not re-
     surfaced here); replace mode compares the imported batch against itself. `App.jsx` now passes
     `existingPeople`/`existingRelationships` (`data.people`/`data.relationships`) into both import
     components for this. Shown as an amber `.gedcom__dup-note` right below the existing bio-note,
     naming which review sheet ("Possible duplicates") to use afterward.
  5. **`nameKey` suffix-handling bug** (`lib/duplicates.js`, minor) — `nameKey()` took the LAST
     whitespace token as the surname, so "John Smith Jr." keyed as `first=john, last=jr.` and never
     grouped with a duplicate stub "John Smith" (`last=smith`) — missing a real duplicate rather
     than causing a false one. Generational suffixes (Jr./Sr./II/III/IV/V) are now stripped before
     the surname is taken.
  6. **Pagination + bulk dismiss in `DuplicatesSheet.jsx`** (a big backlog like the reported
     600-person import needed to be tractable to review) — the pairs list now pages 20 at a time
     with a "Show N more" button, and a confirm-gated "Dismiss all N as not duplicates" bulk
     action was added. Deliberately NOT a bulk merge: a merge is destructive (the whole reason the
     per-pair confirm step exists — see the earlier duplicate-merge-safety work above), and
     auto-picking which record "wins" across dozens of pairs unsupervised would be a worse mistake
     than the one this sheet exists to prevent; dismissal is safe by comparison since it never
     touches tree data.
  Covered by new unit tests: `tests/familysearch.test.mjs` (2 tests, mocking `fetch` — one proves
  the subject person appears exactly once across a combined ancestry+spouses fetch with the couple
  edge correctly wired to the single surviving id, the other proves a pedigree-collapsed ancestor
  present at two Ahnentafel positions collapses to one internal id with no dangling relationship);
  `tests/duplicates.test.mjs` (4 tests for the suffix fix, including a regression guard that
  conflicting birth years still correctly rule out a false match); a new test in
  `tests/store.test.mjs` mirroring `resetTree`'s own two regression tests, applied to
  `importFromGedcom`'s replace path. Verified live via Playwright against the real dev server: a
  synthetic 3-person GEDCOM with a deliberate "John Smith" duplicate (one stub, one with a birth
  date) correctly showed the duplicate note in both merge mode ("...against your existing tree")
  and replace mode ("...within this file"); the import committed cleanly; and the resulting
  Possible Duplicates sheet correctly surfaced the John Smith pair. Full unit suite (the
  pre-existing, unrelated step-niece failure in `relations.test.mjs` aside), `npm run build`, and
  the standard smoke test all passed clean.

- **"Show both in tree" polish pass** (real follow-up feedback on a screenshot of that feature:
  "fade all bubbles other than the two immediate families of the duplicates in question... have
  the gold ring more noticable and the name tag displayed on both"). Three changes in
  `BubbleTree.jsx`/`bubble.js`, all scoped to when `compareDist` is active (i.e. only during a
  duplicate-pair comparison, never ordinary browsing):
  1. **Harder fade for everyone else** — the normal focus-fade floor (0.2 alpha for anything
     beyond 3 hops) is deliberately gentle for everyday browsing, so extended relatives stay
     lightly visible for context. While `compareDist` is set, the same tiers instead floor out at
     0.05 (d≤1 still reads at full alpha 1 for both families) — isolating just the two families
     being compared, per the feedback, without touching the gentler default used the rest of the
     time.
  2. **A more noticeable gold ring** — `setRecapGlow` (shared with the recap tour's own "who
     changed" lingering ring) went from a single thin 2.2px stroke to a soft outer halo (7px,
     faint) plus a thicker 3.4px crisp inner ring, so it reads as clearly "lit" at a glance rather
     than needing a close look — this matters more here than in the recap tour, since two separate
     (often distant) bubbles both need to announce themselves without the ego-camera's own
     active-ring/scale/lift treatment to lean on.
  3. **Name label on both, unconditionally** — the per-bubble label was already suppressed for
     whichever person is the literal ego-camera `active` id (that one's name shows via the floating
     `FocusNameplate` instead, to avoid duplication) — correct for ordinary single-focus browsing,
     but the nameplate can only ever hover near ONE bubble, so the second duplicate candidate (who
     can be anywhere else on the canvas, disconnected or not) had no label at all. New
     `compareIds` (a `Set` of the two ids, set/cleared alongside `compareDist` in
     `setCompareFocus`/`clearCompareFocus`) forces `labelAlpha = 1` for both members of an active
     comparison pair regardless of the ordinary active-person/hover rules, guaranteeing both always
     carry a visible name — the one genuine gap the screenshot showed (one candidate had a label,
     the other didn't).
  Verified live via Playwright against the real dev server: merged a duplicate stub "William
  Mercer" into the seed family (unconnected, matching the real "William Mercer" by name), opened
  Possible Duplicates, and confirmed via screenshot after "Show both in tree" that (a) the
  surrounding 24-person tree faded to near-invisible outside the two families, (b) both bubbles
  carry a clearly thicker layered gold ring, and (c) both show a "William Mercer" label — including
  the previously-unlabeled second candidate. Full unit suite (the pre-existing, unrelated
  step-niece failure in `relations.test.mjs` aside) and `npm run build` passed clean.

- **"Show both in tree" gets a real floating nameplate on both, not just the in-canvas label**
  (immediate follow-up: "its treating the label as the little name underneath. not the name
  plate. we need it to force both the name plates on" — the fix above forced on the small
  per-bubble text label, but the user meant the richer floating `FocusNameplate` pill — name,
  lifespan/age, and any fact — that already floats above the literal active person). Only one
  person can ever be the ego-camera's `active` id, and `FocusNameplate` was a single instance in
  `App.jsx` tracking only that one id via `getScreenPos(activeId)` — the second duplicate
  candidate had no way to get one at all. `App.jsx` gained `comparePairIds` state (set alongside
  the existing `compareGlowIdsRef` in `showDuplicatePairInTree`, same lifecycle — persists until a
  later "Show both in tree" replaces it) and a SECOND `<FocusNameplate>` instance, tracking
  `comparePairIds[1]` (the non-active candidate — `comparePairIds[0]` is always `activeId` itself,
  already covered by the existing instance) via the same generic `viewApi.current.getScreenPos(id)`
  the first one already uses. Hidden under the same conditions as the first (overlay open, browse
  mode, chart layout, self-hover) plus one more specific to this one: `activeId !==
  comparePairIds[0]` — the moment the user taps away to browse something unrelated, the second
  plate hides rather than floating orphaned over a bubble the "show both" context no longer
  applies to. No `fact` passed for the second plate (facts are a separate, unrelated feature).
  Verified live via Playwright: after merging a duplicate stub into the seed family and triggering
  "Show both in tree," confirmed exactly 2 `.nameplate` elements render, both at full opacity, both
  correctly reading "William Mercer" — and via screenshot that the richer info card (dates/age/
  marriage fact) on the active one and the plain name pill on the stub (which has no dates to show)
  both float correctly above their own bubble at the same time. Full unit suite (the pre-existing,
  unrelated step-niece failure in `relations.test.mjs` aside) and `npm run build` passed clean.

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

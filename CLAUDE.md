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

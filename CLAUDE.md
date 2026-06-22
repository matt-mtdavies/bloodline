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

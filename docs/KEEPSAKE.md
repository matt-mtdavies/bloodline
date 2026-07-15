# The Keepsake — Bloodline's endgame feature

> **One sentence:** a regenerating, museum-quality illustrated biography — of one
> person, grounded in the whole tree — that reads like a high-end magazine
> profile, moves like a film title sequence on screen, and prints like a book
> your family keeps forever.

This document is in two parts: the **design brief** (what it is, why every
decision) and the **implementation plan** (phases, files, data shapes, class
names, acceptance criteria — specific enough for any implementer to build
faithfully without re-deriving intent).

---

# Part 1 — Design brief

## 1. The thesis

Everything Bloodline collects — dates, photos, memories, documents, military
records, AI biographies, relationships — is raw material. The Keepsake is the
finished good. It is the answer to "why did we spend months filling this in?"

Three hard requirements from the product owner, verbatim:

1. **Viewable in the site** — an immersive reading experience, not a file.
2. **Regenerateable** — as the tree grows richer, the Keepsake grows richer.
   It is never "done"; it is a living publication with editions.
3. **Printable** — the physical object is the point. A grandparent holds it.

And one quality bar: *jaw-dropped and moved*. Every decision below is tested
against that bar.

## 2. What it is (and is not)

- It is a **person-scoped edition**: "The Life of Percy Threlfall", not "The
  Davies Family Compendium". One life told deeply beats 500 lives listed
  shallowly. (A whole-family edition can come later as a v2 that binds
  multiple person-editions; the architecture below deliberately allows it.)
- It is **magazine-format**, not scrapbook-format: full-bleed photography,
  a strict typographic system, generous whitespace, pull-quotes, drop caps.
  The reference register is a print feature in *Kinfolk* or a *New Yorker*
  profile — editorial, warm, restrained. Never a template collage.
- It is **grounded**: the house rule everywhere in Bloodline ("never invent,
  only surface") applies with full force. The AI writes prose *from* the
  record; every claim traces to a person field, event, memory, document
  fact, or relationship. No fabricated color, no guessed feelings.
- It **degrades gracefully**: a sparsely-filled person still gets a beautiful
  (shorter) edition. Sections that lack material are omitted entirely — never
  rendered half-empty. Sparse editions end with an invitation ("this story
  is still being written — add a memory") that drives the engagement loop.

## 3. Naming

Surface name: **"Keepsake"** (button: *Create their Keepsake*; artifact
header: *A Bloodline Keepsake*). Every generation is an **edition**, stamped
on the colophon: *"Second edition — compiled 14 July 2026, from 512 family
records."* Editions make regeneration a feature, not churn: the family sees
the book grow.

## 4. The spreads (content architecture)

A Keepsake is a sequence of **spreads** (screen: full-viewport scroll
sections; print: pages). Order is fixed; presence is data-driven. Every
spread's inclusion rule is deterministic (computed in `lib/keepsake.js`, no
AI involved in *structure*).

| # | Spread | Contents | Include when |
|---|--------|----------|--------------|
| 1 | **Cover** | Full-bleed portrait (or monogram-on-texture if none), name set huge in Fraunces, lifespan, one-line epithet (occupation or AI-picked phrase), "A Bloodline Keepsake" wordmark, edition number | always |
| 2 | **Frontispiece** | The dedication page: relationship of subject to the family ("Father, grandfather, kin-keeper"), the tree's name, compiled-from-N-records line | always |
| 3 | **Origins** | Birth: date, place, era context. Parents introduced by name with mini-portraits. AI narrative ¶ 1. A small "where" treatment: place name set large with birth year | birth data or parents exist |
| 4 | **The Family Constellation** | THE signature graphic: the subject's personal tree rendered as a fine-line constellation diagram — subject centred, ancestors above, descendants below, partners beside; thin lines, small portrait discs, names in caps. Print: a full page. Screen: draws itself line-by-line on scroll | ≥3 relatives |
| 5 | **Chapters of a Life** | The main narrative, split into life chapters (childhood / early years / mid-life / later years — boundaries computed from events). Each chapter: AI prose (2–4 ¶s), inset photos with captions, timeline rail in the margin showing where in the life you are | ≥2 life events or a bio |
| 6 | **In Service** | Military spread, only if service on record: dog-tag motif, service record waypoints, medals row, the military AI narrative, document pull-quotes set as large italic serif | `hasMilitaryService()` |
| 7 | **The Places** | Places lived/born/married, set as an elegant list with years — no map tiles (privacy + print quality); typographic treatment instead | ≥2 distinct places |
| 8 | **Voices** | Memories, set as attributed pull-quotes ("— Rachel, granddaughter"). Top-voted first, max 6. The emotional heart of the book | ≥1 memory |
| 9 | **The Album** | Photo gallery: 1–2 spreads, magazine grid (one hero + supporting), captions from photo records | ≥2 photos |
| 10 | **Documents of a Life** | Scanned artifacts (certificates, letters) presented as objects: slight shadow, caption, one AI-extracted fact each | ≥1 document |
| 11 | **The Record** | The formal genealogical page: structured facts table (born, married, children, occupation, resided, service, died) in tabular small caps — the "archival" register that makes it feel authoritative | always |
| 12 | **Descendants / Legacy** | Who follows: children/grandchildren as a portrait row, "X grandchildren, the youngest born YYYY". If deceased: a restrained memorial treatment (the app's memorial violet) | has descendants |
| 13 | **Colophon** | Edition stamp, compiled date, record count, contributors ("compiled from the contributions of Matt, Jase, …" from activity authors), Bloodline mark. If sparse: the invitation line | always |

## 5. Design language

Everything derives from tokens that already exist in `theme.css` — the
Keepsake must feel like Bloodline's own voice at its most formal, not a new
brand.

- **Type:** Fraunces (`--display`) for everything display — cover name at
  clamp(64px, 14vw, 160px), spread titles, drop caps, pull quotes. Hanken
  Grotesk (`--body`) for body at 17–19px screen / ~11pt print, generous
  1.65 line-height, max measure 38em. Small caps (letter-spaced uppercase
  12px) for labels, captions, the Record table.
- **Color:** paper `--paper`, ink `--ink`, terracotta `--accent` used
  *sparingly* — drop caps, rules, the timeline rail, small ornaments.
  Memorial violet `--memorial` only for deceased/memorial treatments. No
  new hues. Print keeps color (`print-color-adjust: exact`) but the design
  must also survive grayscale — test both.
- **Ornament:** one system: a thin 1px rule with a small centered diamond
  (◆, 8px, accent) separating sections; hairline frames on inset photos;
  page numbers bottom-center in Fraunces italic. Nothing else. Restraint IS
  the luxury.
- **Photography:** full-bleed where quality allows; duotone treatment
  (ink + paper) as a *deliberate* style for low-res/old photos so
  poor-quality scans read as intentional archival material rather than
  artifacts. CSS `filter: grayscale(1) sepia(0.14) contrast(1.05)` on the
  `.ks-photo--archival` class.

## 6. The screen experience (the "wow")

Route: full-screen overlay (`.keepsake-view`), entered from the profile.
Vertical scroll through spreads with these motion beats (ALL gated on
`prefers-reduced-motion`; static is a first-class rendering):

1. **The opening**: cover portrait scales from 1.06→1.0 with a slow ease as
   the title fades up line by line (staggered 120ms). Feels like a film title.
2. **Ken Burns on full-bleed photos**: 12s alternating slow pan/zoom via CSS
   animation, paused when off-screen (IntersectionObserver toggles a class).
3. **The constellation draws itself**: SVG lines animate `stroke-dashoffset`
   as the spread enters the viewport; portrait discs pop in with the app's
   existing `--spring` curve, generation by generation.
4. **Timeline rail**: a thin accent line in the margin fills as you read
   through the chapters — you feel where you are in the life.
5. **Pull quotes** rise 12px + fade on entry (the app's existing `ti-rise`
   pattern — reuse it).
6. **Progress**: a hairline reading-progress bar at the very top.

No scroll-jacking. Native scroll, `scroll-snap-align: start` on spreads with
`scroll-snap-type: y proximity` (proximity, not mandatory — never fight the
reader). 60fps rule: only `transform`/`opacity` animate; nothing layout-bound.

## 7. Print pipeline

**Decision: browser-native print with a dedicated print stylesheet — no
server-side PDF.** Reasons: (a) zero CPU cost on Workers (the exact ceiling
that just bit production); (b) print CSS + `@page` is fully sufficient for
book-quality output; (c) "Save as PDF" is built into every phone/desktop
print dialog, so PDF export comes free.

- `@page { size: 210mm 280mm; margin: 18mm 16mm 22mm; }` (a Crown-Quarto-ish
  magazine proportion that also prints acceptably on A4/Letter with shrink).
- `@page :first { margin: 0 }` for the full-bleed cover.
- Running folios via fixed-position footer per `.ks-spread--print`.
- `break-inside: avoid` on photos/quotes/table rows; `break-before: page` on
  every spread; orphan/widow control (`orphans: 3; widows: 3`).
- All animation styles are screen-media-scoped; print gets the resolved
  static layout. The constellation SVG renders fully drawn.
- Photos print from their R2 URLs (same-origin — already proxied); a
  `crossorigin` + preload pass runs before `window.print()` is offered so
  nothing prints as a grey box. The Print button shows "preparing…" until
  every image in the document has settled (`Promise.all(img.decode())`).

## 8. AI narrative design

One new endpoint: `POST /api/keepsake` (mirrors `biography.js` conventions:
`claude-sonnet-4-6`, `logAiUsage`, 503 when unconfigured). Called **once per
edition**, not per section — a single structured call returns JSON:

```json
{
  "epithet": "Architect, father, keeper of the family stories",
  "chapters": [ { "title": "A Cardiff Childhood", "years": "1985–2003", "paragraphs": ["…"] } ],
  "origins": ["…"],
  "legacy": ["…"]
}
```

Grounding contract (system prompt requirements, mirroring biography.js):
- Input is a compact fact sheet assembled client-side by
  `buildKeepsakeFacts()` (see Part 2) — fields, events, memory texts +
  authors, document fact summaries, relationship names. Nothing else.
- Every sentence must be traceable to an input fact. Explicitly forbidden:
  invented emotions, weather, imagined scenes, "must have felt".
  Permitted: era context stated as context ("Cardiff in the 1980s was…")
  only when a `military_context`-style confidence gate passes — v1 simply
  forbids era color entirely; it can be added later behind the same
  confidence pattern used for Historical Context.
- Tone reference in-prompt: warm, plain, dignified; *New Yorker* obituary
  register, never greeting-card.
- `max_tokens` sized to ~2,500 output; chapters capped at 5.

**Do NOT store the result in `tree_json`** (the 1MB D1 row ceiling is
already under pressure). Store each edition in R2:
`keepsake/{familyId}/{personId}/{factsHash}.json` via the existing DOCS
bucket, plus `latest.json` pointer. Regeneration = facts hash changed.
Viewing = one GET (R2 read through a function), no AI call. This also makes
editions shareable across the family for free — everyone sees the same book.

## 9. Privacy rules (non-negotiable)

- Respect `visibility`: `private` people never appear (name → "a family
  member" in relationship lists, excluded from constellation); `summary`
  people appear as name + relationship only, no facts/photos.
- Living minors: name + portrait only with no facts (matches HoverCard's
  existing `restricted` logic — reuse the same predicate).
- The Keepsake of a `private` person cannot be generated at all.
- The colophon carries the same line as insights: *"Generated from your
  tree and stays private to your family."*

---

# Part 2 — Implementation plan

Six phases, each independently shippable, each with acceptance criteria.
Follow existing house conventions throughout: hardcoded hex fallbacks in
CSS (`var(--ink, #1c1d21)`), `node:test` unit tests in `tests/*.test.mjs`,
Playwright verify scripts as `tests/_verify_*.mjs` (deleted before commit),
smoke suite stays green, commit style per CLAUDE.md.

## Phase 0 — Data assembly layer (no UI)

**New file: `src/lib/keepsake.js`**

```js
// buildKeepsake(graph, personId, { memories, photos, documents, activity })
//   → { spreads: [...], facts, factsHash, sparse: bool }  or null if the
//     person is private-visibility (cannot be generated at all).
```

- `buildKeepsakeFacts(...)` — the compact, privacy-filtered fact sheet for
  the AI (person fields, `lifeEvents()` from lib/profile.js, memory
  texts+authors, `summarizeDoc`-style document facts, `militaryProfile()` /
  `militaryEvents()` from lib/military.js, relationship names via graph).
- `keepsakeSpreads(...)` — evaluates the 13 inclusion rules from the table
  above, returns ordered spread descriptors with all display data resolved
  (no component should touch `graph` directly).
- `chapterBoundaries(events, birthYear, deathYear)` — splits a life into
  2–5 chapters at natural event-density boundaries; pure + unit-tested.
- `factsHash(facts)` — reuse the pattern from `aggregatesHash` in
  lib/insights.js (stable stringify → djb2-style hash).
- `constellationLayout(graph, personId)` — pure layout: subject at (0,0),
  generations at fixed y-bands, partners adjacent, deduped, capped at ~40
  nodes nearest-first (a 500-person tree must not render 500 discs).
  Returns `{ nodes: [{id,x,y,name,photo,restricted}], links: [{x1,y1,x2,y2,kind}] }`.

**Tests: `tests/keepsake.test.mjs`** — inclusion rules (each spread present/
absent for crafted inputs), chapter boundaries, privacy filtering (private
person → null; summary person → name-only in constellation; minor → no
facts), hash stability, constellation cap.

*Acceptance: suite green; no UI yet.*

## Phase 1 — The in-site reader, static (no AI, no animation)

**New files:**
- `src/components/Keepsake/KeepsakeView.jsx` — the overlay: header (close,
  edition stamp, Print button), scroll container, renders spreads.
- `src/components/Keepsake/spreads.jsx` — one small component per spread
  (`CoverSpread`, `OriginsSpread`, `ConstellationSpread`, `ChaptersSpread`,
  `ServiceSpread`, `PlacesSpread`, `VoicesSpread`, `AlbumSpread`,
  `DocumentsSpread`, `RecordSpread`, `LegacySpread`, `ColophonSpread`).
  Each takes exactly one spread-descriptor prop from Phase 0.
- `src/components/Keepsake/Constellation.jsx` — SVG from
  `constellationLayout()`; viewBox-scaled; portrait discs reuse `Avatar`.
- `src/styles/keepsake.css` — new file, imported from `index.css`; ALL
  classes prefixed `ks-`. Spreads: `.ks-spread` = `min-height: 100dvh`,
  `scroll-snap-align: start`, internal grid `minmax(0, 68ch)` centered.

**Wiring:** `App.jsx` gains `keepsakeId` state (`personId | null`). Entry
point: a "Keepsake" action on the PersonSheet (placed with Life Story —
sparkle icon + "Create their Keepsake" / "Open their Keepsake" once one
exists). AI text areas render a tasteful placeholder rule in this phase.

*Acceptance: Playwright script opens a demo person's Keepsake, screenshots
every spread at phone (390×844) and desktop (1280×900); every populated
spread visually correct; sparse person renders short edition with no empty
sections; smoke stays green.*

## Phase 2 — The narrative engine

**New file: `functions/api/keepsake.js`** — clone biography.js's skeleton
(auth via `data.user`, 503 without `ANTHROPIC_API_KEY`, `claude-sonnet-4-6`,
`logAiUsage` with endpoint tag `keepsake`). Input `{ facts }`; output the
JSON shape from §8, validated server-side (reject/repair non-JSON with one
retry, mirroring summarize.js's retry).

**Storage:** same function, after generation: `env.DOCS.put(
'keepsake/{familyId}/{personId}/{hash}.json', body)` + `latest.json`
pointer `{ hash, editionNumber, compiledAt, recordCount }`. Edition number
increments from previous `latest.json`. `GET /api/keepsake?personId=` reads
`latest.json` + edition (two R2 reads, no AI). D1 untouched — the 1MB
tree_json ceiling gains nothing.

**Client:** `KeepsakeView` on open: GET latest; if none or stale
(`factsHash` differs) show the banner: *"3 new records since this edition —
weave them in"* → regenerate button → POST → loading state (shimmer
paragraphs, same `.ti__shimmer` pattern) → render. The old edition stays
readable while regenerating.

*Acceptance: unit tests mock DOCS + fetch (same fake-binding style as
tree-save.test.mjs): generation stores hash-keyed object + pointer; GET
returns latest; stale detection fires on hash change; edition number
increments; 503 path clean. Manual: prose renders with drop cap; every
factual claim spot-checked against inputs.*

## Phase 3 — Motion

All in `keepsake.css` + a small `useSpreadReveal()` hook
(IntersectionObserver adds `.ks-in` at 25% visibility, once):

- Cover title stagger (CSS animation-delay per line, 120ms steps).
- Ken Burns: `.ks-photo--burns` 12s alternate `transform` keyframes;
  `.ks-in` toggles `animation-play-state`.
- Constellation draw: `stroke-dasharray/dashoffset` transition on `.ks-in`,
  links first (600ms, staggered 40ms), discs pop with `--spring` after.
- Chapter rail fill: `scaleY` from scroll progress via one rAF-throttled
  scroll listener in KeepsakeView (CSS `animation-timeline: view()` may be
  used *only* with this JS fallback in place — both must be verified).
- Every animation inside `@media (prefers-reduced-motion: no-preference)`.
  Reduced-motion renders the fully-resolved static state.

*Acceptance: Playwright at both viewports with scroll-through screenshots;
a reduced-motion pass (`emulateMedia`) shows fully-drawn constellation and
no motion; no console errors; smoke green.*

## Phase 4 — Print

- Print styles at the end of keepsake.css inside `@media print`: the `@page`
  rules from §7; `.keepsake-view` becomes normal-flow; app chrome
  (`.topbar`, docks, toasts) `display: none`; spreads paginate with
  `break-before: page`; folios + running header (subject name, small caps).
- Print button flow: set `.ks-printing` (forces all images eager +
  decoded), `await Promise.all([...document.images].map(i => i.decode().catch(()=>{})))`,
  then `window.print()`. Button label cycles "Preparing pages…" → print.
- Cover full-bleed via `:first` page zero-margin + `100%` image.
- Verify via Playwright `page.pdf()` (Chromium headless) — generate the PDF,
  visually inspect page 1 (cover), the constellation page, a chapter page,
  the record page. Check grayscale rendering by screenshotting with
  `filter: grayscale(1)` applied to the root as a proxy.

*Acceptance: PDF pages match the design (no clipped text, no orphan
captions, folios present, cover bleeds); a photo-heavy demo person and a
sparse person both paginate cleanly.*

## Phase 5 — Polish, entry points, engagement loop

- **Home hub card**: "Percy's Keepsake has 3 new records waiting" (reuse the
  this-month/insights-teaser card pattern in Home.jsx) — the regeneration
  loop made visible.
- **Cover thumbnail** on PersonSheet next to the entry button (tiny
  rendering of the cover: portrait + name, pure CSS, no image generation).
- **Activity event** `keepsake_generated` ("Matt compiled the 2nd edition of
  Percy's Keepsake") through the standard activity flow.
- Colophon contributor names from distinct `activity` authors.
- Full regression: unit suites, build, smoke, phone + desktop + print
  passes, then the standard ship sequence.

*Acceptance: all suites green; screenshots archived in the PR/commit body
description; CLAUDE.md status section updated to mark the feature.*

## Phase 6 (later, explicitly out of v1 scope)

- Whole-family bound edition (multiple person-editions + family-wide
  constellation as one document).
- Professional print-service handoff (true bleed marks, CMYK-safe palette,
  spine text) — only worth it once families ask to have it bound.
- Era-context paragraphs behind a confidence gate (the Historical Context
  pattern), and document-image inline reproduction rights prompts.

## Phase 5.5 — The page-turn reader (book mode) ✅ built

The Keepsake read as a physical magazine — the default reading experience,
with the scroll reader one chrome-toggle away (persisted in
`localStorage.ks_reader_mode`).

**Pagination (`paginateSpreads`, lib/keepsake.js).** The 13 spreads become
fixed pages at their natural seams: one chapter per page (the book
convention; each carries its absolute `idx` so edit pencils keep addressing
the right narrative slot), the album as a hero page of five then grids of
six, voices four to a page. Every page keeps the spread's `key` (component
router) and gains a unique `pageKey`; continuation pages are `continued`
(no repeated hero, no repeated bio). Anything taller than its page scrolls
quietly inside it — pagination can never truncate a record.

**The turn (KeepsakeBook.jsx).** One `.ks-leaf` pivots in 3D on the sheet's
left edge: front face = current page, back = bare stock with the house
diamond, next page mounted beneath (which also preloads its images). Drag
and the leaf follows the finger (release past 30% or a flick completes,
else it settles back); tap the outer 26% margins, click the hover chevrons,
or use ←/→. A shine sweeps the paper and the page beneath sits in the
leaf's shadow, both driven per-frame (`--ks-shine`, `--ks-turnshadow`,
sin-curve peaking mid-turn). Everything is imperative — inline transforms
plus one rAF loop; React state only chooses which pages are mounted (a back
turn swaps the previous page onto the leaf before it lifts).

**The stage.** Desktop centres a 10/14 sheet over a deepened table wash,
with unread/read page-edge stacks growing and shrinking at the sheet's
sides and a small-caps "3 of 12" folio; phones read full-bleed. On open the
sheet settles onto the table, and until the first interaction the cover
peeks at its own turn (`ks-peek`, twice, then never again).

**Guarantees.** Reduced motion: turns are instant page changes, drag-to-curl
never engages, no shine/shadow. Print: book mode renders a hidden
`.ks-printflow` copy of every spread in normal flow — the Phase 4 pipeline
reads that (the pager only mounts a leaf and its neighbour), so the printed
book is identical from either mode. Pages mark their spreads `.ks-in` on
mount so a turn never uncovers a half-revealed page. Escape/edit-sheet
layering unchanged; pencils work inside pages (interactive elements are
excluded from drag/tap detection).

## Constraints & risks (read before building)

1. **D1 1MB row**: never write Keepsake output into tree_json. R2 only.
2. **Workers CPU (10ms free tier)**: endpoints here do fetch-and-store only
   — no server-side rendering, no PDF generation, no image processing.
   Await-on-fetch costs no CPU; keep it that way.
3. **Image CORS/print**: R2 photos are same-origin — keep it that way; any
   future external image must be proxied before it may appear in a Keepsake.
4. **Long-tree constellation**: the 40-node cap is a hard cap; test with the
   500-person production-scale tree via a generated fixture.
5. **AI JSON discipline**: the endpoint must validate shape and retry once;
   a malformed response must degrade to "couldn't compile this edition —
   retry", never a blank book.
6. **Sandbox quirk**: demo faces don't load headless — verify image *layout*
   via boundingBox() per CLAUDE.md; verify real rendering on the live site.

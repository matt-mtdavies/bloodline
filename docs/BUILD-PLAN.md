# Bloodline — V2 Build Plan (full)

The complete product plan. `CLAUDE.md` holds the lean working summary and points
here for detail. Status tags: ✅ done · 🟡 partial · ⬜ not started.

> **Final principle:** if a great-grandchild discovers Bloodline 100 years from
> now, they should not simply learn _who_ their ancestors were — they should feel
> like they _know_ them.

## Vision & philosophy

Bloodline is not a genealogy tool; it is a living portrait of a family. Most
products preserve relationships — Bloodline should preserve _people_: who they
were, what mattered to them, what stories should survive them.

- The family tree is **navigation**.
- The profile is the **destination**.
- The stories are the **product**.
- Relationships provide structure; memories provide value; AI provides assistance.
- AI never invents family history — it only helps preserve it.

## Primary views

### 1. Tree view ✅ (core) / 🟡 (modes)
Visual exploration of relationships. Done: zoomable/pannable canvas, dynamic
force layout, focus-person framing (bounding-box of visible family), additive
reveal, merged co-parent lines + sibling trunk (toggle in Legend).
Future: maternal-line / paternal-line / descendants / ancestors modes; highlight
lineage paths; fade unrelated branches. Success: understand structure in seconds.

### 2. List view ✅ (basic) / ⬜ (filters)
Family management + navigation. Done: grouped list (parents/siblings/partners/
children/everyone), quick profile access, focus. Future: search, sort, filters
(birth year, location, living/deceased, military, occupation, tags), bulk
management. Success: efficient management of large families.

### 3. Profile view ✅ (Phase 1–2) — _the destination_
Should feel like memorial + biography + scrapbook + archive combined.

- **Hero** ✅ — portrait, full name, birth/death, relationship-to-viewer, location, tags
  (e.g. Veteran, Teacher, Immigrant, Entrepreneur, Artist, Builder).
- **About** ✅ — short editable biography.
- **Life Story** ⬜ — AI narrative from timeline/memories/docs/photos. Formats: short,
  detailed, children's, historical. (Placeholder "Coming soon" card present.)
- **Key Life Events** ✅ — timeline card layout, editable (add/edit/remove, sorted).
- **Relationships** ✅ — grouped cards, quick navigation, qualifier-aware labels.
- **Photos** ✅ — gallery + lightbox (caption, set-as-portrait, delete). Future: albums,
  face recognition, AI captions, AI date estimation.
- **Documents** ⬜ — letters, certificates, resumes, military/newspaper records. AI: OCR,
  summaries, timeline extraction. (Needs R2 storage.)
- **Memories** ✅ — most important section. Short, specific, contributed by relatives,
  upvoted so the most meaningful float to top.
- **Voice & Video** ⬜ — interviews, messages, stories. AI: transcribe, summarize, themes.
- **Legacy** ⬜ — life lessons, advice, quotes, values for future generations.
  (Placeholder "Coming soon" card present.)
- **Completeness meter** ✅ — engagement loop; surfaces what's missing.

## New views (later phases)

- **Lineage Mode** ⬜ — highlight one family line (e.g. Arthur→Robert→James→Tom): selected
  line full opacity + accent + thicker paths; everything else fades to ~20%.
- **Timeline Mode** ⬜ — the family story chronologically; searchable/filterable family history.
- **Story Mode** ⬜ — read family history; photos + memories + documents + timeline + bios,
  reads like a magazine not software.

## AI strategy (Phase 3)

Six features. All Anthropic calls **server-side in Workers**, key never client-side.

1. **Memory Collector** — asks what made a person unique, their advice, favourite memories,
   traditions; responses populate the Memories section.
2. **Biography Generator** — from timeline/memories/photos/documents → short / full /
   children's biography. Editable.
3. **Family Historian** — surfaces patterns ("three generations in construction", "120 years
   in Wales", "military service in four generations").
4. **Missing Information Assistant** — nudges naturally (no spouse, no birthplace, no photos,
   no memories). (Completeness meter is the seed of this.)
5. **Family Interview Generator** — custom interview questions (how you met, childhood home,
   traditions, advice to pass on).
6. **Smart Search** — replace the search box with "Ask about your family…": conversational
   exploration ("show all veterans", "everyone born before 1950", "descendants of Arthur",
   "who lived in Cardiff").

### Model-per-task plan (cost-optimized)
- **Haiku 4.5** (`claude-haiku-4-5`, effort low) — micro-asks, relationship/label parsing,
  dedup candidate scoring, photo-tag/caption suggestions, short prompt generation.
- **Sonnet 4.6** (`claude-sonnet-4-6`) — conversational entry → structured extraction,
  auto-bios, the interview/prompting system.
- **Opus 4.8** (`claude-opus-4-8`) — hard reasoning (merge/conflict resolution); the narrative
  showpiece (use **Fable 5** `claude-fable-5` only if explicitly asked for the flagship).
- **Levers:** prompt caching (repeated family context, ~0.1× reads), `output_config.effort`,
  Batch API (50% off for non-interactive bulk: whole-tree bios, overnight dedup),
  adaptive thinking `{type:"adaptive"}`. Keep everything in Workers.

## Family collaboration system ⬜ (Phase 4)

- Roles: Owner, Editor, Contributor, Viewer.
- Invite family; contribution tracking; change history; activity feed.

## Engagement loops 🟡

- Profile completeness score ✅ (built).
- Family anniversaries ⬜ (100 years since immigration, 50th wedding anniversary, birthdays).

## Design direction

Keep: serif display type (Fraunces) + Hanken Grotesk body, minimalist, spacious, calm palette
(white ground, terracotta accent, hardcoded hex for iOS). Increase: information richness,
emotional depth, storytelling. Avoid: genealogy-software / spreadsheet / admin feel.
Inspiration: Apple, Notion, Arc, Linear, Medium, family photo albums.

## Execution roadmap (6 phases)

- **Phase 1 — Immediate** ✅ — improve graph scaling, better centering, rich profile
  architecture, expanded person records. _(Plus: fill-the-screen framing.)_
- **Phase 2 — Content** 🟡 — Photos ✅, Timeline ✅, Memories ✅, Documents ⬜ (needs R2).
- **Phase 3 — AI** ⬜ — biography generation, interview system, smart onboarding/search,
  memory collector, family historian, missing-info assistant.
- **Phase 4 — Collaboration** ⬜ — invitations, roles/permissions, activity feed.
- **Phase 5 — Views** ⬜ — Lineage mode, Timeline mode, Story mode.
- **Phase 6 — Output** ⬜ — Family Historian AI, legacy books, PDF exports, printed histories.

## Backend / infra status

- Cloudflare Pages (GitHub-connected) live at myfamilybloodline.com.
- D1 created + migrated (id `96e94723-103f-4c4f-a1b0-797810e7dfc9`); bindings commented out in
  `wrangler.toml` for a clean deploy. R2 not created. Auth = magic links (Resend), endpoints in
  `functions/api/auth/*` (server-side only).
- Phases 1–2 run on bundled seed + localStorage; no live backend needed until Documents (R2),
  AI (Workers + Anthropic key), and Collaboration (D1) phases.

## Constraints (non-negotiable)

- Anthropic key server-side only, never client. Magic-link auth only, no passwords.
- No data sale, no ad tracking; living people / children stay private.
- iOS dark mode: hardcoded hex, `color-scheme: light only`.

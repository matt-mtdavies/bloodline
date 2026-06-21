# Bloodline — V2 Build Plan

Status tags: ✅ done · 🟡 partial · ⬜ not started

> **Final principle:** if a great-grandchild discovers Bloodline 100 years from
> now, they should not simply learn _who_ their ancestors were — they should feel
> like they _know_ them.

---

## Vision & philosophy

Bloodline is not a genealogy tool; it is a living portrait of a family.

- The family tree is **navigation**.
- The profile is the **destination**.
- The stories are the **product**.
- Relationships provide structure; memories provide value; AI provides assistance.
- AI never invents family history — it only helps preserve it.

---

## Primary views

### 1. Tree View ✅ (core) / 🟡 (modes)

Purpose: visual exploration of family relationships.

**Done:**
- Zoomable / pannable canvas, infinite pan
- Dynamic force layout with generation bands
- Focus-person centring (bounding-box of visible family, bias toward active person)
- Additive reveal — expanding outward from focus
- Merged co-parent lines + sibling trunk (toggle in Legend)
- Lineage path tracing (`pathBetween`)
- Name label on every visible bubble
- All-labels-always visible (no distance gate)

**Not started:**
- Highlight lineage paths with full visual treatment (accent colour, fade unrelated to 20%)
- Maternal / paternal / descendants / ancestors layout modes
- Dynamic clustering at large scale

Success metric: understand family structure within seconds.

---

### 2. List View ✅ (basic) / ⬜ (search + filters)

Purpose: family management and navigation.

**Done:**
- Grouped sections (Partners, Parents, Siblings, Children, Everyone)
- Quick profile access and focus

**Not started:**
- Search by name
- Filters: living/deceased, birth year, location, military, occupation, tags
- Sort
- Bulk management

Success metric: efficient management of large families.

---

### 3. Profile View ✅ (Phase 1–2) — _the destination_

Should feel like a digital memorial, biography, scrapbook, and archive combined.

#### Hero ✅
Portrait, full name, birth/death dates, relationship to viewer, location, tags
(Veteran · Teacher · Immigrant · Entrepreneur · Artist · Builder).

#### About ✅
Short editable biography. Relationship-aware placeholder copy.

#### Life Story ⬜
AI narrative from timeline / memories / documents / photos. Formats: short summary,
detailed biography, children's version, historical version. Editable. Placeholder card present.

#### Key Life Events ✅
Timeline card layout. Editable: add / edit / remove, auto-sorted by date.

#### Relationships ✅
Grouped cards (Partner, Parents, Children, Siblings). Qualifier-aware labels
(step / adopted / biological). Quick navigation to any person.

#### Photos ✅ / 🟡 (albums, AI features)
Gallery + lightbox (caption, set-as-portrait, delete). Upload downscales to 1 800 px.
Portrait upload via PhotoCropper (512 × 512 crop).
Not started: albums, face recognition, AI captions, AI date estimation.

#### Documents ⬜
Letters, certificates, resumes, military records, newspaper clippings.
AI: OCR, summaries, timeline extraction. Needs R2 storage.

#### Memories ✅ / ⬜ (collection AI)
Most important section. Short, specific contributions from relatives. Upvoting so the
most meaningful float up. Not started: AI Memory Collector prompts.

#### Voice & Video ⬜
Store interviews, voice messages, and family stories. AI: transcribe, summarize,
extract themes. Needs R2 / media storage.

#### Legacy ⬜
Life lessons, advice, quotes, values — things future generations should know.
This becomes one of the most valuable sections. Placeholder card present.

#### Completeness meter ✅
Engagement loop; surfaces what's missing; drives contribution.

---

## Engagement loops

- **Completeness score** ✅ — per-person percentage with checklist of missing sections.
- **Family anniversaries** ⬜ — surface 100-year ancestor birthdays, 50th wedding
  anniversaries, upcoming birthdays in a home banner or notification.

---

## Phase 3 — AI strategy

All Anthropic calls **server-side in Workers only**. Key never in the client.
AI assists with preservation; it never invents family history.

### Features (Phase 3 sprint — biography + interview + smart onboarding)

1. **Biography Generator** — from timeline / memories / photos / documents →
   short / full / children's biography. Editable. ⬜
2. **Family Interview Generator** — custom questions per person: how you met,
   childhood home, traditions, advice to pass on. Responses feed Memories. ⬜
3. **Smart Onboarding** — AI-guided first session: prompts for key people,
   early memories, portrait upload nudge. Makes the first 10 minutes feel
   alive rather than administrative. ⬜

### Features (Phase 6 sprint — historian + search)

4. **Memory Collector** — ongoing prompts: what made this person unique, their
   advice, favourite memories, traditions they created. ⬜
5. **Missing Information Assistant** — natural nudges when no spouse, no
   birthplace, no photos, no memories recorded. ⬜
6. **Smart Search** — replace the search box with "Ask about your family…":
   conversational exploration ("show all veterans", "who lived in Cardiff",
   "descendants of Arthur"). ⬜

### Model-per-task plan (cost-optimised)

| Task | Model | Rationale |
|---|---|---|
| Micro-asks, label parsing, dedup scoring, caption suggestions | Haiku 4.5 (`claude-haiku-4-5`) | Low cost, fast |
| Conversational entry → structured data, auto-bios, interview prompts | Sonnet 4.6 (`claude-sonnet-4-6`) | Balanced |
| Hard merge / conflict reasoning; narrative showpiece | Opus 4.8 (`claude-opus-4-8`) | Best reasoning |
| Flagship narrative only if explicitly requested | Fable 5 (`claude-fable-5`) | Premium |

Levers: prompt caching (family context, ~0.1× read cost), `output_config.effort`,
Batch API (50 % off for bulk non-interactive: whole-tree bios, overnight dedup),
adaptive thinking `{type:"adaptive"}`.

---

## Phase 4 — Collaboration ⬜

- **Roles** — Owner → Editor → Contributor → Viewer. Each role sees progressively
  less and can do progressively less. Schema in `visibility.js`; enforcement ⬜.
- **Privacy model** — `visibility` field per person: `full` / `summary` / `private`.
  Schema ✅, visual treatments ✅ (sealed bubble, shield badge), profile enforcement ✅.
  Role-gated visibility (owner/coadmin always sees full) ✅ in `effectiveVisibility()`.
- **Invite family** — in-app invite flow from Family Settings. Auth (magic-link) ✅,
  merge wizard ✅, in-app invite UI ⬜.
- **Claimed profiles** — when someone you've added signs up, they can claim their
  record and control their own visibility settings across all trees. ⬜
- **Contribution tracking** — attribution on memories, edits, photo uploads. ⬜
- **Activity feed** — recent changes surfaced in the app. ⬜
- **Change history** — audit trail of edits per person. ⬜

---

## Phase 5 — New views ⬜

### Lineage Mode
Highlight a specific family line (e.g. Arthur → Robert → James → Tom).
- Selected line: accent colour, full opacity, thicker paths.
- Everything else fades to ~20 % opacity.
- Button exists in UI; `pathBetween()` implemented; full visual treatment ⬜.

### Timeline Mode
Tell the family story chronologically. Aggregates events across all people.
Searchable and filterable. This is the family history view. ⬜

### Story Mode
Read family history — photos + memories + documents + timeline + bios combined.
Feels like a magazine, not software. ⬜

---

## Phase 6 — Output ⬜

- **Family Historian AI** — identifies cross-generation patterns: "three generations
  in construction", "120 years in Wales", "military service in four generations". ⬜
- **Legacy books** — compiled family history as a designed artifact. ⬜
- **PDF exports** — individual profiles, family branches, full tree. ⬜
- **Printed family histories** — print-on-demand integration. ⬜

---

## Backend / infra

- **Cloudflare Pages** (GitHub-connected) live at myfamilybloodline.com.
- **D1** created + migrated (`96e94723-103f-4c4f-a1b0-797810e7dfc9`). Bindings
  commented out in `wrangler.toml` for clean initial deploy. Needed for Phase 4+.
- **R2** not created. Needed for Documents (Phase 2) and Voice & Video (Phase 3+).
- **Auth** — magic-link only (Resend). Endpoints in `functions/api/auth/*`, server-side only.
- **Anthropic** — key server-side only in Workers, never in the client. Needed for Phase 3+.
- Phases 1–2 run on bundled seed + localStorage. No live backend until Documents (R2),
  AI (Workers + Anthropic key), and Collaboration (D1).

## Constraints (non-negotiable)

- Anthropic key server-side only, never in the client.
- Magic-link auth only, no passwords.
- No data sale, no ad tracking. Living people / children stay private by default.
- iOS dark mode: hardcoded hex, `color-scheme: light only`.

---

## Execution roadmap

| Phase | Focus | Status |
|---|---|---|
| 1 | Graph scaling, centring, rich profile, expanded person records | ✅ |
| 2 | Photos, Documents, Timeline, Memories, Onboarding, Privacy schema | 🟡 (Documents + Voice & Video need R2) |
| 3 | AI: Biography Generator, Interview Generator, Smart Onboarding | ⬜ |
| 4 | Collaboration: roles, invites, claimed profiles, activity feed | ⬜ |
| 5 | Lineage mode, Timeline mode, Story mode | ⬜ |
| 6 | Family Historian AI, Smart Search, Legacy books, PDF exports | ⬜ |

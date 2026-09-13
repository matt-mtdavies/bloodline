# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Four confirmed audiences (`docs/PRODUCTIZATION-BRIEF.md` §3), in rough order of
how much of the product they touch:

- **The family steward** — usually the person holding the photos, documents,
  and accumulated research. Wants one safe, attractive place to organize and
  share a family archive; is wary of importing data, duplicates, and losing
  years of work; needs obvious roles, invitations, review-before-apply
  importing, and a credible export story.
- **The newly invited relative** — wants to know who invited them, what they
  can see, and whether they're expected to do work. Needs a one-minute join
  path and a welcoming first contribution (a portrait, a correction, a memory).
- **The family storyteller** — wants to preserve voices, photos, stories, and
  context for future generations. Needs emotionally rewarding, low-friction
  prompts, not genealogy expertise.
- **The genealogist migrating an existing tree** — needs GEDCOM import,
  transparent data handling, reviewable changes, duplicate safeguards, and
  export portability. Does not need to be sold "magic"; needs competence and
  control.

A living, real production family (1000+ people, heavy document/photo use) is
already using the product day to day — this is not a hypothetical or
pre-launch audience; UX problems surface as real user reports and are treated
with corresponding weight (see `CLAUDE.md`'s Status log for many examples of
real incidents, fixes, and their verification).

## Product Purpose

Bloodline is a living portrait of a family, not a genealogy database with a
tree bolted on. The founding thesis: **the tree is navigation, the profile is
the destination, the stories are the product.** Relationships provide
structure; memories provide value; AI assists preservation but never invents
family history.

Final principle (`docs/BUILD-PLAN.md`): if a great-grandchild discovers
Bloodline 100 years from now, they should not simply learn *who* their
ancestors were — they should feel like they *know* them.

Success means understanding a family's structure within seconds of opening the
tree, and a person's profile feeling like a person, not a database record.

## Positioning

**Primary promise** (`docs/PRODUCTIZATION-BRIEF.md` §1): *Your family's living
story — beautifully preserved, privately shared, and always yours to keep.*

**Differentiated territory:** the private, visual, emotionally resonant family
home — not a records/hints/matches engine, not a public or semi-public global
tree, not a dense research tool.

| Competitor expectation | Bloodline's answer |
| --- | --- |
| "Give us facts and we will find records." | "Bring the people and stories your family already carries; make them present and shareable." |
| "A huge public or semi-public network." | "A family-controlled space with explicit membership and roles." |
| "Research tools and dense charts." | "An immersive tree, human profiles, timelines, and stories — while still respecting serious data." |
| "Import your GEDCOM." | "Import it safely, see exactly what would change, and keep the ability to take it back out." |

**What Bloodline is not:** not a public crowd-edited global tree, not an
advertising/surveillance product, not a substitute for a professional
genealogy research database, not a generic social network for relatives. No
unsupported comparative claims ("more private than every competitor," "the
most beautiful family-tree app") — product proof and real stories establish
the difference, not marketing copy.

## Operating Context

- Signed-in, invite-based family workspace: an owner/co-admin/contributor/
  viewer role hierarchy gates structural edits, family settings, and member
  management server-side (`functions/api/family/members.js` et al.) —
  authorization is never client-only.
- Core interaction loop: open the tree → tap a person → read/contribute to
  their profile (bio, photos, documents, memories, timeline, military
  service, education, ancestry story) → the activity feed and recap tour
  surface what changed since a viewer's last visit.
- A GEDCOM/FamilySearch import path and a GEDCOM export path exist for
  genealogists moving data in and out; duplicate detection and an integrity
  checker (implausible/conflicting facts) run continuously, both reviewable
  and dismissible, never auto-applied.
- The Keepsake is a separate, regenerating magazine-style illustrated
  biography per person — the marquee "endgame" feature, deliberately built as
  an editorial reading experience rather than application chrome (see
  `docs/KEEPSAKE.md`).
- No monetization is live yet. A plans/billing/entitlement architecture is
  specified (`docs/PRODUCTIZATION-BRIEF.md` §10) but explicitly gated on a
  business decision, not an engineering backlog item — do not build pricing
  UI without that decision being made first.

## Capabilities and Constraints

**Confirmed, shipped:** ego-centric organic tree (PixiJS/WebGL + d3-force),
a traditional pedigree chart view, an accessible semantic list view, two
further opt-in tree compositions (Canopy, Atlas — see Brand Commitments),
rich profiles (hero, kin-to-viewer badge, About, key-life-events timeline,
grouped relationships, completeness meter, military service, education
history, places lived, ancestry story), photo galleries with lightbox,
documents with AI-assisted fact extraction and provenance tracking, memories,
a family timeline, GEDCOM/FamilySearch import and GEDCOM export, duplicate
and integrity review, per-user Family Perimeter (a bounded slice of a large
tree), insights (20+ family-fact modules), search, activity feed, magic-link
auth, and the Keepsake.

**Technical constraints (non-negotiable, `docs/BUILD-PLAN.md` /
`docs/ARCHITECTURE.md`):**
- Anthropic API key server-side only, never shipped to the client.
- Magic-link auth only — no passwords, ever.
- No data sale, no ad tracking. Living people and children are private by
  default; visibility is enforced server-side, not just hidden in the UI.
- iOS dark mode is defeated on purpose: hardcoded hex colors,
  `color-scheme: light only` (`src/styles/theme.css`) — the product has one
  deliberate light, warm-paper appearance, not a dark-mode variant.
- The browser is untrusted for every authorization/visibility decision;
  server-side enforcement is mandatory (`docs/ARCHITECTURE.md`).
- Tree storage is split D1 (core, size-bounded) / R2 (rich, growing content)
  per family, migrated one family at a time, never automatically
  (`docs/TREE-STORAGE.md`).

**Undecided / explicitly open:**
- No formal accessibility conformance level (e.g. WCAG 2.1 AA) is committed
  to anywhere in the repo. Documented ad hoc practices exist instead: 44×44px
  minimum touch targets and `prefers-reduced-motion` support on public pages
  (`docs/PRODUCTIZATION-BRIEF.md` §9), `:focus-visible` styling and a
  semantic parallel list view app-wide (`AccessibleTree.jsx`). Treat these as
  a floor, not a certified target, until a human sets one explicitly.
- Monetization/plans architecture is specified but not decided as live
  product scope (see Operating Context above).

## Brand Commitments

- **Name and domain:** Bloodline, live at myfamilybloodline.com (Cloudflare
  Pages, GitHub-connected).
- **Mark:** a three-bubble "family constellation" glyph (two terracotta,
  one gold) — the same mark appears as the favicon, the in-app topbar/splash
  logo (`Logo.jsx`), and the error-boundary fallback screen. It has a
  deliberate `idle` (barely-there topbar drift) and `loading` (pronounced
  breathe) state, and IS the save-status indicator — there is intentionally
  no second spinner or checkmark beside it.
- **Bespoke, intentionally distinct tree experiences** (do not collapse into
  one generic "org chart" pattern, and do not simplify without explicit
  product sign-off — see `DESIGN.md`'s "Bespoke surfaces" section):
  - **Organic / Bubble tree** (`src/viz/BubbleTree.jsx`) — the primary,
    ego-centric, always-alive canvas. The founding "moat" of the product.
  - **Chart** (`src/viz/ChartTree.jsx`) — a traditional static pedigree chart
    for people who want a conventional layout.
  - **Canopy** (`src/viz/canopy/`) — an opt-in composition emphasizing
    truthful blended-family structure (real parent edges, not assumed
    partner co-parenting).
  - **Atlas** (`src/viz/atlas/`) — an opt-in composition with a Time-mode
    scrubber and cinematic focus/birth-moment effects.
  - **The Keepsake** (`src/components/Keepsake/`) — a page-turning,
    typeset, editorial magazine reader; deliberately un-app-like.
  - Three further motion/layout "Labs" (`TreeMotionLab`, `FocusLab`,
    `AtlasLab`) are internal, URL-flag-gated engineering experimentation
    harnesses (`?lab=tree-motion` etc.) — never reached by an ordinary
    visitor, not part of the shipped product surface, and out of scope for
    design review unless someone explicitly asks for them.
- **No dark patterns:** no forced trial, misleading scarcity, pre-ticked
  marketing consent, surprise paywall, or advertising disguised as family
  content (`docs/PRODUCTIZATION-BRIEF.md` §2).
- **Inclusive by construction:** language and visual examples must work for
  adoptive, step, blended, single-parent, LGBTQ+, chosen, and multi-cultural
  families — this is a recurring, explicitly tested product requirement, not
  an aspiration (see CLAUDE.md's relationship-modeling and kin-terms work).

## Evidence on Hand

- A real, actively-used production family tree with 1000+ people and heavy
  document/photo usage exists. **Hard rule, confirmed with the product
  owner:** any design tool, agent, or review pass (Impeccable included) may
  look at real, authenticated family data **read-only, for context only**.
  It must never screenshot, export, copy, or otherwise persist real family
  photos, names, or other identifying content into any file, artifact,
  commit, design doc, or third-party service. Every screenshot, recorded
  artifact, committed fixture, or shared design-review asset must use the
  bundled demo/seed family (`src/data/seed.js`, reached via `npm run dev`
  and the `?demo` query flag) — never a real family's data. This directly
  extends `AGENTS.md`'s existing rule ("Never expose family data... in
  commits, fixtures, logs, screenshots, prompts, or third-party tools").
- `src/data/seed.js` — the "Davies"/"Mercer" demo family: deliberately messy
  (divorce, remarriage, step, adopted, widowed, deceased) so every
  relationship-rendering edge case has real, safe, reviewable data to design
  against.
- `CLAUDE.md`'s Status section is a long, granular, dated log of real user
  feedback, the investigation behind each fix, and how each was verified —
  treat it as the most current and most detailed record of "what's actually
  built and why it looks the way it does today." `README.md` and
  `docs/BUILD-PLAN.md` describe an earlier "Phase 1" snapshot of the product
  and are materially stale against current `CLAUDE.md`/source; prefer source
  and `CLAUDE.md` per `AGENTS.md`'s own documented source-of-truth order.

## Product Principles

1. **The tree is navigation, the profile is the destination, the stories are
   the product.** Never let tree-browsing mechanics upstage the person or
   story being viewed.
2. **A family, not a dataset.** Lead with people and memories before
   features, metrics, or research terminology, in copy and in visual
   hierarchy alike.
3. **Trust precedes conversion.** Privacy, ownership, invitations, and
   exports are explained before sensitive living-person information is ever
   asked for.
4. **Every family counts.** Relationship modeling and language must
   genuinely accommodate blended, step, adoptive, chosen, and non-traditional
   families — not just the nuclear-family default.
5. **Bespoke where it matters, restrained everywhere else.** The tree
   visualizations and the Keepsake are deliberately unlike generic
   application UI; forms, settings, and management surfaces should be calm,
   clear, and unshowy by comparison. Distinctiveness is spent on the few
   surfaces where it earns its keep, not spread evenly across the whole app.

## Accessibility & Inclusion

No committed conformance standard (see Capabilities and Constraints →
Undecided). Known, product-specific requirements that already exist and must
be preserved: `prefers-reduced-motion` support throughout, `:focus-visible`
styling, a fully semantic/keyboard-navigable list view as a first-class
parallel to the visual tree (never a degraded fallback), 44×44px minimum
touch targets on public pages, and inclusive relationship modeling for
non-traditional family structures (see Brand Commitments).

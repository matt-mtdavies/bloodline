# Bloodline

A living portrait of your family. Not a genealogy database with a tree bolted
on — the **visualization and the feeling are the product**, and the data is the
byproduct people happily produce because tapping around a portrait of their
family is genuinely delightful.

> **Status: Phase 1 — the magic.** This build is the visualization plus the
> scaffold it needs, seeded with a demo family. Per the brief, stop here for
> review before Phase 2.

## What's in Phase 1

The whole moat is the bubble view (`src/viz/`):

- **Ego-centric camera.** The tree never renders flat. It centres on one person;
  their partner, parents, children and siblings are large, everyone else
  recedes — smaller, softer, blurred. Tap any face and the entire graph
  **springs to re-centre** on them. That glide is the product.
- **Always alive.** A continuous `d3-force` simulation gives the bubbles a gentle
  perpetual drift, so it breathes instead of sitting like an org chart.
- **Faces, not names.** Every bubble is a circular portrait. No photo? A warm,
  deterministic monogram derived from the name — never a grey placeholder.
- **Couples as one unit.** Partners are bound by a soft membrane. Divorce,
  remarriage, step-, adoptive and widowed relationships all render distinctly
  and gracefully from day one (open the key in the top bar).
- **Person card.** Tap the centred bubble to open an elegant profile sheet
  without losing the tree behind it.
- **A parallel accessible view.** A fully semantic, keyboard-navigable list view
  (top-bar toggle) — the visual interface is never the only way in.
- **Motion is the brand.** Spring physics everywhere; nothing snaps. Honours
  `prefers-reduced-motion`.

Rendering is **PixiJS (WebGL)** so it stays fluid well past the point DOM/SVG
trees die. Layout is `d3-force`; the camera animates independently of the
simulation via a small spring integrator (`src/lib/spring.js`).

## Run it

```bash
npm install
npm run dev          # http://localhost:5173 — opens on the seeded Davies family
```

The demo opens centred on **James**. Tap faces to fly around. Try the **List
view** and the **key** (top-right). Best felt on a phone.

> Faces in the demo come from randomuser.me, so the first load needs network;
> everything else, including all monograms, works offline.

### Smoke test

A headless Chromium check boots the app and fails on any real JS error — it
verifies the canvas mounts, tapping the centred bubble opens the person sheet,
and the tree re-centres onto a relative, saving screenshots to
`tests/screenshots/`.

```bash
npm run dev          # one shell
npm run test:e2e     # another
```

## Stack & scaffold

Everything is Cloudflare, matching the target stack (§2):

- **Frontend:** React + Vite, installable PWA (`vite-plugin-pwa`).
- **Backend:** Cloudflare Pages Functions (`functions/`).
- **Database:** D1 (SQLite) — schema in `migrations/0001_init.sql`.
- **Storage:** R2 for photos. **Email:** Brevo for magic links. **AI:** Anthropic
  (server-side only) — both wired for Phase 2/3.
- **Auth:** magic links only, no passwords (`functions/api/auth/`).

Phase 1 runs entirely off the bundled seed (`src/data/seed.js`) so the magic is
testable with zero backend setup. The same data also generates the D1 seed, and
`GET /api/tree` already serves the identical shape — so the client can switch to
the live graph with no code change.

### Provisioning the backend (optional for Phase 1)

```bash
cp .dev.vars.example .dev.vars      # add Brevo / Anthropic / session secret
npx wrangler d1 create bloodline    # paste the id into wrangler.toml
npm run db:migrate                  # apply schema to local D1
npm run seed:gen && npm run db:seed # load the demo family into D1
```

## Data model

The core primitive is *a person relative to someone*. Only directional
`parent` and `partner` edges are stored; **siblings are derived**
(`src/data/graph.js`). Partial dates, `confidence: uncertain`, living-vs-deceased
and minor flags are all first-class. `edit_log` exists in the schema from day one
because it will power both the activity feed and conflict resolution (Phase 3).

## Project layout

```
src/
  viz/            PixiJS bubble tree, bubbles, links/membranes
  lib/            spring camera, deterministic colours, date formatting
  data/           seed family + graph helpers (BFS distance, derived siblings)
  components/     person sheet, accessible tree, legend, top bar, avatars
  styles/         design tokens + components (hardcoded hex; light-only)
functions/        Cloudflare Pages Functions (tree API, magic-link auth)
migrations/       D1 schema
scripts/          generate seed.sql from the single source of truth
```

## Roadmap

- **Phase 2 — frictionless creation:** relationship-first add, progressive
  disclosure, photo tagging, conversational entry (Anthropic), auto-bios,
  cold-start wizard, GEDCOM/JSON export.
- **Phase 3 — the loop:** personal land-on-yourself invites, claim-and-merge with
  fuzzy dedup, activity feed, micro-ask prompts, memorialization, completeness
  meter, privacy enforcement.

We never sell family data and there is no ad tracking.

# Repository instructions

These rules apply to every human and automated contributor.

## Source of truth

When sources disagree, use this order:

1. Current production requirements and an explicit instruction from the repository owner.
2. Current source, tests, migrations, and deployment configuration.
3. `docs/SAFETY.md`, `docs/ARCHITECTURE.md`, and `PRODUCT.md`/`DESIGN.md` (product intent and
   design language — see below).
4. `docs/OPERATING-SYSTEM.md` and `CONTRIBUTING.md`.
5. Historical plans, status notes, and agent memory such as `CLAUDE.md`.

Do not silently resolve a material contradiction. Record it in the pull request.

## Product and design intelligence

`PRODUCT.md` and `DESIGN.md` (repository root) codify durable product truth and
Bloodline's existing visual/interaction language, generated and maintained with the
Impeccable plugin (`.claude/settings.json`; `/impeccable` commands). They document
decisions the product already made — they never supersede an explicit instruction
from the repository owner or the actual behavior of current source. When a UI change
is requested:

1. Read `PRODUCT.md` and `DESIGN.md` before touching styling, layout, or interaction
   patterns, the same way you would read `docs/ARCHITECTURE.md` before touching
   storage.
2. Treat Bloodline's own conventions (warm/editorial palette, pill/soft-radius shape
   language, spring-eased motion, the deliberate absence of a generic card/dashboard
   pattern) as the standing default. Impeccable's general design-quality heuristics
   inform HOW well a change executes Bloodline's own direction — they do not replace
   that direction with generic best-practice defaults.
3. The organic/Bubble tree, Chart, Canopy, and Atlas visualizations, and the Keepsake
   reading experience, are intentionally bespoke (`DESIGN.md`'s "Bespoke surfaces" /
   Do's-and-Don'ts). Do not simplify them into conventional application patterns
   (standard org charts, generic cards, plain modals) without explicit product
   sign-off. `TreeMotionLab`/`FocusLab`/`AtlasLab` (`?lab=...`) are internal
   engineering experimentation harnesses, never shipped UI, and out of scope for
   design review.
4. Any design tool, agent, or automated review pass — Impeccable included — may look
   at a real, authenticated family's data **read-only, for context only**. It must
   never screenshot, export, copy, or otherwise persist real family photos, names, or
   other identifying content into any file, artifact, commit, design doc, or
   third-party service. Every screenshot, recorded artifact, or shared design-review
   asset must use the bundled demo/seed family (`src/data/seed.js`, `npm run dev` with
   `?demo`) — this directly extends the family-data rule above.
5. Update `PRODUCT.md`/`DESIGN.md` (via `/impeccable document` or a direct edit) when
   a change genuinely shifts product truth or the visual system — not for every
   feature. Keep them a durable reference, not a running changelog; `CLAUDE.md`
   remains the detailed, dated record of what changed and why.

## Working rules

- Begin from current `main` and work on a short-lived branch.
- **Merge authority:** Codex may squash-merge its own reviewed pull requests once all
  required checks are green. Explicit repository-owner approval is still required before
  merging any pull request that changes migrations, production configuration, billing,
  deletion/reset/restore/import-replace behavior, or another explicitly high-risk area.
- Keep changes within the requested scope; preserve unrelated work.
- Classify risk before editing and use the verification required by
  `docs/OPERATING-SYSTEM.md`.
- Never expose family data, credentials, access tokens, private URLs, or production
  exports in commits, fixtures, logs, screenshots, prompts, or third-party tools.
- Do not run production mutations, migrations, destructive storage operations, or
  deployments without explicit authorization and the safeguards in `docs/SAFETY.md`.
- State what was actually verified. Never claim that a branch was pushed, a pull
  request was opened, or a deployment completed without a verifiable URL or result.

Project-specific agent notes may add context but may not weaken these rules.

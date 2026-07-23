# Full Archive Export — Phase A status + human-operator runbook

Companion to `docs/FULL-ARCHIVE-EXPORT.md` (the design) — this doc tracks what
Phase A actually delivered in an agent sandbox with no Cloudflare account
access, and exactly what a human operator needs to do next. Same pattern as
`docs/TREE-STORAGE.md` §11: some steps need real `wrangler login` credentials
that don't exist in this environment.

## What Phase A delivered (built, tested, and verified here)

All of it lives in `workers/export-workflow/` — a new, separate package, not
yet deployed anywhere:

- `src/lib/archivePath.js` — the archive path sanitizer (traversal, Unicode
  confusables, invisible/bidi characters, Windows-reserved characters).
- `src/lib/budgets.js` — every Workflow/packaging size and CPU budget from
  §2.6, plus a generic sharding helper.
- `src/lib/inventory.js` — walks a captured logical tree and classifies every
  media reference (`data:` URL, `/api/photos|documents/{key}`, external URL)
  without ever listing the flat R2 bucket; Keepsake prefix listing +
  `latest.json` alias de-duplication by ETag.
- `src/lib/activityLog.js` — the dual-cursor keyset-paginated `activity_log`
  extraction, proven against a **real in-memory SQLite database**
  (`node:sqlite`) with the exact schema from `migrations/0008_activity_log.sql`
  — including a test that a row inserted *after* the export's upper bound is
  captured is correctly excluded (the concurrent-edit case §4.3 requires).
- `src/lib/manifest.js` — manifest v1 builder, canonical/deterministic JSON
  serialization, and SHA-256 (via `node:crypto`, confirmed supported in
  Workers under `nodejs_compat`).
- `src/lib/crc32.js` — a hand-rolled, table-based CRC-32, verified against
  Node's own `zlib.crc32()` as an independent oracle.
- `src/lib/zipWriter.js` — the streaming ZIP64 writer. Every entry defers
  CRC/sizes to a data descriptor uniformly; ZIP64-or-not is decided from a
  required, caller-supplied size hint *before* the local header is written
  (with a hard runtime check that throws if the hint turns out to be wrong,
  rather than silently emitting a mismatched archive). **Verified against two
  genuinely independent readers** — Info-ZIP's `unzip`/`zipinfo` and Python's
  `zipfile` module — across store-only, deflate, forced-ZIP64-per-entry, and
  mixed normal/ZIP64 archives in the same file.
- `src/lib/contentIndex.js` — the `content-index.json`/`tree-data.js`
  generator. **Flags a real ambiguity found while building the viewer**: the
  directory layout in §3.2 pairs `tree.json`+`tree-data.js` adjacently, but
  §3.5's prose ties `tree-data.js` to this module's own (originally narrower)
  index — and a narrow index can't satisfy §3.8's viewer requirements at all
  under `file://`, which has no `fetch()`. Resolved for Phase A by having this
  module carry full per-person profile/life-event/memory data so the one
  `tree-data.js` file the layout shows is actually sufficient — see the
  module's own header comment. **Needs Codex's confirmation or correction in
  the next brief revision.**
- `src/START-HERE.html` + `src/viewer/{app.js,styles.css,fonts/,licenses/}` —
  the offline viewer. Fraunces + Hanken Grotesk sourced from Google's own
  `google/fonts` GitHub repo (OFL-licensed), subsetted to Latin and converted
  to static WOFF2 with `fonttools` — license text bundled alongside. **Verified
  live via Playwright against a genuine `file://` URL** (not a dev server):
  zero network requests of any kind, zero console errors, full profile
  rendering (scalar fields, life events, memories, relationship navigation,
  missing-media warnings), keyboard tab order, and the bundled font actually
  loading.
- `.github/workflows/export-workflow.yml` — this repository's first-ever
  GitHub Actions workflow (see below). Runs the full unit suite AND the
  Playwright viewer test in CI (installs Chromium itself) — both were
  originally only run locally, a real gap flagged in review. Pinned to
  Node 22.5+ (`workers/export-workflow/.nvmrc`, separate from the main
  app's own Node 20 `.nvmrc`) because `tests/activityLog.test.mjs` uses
  `node:sqlite` as an independent correctness oracle, which doesn't exist
  on Node 20. The regression-guard job runs the main app's own suite
  through `scripts/run-tests-ci.mjs`, which tolerates only the one
  documented pre-existing `relations.test.mjs` failure (unrelated to this
  feature) rather than either blocking on it or blanket-ignoring the file.

Every module above is pure/injectable-I/O — no real D1 or R2 binding is
touched anywhere in Phase A. 145 unit-test assertions total across 8 files in
`workers/export-workflow/tests/*.test.mjs`, all passing, plus 31 live-browser
assertions in `tests/viewer.e2e.mjs` — both now enforced in CI (see below),
not just run locally.

## What Phase A deliberately did NOT do

Per §12: no production bindings, no UI wired into the live app, no D1
migration applied anywhere real, no Worker ever deployed. `wrangler.toml`
contains a placeholder `database_id` (`REPLACE_WITH_REAL_DATABASE_ID`) and
must not be deployed as-is.

## The one-day infrastructure spike (§2.4) — needs a human operator

This environment has no `wrangler login` session and no Cloudflare API
access (confirmed: `wrangler whoami` reports "not authenticated," matching
the same constraint documented in `docs/TREE-STORAGE.md` §11 for the tree-
storage rollout). Someone with real account access needs to prove the five
things §2.4 requires **before Phase B begins**:

1. **Pages can invoke the separate Worker through a service binding in the
   target account.**
   - `cd workers/export-workflow && wrangler login`
   - Fill in the real `database_id` in `workers/export-workflow/wrangler.toml`
     (must match the root `wrangler.toml`'s `[[d1_databases]]` entry exactly).
   - `wrangler deploy` (first real deploy of this Worker — creates
     `bloodline-export-workflow`).
   - In the main Pages project's Cloudflare dashboard (Settings → Functions →
     Service bindings), add a binding named `EXPORT_WORKFLOW_SERVICE` pointing
     at `bloodline-export-workflow`.
   - Write a throwaway Pages Function that calls
     `env.EXPORT_WORKFLOW_SERVICE.ping()` (a temporary method, deleted after
     this check) and confirm it round-trips in a deployed preview.

2. **The selected Workers plan supports the configured Workflow CPU and step
   budgets.** Confirm the account is on a plan that allows `limits.cpu_ms =
   300000` (5 minutes) — already set in `workers/export-workflow/wrangler.toml`
   — and that Workflows are enabled for the account at all (Workflows may
   require an explicit opt-in or a specific plan tier; check the Cloudflare
   dashboard's Workflows section).

3. **D1 and the EU-jurisdiction R2 bucket can be bound to that Worker without
   creating a second source of truth.** After the deploy in step 1, confirm
   via `wrangler d1 execute bloodline --remote --command "SELECT 1"` (run
   from `workers/export-workflow/`) that this Worker's D1 binding resolves to
   the *same* database as the main Pages project's — not a copy.

4. **A killed/retried instance resumes a multipart upload idempotently.**
   This needs a small real Workflow with 2-3 steps and a deliberate mid-run
   kill (e.g. `wrangler workflows instances terminate` or a forced
   exception) to confirm Cloudflare's own retry/resume semantics behave as
   the design assumes — this can't be simulated without a live Workflow
   instance.

5. **Deployment and rollback can be operated independently from the Pages
   project.** Confirm `wrangler deploy`/a rollback to a prior Worker version
   don't require touching the Pages project at all, and vice versa.

**If any of these five fail or behave unexpectedly, stop and revise the
design** (§2.4's own words) — do not silently fall back to an in-request ZIP
or a different architecture without updating `docs/FULL-ARCHIVE-EXPORT.md`
first.

## Making the CI workflow fully active

`.github/workflows/export-workflow.yml` is already green today (it only runs
what Phase A can prove without credentials). Two repo secrets activate the
last job once the spike above is done:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` — scoped only to deploy `bloodline-export-workflow`
  and use its D1/R2 bindings, per §10.3's own instruction not to over-scope it.

Add both under the repo's Settings → Secrets and variables → Actions. The
`wrangler-dry-run` job will start actually running instead of skipping itself
the next time it's triggered.

## Everything else in §12's Phase A checklist

`content-index.json`/`tree-data.js` definitions, budget enforcement, and the
Worker dry-run/branch-preview-isolation proof are all done except the literal
`wrangler deploy --dry-run` execution itself (folded into the CI job above,
gated on the secrets). Nothing else in Phase A is blocked on human action.

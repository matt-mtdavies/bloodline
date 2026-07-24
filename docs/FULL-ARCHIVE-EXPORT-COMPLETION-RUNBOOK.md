# Full Archive Export — completion-phase status + human-operator runbook

Companion to `docs/FULL-ARCHIVE-EXPORT-COMPLETION-PHASE.md` (the brief this
implements), `docs/FULL-ARCHIVE-EXPORT-PHASE-A-RUNBOOK.md` (Phase A's own
equivalent doc), and `docs/FULL-ARCHIVE-EXPORT-TEST-FAMILY-GATE.md` (the
disposable-family rollout gate step 8 below now uses). Same pattern as all
three: this environment has no `wrangler login` session and no Cloudflare
API access, so everything below that needs real account access is a
template for a human operator to fill in and run, not something this
session could execute itself.

## What the completion phase delivered (built, tested, and verified here)

All seven slices from `docs/FULL-ARCHIVE-EXPORT-COMPLETION-PHASE.md` §14:

1. **Migration + domain/state helper** — `migrations/0014_export_jobs.sql`
   (`family_export_job`/`family_export_audit`, with the partial unique index
   explicitly covering `cancelling` — closing the exact race window PR #8's
   review flagged) and `functions/_lib/exportJob.js` (the shared state graph,
   serializer, and public error codes both the Pages Functions and the
   Workflow Worker import — the latter across the deploy boundary via a
   relative path, proven by `workers/export-workflow/tests/
   exportJobSchema.test.mjs` running the real migration SQL against
   `node:sqlite`).
2. **Worker RPC + capture/activity/inventory** — fixed the Phase A
   `ExportWorkflowEntrypoint` defect (it never extended `WorkerEntrypoint`,
   so it wasn't a valid RPC target at all — also a PR #8 review finding) and
   implemented the first six stable steps.
3. **Multipart packaging/verification/cancellation/cleanup** — the remaining
   seven steps, `src/lib/packaging.js`'s checkpointed multipart pipeline
   (persists any not-yet-a-full-part buffer across Workflow step boundaries
   — losing it would silently corrupt the archive, since R2/S3 forbids
   non-final parts under 5 MiB), the `requires_segmented_export` guard
   (`BUDGETS.segmentedExport`, also a PR #8 finding that had no backing
   constant before this), and a genuine pre-existing ZIP64 bug fixed along
   the way (the local-header decision only checked an entry's own size, not
   the running archive offset — would corrupt any entry past ~4 GiB).
4. **Family + admin export API endpoints** — `functions/_lib/exportService.js`
   (the one shared authority/serialization service) plus nine thin route
   files under `functions/api/exports*` and `functions/api/admin/exports*`.
5. **Family Settings export UI** — `src/components/ExportArchiveCard.jsx`,
   the "Complete Bloodline archive" card alongside the existing GEDCOM
   export button.
6. **Administrator Family Exports UI** — a dedicated section in
   `public/admin.html`, its own nav entry and its own independent
   authorization probe (separate from the rest of the dashboard's
   `ADMIN_EMAILS` gate).
7. **CI, completion email, runbook, deployment contract** — this doc; the
   completion email (`sendCompletionEmailStep`, best-effort, via the
   existing `sendEmail` helper); `.github/workflows/export-workflow.yml`'s
   trigger paths broadened to cover the shared modules above; `wrangler.toml`
   (both root and `workers/export-workflow/`) carrying the flag-off vars,
   the commented service binding, and the commented Cron Trigger — all
   ready to uncomment, none of it live.

Every module is proven against fakes (D1 via a real `node:sqlite` schema
oracle where it matters, R2 via an in-memory store supporting the real
multipart API shape) — **210 assertions passing in
`workers/export-workflow/tests/*.test.mjs`**, plus new coverage in the main
app's own suite (`tests/exportJob.test.mjs`, `tests/exportService.test.mjs`).
No real D1 row, R2 object, or Workflow instance has ever been touched.

## What the completion phase deliberately did NOT do

Per §15: `ENABLE_FULL_EXPORT` ships `"false"`, `EXPORT_ADMIN_EMAILS` ships
empty, the `EXPORT_WORKFLOW_SERVICE` binding and the cleanup Cron Trigger
both ship commented out. No production mutation, no real deploy, no
migration applied anywhere real.

## Gate 0 — the infrastructure proof (§2)

This is the SAME five-point spike Phase A's own runbook already describes in
detail (`docs/FULL-ARCHIVE-EXPORT-PHASE-A-RUNBOOK.md`'s "one-day
infrastructure spike" section) — it was never actually run, since it needs
real credentials this environment doesn't have. Re-confirm all five points
there before proceeding past step 2 below. Record the result of each here:

```text
Operator:
Date:
Account/project:
Worker version deployed:
Test instance ID used:
1. Pages -> Worker service binding round-trip:        PASS / FAIL — notes:
2. Workflow CPU/step budget + plan support confirmed:  PASS / FAIL — notes:
3. D1/R2 bind to the SAME production resources:        PASS / FAIL — notes:
4. Forced-retry multipart survives without duplicate output: PASS / FAIL — notes:
5. Deploy/rollback independent of Pages:               PASS / FAIL — notes:
6. A preview deployment cannot reach production export bindings: PASS / FAIL — notes:
Rollback tested: YES / NO — result:
```

**If any point fails, keep `ENABLE_FULL_EXPORT` at `"false"` and revise the
design** — do not proceed to the rollout sequence below.

## The 16-step named-human rollout (§15)

Record operator, date, and result for each step. Stop immediately and follow
the rollback sequence below on: cross-family leakage, incomplete required
tree, authorization mismatch, ZIP failure, wrong binding/jurisdiction,
multipart corruption, or an expiry/private-download failure.

```text
 1. Confirm D1 backup / Time Travel readiness.                    [ ]
 2. Complete Gate 0 (above).                                       [ ]
 3. Apply migrations/0014_export_jobs.sql to production D1.        [ ]
 4. Deploy workers/export-workflow (fill in the real database_id
    first — it must match root wrangler.toml's [[d1_databases]]
    entry exactly). Record the Worker version.                     [ ]
 4a. Provision this Worker's OWN email config — secrets/vars are
     never shared across separately-deployed Workers, so the root
     project's FROM_EMAIL/APP_URL/BREVO_API_KEY do not carry over:
     confirm workers/export-workflow/wrangler.toml's [vars] block
     (APP_URL, FROM_EMAIL) matches the root wrangler.toml, then run
     `cd workers/export-workflow && npx wrangler secret put
     BREVO_API_KEY` with the same Brevo key the main project uses.
     Left unset, completion emails silently no-op (best-effort by
     design) rather than failing an export — confirm at least once
     that a completion email actually arrives before relying on it. [ ]
 5. Configure the EXPORT_WORKFLOW_SERVICE service binding on the
    main Pages project (uncomment the [[services]] block in the
    root wrangler.toml, or add it via the dashboard).               [ ]
 6. Configure the R2 lifecycle rule on `exports/` (7-day hard
    backstop, §5) and uncomment the [triggers] cron in
    workers/export-workflow/wrangler.toml (hourly cleanup sweep).    [ ]
 7. Deploy the Pages project with ENABLE_FULL_EXPORT still "false". [ ]
 8. Synthetic disposable-family byte-comparison test, gated by
    FULL_EXPORT_TEST_FAMILY_IDS instead of the general release flag
    (docs/FULL-ARCHIVE-EXPORT-TEST-FAMILY-GATE.md): create a clearly
    named disposable family containing only synthetic data, record
    its ID privately outside GitHub/AI tools, set
    FULL_EXPORT_TEST_FAMILY_IDS to that one ID (ENABLE_FULL_EXPORT
    stays "false"), run the normal owner export lifecycle end-to-end
    and diff the archive's tree.json against a direct API pull, then
    remove the family ID and verify every export route (create,
    history, status, cancel, download) is revoked on the next
    request before proceeding.                                      [ ]
 9. Rehearse against the site-owner's own real family too — WITHOUT
    turning on general release yet: add the site-owner's real family
    ID alongside (or in place of) the disposable one in
    FULL_EXPORT_TEST_FAMILY_IDS (ENABLE_FULL_EXPORT stays "false").
    The allowlist is the only mechanism that can scope this to one
    family — ENABLE_FULL_EXPORT itself is always global, so "true,
    scoped to one family" was never actually possible; step 11 below
    is where it's turned on for everyone.                            [ ]
10. Verify the full lifecycle end-to-end: create, progress,
    download, offline viewer opens, audit trail, cancel, expiry.    [ ]
11. Enable owner/co-admin generally (all families).                [ ]
12. Observe one full 72h retention window with no incidents.        [ ]
13. Add exactly one named email to EXPORT_ADMIN_EMAILS.              [ ]
14. Perform one documented admin export of the SAME authorized
    test family used in step 8.                                     [ ]
15. Verify administration-only files present, reason/audit
    recorded correctly, and access revokes when the email is
    removed from EXPORT_ADMIN_EMAILS.                                [ ]
16. Enable the fully approved EXPORT_ADMIN_EMAILS list.              [ ]
```

### Rollback

Disable creation first — this now requires clearing BOTH controls, not
just one: set `ENABLE_FULL_EXPORT="false"` AND empty
`FULL_EXPORT_TEST_FAMILY_IDS`. Neither alone is sufficient once both have
ever been set together — `ENABLE_FULL_EXPORT="false"` no longer stops all
`POST /api/exports*` calls by itself whenever the test allowlist is still
non-empty (docs/FULL-ARCHIVE-EXPORT-TEST-FAMILY-GATE.md's whole point is
that the allowlist keeps working independently of that flag). After
clearing both, verify by confirming create/list/status/cancel/download all
return `export_not_configured` for the family that was previously
allowlisted, the same revocation check step 8/9 already performs — don't
just assume clearing the vars took effect. Preserve any already-`ready`
downloads unless confidentiality is specifically in doubt. Redeploy the
last-known-good Worker version recorded in step 4. Abort any in-progress
multipart uploads (the scheduled cleanup sweep does this automatically for
anything older than 7 days — `wrangler workflows instances terminate` for an
immediate manual abort). **Never** reverse the migration or delete audit
rows.

## Making the CI workflow fully active

Same two repo secrets as Phase A's runbook already describes — nothing new
needed here:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The `wrangler-dry-run` job starts actually running (instead of skipping
itself) the moment both exist under Settings → Secrets and variables →
Actions.

## Everything else

Nothing else in the completion-phase brief is blocked on human action —
every remaining checklist item in §16's "Final definition of done" is code
that's already written, tested, and merged; what's left is exclusively the
rollout sequence above.

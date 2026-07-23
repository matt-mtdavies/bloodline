# Full Archive Export — completion-phase implementation brief

**Status:** ready for Claude implementation review
**Design owner:** Codex
**Implementation owner:** Claude
**Depends on:** Phase A merged in PR #7 and `docs/FULL-ARCHIVE-EXPORT.md`
**Risk:** R2 implementation; R3 migration, privileged administration and production rollout
**Outcome:** family owners, co-admins and separately allowlisted site administrators can prepare, monitor and download a complete archive containing every family detail Bloodline still holds.

This is the final implementation phase. It combines the former Phase B owner/co-admin work and Phase C site-administrator override. There is no later functional export phase. Where this brief and the master design differ, this brief controls the implementation sequence and combined scope; current code and tests still outrank both.

## 1. Completion scope

The implementation PR must deliver:

- forward-only D1 job and audit migrations;
- the production Cloudflare Workflow Worker behind the Phase A libraries;
- exact legacy/split-tree capture, complete durable activity extraction, inventory, ZIP64 packaging and verification;
- private R2 staging/final artifacts, cancellation, expiry and reconciliation;
- owner/co-admin create, list, status, cancel and authenticated download endpoints;
- the same pipeline for separately allowlisted site administrators targeting any exact family;
- Family Settings export UI;
- a dedicated administrator Family Exports UI;
- persistent job history, progress, warnings, failures, expiry and retry;
- best-effort completion email linking to an authenticated screen;
- production deployment behind `ENABLE_FULL_EXPORT=false`;
- a named-human rollout, rollback and audit rehearsal.

Not in scope:

- archive import/restore;
- encrypted/password-protected ZIPs;
- segmented archives below the R2 platform boundary;
- scheduled recurring archives;
- public/bearer R2 URLs.

## 2. Gate 0 — infrastructure proof

Code may be developed locally, but production mutation must not begin until a named human records the Phase A infrastructure spike in `docs/FULL-ARCHIVE-EXPORT-COMPLETION-RUNBOOK.md`.

Prove:

1. Pages invokes `bloodline-export-workflow` through `EXPORT_WORKFLOW_SERVICE`;
2. the Worker binds to the existing production D1 database and existing EU `bloodline-docs` bucket;
3. a real Workflow survives a forced retry without duplicating multipart output;
4. Worker deploy/rollback is independent of Pages;
5. the plan supports the selected Workflow/CPU/R2 limits;
6. previews cannot reach production export bindings.

Record operator, date, account/project, Worker version, test instance, result and rollback result—never credentials or family data. If any proof fails, keep the feature flag off and revise the design. Do not fall back to `waitUntil()`, a long Pages request or browser packaging.

## 3. Authority model

Three equivalent full-content authority paths feed one pipeline:

- `owner`: current owner of their canonical family;
- `coadmin`: current co-admin of their canonical family;
- `site_admin`: signed-in user whose normalized email is explicitly present in `EXPORT_ADMIN_EMAILS`, targeting an exact selected family.

All three receive the complete, unredacted family-content archive. Person-level visibility does not filter it.

`EXPORT_ADMIN_EMAILS`:

- is separate from `ADMIN_EMAILS`;
- defaults to empty;
- has no legacy fallback;
- is case-normalized and whitespace-trimmed;
- is checked on create, list, status, cancel and download;
- grants nothing merely because a user can see the admin dashboard.

Every site-admin creation additionally requires:

- exact family selection by server-known ID;
- a reason of 10–500 characters;
- typed confirmation matching the current normalized family name;
- immutable audit entries for every lifecycle and download event.

Denied admin attempts are security events but must not log requested family content.

## 4. Persistence contract

Add the next numbered forward migration. Applied migrations remain immutable.

### `family_export_job`

Required columns:

```text
id TEXT PRIMARY KEY
family_id TEXT NOT NULL
requested_by_user_id TEXT NOT NULL
requested_as TEXT NOT NULL CHECK owner|coadmin|site_admin
request_reason TEXT
status TEXT NOT NULL
workflow_instance_id TEXT
source_tree_updated_at INTEGER
source_extra_version INTEGER
source_storage_mode TEXT
expected_files INTEGER
processed_files INTEGER DEFAULT 0
expected_bytes INTEGER
processed_bytes INTEGER DEFAULT 0
warning_count INTEGER DEFAULT 0
error_code TEXT
error_summary TEXT
archive_r2_key TEXT
archive_bytes INTEGER
archive_sha256 TEXT
manifest_sha256 TEXT
created_at INTEGER NOT NULL
started_at INTEGER
completed_at INTEGER
expires_at INTEGER
cancelled_at INTEGER
last_heartbeat_at INTEGER
```

Allowed states:

```text
queued → snapshotting → inventory → packaging → verifying
       → ready | ready_with_warnings
any non-terminal running state → cancelling → cancelled
any non-terminal running state → failed
ready states → expired
```

Indexes:

- `(family_id, created_at DESC)`;
- `(requested_by_user_id, created_at DESC)`;
- `(status, expires_at)`;
- a partial unique index on `family_id` with this literal predicate:

```sql
WHERE status IN (
  'queued', 'snapshotting', 'inventory', 'packaging',
  'verifying', 'cancelling'
)
```

`cancelling` deliberately remains locked until the first job reaches the
terminal `cancelled` state, so a second job cannot start while multipart/staging
cleanup is still in progress. The partial unique index is the concurrency
authority. Map its constraint failure to `409 export_already_active`; do not
use read-then-insert.

### `family_export_audit`

Required columns:

```text
id, job_id, family_id, actor_user_id, actor_email_snapshot,
actor_authority, event, reason, created_at
```

Events:

```text
requested, started, ready, ready_with_warnings, failed,
downloaded, cancel_requested, cancelled, expired
```

Audit rows are append-only. They may contain identity/authority/reason, but never people, filenames, document text, R2 keys, archive URLs, tokens or provider payloads.

### State helper

One shared transition module must:

- enforce expected prior state and monotonic transitions;
- reject transitions from terminal states;
- set timestamps/heartbeat consistently;
- cap sanitized internal summaries at 500 characters;
- batch the state update and audit event where applicable;
- expose only stable public error codes.

## 5. R2 contract

Server-generated keys only:

```text
export-staging/{jobId}/source/tree.json
export-staging/{jobId}/source/source.json
export-staging/{jobId}/inventory/{shard}.json
export-staging/{jobId}/activity/{shard}.ndjson
export-staging/{jobId}/central-directory/{shard}.bin
export-staging/{jobId}/checkpoint.json
exports/{jobId}/bloodline-full-archive.zip
```

Rules:

- clients never send or receive R2 keys;
- final objects stay private and immutable after verification;
- archive application expiry is 72 hours;
- R2 lifecycle on `exports/` is a seven-day hard backstop;
- staging/orphan multipart uploads are swept after seven days;
- cancellation/failure aborts incomplete multipart uploads;
- missing final object during expiry is idempotent success.

## 6. Shared Pages service

Create one export domain service under `functions/_lib/`. Route files must not reimplement authority or serialization.

Feature readiness requires:

- `ENABLE_FULL_EXPORT === "true"`;
- `EXPORT_WORKFLOW_SERVICE` exists;
- the migration exists;
- required Worker bindings are healthy.

Otherwise return `503` / `export_not_configured` without platform details.

### Family endpoints

```text
POST /api/exports
GET  /api/exports
GET  /api/exports/:id
POST /api/exports/:id/cancel
GET  /api/exports/:id/download
```

Rules:

- resolve canonical family server-side;
- require current `owner`/`coadmin`;
- never accept a family ID;
- scope job queries by job ID and resolved family ID;
- recheck authority on every operation, especially download;
- limit list to newest 20;
- return no R2 keys/internal errors.

### Administrator endpoints

```text
GET  /api/admin/export-families?query=
POST /api/admin/exports
GET  /api/admin/exports
GET  /api/admin/exports/:id
POST /api/admin/exports/:id/cancel
GET  /api/admin/exports/:id/download
```

`export-families`:

- requires `EXPORT_ADMIN_EMAILS`;
- supports bounded search by family ID/name;
- returns selection metadata only: family ID/name, owner identity, counts, storage mode and latest export status;
- does not return tree/person content.

Admin create body:

```json
{
  "familyId": "fam_...",
  "reason": "Owner requested a complete portability archive",
  "confirmFamilyName": "Davies Family"
}
```

Requery the family immediately before creation, normalize confirmation, validate reason, then insert. Do not trust search-result metadata sent back by the browser.

### Create semantics

- cryptographically random URL-safe `exp_` ID;
- insert `queued` and `requested` audit;
- call `createExport(jobId)`;
- Workflow instance ID equals job ID;
- ambiguous/repeated RPC calls return the existing legitimate instance;
- RPC failure transitions to `failed: workflow_start_failed`;
- family rate limit: three jobs per family per 24 hours;
- site-admin rate limit: ten jobs per administrator per hour;
- one active job per family across all authority paths.

### Cancel

- active states only;
- atomically transition to `cancelling` and audit;
- notify Worker best-effort;
- repeated request is idempotent;
- Workflow stops only at safe entry/part boundaries.

### Download

- require `ready`/`ready_with_warnings` and unexpired;
- recheck current authority immediately;
- stream private R2 object without buffering;
- `application/zip`, safe `Content-Disposition`, `private, no-store`, `nosniff`;
- audit authorized download;
- missing object returns generic `archive_unavailable` and alerts.

Owner/co-admin losing family authority or site-admin removal from the allowlist revokes existing downloads.

## 7. Worker RPC and Workflow

Replace Phase A stubs:

```js
createExport(jobId)
getExportInstance(jobId)
requestCancellation(jobId)
```

This requires correcting a Phase A defect, not merely filling in the method
bodies. `ExportWorkflowEntrypoint` must import and extend
`WorkerEntrypoint`:

```js
import { WorkerEntrypoint, WorkflowEntrypoint } from "cloudflare:workers";

export class ExportWorkflowEntrypoint extends WorkerEntrypoint {
  // narrow RPC methods
}
```

The Phase A class is currently a plain class and therefore is not a callable
RPC service-binding target. Add a service-binding integration test that would
fail if the base class is removed.

Validate job grammar, matching D1 row/state and instance identity. RPC payloads contain no family data.

Add `FamilyArchiveExportWorkflow extends WorkflowEntrypoint` using the current Cloudflare Workflows API. Creation payload:

```json
{ "jobId": "exp_...", "schemaVersion": 1 }
```

Both exported entrypoint classes must be reachable from the module configured
as `wrangler.toml`'s `main` (`src/entrypoint.js`). They may import
implementation helpers from other files, but `ExportWorkflowEntrypoint` and
`FamilyArchiveExportWorkflow` themselves must be exported from that main
module so the RPC service binding and `[[workflows]].class_name` can resolve
them.

Stable step plan:

1. `v1-authorize-job`
2. `v1-capture-source`
3. `v1-capture-activity-bound`
4. repeated `v1-capture-activity-{page}` steps
5. `v1-build-inventory`
6. repeated `v1-resolve-inventory-{shard}` steps
7. `v1-start-multipart`
8. repeated `v1-package-{checkpoint}` steps
9. `v1-complete-multipart`
10. `v1-verify-archive`
11. `v1-finalize-job`
12. `v1-send-completion-email`
13. `v1-clean-staging`

Step names never contain private identifiers beyond job/checkpoint sequence. Step results contain bounded references/counts/cursors/checksums only.

### Capture

- read exact `family_tree` row once;
- parse core and exact `_extraVersion`;
- fetch/reassemble that exact extra through shared `treeStore` semantics;
- fail `source_corrupt` for invalid core;
- fail `source_incomplete` for missing/unreadable required extra;
- write exact logical tree/source descriptor to staging;
- record timestamp/storage mode/version.

No second “latest tree” read. Edits continue but do not alter the snapshot.

### Activity

Do not call Phase A's whole-history `extractActivityLog()` loop inside one
Workflow step. Refactor/expose a pure single-page helper while retaining the
existing tested composite-cursor semantics:

- `v1-capture-activity-bound` captures the inclusive upper
  `(created_at, id)` cursor once;
- each repeated page step reads at most 500 rows after the stored lower cursor
  and at/before that upper cursor;
- the page is written to one immutable staging shard;
- the step returns only shard key, row count and next lower cursor;
- the next deterministic step runs until a page reports `done`;
- a retry rewrites the same shard bytes/key or confirms the existing checksum;
- page/step count is capped by the captured upper bound, not by later inserts.

This keeps arbitrarily long histories checkpointed and each step result
bounded. Missing `activity_log` fails `activity_log_unavailable`; never
substitute capped `tree.activity`.

### Inventory

- derive photo/document keys only from captured tree;
- list Keepsakes only under exact family/person prefixes;
- never list the flat bucket;
- ≤100 metadata operations/step, concurrency 10;
- shards ≤500 entries and ≤512 KiB;
- preflight file/byte counts and the segmented-export boundary defined below;
- missing individual media becomes warning;
- external URLs are recorded, never fetched;
- missing required tree extra already failed capture.

### Package

- Phase A streaming ZIP64 writer;
- deterministic lexical paths;
- 16 MiB non-final R2 multipart parts;
- at most one part plus documented overhead in memory;
- checkpoint upload ID and `{partNumber, etag}` after every part or 100 entries;
- reconcile uploaded parts on retry;
- never rewrite a part number with different logical bytes;
- abort/restart only when reconciliation is impossible;
- store compressed media/PDF/office formats; bounded DEFLATE for text;
- progress update at most once per part or ten seconds.

Before `v1-start-multipart`, compute a conservative
`projectedArchiveBytes` from included source bytes, exact generated-file
bytes, encoded archive-path bytes and a documented ZIP header/central-directory
reserve. Add and test these Phase A `BUDGETS` constants:

```js
segmentedExport: {
  maxProjectedBytes: 4 * (1024 ** 4),
  maxProjectedParts: 9500
}
```

Calculate `projectedParts = ceil(projectedArchiveBytes / selectedPartBytes)`.
Fail `requires_segmented_export` before starting multipart when either
projected value is **greater than or equal to** its threshold. The 9,500-part
guard is expected to trigger before 4 TiB with 16/32 MiB parts; the byte guard
still documents the product boundary if part sizing changes.

During packaging, independently fail with the same code before uploading part
9,500 if the conservative estimate was low. This is a terminal, non-retryable
job failure whose user copy says the family exceeds the current single-archive
platform boundary. It does not silently omit content, and it does not imply
segmented archives are implemented.

### Verify

Before ready:

- complete multipart;
- compare final `head()` size;
- range-read/parse central directory/footer;
- validate file count, ledger and required root entries;
- validate manifest checksum in D1 and R2 metadata;
- reject unexpected paths;
- set `ready_with_warnings` iff inventory warnings exist;
- set 72-hour expiry and audit.

Verification failure quarantines/deletes final output and returns `archive_verification_failed`.

Completion email is best-effort after readiness. Family emails link to Family Settings; administrator emails link to the admin export screen. Neither contains a bearer archive URL.

### Cancellation/failure

Check D1 cancellation state between every shard/part. Abort multipart, delete staging best-effort and audit. Retry transient D1/R2/Workflow failures with bounded exponential backoff. Never retry corrupt source, schema, authorization or budget failures.

## 8. Cleanup/reconciliation

Scheduled Worker handler:

- expires ready jobs after 72 hours and deletes final objects;
- audits expiry once;
- reconciles active jobs with heartbeat older than 30 minutes;
- aborts orphan multipart/staging older than seven days;
- reconciles when lifecycle deleted first;
- processes bounded pages per invocation.

No cleanup scan may be unbounded.

## 9. Archive authority contents

All three authority paths get:

- exact unfiltered `tree.json`;
- complete `activity-log.json`;
- every available referenced media/document/thumbnail;
- retained Keepsakes;
- manifest, reports and offline viewer.

Additionally, site-admin exports include:

```text
data/administration/members.json
data/administration/invitations.json
```

Members include identity, role and joined timestamp. Invitations include address, intended role, status and timestamps. Remove invitation tokens, magic links, sessions and provider payloads.

Owner/co-admin archives do **not** include the administration directory unless later policy explicitly changes.

## 10. Family Settings UX

Add a dedicated **Export** section with two cards.

**GEDCOM family tree**

- “For Ancestry, MyHeritage, FamilySearch and other genealogy services.”
- standard people/dates/places/relationships;
- explicit exclusion of photos, memories, documents and Keepsakes;
- existing client-side action.

**Complete Bloodline archive**

- every person/private field, relationship, memory, photo, document and Keepsake;
- includes living people and children;
- background preparation and 72-hour expiry;
- enabled for owner/co-admin;
- visible-disabled for lower roles with explanation.

Confirmation:

- privacy warning;
- ordinary unencrypted ZIP warning;
- snapshot explanation;
- **Prepare complete archive**;
- no typed family confirmation for owner/co-admin.

History/status:

- queued, snapshotting, inventory, packaging, verifying, cancelling;
- ready, ready with warnings, failed, cancelled, expired;
- file/byte progress;
- warning count without sensitive filenames;
- Download, Cancel, Prepare new archive as appropriate.

Polling: 2s first 30s, then 5s; pause hidden; refresh on visible; stop terminal; abort on unmount.

Accessibility:

- polite stage announcements, not every byte;
- keyboard/focus management;
- color-independent state;
- reduced motion;
- 44×44 px touch targets;
- no overflow at 320/390 px.

## 11. Administrator UX

Create a dedicated Family Exports screen, not an aggregate dashboard card.

Persistent banner:

> Administrator export: includes all private family content.

Flow:

1. search/select exact family;
2. show ID, owner, counts, storage mode and recent export status;
3. enter reason;
4. type current family name;
5. show complete/private/unencrypted warning;
6. create and monitor;
7. download;
8. show immutable audit history.

The screen must distinguish:

- ordinary admin-dashboard authority;
- export-admin authority;
- selected-family membership (irrelevant to site-admin path).

An admin not in `EXPORT_ADMIN_EMAILS` sees no family export metadata and cannot call endpoints.

## 12. Public representation

Central serializer:

```json
{
  "id": "exp_...",
  "status": "packaging",
  "requestedAs": "coadmin",
  "createdAt": "ISO",
  "snapshotAt": "ISO|null",
  "completedAt": "ISO|null",
  "expiresAt": "ISO|null",
  "progress": {
    "processedFiles": 428,
    "expectedFiles": 1204,
    "processedBytes": 3435973836,
    "expectedBytes": 8697308774
  },
  "warningCount": 0,
  "errorCode": null,
  "canCancel": true,
  "canDownload": false,
  "canRetry": false
}
```

Family responses omit reason/actor. Admin responses may add family selection metadata, request reason and audit events, never R2 keys/internal errors.

Public codes:

```text
export_not_configured
export_already_active
export_rate_limited
source_corrupt
source_incomplete
activity_log_unavailable
requires_segmented_export
archive_verification_failed
archive_unavailable
workflow_stalled
export_failed
```

## 13. CI and verification

Extend the existing export workflow.

Unit:

- migration on fresh D1;
- partial unique concurrency;
- owner/coadmin/editor/contributor/viewer matrix;
- export-admin empty/missing/case-normalized matrix;
- current-authority revocation;
- admin reason/confirmation;
- state graph/audit idempotency;
- serializer leakage;
- family/admin rate limits;
- capture legacy/split and missing extra;
- cancellation each stage;
- checkpoint reconciliation;
- expiry/cleanup;
- nonfatal email failure.

Integration:

- Pages → fake binding → Workflow;
- synthetic 1,000+ people/thousands of assets;
- ≥3 multipart parts and retry after committed part;
- duplicate owner/admin create race;
- edit after snapshot;
- missing media warning vs missing extra failure;
- authenticated streaming headers;
- guessed/cross-family job IDs;
- non-allowlisted dashboard admin;
- admin export while not family member;
- administration files present only for site-admin;
- preview with no binding performs zero production I/O.

Archive:

- Info-ZIP and Python `zipfile`;
- source JSON values and binary checksums;
- secret/unexpected-URL scan;
- offline Playwright with network denied;
- platform reader rehearsal.

Visual/accessibility:

- all family roles;
- export-admin and denied-admin;
- every job state;
- confirmation/reason validation;
- polling visibility;
- keyboard/screen reader/reduced motion;
- 320, 390, 768, 1440 px.

All CI data is synthetic. Pull requests never deploy/bind to production.

## 14. One-PR implementation slices

One PR, independently reviewable commits:

1. migration/domain transitions/authority;
2. Worker RPC and capture/activity/inventory;
3. multipart packaging/verification/cancellation/cleanup;
4. family and administrator APIs;
5. Family Settings UI;
6. administrator UI;
7. CI, email, runbook and deployment contract.

Codex reviews after each complete slice on the branch and once across the full PR. Claude replies with evidence to GitHub threads. Production migration, binding and enablement remain named-human actions after approval.

## 15. Deployment and rollout

The PR leaves `ENABLE_FULL_EXPORT=false` and `EXPORT_ADMIN_EMAILS` empty.

Named human sequence:

1. confirm D1 backup/Time Travel readiness;
2. complete Gate 0;
3. apply migration;
4. deploy Worker and record version;
5. configure Pages binding;
6. configure lifecycle/cron;
7. deploy Pages flag-off;
8. synthetic disposable-family byte comparison;
9. enable owner/co-admin briefly for the site owner family;
10. verify create/progress/download/viewer/audit/cancel/expiry;
11. enable owner/co-admin generally;
12. observe one retention window;
13. add one named email to `EXPORT_ADMIN_EMAILS`;
14. perform a documented admin export of the same authorized test family;
15. verify administration files, reason/audit and revocation;
16. enable the approved export-admin list.

Stop/disable immediately for cross-family leakage, incomplete required tree, authorization mismatch, ZIP failure, wrong binding/jurisdiction, multipart corruption or expiry/private-download failure.

Rollback disables creation first, preserves ready downloads unless confidentiality is in doubt, redeploys the last good Worker, aborts in-progress uploads and never reverses migration/audit.

## 16. Final definition of done

The export topic is complete only when:

- owner and co-admin can extract their complete family;
- separately allowlisted site admins can extract any exact family with reason/confirmation/audit;
- lower roles and ordinary dashboard admins cannot;
- all authority is rechecked on every operation;
- legacy/split snapshots are exact;
- full activity, media, documents and Keepsakes are included;
- site-admin administration records are included without secrets;
- required extra failure aborts and individual media failure warns;
- ZIP streams privately to R2, verifies, downloads without buffering and expires;
- retries, cancellation, cleanup and reconciliation are idempotent;
- viewer works offline;
- CI, security, visual/accessibility and human rehearsal pass;
- both authority paths are enabled only after R3 approval.

## 17. Current platform references

- Workflows API: https://developers.cloudflare.com/workflows/build/workers-api/
- Trigger Workflows: https://developers.cloudflare.com/workflows/build/trigger-workflows/
- Pages service bindings: https://developers.cloudflare.com/pages/functions/bindings/
- RPC service bindings: https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
- R2 multipart API: https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/
- D1 limits/indexes: https://developers.cloudflare.com/d1/platform/limits/ and https://developers.cloudflare.com/d1/best-practices/use-indexes/

Claude must recheck these official contracts during implementation. The reviewed repository budgets and security invariants remain controlling unless Codex explicitly revises the design.

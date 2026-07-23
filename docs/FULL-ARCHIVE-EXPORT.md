# Bloodline Full Archive Export

## Completion-phase product and technical design

**Status:** implementation-ready design
**Design owner:** Codex
**Implementation owner:** Claude
**Risk:** R2 for owner/co-admin self-service; R3 for site-administrator cross-family export and production rollout
**Primary outcome:** an authorized person can extract a complete, unredacted, point-in-time copy of a family tree and every family-content asset Bloodline still holds, in a durable ZIP archive that can be browsed without the live site.

---

## 1. Product position

Bloodline needs two complementary export products:

1. **GEDCOM export — “Use in another genealogy service.”**
   Already shipped. Fast, client-side and interoperable, but deliberately limited to fields representable in GEDCOM 5.5.1.

2. **Full Bloodline archive — “Download everything.”**
   This specification. Asynchronous, lossless for current Bloodline family content, owner-gated for normal self-service, and available to an explicitly authorized site administrator for any family.

The full archive is not a privacy-filtered view, a personal-profile export, or a GEDCOM replacement. It contains the complete family record, including living people, children, private fields, memories, documents, generated narratives and media. The export UI must say this plainly before a job is created.

---

## 2. Decisions

### 2.1 Who may export

Two server-enforced authority paths exist:

- **Family self-service:** the current `owner` and `coadmin` roles may create and download a full archive for that family. Both roles receive the same complete, unredacted family-content archive.
- **Site-administrator override:** a signed-in user on a new, separately configured `EXPORT_ADMIN_EMAILS` allowlist may create and download a full archive for any family.

`editor`, `contributor` and `viewer` may continue to use GEDCOM export if product policy allows, but they may not request or download the full archive.

The site-admin override is deliberately separate from `ADMIN_EMAILS`. Operational-dashboard access must not automatically grant the ability to extract every family’s private data. `EXPORT_ADMIN_EMAILS` defaults to empty, has no legacy fallback, and must be explicitly configured.

The site-admin route requires:

- selection of an exact family;
- a non-empty audit reason of 10–500 characters;
- explicit confirmation using the family name;
- immutable audit entries for request, completion, download, cancellation and expiry.

This is an R3 capability. It is not hidden or denied by person-level visibility settings: the user’s stated bottom-line requirement is that an authorized site administrator can extract the whole family, every detail.

### 2.2 Completeness semantics

The archive represents one point-in-time logical tree.

- A migrated family must be loaded through `loadFullTree()` or an equivalent exact-version helper.
- If the D1 core is corrupt, the referenced R2 tree-extra version is missing, or reassembly fails, the job fails. It must never create a plausible partial tree.
- Individual referenced media objects that are missing or unreadable do not make the tree JSON unknowable. The job may complete as **Ready with warnings**, but every missing object must appear in the manifest and UI. It must never claim “complete” in this state.
- The job captures the family-tree `updated_at` and `_extraVersion` used. Later edits do not alter an already-created archive.

“Everything” means every current family-content record and retained family artifact Bloodline can associate with that logical family. It does not mean credentials, session cookies, magic-link tokens, API keys, internal service configuration, or deleted R2 objects Bloodline no longer possesses.

### 2.3 Delivery model

Use all three:

- immediate UI progress through polling;
- a persistent Export history panel so the owner/admin can leave and return;
- best-effort completion email containing a link back to the authenticated export screen, never a bearer download URL.

The archive is stored privately in R2 for **72 hours** after completion. The download endpoint rechecks authorization every time. The email link is not sufficient authority by itself.

### 2.4 Background execution

Use a **dedicated Cloudflare Workflow Worker**, not `waitUntil()`, one long Pages request, or a browser-side ZIP.

The current application is a Pages project. Cloudflare requires Workflows invoked from Pages to live in a separate Worker reached through a service binding. The Workflow Worker receives D1 and R2 bindings and exposes only a narrow service-binding method for creating/inspecting export instances.

Why Workflows:

- durable multi-step progress;
- retries with backoff;
- resumability after runtime interruption;
- no dependence on an open browser tab;
- suitable for long I/O-bound R2 work;
- clear status transitions for the UI and audit trail.

D1 remains the product-visible job ledger. Cloudflare Workflow instance state is execution infrastructure, not the user-facing source of truth.

### 2.5 Archive size

There is no product-level family-size or person-count cap.

- Use streaming ZIP64 output.
- Never hold the full ZIP or all media bodies in memory.
- Write the archive to R2 with multipart upload.
- Use fixed-size parts of at least 8 MiB; 16–32 MiB is recommended after a prototype.
- Preflight object count and expected bytes for progress reporting, not rejection.
- The first implementation supports one ZIP object up to the platform’s R2 object limit.
- If a preflight estimate approaches 4 TiB or 9,500 multipart parts, stop before packaging with `requires_segmented_export`. A later segmented-export path can create a manifest plus multiple ZIP volumes. This is a technical platform boundary, not an arbitrary family-data policy.

No ordinary Bloodline family should approach that boundary, but the design must report it honestly.

---

## 3. Archive contract

### 3.1 Filename

`{sanitized-family-name}_bloodline_full_{YYYY-MM-DD}_{short-job-id}.zip`

The name is convenience only. Family and job identity inside the archive come from the manifest.

### 3.2 Directory layout

```text
Bloodline archive/
├── START-HERE.html
├── README.txt
├── manifest.json
├── data/
│   ├── tree.json
│   ├── tree-data.js
│   ├── family.json
│   ├── content-index.json
│   ├── audit.json
│   └── administration/
│       ├── members.json
│       └── invitations.json
├── viewer/
│   ├── app.js
│   ├── styles.css
│   ├── logo.svg
│   └── vendor/
├── photos/
│   └── {photo-id}_{safe-original-name-or-key}.{ext}
├── documents/
│   └── {document-id}_{safe-original-name-or-key}.{ext}
├── thumbnails/
│   └── ...
├── keepsakes/
│   └── {person-id}/
│       └── {edition-hash}.json
└── reports/
    ├── missing-files.txt
    └── integrity-report.html
```

`administration/` is included only in site-admin exports unless product ownership policy later explicitly grants family owners access to member email and invitation history. It must never contain invitation tokens, session data or magic links.

### 3.3 `tree.json`

`tree.json` is the exact reassembled logical tree returned by the storage layer, with no visibility filtering and no lossy normalization. It includes all keys present in the current logical object, including:

- people and every person field;
- relationships;
- memories;
- photos metadata;
- documents metadata, extracted text, summaries, facts and provenance;
- activity stored inside the logical tree;
- tags and life events;
- tombstones in `_deleted`;
- sequence/version fields and other future top-level fields.

Storage-only plumbing such as `_extraVersion` is not part of the logical tree and belongs in `manifest.json`, not `tree.json`.

### 3.4 Additional family records

`family.json` contains:

- family ID;
- family name;
- creation timestamp when available;
- source `family_tree.updated_at`;
- source storage mode (`legacy` or `split`);
- source extra version when split;
- archive creation timestamp;
- requesting authority (`owner` or `site_admin`);
- schema and archive-format versions.

`audit.json` contains family-scoped durable activity/audit records already available to the application. It does not contain cross-family admin telemetry.

Site-admin `administration/members.json` contains member identity, role and joined timestamp. `invitations.json` contains invitation address, intended role, status and timestamps, but removes tokens, raw delivery-provider payloads and secret links.

### 3.5 Media

Resolve media only from references inside the captured tree:

- `/api/photos/{key}` → R2 object `{key}`;
- `/api/documents/{key}` → R2 object `{key}`;
- supported legacy `data:` payloads → decoded archive files;
- supported same-family generated thumbnails → included as distinct files;
- external URLs → recorded as external references and not fetched server-side.

Do not list or copy the whole flat R2 bucket. Existing photo/document keys are not family-prefixed, so bucket-wide listing risks cross-family disclosure. The captured tree is the authoritative allowlist.

Every archived binary receives:

- stable archive path;
- original Bloodline record ID;
- original reference;
- MIME type;
- byte length;
- SHA-256 digest;
- R2 ETag when available;
- status: `included`, `external_reference`, `missing`, `unreadable` or `unsupported`.

### 3.6 Keepsakes

Keepsakes are family artifacts and are included.

- For every person in the captured tree, list the exact prefix `keepsake/{familyId}/{personId}/`.
- Include retained edition JSON objects.
- De-duplicate `latest.json` when it is byte-identical to a hashed edition; record the alias in the manifest.
- A missing Keepsake is not a warning unless the tree or a family record explicitly references one that should exist.

### 3.7 Offline viewer

`START-HERE.html` is a purpose-built, read-only family archive viewer.

It must work after the ZIP is extracted and opened with `file://`, without a server, service worker, live API, external font, analytics, CDN or network request.

To avoid browser restrictions on `fetch()` from `file://`:

- `tree-data.js` assigns the archive’s normalized viewer index to a namespaced global;
- `START-HERE.html` loads it through a relative `<script>` tag;
- photos/documents use relative file paths;
- all scripts, fonts/icons and styles are bundled locally.

Viewer v1 includes:

- family overview and archive date;
- searchable people directory;
- person profile with all scalar fields;
- parents, partners, children and relationship navigation;
- life events, memories, photos and documents;
- document download/open links;
- Keepsake narrative reading when present;
- a visible integrity banner when the archive has warnings;
- print-friendly person profiles;
- accessible keyboard navigation and semantic HTML.

Viewer v1 does not need to reproduce the live PixiJS tree, editing, authentication, AI features or collaboration tools. A simple relationship browser is more durable and more likely to work years later.

The raw `tree.json` remains authoritative. The viewer is an additional convenience, not the only way to read the archive.

### 3.8 Manifest

`manifest.json` is UTF-8 JSON with:

```json
{
  "archiveFormat": "bloodline-full-archive",
  "archiveVersion": 1,
  "viewerVersion": 1,
  "jobId": "exp_...",
  "family": {
    "id": "fam_...",
    "name": "Example Family"
  },
  "createdAt": "ISO-8601",
  "source": {
    "treeUpdatedAt": 0,
    "storageMode": "split",
    "extraVersion": 0
  },
  "requestedAs": "owner",
  "status": "complete",
  "counts": {},
  "totalBytes": 0,
  "files": [],
  "warnings": []
}
```

The manifest itself also receives a detached checksum recorded in D1 and R2 custom metadata. `integrity-report.html` provides a human-readable version.

---

## 4. Job lifecycle

### 4.1 States

```text
queued
  → snapshotting
  → inventory
  → packaging
  → verifying
  → ready | ready_with_warnings

queued/running → cancelling → cancelled
any running state → failed
ready states → expired
```

Every transition is monotonic and written to D1. Retried Workflow steps must be idempotent.

### 4.2 Stages

1. **Authorize request**
   - authenticate;
   - resolve exact family;
   - verify current owner/co-admin or export-admin authority;
   - validate admin reason/confirmation;
   - reject duplicate active job for the same family and authority;
   - insert `queued` job and audit row;
   - create Workflow instance using the job ID as the idempotency key.

2. **Capture source**
   - read the exact `family_tree` row once;
   - reassemble with the exact referenced R2 extra;
   - fail on missing/corrupt required extra;
   - write the captured logical tree and a source descriptor under a private staging prefix;
   - record `tree_updated_at`, storage mode and extra version.

3. **Inventory**
   - extract every media reference from the captured tree;
   - list Keepsake prefixes only for captured family/person IDs;
   - load family/audit records according to export authority;
   - `head()` every R2 object;
   - calculate expected file count and bytes;
   - create immutable inventory JSON in staging;
   - report missing/unreadable items.

4. **Package**
   - stream deterministic ZIP64 entries in lexical path order;
   - compute SHA-256 while streaming each entry;
   - upload fixed-size multipart parts to the final R2 key;
   - checkpoint completed entry index, multipart upload ID and uploaded part ETags;
   - on retry, resume from the last committed checkpoint or abort/restart the multipart upload safely.

5. **Verify**
   - complete multipart upload;
   - `head()` the final object and validate expected size;
   - read and validate the ZIP central directory/range footer;
   - validate manifest/file counts and checksums from the packaging ledger;
   - set `ready` or `ready_with_warnings`;
   - remove staging objects;
   - send best-effort completion email.

6. **Expire**
   - set D1 `expires_at = completed_at + 72 hours`;
   - delete through a scheduled cleanup Worker and mark `expired`;
   - also configure an R2 lifecycle rule on prefix `exports/` as a seven-day hard backstop;
   - never rely only on lifecycle timing for UI state.

### 4.3 Consistency and concurrent edits

The archive is a snapshot, not a lock:

- edits may continue while an export runs;
- the captured tree JSON and its media references do not change;
- R2 upload keys are immutable in normal use;
- if a referenced binary is deleted between snapshot and copy, the archive finishes `ready_with_warnings`;
- the UI displays “Snapshot from {time}” rather than implying it reflects completion time.

Do not freeze the family or block ordinary saves.

---

## 5. Persistence model

Add a forward-only D1 migration.

### 5.1 `family_export_job`

Required fields:

- `id TEXT PRIMARY KEY`
- `family_id TEXT NOT NULL`
- `requested_by_user_id TEXT NOT NULL`
- `requested_as TEXT NOT NULL` — `owner|coadmin|site_admin`
- `request_reason TEXT` — mandatory for site admin
- `status TEXT NOT NULL`
- `workflow_instance_id TEXT`
- `source_tree_updated_at INTEGER`
- `source_extra_version INTEGER`
- `source_storage_mode TEXT`
- `expected_files INTEGER`
- `processed_files INTEGER`
- `expected_bytes INTEGER`
- `processed_bytes INTEGER`
- `warning_count INTEGER NOT NULL DEFAULT 0`
- `error_code TEXT`
- `error_summary TEXT` — sanitized; no family content
- `archive_r2_key TEXT`
- `archive_bytes INTEGER`
- `archive_sha256 TEXT`
- `manifest_sha256 TEXT`
- `created_at INTEGER NOT NULL`
- `started_at INTEGER`
- `completed_at INTEGER`
- `expires_at INTEGER`
- `cancelled_at INTEGER`
- `last_heartbeat_at INTEGER`

Indexes:

- family + created time;
- requester + created time;
- status + expiry;
- active family jobs.

Enforce “one active export per family” transactionally in the request handler. If D1 partial indexes are used, verify support in the target environment; otherwise use an explicit transactional/conditional insert.

### 5.2 `family_export_audit`

Append-only:

- `id`
- `job_id`
- `family_id`
- `actor_user_id`
- `actor_email_snapshot`
- `actor_authority`
- `event`
- `reason`
- `created_at`
- request metadata limited to IP hash/user-agent family if policy permits.

Events:

- `requested`
- `started`
- `ready`
- `ready_with_warnings`
- `failed`
- `downloaded`
- `cancel_requested`
- `cancelled`
- `expired`

Never place family names, people, filenames, document text, R2 keys or archive URLs in application logs. The D1 audit table is the authorized record.

---

## 6. API contract

All responses use generic errors externally and structured stable `errorCode` values. Internal exception messages stay out of the client.

### 6.1 Family owner/co-admin endpoints

#### `POST /api/exports`

No caller-supplied family ID. Resolve the caller’s canonical family and require `role` to be `owner` or `coadmin`.

Returns `202`:

```json
{
  "job": {
    "id": "exp_...",
    "status": "queued",
    "createdAt": "...",
    "snapshotLabel": "Preparing snapshot"
  }
}
```

#### `GET /api/exports`

Lists the owner/co-admin’s family jobs newest first.

#### `GET /api/exports/:id`

Returns status, progress, snapshot time, warnings summary, completion and expiry.

#### `POST /api/exports/:id/cancel`

Allowed while queued/snapshotting/inventory/packaging. It records intent immediately; Workflow checks cancellation between entries/parts.

#### `GET /api/exports/:id/download`

Rechecks current owner/co-admin role, status and expiry. Streams the private R2 object with:

- `Content-Type: application/zip`
- safe `Content-Disposition: attachment`
- `Cache-Control: private, no-store`
- `X-Content-Type-Options: nosniff`
- no public bucket URL

Append `downloaded` audit row after the stream is authorized; record completion separately if the runtime can observe it.

### 6.2 Site-admin endpoints

#### `GET /api/admin/export-families?query=`

Requires `EXPORT_ADMIN_EMAILS`; searches family ID/name and returns only selection metadata, counts and latest export status.

#### `POST /api/admin/exports`

Body:

```json
{
  "familyId": "fam_...",
  "reason": "Owner requested a complete portability archive",
  "confirmFamilyName": "Davies Family"
}
```

Requery the family, compare normalized confirmation text, insert audit record, then create the job.

#### Admin list/status/cancel/download

Use `/api/admin/exports/:id...` or the common export endpoints with centralized authority checks. Do not duplicate authorization logic across handlers.

### 6.3 Worker service binding

Pages may call only narrow methods such as:

- `createExport(jobId)`
- `getExportInstance(jobId)` for operator diagnostics
- `requestCancellation(jobId)`

The Workflow Worker must independently load the job from D1 and validate that it is a legitimate queued job. A service-binding call is not a substitute for job-state validation.

---

## 7. User experience

### 7.1 Family Settings

Rename the current section to **Export your family** and show two choices.

#### GEDCOM card

- Title: “GEDCOM family tree”
- Description: “For Ancestry, MyHeritage, FamilySearch and other genealogy services.”
- Status copy: “Includes standard people, dates, places and relationships. Does not include photos, memories, documents or Keepsakes.”
- Action: “Download GEDCOM”
- Available according to current GEDCOM policy.

#### Full archive card

Visible to all roles for discoverability, but:

- owner or co-admin: enabled;
- editor, contributor or viewer: disabled with “Only a family owner or co-admin can download the complete archive.”

Content:

- Title: “Complete Bloodline archive”
- Description: “Every person and private field, every relationship, memory, photo, document and Keepsake currently held for this family.”
- Secondary copy: “Prepared securely in the background. The download expires 72 hours after it is ready.”
- Action: “Prepare complete archive”

Confirmation sheet:

- direct warning that living people, children and private material are included;
- archive will be an ordinary unencrypted ZIP after download;
- estimated current source size/file count when preflight metadata is cheaply available;
- confirmation: “Prepare archive”.

### 7.2 Progress

Replace the action with a status panel:

- “Queued”
- “Capturing a point-in-time copy”
- “Finding photos and documents”
- “Packaging 428 of 1,204 files · 3.2 GB of 8.1 GB”
- “Verifying archive”
- “Ready to download · expires Friday at 2:15 PM”
- “Ready with 3 missing files”
- “Couldn’t prepare archive”

Poll:

- every 2 seconds for the first 30 seconds;
- every 5 seconds while active;
- pause when the document is hidden;
- resume immediately when visible;
- stop at a terminal state.

The user may close the sheet; progress survives navigation and sign-out.

### 7.3 Warning state

“Ready with warnings” is visually distinct from success:

- “Your archive contains the complete family record, but 2 referenced files were unavailable.”
- show file record IDs/type, not sensitive original filenames, in the web UI;
- offer Download, Retry as a new job, and View integrity summary.

### 7.4 Admin surface

Add **Family exports** to the admin dashboard or a dedicated `/admin/exports.html`.

The dedicated screen is preferred because family search, reasons, job history and audit events are operational tools rather than aggregate dashboard metrics.

Admin flow:

1. search/select exact family;
2. inspect family ID, owner, people/media counts and current storage mode;
3. enter reason;
4. type family name to confirm;
5. create job;
6. monitor progress;
7. download;
8. retain immutable audit history.

Show a persistent banner: “Administrator export: includes all private family content.”

---

## 8. Security and privacy requirements

1. Server-side authority checks on create, list, status, cancel and download.
2. `EXPORT_ADMIN_EMAILS` is separate, explicit and deny-by-default.
3. No user-supplied R2 key, output key, filesystem path or archive path.
4. Archive paths are generated from IDs plus sanitized display names.
5. Reject `..`, slash, backslash, NUL and Unicode path-confusion characters from names.
6. Never follow media URLs to arbitrary network origins.
7. Never list the flat photo/document namespace to infer ownership.
8. R2 archive objects remain private.
9. Download responses are authenticated and `no-store`.
10. Completion emails link to the authenticated UI, never directly to the object.
11. No archive content, family identifiers or private URLs in general logs, analytics, PRs, screenshots or third-party tools.
12. No person-level privacy filtering inside a full archive.
13. No invite/session/auth tokens in any archive.
14. Export jobs and artifacts expire automatically.
15. Site-admin exports always require a human-entered reason and produce an audit trail.
16. Owners or co-admins who lose that authority, and site administrators removed from the export allowlist, cannot download an existing archive.
17. Rate limit creation attempts and record denied admin attempts without logging requested family content.

Recommended rate limits:

- one active job per family;
- owner/co-admin group: three created jobs per family per 24 hours, shared across those roles;
- site admin: ten created jobs per administrator per hour, with an explicit operational override only through a runbook.

---

## 9. Failure and recovery behavior

| Failure | Result |
|---|---|
| Unauthenticated | 401; no job |
| Wrong family role | 403; no metadata leak |
| Site admin not separately allowlisted | 403 |
| Family missing | generic 404 |
| Corrupt D1 tree | job `failed: source_corrupt` |
| Missing/unreadable migrated extra | job `failed: source_incomplete`; no archive |
| Missing individual media | `ready_with_warnings`; explicit manifest entry |
| R2 transient read | retry with exponential backoff |
| Multipart upload interruption | resume from checkpoint or safely abort/restart |
| ZIP verification failure | delete/quarantine final object; job failed |
| Completion email failure | archive remains ready; warning only |
| Requester loses owner/co-admin authority | job may finish, but status/download authorization is denied |
| Workflow stalls | heartbeat monitor marks `stalled`; operator can retry or cancel |
| Expiry cleanup fails | lifecycle backstop removes object; reconciliation updates D1 |

Retries must not create multiple downloadable artifacts or duplicate active jobs. Final object keys include job ID and are immutable after verification.

Recovery:

- cancel/failed workflows abort incomplete multipart uploads;
- orphan staging prefixes are swept after seven days;
- a failed job can be retried as a new job from a new point-in-time snapshot;
- no export operation mutates source family data;
- rollback of the feature disables creation endpoints/service binding while preserving existing artifacts until normal expiry.

---

## 10. Observability

Metrics without family content:

- jobs created/completed/failed/cancelled/expired;
- duration by stage;
- bytes and file-count histograms;
- warning counts by reason;
- retry counts;
- multipart aborts;
- stale heartbeat count;
- download count;
- expiry lag.

Alerts:

- any `source_incomplete` for migrated tree extra;
- ZIP verification failure;
- workflow stalled beyond 30 minutes without heartbeat;
- expiry cleanup more than 24 hours late;
- repeated denied site-admin export attempts;
- unexpected spike in exports or total bytes.

Admin job detail may show technical codes and stage timings. It must not show private file contents.

---

## 11. Implementation sequence

Keep this as one feature program, but stage risk deliberately.

### Phase A — archive-format proof

- Pure inventory builder from a synthetic full logical tree.
- Pure archive-path sanitizer.
- Manifest v1.
- Offline viewer using fixture data.
- Streaming ZIP64 proof against synthetic many-file/large-file fixtures.
- Verify ZIP with two independent readers.

No production bindings or UI.

### Phase B — owner/co-admin self-service

- D1 migration and job/audit models.
- Workflow Worker and Pages service binding.
- Owner/co-admin endpoints.
- R2 staging/final prefixes and expiry.
- Family Settings UI.
- Completion email.
- Deploy behind `ENABLE_FULL_EXPORT=false`.

### Phase C — site-admin override

- `EXPORT_ADMIN_EMAILS`.
- family search and dedicated admin export UI.
- confirmation/reason/audit behavior.
- admin endpoints and rate limits.
- enable only after an R3 rollout rehearsal.

### Phase D — offline viewer completion

- profiles, relationship navigation, media/documents, Keepsakes, search, accessibility and print.
- forward-compatible unknown-field raw-data inspector.

The ZIP can ship only when the viewer and raw archive contract are both complete; do not label a raw-data-only ZIP as the promised finished feature.

---

## 12. Verification

### 12.1 Unit

- authorization matrix for every role and site-admin state;
- admin allowlist empty/missing/multiple-case-normalized addresses;
- tree capture for legacy and split storage;
- missing extra fails cleanly;
- exact logical-tree round trip;
- media-reference parser cannot escape allowed key formats;
- path sanitizer including Unicode and traversal attempts;
- manifest deterministic ordering;
- SHA-256 values;
- retry/idempotency transitions;
- expiry calculations;
- archive status reducer;
- viewer index generation preserves every source field.

### 12.2 Integration

- synthetic legacy family;
- synthetic migrated family;
- 1,000+ people;
- thousands of assets;
- mixed photos/documents/audio/video;
- legacy data URLs;
- missing media object;
- missing tree-extra object;
- concurrent family edit while export runs;
- cancellation at every stage;
- Workflow retry after injected R2 failures;
- multipart resume;
- expiry and download denial;
- owner/co-admin authority removal during job;
- site admin not a family member;
- two simultaneous create requests;
- large ZIP requiring ZIP64.

### 12.3 Security

- cross-family owner/co-admin access attempts;
- guessed job IDs;
- guessed R2 keys;
- expired archive;
- revoked admin;
- malicious filenames and MIME types;
- HTML/script content inside memories, bios, filenames and documents;
- offline viewer XSS under `file://`;
- no third-party network requests from viewer;
- no secrets/tokens in ZIP by recursive scan;
- no family content in Worker logs;
- download cache headers.

### 12.4 Visual and accessibility

- Family Settings owner/co-admin and lower-role states on phone and desktop;
- long-running progress;
- ready, warning, failure and expired states;
- admin family search and confirmation;
- keyboard-only operation;
- screen reader announcements;
- reduced motion;
- offline viewer at 320, 390, 768 and 1440px;
- viewer opened with networking disabled.

### 12.5 Archive acceptance

For a controlled fixture, independently prove:

1. every logical-tree JSON value exists unchanged in `tree.json`;
2. every referenced available binary is present exactly once;
3. SHA-256 matches the source;
4. every unavailable reference is reported;
5. no object from another family is present;
6. the archive opens in macOS Archive Utility, Windows Explorer and a CLI ZIP reader;
7. `START-HERE.html` works offline without a local server;
8. a second identical source snapshot produces the same entry inventory and checksums, excluding expected job/timestamp metadata.

---

## 13. Rollout

This feature introduces a new D1 migration, Workflow Worker, service binding, R2 write pattern and privileged cross-family operation. Production enablement is R3.

Required rollout:

1. named human operator;
2. current D1 export/backup;
3. verify R2 lifecycle rule and multipart cleanup;
4. deploy with feature flag off;
5. run synthetic/local integration;
6. enable for a disposable test family;
7. export and independently compare every fixture byte;
8. enable owner/co-admin self-service for the site owner’s family;
9. observe job, download, expiry and cleanup;
10. separately enable `EXPORT_ADMIN_EMAILS`;
11. perform one documented admin export of the same authorized test family;
12. only then enable generally.

Stop if source state, bindings, jurisdiction, lifecycle rules or Workflow status differ from the runbook.

---

## 14. Definition of done

The feature is complete only when:

- GEDCOM and Complete archive are clearly differentiated;
- only a family owner or co-admin can self-export;
- an explicitly allowlisted site administrator can export any exact family;
- the archive includes the complete unfiltered logical tree, available media/documents and retained Keepsakes;
- missing required tree extra aborts;
- missing individual binaries are explicit warnings;
- the job is asynchronous, resumable and observable;
- the ZIP is private, authenticated and expires;
- the offline viewer works without the live site or network;
- archive integrity is independently verified;
- audit, authorization, cancellation, expiry and failure tests pass;
- the R3 rollout runbook has been executed successfully.

---

## 15. Deferred extensions

Not required for completion:

- encrypted/password-protected ZIPs;
- segmented multi-volume exports below the R2 platform boundary;
- scheduled recurring archives;
- owner-configurable retention;
- import/restore from a full archive;
- native desktop viewer;
- PDF/printed family books;
- automatic transfer to another cloud provider.

Restore is a separate destructive/persistence feature and must not be implied by the word “archive.”

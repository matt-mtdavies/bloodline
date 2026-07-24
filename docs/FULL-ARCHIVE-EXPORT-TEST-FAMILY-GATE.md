# Full archive export: disposable-family rollout gate

Status: implementation brief

Risk: R2 code change; R3 when configured in production

Owner/operator: Matt Davies

Design lead: Codex

Implementation/review workflow: Claude implements; Codex reviews

## Problem

The completion runbook requires a synthetic disposable-family archive test
before full archive export is enabled generally. The deployed gate cannot
support that sequence:

- `ENABLE_FULL_EXPORT=false` rejects every export endpoint with
  `export_not_configured`;
- `ENABLE_FULL_EXPORT=true` enables owner/co-admin exports for every family;
- there is no family-scoped rollout control.

Therefore the current step 8 cannot run while the feature is off, and step 9
cannot be limited to the disposable family. Do not work around this by
manually inserting an export job, invoking the Workflow directly, or briefly
enabling every family. Those paths either bypass the API/authority behavior
being tested or broaden production access unnecessarily.

## Outcome

Add a deny-by-default family allowlist that permits the complete export
surface for explicitly named disposable family IDs while general export
enablement remains off.

The rollout operator can then:

1. create a disposable family;
2. add only its opaque family ID to the rollout allowlist;
3. exercise the normal authenticated owner/co-admin API and UI;
4. compare the resulting archive with a direct API pull;
5. remove the family ID and prove access is revoked;
6. clean up the synthetic family under the production runbook.

## Configuration contract

Add a Pages environment variable:

```text
FULL_EXPORT_TEST_FAMILY_IDS
```

Rules:

- comma-separated exact family IDs;
- trim surrounding ASCII whitespace;
- discard empty entries;
- exact, case-sensitive comparison;
- missing or empty means no test families;
- no wildcard, prefix, name, email or legacy fallback;
- never expose the configured list to the client;
- keep the production value empty in committed `wrangler.toml`.

`ENABLE_FULL_EXPORT=true` remains the general release switch. The test
allowlist does not weaken authentication, role checks, `EXPORT_ADMIN_EMAILS`,
rate limits, audit recording, download expiry, or any job-family lookup.

## Server authorization model

Replace the single global readiness decision with two concepts:

### Infrastructure readiness

The export infrastructure is ready only when:

- `EXPORT_WORKFLOW_SERVICE` is present;
- `DB` is present; and
- `family_export_job` can be queried.

This check must not depend on either rollout flag.

### Family enablement

For an exact canonical family ID, export is enabled when:

```text
ENABLE_FULL_EXPORT === "true"
OR
familyId is an exact member of FULL_EXPORT_TEST_FAMILY_IDS
```

Every operation must establish its authoritative family ID before applying
this decision:

- owner/co-admin create and list: resolve the caller's canonical membership,
  then gate its `family_id`;
- owner/co-admin status, cancel and download: load the job constrained by the
  caller's canonical family and gate the stored `family_id`;
- site-admin create: requery the submitted family ID, retain the existing
  email allowlist/reason/typed-name checks, then gate the requeried family ID;
- site-admin list/search: return only enabled families/jobs while general
  enablement is false;
- site-admin status, audit, cancel and download: load the job first and gate
  its stored `family_id`.

Never decide from a caller-supplied family name, cached browser metadata,
request query alone, or job ID without reading its family association.

When infrastructure is unavailable or the exact family is not enabled,
return the existing controlled `503 export_not_configured` response. Do not
reveal whether another family is allowlisted.

## UI behavior

For an authenticated owner/co-admin whose canonical family is allowlisted,
the existing complete-archive controls and job history should behave exactly
as they do under general enablement.

All other families continue to see the existing unavailable state. Do not
show test-family IDs, rollout terminology, or a distinct authorization error
in the product UI.

Switching between family memberships must re-evaluate availability from the
server; a previously enabled family's client state must not make controls
appear for a different family.

## Required implementation changes

Keep the logic centralized in `functions/_lib/exportService.js`; route files
must remain thin.

Expected areas:

- add a pure parser/helper for `FULL_EXPORT_TEST_FAMILY_IDS`;
- separate infrastructure readiness from exact-family enablement;
- change each service operation to gate the authoritative family described
  above;
- preserve existing response serialization and error codes;
- add the empty committed variable and explanatory comments to the root
  `wrangler.toml`;
- update the completion runbook so the disposable-family allowlist is
  configured before the byte-comparison test and removed immediately after
  revocation is verified.

Do not change:

- Workflow Worker bindings or Workflow implementation;
- D1 schema or applied migration `0014`;
- R2 keys, lifecycle policy or Cron;
- owner/co-admin role definitions;
- `EXPORT_ADMIN_EMAILS` semantics;
- archive contents or offline viewer;
- GEDCOM import/export.

## Verification

Add failure-path tests before production configuration.

At minimum prove:

1. flag false + empty test allowlist returns `export_not_configured`;
2. flag false + exact canonical family allowlisted permits owner create,
   list, status, cancel and download;
3. a different family remains unavailable;
4. whitespace and empty entries are normalized, but case/prefix/wildcard
   variants do not match;
5. caller-supplied family metadata cannot select an allowlisted family;
6. a job from a non-allowlisted family cannot be read, cancelled or
   downloaded through either family or admin endpoints;
7. site-admin authority still requires `EXPORT_ADMIN_EMAILS`, reason and
   typed-name confirmation;
8. site-admin list/search is filtered to allowlisted families while the
   global flag is false;
9. `ENABLE_FULL_EXPORT=true` preserves current all-family behavior;
10. removing the family ID revokes create, history, status, cancel, audit and
    download access on the next request;
11. missing DB, migration or service binding still fails closed;
12. existing export Worker and main-app regression suites pass.

Use only synthetic IDs and records in tests. Do not place production family
IDs, names, data, archive keys or screenshots in the repository or PR.

## Production rollout and recovery

This PR must not set a production family ID or enable general export.

After implementation is reviewed and deployed:

1. named operator confirms the existing D1 Time Travel bookmark and rollback
   information are still current;
2. create a clearly named disposable family containing only synthetic data;
3. record its ID privately outside GitHub and AI tools;
4. set `FULL_EXPORT_TEST_FAMILY_IDS` to that ID in Pages production;
5. keep `ENABLE_FULL_EXPORT=false` and `EXPORT_ADMIN_EMAILS` empty;
6. run the normal owner export lifecycle and byte comparison;
7. remove the family ID;
8. verify every export route is revoked for the synthetic family;
9. preserve required audit evidence, then remove synthetic family content
   only under an explicitly approved cleanup procedure.

Immediate rollback is to empty `FULL_EXPORT_TEST_FAMILY_IDS`. This stops new
and existing-family access on the next request while preserving job/audit
records and normal archive expiry. Do not reverse migration `0014` or delete
audit rows as rollback.

## Acceptance criteria

- A single disposable family can complete the normal export flow while
  general exports remain disabled.
- No other family gains export access.
- Removing the allowlist entry revokes the entire API surface immediately.
- Tests cover every authority-bearing operation and important failure mode.
- The implementation PR contains no production identifiers or data.
- Codex independently reviews the complete implementation diff before merge.

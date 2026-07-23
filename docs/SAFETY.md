# Safety invariants

These constraints take priority over speed and convenience.

## Privacy and authorization

- Never disclose one family's data to another family or an unauthenticated caller.
- Server-side authentication, membership, role, visibility, and admin checks are authoritative.
- Treat production family data as sensitive. Do not copy it into commits, fixtures,
  screenshots, issue trackers, AI prompts, analytics, or other third-party systems.
- Keep secrets and private object identifiers out of client bundles and logs.

## Persistence

- Never silently return a partial tree when required migrated R2 extra cannot be read.
- On a split-tree write, write and verify R2 extra before updating the authoritative D1
  core/version pointer.
- Never automatically migrate a legacy family. Migration is an explicit, separately
  authorized production operation.
- Preserve concurrency checks, snapshots, tombstones, role restrictions, and compatibility
  behavior unless a reviewed design deliberately replaces them.
- Applied migrations are immutable. Schema evolution requires a new forward migration.

## Production operations

Production migrations, restores, bulk edits, destructive storage actions, and deployments
that can alter family data are R3 operations. They require a named human operator, written
approval, a current backup, a tested step-by-step runbook, staged rollout, observable success
criteria, and a rollback or recovery procedure.

Stop when actual state differs from the runbook. Preserve evidence and diagnose before retrying.

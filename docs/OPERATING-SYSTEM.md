# Project operating system

This is the shared, model-independent workflow for Bloodline.

## Work loop

1. **Orient:** update from `main`; read applicable instructions, code, tests, migrations,
   configuration, and recent relevant history.
2. **Frame:** state the intended outcome, boundaries, assumptions, risk level, affected
   data/services, validation, and recovery plan.
3. **Implement:** make a focused change on a short-lived branch. Avoid opportunistic rewrites.
4. **Verify:** test the behavior and important failure modes in proportion to risk. Inspect
   rendered UI when presentation changes.
5. **Review:** compare the complete diff with `main`; check privacy, authorization,
   persistence, compatibility, external effects, and documentation accuracy.
6. **Publish:** commit intentionally, push the exact branch, and open a pull request. Report
   the branch, commit, checks, and real PR URL.
7. **Operate:** deploy or mutate production only when separately authorized. Observe the
   result and keep the documented recovery path available.

## Risk levels

| Level | Examples | Minimum handling |
|---|---|---|
| R0 — trivial | Copy, comments, formatting | Diff review and a relevant lightweight check |
| R1 — contained | Isolated UI or logic with no storage/auth change | Targeted tests, build, and UI inspection when applicable |
| R2 — sensitive | Auth, privacy, persistence, API contracts, external integrations | Explicit impact analysis, failure-path tests, independent review, recovery plan |
| R3 — critical | Production data mutation, destructive action, migration rollout, access-control boundary | Named human operator, explicit written approval, backup, tested runbook, staged execution, monitoring and rollback |

Use the highest applicable level. Splitting a critical operation into small commands does
not lower its risk.

## Completion standard

Work is complete only when the requested artifact exists in the place the user expects and
the claimed verification is evidenced. A local commit is not a pushed branch; PR metadata is
not a pull request; a successful build is not a deployment.

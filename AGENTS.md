# Repository instructions

These rules apply to every human and automated contributor.

## Source of truth

When sources disagree, use this order:

1. Current production requirements and an explicit instruction from the repository owner.
2. Current source, tests, migrations, and deployment configuration.
3. `docs/SAFETY.md` and `docs/ARCHITECTURE.md`.
4. `docs/OPERATING-SYSTEM.md` and `CONTRIBUTING.md`.
5. Historical plans, status notes, and agent memory such as `CLAUDE.md`.

Do not silently resolve a material contradiction. Record it in the pull request.

## Working rules

- Begin from current `main` and work on a short-lived branch.
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

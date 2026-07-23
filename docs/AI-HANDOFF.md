# Codex–Claude GitHub handoff

This repository uses GitHub as the durable coordination layer between Codex, Claude,
continuous integration, and the repository owner.

## What the owner says

The standing kickoff phrase is:

> Take this through the standard workflow.

That authorizes reversible repository work needed for the request: investigation, a design
brief, a handoff issue, short-lived branches, commits, pushes, checks, and draft pull requests.
It does **not** authorize production deployment, remote migrations, destructive operations,
production-data access, or expansion beyond the requested product outcome.

## Automated lifecycle

1. **Codex designs and publishes.** Codex starts from current `origin/main`, writes the
   implementation-ready brief under `docs/`, pushes it, and opens a `Codex to Claude handoff`
   issue containing a commit-pinned GitHub link.
2. **Codex requests review.** After checking the issue and scope, Codex applies
   `ready-for-claude-review`. The `Claude handoff` Action asks Claude to review only; the
   review job cannot write repository contents.
3. **Codex resolves the review.** Codex reads Claude's issue comment, updates and republishes
   the brief, and records how blocking feedback was resolved. If feedback changes product
   intent, risk, cost, or scope materially, Codex pauses for the owner.
4. **Codex authorizes implementation.** Codex removes the review label and applies
   `ready-for-claude-build` only when the brief is implementation-ready.
5. **Claude implements.** Claude works on a `claude/` branch, verifies the change, pushes it,
   and opens a PR when permissions allow. If PR creation is unavailable, Claude posts the
   exact branch and compare link and Codex opens the draft PR.
6. **Codex reviews.** Codex reviews the complete diff, checks, and deployed preview against
   the approved brief. Valid findings return to Claude through PR comments.
7. **The owner decides.** The owner receives a final summary, evidence, known risks, and
   Codex's merge recommendation, then reviews and merges or declines the PR.

The owner does not relay text between agents. GitHub issues, comments, commits, checks, and
pull requests are the handoff record.

## Labels and permissions

- `ready-for-claude-review`: run the read-only brief-review job.
- `ready-for-claude-build`: run the write-enabled implementation job.
- `needs-codex-review`: implementation is ready for final Codex review.

Only a maintainer or an authorized agent acting within the owner's request may apply the two
Claude trigger labels. This is especially important because the repository is public: opening
an issue alone must never grant write access or spend Anthropic API credits.

The workflow pins third-party Actions to reviewed commit SHAs. Updating those SHAs is a
separate dependency-maintenance change.

## Required repository setup

The workflow requires:

1. The official Claude GitHub App installed for this repository.
2. An Actions secret named `ANTHROPIC_API_KEY`.
3. GitHub Actions enabled with permission to read and write repository contents and pull
   requests for the implementation job.
4. The three labels above.

The API key must only be stored as a GitHub Actions secret. Never put it in an issue, prompt,
workflow file, commit, log, or screenshot.

## Human checkpoints

Stop and ask the owner before continuing when:

- review feedback changes the requested behavior or introduces a material trade-off;
- scope, ongoing platform cost, or delivery timing expands materially;
- credentials or access not already placed in scope are required;
- Codex and Claude disagree on a consequential product or safety decision;
- an R3 operation, production deployment, remote migration, or destructive action is needed.

Otherwise Codex may carry the design, review, implementation handoff, and final review through
without intermediate owner involvement.

## Failure and recovery

- A failed Claude Action changes no production state. Inspect its Actions log, correct the
  setup or brief, then remove and reapply the relevant trigger label.
- Do not apply both trigger labels together.
- If Claude pushes a partial branch, keep the issue open and do not open or merge a PR until
  verification and Codex review are complete.
- Closing a handoff issue does not deploy or delete its branches.

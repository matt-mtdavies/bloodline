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

## Pro-plan lifecycle

1. **Codex designs and publishes.** Codex starts from current `origin/main`, writes the
   implementation-ready brief under `docs/`, pushes it, and opens a `Codex to Claude handoff`
   issue containing a commit-pinned GitHub link.
2. **The owner starts Claude once.** In Claude Code on the web or in the Claude app, select
   `matt-mtdavies/bloodline` and ask Claude to review the handoff issue and published brief.
   This uses the owner's Pro-plan allowance rather than Anthropic API credits.
3. **Codex resolves the review.** After Claude's review is available on GitHub, Codex updates
   and republishes the brief and records how blocking feedback was resolved. If feedback
   changes product intent, risk, cost, or scope materially, Codex pauses for the owner.
4. **The owner starts implementation once.** In the same Claude task, ask Claude to implement
   the approved brief. Claude works asynchronously, verifies the change, pushes a branch, and
   creates a PR.
5. **Codex reviews.** Codex reviews the complete diff, checks, and deployed preview against
   the approved brief. Valid findings return to Claude through PR comments.
6. **The owner decides.** The owner receives a final summary, evidence, known risks, and
   Codex's merge recommendation, then reviews and merges or declines the PR.

The owner does not copy briefs or review comments between agents. GitHub issues, comments,
commits, checks, and pull requests are the handoff record. However, a Pro-plan Claude task
cannot currently be launched by a GitHub label, so the owner must initiate the Claude task.

## Why this is not a GitHub Action

The official Claude Code GitHub Action requires API or separately generated automation
credentials. A direct `ANTHROPIC_API_KEY` consumes Anthropic API credits, which are separate
from the owner's Claude Pro allowance. This repository deliberately does not install that
workflow.

Do not add an `ANTHROPIC_API_KEY` repository secret unless the owner later makes an explicit,
informed decision to pay separately for unattended GitHub Action usage.

## Required browser setup

1. Open Claude Code on the web from the Claude app or browser.
2. Connect GitHub when prompted and grant Claude access only to
   `matt-mtdavies/bloodline`.
3. For each approved handoff, select that repository and give Claude the handoff issue URL.
4. Confirm Claude is using the owner's Pro account and do not enable API-credit fallback.

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

- A failed Claude web task changes no production state. Review its task output, correct the
  setup or brief, and retry within the same handoff issue.
- If Claude pushes a partial branch, keep the issue open and do not open or merge a PR until
  verification and Codex review are complete.
- Closing a handoff issue does not deploy or delete its branches.

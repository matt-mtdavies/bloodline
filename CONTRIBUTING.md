# Contributing

## Before changing anything

1. Update from `main` and create a short-lived branch.
2. Read `AGENTS.md`, `docs/OPERATING-SYSTEM.md`, and the relevant architecture or
   storage document.
3. Inspect the current implementation, tests, migrations, and recent relevant history.
4. Classify the change's risk and identify affected family data, authorization paths,
   external services, and recovery options.
5. Run the smallest useful baseline check so pre-existing failures are distinguishable.

## While working

- Make the smallest coherent change that addresses the request.
- Preserve API and stored-data compatibility unless the change explicitly replaces it.
- Add or update tests for behavior changes and failure paths.
- Never edit an already-applied migration. Add a new migration instead.
- Keep secrets and real family information out of repository artifacts and external tools.

## Pull requests

Describe the problem, the solution, user/data impact, risk level, validation performed,
known limitations, and recovery plan. Documentation-only work should say so explicitly.
A pull request is not created until it has a GitHub URL; local title/body text is only a draft.

Reviewers should challenge factual accuracy, authorization, privacy, compatibility,
failure behavior, and rollback—not just formatting or whether tests are green.

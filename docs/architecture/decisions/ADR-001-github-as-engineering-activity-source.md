# ADR-001: GitHub is the engineering activity source

- Status: Accepted
- Date: 2026-09-05
- Pull request: #206

## Context

Bloodline now has more than one human contributor. Site administrators need a
calm, shared view of what changed without maintaining a second hand-written
changelog or confusing engineering work with activity inside a family's tree.

## Decision

The Product Operations feed projects merged pull-request metadata from GitHub.
One merged pull request is one change entry. GitHub remains authoritative; the
admin view is a read-only summary and links back to the pull request.

Family `activity_log` records remain separate. Pull-request bodies, patches,
comments, secrets, and family data are not copied into the feed.

## Alternatives considered

- A second D1 changelog table would duplicate GitHub and require contributors
  to keep two systems synchronized.
- Raw commit lists are too implementation-heavy and make multi-commit pull
  requests look like several separate product changes.
- A manually edited JSON changelog would become stale and create merge churn.

## Consequences

- Pull-request titles and labels need to be written for humans.
- Contributor GitHub identities must remain distinct for attribution.
- Deployment truth is shown only when a Cloudflare Pages check run can be
  verified. Otherwise the UI explicitly says it is unverified.
- The page remains useful if GitHub is temporarily unavailable because the
  architecture and runbook library is bundled with the application.

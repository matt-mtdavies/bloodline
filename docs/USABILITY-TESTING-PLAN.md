# Newcomer & Invited-Relative Usability Testing Plan

**Status:** Ready to run — requires a human moderator and real participants.
**Owner:** Product/design, executed with engineering support.
**Source requirement:** `docs/PRODUCTIZATION-BRIEF.md` §12 Phase B ("Newcomer
and invited-relative usability testing") and §13 ("Trust comprehension in
usability tests: privacy, roles, export, and advertising posture").

## Why this document exists

Phase B of the productization brief calls for real usability testing with two
audiences: a first-time visitor starting from nothing, and a relative who
arrives via an invitation. That testing needs a live human moderator and real
participants reacting to the product — it is not something that can be
executed unattended. This document is the practical stand-in for that
checklist item: a concrete, ready-to-run test script with tasks, success
criteria, and what to watch for, so a human can pick it up and run it with no
further design work. **It has not been executed.** Running it, recruiting
participants, and synthesising findings is the remaining step, owned by
whoever runs the next round of product validation.

## What this validates

Two of the brief's audiences (§3):

- **A. The family steward** — arriving cold, no existing account, deciding
  whether to start fresh or import a GEDCOM.
- **B. The newly invited relative** — arriving via an invitation link, no
  prior context, deciding whether to trust it and take a first small action.

The brief's own success measures (§13) frame what "good" looks like:

- Visitor → start-path selection rate.
- Start-path selection → completed first tree or completed import rate.
- Invite landing → accepted invitation rate.
- First-week meaningful action (a relationship, photo, memory, document, or
  invitation).
- Support contacts by confusion category.
- **Trust comprehension: privacy, roles, export, and advertising posture.**
- Accessibility audit pass rate and mobile Core Web Vitals.

The moderated sessions below are aimed specifically at the two measures a
funnel dashboard cannot answer on its own: whether people understand what
they're trusting Bloodline with, and where they hesitate or get lost — the
"why" behind whatever the activation-funnel telemetry (`docs/PRODUCTIZATION-
BRIEF.md` §11.7, shipped in this same phase) shows as a "why" gap. See
[Cross-checking against the funnel telemetry](#cross-checking-against-the-funnel-telemetry)
below for how to line the two up.

## Participants

Recruit **5 participants per group** (10 total). Nielsen Norman Group's
usual guidance — five users surface the large majority of usability problems
in a single round — applies well here since this is a narrow, linear flow
being tested for orientation and comprehension, not a broad feature surface.

**Group A — Family steward (5 people):**
- Has never used Bloodline.
- Owns or has access to some real family information (names, a few photos,
  maybe an old GEDCOM export from another tool) they'd plausibly want to
  preserve — but must **not** use real living relatives' data during the
  test; use the anonymised fixture family described below.
- Mix of at least one participant who has previously used a genealogy tool
  (Ancestry, MyHeritage, FamilySearch) and at least one who has not — the
  brief explicitly targets both the genealogist migrating a tree (§3.D) and
  someone with no prior genealogy-tool experience.
- Mix of desktop and mobile as the primary device, since the brief requires
  the product to work for both.

**Group B — Invited relative (5 people):**
- Has never used Bloodline and receives only an invitation link — no other
  briefing about what the product is.
- Recruit people who plausibly fit "a relative asked to help with the family
  tree," not power users — the point is testing whether the invitation
  itself carries enough context.
- At least 2 of the 5 on mobile, since an invitation is at least as likely to
  arrive and be opened on a phone as a desktop.

Do not recruit engineering or design staff who already know the product.

## Test environment

- Run against a staging deployment (or a local `npm run dev` instance for a
  moderated remote session) seeded with **anonymised fixture data only** —
  reuse the same fixture-family convention already used for the public-page
  screenshots in Phase A (`docs/PRODUCTIZATION-BRIEF.md` Phase A work) and
  the activation-funnel benchmark fixtures (`docs/PHASE0-BENCHMARK-REPORT.md`
  generator). Never point a usability session at this account's real family
  data or any other real user's family.
- For Group B, generate a real invitation to a disposable test email address
  from the fixture family, exactly as a real inviter would, so the actual
  email template, subject line, and landing page are what's tested — not a
  paraphrase of them.
- Moderated sessions: video call with screen share, think-aloud protocol.
  Record with participant consent for later review; do not keep recordings
  longer than needed for synthesis.
- Unmoderated fallback (if a moderator can't be scheduled in time): the same
  task list run through a remote usability platform (e.g. UserTesting,
  Maze) with think-aloud narration captured on video. Moderated is strongly
  preferred for this round because the trust-comprehension probes need
  follow-up questions, which unmoderated tools handle poorly.

## Session structure (both groups)

1. Brief intro (2 min): "We're testing a product, not you. Please think out
   loud as you go — tell us what you expect to happen before you click."
   Do not explain what Bloodline is or does before the session starts.
2. Task walkthrough (15–20 min): see task scripts below.
3. Post-task comprehension interview (10 min): see
   [Trust comprehension probes](#trust-comprehension-probes).
4. Wrap-up (3 min): overall impression, one thing that was confusing, one
   thing that felt good.

Target session length: 30–35 minutes total.

---

## Task script — Group A: Family steward

Starting point: a fresh browser profile, no cookies, pointed at the
signed-out homepage (`/`). Do not tell the participant the URL means
anything beyond "here's the product we're testing."

| # | Task (read aloud to participant) | What we're watching for |
| - | --- | --- |
| A1 | "You've landed on this page for the first time. Before doing anything, tell me what you think this product does and who it's for." | Whether the homepage's positioning (§1) lands without prompting — can they restate "a private family tree/history home" unprompted? |
| A2 | "Now try to get started." (No further guidance.) | Do they find and understand the start-path chooser (§6.5 / §8) — Start fresh / Import a GEDCOM / I have an invitation — without hesitating over which applies to them? |
| A3 | "You have some information about your family already — go ahead and set that up." | Whether they complete the guided starter flow (or, for genealogist participants supplied a small real-format fixture `.ged` file, whether they find and use the import path instead) without abandoning. |
| A4 | "Before you add anything private, would you want to check what happens to this data — could you find that out?" | Whether Privacy & ownership (`/privacy`) is discoverable from wherever they are at this point, and whether they can locate it without being told the URL. |
| A5 | "Add one person and one small detail about them — a photo, a memory, or a life event, whichever feels natural." | First meaningful contribution (mirrors the `first_contribution` funnel event) — do they find where to add it, and does it feel like a natural next step or a hunt? |
| A6 | "Now invite someone else in your family to see this." | Whether the invite flow is discoverable and whether they understand what the invitee will see/be able to do before sending it. |

**Task-level success criteria:** each task is scored complete / completed
with difficulty / abandoned, plus time-on-task. A task is "complete" only if
the participant reaches the described outcome without being redirected by
the moderator (redirection = fail on that task, note the sticking point).

---

## Task script — Group B: Invited relative

Starting point: participant opens the invitation email (or, if testing a
link directly, the plain invite URL) with zero prior context about
Bloodline. Do not brief them beforehand.

| # | Task | What we're watching for |
| - | --- | --- |
| B1 | "Open the email/message you were sent and tell me, before clicking anything, what you think you're being asked to do." | Whether the invite email/landing copy alone (§7 Invitation landing: inviting family name, inviter identity, role, what joining allows, privacy reassurance) is enough to orient a first-time recipient with zero other context. |
| B2 | "Now go ahead and open it." | Whether the invite landing page (`/sign-in?invite=…` or equivalent) reassures them before requiring sign-in — can they say who invited them and what family this is, before authenticating? |
| B3 | "Sign in the way it asks you to." | Whether the magic-link flow is understood (no password confusion) and completes without a support-worthy stumble. |
| B4 | "Once you're in, look around — what do you think you're allowed to see or do here, versus what's off-limits to you?" | Role comprehension — can they correctly describe their own permissions (viewer/contributor/etc., whatever role the test invite was sent with) without being told? |
| B5 | "Make one small contribution — anything that feels welcoming and easy, not a big task." | Whether a first-time invited contributor finds an easy, low-friction action (a portrait, a correction, a memory — per §3.B) rather than being confronted with a blank, intimidating structural-edit surface. |

**Task-level success criteria:** same complete / completed-with-difficulty /
abandoned scoring as Group A, plus a specific flag for **B4** — if the
participant can't correctly describe their own role's boundaries, that's a
trust-comprehension failure regardless of whether they finished the task.

---

## Trust comprehension probes

Ask these after the task walkthrough, for **both** groups, as open
questions — do not offer multiple choice, and do not correct wrong answers
until after the interview ends (note the misconception, don't fix it live).
These map directly to the four items named in the brief's §13 success
measures.

1. **Privacy** — "In your own words, who can see the information you just
   added?" *(Listen for: living people/children protection, family-only
   visibility, whether they conflate this with a public/searchable tree.)*
2. **Roles** — "If you invited someone else to this family, what would they
   be able to see or change, versus what only you can do?" *(Listen for
   confident, roughly correct role differentiation vs. "I have no idea.")*
3. **Export/ownership** — "If you decided to stop using this product
   tomorrow, what do you think would happen to what you added?" *(Listen
   for whether they know export/deletion exists at all — not whether they
   can cite the exact mechanism.)*
4. **Advertising/data-use posture** — "Do you think this product shows ads
   or sells data based on what you add?" *(Listen for unprompted "no" vs.
   uncertainty — uncertainty here is itself the finding, since §2's "no dark
   patterns" principle is only met if this is obvious, not just true.)*

Score each as: **understood unprompted**, **understood after re-reading the
page**, or **misunderstood/no idea**. A participant needing to re-read is a
weaker but acceptable pass; a misunderstanding on any of the four is a
launch-blocking finding per the brief's own framing ("must be technically and
legally verified before launch" — §6.6).

## What to record per session

For each task: complete/difficulty/abandoned, time-on-task, verbatim quotes
at moments of hesitation or surprise, and any moment the participant says
some variant of "I don't know if I'm allowed to do this" (a direct trust
signal, distinct from a usability stumble). For each comprehension probe:
the score above plus the verbatim answer.

## Cross-checking against the funnel telemetry

The activation-funnel events shipped alongside this plan
(`docs/PRODUCTIZATION-BRIEF.md` §11.7 — `cta_click`, `path_chosen`,
`onboarding_completed`, `tree_created`, `import_completed`,
`invite_accepted`, `first_contribution`) tell you *where* real visitors drop
off in aggregate, with no ability to see *why*. Use this session's task
completion/abandonment points to form hypotheses for any funnel step with an
unexpectedly large drop, and use the funnel data to prioritise which of this
plan's tasks matter most to re-test at scale once fixes ship. Neither
replaces the other: the funnel shows scale, the sessions show cause.

## Synthesis and reporting

After all 10 sessions: group findings by task step (not by participant),
count how many of 5 hit complete / difficulty / abandoned at each step, and
list every trust-comprehension miss verbatim with the probe it came from.
Rank findings by: (1) any trust-comprehension miss — treat as launch-blocking
regardless of frequency, (2) any task abandonment, (3) high-friction
completions (3+ of 5 needed moderator help or multiple attempts). Deliver as
a short punch list, not a full report — the brief's own operating principle
(§2.3, "one clear next action") applies to how findings get handed back to
engineering too.

## Explicit disclosure

This plan is complete and ready to run, but running it requires a human
moderator, real recruited participants, and a staging environment — none of
which exist inside this sandbox. No sessions have been conducted. Treat
Phase B's "Newcomer and invited-relative usability testing" checklist item
as **planned, not executed**, until a human runs this script and the
synthesis above is filled in with real findings.

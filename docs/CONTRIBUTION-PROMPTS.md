# Contribution Prompts — the harvesting loop

> **One sentence:** ask one relative one grounded question at a time, route it to
> the person most likely to actually know the answer, and turn their reply into an
> attributed memory that appears in the Keepsake.

**Status:** Specification — not started
**Depends on:** nothing (Phase 1 is self-contained)
**Unblocks:** the Keepsake as a renewal-worthy product
**Related:** `docs/KEEPSAKE.md`, `docs/BUILD-PLAN.md` Phase 3 item 2 ("Family Interview Generator")

---

## 1. Why this exists

Measured in production on 2026-08-20:

| | Family A | Family B |
|---|---|---|
| People | 591 | 1,239 |
| Memories | **3** | — |
| Photos | **0** | — |
| Documents | **0** | — |
| Life events | **0** | — |
| Bios / life stories | **2 / 0** | — |
| Portraits | 0 | 342 (28%) |
| Birth dates | 66 (11%) | 921 (74%) |
| Deceased | — | 665 (**54%**) |

Family A has 591 people and **not one qualifies for a Keepsake** under the current
gate (67% completeness plus a life story). Across all of production, 14 Keepsakes
have ever been compiled.

The archives hold *facts* and almost no *material*. The Keepsake renders memories,
voices, photographs and stories — so it renders thin, and a thin book cannot carry a
subscription. Printing a fuller data extract would produce a longer document, not a
better book: a record is consulted once, a keepsake is re-read.

**The renderer is not the problem. The absence of an intake mechanism is.**

One more measured fact drives the whole routing design: **54% of people are
deceased.** Their stories cannot be self-reported. The material lives in other
people's heads, which means the loop must be able to ask *the right living relative*,
not just the archivist.

`contribution_prompt` already exists as a table. It has **0 rows**. This document
specifies what should write to it.

---

## 2. Principles

1. **One question, one person, one minute.** A prompt that feels like homework is
   not answered. Everything below optimises for a reply under sixty seconds.
2. **Ask someone who could plausibly know.** A question about a great-grandmother
   who died in 1970, sent to someone born in 1995, destroys trust in the feature
   permanently. This is a hard filter, not a ranking nudge (§4.2).
3. **Never invent.** The house rule from `docs/KEEPSAKE.md` applies with full force.
   Every question is grounded in a field, event, relationship, photo or document
   already on the record.
4. **Silence is an answer.** Decay and reassign; never nag.
5. **A question must never leak.** The text of a prompt can only contain facts the
   recipient is already permitted to see (§4.4).
6. **Show the payoff.** The loop only compounds if the answerer sees their words
   land in the book (§7).

---

## 3. Question generation

### 3.1 The gap model

Reuse `profileCompleteness()` (`src/lib/profile.js`) as the source of truth for what
is missing — it already computes the nine checks the profile meter uses, so prompts
and the meter can never disagree. Extend it with richer, story-shaped gaps:

| Gap | Kind | Priority |
|---|---|---|
| No memory at all | story | **highest** |
| Occupation known, no story about it | story | high |
| Military service on record, no narrative | story | high |
| Place lived recorded, no story about it | story | high |
| Photo exists with no caption | story | high |
| Portrait missing | fact | medium |
| Birth or death place missing | fact | medium |
| Fewer than 3 life events | story | medium |
| Document uploaded, never summarised | fact | low |
| Occupation missing | fact | low |

### 3.2 Two kinds, deliberately unbalanced

- **`story`** — open, produces a **memory**. This is the product.
- **`fact`** — closed, fills a **field**. This is the sweetener: a five-second win
  that keeps someone in the loop.

Target roughly **3 story : 1 fact**. A loop that drifts toward fact questions
becomes a data-entry chore and stops producing anything printable.

### 3.3 Deterministic templates (Phase 1, and the permanent fallback)

The loop must never block on model availability. A template library keyed by gap +
subject state covers the whole surface:

| Condition | Template |
|---|---|
| No memory, deceased | "What's your clearest memory of {name}?" |
| No memory, living | "What's something {name} always says?" |
| Occupation known | "{name} worked as a {occupation}. What was that like for the family?" |
| Military service | "{name} served with {unit}. Did they ever talk about it?" |
| Place lived | "The family lived in {place} around {year}. What do you remember about that house?" |
| Photo, no caption | *(photo shown)* "Who else is in this photograph, and when was it taken?" |
| Portrait missing | "Do you have a photograph of {name} we could add?" |
| Birthplace missing | "Do you know where {name} was born?" |

Every template renders the subject through `relationLabel(graph, recipientPersonId,
subjectId)` so the question reads in the recipient's own kinship terms — "your
grandmother Florence", not "Florence Mercer". This also picks up the viewer's custom
grandparent terms (`kinTerms.js`) for free.

### 3.4 AI generation (Phase 3)

Sonnet 4.6, following the conventions of the existing `insights` endpoint. Inputs are
strictly: the subject's own record, the recipient's relation label, and the gap being
targeted. The system prompt must forbid asserting any fact not in the input, because a
question that contains an invented detail reads as the product making things up about
a dead relative — the single worst failure mode available here.

**Measured cost basis:** the comparable `insights` endpoint averages 655 in / 188 out
= **$0.005 per call**. Twenty prompts per family per generation ≈ **$0.10**. This is
not a cost consideration at any plausible scale.

### 3.5 Volume cap

At most **20 open prompts per family** at any time, regenerated as they close. The
cap exists so an archivist opening the app never sees a wall of homework.

---

## 4. Routing — who gets asked

This is the part that decides whether the feature feels thoughtful or stupid.

### 4.1 Candidate pool

Members of the family (`family_member` ⋈ `user`) where:
- `user.person_id` is set — they are placed in the tree, so kinship is computable;
- `notification_prefs.prompts !== false`;
- the subject is visible to them under the existing visibility model.

### 4.2 The hard filter: could they possibly know?

Applied **before** ranking, and non-negotiable:

> If the subject is deceased, the recipient's birth year must be **earlier than the
> subject's death year**. If either year is unknown, the pair fails the filter unless
> the recipient is within distance 1.

Someone born in 1995 is never asked what they remember about a person who died in
1970. Getting this wrong once teaches a user the feature is automated noise.

### 4.3 Ranking

Using `distancesFrom(graph, subjectId)`:

| Rank | Who | Note |
|---|---|---|
| 1 | **Self** — `user.person_id === subjectId` | Best possible. Question is asked in the first person ("What's something you'd want remembered?"). Kind `self`. |
| 2 | Distance 1 — child, parent, partner, sibling | Strongest for both living and deceased subjects. |
| 3 | Distance 2 — grandchild, niece/nephew, in-law | The main path for deceased subjects. |
| 4 | Distance ≥ 3 | Only when nobody closer passes §4.2. |

**Load balancing.** Never send one member two prompts in the same cadence window, and
round-robin across eligible members so the archivist is not the only person asked.
Spreading the ask across the family is the entire point — a loop that only ever
questions the archivist produces a single voice, and the Voices spread needs several.

### 4.4 Privacy

The prompt text may only contain facts the recipient can already see. Concretely:
never construct a question from a living person's restricted fields, and never
surface health, cause-of-death or other sensitive fields to a `contributor`-role
member. When in doubt the generator drops the gap rather than softening the question.

---

## 5. Cadence

- **Default: one prompt per member per week.** Trivially switchable off.
- **Suppression:** if a member answered anything in the last 3 days, skip their slot.
  Never stack.
- **Decay:** a prompt unanswered after **21 days** becomes `expired` and is reassigned
  to the next-best candidate. The same question is never re-asked of the same person.
- **Seasonal boost:** December. The family is physically together, memory is at its
  most available, and it aligns with the Q4 print and gifting moment.

**Prerequisite:** `wrangler.toml` has **no `[triggers]` block today.** Weekly dispatch
needs a Cron Trigger added, plus a `scheduled` handler.

---

## 6. Answering

### 6.1 In-app (primary)

A prompt card in the app → textarea → `addMemory(personId, { text })`, which already
stamps `authorId` from the signed-in member. Prompt moves to `answered`, recording
`memory_id`.

### 6.2 Email → deep link (recommended for v1)

`sendEmail()` (`functions/_lib/util.js`) already supports `replyTo`, so
reply-by-email is *possible* — but it requires inbound routing and parsing.

**Recommendation: skip inbound email for v1.** Send a one-tap deep link
(`/?prompt={id}&token=…`) that opens the app directly into the answer box, authorised
by the existing magic-link mechanism. It reuses auth that already works, avoids
inbound parsing entirely, and gets the same conversion behaviour. Revisit true
reply-by-email only if measured answer rates justify it.

### 6.3 Fact answers are suggestions, not authority

A fact from a relative goes through a confirm step rather than writing silently —
reuse the document-fact pattern and stamp `field_sources` provenance so it can be
retracted later. A memory is that person's testimony and stands on its own; a date is
a claim about the record and needs the same care as a document-derived fact.

### 6.4 Attribution closes the loop

Memories carry `authorId`, and the Keepsake's Voices spread already renders
attributed pull-quotes ("— Rachel, granddaughter") via `relationLabel`. **No Keepsake
changes are required for answers to appear in the book.** That is the whole payoff and
it already works.

---

## 7. Making the loop visible

The renewal mechanic depends on people seeing their contribution land:

- **On answer:** "That's now part of Florence's Keepsake." — linking to the spread.
- **Edition diff:** "Your 2027 edition has 14 new memories and 3 new photographs since
  last year's." Editions and `factsHash` already exist; this only needs surfacing.
- **Archivist digest, monthly:** "3 relatives added 7 memories this month."

---

## 8. Data model

`contribution_prompt` exists. Required additions:

```sql
ALTER TABLE contribution_prompt ADD COLUMN sent_at     INTEGER;
ALTER TABLE contribution_prompt ADD COLUMN answered_at INTEGER;
ALTER TABLE contribution_prompt ADD COLUMN memory_id   TEXT;
ALTER TABLE contribution_prompt ADD COLUMN token       TEXT;
ALTER TABLE contribution_prompt ADD COLUMN priority    INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_prompt_open ON contribution_prompt(family_id, status, created_at);
CREATE INDEX idx_prompt_user ON contribution_prompt(user_id, status);
```

- `person_id` is the **subject** (who the question is about).
- `user_id` is the **recipient** (who is being asked).
- `kind` ∈ `story` | `fact` | `self`.
- `status` ∈ `open` → `sent` → `answered` | `expired` | `skipped`.

`user.notification_prefs` gains `prompts: true` (default on, matching `activity`).

---

## 9. Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/prompts/mine` | Open prompts for the signed-in member |
| `POST` | `/api/prompts/{id}/answer` | `{ text }` → memory, closes prompt |
| `POST` | `/api/prompts/{id}/skip` | "I don't know" → reassign to next candidate |
| `POST` | `/api/prompts/generate` | Admin/cron — generate for one family |
| *cron* | weekly `scheduled` | Dispatch one prompt per eligible member |

---

## 10. Phasing

| Phase | Scope | Proves |
|---|---|---|
| **1** | Deterministic templates, in-app cards only. No AI, no email, no cron. | That people answer at all. Cheapest possible test of the core idea. |
| **2** | Cron dispatch + email + deep-link answering. | That the loop runs without the archivist driving it. |
| **3** | AI question generation grounded in the record. | That better questions raise answer rate. |
| **4** | Voice answers — record → transcribe → memory. | Remento's insight: people won't write but will talk. R2 exists, so the old blocker is gone. |

Phase 1 is deliberately tiny and answers the only question that matters: **do
relatives reply?** If the answer rate is under ~10%, the problem is routing or copy,
and no amount of Phase 3 will rescue it.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Nagging drives churn | Weekly cap, 3-day suppression, one-tap off, decay to expired |
| Asking someone who cannot know | The §4.2 hard filter — this is the credibility of the whole feature |
| A question leaks a restricted fact | §4.4 — drop the gap rather than soften the question |
| Invented detail in AI questions | Deterministic templates are the fallback and the floor; AI never asserts |
| Low answer rate | Measured in Phase 1 before any further investment |
| Only the archivist ever answers | Round-robin routing (§4.3); the Voices spread needs several voices to work |

---

## 12. Acceptance criteria

1. A family with zero memories generates at least one grounded, on-record prompt per
   eligible member.
2. No prompt about a deceased subject reaches a member who was born after that
   subject died.
3. No prompt text contains a fact its recipient cannot already see in the app.
4. Answering a `story` prompt creates a memory attributed to the answerer, and that
   memory appears in the subject's Keepsake Voices spread with the correct kinship
   label — with no change to Keepsake code.
5. A member who turns prompts off receives none, by any channel.
6. An unanswered prompt expires at 21 days and is offered to the next candidate.
7. The same question is never asked of the same person twice.

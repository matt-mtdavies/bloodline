# The Focus Layer

> Status: **prototype, flag-gated, not wired into the app.** Open it at
> `?lab=focus`. Nothing here touches `src/data/store.js`; the only network call
> it can make is the same read-only `GET /api/tree` the Tree Motion Lab already
> uses, and only on an explicit button press. Closing the URL is the whole
> rollback.

## Why this exists

The organic tree has been asked, repeatedly, for two things it cannot give at
once: a composition that is guaranteed clean (parents above children, partners
level, nothing overlapping, nothing crossing) and a force simulation that makes
it feel alive. A force simulation sets *pressures*; the resting arrangement is
whatever compromise those pressures reach. Positional **guarantees** are a
different category of thing, and every attempt to get them out of the
simulation has either failed or been reverted.

Measured, on the real 1,239-person tree: **2.815 px/frame of residual drift at
250 visible nodes, versus 0.262 at 41 — 10.7×, from identical code.** The
problem was never the tuning. It was density.

So: stop asking one layer to do both jobs.

## The model

**Context layer.** The whole tree, drawn once to a canvas. Dim, small, blurred,
desaturated. It has *no legibility duty at all* — nobody reads a name in it.
Its only job is to be the place you came from, so the lift has somewhere to
lift from. It is allowed to be messy, because an out-of-focus background is
supposed to be.

**Focus layer.** One person's family — everyone whose relationship to them you
can name in a word. Computed positions, bounded size, large bubbles, real
portraits, names always on, real relationship lines. This is the product.

Every invariant that was impossible at 250 nodes is trivial at twenty. That
restriction is the entire idea.

## The invariants

Pinned as facts in `tests/focusLayout.test.mjs` (19 tests), not as tendencies.

**Structure**

1. The selected person is at world origin, always.
2. Every parent's row is strictly above every one of their children's.
3. Current partners share the selected person's row, adjacent, at exactly `POD`.
4. A former partner sits **above** their hub's row, offset **10°–45°** to the
   side, on the opposite side to any current partner. The geometry alone says
   the relationship ended; no label required.
5. Siblings share the selected person's row, in birth order across it.
6. Children are centred beneath the union that produced them. A former
   partner's children descend from the point on that dashed tie itself, so the
   two chapters stay visibly apart.
7. Nobody is placed twice, whatever route the graph offers to them.
8. No two bubbles overlap, and no two neighbours on a row sit closer than
   `MIN_NEIGHBOUR` — because their *names* need the room, which is the only
   collision a reader actually notices.

**Capacity and legibility** — deliberately separate knobs.

9. The focus layer never holds more than `CAPACITY` people (10 phone, 40
   desktop). Beyond that it sheds the **outermost ring** — grandparents first.
10. A focus bubble is never drawn below `MIN_DIAMETER` (76px). If the family
    cannot fit at that size the view becomes **pannable**. Shrinking past the
    floor is the one thing we never do, because a focus layer you have to
    squint at is not a focus layer.

**Motion**

11. One continuous motion between any two states. Nothing teleports.
12. **Drift at rest is 0.000 px/frame.** Measured, not asserted — see below.
13. The selected person is the fixed point. When the family doesn't fit, the
    camera centres on *them*, not on the bounding box.

**Determinism**

14. Identical input produces byte-identical output. No `Math.random`; every
    sort ends in an id comparison.
15. A change anywhere outside the focus set moves nothing inside it.

## The arrival

Four overlapping stages, ~1.4s end to end.

| ms | stage | what happens |
|---|---|---|
| 0–420 | **descent** | the tree recedes: scales to 0.9, blurs 8px, desaturates, drops to 13% |
| 0–820 | **lift** | the family travels from where it genuinely was in the tree to where the planner says it belongs, staggered outward from the selected person at 78ms per ring |
| ~600–1200 | **settle** | a spring, not an ease — a spring has a moment of *arriving* |
| 340–1400 | **connection** | lines draw themselves outward ring by ring: partner, children, siblings, parents, grandparents, and the former partner's tie last of all |

Selection-to-selection never descends and re-lifts. People already on screen
simply travel; people entering rise out of the context layer; people leaving
descend back into it.

### Why CSS transitions and not a simulation

This feature exists *because* a simulation could not hold still. So the motion
is declarative: every element's resting state is a transform, and going between
two states is a transition. When the transition ends the element sits at
exactly its planned coordinate and the compositor stops. **There is no `rAF`
loop in the renderer at all.** Invariant 12 is structural, not tuned.

The one continuous animation is a slow bloom of light around each disc — 7s,
phase-offset per ring. It changes light, not position. The scene stays alive
without anybody moving a pixel.

## Measurements

Taken against this prototype, not projected.

| | |
|---|---|
| drift at rest, 14 nodes, over 2.5s | **0.0000 px** (`tests/_fxdrift.mjs`) |
| focus plan, 5,000-person tree | **0.022 ms** avg, every person planned |
| context layout, 5,000-person tree | 75 ms, once |
| focus set size, 5,000-person tree | 5.3 avg, 12 max |
| smallest bubble, 1440×855 | 81 px, four generations, no panning |

Compare: the current tree's residual drift at 250 nodes is 2.815 px/frame.

## What we give up

- **Seeing the whole tree, sharp, at once.** "All" as it exists today does not
  survive. The context layer shows everyone, as texture. If you want to
  *comprehend* 1,239 people, that is List view's job, and List view is already
  better at it than a canvas ever was.
- **Emergent irregularity.** The focus layer is planned, so its charm has to be
  designed in rather than fallen out of. The bet is that the *motion* carries
  the life — something that arrives beautifully and then holds still feels more
  alive than something that never stops fidgeting, because the fidget is what
  currently reads as unstable.

## Files

| | |
|---|---|
| `src/viz/focus/focusLayout.js` | the planner. Pure, deterministic, no DOM. |
| `src/viz/focus/contextLayout.js` | the backdrop's generation-banded pack. Pure. |
| `src/viz/focus/FocusStage.jsx` | the renderer and the choreography. |
| `src/viz/focus/focus.css` | the visual language, and every transition. |
| `src/viz/focus/FocusLab.jsx` | the lab shell (`?lab=focus`). |
| `tests/focusLayout.test.mjs` | the 19 invariant tests. |

## Open questions

These are product decisions, not engineering ones, and the prototype
deliberately does not settle them.

1. **Does the context layer show all 1,239 people, or the Family Perimeter?**
   Today it shows everyone. The Perimeter already computes bounded
   neighbourhoods and might be the better backdrop.
2. **What replaces "All"?** Nothing in this model reveals the whole tree at
   working size, by design.
3. **Should the focus layer replace tapping a bubble in the current tree, or be
   a third view alongside Tree / Chart / List?**
4. **Phones.** A phone genuinely cannot show four generations of a wide family
   at a legible size. It currently sheds the grandparent ring and pans. A
   different composition for narrow screens may be the honest answer.

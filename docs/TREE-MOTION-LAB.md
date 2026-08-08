# Tree Motion Lab — `treePhysics=v2`

A fixture-only bench for a replacement tree layout and motion model. **Nothing
here is enabled in production, and nothing here touches real family data.**

---

## 1. Why this exists

PR #127 tried to fix the tree's composition by adding structural forces to the
existing d3-force simulation. It is the baseline this work starts from, and it
was reverted (#129) because it did not behave on a real tree.

The conceptual problem it ran into is worth stating plainly, because it is the
thing V2 is designed around:

> **"Organic" is a quality of motion, not a layout algorithm.**

V1 lets global forces decide where everyone ends up. Charge, links, collision
and generation bands all negotiate simultaneously, every frame, forever — so:

- the composition is an emergent side effect rather than a decision, and a
  distant branch can drag the family you are actually reading out of frame;
- clicking reheats the whole simulation, so everything moves, including the
  person you clicked;
- the camera re-frames from live bounds every frame, so the target moves while
  you are travelling toward it;
- `alphaTarget` is non-zero by design, so motion never actually stops — the
  "aliveness" is unfinished physics.

V2 inverts that. The composition is **decided once, by rules**, and motion is
what makes arriving at it feel alive.

---

## 2. Opening the lab

| URL | What you get |
|---|---|
| `/?lab=tree-motion` | The lab, V1 engine (default) |
| `/?lab=tree-motion&treePhysics=v2` | The lab, V2 engine |
| anything else | The normal app, production renderer, unchanged |

**Switching between V1 and V2**

- **In the lab:** the `?treePhysics=` query parameter, or the segmented control
  in the toolbar. The choice is remembered in `localStorage`
  (`bl_tree_physics`) so it survives reloads while you record comparisons; the
  query parameter always wins over the stored value, so a shared link is
  unambiguous.
- **In the app:** there is nothing to switch. V2 is not wired to production at
  all — `isV2Enabled()` is never consulted outside the lab, so no code path
  exists in which V2 renders a real family.

**Recovering production behaviour** is closing the lab URL. There is no flag to
flip back, no deploy, and no cache to clear.

---

## 3. Architecture

```
src/viz/v2/
  fixtures.js        structural family shapes, shared by lab and tests
  layoutPlanner.js   PURE. (graph, activeId, viewport) → target positions + camera
  springs.js         critically damped springs (closed form, exact at any dt)
  collision.js       bounded local de-overlap — the only remaining use of D3
  ambient.js         bounded, stateless breathing keyed per family unit
  metrics.js         frame-by-frame motion recorder
  engine.js          the four above as one headless, steppable object
  legacyEngine.js    V1's production force setup, same interface, lab-only
  TreeMotionLab.jsx  SVG bench + dev overlay
```

### The layout planner

`planFamilyLayout({ graph, activeId, visibleIds, viewport, anchor })` returns
deterministic target positions. Composition order — and this order **is** the
guarantee that distant relatives cannot disturb the near family:

1. the active person's **partner pod** is placed at world origin;
2. the **sibling rank** is packed in birth order, then shifted so the active
   person's own slot is exactly the origin;
3. the **parents' pod** is centred over the sibling rank;
4. **grandparents** are centred over the parents;
5. **children** are grouped by their own parent union, centred beneath it and
   evenly spread, with per-child slot widths so a married child's whole pod
   fits;
6. remaining near family (grandchildren, nieces and nephews) settle in the same
   way;
7. **everyone else** is packed per row into the space *outside* the near
   family's span.

Steps 1–6 never read step 7's people, so adding or removing an entire distant
branch cannot move the near family by any amount. That is asserted directly.

### Springs, not forces

`stepSpring` is the closed-form critically damped solution, so it is exact at
any timestep — a dropped frame moves a node exactly as far as the frames it
replaced would have, instead of the overshoot an explicit integrator produces
when `dt` spikes. Critical damping means the residual decays as
`(1 + ωt)·e^(−ωt)`: fastest possible approach, no overshoot, no oscillation.

Once the system is within the visible-motion threshold it is **snapped to its
targets and integration stops**. "Settles completely" has to mean completely; a
camera creeping by hundredths of a pixel forever is the thing being removed.

### The fixed point

The active person is placed at world origin, and the camera's world anchor *is*
the origin. So:

```
screen = anchor + (world − origin) × zoom = anchor
```

Their screen position is invariant under zoom — **exactly**, not approximately.
Zoom animates freely and they still cannot move. The screen anchor is therefore
*re-pointed instantly* on selection rather than animated (animating it would
drag the person you just clicked across the screen), and moving the composition
back toward the middle is a separate, deliberate `recenter()` that a transition
never does on its own.

### What D3 still does

Only `forceCollide`, only as a **clamped displacement** (≤ 14 world units)
applied on top of the spring positions, only while something is moving, and
never to the active person. It can stop two bubbles overlapping; it cannot
change which row or which family group anyone reads as part of. The layout
stays authoritative.

Determinism: `forceCollide` calls `jiggle()` (a random source) for exactly
coincident nodes, inherited from the simulation, so the simulation is seeded
with a fixed mulberry32 LCG. Identical input produces identical output, which is
what lets the motion tests assert exact numbers rather than tolerances.

### Ambient breathing

Bounded (±1.6 world units), a pure function of `(unit, time)` — nothing
integrates, so it cannot accumulate into drift — and **keyed per family unit**
so a couple breathes as one object rather than jostling each other. Never
applied to the active person. Disabled entirely under reduced motion.

---

## 4. Tests

```
npm run test:lab      # both suites
node tests/treeLayoutV2.test.mjs    # 17 structural invariants
node tests/treeMotionV2.test.mjs    # 18 integrated motion tests
```

**`treeLayoutV2`** asserts the composition rules across *every* fixture, and in
several cases for *every person* in every fixture — active-at-origin, parent
strictly above child, determinism, and input-order independence are all checked
exhaustively rather than on one hand-picked family, because every V1 failure was
a shape nobody had tested.

**`treeMotionV2`** never tests a force in isolation. Every assertion drives the
real engine through a real transition, frame by frame, with layout, springs,
collision, ambient motion and the camera all live at once — because that is how
V1's problems got through: each part behaved, the composite did not. It asserts:

- the selected person's screen position does not change for a single frame, for
  every person in every fixture;
- the pin survives a zoom that provably animates during the transition;
- macro motion settles, within a human-scale budget, and **stays** settled;
- the unsettled-node count never rises inside a transition (no oscillation);
- collision never exceeds its clamp and never breaks the planner's rows;
- breathing over five simulated minutes never wanders more than a few units and
  never counts as unsettled motion;
- a couple breathes with a shared phase;
- the camera has one destination and does not re-frame itself at rest;
- reduced motion arrives instantly and never moves again;
- two identical runs of the full pipeline produce identical frames;
- **the direct V1/V2 comparison**, asserting V1 drags the selected person and
  never settles while V2 holds them at exactly zero and does.

---

## 5. Recorded comparisons

```
npm run dev                       # in one shell
npm run lab:capture               # in another
```

Writes to `tests/lab-capture/` (gitignored):

- `<fixture>-<engine>-t{0,150,400,900,2000}.png` — timed frames of one scripted
  transition, sampled on a fixed clock rather than "when it looks done", because
  the claim under review is about what you see at a given moment after clicking;
- `<fixture>-<engine>.webm` — video of the same transition;
- `metrics.json` — every run's motion summary;
- `REPORT.md` — the side-by-side table.

Scope it with `FIXTURES=remarried,three-pod ENGINES=v2 npm run lab:capture`.

### How to read the metrics

| metric | meaning |
|---|---|
| `maxActiveDriftPx` | furthest the selected person moved on screen in one frame. **The headline number: V2 must be exactly 0.** |
| `settled` / `settleMs` | whether macro motion stopped, and how long it took |
| `reboundFrames` | frames where more nodes were moving than the frame before — the signature of a layout still arguing with itself |
| `maxCollisionPush` | largest displacement collision applied; must stay under the 14-unit clamp |
| `peakSpeed` | fastest node during the transition, world units/s |

The same numbers are live in the lab's dev overlay, so what a reviewer watches
and what CI enforces are the same instrumentation.

---

## 6. Scope of this PR, and what is deliberately not here

**In:** the planner, the motion model, the lab, the fixtures, the
instrumentation, the tests, the capture harness.

**Deliberately out:**

- **Pixi integration.** The lab renders SVG. The engine is renderer-agnostic and
  headless by design, but wiring it into `BubbleTree.jsx` is a separate step —
  this PR is the composition and the evidence.
- **Anything in production.** No persistence, API, D1, R2, migration or
  production-configuration change. `main.jsx` gained one lazy branch behind the
  lab URL; the lab is its own 29 kB chunk that an ordinary visitor never
  downloads.
- **Everything beyond the first active-centric composition** — no reveal/expand
  choreography, no lineage or time modes, no search flyover.

### Known limits to weigh before going further

- **The composition can run off the edge, and that is the honest consequence of
  the pin.** Honouring the anchor exactly means selecting someone near the edge
  leaves the family composed around them, partly off-screen — visible in
  `remarried-v2-t2000.png`, where the leftmost person is clipped. `recenter()`
  is the deliberate answer and is not called automatically, because calling it
  would move the person you just selected. **This is the main open product
  question from this PR:** always pin (occasional clipping), pin then
  auto-recenter after settling (a second movement), or clamp the anchor into a
  safe band (a small, immediate movement of the selected person). The lab exists
  to let you feel all three before choosing; only the first is implemented.
- **Collision routinely saturates its 14-unit clamp** on the denser fixtures.
  That is the clamp doing its job rather than a bug, but it means the packing
  constants (`UNIT_GAP`, `POD_GAP`) are slightly tighter than the collision
  radius really wants, and they should be reconciled before this drives a real
  renderer.
- **A couple whose two families sit far apart.** The planner hangs a pod under
  the near family's own structure; when both partners have their own parents
  placed, the pod can only satisfy one. Currently the active person's side wins,
  which is right for an active-centric layout but means the *other* partner's
  line reads as detached.
- **Very wide sibling ranks** pack to their natural width and can exceed the
  viewport; the camera frames the near family, so a rank of 8+ shrinks
  everything. A future pass may want row wrapping or a per-row scale.
- **`legacyEngine.js` duplicates production constants** rather than importing
  them, so `BubbleTree.jsx` can change without this comparison noticing. If the
  production constants move, refresh it before trusting a fresh capture.

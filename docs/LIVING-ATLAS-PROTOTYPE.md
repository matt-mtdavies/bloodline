# Living Atlas prototype

An isolated, read-only concept for replacing the one-layout global tree with a
focus-and-context experience.

## Open it

Run the app locally and visit:

```text
/?lab=living-atlas
```

The normal application is unchanged at every other URL. The prototype is
lazy-loaded and does not import `src/data/store.js`.

The fixture selector is the default and safest way to review the concept. The
explicit **Load my family · GET only** button reuses the Tree Motion Lab's
audited `fetchRealFamily()` helper: one authenticated `GET /api/tree`, only
after a deliberate click. The prototype has no PUT, sync, mutation or storage
path. It is a viewing experiment, not a new production renderer.

## What it tests

### Stable Family Atlas

- Every person receives deterministic coordinates based on surname lane and
  generation.
- Atlas coordinates do not change when another person is selected.
- At wide scale, individuals become quiet points inside labelled family
  constellations rather than pretending to be readable profile cards.
- The atlas has no force simulation and no positional ambient motion.

### Bounded Family Stage

- The selected person's neighbourhood is capped at 15 people on phone and 30
  on larger screens.
- Direct partners, parents, children and siblings are selected first.
- Grandparents, grandchildren and immediate partner context fill remaining
  capacity without recursive family expansion.
- Parents are above, partners share the selected person's row, siblings flank
  the partnership portrait, and children are below.
- Shared parents leave through one trunk and branch to siblings, avoiding the
  mesh of independent parent-child diagonals.

### Gather transition

One SVG identity exists per person. Selection changes its target between the
stable atlas and the deterministic stage; CSS transforms carry that same node
continuously between the two positions. There is no duplicate interactive
person and no force reheating. Reduced-motion users get a short 120ms
recomposition.

## Verification

```text
npm run test:atlas
npm run build
```

`test:atlas` runs every structural fixture at desktop and mobile sizes, checks
the core generation rules, proves atlas positions are selection-independent,
and plans a synthetic 5,000-person graph while keeping the staged family
bounded.

## Deliberate exclusions

- No production `BubbleTree` integration.
- No editing, persistence, D1/R2 or migration changes.
- No claim that the surname-lane atlas is the final global-map algorithm.
- No profile sheet, Perimeter, Search, Lineage or Time integration yet.
- No final photography treatment: fixtures use monograms so composition and
  choreography can be judged without external image loading.

The prototype should advance only if the family-gathering interaction feels
calm, legible and emotionally stronger than the current global graph. If that
does not land, closing the URL is the complete rollback.


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

The fixture selector is the default and safest way to review the concept. To
judge a real family shape, **Open GEDCOM · stays on device** reads a `.ged` or
`.gedcom` file with the existing client-side parser. The selected file never
leaves the browser: the prototype contains no `fetch`, API, authentication,
sync, production-store, D1 or R2 path. Its 25 MB input ceiling prevents an
accidental oversized file from freezing a phone. This is a viewing experiment,
not a new production renderer.

## What it tests

### Stable Family Atlas

- Every person receives deterministic coordinates based on surname lane and
  generation.
- Atlas coordinates do not change when another person is selected.
- At wide scale, individuals become quiet points inside labelled family
  constellations rather than pretending to be readable profile cards.
- Archives above 250 people open with that atlas in its quiet atmospheric
  state. Every distant person is drawn once and always behind the staged
  family; the complete atlas can still be brought forward with one tap.
- The atlas has no force simulation and no positional ambient motion.

### Bounded Family Stage

- The selected person's neighbourhood is capped at 8 people on phone and 30
  on larger screens.
- Phones use explicit spatial capacity—up to two partners, two parents and
  three children; siblings use genuinely spare positions rather than colliding
  with a full partnership row. Current partners precede former partners.
- Phones stop at that direct-family portrait; on larger screens grandparents,
  grandchildren and immediate partner context fill remaining capacity without
  recursive family expansion.
- Parents are above, partners share the selected person's row, siblings flank
  the partnership portrait, and children are below.
- Shared parents leave through one trunk and branch to siblings, avoiding the
  mesh of independent parent-child diagonals.

### Living canvas expansion

- The opening portrait is only the home scene. Hidden relationship groups are
  explicit labelled branches (Parents, Partners, Children, Siblings), never an
  unexplained `+N`.
- Selecting a visible relative does not reorganize the scene. It exposes that
  person's remaining branches; expanding one adds relatives without moving any
  existing person.
- The camera pans and eases to the newly opened branch. Users can drag the
  canvas itself, use Back to retrace expansions, or Home to restore the opening
  portrait. Individual people are never manually draggable.
- Every expansion is placed against the accumulated scene's occupied
  portrait-and-nameplate footprints. The nearest clear, relationship-correct
  location wins (parents remain above, children below, lateral branches to a
  side), while all existing coordinates remain fixed. The camera keeps both
  the branch and the person it grew from in view.
- Full/half siblings and step-siblings are separate labelled branches. A
  parent's partner's other children are shown as read-only inferred
  step-siblings, without writing that inference into the tree. Two people with
  the same two recorded parents remain full siblings even if a lossy GEDCOM
  PEDI qualifier marked those imported parent edges as step.
- Reduced-motion users get short 120ms transitions.

## Verification

```text
npm run test:atlas
npm run build
```

`test:atlas` runs every structural fixture at desktop and mobile sizes, checks
the core generation rules, proves atlas positions are selection-independent,
checks step-sibling discovery and position persistence across expansion, and
checks first and consecutive expansions against selectable-card overlap, and
plans a synthetic 5,000-person graph while keeping the staged family bounded.

## Deliberate exclusions

- No production `BubbleTree` integration.
- No editing, persistence, authentication, network, D1/R2 or migration changes.
- No claim that the surname-lane atlas is the final global-map algorithm.
- No profile sheet, Perimeter, Search, Lineage or Time integration yet.
- GEDCOM cannot carry Bloodline photos, memories or Keepsakes, so the local
  real-shape review deliberately uses monograms only.

The prototype should advance only if the family-gathering interaction feels
calm, legible and emotionally stronger than the current global graph. If that
does not land, closing the URL is the complete rollback.

# Tree Insights

A "Tree Insights" surface that turns the family archive into something you can
*feel*, told from the logged-in viewer's seat in the tree. Reached via an
**Insights** button on the family-archive panel (the stats popover).

Two layers, deliberately separated so the cheap/private one carries the value
and the AI is only ever a *narrator over verified facts* — never the source of
them.

## Layer 1 — Computed perspective insights (instant, private, free)

Pure function `computeInsights(graph, viewerId)` in `src/lib/insights.js`. No
network, no PII leaves the device. Everything degrades gracefully when data is
sparse (an insight is simply omitted, never guessed).

**Perspective facts** (relative to the viewer's claimed person, falling back to
the focal person):

- **Your line** — earliest direct ancestor reachable up the parent chain, with
  the year and how many generations up.
- **Your generations** — how many generations sit above and below you.
- **Your circle** — how many relatives are connected to you, and how many are
  living.
- **Cousins** — count of people whose relationship label resolves to a cousin.
- **The heart of the tree** — the most-connected person (highest direct degree).
- **Longest life** — the longest lifespan among people with both dates.
- **Eldest living** — oldest living person with a birth date.
- **Most common decade** — the birth decade most people share.
- **Largest surname line** — the most common surname and its count.

**Completeness nudges** (actionable — the panel's bars, turned into quests):
people missing a life story / birth date / portrait, **sorted by closeness to
the viewer** (BFS hop distance), surfaced as "N people need X — start with the
closest." Tapping a name navigates to that person so they can fill it in.

## Layer 2 — Grounded AI narrative (server-side, cached)

A warm 3–4 sentence paragraph that ties the computed facts into a story
("Four generations, anchored by the Davies and Threlfall lines, reaching back
to Robyn Norris in 1952…").

- Endpoint: `POST /api/insights` → Anthropic (`ANTHROPIC_API_KEY`, server-side
  only). Returns `{ narrative }`. `503` when the key is absent (feature hides).
- **Grounding:** the client sends only the *aggregate facts* produced by
  layer 1 — counts, spans, completeness, a handful of first names already shown
  publicly in the stats panel (earliest/latest ancestor). No living-person
  detail, no minors. The system prompt forbids inventing names, dates, or
  relationships not present in the facts.
- **Caching:** the client caches the narrative in `localStorage` keyed by a hash
  of the facts. It regenerates only when the facts change or the user taps
  "Regenerate" — so a panel open never re-bills.

## Privacy

- Anthropic key server-side only (existing constraint).
- Narrative input is aggregate + already-public names; person-specific nudges are
  computed and rendered entirely client-side.
- The whole surface is owner/member-facing inside the app; nothing is published.

## Files

- `src/lib/insights.js` — the computed engine (layer 1).
- `functions/api/insights.js` — the grounded narrative endpoint (layer 2).
- `src/components/TreeInsights.jsx` — the sheet (narrative + facts + nudges).
- Hook-up: an Insights button in `TopBar` stats popover → opens the sheet in
  `App`, which passes `graph`, the viewer id, and a navigate callback.

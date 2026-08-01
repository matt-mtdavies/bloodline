/*
 * Family Perimeter Preview — category classification, shared by the list
 * (PerimeterPreview.jsx) and the generational diagram (PerimeterGenogram.jsx)
 * so both read the exact same rule rather than two independently-maintained
 * copies of "what counts as an aunt."
 *
 * Pure and derived entirely from the canonical inclusionReasonById entry
 * perspectiveIndex.js already computes for every perimeter member — no new
 * inclusion logic here, just a finer read of the existing route/closeness/
 * degree/removal/side fields.
 */

// Deliberately does NOT split by which anchor (viewer vs. current partner)
// produced an ancestor/descendant/cousin route — both anchors' primary
// perimeters fold into the same generation/degree bucket, since from a
// shared-household perspective "your parents" and "your partner's parents"
// both just read as "Parents" here. Only the family-halo and partner-context
// TIERS (routes that are inherently about someone else's connections, not a
// shared lineage) get their own "via your partner"-style buckets.
export const CATEGORY_META = {
  you: { label: 'You & your partner', order: 0 },
  parents: { label: 'Parents', order: 1 },
  auntsUncles: { label: 'Aunts & Uncles', order: 2 },
  siblings: { label: 'Siblings', order: 3 },
  children: { label: 'Children', order: 4 },
  niecesNephews: { label: 'Nieces & Nephews', order: 5 },
  grandparents: { label: 'Grandparents', order: 6 },
  greatAuntsUncles: { label: 'Great-aunts & Great-uncles & further back', order: 7 },
  grandchildren: { label: 'Grandchildren', order: 8 },
  grandNiecesNephews: { label: 'Grand-nieces & Grand-nephews & further on', order: 9 },
  greatGrandparents: { label: 'Great-grandparents & further back', order: 10 },
  greatGrandchildren: { label: 'Great-grandchildren & further on', order: 11 },
  cousins1: { label: '1st cousins', order: 12 },
  cousins2: { label: '2nd cousins', order: 13 },
  cousins3: { label: '3rd cousins', order: 14 },
  halo: { label: 'Connected through marriage', order: 15 },
  partnerFamily: { label: "Your partner's family", order: 16 },
  everyone: { label: 'Everyone in your tree', order: 17 },
  other: { label: 'Other', order: 18 },
};

/*
 * Resolves which bucket a perimeter member belongs in from their canonical
 * reason alone. `route: 'everyone'` (only ever produced at the Complete
 * family tree level — see perspectiveIndex.js's own comment on why it
 * "skips cousin calculation entirely") carries no real relationship route,
 * so everyone there collapses to one bucket except the viewer/current
 * partner themselves, checked directly against graph.partners.
 *
 * The degree-0 collateral branch (siblings/aunts-uncles/nieces-nephews) is
 * the one genuinely subtle part: genealogically, a sibling, an aunt/uncle,
 * and a niece/nephew are ALL "0th cousin, at some removal" — the engine's
 * `degree` field alone can't tell them apart, only `removal` (how many
 * generations apart) and `side` ('older'/'younger'/'same', which side of the
 * shared ancestor the person sits on) can. A real production bug: without
 * this split, "Barry McInnes — Half-Uncle" and "Elaine Ransom — Your
 * partner's maternal Aunt" both landed under a "Siblings" heading, which is
 * wrong — an uncle is not a sibling just because the underlying degree math
 * calls both "degree 0".
 */
export function categoryFor(id, viewerId, graph, reason) {
  if (!reason) return 'other';
  if (reason.tier === 'familyHalo') return 'halo';
  if (reason.tier === 'partnerContext') return 'partnerFamily';
  if (reason.route === 'everyone') {
    if (id === viewerId) return 'you';
    return graph.partners(viewerId).some((p) => p.id === id && p.status === 'current') ? 'you' : 'everyone';
  }
  if (reason.route === 'anchor') return 'you';
  if (reason.route === 'ancestor') {
    const dist = reason.closeness?.[0] ?? 0;
    if (dist === 1) return 'parents';
    if (dist === 2) return 'grandparents';
    return 'greatGrandparents';
  }
  if (reason.route === 'descendant') {
    const dist = reason.closeness?.[0] ?? 0;
    if (dist === 1) return 'children';
    if (dist === 2) return 'grandchildren';
    return 'greatGrandchildren';
  }
  if (reason.route === 'cousin') {
    const degree = reason.degree ?? reason.closeness?.[0] ?? 1;
    if (degree === 0) {
      const removal = reason.removal ?? 0;
      if (removal === 0) return 'siblings';
      if (reason.side === 'older') return removal === 1 ? 'auntsUncles' : 'greatAuntsUncles';
      if (reason.side === 'younger') return removal === 1 ? 'niecesNephews' : 'grandNiecesNephews';
      // side missing or 'same' with removal>0 shouldn't happen (removal=0
      // whenever side='same'), but degrade to the plainest true statement.
      return 'siblings';
    }
    if (degree === 1) return 'cousins1';
    if (degree === 2) return 'cousins2';
    return 'cousins3';
  }
  return 'other';
}

// Within a category, order by closeness to the viewer first (matches the
// rings' own "radiating outward from you" metaphor, and the search box
// already covers "find a specific name"), alphabetical as the tiebreak —
// never the other way around. The viewer themself always leads "You & your
// partner" regardless of name.
export function secondarySortValue(id, viewerId, reason) {
  if (id === viewerId) return -1;
  if (!reason) return 0;
  if (reason.route === 'cousin') return reason.removal ?? 0;
  return reason.closeness?.[0] ?? 0;
}

// Groups every perimeter member of a computed perspective index by category,
// optionally filtered by a lowercase search term against display_name — the
// one place both the list (PerimeterPreview) and the diagram
// (PerimeterGenogram) derive their grouping from, so they can never disagree
// about who's in which bucket.
export function groupPeopleByCategory(perspectiveIndex, viewerId, graph, { filterTerm } = {}) {
  const byCategory = new Map();
  for (const id of perspectiveIndex.perimeterIds) {
    const p = graph.byId.get(id);
    if (!p) continue;
    if (filterTerm && !p.display_name?.toLowerCase().includes(filterTerm)) continue;
    const reason = perspectiveIndex.inclusionReasonById.get(id);
    const cat = categoryFor(id, viewerId, graph, reason);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push({ person: p, reason });
  }
  return byCategory;
}

/*
 * Whether a category is included by the perimeter RULE at a given engine
 * level (1 | 2 | 3 | 'everyone') — independent of whether this particular
 * family actually has anyone recorded in it. Grounded directly in
 * computePrimaryPerimeter's own logic (perspectiveIndex.js): direct
 * ancestors/descendants are walked unconditionally regardless of level, and
 * the collateral (cousin) walk's only level-gate is `degree > maxDegree` —
 * degree 0 (siblings/aunts-uncles/nieces-nephews) and degree 1 (1st cousins)
 * always pass since maxDegree is never below 1 at a real level, so the ONLY
 * categories a level can actually exclude are 2nd and 3rd cousins. This is
 * what powers PerimeterGenogram's live "why does Close family already
 * include almost everything" boundary.
 */
export function categoryQualifiesAtLevel(category, engineLevel) {
  if (engineLevel === 'everyone') return true;
  if (category === 'cousins2') return engineLevel >= 2;
  if (category === 'cousins3') return engineLevel >= 3;
  return true;
}

/*
 * The generational layout for PerimeterGenogram — an ordered top-to-bottom
 * stack of rows, each a horizontal band of category "chips". Deliberately
 * folds each degree-0 collateral category into the row of the generation it
 * actually sits in (Aunts & Uncles beside Parents, Nieces & Nephews beside
 * Children, ...) rather than giving every category its own row — the point
 * of the diagram is "here's the shape of a family tree, here's where the
 * boundary falls," not an exhaustive index (the list below already is one).
 */
export const GENOGRAM_ROWS = [
  { key: 'ggparents', chips: [{ cat: 'greatGrandparents', label: 'Great-grandparents & beyond' }] },
  { key: 'grandparents', chips: [{ cat: 'grandparents', label: 'Grandparents' }, { cat: 'greatAuntsUncles', label: 'Great-aunts & uncles' }] },
  { key: 'parents', chips: [{ cat: 'parents', label: 'Parents' }, { cat: 'auntsUncles', label: 'Aunts & Uncles' }] },
  {
    key: 'you',
    chips: [
      { cat: 'you', label: 'You' },
      { cat: 'siblings', label: 'Siblings' },
      { cat: 'cousins1', label: '1st cousins' },
      { cat: 'cousins2', label: '2nd cousins' },
      { cat: 'cousins3', label: '3rd cousins' },
    ],
  },
  { key: 'children', chips: [{ cat: 'children', label: 'Children' }, { cat: 'niecesNephews', label: 'Nieces & Nephews' }] },
  { key: 'grandchildren', chips: [{ cat: 'grandchildren', label: 'Grandchildren' }, { cat: 'grandNiecesNephews', label: 'Grand-nieces & nephews' }] },
  { key: 'ggchildren', chips: [{ cat: 'greatGrandchildren', label: 'Great-grandchildren & beyond' }] },
];

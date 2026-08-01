/*
 * Family Perimeter — the shared Perspective Index (Phase 2 of
 * docs/FAMILY-PERIMETER-AND-5000-PERSON-PERFORMANCE.md §3/§6.6).
 *
 * A single pure function computing, for one viewer and one perimeter
 * setting, exactly who counts as "everyday family" and why. Every product
 * surface (tree rendering, search, insights, boundary UI) is meant to
 * consume this output rather than re-deriving inclusion logic itself — the
 * spec is explicit that a second competing interpretation of cousin degree,
 * step propagation, or halo membership is the failure mode this guards
 * against.
 *
 * Deliberately reuses graph.js's existing biological/adoptive primitives
 * (`ancestorsWithDistance`, `descendantsWithDistance`, `nearestCommonAncestor`,
 * `bloodRelativesOf`, `relationLabel`, `pathBetweenOrdered`) rather than
 * reimplementing lineage/cousin-degree math here — the whole point of
 * extracting those in graph.js was so this file has exactly one place to
 * call, not a second parallel definition of "cousin."
 *
 * Pure and side-effect-free: never mutates `graph` or any person/
 * relationship record, and returns entirely new Sets/Maps every call — the
 * caller (Phase 6+) owns memoizing this by the cache identity the spec
 * defines: familyRevision + viewerPersonId + perimeterLevel +
 * currentPartnerSet + bloodlineOnly.
 */
import {
  ancestorsWithDistance,
  descendantsWithDistance,
  bloodRelativesOf,
  relationLabel,
  pathBetweenOrdered,
} from '../data/graph.js';

// ── small pure helpers ──────────────────────────────────────────────────

function addCandidate(candidatesByPersonId, id, candidate) {
  if (!candidatesByPersonId.has(id)) candidatesByPersonId.set(id, []);
  candidatesByPersonId.get(id).push(candidate);
}

// §4.5: never guess that an unqualified partner is current — only an
// EXACT recorded 'current' status counts. Anything else (undefined,
// 'former', 'widowed') falls through to the "shared child" halo test below,
// never silently promoted.
function isCurrentPartnerStatus(status) {
  return status === 'current';
}

function sharesChildWith(graph, aId, bId) {
  return graph.children(aId).some((c) => graph.children(bId).some((c2) => c2.id === c.id));
}

// Precedence order from §3.4: anchor/primary perimeter > family halo >
// partner context ring > temporary reveal. A weaker route never overwrites
// a stronger one.
const TIER_RANK = { primary: 0, familyHalo: 1, partnerContext: 2, temporaryReveal: 3 };

// Compares two candidate reasons for the same person and returns which one
// is the canonical explanation: lower tier wins, then the closer
// relationship within a tier (smaller "closeness" — generation distance for
// direct lineage, [degree, removal] for cousins), then a STABLE id-based
// tie-break (never "whichever was seen first") so the result is the same
// regardless of the order people/relationships were supplied in.
function compareReasons(a, b) {
  const t = TIER_RANK[a.tier] - TIER_RANK[b.tier];
  if (t) return t;
  const ac = a.closeness || [];
  const bc = b.closeness || [];
  const len = Math.max(ac.length, bc.length);
  for (let i = 0; i < len; i++) {
    const d = (ac[i] ?? 0) - (bc[i] ?? 0);
    if (d) return d;
  }
  const aKey = a.sourceId || '';
  const bKey = b.sourceId || '';
  if (aKey !== bKey) return aKey < bKey ? -1 : 1;
  const ar = a.route || '';
  const br = b.route || '';
  if (ar !== br) return ar < br ? -1 : 1;
  return 0;
}

function resolveCanonicalReasons(candidatesByPersonId) {
  const resolved = new Map();
  for (const [id, candidates] of candidatesByPersonId) {
    let best = null;
    for (const c of candidates) {
      if (!best || compareReasons(c, best) < 0) best = c;
    }
    resolved.set(id, best);
  }
  return resolved;
}

// ── anchors (§3.2) ───────────────────────────────────────────────────────

function buildAnchorIds(graph, viewerId) {
  const anchors = new Set([viewerId]);
  for (const p of graph.partners(viewerId)) {
    if (isCurrentPartnerStatus(p.status)) anchors.add(p.id);
  }
  return anchors;
}

// ── layer 1: primary perimeter (§3.4 #1, §3.5 steps 2-4, §3.6) ─────────

function computePrimaryPerimeter(graph, anchorIds, perimeterLevel, candidatesByPersonId) {
  const primaryIds = new Set();
  const directLineIds = new Set();

  // §3.5/§3.6 require ALL direct ancestors/descendants and cousins "at any
  // removal" — no arbitrary generation cap. ancestorsWithDistance/
  // descendantsWithDistance default to maxDepth=8 (fine for relationLabel's
  // own naming use, which never needs to reach further), but that default
  // would silently truncate a real perimeter here (Codex review, PR #87).
  // Their own `visited` set already makes the traversal cycle-safe with NO
  // depth limit at all — a corrupt cycle just runs out of new neighbours,
  // it doesn't loop forever — so the only reason to pass a bound here is a
  // defensive backstop, not a correctness requirement: no family can have
  // more generations than it has people, so graph.people.length+1 can never
  // truncate a real line while still being a hard, finite ceiling.
  const safeDepth = graph.people.length + 1;

  const addPrimary = (id, candidate) => {
    primaryIds.add(id);
    addCandidate(candidatesByPersonId, id, candidate);
  };

  if (perimeterLevel === 'everyone') {
    // §3.5 step 3: mark every person primary, skip cousin calculation
    // entirely. directLine is still meaningful under Everyone — it's a
    // narrower cohort (§4.4), not a rendering gate.
    for (const p of graph.people) {
      addPrimary(p.id, { tier: 'primary', route: 'everyone', sourceId: p.id, closeness: [0] });
    }
    for (const anchorId of anchorIds) {
      if (!graph.byId.has(anchorId)) continue;
      directLineIds.add(anchorId);
      for (const id of ancestorsWithDistance(graph, anchorId, safeDepth).keys()) directLineIds.add(id);
      for (const id of descendantsWithDistance(graph, anchorId, safeDepth).keys()) directLineIds.add(id);
    }
    return { primaryIds, directLineIds };
  }

  // Close family = 1, Extended = 2, Wider = 3. Anything else unrecognized
  // degrades to the most conservative real setting rather than silently
  // becoming Everyone.
  const maxDegree = perimeterLevel === 1 || perimeterLevel === 2 || perimeterLevel === 3 ? perimeterLevel : 1;

  for (const anchorId of anchorIds) {
    if (!graph.byId.has(anchorId)) continue;
    addPrimary(anchorId, { tier: 'primary', route: 'anchor', sourceId: anchorId, closeness: [0] });
    directLineIds.add(anchorId);

    const ups = ancestorsWithDistance(graph, anchorId, safeDepth);
    for (const [id, node] of ups) {
      if (id === anchorId) continue;
      addPrimary(id, { tier: 'primary', route: 'ancestor', sourceId: anchorId, closeness: [node.distance] });
      directLineIds.add(id);
    }

    const downs = descendantsWithDistance(graph, anchorId, safeDepth);
    for (const [id, node] of downs) {
      if (id === anchorId) continue;
      addPrimary(id, { tier: 'primary', route: 'descendant', sourceId: anchorId, closeness: [node.distance] });
      directLineIds.add(id);
    }

    // Collateral relatives (§3.6): for every ancestor A of the anchor, walk
    // DOWN from A. degree = min(upA, downB) - 1 must stay <= maxDegree.
    //
    // The descending leg only needs to be BOUNDED (to maxDegree+1) when A is
    // already far enough up (upA > maxDegree+1) that upA could never be the
    // smaller leg — otherwise a distant descendant (large downB) is still
    // safely <= maxDegree, since degree = min(upA,downB)-1 <= upA-1 <=
    // maxDegree regardless of how big downB gets. So when upA <= maxDegree+1,
    // the descent is deliberately UNBOUNDED (within descendantsWithDistance's
    // own generous depth guard) — this is exactly what "any removal" means:
    // a niece/nephew (upA=1) and their own descendants, arbitrarily far
    // removed, all still qualify at every real perimeter level. Only once A
    // is too far up to possibly be the closer leg does the descent need
    // capping, to stop finding overly-distant cousins through it.
    for (const [ancId, ancNode] of ups) {
      const upA = ancNode.distance;
      if (upA < 1) continue; // ancId === anchor itself — nothing collateral from here
      const descFromAnc = upA <= maxDegree + 1
        ? descendantsWithDistance(graph, ancId, safeDepth)
        : descendantsWithDistance(graph, ancId, maxDegree + 1);
      for (const [candId, candNode] of descFromAnc) {
        const downB = candNode.distance;
        if (downB < 1) continue; // candId === ancId itself
        if (candId === anchorId) continue;
        const degree = Math.min(upA, downB) - 1;
        if (degree < 0 || degree > maxDegree) continue;
        const removal = Math.abs(upA - downB);
        addPrimary(candId, {
          tier: 'primary', route: 'cousin', sourceId: anchorId, closeness: [degree, removal], degree, removal,
        });
      }
    }
  }

  return { primaryIds, directLineIds };
}

// ── layer 2: family halo (§3.4 #2, §3.5 step 5) — one pass, no recursion ──

function computeFamilyHalo(graph, primaryIds, candidatesByPersonId) {
  const haloIds = new Set();
  const haloPartnerIds = new Set(); // people added specifically via the partner bullet — step 6 reads only these

  const addHalo = (id, originId, route) => {
    haloIds.add(id);
    addCandidate(candidatesByPersonId, id, { tier: 'familyHalo', route, sourceId: originId, closeness: [1] });
  };

  for (const originId of primaryIds) {
    if (!graph.byId.has(originId)) continue;
    // parents()/children()/siblings() already carry every qualifier
    // (biological/adoptive/step) unfiltered, so "step-parents, step-
    // siblings and stepchildren" fall out of this for free — no separate
    // step-only pass needed.
    for (const p of graph.parents(originId)) addHalo(p.id, originId, 'parent');
    for (const c of graph.children(originId)) addHalo(c.id, originId, 'child');
    for (const s of graph.siblings(originId)) addHalo(s.id, originId, 'sibling');
    for (const partner of graph.partners(originId)) {
      // "Former partners where a shared child... makes them necessary to
      // understand the unit" (§3.5 step 5) — a former/widowed/unqualified
      // partner qualifies only with real recorded evidence (a shared
      // child), never guessed from status alone (§4.5).
      const qualifies = isCurrentPartnerStatus(partner.status) || sharesChildWith(graph, originId, partner.id);
      if (!qualifies) continue;
      addHalo(partner.id, originId, 'partner');
      haloPartnerIds.add(partner.id);
    }
  }

  return { haloIds, haloPartnerIds };
}

// ── layer 3: partner context ring (§3.4 #3, §3.5 step 6) — one pass ─────

function computePartnerContextRing(graph, haloPartnerIds, candidatesByPersonId) {
  const contextIds = new Set();
  const addContext = (id, sourceId, route) => {
    contextIds.add(id);
    addCandidate(candidatesByPersonId, id, { tier: 'partnerContext', route, sourceId, closeness: [1] });
  };
  for (const partnerId of haloPartnerIds) {
    if (!graph.byId.has(partnerId)) continue;
    for (const p of graph.parents(partnerId)) addContext(p.id, partnerId, 'parent');
    for (const s of graph.siblings(partnerId)) addContext(s.id, partnerId, 'sibling');
    for (const c of graph.children(partnerId)) addContext(c.id, partnerId, 'child');
  }
  return contextIds;
}

// ── boundary edges (§3.9) — perimeter person -> outside person, deduped ──

function computeBoundaryEdges(graph, perimeterIds, outsideIds) {
  const edges = [];
  const seen = new Set();
  for (const id of perimeterIds) {
    if (!graph.byId.has(id)) continue;
    const neighbours = [
      ...graph.parents(id).map((x) => x.id),
      ...graph.children(id).map((x) => x.id),
      ...graph.partners(id).map((x) => x.id),
      ...graph.siblings(id).map((x) => x.id),
    ];
    for (const n of neighbours) {
      if (!outsideIds.has(n)) continue;
      const key = `${id}|${n}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ fromId: id, toId: n });
    }
  }
  return edges;
}

// ── Bloodline-only projection (§3.7) — narrows, never adds ──────────────

// A partner-anchor is trivially "their own blood relative" under
// bloodRelativesOf's reflexive definition (it starts from {focusId}) — but
// being an anchor doesn't make a partner blood to the VIEWER, so each
// anchor's own reflexive self-membership is excluded here. Their actual
// bio/adoptive lineage (parents, shared children, ...) still counts, per
// §3.2's "both sides of a current household" — only the partner-as-a-person
// link itself is partner-only, exactly what §3.7 says Bloodline-only removes.
// The viewer is re-added explicitly, since "my own bloodline view" trivially
// always includes the viewer regardless of this exclusion.
function computeBloodlineProjection(graph, perimeterIds, anchorIds, viewerId) {
  const blood = new Set([viewerId]);
  for (const anchorId of anchorIds) {
    if (!graph.byId.has(anchorId)) continue;
    for (const id of bloodRelativesOf(graph, anchorId)) {
      if (id === anchorId) continue;
      blood.add(id);
    }
  }
  const kept = new Set();
  for (const id of perimeterIds) if (blood.has(id)) kept.add(id);
  return kept;
}

// ── temporary reveal (§3.8) — session-only presentation, never saved ────

function computeTemporaryReveal(graph, anchorIds, perimeterIds, targetIds) {
  const presentationIds = new Set();
  const pathById = new Map();
  if (!targetIds || !targetIds.length) return { presentationIds, pathById };

  for (const targetId of targetIds) {
    if (!graph.byId.has(targetId) || perimeterIds.has(targetId)) continue;

    // "Minimum understandable connection path from the nearest anchor."
    let best = null;
    for (const anchorId of anchorIds) {
      const path = pathBetweenOrdered(graph, anchorId, targetId);
      if (path && (!best || path.length < best.length)) best = path;
    }
    if (best) {
      pathById.set(targetId, best);
      for (const id of best) presentationIds.add(id);
    }

    // "The target's local family unit."
    presentationIds.add(targetId);
    for (const p of graph.parents(targetId)) presentationIds.add(p.id);
    for (const c of graph.children(targetId)) presentationIds.add(c.id);
    for (const s of graph.siblings(targetId)) presentationIds.add(s.id);
    for (const partner of graph.partners(targetId)) presentationIds.add(partner.id);
  }
  return { presentationIds, pathById };
}

// ── explanations (§3.10) — composed from real relationLabel calls only ──

function lowerFirst(s) { return s ? s[0].toLowerCase() + s.slice(1) : s; }
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

function relDescriptor(graph, fromId, toId) {
  const label = relationLabel(graph, fromId, toId);
  return label === 'You' ? 'you' : lowerFirst(label);
}

// A lowercase, viewer-relative noun phrase for `id` ("your 1st cousin",
// "your partner's 2nd cousin", "your 1st cousin's partner") — built by
// walking the SAME inclusion-reason chain that decided membership, so an
// explanation can never claim a relationship the engine didn't actually
// derive from recorded edges (§4.5).
function possessivePhrase(graph, viewerId, id, resolvedReasons) {
  if (id === viewerId) return 'you';
  const reason = resolvedReasons.get(id);
  if (!reason || reason.tier === 'primary') {
    const anchorId = reason?.sourceId ?? viewerId;
    if (anchorId === viewerId) return `your ${relDescriptor(graph, viewerId, id)}`;
    if (id === anchorId) return 'your partner';
    return `your partner's ${relDescriptor(graph, anchorId, id)}`;
  }
  const base = possessivePhrase(graph, viewerId, reason.sourceId, resolvedReasons);
  return `${base}'s ${relDescriptor(graph, reason.sourceId, id)}`;
}

function explainInclusion(graph, viewerId, id, resolvedReasons) {
  if (id === viewerId) return 'You';
  const reason = resolvedReasons.get(id);
  if (!reason) return 'Relative.';
  if (reason.tier === 'temporaryReveal') return 'Temporarily shown from Search.';
  if (reason.tier === 'primary') {
    // §3.5 step 3's 'everyone' branch deliberately marks every person
    // primary with `sourceId: p.id` (self-referential) rather than computing
    // a real relationship route — "skip cousin calculation entirely" is the
    // whole point of that branch, for performance. Without this check, the
    // self-referential sourceId satisfies `id === anchorId` below for EVERY
    // single person, so every row would misread "Your partner." regardless
    // of the real relationship (a real bug this surfaced: PerimeterPreview
    // is the first caller to ever display explainInclusion's text for the
    // 'everyone' level — nothing before it did).
    if (reason.route === 'everyone') return 'In your family tree.';
    const anchorId = reason.sourceId;
    if (anchorId === viewerId) return `${capitalize(relDescriptor(graph, viewerId, id))}.`;
    if (id === anchorId) return 'Your partner.';
    return `Your partner's ${relDescriptor(graph, anchorId, id)}.`;
  }
  const rel = capitalize(relDescriptor(graph, reason.sourceId, id));
  const sourcePhrase = possessivePhrase(graph, viewerId, reason.sourceId, resolvedReasons);
  return `${rel} of ${sourcePhrase}.`;
}

// ── top-level orchestration (§3.5) ───────────────────────────────────────

function emptyIndex(graph) {
  return {
    anchorIds: new Set(),
    primaryIds: new Set(),
    familyHaloIds: new Set(),
    partnerContextIds: new Set(),
    perimeterIds: new Set(),
    outsideIds: new Set(graph.people.map((p) => p.id)),
    inclusionReasonById: new Map(),
    inclusionReasonsById: new Map(),
    explanationById: new Map(),
    relationshipById: new Map(),
    boundaryEdges: [],
    bloodlineIds: null,
    minimumRevealPathById: new Map(),
    temporaryRevealPresentationIds: new Set(),
    insightCohortIds: {
      personal: new Set(),
      context: new Set(),
      complete: new Set(graph.people.map((p) => p.id)),
      directLine: new Set(),
      temporaryReveal: new Set(),
    },
  };
}

/*
 * computePerspectiveIndex(graph, options) — the one function every product
 * surface should call instead of reimplementing perimeter logic.
 *
 * options:
 *   viewerId          — required; returns an empty/degenerate index (§3.1's
 *                        "not yet claimed a person" case is a caller-side
 *                        decision — pass perimeterLevel:'everyone' and a
 *                        valid viewerId once one exists) if missing/unknown.
 *   perimeterLevel     — 1 | 2 | 3 | 'everyone' (default 'everyone', matching
 *                        §3.1's "existing users initially receive Complete
 *                        family tree").
 *   bloodlineOnly      — narrows perimeterIds to biological/adoptive lineage
 *                        (§3.7); does not change perimeterIds itself —
 *                        read `bloodlineIds` when this is true.
 *   temporaryRevealIds — outside-person ids to add to a session-only
 *                        presentation set (§3.8); never changes perimeterIds
 *                        or insightCohortIds.personal/context.
 *
 * `inclusionReasonById` is the one CANONICAL reason per person (for ordinary
 * explanation); `inclusionReasonsById` is every qualifying reason for that
 * same person, sorted so index 0 always equals the canonical one — §3.4
 * requires retaining every route a person qualifies through for diagnostics,
 * even though only one is ever shown by default.
 */
export function computePerspectiveIndex(graph, options = {}) {
  const {
    viewerId,
    perimeterLevel = 'everyone',
    bloodlineOnly = false,
    temporaryRevealIds = [],
  } = options;

  if (!viewerId || !graph.byId.has(viewerId)) return emptyIndex(graph);

  const anchorIds = buildAnchorIds(graph, viewerId);
  const candidatesByPersonId = new Map();

  const { primaryIds, directLineIds } = computePrimaryPerimeter(graph, anchorIds, perimeterLevel, candidatesByPersonId);
  const { haloIds, haloPartnerIds } = computeFamilyHalo(graph, primaryIds, candidatesByPersonId);
  const partnerContextIds = computePartnerContextRing(graph, haloPartnerIds, candidatesByPersonId);

  const perimeterIds = new Set([...primaryIds, ...haloIds, ...partnerContextIds]);
  const outsideIds = new Set();
  for (const p of graph.people) if (!perimeterIds.has(p.id)) outsideIds.add(p.id);

  const boundaryEdges = computeBoundaryEdges(graph, perimeterIds, outsideIds);

  // Temporary-reveal candidates are folded into the SAME candidate pool
  // before canonical resolution runs — this is what lets a reveal target
  // who's already reachable some weaker way still show every qualifying
  // reason (§3.4: "the engine retains all qualifying reasons for
  // diagnostics"), and it's a no-op for canonical purposes since
  // temporaryReveal is already the lowest-ranked tier (a stronger existing
  // reason always still wins).
  const { presentationIds: temporaryRevealPresentationIds, pathById: minimumRevealPathById } =
    computeTemporaryReveal(graph, anchorIds, perimeterIds, temporaryRevealIds);
  for (const id of temporaryRevealPresentationIds) {
    addCandidate(candidatesByPersonId, id, { tier: 'temporaryReveal', route: 'reveal', sourceId: id, closeness: [0] });
  }

  // Canonical reason (one per person, for ordinary explanation) AND the
  // full retained candidate list (§3.4: "retains all qualifying reasons for
  // diagnostics") — the same sort order (compareReasons) that picks the
  // canonical winner also orders the full list, so inclusionReasonsById[id][0]
  // is always exactly inclusionReasonById.get(id).
  const inclusionReasonById = resolveCanonicalReasons(candidatesByPersonId);
  const inclusionReasonsById = new Map();
  for (const [id, candidates] of candidatesByPersonId) {
    inclusionReasonsById.set(id, [...candidates].sort(compareReasons));
  }

  const relationshipById = new Map();
  const explanationById = new Map();
  for (const id of new Set([...perimeterIds, ...temporaryRevealPresentationIds])) {
    relationshipById.set(id, relationLabel(graph, viewerId, id));
    explanationById.set(id, explainInclusion(graph, viewerId, id, inclusionReasonById));
  }

  const bloodlineIds = bloodlineOnly ? computeBloodlineProjection(graph, perimeterIds, anchorIds, viewerId) : null;

  const insightCohortIds = {
    personal: new Set([...primaryIds, ...haloIds]),
    context: new Set(partnerContextIds),
    complete: new Set(graph.people.map((p) => p.id)),
    directLine: directLineIds,
    temporaryReveal: temporaryRevealPresentationIds,
  };

  return {
    anchorIds,
    primaryIds,
    familyHaloIds: haloIds,
    partnerContextIds,
    perimeterIds,
    outsideIds,
    inclusionReasonById,
    inclusionReasonsById,
    explanationById,
    relationshipById,
    boundaryEdges,
    bloodlineIds,
    minimumRevealPathById,
    temporaryRevealPresentationIds,
    insightCohortIds,
  };
}

/*
 * computeInsightCohorts(graph, options) — Phase 6 (§4.4/§6.9). Insights,
 * Home and Timeline need `insightCohortIds` (personal/context/complete/
 * directLine/temporaryReveal) available UNCONDITIONALLY — even for the
 * overwhelming majority of viewers who have never narrowed their perimeter
 * below Everyone, where App.jsx's own `perspective` stays `null` (see its
 * own comment: computed only when `perimeterActive`, to keep every EXISTING
 * perimeter-UI consumer — search badges, boundary labels, the reconciler —
 * a total no-op until a viewer deliberately narrows their perimeter).
 *
 * Reusing `perspective` itself for this would leak insight-cohort
 * availability into those UI consumers too (several of them treat
 * "perspective is non-null" as "show perimeter-aware UI," not merely "cohort
 * data happens to exist") — so this is a deliberately SEPARATE, lighter
 * sibling: it calls the exact same three inclusion-layer building blocks
 * computePerspectiveIndex does (computePrimaryPerimeter/computeFamilyHalo/
 * computePartnerContextRing — the "one pass each, no recursion" layers) but
 * skips everything Insights never needs — boundaryEdges, relationshipById,
 * explanationById, minimumRevealPathById, bloodlineIds — each of which does
 * real additional per-person work (relationLabel walks ancestor chains).
 *
 * `viewerId` missing/unknown: an honest "no personalization available" is
 * `personal = complete` (everyone counts), NOT the empty Sets
 * emptyIndex() returns for the perimeter/rendering case above — that empty
 * shape means "nothing is in view yet," which is right for a canvas about
 * to render nothing, and wrong for an insight module about to silently
 * report zero facts about a family that's actually fully populated.
 */
export function computeInsightCohorts(graph, options = {}) {
  const { viewerId, perimeterLevel = 'everyone' } = options;
  const complete = new Set(graph.people.map((p) => p.id));
  if (!viewerId || !graph.byId.has(viewerId)) {
    return { personal: complete, context: new Set(), complete, directLine: new Set(), temporaryReveal: new Set() };
  }
  const anchorIds = buildAnchorIds(graph, viewerId);
  const candidatesByPersonId = new Map();
  const { primaryIds, directLineIds } = computePrimaryPerimeter(graph, anchorIds, perimeterLevel, candidatesByPersonId);
  const { haloIds, haloPartnerIds } = computeFamilyHalo(graph, primaryIds, candidatesByPersonId);
  const partnerContextIds = computePartnerContextRing(graph, haloPartnerIds, candidatesByPersonId);
  return {
    personal: new Set([...primaryIds, ...haloIds]),
    context: new Set(partnerContextIds),
    complete,
    directLine: directLineIds,
    // No temporary-reveal concept outside the full perspective — a lighter
    // caller (Insights/Home/Timeline) never registers reveal targets.
    temporaryReveal: new Set(),
  };
}

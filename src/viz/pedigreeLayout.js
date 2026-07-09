/*
 * Pedigree layout — the chart view's engine (DOM renderer: ChartTree.jsx).
 *
 * Modelled on the classic genealogy pedigree (the FamilySearch landscape
 * view is the reference): the FOCAL person's union card sits at the root,
 * ancestors fan out one union card per parent-couple, and every member of
 * every card carries their OWN line upward. This is the load-bearing
 * difference from the old "one tidy descendant tree of everything
 * reachable" engine: there, each person could appear under only ONE side
 * of any marriage, so remarriage always forced a lossy choice (whose
 * parents does the couple hang under? which partner is shown?). Here a
 * card in person m's parent slot is, by construction, the union of M'S OWN
 * recorded parents — both of whom then continue their own lines — so the
 * "which side" question never arises.
 *
 * Scope is deliberately lazy: only the focal card, its drawn children row,
 * and whatever ancestor branches have been explicitly expanded are computed
 * and laid out. Nothing else in a 300-person tree costs anything, and the
 * view can never sprawl beyond what was asked for. Descendant navigation is
 * re-rooting (tap a child), not infinite downward drawing.
 *
 * computePedigree(graph, focusId, { expandedUp, partnerChoice, orientation })
 *   → { cards: [card], connectors: [conn], focalCardId }
 *
 * card: { id, kind: 'union'|'child', members: [personId], lineMemberIds,
 *         x, y, w, h, rowY: [y-offsets], marriage, childrenCount,
 *         slots: [{ id, hasMoreUp, expanded, canAddParent, altPartnerIds }] }
 * conn: { id, kind: 'up'|'down', fromCardId, toCardId, fromAnchorX, ... }
 */

import { CARD_W, ROW_H, MARRIAGE_H, FOOTER_H, CHILD_W } from './pedigreeMetrics.js';

const GEN_GAP = 72;        // edge-to-edge between a card and its parents' row
const PAIR_GAP = 40;       // between the two parent cards above one card
const BRANCH_GAP = 64;     // between unrelated expanded branches
const CHILD_GAP = 26;      // between drawn children cards
const CHILD_DROP = 64;     // edge-to-edge from focal card down to children
const MAX_GENERATIONS = 14; // hard safety on ancestor recursion

const isBioAdopt = (q) => !q || q === 'biological' || q === 'adoptive' || q === 'adopted';

// ── Union derivation ─────────────────────────────────────────────────────────

// The partner shown beside someone on THEIR OWN (focal) card, absent an
// explicit spouse-switch: the co-parent they share the most bio/adoptive
// children with (a real family often records an ex only as each child's
// other parent, never as a formal partner), tie-broken by partner-edge
// status (current > widowed > former > no edge), falling back to their
// best-status partner when there are no children in the picture.
export function primaryUnionPartner(graph, personId) {
  const partners = graph.partners(personId);
  const statusRank = (s) => (s === 'former' ? 0 : s === 'widowed' ? 1 : 2);
  const rankOf = (id) => {
    const p = partners.find((x) => x.id === id);
    return p ? statusRank(p.status) : -1;
  };
  const tally = new Map();
  for (const kid of graph.children(personId)) {
    if (!isBioAdopt(kid.qualifier)) continue;
    for (const par of graph.parents(kid.id)) {
      if (par.id === personId || !isBioAdopt(par.qualifier)) continue;
      tally.set(par.id, (tally.get(par.id) || 0) + 1);
    }
  }
  if (tally.size) {
    let best = null, bestCount = -1, bestRank = -2;
    for (const [pid, count] of tally) {
      const rank = rankOf(pid);
      if (count > bestCount || (count === bestCount && rank > bestRank)) {
        best = pid; bestCount = count; bestRank = rank;
      }
    }
    return best;
  }
  if (!partners.length) return null;
  let best = partners[0], bestRank = statusRank(partners[0].status);
  for (const p of partners.slice(1)) {
    const r = statusRank(p.status);
    if (r > bestRank) { best = p; bestRank = r; }
  }
  return best.id;
}

// Everyone who could sit beside this person on a card: recorded partners
// plus bio/adoptive co-parents (deduped) — the spouse-switcher's menu.
export function unionCandidates(graph, personId) {
  const out = new Map(); // id -> {id, status|null, sharedChildren}
  for (const p of graph.partners(personId)) {
    out.set(p.id, { id: p.id, status: p.status ?? null, sharedChildren: 0 });
  }
  for (const kid of graph.children(personId)) {
    if (!isBioAdopt(kid.qualifier)) continue;
    for (const par of graph.parents(kid.id)) {
      if (par.id === personId || !isBioAdopt(par.qualifier)) continue;
      const cur = out.get(par.id) || { id: par.id, status: null, sharedChildren: 0 };
      cur.sharedChildren += 1;
      out.set(par.id, cur);
    }
  }
  return [...out.values()];
}

// All children belonging to a displayed union (either member), deduped and
// annotated for the popover: which member(s) each child is linked to, with
// what qualifiers, and (when linked to only one member) who the OTHER
// recorded co-parent is, for "with <name>" grouping.
export function childrenOfUnion(graph, aId, bId) {
  const rows = new Map(); // childId -> row
  const collect = (memberId, key) => {
    if (!memberId) return;
    for (const kid of graph.children(memberId)) {
      const row = rows.get(kid.id) || { id: kid.id, aQualifier: null, bQualifier: null, otherParentId: null };
      row[key] = kid.qualifier || 'biological';
      rows.set(kid.id, row);
    }
  };
  collect(aId, 'aQualifier');
  collect(bId, 'bQualifier');
  for (const row of rows.values()) {
    const linkedA = row.aQualifier != null, linkedB = row.bQualifier != null;
    if (linkedA !== linkedB) {
      // Linked to one displayed member only — find their other bio parent
      // (outside this union) so the popover can group "with <name>".
      const insideId = linkedA ? aId : bId;
      const other = graph.parents(row.id).find((p) => p.id !== insideId && isBioAdopt(p.qualifier));
      row.otherParentId = other?.id ?? null;
    }
  }
  const birthYear = (id) => {
    const m = String(graph.byId.get(id)?.birth_date || '').match(/\d{4}/);
    return m ? parseInt(m[0], 10) : 9999;
  };
  return [...rows.values()].sort((x, y) => birthYear(x.id) - birthYear(y.id)
    || (graph.byId.get(x.id)?.display_name || '').localeCompare(graph.byId.get(y.id)?.display_name || ''));
}

// ── Card construction ────────────────────────────────────────────────────────

function bioParentsOf(graph, personId) {
  return graph.parents(personId).filter((p) => isBioAdopt(p.qualifier)).map((p) => p.id);
}

// Marriage line data for a displayed pair — the partner edge's status and
// (optional) marriage date/place. Bio co-parents with no partner edge at
// all get null: the card shows just its divider, asserting co-parenthood
// without inventing a marriage.
function marriageOf(graph, aId, bId) {
  if (!aId || !bId) return null;
  const edge = graph.partners(aId).find((p) => p.id === bId);
  if (!edge) return null;
  return {
    status: edge.status ?? 'current',
    date: edge.marriage_date ?? null,
    place: edge.marriage_place ?? null,
    isMarried: !!edge.is_married,
  };
}

// A tile claims "this exact pair parented this child" — reserved for rows
// where every displayed member is a recorded biological/adoptive parent. A
// step-link, or a child only one member has any recorded tie to at all,
// doesn't earn a tile even though it's still real; those stay reachable
// (correctly grouped and chip-labelled) through the children popover.
function isTileWorthyChild(row, hasSecondMember) {
  return isBioAdopt(row.aQualifier) && (hasSecondMember ? isBioAdopt(row.bQualifier) : true);
}

function cardHeight(card) {
  const rows = card.members.length;
  const marriage = card.members.length === 2 ? MARRIAGE_H : 0;
  const footer = card.kind === 'focalUnion'
    ? (card.hiddenChildrenCount > 0 ? FOOTER_H : 0)
    : (card.childrenCount > 0 ? FOOTER_H : 0);
  return rows * ROW_H + marriage + footer;
}

// Orders a displayed pair for presentation: line members keep their given
// order (child's parents in edge order); a switched-in partner sits second.
function makeUnionCard(graph, lineMemberIds, displayed, kind, { expandedUp, partnerChoice }) {
  const members = displayed.filter(Boolean);
  const kidRows = childrenOfUnion(graph, members[0], members[1] ?? null);
  const hasSecondMember = members.length === 2;
  const hiddenChildrenCount = kidRows.filter((r) => !isTileWorthyChild(r, hasSecondMember)).length;
  const slots = members.map((id) => {
    const parents = bioParentsOf(graph, id);
    const alt = unionCandidates(graph, id).filter((c) => !members.includes(c.id));
    return {
      id,
      hasMoreUp: parents.length > 0,
      expanded: parents.length > 0 && expandedUp.has(id),
      canAddParent: parents.length === 0,
      altPartnerIds: alt.map((c) => c.id),
      isLine: lineMemberIds.includes(id),
      switched: partnerChoice.get(lineMemberIds[0]) != null || partnerChoice.get(lineMemberIds[1] ?? '') != null,
    };
  });
  const card = {
    id: 'u_' + members.join('_'),
    kind,
    members,
    lineMemberIds,
    slots,
    marriage: members.length === 2 ? marriageOf(graph, members[0], members[1]) : null,
    childrenCount: kidRows.length,
    childRows: kidRows,
    hiddenChildrenCount,
    x: 0, y: 0, w: CARD_W, h: 0,
  };
  card.h = cardHeight({ ...card, kind: kind === 'focal' ? 'focalUnion' : kind });
  return card;
}

// Resolve which pair an ancestor slot displays: the child's own recorded
// parents by default; a spouse-switch on either parent swaps the OTHER
// side out for the chosen partner (and that side's up-line with it).
function displayedPairForSlot(parentIds, partnerChoice) {
  const [p1, p2] = parentIds;
  if (p1 && partnerChoice.get(p1) !== undefined) {
    const chosen = partnerChoice.get(p1);
    return chosen ? [p1, chosen] : [p1];
  }
  if (p2 && partnerChoice.get(p2) !== undefined) {
    const chosen = partnerChoice.get(p2);
    return chosen ? [p2, chosen] : [p2];
  }
  return parentIds;
}

// ── The pedigree itself ──────────────────────────────────────────────────────

export function computePedigree(graph, focusId, { expandedUp, partnerChoice, orientation = 'vertical' } = {}) {
  const empty = { cards: [], connectors: [], focalCardId: null, bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 } };
  if (!focusId || !graph?.byId?.has(focusId)) return empty;
  expandedUp = expandedUp ?? new Set();
  partnerChoice = partnerChoice ?? new Map();
  const opts = { expandedUp, partnerChoice };

  const cards = [];
  const connectors = [];

  // Focal union: the focus person plus their displayed partner.
  const chosenFocalPartner = partnerChoice.get(focusId);
  const focalPartner = chosenFocalPartner !== undefined
    ? chosenFocalPartner
    : primaryUnionPartner(graph, focusId);
  const focal = makeUnionCard(graph, [focusId], focalPartner ? [focusId, focalPartner] : [focusId], 'focal', opts);
  cards.push(focal);

  // ── Ancestors: recursive, expansion-driven. Returns the branch's span
  //    along the cross axis, placing cards into `cards` at (crossCenter,
  //    gen). A member's branch exists only while `expandedUp` says so. ──────
  const seen = new Set(focal.members);

  function buildAncestors(card, gen) {
    if (gen > MAX_GENERATIONS) return;
    for (const slot of card.slots) {
      if (!slot.expanded) continue;
      const parentIds = bioParentsOf(graph, slot.id).slice(0, 2);
      if (!parentIds.length) continue;
      // A cycle in the data (guarded on write, but trees sync from outside)
      // must never hang the layout.
      if (parentIds.some((p) => seen.has(p))) continue;
      const displayed = displayedPairForSlot(parentIds, partnerChoice);
      const pCard = makeUnionCard(graph, parentIds, displayed, 'ancestor', opts);
      pCard._childCardId = card.id;
      pCard._viaMemberId = slot.id;
      pCard._gen = gen + 1;
      for (const m of pCard.members) seen.add(m);
      cards.push(pCard);
      slot._parentCardId = pCard.id;
      buildAncestors(pCard, gen + 1);
    }
  }
  focal._gen = 0;
  buildAncestors(focal, 0);

  // ── Cross-axis placement: classic pedigree spans, bottom-up. ─────────────
  const byId = new Map(cards.map((c) => [c.id, c]));
  function span(card) {
    if (card._span != null) return card._span;
    const upIds = card.slots.map((s) => s._parentCardId).filter(Boolean);
    let s = card.w;
    if (upIds.length) {
      const upSpan = upIds.reduce((sum, id, i) => sum + span(byId.get(id)) + (i ? PAIR_GAP : 0), 0);
      s = Math.max(s, upSpan);
    }
    card._span = s;
    return s;
  }
  function place(card, crossCenter) {
    card._cross = crossCenter;
    const upCards = card.slots.map((s) => (s._parentCardId ? byId.get(s._parentCardId) : null)).filter(Boolean);
    if (!upCards.length) return;
    const total = upCards.reduce((sum, c, i) => sum + span(c) + (i ? PAIR_GAP : 0), 0);
    let cursor = crossCenter - total / 2;
    for (const c of upCards) {
      const s = span(c);
      place(c, cursor + s / 2);
      cursor += s + PAIR_GAP;
    }
  }
  span(focal);
  place(focal, 0);

  // ── Generation (main-axis) placement: each generation row sits clear of
  //    the tallest card in the previous one, so mixed solo/couple rows never
  //    collide vertically. gen 0 = focal at 0; ancestors negative-up. ───────
  const maxGen = Math.max(...cards.map((c) => c._gen));
  const rowHeight = [];
  for (let g = 0; g <= maxGen; g++) {
    rowHeight[g] = Math.max(0, ...cards.filter((c) => c._gen === g).map((c) => c.h));
  }
  const genOffset = [0];
  for (let g = 1; g <= maxGen; g++) {
    genOffset[g] = genOffset[g - 1] + rowHeight[g - 1] / 2 + GEN_GAP + rowHeight[g] / 2;
  }
  for (const c of cards) { c._main = genOffset[c._gen]; }

  // ── Focal children row: drawn cards one step below, honest connectors —
  //    a child linked to only ONE displayed member hangs from that member's
  //    half of the card, not from the couple's shared middle. A tile claims
  //    "this pair parented this child," so it's reserved for children where
  //    every displayed member is a recorded biological/adoptive parent —
  //    a step-link, or a child only one member has any recorded tie to at
  //    all, doesn't earn a tile even though it's still real. Those stay
  //    reachable (correctly grouped and chip-labelled) through the same
  //    children popover ancestor cards use, via focal.hiddenChildrenCount. ──
  const childCards = [];
  {
    const hasSecondMember = focal.members.length === 2;
    const rows = focal.childRows.filter((r) => isTileWorthyChild(r, hasSecondMember));
    if (rows.length) {
      const sideOf = (row) => {
        const linkedA = row.aQualifier != null, linkedB = row.bQualifier != null;
        return linkedA && linkedB ? 'both' : linkedA ? 'a' : 'b';
      };
      const ordered = [
        ...rows.filter((r) => sideOf(r) === 'a'),
        ...rows.filter((r) => sideOf(r) === 'both'),
        ...rows.filter((r) => sideOf(r) === 'b'),
      ];
      const totalW = ordered.length * CHILD_W + (ordered.length - 1) * CHILD_GAP;
      let cursor = -totalW / 2;
      for (const row of ordered) {
        const grandkids = childrenOfUnion(graph, row.id, null).length;
        const cc = {
          id: 'c_' + row.id,
          kind: 'child',
          members: [row.id],
          lineMemberIds: [row.id],
          slots: [],
          marriage: null,
          childrenCount: grandkids,
          side: sideOf(row),
          qualifiers: { a: row.aQualifier, b: row.bQualifier },
          w: CHILD_W,
          h: ROW_H + (grandkids > 0 ? FOOTER_H : 0),
          _cross: cursor + CHILD_W / 2,
          _gen: -1,
        };
        cc._main = -(focal.h / 2 + CHILD_DROP + cc.h / 2);
        cursor += CHILD_W + CHILD_GAP;
        childCards.push(cc);
        cards.push(cc);
        connectors.push({
          id: `down_${focal.id}_${cc.id}`,
          kind: 'down',
          fromCardId: focal.id,
          toCardId: cc.id,
          side: cc.side,
        });
      }
    }
  }

  // Ancestor connectors — one per expanded member slot, anchored to that
  // member's half of the card so the two lines out of a couple visibly
  // belong to their own people.
  for (const card of cards) {
    for (const slot of card.slots ?? []) {
      if (slot._parentCardId) {
        connectors.push({
          id: `up_${card.id}_${slot.id}`,
          kind: 'up',
          fromCardId: card.id,
          fromMemberId: slot.id,
          toCardId: slot._parentCardId,
        });
      }
    }
  }

  // ── Map (cross, main) → screen. Vertical: ancestors above, children
  //    below. Horizontal: focal fixed at the centre (always local origin —
  //    see place(focal, 0) above), ancestors recede to the LEFT, children
  //    sit to the RIGHT — you now, past behind, future ahead. ──────────────
  const horizontal = orientation === 'horizontal';
  for (const c of cards) {
    if (horizontal) { c.x = -c._main; c.y = c._cross; }
    else { c.x = c._cross; c.y = -c._main; }
  }
  // In horizontal mode the drawn children (negative main) stack better with
  // a tighter cross: re-stack them vertically beside the focal card.
  if (horizontal && childCards.length) {
    const totalH = childCards.reduce((s, c) => s + c.h, 0) + (childCards.length - 1) * CHILD_GAP;
    let cursor = -totalH / 2;
    for (const c of childCards) {
      c.x = focal.w / 2 + CHILD_DROP + c.w / 2 + 40;
      c.y = cursor + c.h / 2;
      cursor += c.h + CHILD_GAP;
    }
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of cards) {
    minX = Math.min(minX, c.x - c.w / 2); maxX = Math.max(maxX, c.x + c.w / 2);
    minY = Math.min(minY, c.y - c.h / 2); maxY = Math.max(maxY, c.y + c.h / 2);
  }

  return { cards, connectors, focalCardId: focal.id, bounds: { minX, maxX, minY, maxY } };
}

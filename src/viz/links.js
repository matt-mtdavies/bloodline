import { hex } from '../lib/color.js';

/*
 * A step parent-edge is "mediated" — already implied by a marriage — when the
 * step-parent is currently partnered (not former) with a biological/adoptive
 * parent of the child. e.g. Heather is step-mother to Jess *because* she is
 * partnered with Ken, who is Jess's biological father. The couple pod plus
 * Ken's solid line to Jess already encode the step bond, so the redundant
 * dashed Heather→Jess line is suppressed on the canvas to keep the tree clean.
 *
 * Orphan step bonds (a step-parent with no current partnership to a bio/adoptive
 * parent of the child) are NOT mediated — those keep a visible line. Step
 * relationships always appear in profiles regardless of this rendering choice.
 */
function stepEdgeMediated(graph, parentId, childId) {
  const bioAdopt = new Set(
    graph.parents(childId)
      .filter((p) => !p.qualifier || p.qualifier === 'biological' || p.qualifier === 'adoptive')
      .map((p) => p.id),
  );
  return graph.partners(parentId).some(
    (pt) => pt.status !== 'former' && bioAdopt.has(pt.id),
  );
}

/*
 * Draws everything *between* the bubbles, every frame, into one Graphics that
 * sits behind them:
 *   - Couples as one visual unit: a soft membrane binding partners. Current
 *     unions read warm and solid; former partners are a faded dashed bond
 *     (still shown — divorce doesn't erase a co-parent); widowed unions carry
 *     the memorial violet.
 *   - Parent links: biological are solid and quiet; adopted / foster are dashed
 *     in a distinct tone. Step bonds implied by a marriage are not drawn (see
 *     stepEdgeMediated); orphan step bonds ghost-faint until the person is active.
 *
 * Link opacity follows the ego camera: bonds far from the focused person fade
 * back with their bubbles.
 */
const ACCENT = 0xc2603a;

// Parent→child line widths, broadest at the parents and thinnest at the child.
// A merged sibling trunk passes through JUNCTION_W between the two, so the
// stem and its branches read as one continuous narrowing rather than a step.
const PARENT_W = 3.6;
const JUNCTION_W = 2.3;
const CHILD_W = 1.1;

// Linear-interpolate two 0xRRGGBB colours.
function lerpColor(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16)
    | (Math.round(ag + (bg - ag) * t) << 8)
    | Math.round(ab + (bb - ab) * t);
}

export function drawLinks(
  g, graph, pos, isVisible, baseRadius, lineagePath = null, activeId = null,
  edgeLitAt = null, nowMs = 0, landedAt = 0, holdMs = 0, staggerMs = 0, fadeMs = 1,
) {
  g.clear();
  // Only draw a link when both people are currently revealed.
  const hidden = (a, b) => !(isVisible(a) && isVisible(b));
  // When a lineage path is active, non-path edges dim to 12%; path edges are
  // drawn normally then re-highlighted in a second pass at the end.
  const onPath = lineagePath ? (a, b) => lineagePath.has(a) && lineagePath.has(b) : () => false;
  const edgeAlpha = lineagePath ? (a, b) => (onPath(a, b) ? 1 : 0.12) : () => 1;
  // How brightly a lit edge burns right now, 0 -> 1: igniting over a beat as
  // the drone's light actually reaches it (edgeLitAt is only stamped once
  // both ends are lit — see BubbleTree's markNewEdgesLit), held near full,
  // then — once its hopIndex's turn comes up — eased back down in the same
  // origin-to-destination sweep the bubbles' pop-rest scale fades in. No
  // edgeLitAt at all (real Lineage Mode) burns at a flat, non-fading 1;
  // landedAt === 0 (still mid-flight) means no sweep has started yet either.
  const IGNITE_MS = 420;
  // Gated by onPath first: only edges actually on the lit route ever burn.
  // Real Lineage Mode (lineagePath set, edgeLitAt null — no flight in
  // progress) burns every on-path edge at a flat, non-fading 1; the flyover
  // supplies edgeLitAt and this ramps/holds/fades per-edge as above.
  const burnIntensity = (aId, bId, key) => {
    if (!onPath(aId, bId)) return 0;
    if (!edgeLitAt) return 1;
    const entry = edgeLitAt.get(key);
    if (entry == null) return 0;
    const ignite = Math.min(1, (nowMs - entry.litAt) / IGNITE_MS);
    if (!landedAt) return ignite;
    const age = nowMs - (landedAt + holdMs + entry.hopIndex * staggerMs);
    const fade = age <= 0 ? 1 : Math.max(0, 1 - age / fadeMs);
    return ignite * fade;
  };
  // A burning edge blends its normal colour toward the warm accent and gets
  // a width/alpha boost — applied to the SAME geometry the edge would draw
  // with anyway (merged trunk, dashed step bond, whatever), never a second
  // line layered on top of it. burn=0 reproduces the old unlit look exactly.
  const litStroke = (normalColor, normalWidth, normalAlpha, burn) => {
    if (burn <= 0) return { color: normalColor, width: normalWidth, alpha: normalAlpha };
    return {
      color: lerpColor(normalColor, ACCENT, burn),
      width: normalWidth * (1 + 0.7 * Math.min(1, burn * 1.6)),
      alpha: normalAlpha + (1 - normalAlpha) * burn,
    };
  };

  // ── Couple membranes (drawn first, furthest back) ─────────────────────────
  // Each union is a closed capsule — fill + a complete border that wraps all
  // the way around each bubble at the ends, not just along the two long edges.
  // Fill colour distinguishes current (warm peach), former (muted greige), and
  // widowed (lavender). Border style distinguishes further: solid accent ring
  // for current/widowed, dashed muted ring for former (dissolved bond).
  const seen = new Set();
  for (const r of graph.relationships) {
    if (r.type !== 'partner') continue;
    if (hidden(r.from_person, r.to_person)) continue;
    const a = pos.get(r.from_person);
    const b = pos.get(r.to_person);
    if (!a || !b) continue;
    const key = [r.from_person, r.to_person].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);

    const alpha = edgeAlpha(r.from_person, r.to_person);
    const status = r.partner_status;
    const hw = baseRadius * 1.1; // half-width = radius of the end caps

    const fillColor   = status === 'widowed' ? '#ece7f2'
                      : status === 'former'  ? '#e8e3de'
                      :                        '#f6e6dc';
    const borderColor = status === 'widowed' ? '#7a6a9e'
                      : status === 'former'  ? '#a89280'
                      :                        '#c2603a';

    const burn = burnIntensity(r.from_person, r.to_person, key + 'partner');
    // Fill — semi-transparent capsule behind the pair. A lit couple's fill
    // warms and deepens a touch too, not just the border.
    const fillAlpha = alpha * 0.52 + burn * 0.18;
    capsulePath(g, a, b, hw).fill({ color: burn > 0 ? lerpColor(hex(fillColor), ACCENT, burn * 0.4) : hex(fillColor), alpha: fillAlpha });

    // Border — wraps fully around each bubble (complete capsule outline).
    const border = litStroke(hex(borderColor), 2.5, alpha * 0.82, burn);
    if (status === 'former') {
      dashedCapsuleBorder(g, a, b, hw, { ...border, cap: 'round' });
    } else {
      capsulePath(g, a, b, hw).stroke({ ...border, cap: 'round' });
    }
  }

  // ── Parent → child links ──────────────────────────────────────────────────
  // Co-parents always merge into a single origin point per couple. Two cases:
  //
  // 1. Current / widowed couple: one line from the bottom of the warm pod.
  // 2. Divorced co-parents: two grey arms converging at a small open-circle
  //    junction, then a normal-coloured line to each child. The V-shape reads
  //    "both parents, past union" — distinct from the warm merged pod while
  //    still clearly marking shared parentage.
  //
  // Both cases add their edges to `merged` so the per-parent pass skips them.
  // Everything else (single parent, mixed bio/step, non-coupled) falls through.
  const merged = new Set();
  // Gather co-parent groups by checking every pair of a child's parents.
  // Requires exactly that the two parents are partners (any status).
  // Using pairs instead of requiring parents.length===2 means a child with
  // 3 parents (e.g. bio-mum + bio-dad + step-parent) still gets the bio
  // co-parent line merged; the step line falls through to the per-edge pass.
  const groups = new Map();        // current / widowed co-parents
  const divorceGroups = new Map(); // former co-parents

  for (const person of graph.people) {
    const childId = person.id;
    if (!isVisible(childId)) continue;
    const parents = graph.parents(childId).filter((p) => isVisible(p.id));
    if (parents.length < 2) continue;

    for (let i = 0; i < parents.length; i++) {
      for (let j = i + 1; j < parents.length; j++) {
        const p1 = parents[i];
        const p2 = parents[j];
        if (p1.qualifier !== p2.qualifier) continue;
        const bond = graph.partners(p1.id).find((x) => x.id === p2.id);
        if (!bond) continue;

        const key = [p1.id, p2.id].sort().join('|') + '|' + p1.qualifier;
        const target = bond.status === 'former' ? divorceGroups : groups;
        if (!target.has(key))
          target.set(key, { p1: p1.id, p2: p2.id, qualifier: p1.qualifier, kids: [] });
        target.get(key).kids.push(childId);
        merged.add(`${p1.id}>${childId}`);
        merged.add(`${p2.id}>${childId}`);
      }
    }
  }

  const drawGroup = (grp) => {
    const a1 = pos.get(grp.p1);
    const a2 = pos.get(grp.p2);
    if (!a1 || !a2) return;
    const biological = grp.qualifier === 'biological';
    const color = hex(biological ? '#8a7d6b' : '#b6a892');
    // A child's branch burns if EITHER co-parent's edge to that specific
    // child is lit — under the flyover's co-parent model both are lit
    // together, but take the max so a stray mismatch never leaves a gap.
    const branchBurn = (childId) => Math.max(
      burnIntensity(grp.p1, childId, [grp.p1, childId].sort().join('|') + 'parent'),
      burnIntensity(grp.p2, childId, [grp.p2, childId].sort().join('|') + 'parent'),
    );
    // Widths along one continuous descent: broadest as the line leaves the
    // couple, narrowest as it meets each child. A sibling trunk passes through
    // JUNCTION_W on the way, so stem and branches read as one gradual taper
    // rather than two differently-weighted lines meeting at a step.
    const seg = (from, to, burn, w0 = JUNCTION_W) =>
      biological
        ? curve(g, from, to, { ...litStroke(color, w0, 0.7, burn), endWidth: CHILD_W })
        : dashedCurve(g, from, to, 14, 0.5, { ...litStroke(color, w0, 0.85, burn), endWidth: CHILD_W });
    const stemSeg = (from, to, burn) =>
      biological
        ? curve(g, from, to, { ...litStroke(color, PARENT_W, 0.7, burn), endWidth: JUNCTION_W })
        : dashedCurve(g, from, to, 14, 0.5, { ...litStroke(color, PARENT_W, 0.85, burn), endWidth: JUNCTION_W });

    // Origin: the bottom of the couple's shaded capsule, on its centre line —
    // never inside the shading (reported directly: "lines do start in the
    // actual shaded zone, this should not happen"). The clearance is derived
    // from the capsule's real geometry rather than assumed horizontal, so a
    // couple caught mid-rearrangement at an angle still emits its line from
    // outside the fill.
    const start = capsuleBottom(a1, a2, baseRadius * 1.1 + 1.5);
    const kidEntries = grp.kids.map((id) => ({ id, p: pos.get(id) })).filter((e) => e.p);
    if (kidEntries.length === 0) return;

    if (kidEntries.length === 1) {
      // No junction to pass through, so this one line carries the whole taper.
      seg(start, kidEntries[0].p, branchBurn(kidEntries[0].id), PARENT_W);
    } else {
      const avgX = kidEntries.reduce((s, e) => s + e.p.x, 0) / kidEntries.length;
      const nearestY = Math.min(...kidEntries.map((e) => e.p.y));
      const junction = { x: start.x * 0.55 + avgX * 0.45, y: start.y + (nearestY - start.y) * 0.72 };
      const burns = kidEntries.map((e) => branchBurn(e.id));
      // The stem carries the strongest branch's fire — it's lit the moment
      // any child down that trunk is on the route, and only fully goes
      // dark once every branch through it has faded.
      stemSeg(start, junction, Math.max(0, ...burns));
      kidEntries.forEach((e, i) => seg(junction, e.p, burns[i]));
    }
  };

  for (const grp of groups.values()) drawGroup(grp);
  for (const grp of divorceGroups.values()) drawGroup(grp);

  for (const r of graph.relationships) {
    if (r.type !== 'parent') continue;
    if (merged.has(`${r.from_person}>${r.to_person}`)) continue;
    if (hidden(r.from_person, r.to_person)) continue;
    const a = pos.get(r.from_person);
    const b = pos.get(r.to_person);
    if (!a || !b) continue;
    const alpha = edgeAlpha(r.from_person, r.to_person);
    const key = [r.from_person, r.to_person].sort().join('|') + 'parent';
    const burn = burnIntensity(r.from_person, r.to_person, key);

    // Step bonds: suppress entirely when implied by a current partnership to a
    // bio/adoptive parent (the pod conveys it). Orphan step bonds stay but ghost
    // back to a whisper unless this person is the active node.
    if (r.qualifier === 'step') {
      if (stepEdgeMediated(graph, r.from_person, r.to_person)) continue;
      const touched = activeId != null && (r.from_person === activeId || r.to_person === activeId);
      dashedCurve(g, a, b, 18, 0.5, {
        ...litStroke(hex('#b6a892'), PARENT_W, alpha * (touched ? 0.85 : 0.16), burn),
        endWidth: CHILD_W,
      });
      continue;
    }

    const biological = r.qualifier === 'biological';
    const color = hex(biological ? '#8a7d6b' : '#b6a892');

    // Same taper as the merged couple lines above — a single parent's line to
    // their child narrows over its whole length.
    if (biological) {
      curve(g, a, b, { ...litStroke(color, PARENT_W, alpha * 0.7, burn), endWidth: CHILD_W });
    } else {
      dashedCurve(g, a, b, 18, 0.5, { ...litStroke(color, PARENT_W, alpha * 0.85, burn), endWidth: CHILD_W });
    }
  }
}

/*
 * Traditional genealogy chart links — same warm couple membranes as the organic
 * view, but parent→child bonds become clean orthogonal bracket connectors:
 *   couple midpoint → vertical stem → horizontal bar → vertical drops to children
 * This gives the familiar pedigree-chart feel while keeping Bloodline's palette.
 */
export function drawLinksChart(g, graph, pos, isVisible, baseRadius, lineagePath = null) {
  g.clear();
  const hidden = (a, b) => !(isVisible(a) && isVisible(b));
  const onPath = lineagePath ? (a, b) => lineagePath.has(a) && lineagePath.has(b) : () => false;
  const edgeAlpha = lineagePath ? (a, b) => (onPath(a, b) ? 1 : 0.12) : () => 1;

  // ── Couple connectors (chart style: clean horizontal bar, no midpoint clutter) ──
  // Chart mode uses a plain horizontal bar between spouses at the couple Y level.
  // The old midpoint node has been removed — the couple bar itself is the connector.
  const seen = new Set();
  // Build a couple-midpoint lookup so parent bracket drops land at the bar centre.
  const coupleMidX = new Map(); // personId → x midpoint of their couple bar
  for (const r of graph.relationships) {
    if (r.type !== 'partner') continue;
    if (hidden(r.from_person, r.to_person)) continue;
    const a = pos.get(r.from_person);
    const b = pos.get(r.to_person);
    if (!a || !b) continue;
    const key = [r.from_person, r.to_person].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);

    const mx = (a.x + b.x) / 2;
    coupleMidX.set(r.from_person, mx);
    coupleMidX.set(r.to_person, mx);

    // Skip cross-row couple connectors — they'd appear as diagonal "random
    // lines". With correct generation computation partners share the same Y;
    // the midpoint above is still stored so bracket drops can reference it.
    if (Math.abs(a.y - b.y) > baseRadius) continue;

    const alpha = edgeAlpha(r.from_person, r.to_person);
    const status = r.partner_status;
    const isWidowed = status === 'widowed';
    const isFormer  = status === 'former';
    const lineColor = hex(isWidowed ? '#7a6a9e' : '#b08060');
    const lineA = alpha * (isFormer ? 0.50 : 0.65);

    if (isFormer) {
      dashedSegment(g, a, b, 12, 0.55, { width: 2, color: lineColor, alpha: lineA, cap: 'round' });
    } else {
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2, color: lineColor, alpha: lineA, cap: 'round' });
    }
  }

  // ── Orthogonal bracket connectors (parent → children) ─────────────────────
  // For each child that is part of a couple, the bracket drop terminates at the
  // couple bar's midpoint rather than the individual node centre. This ensures the
  // stem from the grandparent level aligns symmetrically with the couple bar below.
  const effectiveX = (id) => coupleMidX.get(id) ?? pos.get(id)?.x ?? 0;

  // Group each child with its visible parents so siblings share one bracket.
  // Step bonds implied by a marriage are suppressed (same rule as the organic
  // view) — both as their own bracket and as contributors to the bio bracket's
  // origin, so a mediated step-parent doesn't skew where the bio line hangs.
  const mediatedStep = (pid, cid) => {
    const e = graph.parents(cid).find((p) => p.id === pid);
    return e?.qualifier === 'step' && stepEdgeMediated(graph, pid, cid);
  };
  const families = new Map(); // key → { parents, qualifier, kids }
  for (const r of graph.relationships) {
    if (r.type !== 'parent') continue;
    const parentId = r.from_person;
    const childId = r.to_person;
    if (!isVisible(parentId) || !isVisible(childId)) continue;
    if (mediatedStep(parentId, childId)) continue;

    const childParents = graph.parents(childId)
      .filter((p) => isVisible(p.id) && !mediatedStep(p.id, childId));
    const qual = r.qualifier ?? 'biological';
    const key = childParents.map((p) => p.id).sort().join('|') + ':' + qual;
    if (!families.has(key))
      families.set(key, { parents: childParents.map((p) => p.id), qualifier: qual, kids: new Set() });
    families.get(key).kids.add(childId);
  }

  for (const { parents, qualifier, kids } of families.values()) {
    const parentPositions = parents.map((id) => pos.get(id)).filter(Boolean);
    if (!parentPositions.length) continue;
    const kidIds = [...kids];
    const kidPos = kidIds.map((id) => pos.get(id)).filter(Boolean);
    if (!kidPos.length) continue;

    const biological = qualifier === 'biological';
    const lineColor = hex(biological ? '#8a7d6b' : '#b6a892');
    const lineAlpha = biological ? 0.65 : 0.80;
    const strokeBase = { width: 1.5, color: lineColor, cap: 'round', join: 'round' };
    const seg = (ax, ay, bx, by, alpha = lineAlpha) => {
      if (biological) {
        g.moveTo(ax, ay).lineTo(bx, by).stroke({ ...strokeBase, alpha });
      } else {
        dashedSegment(g, { x: ax, y: ay }, { x: bx, y: by }, 8, 0.45, { ...strokeBase, alpha });
      }
    };
    const stemSeg = (ax, ay, bx, by, alpha = lineAlpha) => {
      if (biological) {
        g.moveTo(ax, ay).lineTo(bx, by).stroke({ ...strokeBase, width: 2.5, alpha });
      } else {
        dashedSegment(g, { x: ax, y: ay }, { x: bx, y: by }, 8, 0.45, { ...strokeBase, width: 2.5, alpha });
      }
    };

    // Origin: midpoint of all parents (couples share the same Y in chart mode).
    const originX = parentPositions.reduce((s, p) => s + p.x, 0) / parentPositions.length;
    const originY = parentPositions.reduce((s, p) => s + p.y, 0) / parentPositions.length;
    const childY = Math.min(...kidPos.map((p) => p.y));
    // Junction at 68 % of the way down — long stem, compact drops.
    const hubY = originY + (childY - originY) * 0.68;

    const alpha = edgeAlpha(parents[0] ?? '', kidIds[0] ?? '');

    // Vertical stem from couple midpoint down to the junction.
    stemSeg(originX, originY + baseRadius * 1.05, originX, hubY, lineAlpha * alpha);

    // Use effective X (couple midpoint when child is in a couple) for the bar and drops.
    const exs = kidIds.map(effectiveX);
    const childYval = kidPos[0].y; // all same generation → same Y

    if (kidIds.length === 1) {
      const ex = exs[0];
      seg(originX, hubY, ex, hubY, lineAlpha * alpha);
      seg(ex, hubY, ex, childYval - baseRadius, lineAlpha * alpha);
    } else {
      const barMinX = Math.min(...exs);
      const barMaxX = Math.max(...exs);
      seg(barMinX, hubY, barMaxX, hubY, lineAlpha * alpha);
      for (const ex of exs) {
        seg(ex, hubY, ex, childYval - baseRadius, lineAlpha * alpha);
      }
    }
  }

  // ── Lineage highlight pass ─────────────────────────────────────────────────
  if (lineagePath) {
    const accentFill = hex('#c2603a');
    const done = new Set();
    for (const r of graph.relationships) {
      if (!onPath(r.from_person, r.to_person)) continue;
      if (hidden(r.from_person, r.to_person)) continue;
      const key = [r.from_person, r.to_person].sort().join('|') + r.type;
      if (done.has(key)) continue;
      done.add(key);
      const a = pos.get(r.from_person);
      const b = pos.get(r.to_person);
      if (!a || !b) continue;
      if (r.type === 'partner') {
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: baseRadius * 2.4, color: accentFill, alpha: 0.22, cap: 'round' });
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 3, color: accentFill, alpha: 0.75, cap: 'round' });
      }
    }
  }
}

/*
 * The point on a capsule's outline directly below its midpoint — where a
 * couple's line to their children should begin.
 *
 * The capsule is every point within hw of the segment a–b, so a vertical ray
 * dropped from the midpoint leaves it either through a long side or, when the
 * capsule is steep enough that the ray never crosses one, around a lower end
 * cap. Both cases are cheap to solve exactly, and taking whichever comes first
 * means the anchor sits on the outline at any angle — including the transient
 * diagonal a couple passes through while the layout is rearranging.
 */
function capsuleBottom(a, b, hw) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const alongX = Math.abs(dx / len); // 1 = horizontal couple, 0 = vertical
  const sideExit = alongX > 1e-3 ? hw / alongX : Infinity;
  const capExit = len / 2 + hw;
  return { x: mx, y: my + Math.min(sideExit, capExit) };
}

// Closed capsule (stadium) path from a to b with half-width hw.
// Traces: one long edge → front arc around b → other long edge → back arc around a.
// Returns g for chaining .fill() or .stroke().
function capsulePath(g, a, b, hw) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ox = (-dy / len) * hw, oy = (dx / len) * hw;
  const theta = Math.atan2(dy, dx);
  const PI = Math.PI;
  return g
    .moveTo(a.x + ox, a.y + oy)
    .lineTo(b.x + ox, b.y + oy)
    .arc(b.x, b.y, hw, theta + PI / 2, theta - PI / 2, true)
    .lineTo(a.x - ox, a.y - oy)
    .arc(a.x, a.y, hw, theta - PI / 2, theta + PI / 2, true)
    .closePath();
}

// Dashed outline around a capsule, tracing the full perimeter continuously.
// Used for former-partner bonds — the broken border signals a dissolved union
// while the filled shape preserves the visual co-parent relationship.
function dashedCapsuleBorder(g, a, b, hw, style) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len, uy = dy / len;
  const ox = -uy * hw, oy = ux * hw;
  const theta = Math.atan2(dy, dx);
  const PI = Math.PI;
  const semiPerim = PI * hw;
  const total = 2 * len + 2 * semiPerim;
  const nDashes = Math.max(8, Math.round(total / 24));
  const dashLen = (total / nDashes) * 0.42;

  // Point on the capsule perimeter at arc-length s (starts at a's "top" side).
  const pt = (s) => {
    s = ((s % total) + total) % total;
    if (s < len) {
      return { x: a.x + ox + ux * s, y: a.y + oy + uy * s };
    }
    s -= len;
    if (s < semiPerim) {
      const angle = theta + PI / 2 - s / hw;
      return { x: b.x + hw * Math.cos(angle), y: b.y + hw * Math.sin(angle) };
    }
    s -= semiPerim;
    if (s < len) {
      return { x: b.x - ox - ux * s, y: b.y - oy - uy * s };
    }
    s -= len;
    const angle = theta - PI / 2 - s / hw;
    return { x: a.x + hw * Math.cos(angle), y: a.y + hw * Math.sin(angle) };
  };

  // Polyline approximation per dash — 4 sub-steps keeps arcs smooth.
  for (let i = 0; i < nDashes; i++) {
    const s0 = (i / nDashes) * total;
    const p0 = pt(s0);
    g.moveTo(p0.x, p0.y);
    for (let j = 1; j <= 4; j++) {
      const p = pt(s0 + (j / 4) * dashLen);
      g.lineTo(p.x, p.y);
    }
  }
  g.stroke(style);
}

// A gentle quadratic curve between two points (a slight sag, like a hanging cord).
//
// Parent→child bonds TAPER: broad where the line leaves the parents, narrowing
// steadily as it reaches the child, so direction of descent is legible at a
// glance without reading the layout (asked for directly: "thicker as it leaves
// the parent relationship and thinner as it enters the child... a gradual
// reduction not a step in size"). style.width is the width at the parent end
// and style.endWidth at the child end; a taper is drawn as ONE filled ribbon
// rather than a stack of progressively-thinner strokes, so a tapered edge
// still costs a single draw call per link the way the plain stroke did.
// Omitting endWidth keeps the old uniform stroke exactly as it was.
const TAPER_STEPS = 12;

function curveControl(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + Math.abs(a.x - b.x) * 0.06 };
}

function curve(g, a, b, style) {
  const c = curveControl(a, b);
  if (style.endWidth == null || style.endWidth === style.width) {
    g.moveTo(a.x, a.y).quadraticCurveTo(c.x, c.y, b.x, b.y).stroke(style);
    return;
  }
  taperedRibbon(g, a, c, b, style.width, style.endWidth, style);
}

// Closed outline of a quadratic curve whose half-width eases from w0 to w1,
// filled in one pass. The perpendicular at each sample comes from the curve's
// exact derivative (B'(t) = 2(1-t)(c-a) + 2t(b-c)) rather than sampling
// neighbouring points, so the sides stay parallel to the curve even where it
// bends hardest — and, since this runs for every parent link every frame, it
// costs one cheap expression per sample instead of two extra curve
// evaluations.
function taperedRibbon(g, a, c, b, w0, w1, style) {
  const left = [];
  const right = [];
  for (let i = 0; i <= TAPER_STEPS; i++) {
    const t = i / TAPER_STEPS;
    const p = quad(a, c, b, t);
    const u = 1 - t;
    const tx = 2 * u * (c.x - a.x) + 2 * t * (b.x - c.x);
    const ty = 2 * u * (c.y - a.y) + 2 * t * (b.y - c.y);
    const len = Math.hypot(tx, ty) || 1;
    const hw = (w0 + (w1 - w0) * t) / 2;
    const nx = (-ty / len) * hw;
    const ny = (tx / len) * hw;
    left.push({ x: p.x + nx, y: p.y + ny });
    right.push({ x: p.x - nx, y: p.y - ny });
  }
  g.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) g.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i--) g.lineTo(right[i].x, right[i].y);
  g.closePath();
  g.fill({ color: style.color, alpha: style.alpha });
}

// Dashed sibling of curve(). Tapers the same way when endWidth is given —
// each dash is stroked at its own width, which is cheap here because a dashed
// edge is already several draw operations and adoptive/step bonds are a small
// minority of the lines on screen.
function dashedCurve(g, a, b, dashes, solidFrac, style) {
  const c = curveControl(a, b);
  const tapered = style.endWidth != null && style.endWidth !== style.width;
  let prev = a;
  for (let i = 1; i <= dashes; i++) {
    const t = i / dashes;
    const pt = quad(a, c, b, t);
    if (i % 2 === 1) {
      g.moveTo(prev.x, prev.y).lineTo(pt.x, pt.y);
      if (tapered) {
        const w = style.width + (style.endWidth - style.width) * (t - 0.5 / dashes);
        g.stroke({ ...style, width: Math.max(0.4, w) });
      }
    }
    prev = pt;
  }
  if (!tapered) g.stroke(style);
}

function dashedSegment(g, a, b, dashes, solidFrac, style) {
  for (let i = 0; i < dashes; i++) {
    const t0 = i / dashes;
    const t1 = (i + solidFrac) / dashes;
    g.moveTo(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0);
    g.lineTo(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1);
  }
  g.stroke(style);
}

function quad(a, c, b, t) {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

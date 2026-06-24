import { hex } from '../lib/color.js';

/*
 * Draws everything *between* the bubbles, every frame, into one Graphics that
 * sits behind them:
 *   - Couples as one visual unit: a soft membrane binding partners. Current
 *     unions read warm and solid; former partners are a faded dashed bond
 *     (still shown — divorce doesn't erase a co-parent); widowed unions carry
 *     the memorial violet.
 *   - Parent links: biological are solid and quiet; adopted / step / foster are
 *     dashed in a distinct tone so non-biological bonds are legible at a glance
 *     without being lesser.
 *
 * Link opacity follows the ego camera: bonds far from the focused person fade
 * back with their bubbles.
 */
export function drawLinks(g, graph, pos, isVisible, baseRadius, mergeParents = false, lineagePath = null) {
  g.clear();
  // Only draw a link when both people are currently revealed.
  const hidden = (a, b) => !(isVisible(a) && isVisible(b));
  // When a lineage path is active, non-path edges dim to 12%; path edges are
  // drawn normally then re-highlighted in a second pass at the end.
  const onPath = lineagePath ? (a, b) => lineagePath.has(a) && lineagePath.has(b) : () => false;
  const edgeAlpha = lineagePath ? (a, b) => (onPath(a, b) ? 1 : 0.12) : () => 1;

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

    // Fill — semi-transparent capsule behind the pair.
    capsulePath(g, a, b, hw).fill({ color: hex(fillColor), alpha: alpha * 0.52 });

    // Border — wraps fully around each bubble (complete capsule outline).
    const bAlpha = alpha * 0.82;
    if (status === 'former') {
      dashedCapsuleBorder(g, a, b, hw, { width: 2.5, color: hex(borderColor), alpha: bAlpha, cap: 'round' });
    } else {
      capsulePath(g, a, b, hw).stroke({ width: 2.5, color: hex(borderColor), alpha: bAlpha, cap: 'round' });
    }
  }

  // ── Parent → child links ──────────────────────────────────────────────────
  // Optionally merge co-parents into a single origin point per couple. Two cases:
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
  if (mergeParents) {
    // ── Case 1: current / widowed couples → single merged line ──────────────
    const groups = new Map();
    for (const person of graph.people) {
      const childId = person.id;
      if (!isVisible(childId)) continue;
      const parents = graph.parents(childId).filter((p) => isVisible(p.id));
      if (parents.length !== 2) continue;
      const [p1, p2] = parents;
      if (p1.qualifier !== p2.qualifier) continue;
      const bond = graph.partners(p1.id).find((x) => x.id === p2.id);
      if (!bond || bond.status === 'former') continue;

      const key = [p1.id, p2.id].sort().join('|') + '|' + p1.qualifier;
      if (!groups.has(key))
        groups.set(key, { p1: p1.id, p2: p2.id, qualifier: p1.qualifier, kids: [] });
      groups.get(key).kids.push(childId);
      merged.add(`${p1.id}>${childId}`);
      merged.add(`${p2.id}>${childId}`);
    }

    for (const grp of groups.values()) {
      const a1 = pos.get(grp.p1);
      const a2 = pos.get(grp.p2);
      if (!a1 || !a2) continue;
      const biological = grp.qualifier === 'biological';
      const color = hex(biological ? '#8a7d6b' : '#b6a892');
      const seg = (from, to) =>
        biological
          ? curve(g, from, to, { width: 2, color, alpha: 0.7 })
          : dashedCurve(g, from, to, 14, 0.5, { width: 2, color, alpha: 0.85 });

      // Origin: the bottom edge of the couple's shaded band, so the line hangs
      // from the pair rather than skewering it.
      const start = { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 + baseRadius * 1.05 };
      const kids = grp.kids.map((id) => pos.get(id)).filter(Boolean);
      if (kids.length === 0) continue;

      // stemSeg — 50% thicker for the main trunk before it branches to siblings
      const stemSeg = (from, to) =>
        biological
          ? curve(g, from, to, { width: 3, color, alpha: 0.7 })
          : dashedCurve(g, from, to, 14, 0.5, { width: 3, color, alpha: 0.85 });

      if (kids.length === 1) {
        seg(start, kids[0]);
      } else {
        // Sibling trunk: a short stem down to a junction, then a branch to each
        // child — so siblings read as a set. The stem is thicker to visually
        // anchor the family group.
        const avgX = kids.reduce((s, k) => s + k.x, 0) / kids.length;
        const nearestY = Math.min(...kids.map((k) => k.y));
        const junction = { x: start.x * 0.55 + avgX * 0.45, y: start.y + (nearestY - start.y) * 0.72 };
        stemSeg(start, junction);
        for (const k of kids) seg(junction, k);
      }
    }

    // ── Case 2: divorced co-parents → V-junction ────────────────────────────
    const divorceGroups = new Map();
    for (const person of graph.people) {
      const childId = person.id;
      if (!isVisible(childId)) continue;
      const parents = graph.parents(childId).filter((p) => isVisible(p.id));
      if (parents.length !== 2) continue;
      const [p1, p2] = parents;
      if (p1.qualifier !== p2.qualifier) continue;
      const bond = graph.partners(p1.id).find((x) => x.id === p2.id);
      if (!bond || bond.status !== 'former') continue;

      const key = [p1.id, p2.id].sort().join('|') + '|' + p1.qualifier;
      if (!divorceGroups.has(key))
        divorceGroups.set(key, { p1: p1.id, p2: p2.id, qualifier: p1.qualifier, kids: [] });
      divorceGroups.get(key).kids.push(childId);
      merged.add(`${p1.id}>${childId}`);
      merged.add(`${p2.id}>${childId}`);
    }

    for (const grp of divorceGroups.values()) {
      const a1 = pos.get(grp.p1);
      const a2 = pos.get(grp.p2);
      if (!a1 || !a2) continue;

      const biological = grp.qualifier === 'biological';
      const color = hex(biological ? '#8a7d6b' : '#b6a892');
      const seg = (from, to) =>
        biological
          ? curve(g, from, to, { width: 2, color, alpha: 0.7 })
          : dashedCurve(g, from, to, 14, 0.5, { width: 2, color, alpha: 0.85 });
      const stemSeg = (from, to) =>
        biological
          ? curve(g, from, to, { width: 3, color, alpha: 0.7 })
          : dashedCurve(g, from, to, 14, 0.5, { width: 3, color, alpha: 0.85 });

      // Origin: same midpoint as a current-couple pair — children "emerge from
      // the bond" regardless of its status. The dashed grey band in the couple
      // membranes pass already signals the former status; no V-arms needed here.
      const start = { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 + baseRadius * 1.05 };
      const kids = grp.kids.map((id) => pos.get(id)).filter(Boolean);
      if (kids.length === 0) continue;

      if (kids.length === 1) {
        seg(start, kids[0]);
      } else {
        const avgX = kids.reduce((s, k) => s + k.x, 0) / kids.length;
        const nearestY = Math.min(...kids.map((k) => k.y));
        const junction = { x: start.x * 0.55 + avgX * 0.45, y: start.y + (nearestY - start.y) * 0.72 };
        stemSeg(start, junction);
        for (const k of kids) seg(junction, k);
      }
    }
  }

  for (const r of graph.relationships) {
    if (r.type !== 'parent') continue;
    if (merged.has(`${r.from_person}>${r.to_person}`)) continue;
    if (hidden(r.from_person, r.to_person)) continue;
    const a = pos.get(r.from_person);
    const b = pos.get(r.to_person);
    if (!a || !b) continue;
    const alpha = edgeAlpha(r.from_person, r.to_person);
    const biological = r.qualifier === 'biological';
    const color = biological ? '#8a7d6b' : '#b6a892';

    if (biological) {
      curve(g, a, b, { width: 2, color: hex(color), alpha: alpha * 0.7 });
    } else {
      dashedCurve(g, a, b, 18, 0.5, { width: 2, color: hex(color), alpha: alpha * 0.85 });
    }
  }

  // ── Lineage highlight pass ─────────────────────────────────────────────────
  // Re-draw the edges that connect adjacent path nodes in the accent colour +
  // thicker, so the selected line leaps forward from the dimmed family.
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
      } else {
        curve(g, a, b, { width: 3, color: accentFill, alpha: 0.8 });
      }
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

  // ── Couple connectors (chart style: clean bar + midpoint node) ───────────
  // Organic mode's warm blob-pod is beautiful but invisible at chart zoom levels.
  // Chart mode uses a thin horizontal bar with a small filled node at the midpoint
  // so the couple relationship reads clearly at any scale.
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
    const isWidowed = status === 'widowed';
    const isFormer  = status === 'former';
    const lineColor = hex(isWidowed ? '#7a6a9e' : '#b08060');
    const nodeColor = hex(isWidowed ? '#ece7f2' : '#f6e6dc');
    const nodeBorder = hex(isWidowed ? '#7a6a9e' : '#8a5e3c');
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const lineA = alpha * (isFormer ? 0.45 : 0.55);
    const nodeR = baseRadius * 0.28;

    if (isFormer) {
      dashedSegment(g, a, b, 14, 0.55, { width: 1.8, color: lineColor, alpha: lineA, cap: 'round' });
    } else {
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1.8, color: lineColor, alpha: lineA, cap: 'round' });
    }
    // Midpoint node — signals "this is a couple unit, not just a line".
    g.circle(mx, my, nodeR).fill({ color: nodeColor, alpha: alpha * 0.92 });
    g.circle(mx, my, nodeR).stroke({ width: 1.5, color: nodeBorder, alpha: alpha * 0.85 });
  }

  // ── Orthogonal bracket connectors (parent → children) ─────────────────────
  // Group each child with ALL of its visible parents so siblings share one bracket.
  const families = new Map(); // 'parentId1|parentId2:qualifier' → { parents, qualifier, kids }
  for (const r of graph.relationships) {
    if (r.type !== 'parent') continue;
    const parentId = r.from_person;
    const childId = r.to_person;
    if (!isVisible(parentId) || !isVisible(childId)) continue;

    const childParents = graph.parents(childId).filter((p) => isVisible(p.id));
    const qual = r.qualifier ?? 'biological';
    const key = childParents.map((p) => p.id).sort().join('|') + ':' + qual;
    if (!families.has(key))
      families.set(key, { parents: childParents.map((p) => p.id), qualifier: qual, kids: new Set() });
    families.get(key).kids.add(childId);
  }

  for (const { parents, qualifier, kids } of families.values()) {
    const parentPositions = parents.map((id) => pos.get(id)).filter(Boolean);
    if (!parentPositions.length) continue;
    const kidPositions = [...kids].map((id) => pos.get(id)).filter(Boolean);
    if (!kidPositions.length) continue;

    const biological = qualifier === 'biological';
    const lineColor = hex(biological ? '#8a7d6b' : '#b6a892');
    const lineAlpha = biological ? 0.72 : 0.88;
    const strokeBase = { width: 2, color: lineColor, cap: 'round', join: 'round' };
    const seg = (ax, ay, bx, by, alpha = lineAlpha) => {
      if (biological) {
        g.moveTo(ax, ay).lineTo(bx, by).stroke({ ...strokeBase, alpha });
      } else {
        dashedSegment(g, { x: ax, y: ay }, { x: bx, y: by }, 10, 0.5, { ...strokeBase, alpha, width: 2 });
      }
    };
    // stemSeg — 50% thicker for the vertical trunk before it fans out to siblings
    const stemSeg = (ax, ay, bx, by, alpha = lineAlpha) => {
      if (biological) {
        g.moveTo(ax, ay).lineTo(bx, by).stroke({ ...strokeBase, width: 3, alpha });
      } else {
        dashedSegment(g, { x: ax, y: ay }, { x: bx, y: by }, 10, 0.5, { ...strokeBase, width: 3, alpha });
      }
    };

    // Origin: midpoint of all parents (couples are same Y in chart mode).
    const originX = parentPositions.reduce((s, p) => s + p.x, 0) / parentPositions.length;
    const originY = parentPositions.reduce((s, p) => s + p.y, 0) / parentPositions.length;
    const childY = Math.min(...kidPositions.map((p) => p.y));
    // Junction: 45% of the way from parent row to child row.
    const hubY = originY + (childY - originY) * 0.45;

    // Lineage alpha for this family group.
    const alpha = edgeAlpha(parents[0] ?? '', kids.values().next().value ?? '');

    // Vertical stem from couple midpoint down to the junction — thicker to anchor the family.
    stemSeg(originX, originY + baseRadius * 1.05, originX, hubY, lineAlpha * alpha);

    if (kidPositions.length === 1) {
      // Single child: L-shaped elbow — horizontal to child x, then drop.
      const c = kidPositions[0];
      seg(originX, hubY, c.x, hubY, lineAlpha * alpha);
      seg(c.x, hubY, c.x, c.y - baseRadius, lineAlpha * alpha);
    } else {
      // Multiple siblings: horizontal bar spanning leftmost→rightmost, then drops.
      const xs = kidPositions.map((p) => p.x);
      const barMinX = Math.min(...xs);
      const barMaxX = Math.max(...xs);
      seg(barMinX, hubY, barMaxX, hubY, lineAlpha * alpha);
      for (const c of kidPositions) {
        seg(c.x, hubY, c.x, c.y - baseRadius, lineAlpha * alpha);
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
function curve(g, a, b, style) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 + Math.abs(a.x - b.x) * 0.06;
  g.moveTo(a.x, a.y).quadraticCurveTo(mx, my, b.x, b.y).stroke(style);
}

function dashedCurve(g, a, b, dashes, solidFrac, style) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 + Math.abs(a.x - b.x) * 0.06;
  let prev = a;
  for (let i = 1; i <= dashes; i++) {
    const t = i / dashes;
    const pt = quad(a, { x: mx, y: my }, b, t);
    if (i % 2 === 1) g.moveTo(prev.x, prev.y).lineTo(pt.x, pt.y);
    prev = pt;
  }
  g.stroke(style);
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

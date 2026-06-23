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
    const width = baseRadius * 2.2;

    if (status === 'former') {
      // Dashed grey band — clearly past, but still a real co-parent bond.
      // Slightly wider than the bubble stroke so it reads as a structural line.
      dashedSegment(g, a, b, 14, 0.52, {
        width: 3,
        color: hex('#a8acb4'),
        alpha: alpha * 0.72,
        cap: 'round',
      });
    } else {
      // A single, light pod binding the pair — a soft hint, not a bold blob.
      const fill = status === 'widowed' ? '#ece7f2' : '#f6e6dc';
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({
        width,
        color: hex(fill),
        alpha: alpha * 0.5,
        cap: 'round',
      });
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

      if (kids.length === 1) {
        seg(start, kids[0]);
      } else {
        // Sibling trunk: a short stem down to a junction, then a branch to each
        // child — so siblings read as a set.
        const avgX = kids.reduce((s, k) => s + k.x, 0) / kids.length;
        const nearestY = Math.min(...kids.map((k) => k.y));
        const junction = { x: start.x * 0.55 + avgX * 0.45, y: start.y + (nearestY - start.y) * 0.72 };
        seg(start, junction);
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
        seg(start, junction);
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

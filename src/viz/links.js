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
export function drawLinks(g, graph, pos, isVisible, baseRadius, mergeParents = false) {
  g.clear();
  // Only draw a link when both people are currently revealed.
  const hidden = (a, b) => !(isVisible(a) && isVisible(b));
  const edgeAlpha = () => 1;

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
      // A faded, dashed bond — present but clearly past.
      dashedSegment(g, a, b, 16, 0.5, {
        width: 2.5,
        color: hex('#c4c7cd'),
        alpha: alpha * 0.8,
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
  // Optionally merge two co-parents into a single line from the couple. We only
  // do this where it reads cleanly: exactly two visible parents, the same
  // qualifier (so bio/step never gets flattened), and they're an actual current
  // or widowed couple (divorced co-parents have drifted apart, so they keep
  // their own lines). Everything else falls through to the per-parent pass.
  const merged = new Set();
  if (mergeParents) {
    for (const person of graph.people) {
      const childId = person.id;
      if (!isVisible(childId)) continue;
      const parents = graph.parents(childId).filter((p) => isVisible(p.id));
      if (parents.length !== 2) continue;
      const [p1, p2] = parents;
      if (p1.qualifier !== p2.qualifier) continue;
      const bond = graph.partners(p1.id).find((x) => x.id === p2.id);
      if (!bond || bond.status === 'former') continue;

      const a1 = pos.get(p1.id);
      const a2 = pos.get(p2.id);
      const c = pos.get(childId);
      if (!a1 || !a2 || !c) continue;

      const mid = { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 };
      const biological = p1.qualifier === 'biological';
      const color = biological ? '#8a7d6b' : '#b6a892';
      if (biological) {
        curve(g, mid, c, { width: 2, color: hex(color), alpha: 0.7 });
      } else {
        dashedCurve(g, mid, c, 18, 0.5, { width: 2, color: hex(color), alpha: 0.85 });
      }
      merged.add(`${p1.id}>${childId}`);
      merged.add(`${p2.id}>${childId}`);
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

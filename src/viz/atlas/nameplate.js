/*
 * The lens's own name label.
 *
 * Canopy's own node carries a plain, stacked, Georgia-serif label — right
 * for a diagram, but the family gathered into the lens is meant to read as
 * a group of PEOPLE, and a real user comparison (a screenshot of a tight
 * parent/step-parent row, three full names printing on top of each other)
 * pointed at the organic tree's own compact pill instead: a bold first name
 * and a lighter surname on one line, in a small rounded card. Ported here
 * deliberately rather than imported from bubble.js — this is an Atlas-only
 * visual choice, and importing would risk a future organic-tree edit
 * silently changing how the lens looks, or vice versa.
 *
 * Two independent pieces:
 *   - buildNamePill(person)   — the actual Pixi visual (impure: makes a
 *     Container). Called once per lens member when the lens is built.
 *   - packRow / layoutLabels  — pure geometry, numbers in, numbers out, so
 *     the packing itself can be asserted without a renderer. A lens's
 *     positions are fixed for the life of the composition (nobody in it
 *     moves), so this collision pass runs once at build time rather than
 *     every frame the way the map's own screen-space label layer must.
 */

import { Container, Graphics, Text } from 'pixi.js';

const TREE_FONT = 'Hanken Grotesk, system-ui, sans-serif';
const GAP = 5;
const PILL_H = 20;
const ROW_MARGIN = 4; // clear air between two adjacent pills, not edge-to-edge

// Same "last token of display_name, else family_name" convention as
// bubble.js's own surnameOf — reads the name someone actually keeps
// current, not a possibly-stale family_name. Duplicated rather than
// imported for the same isolation reason as the file header above.
function surnameOf(person) {
  const parts = (person?.display_name || '').trim().split(/\s+/);
  if (parts.length > 1) return parts[parts.length - 1];
  return (person?.family_name || '').trim();
}

/** The actual pill: a rounded white card, a bold dark first name, and — when
 *  it says something the first name doesn't — a lighter, smaller surname
 *  beside it. Returns the Pixi Container plus the half-width the collision
 *  pass needs, measured from the real, just-built Text objects rather than
 *  an estimate: this runs once per lens member, not once per frame, so
 *  exact metrics cost nothing here the way they would in a hot loop. */
export function buildNamePill(person) {
  const firstName = (person?.display_name || 'Unknown').trim().split(/\s+/)[0] || 'Unknown';
  const lastName = surnameOf(person);
  const showLast = !!lastName && lastName !== firstName;

  const firstText = new Text({
    text: firstName,
    style: { fontFamily: TREE_FONT, fontSize: 13, fontWeight: '700', fill: '#241f1c', letterSpacing: 0.3 },
  });
  firstText.resolution = 2.5;
  firstText.anchor.set(0, 0.5);

  let lastText = null;
  let contentW = firstText.width;
  if (showLast) {
    lastText = new Text({
      text: lastName,
      style: { fontFamily: TREE_FONT, fontSize: 11, fontWeight: '500', fill: '#a4988b', letterSpacing: 0.2 },
    });
    lastText.resolution = 2.5;
    lastText.anchor.set(0, 0.5);
    contentW += GAP + lastText.width;
  }

  const pillW = Math.max(40, contentW + 20);
  const r = PILL_H / 2;

  const bg = new Graphics();
  bg.roundRect(-pillW / 2 + 0.5, -PILL_H / 2 + 2, pillW, PILL_H, r).fill({ color: 0x000000, alpha: 0.07 });
  bg.roundRect(-pillW / 2, -PILL_H / 2, pillW, PILL_H, r).fill({ color: 0xffffff, alpha: 0.97 });
  bg.roundRect(-pillW / 2, -PILL_H / 2, pillW, PILL_H, r).stroke({ width: 0.8, color: 0xddd8d2, alpha: 0.8 });

  const startX = -contentW / 2;
  firstText.position.set(startX, 0);

  const container = new Container();
  container.eventMode = 'none'; // a label is decoration, not a second hit target for the person beneath it
  container.addChild(bg, firstText);
  if (lastText) { lastText.position.set(startX + firstText.width + GAP, 0); container.addChild(lastText); }

  return { container, halfWidth: pillW / 2 };
}

/** One row of labels, packed left to right with no overlap, then re-centred
 *  on the mean of what every label actually wanted — the identical
 *  separate-then-recentre shape portrait.js already uses for a child block
 *  that outgrows its own row, applied here to pill width instead of a
 *  child's KID_GAP slot. Input/output are both `{ id, x, halfWidth }`
 *  triples (x is the WANTED centre); only x changes. */
export function packRow(items) {
  if (items.length < 2) return items.map((it) => ({ id: it.id, x: it.x }));
  const sorted = [...items].sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : 1));
  let prevRight = -Infinity;
  let drift = 0;
  const placed = sorted.map((it) => {
    const wantLeft = it.x - it.halfWidth;
    const left = Math.max(wantLeft, prevRight);
    const x = left + it.halfWidth;
    prevRight = left + it.halfWidth * 2 + ROW_MARGIN;
    drift += it.x - x;
    return { id: it.id, x };
  });
  const recentre = drift / placed.length;
  return placed.map((p) => ({ id: p.id, x: p.x + recentre }));
}

/** The whole lens's labels at once. Only people whose labels plausibly
 *  compete for the same horizontal space can collide, so items are grouped
 *  by y first — generations sit GEN world-units apart (hundreds of units),
 *  utterly unlike a pill's own ~20-unit height, so rounding y is a safe,
 *  cheap way to find "the same row" without a person-by-person distance
 *  check. A wrapped second row of siblings or partners already sits a full
 *  ROW_STACK below the first (see portrait.js) — comfortably its own
 *  bucket, not a false collision with row 0. */
export function layoutLabels(items) {
  const byRow = new Map();
  for (const it of items) {
    const key = Math.round(it.y / 20);
    if (!byRow.has(key)) byRow.set(key, []);
    byRow.get(key).push(it);
  }
  const out = new Map();
  for (const row of byRow.values()) {
    for (const p of packRow(row)) out.set(p.id, { x: p.x, y: row.find((r) => r.id === p.id).y });
  }
  return out;
}

/*
 * The lens's own name label — the PURE half.
 *
 * Split out of nameplate.js so this geometry can be asserted directly in
 * plain Node with no renderer anywhere in the module graph. nameplate.js's
 * own buildNamePill() needs pixi.js (a Container/Graphics/Text), and pixi's
 * browser-environment detection touches the global `navigator` object the
 * instant that module is imported — present in a real browser, and in this
 * sandbox's newer Node, but NOT in the plain Node 20 this repo's own CI
 * pins (.nvmrc) and tests/*.test.mjs run under, where it throws at import
 * time before a single test body even runs. Nothing here — surnameOf,
 * lifespanOf, packRow, layoutLabels — ever needs a renderer, so keeping
 * them in a pixi-free module means importing this file, on its own, can
 * never trip that crash, regardless of which Node version runs the test.
 */

const ROW_MARGIN = 4; // clear air between two adjacent pills, not edge-to-edge

// Same "last token of display_name, else family_name" convention as
// bubble.js's own surnameOf — reads the name someone actually keeps
// current, not a possibly-stale family_name. Duplicated rather than
// imported for the same isolation reason nameplate.js's own header
// describes for the rest of this file.
export function surnameOf(person) {
  const parts = (person?.display_name || '').trim().split(/\s+/);
  if (parts.length > 1) return parts[parts.length - 1];
  return (person?.family_name || '').trim();
}

/** A person's dates, in the app's own wording: a span for someone who has
 *  died, "b. YYYY" for someone living, nothing at all when there is no date
 *  to show. Matches Canopy's own lifespan() so the same person reads the
 *  same way wherever you meet them. */
export function lifespanOf(person) {
  const b = (person?.birth_date || '').slice(0, 4);
  const d = (person?.death_date || '').slice(0, 4);
  if (person?.is_deceased) return b || d ? `${b || '?'}–${d || '?'}` : 'In memory';
  return b ? `b. ${b}` : '';
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

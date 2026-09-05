const ROW_MARGIN = 4;

/** One row of labels, packed left to right with no overlap, then re-centred
 *  on the mean of what every label actually wanted. Input/output are both
 *  `{ id, x, halfWidth }` triples; only x changes. */
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

/** Pack labels independently per visual row. Generations and wrapped rows
 *  are far enough apart that a 20-unit y bucket identifies peers without a
 *  person-by-person distance check. */
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

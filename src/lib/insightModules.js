import { computeGenerations } from '../data/graph.js';

/*
 * Tree Insights — layer 2: the visual modules (Wave 1).
 *
 * computeInsightModules(graph, viewerId) returns one entry per module, each
 * either a data object ready to render or null. Null means the tree hasn't
 * cleared that module's data threshold yet — a module never guesses, never
 * extrapolates, and never renders half-empty. All of it is computed on-device
 * in one pass over the people array, exactly like computeInsights.
 *
 * Everything here consumes only birth/death dates, names, birth places, and
 * the relationship graph — fields the tree already has.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const year = (d) => {
  if (!d) return null;
  const m = String(d).match(/\d{4}/);
  return m ? parseInt(m[0], 10) : null;
};
// birth_date is 'YYYY[-MM[-DD]]' — month/day only when actually recorded.
const monthOf = (d) => {
  const m = d ? String(d).split('-')[1] : null;
  const n = m ? parseInt(m, 10) : NaN;
  return n >= 1 && n <= 12 ? n : null;
};
const dayOf = (d) => {
  const p = d ? String(d).split('-')[2] : null;
  const n = p ? parseInt(p, 10) : NaN;
  return n >= 1 && n <= 31 ? n : null;
};
const firstNameOf = (p) => (p?.display_name || '').trim().split(/\s+/)[0] || '';
const isBioAdopt = (q) => !q || q === 'biological' || q === 'adoptive';

export function computeInsightModules(graph, viewerId) {
  const gen = computeGenerations(graph);
  return {
    giftOfYears: giftOfYears(graph),
    fullestYear: fullestYear(graph),
    strata: strata(graph, viewerId, gen),
    brood: brood(graph),
    names: names(graph, gen),
    heartlands: heartlands(graph, gen),
    birthdays: birthdays(graph, gen),
  };
}

/* ── The gift of years: average lifespan per birth-decade cohort ─────────── */
function giftOfYears(graph) {
  const cohorts = new Map(); // decade -> [spans]
  for (const p of graph.people) {
    if (!p.is_deceased) continue;
    const b = year(p.birth_date), d = year(p.death_date);
    if (b == null || d == null) continue;
    const span = d - b;
    if (span <= 0 || span >= 120) continue;
    const dec = Math.floor(b / 10) * 10;
    if (!cohorts.has(dec)) cohorts.set(dec, []);
    cohorts.get(dec).push(span);
  }
  const rows = [...cohorts.entries()]
    .filter(([, spans]) => spans.length >= 4)
    .map(([decade, spans]) => ({
      decade,
      avg: Math.round(spans.reduce((s, x) => s + x, 0) / spans.length),
      n: spans.length,
    }))
    .sort((a, b) => a.decade - b.decade);
  if (rows.length < 3) return null;
  const first = rows[0], last = rows[rows.length - 1];
  return { cohorts: rows, first, last, gained: last.avg - first.avg };
}

/* ── The fullest year: living relatives per year since the tree began ────── */
function fullestYear(graph) {
  const thisYear = new Date().getFullYear();
  // Only people whose aliveness is decidable for any given year: a birth year,
  // and (if deceased) a death year. A deceased relative with no death date
  // would otherwise read as alive forever.
  const spans = [];
  for (const p of graph.people) {
    const b = year(p.birth_date);
    if (b == null || b > thisYear) continue;
    if (p.is_deceased) {
      const d = year(p.death_date);
      if (d == null || d < b) continue;
      spans.push([b, d]);
    } else {
      spans.push([b, thisYear]);
    }
  }
  if (spans.length < 15) return null;
  const minYear = Math.min(...spans.map(([b]) => b));
  if (thisYear - minYear < 40) return null;
  const step = Math.max(1, Math.ceil((thisYear - minYear) / 110));
  const series = [];
  let peak = { year: minYear, count: 0 };
  for (let y = minYear; y <= thisYear; y += step) {
    const count = spans.reduce((n, [b, d]) => n + (b <= y && y <= d ? 1 : 0), 0);
    series.push({ year: y, count });
    if (count >= peak.count) peak = { year: y, count };
  }
  // Always land the series exactly on the current year so "today" is a point.
  if (series[series.length - 1].year !== thisYear) {
    const count = spans.reduce((n, [b, d]) => n + (b <= thisYear && thisYear <= d ? 1 : 0), 0);
    series.push({ year: thisYear, count });
    if (count >= peak.count) peak = { year: thisYear, count };
  }
  return {
    series,
    peak,
    isNow: peak.year >= thisYear - step,
    firstYear: minYear,
    firstCount: series[0].count,
    thisYear,
  };
}

/* ── Generation strata: everyone, stacked oldest-first ───────────────────── */
function strata(graph, viewerId, gen) {
  if (graph.people.length < 12) return null;
  const byGen = new Map();
  for (const p of graph.people) {
    const g = gen.get(p.id) ?? 0;
    if (!byGen.has(g)) byGen.set(g, { total: 0, living: 0, remembered: 0 });
    const row = byGen.get(g);
    row.total++;
    if (p.is_deceased) row.remembered++;
    else row.living++;
  }
  if (byGen.size < 3) return null;
  const rows = [...byGen.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([g, r], i) => ({ gen: g, label: `G${i + 1}`, ...r }));
  let widest = rows[0];
  for (const r of rows) if (r.total > widest.total) widest = r;
  const viewerGen = viewerId != null && gen.has(viewerId) ? gen.get(viewerId) : null;
  const viewerRow = rows.find((r) => r.gen === viewerGen) || null;
  return {
    rows,
    widest,
    viewerLabel: viewerRow ? viewerRow.label : null,
    viewerIsWidest: !!viewerRow && viewerRow.total === widest.total,
    living: graph.people.filter((p) => !p.is_deceased).length,
    remembered: graph.people.filter((p) => p.is_deceased).length,
  };
}

/* ── Households full of children: the record brood + family size over time ── */
function brood(graph) {
  // Group children by their set of bio/adoptive parents, so each household
  // (co-parent pair, or a single recorded parent) is counted once.
  const households = new Map(); // key -> { parentIds, kids: [] }
  for (const p of graph.people) {
    const parents = graph.parents(p.id).filter((x) => isBioAdopt(x.qualifier));
    if (!parents.length) continue;
    const ids = parents.map((x) => x.id).sort();
    const key = ids.join('|');
    if (!households.has(key)) households.set(key, { parentIds: ids, kids: [] });
    households.get(key).kids.push(p);
  }

  // Record holder: the fullest household with at least two recorded parents.
  let record = null;
  for (const h of households.values()) {
    if (h.parentIds.length < 2) continue;
    if (!record || h.kids.length > record.kids.length) record = h;
  }
  let recordOut = null;
  if (record && record.kids.length >= 5) {
    const parents = record.parentIds.map((id) => graph.byId.get(id)).filter(Boolean);
    const kidYears = record.kids.map((k) => year(k.birth_date)).filter((y) => y != null);
    recordOut = {
      parentIds: record.parentIds,
      parentNames: parents.map((p) => firstNameOf(p)),
      count: record.kids.length,
      span: kidYears.length >= 2 ? `${Math.min(...kidYears)}–${Math.max(...kidYears)}` : null,
    };
  }

  // Trend: average children per household, bucketed by the household's first
  // child's birth decade. Decades first; if too sparse, retry at 30 years.
  const bucketize = (width) => {
    const buckets = new Map();
    for (const h of households.values()) {
      const years = h.kids.map((k) => year(k.birth_date)).filter((y) => y != null);
      if (!years.length) continue;
      const start = Math.floor(Math.min(...years) / width) * width;
      if (!buckets.has(start)) buckets.set(start, []);
      buckets.get(start).push(h.kids.length);
    }
    return [...buckets.entries()]
      .filter(([, counts]) => counts.length >= 3)
      .map(([start, counts]) => ({
        start,
        label: width === 10 ? `${start}s` : `${start}–${start + width - 1}`,
        avg: Math.round((counts.reduce((s, x) => s + x, 0) / counts.length) * 10) / 10,
        n: counts.length,
      }))
      .sort((a, b) => a.start - b.start);
  };
  let trend = bucketize(10);
  if (trend.length < 3) trend = bucketize(30);
  if (trend.length < 2) trend = null;

  if (!recordOut && !trend) return null;
  return { record: recordOut, trend };
}

/* ── The name hall of fame + the thread of the most-passed-down name ─────── */
function names(graph, gen) {
  const freq = new Map(); // name -> { count, people: [] }
  for (const p of graph.people) {
    const n = firstNameOf(p);
    if (!n || n.length < 2) continue;
    if (!freq.has(n)) freq.set(n, { count: 0, people: [] });
    const e = freq.get(n);
    e.count++;
    e.people.push(p);
  }
  const top = [...freq.entries()]
    .filter(([, e]) => e.count >= 3)
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([name, e]) => ({ name, count: e.count }));
  if (top.length < 2) return null;

  // The thread: which generations the #1 name has appeared in.
  const maxGen = Math.max(...[...gen.values()], 0);
  const lead = freq.get(top[0].name);
  const gensWith = new Set(lead.people.map((p) => gen.get(p.id) ?? 0));
  const thread = Array.from({ length: maxGen + 1 }, (_, g) => gensWith.has(g));
  const years = lead.people.map((p) => year(p.birth_date)).filter((y) => y != null);
  return {
    top,
    thread: {
      name: top[0].name,
      generations: thread,
      present: gensWith.size,
      first: years.length ? Math.min(...years) : null,
      last: years.length ? Math.max(...years) : null,
    },
  };
}

/* ── Heartlands: where the family was born, and the migration breadcrumb ─── */
function heartlands(graph, gen) {
  const places = new Map(); // normalized key -> { display, count }
  const placeOf = (p) => {
    const raw = (p.birth_place || '').trim();
    if (!raw) return null;
    const display = raw.split(',')[0].trim();
    return display ? { key: display.toLowerCase(), display } : null;
  };
  let placed = 0;
  for (const p of graph.people) {
    const pl = placeOf(p);
    if (!pl) continue;
    placed++;
    if (!places.has(pl.key)) places.set(pl.key, { display: pl.display, count: 0 });
    places.get(pl.key).count++;
  }
  const ranked = [...places.values()]
    .filter((e) => e.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  if (placed < 8 || ranked.length < 2) return null;

  // Migration: each generation's most common birthplace, consecutive
  // duplicates collapsed. The era shown is that generation's earliest birth.
  const byGen = new Map(); // gen -> Map(placeKey -> {display, count, minYear})
  for (const p of graph.people) {
    const pl = placeOf(p);
    if (!pl) continue;
    const g = gen.get(p.id) ?? 0;
    if (!byGen.has(g)) byGen.set(g, new Map());
    const m = byGen.get(g);
    if (!m.has(pl.key)) m.set(pl.key, { display: pl.display, count: 0, minYear: Infinity });
    const e = m.get(pl.key);
    e.count++;
    const y = year(p.birth_date);
    if (y != null && y < e.minYear) e.minYear = y;
  }
  const steps = [];
  for (const g of [...byGen.keys()].sort((a, b) => a - b)) {
    let best = null;
    for (const e of byGen.get(g).values()) {
      if (e.count < 2) continue;
      if (!best || e.count > best.count) best = e;
    }
    if (!best) continue;
    if (steps.length && steps[steps.length - 1].display === best.display) continue;
    steps.push({
      display: best.display,
      era: best.minYear === Infinity ? null
        : steps.length === 0 ? String(best.minYear) : `${Math.floor(best.minYear / 10) * 10}s`,
    });
  }
  return { places: ranked, migration: steps.length >= 2 ? steps : null };
}

/* ── The birthday wheel + birthday twins ─────────────────────────────────── */
function birthdays(graph, gen) {
  const months = Array(12).fill(0);
  const byExactDay = new Map(); // 'MM-DD' -> [person]
  let withMonth = 0;
  for (const p of graph.people) {
    const m = monthOf(p.birth_date);
    if (m == null) continue;
    withMonth++;
    months[m - 1]++;
    const d = dayOf(p.birth_date);
    if (d != null) {
      const key = `${m}-${d}`;
      if (!byExactDay.has(key)) byExactDay.set(key, []);
      byExactDay.get(key).push(p);
    }
  }
  if (withMonth < 15) return null;
  let peakMonth = 0;
  for (let i = 1; i < 12; i++) if (months[i] > months[peakMonth]) peakMonth = i;
  if (months[peakMonth] < 4) return null;

  // Birthday twins: same month + day, born in different years — the wow is a
  // shared day discovered across the family, not literal same-day twins.
  // Prefer pairs whose generations differ (a date echoing down the line).
  const twins = [];
  for (const people of byExactDay.values()) {
    if (people.length < 2) continue;
    for (let i = 0; i < people.length - 1 && twins.length < 4; i++) {
      for (let j = i + 1; j < people.length; j++) {
        const a = people[i], b = people[j];
        if (year(a.birth_date) === year(b.birth_date)) continue;
        const m = monthOf(a.birth_date), d = dayOf(a.birth_date);
        twins.push({
          aId: a.id, aName: a.display_name,
          bId: b.id, bName: b.display_name,
          dateLabel: `${d} ${MONTHS[m - 1]}`,
          crossGen: (gen.get(a.id) ?? 0) !== (gen.get(b.id) ?? 0),
        });
        break;
      }
    }
  }
  twins.sort((a, b) => Number(b.crossGen) - Number(a.crossGen));
  return {
    months,
    peakMonth,
    peakCount: months[peakMonth],
    peakLabel: MONTHS[peakMonth],
    twins: twins.slice(0, 2),
    withMonth,
  };
}

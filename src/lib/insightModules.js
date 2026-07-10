import { computeGenerations } from '../data/graph.js';
import { detectRegion, nearestWorldEvent } from './worldEvents.js';

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
// Many imported trees (and this app's own "I don't know the exact date"
// entry) fall back to January 1st when only the birth YEAR is actually
// known. Treated as a real date, it manufactures a fake "January is
// birthday season" spike and false birthday-twin matches out of nothing but
// shared ignorance. Insights that read a birth_date's month/day go through
// these instead of the raw monthOf/dayOf so that specific placeholder never
// counts as a real birthday — the year is still trusted everywhere else.
const birthMonthOf = (d) => {
  const m = monthOf(d);
  return m === 1 && dayOf(d) === 1 ? null : m;
};
const birthDayOf = (d) => {
  const m = monthOf(d), day = dayOf(d);
  return m === 1 && day === 1 ? null : day;
};
const firstNameOf = (p) => (p?.display_name || '').trim().split(/\s+/)[0] || '';
const surnameOf = (p) => {
  const parts = (p?.display_name || '').trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : '';
};
// All of a person's given names — first AND middle — for the names module.
// The last token is the surname (when there's more than one token), and
// parenthesised/quoted tokens are nicknames ("Kaitlin (Katie) Davies"), not
// given names. Returns [{ name, middle }] so a John-by-middle-name can be
// labelled as such in the drill-down without being counted any differently.
const givenNamesOf = (p) => {
  const tokens = (p?.display_name || '').trim().split(/\s+/)
    .filter((t) => !/^[("'“‘]/.test(t));
  const given = tokens.length > 1 ? tokens.slice(0, -1) : tokens;
  return given
    .filter((t) => t.length >= 2)
    .map((name, i) => ({ name, middle: i > 0 }));
};
const isBioAdopt = (q) => !q || q === 'biological' || q === 'adoptive';

export function computeInsightModules(graph, viewerId) {
  const gen = computeGenerations(graph);
  return {
    handshakes: handshakes(graph, viewerId),
    giftOfYears: giftOfYears(graph),
    fullestYear: fullestYear(graph),
    strata: strata(graph, viewerId, gen),
    brood: brood(graph),
    bridges: bridges(graph),
    names: names(graph, gen),
    heartlands: heartlands(graph, gen),
    trades: trades(graph),
    birthdays: birthdays(graph, gen),
    records: records(graph),
  };
}

// A person's decidable alive-window [birthYear, deathYear|thisYear], or null.
// A deceased relative with no death date has no decidable window — the
// overlap chain never guesses whether two lives actually crossed.
function windowOf(p, thisYear) {
  const b = year(p?.birth_date);
  if (b == null || b > thisYear) return null;
  if (p.is_deceased) {
    const d = year(p.death_date);
    if (d == null || d < b) return null;
    return [b, d];
  }
  return [b, thisYear];
}

/* ── Handshakes: the shortest chain of overlapping lives to the earliest-
      born ancestor. Each consecutive pair was genuinely alive at the same
      time — "someone you hugged once hugged someone born in 1809". ──────── */
function handshakes(graph, viewerId) {
  const thisYear = new Date().getFullYear();
  const viewer = graph.byId.get(viewerId);
  const vWin = windowOf(viewer, thisYear);
  if (!vWin) return null;

  // Every ancestor of the viewer (any parent qualifier) with a decidable window.
  const winById = new Map([[viewerId, vWin]]);
  const stack = [viewerId];
  const seen = new Set([viewerId]);
  while (stack.length) {
    const id = stack.pop();
    for (const par of graph.parents(id)) {
      if (seen.has(par.id)) continue;
      seen.add(par.id);
      stack.push(par.id);
      const w = windowOf(graph.byId.get(par.id), thisYear);
      if (w) winById.set(par.id, w);
    }
  }
  if (winById.size < 2) return null;

  // BFS across the overlap graph: an edge wherever two lives shared ≥ 1 year.
  const overlap = (a, b) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
  const prev = new Map([[viewerId, null]]);
  let frontier = [viewerId];
  while (frontier.length) {
    const next = [];
    for (const id of frontier) {
      const w = winById.get(id);
      for (const [oid, ow] of winById) {
        if (prev.has(oid)) continue;
        if (overlap(w, ow) >= 1) { prev.set(oid, id); next.push(oid); }
      }
    }
    frontier = next;
  }

  // Aim for the earliest-born reachable ancestor.
  let target = null;
  for (const [id] of winById) {
    if (id === viewerId || !prev.has(id)) continue;
    if (!target || winById.get(id)[0] < winById.get(target)[0]) target = id;
  }
  if (!target) return null;
  const earliestBirth = winById.get(target)[0];
  if (thisYear - earliestBirth < 90) return null; // not deep enough to gasp at

  // Reconstruct, earliest ancestor first (the order the story is told in).
  const path = [];
  for (let id = target; id != null; id = prev.get(id)) path.push(id);
  const people = path.map((id) => {
    const p = graph.byId.get(id);
    const [b, d] = winById.get(id);
    return { id, name: p.display_name, firstName: firstNameOf(p), birth: b, death: p.is_deceased ? d : null };
  });
  const links = [];
  for (let i = 0; i < people.length - 1; i++) {
    const a = winById.get(people[i].id), b = winById.get(people[i + 1].id);
    links.push({ years: overlap(a, b), from: Math.max(a[0], b[0]), to: Math.min(a[1], b[1]) });
  }
  const anchor = nearestWorldEvent(earliestBirth, detectRegion(graph), 8);
  return {
    people, // earliest first, viewer last
    links,  // links[i] joins people[i] and people[i+1]
    hops: people.length - 1,
    earliestBirth,
    thisYear,
    anchor: anchor ? { year: anchor.year, title: anchor.title } : null,
  };
}

/* ── Bridges: the one person whose removal splits the family into two big
      halves — almost always a marriage that joined two clans. ───────────── */
function bridges(graph) {
  const n = graph.people.length;
  if (n < 25) return null;

  const adj = new Map();
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push(b);
  };
  for (const r of graph.relationships) {
    if (r.type !== 'parent' && r.type !== 'partner') continue;
    link(r.from_person, r.to_person);
    link(r.to_person, r.from_person);
  }

  // The tree may already be several disconnected fragments (imports, stubs) —
  // a "bridge" only means something within the removed person's OWN fragment,
  // so map base components first and measure each split against them alone.
  const compOf = new Map();
  const compMembers = [];
  for (const p of graph.people) {
    if (compOf.has(p.id)) continue;
    const members = [];
    const queue = [p.id];
    compOf.set(p.id, compMembers.length);
    while (queue.length) {
      const id = queue.pop();
      members.push(id);
      for (const o of adj.get(id) || []) {
        if (compOf.has(o)) continue;
        compOf.set(o, compMembers.length);
        queue.push(o);
      }
    }
    compMembers.push(members);
  }

  // Exhaustive but cheap: remove each person once and BFS their component's
  // remains. O(people × edges) — a few million ops at 1,000 people, computed
  // once and memoized by the caller like everything else here.
  let best = null;
  for (const p of graph.people) {
    const members = compMembers[compOf.get(p.id)];
    if (members.length < 21) continue; // can't yield two ≥10 sides
    const seen = new Set([p.id]);
    const pieces = [];
    for (const startId of members) {
      if (seen.has(startId)) continue;
      const piece = [];
      const queue = [startId];
      seen.add(startId);
      while (queue.length) {
        const id = queue.pop();
        piece.push(id);
        for (const o of adj.get(id) || []) {
          if (seen.has(o)) continue;
          seen.add(o);
          queue.push(o);
        }
      }
      pieces.push(piece);
    }
    if (pieces.length < 2) continue; // removal didn't split their fragment
    pieces.sort((a, b) => b.length - a.length);
    const minSide = Math.min(pieces[0].length, pieces[1].length);
    if (minSide < 10) continue;
    if (!best || minSide > best.minSide) {
      best = { person: p, minSide, sideA: pieces[0], sideB: pieces[1] };
    }
  }
  if (!best) return null;

  const sideInfo = (ids) => {
    const freq = new Map();
    for (const id of ids) {
      const s = surnameOf(graph.byId.get(id));
      if (s) freq.set(s, (freq.get(s) || 0) + 1);
    }
    let top = null, topN = 0;
    for (const [s, c] of freq) if (c > topN) { top = s; topN = c; }
    const dominant = top && topN >= 5 && topN >= ids.length * 0.3 ? top : null;
    return { count: ids.length, surname: dominant };
  };
  const p = best.person;
  return {
    personId: p.id,
    name: p.display_name,
    firstName: firstNameOf(p),
    lifespan: year(p.birth_date) != null
      ? `${year(p.birth_date)}${p.is_deceased && year(p.death_date) != null ? `–${year(p.death_date)}` : ''}`
      : null,
    sideA: sideInfo(best.sideA),
    sideB: sideInfo(best.sideB),
  };
}

/* ── Record books: the superlatives hiding in the dates. Rotates three per
      day so repeat visits keep finding something new. ────────────────────── */
function records(graph) {
  const thisYear = new Date().getFullYear();
  const pool = [];
  const first = (id) => firstNameOf(graph.byId.get(id));

  // Each record now carries a `board`: the top-5 leaderboard behind the
  // headline holder — rows { id, label?, detail } for the drill-down drawer
  // (label overrides the person's name where the entry is a couple).

  // Longest marriage — needs the marriage details couples can fill in.
  {
    const all = [];
    for (const r of graph.relationships) {
      if (r.type !== 'partner' || !r.marriage_date) continue;
      const start = year(r.marriage_date);
      if (start == null) continue;
      const a = graph.byId.get(r.from_person), b = graph.byId.get(r.to_person);
      if (!a || !b) continue;
      const ends = [a, b]
        .filter((p) => p.is_deceased)
        .map((p) => year(p.death_date))
        .filter((y) => y != null);
      const ongoing = !ends.length && r.partner_status !== 'former';
      if (!ends.length && !ongoing) continue;
      const end = ongoing ? thisYear : Math.min(...ends);
      const years = end - start;
      if (years <= 0 || years >= 100) continue;
      all.push({ a, b, years, start, ongoing });
    }
    all.sort((x, y) => y.years - x.years);
    const best = all[0];
    if (best && best.years >= 25) {
      pool.push({
        key: 'marriage', icon: 'rings',
        title: `${firstNameOf(best.a)} & ${firstNameOf(best.b)} — married ${best.years} years`,
        detail: best.ongoing
          ? `Since ${best.start}, and still going — the longest marriage on record.`
          : `${best.start} to ${best.start + best.years}, the longest marriage on record.`,
        personId: best.a.id,
        board: all.slice(0, 5).map((m) => ({
          id: m.a.id,
          label: `${firstNameOf(m.a)} & ${firstNameOf(m.b)}`,
          detail: `${m.years} yrs · ${m.start}`,
        })),
      });
    }
  }

  // Longest life.
  {
    const all = [];
    for (const p of graph.people) {
      const b = year(p.birth_date), d = year(p.death_date);
      if (b != null && d != null && d - b > 0 && d - b < 120) all.push({ p, span: d - b, b, d });
    }
    all.sort((x, y) => y.span - x.span);
    const best = all[0];
    if (best && best.span >= 85) {
      const nineties = all.filter((x) => x.span >= 90).length;
      pool.push({
        key: 'life', icon: 'star',
        title: `${best.span} years, the longest life`,
        detail: `${best.p.display_name}, ${best.b}–${best.d}${nineties >= 2 ? ` — ${nineties} relatives reached their 90s` : ''}.`,
        personId: best.p.id,
        board: all.slice(0, 5).map((x) => ({ id: x.p.id, detail: `${x.span} yrs · ${x.b}–${x.d}` })),
      });
    }
  }

  // Oldest new parent + youngest parent, from parent-edge age-at-birth.
  {
    const byParent = new Map(); // parentId -> { parent, oldest: {age, when}, youngest: {age, when} }
    for (const r of graph.relationships) {
      if (r.type !== 'parent' || !isBioAdopt(r.qualifier)) continue;
      const parent = graph.byId.get(r.from_person);
      const child = graph.byId.get(r.to_person);
      const pb = year(parent?.birth_date), cb = year(child?.birth_date);
      if (pb == null || cb == null) continue;
      const age = cb - pb;
      if (age < 13 || age > 75) continue; // outside plausibility → bad data, skip
      const e = byParent.get(parent.id) || { parent, oldest: null, youngest: null };
      if (!e.oldest || age > e.oldest.age) e.oldest = { age, when: cb };
      if (!e.youngest || age < e.youngest.age) e.youngest = { age, when: cb };
      byParent.set(parent.id, e);
    }
    // One leaderboard entry per PERSON (their own extreme), not per birth.
    const olds = [...byParent.values()].sort((x, y) => y.oldest.age - x.oldest.age);
    const youngs = [...byParent.values()].sort((x, y) => x.youngest.age - y.youngest.age);
    const oldest = olds[0] ? { parent: olds[0].parent, ...olds[0].oldest } : null;
    const youngest = youngs[0] ? { parent: youngs[0].parent, ...youngs[0].youngest } : null;
    const role = (p) => (p.gender === 'male' ? 'father' : p.gender === 'female' ? 'mother' : 'parent');
    if (oldest && oldest.age >= 45) {
      pool.push({
        key: 'oldestParent', icon: 'time',
        title: `A ${role(oldest.parent)} again at ${oldest.age}`,
        detail: `${oldest.parent.display_name}, ${oldest.when} — the oldest new parent in the tree.`,
        personId: oldest.parent.id,
        board: olds.slice(0, 5).map((x) => ({ id: x.parent.id, detail: `age ${x.oldest.age} · ${x.oldest.when}` })),
      });
    }
    if (youngest && youngest.age >= 15 && youngest.age <= 20 && (!oldest || youngest.parent.id !== oldest.parent.id)) {
      pool.push({
        key: 'youngestParent', icon: 'seedling',
        title: `A ${role(youngest.parent)} at just ${youngest.age}`,
        detail: `${youngest.parent.display_name}, ${youngest.when} — the youngest in the tree.`,
        personId: youngest.parent.id,
        board: youngs.slice(0, 5).map((x) => ({ id: x.parent.id, detail: `age ${x.youngest.age} · ${x.youngest.when}` })),
      });
    }
  }

  // Most grandchildren.
  {
    const all = [];
    for (const p of graph.people) {
      const grandkids = new Set();
      for (const c of graph.children(p.id)) {
        if (!isBioAdopt(c.qualifier)) continue;
        for (const gc of graph.children(c.id)) {
          if (isBioAdopt(gc.qualifier)) grandkids.add(gc.id);
        }
      }
      if (grandkids.size > 0) all.push({ p, n: grandkids.size });
    }
    all.sort((x, y) => y.n - x.n);
    const best = all[0];
    if (best && best.n >= 8) {
      pool.push({
        key: 'grandchildren', icon: 'heart',
        title: `${firstNameOf(best.p)}: ${best.n} grandchildren`,
        detail: `${best.p.display_name} — more than anyone else in the tree.`,
        personId: best.p.id,
        board: all.slice(0, 5).map((x) => ({ id: x.p.id, detail: `${x.n} grandchildren` })),
      });
    }
  }

  if (pool.length < 2) return null;
  // Rotate which three show, changing daily — stable within a session so the
  // sheet doesn't reshuffle on every re-render.
  const day = Math.floor(Date.now() / 86400000);
  const shown = pool.length <= 3
    ? pool
    : Array.from({ length: 3 }, (_, i) => pool[(day + i * Math.max(1, Math.floor(pool.length / 3))) % pool.length])
      .filter((r, i, arr) => arr.findIndex((x) => x.key === r.key) === i);
  return { records: shown, poolSize: pool.length };
}

/* ── Trades: what the family did for a living, era by era ────────────────── */
function trades(graph) {
  const entries = [];
  for (const p of graph.people) {
    const occ = (p.occupation || '').trim();
    const b = year(p.birth_date);
    if (!occ || b == null) continue;
    entries.push({ id: p.id, occ, workYear: b + 25 }); // roughly the start of a working life
  }
  if (entries.length < 12) return null;

  const years = entries.map((e) => e.workYear);
  const minY = Math.min(...years), maxY = Math.max(...years);
  if (maxY - minY < 50) return null;
  const bandCount = maxY - minY >= 120 ? 4 : 3;
  const width = Math.ceil((maxY - minY + 1) / bandCount / 10) * 10;
  const start0 = Math.floor(minY / 10) * 10;

  const bands = [];
  for (let i = 0; i < bandCount; i++) {
    const from = start0 + i * width;
    const to = from + width;
    const inBand = entries.filter((e) => e.workYear >= from && e.workYear < to);
    if (inBand.length < 4) continue;
    const freq = new Map();
    for (const e of inBand) {
      const key = e.occ.toLowerCase();
      if (!freq.has(key)) freq.set(key, { name: e.occ, count: 0, ids: [] });
      const f = freq.get(key);
      f.count++;
      f.ids.push(e.id);
    }
    const top = [...freq.values()].sort((a, b) => b.count - a.count).slice(0, 3);
    bands.push({
      from,
      to: Math.min(to, new Date().getFullYear()),
      isNow: to >= new Date().getFullYear(),
      top,
      n: inBand.length,
    });
  }
  if (bands.length < 2) return null;

  const overall = new Map();
  for (const e of entries) {
    const key = e.occ.toLowerCase();
    if (!overall.has(key)) overall.set(key, { name: e.occ, count: 0 });
    overall.get(key).count++;
  }
  const distinct = overall.size;
  return {
    bands,
    firstTop: bands[0].top[0].name,
    lastTop: bands[bands.length - 1].top[0].name,
    distinct,
    total: entries.length,
  };
}

/* ── The gift of years: average lifespan per birth-decade cohort ─────────── */
function giftOfYears(graph) {
  const cohorts = new Map(); // decade -> [{ id, span }]
  for (const p of graph.people) {
    if (!p.is_deceased) continue;
    const b = year(p.birth_date), d = year(p.death_date);
    if (b == null || d == null) continue;
    const span = d - b;
    if (span <= 0 || span >= 120) continue;
    const dec = Math.floor(b / 10) * 10;
    if (!cohorts.has(dec)) cohorts.set(dec, []);
    cohorts.get(dec).push({ id: p.id, span });
  }
  const rows = [...cohorts.entries()]
    .filter(([, people]) => people.length >= 4)
    .map(([decade, people]) => ({
      decade,
      avg: Math.round(people.reduce((s, x) => s + x.span, 0) / people.length),
      n: people.length,
      people: people.slice().sort((a, b) => b.span - a.span),
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
      spans.push({ id: p.id, from: b, to: d });
    } else {
      spans.push({ id: p.id, from: b, to: thisYear });
    }
  }
  if (spans.length < 15) return null;
  const minYear = Math.min(...spans.map((s) => s.from));
  if (thisYear - minYear < 40) return null;
  const step = Math.max(1, Math.ceil((thisYear - minYear) / 110));
  const series = [];
  let peak = { year: minYear, count: 0 };
  for (let y = minYear; y <= thisYear; y += step) {
    const count = spans.reduce((n, s) => n + (s.from <= y && y <= s.to ? 1 : 0), 0);
    series.push({ year: y, count });
    if (count >= peak.count) peak = { year: y, count };
  }
  // Always land the series exactly on the current year so "today" is a point.
  if (series[series.length - 1].year !== thisYear) {
    const count = spans.reduce((n, s) => n + (s.from <= thisYear && thisYear <= s.to ? 1 : 0), 0);
    series.push({ year: thisYear, count });
    if (count >= peak.count) peak = { year: thisYear, count };
  }
  return {
    series,
    // The raw alive-windows behind the curve, so the renderer's scrubber can
    // answer "who was alive in YEAR?" for ANY year without a per-year index.
    spans,
    peak,
    isNow: peak.year >= thisYear - step,
    firstYear: minYear,
    firstCount: series[0].count,
    thisYear,
  };
}

// Who was alive in a given year, oldest first — the scrubber's drill-down.
export function aliveInYear(spans, y) {
  return spans
    .filter((s) => s.from <= y && y <= s.to)
    .sort((a, b) => a.from - b.from)
    .map((s) => ({ id: s.id, ageThen: y - s.from }));
}

/* ── Generation strata: everyone, stacked oldest-first ───────────────────── */
function strata(graph, viewerId, gen) {
  if (graph.people.length < 12) return null;
  const byGen = new Map();
  for (const p of graph.people) {
    const g = gen.get(p.id) ?? 0;
    if (!byGen.has(g)) byGen.set(g, { total: 0, living: 0, remembered: 0, ids: [] });
    const row = byGen.get(g);
    row.total++;
    row.ids.push(p.id);
    if (p.is_deceased) row.remembered++;
    else row.living++;
  }
  if (byGen.size < 3) return null;
  const byBirth = (a, b) =>
    (year(graph.byId.get(a)?.birth_date) ?? 9999) - (year(graph.byId.get(b)?.birth_date) ?? 9999);
  const rows = [...byGen.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([g, r], i) => ({ gen: g, label: `G${i + 1}`, ...r, ids: r.ids.slice().sort(byBirth) }));
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
      buckets.get(start).push({ parentIds: h.parentIds, count: h.kids.length });
    }
    return [...buckets.entries()]
      .filter(([, hs]) => hs.length >= 3)
      .map(([start, hs]) => ({
        start,
        label: width === 10 ? `${start}s` : `${start}–${start + width - 1}`,
        avg: Math.round((hs.reduce((s, x) => s + x.count, 0) / hs.length) * 10) / 10,
        n: hs.length,
        households: hs.slice().sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => a.start - b.start);
  };
  let trend = bucketize(10);
  if (trend.length < 3) trend = bucketize(30);
  if (trend.length < 2) trend = null;

  if (!recordOut && !trend) return null;
  return { record: recordOut, trend };
}

/* ── The name hall of fame + the thread of the most-passed-down name ───────
   Counts GIVEN names — first and middle both, so "Sarah Jane Davies" carries
   Jane forward too — keyed case-insensitively. Every entry keeps its people
   ({ id, middle }), and the full tally ships as `all` so the card's explorer
   can answer "how many Jasons?" for any name, not just the top five bars. */
function names(graph, gen) {
  const freq = new Map(); // lowercased name -> { name, count, people: [{id, middle}] }
  for (const p of graph.people) {
    for (const { name, middle } of givenNamesOf(p)) {
      const key = name.toLowerCase();
      if (!freq.has(key)) freq.set(key, { name, count: 0, people: [] });
      const e = freq.get(key);
      e.count++;
      e.people.push({ id: p.id, middle });
    }
  }
  const byBirth = (a, b) =>
    (year(graph.byId.get(a.id)?.birth_date) ?? 9999) - (year(graph.byId.get(b.id)?.birth_date) ?? 9999);
  const all = [...freq.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .map((e) => ({ name: e.name, count: e.count, people: e.people.slice().sort(byBirth) }));
  const top = all.filter((e) => e.count >= 3).slice(0, 5);
  if (top.length < 2) return null;

  // The thread: which generations the #1 name has appeared in.
  const maxGen = Math.max(...[...gen.values()], 0);
  const lead = top[0];
  const gensWith = new Set(lead.people.map((x) => gen.get(x.id) ?? 0));
  const thread = Array.from({ length: maxGen + 1 }, (_, g) => gensWith.has(g));
  const years = lead.people
    .map((x) => year(graph.byId.get(x.id)?.birth_date))
    .filter((y) => y != null);
  return {
    top,
    all,
    thread: {
      name: lead.name,
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
    if (!places.has(pl.key)) places.set(pl.key, { display: pl.display, count: 0, ids: [] });
    const e = places.get(pl.key);
    e.count++;
    e.ids.push(p.id);
  }
  const byBirth = (a, b) =>
    (year(graph.byId.get(a)?.birth_date) ?? 9999) - (year(graph.byId.get(b)?.birth_date) ?? 9999);
  const ranked = [...places.values()]
    .filter((e) => e.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((e) => ({ ...e, ids: e.ids.slice().sort(byBirth) }));
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

/* ── This month in your family: birthdays and marriage anniversaries falling
      in the current calendar month — a practical digest for the home hub,
      not a threshold-gated "insight" (an empty month is just an empty
      month, nothing to hide). ────────────────────────────────────────────── */
export function computeThisMonth(graph, now = new Date()) {
  const month = now.getMonth() + 1;
  const today = now.getDate();
  const thisYear = now.getFullYear();

  const birthdays = [];
  for (const p of graph.people) {
    if (p.is_deceased) continue;
    const m = birthMonthOf(p.birth_date);
    if (m !== month) continue;
    const d = birthDayOf(p.birth_date);
    if (d == null) continue;
    const b = year(p.birth_date);
    birthdays.push({ id: p.id, name: p.display_name, day: d, isToday: d === today, turning: b != null ? thisYear - b : null });
  }
  birthdays.sort((a, b) => a.day - b.day);

  const anniversaries = [];
  const seen = new Set();
  for (const r of graph.relationships) {
    if (r.type !== 'partner' || !r.marriage_date) continue;
    const m = monthOf(r.marriage_date);
    if (m !== month) continue;
    const d = dayOf(r.marriage_date);
    const startYear = year(r.marriage_date);
    if (d == null || startYear == null) continue;
    const key = [r.from_person, r.to_person].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const a = graph.byId.get(r.from_person), b = graph.byId.get(r.to_person);
    if (!a || !b) continue;
    anniversaries.push({
      aId: a.id, aName: firstNameOf(a), bId: b.id, bName: firstNameOf(b),
      day: d, isToday: d === today, years: thisYear - startYear,
    });
  }
  anniversaries.sort((a, b) => a.day - b.day);

  if (!birthdays.length && !anniversaries.length) return null;
  return { month: MONTHS[month - 1], birthdays, anniversaries };
}

/* ── Highlights: a compact, privacy-safe digest of the visual modules, for
      the AI narrative to draw on — grounding facts only, no raw people[]. ── */
export function buildInsightHighlights(modules) {
  const h = {};
  if (modules.handshakes) {
    const m = modules.handshakes;
    h.handshake = {
      hops: m.hops,
      earliestBirth: m.earliestBirth,
      earliestName: m.people[0].name,
      anchor: m.anchor ? `${m.anchor.year}: ${m.anchor.title}` : null,
    };
  }
  if (modules.giftOfYears) {
    const g = modules.giftOfYears;
    h.lifespanGain = { firstDecade: g.first.decade, firstAvg: g.first.avg, lastDecade: g.last.decade, lastAvg: g.last.avg };
  }
  if (modules.fullestYear) {
    const f = modules.fullestYear;
    h.fullestYear = { peakYear: f.isNow ? 'now' : f.peak.year, peakCount: f.peak.count };
  }
  if (modules.bridges) {
    const b = modules.bridges;
    h.bridge = {
      name: b.name,
      sideACount: b.sideA.count, sideASurname: b.sideA.surname,
      sideBCount: b.sideB.count, sideBSurname: b.sideB.surname,
    };
  }
  if (modules.names) {
    h.topName = { name: modules.names.top[0].name, count: modules.names.top[0].count, generationsPresent: modules.names.thread.present };
  }
  if (modules.heartlands) {
    h.heartland = { place: modules.heartlands.places[0].display, migration: modules.heartlands.migration?.map((s) => s.display) || null };
  }
  if (modules.trades) {
    h.trades = { from: modules.trades.firstTop, to: modules.trades.lastTop, distinct: modules.trades.distinct };
  }
  if (modules.birthdays) {
    h.birthdayPeak = { month: modules.birthdays.peakLabel, count: modules.birthdays.peakCount };
  }
  if (modules.records) {
    const marriage = modules.records.records.find((r) => r.key === 'marriage');
    if (marriage) h.longestMarriage = marriage.title.replace(/^.* — /, '');
  }
  return Object.keys(h).length ? h : null;
}

/* ── The birthday wheel + birthday twins ─────────────────────────────────── */
function birthdays(graph, gen) {
  const months = Array(12).fill(0);
  const monthPeople = Array.from({ length: 12 }, () => []); // [{ id, day|null }]
  const byExactDay = new Map(); // 'MM-DD' -> [person]
  let withMonth = 0;
  for (const p of graph.people) {
    const m = birthMonthOf(p.birth_date);
    if (m == null) continue;
    withMonth++;
    months[m - 1]++;
    const d = birthDayOf(p.birth_date);
    monthPeople[m - 1].push({ id: p.id, day: d });
    if (d != null) {
      const key = `${m}-${d}`;
      if (!byExactDay.has(key)) byExactDay.set(key, []);
      byExactDay.get(key).push(p);
    }
  }
  if (withMonth < 15) return null;
  for (const list of monthPeople) list.sort((a, b) => (a.day ?? 32) - (b.day ?? 32));

  // Every date shared by 2+ people — the full "who shares a birthday" list
  // behind the caption's single twin pair. Same-year pairs (actual twins)
  // belong here too; the headline twins below still exclude them.
  const sharedDays = [...byExactDay.entries()]
    .filter(([, people]) => people.length >= 2)
    .map(([key, people]) => {
      const [m, d] = key.split('-').map(Number);
      return {
        month: m, day: d,
        dateLabel: `${d} ${MONTHS[m - 1]}`,
        ids: people.slice()
          .sort((a, b) => (year(a.birth_date) ?? 9999) - (year(b.birth_date) ?? 9999))
          .map((p) => p.id),
      };
    })
    .sort((a, b) => b.ids.length - a.ids.length || a.month - b.month || a.day - b.day);
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
        const m = birthMonthOf(a.birth_date), d = birthDayOf(a.birth_date);
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
    monthPeople,
    sharedDays,
    peakMonth,
    peakCount: months[peakMonth],
    peakLabel: MONTHS[peakMonth],
    twins: twins.slice(0, 2),
    withMonth,
  };
}

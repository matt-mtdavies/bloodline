import { computeGenerations, distancesFrom } from '../data/graph.js';
import { detectRegion, nearestWorldEvent } from './worldEvents.js';
import { yearsBetween } from './dates.js';
import { normalizeGender } from './gender.js';
import { haversineKm, formatKm } from './geo.js';

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
//
// A middle name often lives in its OWN field, not in display_name: the
// profile heading weaves person.middle_name into display_name only for that
// one view (see fullName() in lib/profile.js) — "Sari Stein" the record,
// "Sari Heather Stein" the heading. Mirror that same weave-and-dedupe here
// so "Heather" counts even when display_name itself never spelled it out.
const givenNamesOf = (p) => {
  const display = (p?.display_name || '').trim();
  const tokens = display.split(/\s+/).filter((t) => !/^[("'“‘]/.test(t));
  const given = tokens.length > 1 ? tokens.slice(0, -1) : tokens;
  const out = given
    .filter((t) => t.length >= 2)
    .map((name, i) => ({ name, middle: i > 0 }));
  const middleName = (p?.middle_name || '').trim();
  if (middleName && !display.toLowerCase().includes(middleName.toLowerCase())) {
    out.push({ name: middleName, middle: true });
  }
  return out;
};
const isBioAdopt = (q) => !q || q === 'biological' || q === 'adoptive';

// Deterministic per-day index — the same "which day is it" seed every
// rotation in this file uses (records()'s pool rotation, and
// InsightModules.jsx's chapter/card shuffle), so nothing reshuffles
// mid-session but everything looks different tomorrow. Exported so the
// renderer can seed its own shuffle off the identical clock.
export function dayIndex(now = Date.now()) {
  return Math.floor(now / 86400000);
}

// Deterministic shuffle (mulberry32 PRNG + Fisher-Yates) — never
// Math.random(), so the same seed always produces the same order. Used to
// vary the Insights sheet's chapter/card order once per day without ever
// reshuffling mid-render, and kept here so it's tested alongside the other
// per-day rotation logic (records()) rather than duplicated in a component.
export function seededShuffle(arr, seed) {
  const out = [...arr];
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// `now` drives records()'s "which 3 of the pool today" rotation — injectable
// so tests can pin a specific day rather than depending on the real clock
// (see records() below).
/*
 * `geocodedByPlace` (optional): a plain object keyed by the EXACT
 * `residence` string as stored on a person record, value {lat, lon} | null
 * — already resolved by the caller (see functions/_lib/geocode.js) before
 * this synchronous function runs. This file makes no network calls itself;
 * omitting it (every existing caller, until slice 5 wires one up) simply
 * means nearbyRelatives never renders, identical to today's behavior.
 * `lastViewedByPersonId` (optional): a plain object keyed by personId,
 * value the unix-SECONDS timestamp of the viewer's own last visit to that
 * profile — from functions/_lib/profileViews.js, same "resolved by the
 * caller, no network calls in here" convention. Omitting it means
 * forgottenPeople never renders.
 */
export function computeInsightModules(graph, viewerId, now = Date.now(), geocodedByPlace = null, lastViewedByPersonId = null) {
  const gen = computeGenerations(graph);
  return {
    livingLink: livingLink(graph, viewerId),
    giftOfYears: giftOfYears(graph),
    fullestYear: fullestYear(graph),
    strata: strata(graph, viewerId, gen),
    brood: brood(graph),
    bridges: bridges(graph),
    names: names(graph, gen),
    heartlands: heartlands(graph, gen),
    trades: trades(graph),
    birthdays: birthdays(graph, gen),
    records: records(graph, now),
    parenthood: parenthood(graph),
    serviceRecords: serviceRecords(graph, gen),
    surnames: surnames(graph),
    livingGenerations: livingGenerations(graph, gen),
    twinBirths: twinBirths(graph),
    newArrivals: newArrivals(graph, now),
    blendedFamily: blendedFamily(graph),
    tradeLineage: tradeLineage(graph),
    earlyLoss: earlyLoss(graph),
    centenarians: centenarians(graph, now),
    missingRecords: missingRecords(graph, viewerId),
    sameAgeMarriages: sameAgeMarriages(graph),
    closestCousinsByAge: closestCousinsByAge(graph, viewerId),
    sharedBirthplaceGenerations: sharedBirthplaceGenerations(graph, gen),
    nearbyRelatives: nearbyRelatives(graph, viewerId, geocodedByPlace),
    forgottenPeople: forgottenPeople(graph, viewerId, lastViewedByPersonId, now),
  };
}

// ── Service records: family members with a documented military connection —
//    a military-tagged life event, a structured branch/rank/service-number
//    field, or a medal, all surfaced from documents run through Summarize
//    with AI (see DocViewer / lib/enrich.js). Unlike the other modules, one
//    documented record is already meaningful (this is provenance, not a
//    statistical pattern), so there's no minimum-count gate beyond "at least
//    one" — the same threshold hasMilitaryService uses on the profile.
function serviceRecords(graph, gen) {
  const people = [];
  for (const p of graph.people) {
    const events = (p.events || []).filter((e) => e.tag === 'military').sort((a, b) => Number(a.year) - Number(b.year));
    const medals = p.military_medals || [];
    if (!events.length && !p.military_branch && !medals.length) continue;
    people.push({
      id: p.id,
      events,
      branch: p.military_branch || null,
      nation: p.military_nation || null,
      rank: p.military_rank || null,
      medals: medals.length,
      gen: gen.get(p.id) ?? 0,
    });
  }
  if (!people.length) return null;

  const branchCounts = {};
  for (const person of people) {
    const key = person.branch || 'unspecified';
    branchCounts[key] = (branchCounts[key] || 0) + 1;
  }
  const medalTotal = people.reduce((sum, p) => sum + p.medals, 0);
  const generationsSpanned = new Set(people.map((p) => p.gen)).size;

  return { people, count: people.length, branchCounts, medalTotal, generationsSpanned };
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

/* ── Living link: the fewest-hop chain of overlapping lives back to the
      earliest-born ancestor reachable this way — but only along ONE real,
      unbroken line of ancestors (parent, grandparent, great-grandparent...).
      Earlier versions connected any two ancestors whose lives simply
      happened to overlap, even across unrelated branches — your maternal
      grandfather and paternal grandmother, say, who were never related to
      each other and may never have set foot in the same country. That's a
      coincidence of timing, not a chain of real relationships, and reads as
      false once you notice it. Every hop here is a genuine ancestor of the
      person before it; "reachable" is scoped to lineageLine() below. Step
      parents are excluded from the walk entirely — same "step doesn't count"
      rule bloodRelativesOf() uses elsewhere — since a step-grandparent isn't
      an ancestor at all, blood or adopted.
      Renamed from "handshakes" (real user feedback: "get rid of the
      handshake insight... never liked it") — same mechanism, kept and
      reworded rather than removed, since the underlying idea (you're
      linked, life to life, to someone born a very long time ago) is
      genuinely personal; the word itself just read as cold/corporate. ── */
function livingLink(graph, viewerId) {
  const thisYear = new Date().getFullYear();
  const viewer = graph.byId.get(viewerId);
  const vWin = windowOf(viewer, thisYear);
  if (!vWin) return null;

  // Every real ancestor of the viewer (biological or adoptive — step
  // excluded), plus the one step back toward the viewer that reached them —
  // a real lineage tree, not a free-for-all "everyone alive at once" graph.
  const towardViewer = new Map(); // ancestorId -> the closer relative one step toward viewer
  const winById = new Map([[viewerId, vWin]]);
  const stack = [viewerId];
  const seen = new Set([viewerId]);
  while (stack.length) {
    const id = stack.pop();
    for (const par of graph.parents(id)) {
      if (par.qualifier === 'step' || seen.has(par.id)) continue;
      seen.add(par.id);
      stack.push(par.id);
      towardViewer.set(par.id, id);
      const w = windowOf(graph.byId.get(par.id), thisYear);
      if (w) winById.set(par.id, w);
    }
  }
  if (winById.size < 2) return null;

  const overlap = (a, b) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]);

  // The windowed ancestors on the single real lineage line from the viewer
  // up to `ancestorId`, nearest first (index 0 is always the viewer).
  function lineageLine(ancestorId) {
    const ids = [];
    for (let id = ancestorId; id != null; id = towardViewer.get(id)) ids.push(id);
    ids.reverse();
    return ids.filter((id) => winById.has(id));
  }

  // Try the earliest-born ancestor first — that's the one worth gasping at
  // — and fall back to the next-earliest whenever the deepest ones turn out
  // not to be reachable via an unbroken overlap chain on their own line.
  const candidates = [...winById.keys()]
    .filter((id) => id !== viewerId)
    .sort((a, b) => winById.get(a)[0] - winById.get(b)[0]);

  for (const target of candidates) {
    const earliestBirth = winById.get(target)[0];
    // Ancestors only get shallower from here on — if even this one isn't
    // deep enough to gasp at, none of the rest will be either.
    if (thisYear - earliestBirth < 90) return null;

    const line = lineageLine(target);
    if (line.length < 2 || line[line.length - 1] !== target) continue;

    // Greedy farthest-reachable-overlap walk along this one real line: at
    // each stop, jump to the farthest-back relative whose life still
    // overlapped — fewest hops, same "shortest chain" spirit as before, but
    // every hop is now a genuine ancestor of the person right before it.
    const chainIds = [line[0]];
    let cur = 0;
    let stuck = false;
    while (chainIds[chainIds.length - 1] !== target) {
      let next = -1;
      for (let j = line.length - 1; j > cur; j--) {
        if (overlap(winById.get(line[cur]), winById.get(line[j])) >= 1) { next = j; break; }
      }
      if (next === -1) { stuck = true; break; }
      chainIds.push(line[next]);
      cur = next;
    }
    if (stuck) continue; // this ancestor isn't reachable via a real, unbroken line of overlaps

    // Reconstruct, earliest ancestor first (the order the story is told in).
    chainIds.reverse();
    const people = chainIds.map((id) => {
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
  return null;
}

// Living link to ANY chosen person — the same "who overlapped whose life"
// chain, generalized beyond the ancestor line so it can answer "how many
// living links am I from [any relative]?" Computed on demand (when a user
// actually picks a target from the search box), not speculatively for
// everyone: the BFS considers every person's decidable window, so it's
// O(people²) worst case — a few hundred thousand comparisons at 600 people,
// fine once, not worth doing for names nobody asks about.
export function livingLinkTo(graph, fromId, toId) {
  if (fromId == null || toId == null || fromId === toId) return null;
  const thisYear = new Date().getFullYear();
  const winById = new Map();
  for (const p of graph.people) {
    const w = windowOf(p, thisYear);
    if (w) winById.set(p.id, w);
  }
  if (!winById.has(fromId) || !winById.has(toId)) return null; // missing dates

  const overlap = (a, b) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
  const prev = new Map([[fromId, null]]);
  let frontier = [fromId];
  while (frontier.length && !prev.has(toId)) {
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
  if (!prev.has(toId)) return null; // no overlap chain connects them

  // Reconstruct from the target back to the viewer — the same "far endpoint
  // first, You last" convention the deep-time chain uses, so both share one
  // renderer regardless of which direction chronology actually runs.
  const path = [];
  for (let id = toId; id != null; id = prev.get(id)) path.push(id);
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
  return {
    people,
    links,
    hops: people.length - 1,
    earliestBirth: Math.min(...people.map((p) => p.birth)),
    thisYear,
    anchor: null, // the historical-event anchor is a deep-time-default flourish only
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
function records(graph, now = Date.now()) {
  const thisYear = new Date(now).getFullYear();
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

  // Longest life. The span is the SAME precise "had the birthday happened
  // yet" age the profile itself shows — plain year-subtraction overstates a
  // life by up to a year whenever death fell before that year's birthday.
  {
    const all = [];
    for (const p of graph.people) {
      const b = year(p.birth_date), d = year(p.death_date);
      const span = yearsBetween(p.birth_date, p.death_date);
      if (b != null && d != null && span != null && span > 0 && span < 120) all.push({ p, span, b, d });
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
      const cb = year(child?.birth_date);
      if (cb == null) continue;
      const age = yearsBetween(parent?.birth_date, child?.birth_date);
      if (age == null || age < 13 || age > 75) continue; // outside plausibility → bad data, skip
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
    const role = (p) => (normalizeGender(p.gender) === 'male' ? 'father' : normalizeGender(p.gender) === 'female' ? 'mother' : 'parent');
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

  // Biggest age gap between partners.
  {
    const all = [];
    const seen = new Set();
    for (const r of graph.relationships) {
      if (r.type !== 'partner') continue;
      const key = [r.from_person, r.to_person].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const a = graph.byId.get(r.from_person), b = graph.byId.get(r.to_person);
      if (!a || !b || !a.birth_date || !b.birth_date) continue;
      const rawGap = yearsBetween(a.birth_date, b.birth_date);
      if (rawGap == null) continue;
      const gap = Math.abs(rawGap);
      if (gap <= 0) continue;
      const [older, younger] = rawGap >= 0 ? [a, b] : [b, a];
      all.push({ older, younger, gap });
    }
    all.sort((x, y) => y.gap - x.gap);
    const best = all[0];
    if (best && best.gap >= 10) {
      pool.push({
        key: 'ageGap', icon: 'gap',
        title: `${best.gap}-year age gap`,
        detail: `${firstNameOf(best.older)} & ${firstNameOf(best.younger)} — the widest partner age gap on record.`,
        personId: best.older.id,
        board: all.slice(0, 5).map((x) => ({
          id: x.older.id,
          label: `${firstNameOf(x.older)} & ${firstNameOf(x.younger)}`,
          detail: `${x.gap} yrs apart`,
        })),
      });
    }
  }

  // Grandchildren born after a grandparent had already passed — the
  // overlap that never happened. Framed as connection, not a "gotcha": what's
  // missing is the chance to have met, not anything wrong with the record.
  {
    const pairs = [];
    for (const p of graph.people) {
      const pb = year(p.birth_date);
      if (pb == null) continue;
      const parents = graph.parents(p.id).filter((x) => isBioAdopt(x.qualifier));
      const grandparents = new Set();
      for (const par of parents) {
        for (const gp of graph.parents(par.id)) {
          if (isBioAdopt(gp.qualifier)) grandparents.add(gp.id);
        }
      }
      for (const gpId of grandparents) {
        const gp = graph.byId.get(gpId);
        if (!gp?.is_deceased) continue;
        const dYear = year(gp.death_date);
        if (dYear == null) continue;
        const gap = pb - dYear;
        if (gap <= 0) continue; // died the same year or after — overlap isn't decidable either way, so don't claim a miss
        pairs.push({ child: p, grandparent: gp, gap });
      }
    }
    pairs.sort((a, b) => b.gap - a.gap);
    const best = pairs[0];
    // Count distinct grandchildren, not pairs — a child missing both
    // grandparents is one grandchild affected twice, not two grandchildren.
    const distinctChildren = new Set(pairs.map((x) => x.child.id)).size;
    if (best && distinctChildren >= 3) {
      pool.push({
        key: 'neverMet', icon: 'hourglass',
        title: `${firstNameOf(best.child)} never met ${firstNameOf(best.grandparent)}`,
        detail: `${best.grandparent.display_name} passed ${best.gap} year${best.gap === 1 ? '' : 's'} before ${firstNameOf(best.child)} was born — ${distinctChildren} grandchildren in the family never met a grandparent.`,
        personId: best.child.id,
        board: pairs.slice(0, 5).map((x) => ({
          id: x.child.id,
          label: `${firstNameOf(x.child)} & ${firstNameOf(x.grandparent)}`,
          detail: `${x.gap} yr${x.gap === 1 ? '' : 's'} apart`,
        })),
      });
    }
  }

  // Most well-traveled — from residences[] (Places Lived), distinct from
  // heartlands()'s birthplace-origin story above: this is a person's own
  // recorded chronological residence history across their whole life, not a
  // family-wide birthplace aggregate. Dedups by structured suburb/state/
  // country when geocoding resolved it (so "Cardiff, Wales" typed twice with
  // different punctuation doesn't inflate the count), falling back to the
  // raw place text when it hasn't been geocoded yet.
  {
    const all = [];
    for (const p of graph.people) {
      const places = p.residences || [];
      if (places.length < 2) continue;
      const seen = new Set();
      for (const r of places) {
        const key = r.suburb && r.country
          ? normalizeTextKey(`${r.suburb}|${r.state || ''}|${r.country}`)
          : normalizeTextKey(r.place || '');
        if (key) seen.add(key);
      }
      if (seen.size >= 2) all.push({ p, n: seen.size });
    }
    all.sort((x, y) => y.n - x.n);
    const best = all[0];
    if (best && best.n >= 3) {
      pool.push({
        key: 'wellTraveled', icon: 'compass',
        title: `${firstNameOf(best.p)}: ${best.n} places called home`,
        detail: `${best.p.display_name} — more recorded places lived than anyone else in the tree.`,
        personId: best.p.id,
        board: all.slice(0, 5).map((x) => ({ id: x.p.id, detail: `${x.n} places` })),
      });
    }
  }

  if (pool.length < 2) return null;
  // Rotate which three show, changing daily — stable within a session so the
  // sheet doesn't reshuffle on every re-render.
  const day = dayIndex(now);
  const shown = pool.length <= 3
    ? pool
    : Array.from({ length: 3 }, (_, i) => pool[(day + i * Math.max(1, Math.floor(pool.length / 3))) % pool.length])
      .filter((r, i, arr) => arr.findIndex((x) => x.key === r.key) === i);
  return { records: shown, poolSize: pool.length, pool };
}

/* ── Parenthood: how old people were when they had children ──────────────── */
function parenthood(graph) {
  const ages = []; // { age, parent, child }
  for (const r of graph.relationships) {
    if (r.type !== 'parent' || !isBioAdopt(r.qualifier)) continue;
    const parent = graph.byId.get(r.from_person);
    const child = graph.byId.get(r.to_person);
    if (!parent || !child) continue;
    const age = yearsBetween(parent.birth_date, child.birth_date);
    // Same plausibility window as the records module's parent-age checks —
    // outside it is bad data (a typo'd year), not a real early/late parent.
    if (age == null || age < 13 || age > 75) continue;
    ages.push({ age, parent, child });
  }
  if (ages.length < 8) return null;

  const avg = Math.round(ages.reduce((s, a) => s + a.age, 0) / ages.length);
  const byGender = {};
  for (const g of ['female', 'male']) {
    const list = ages.filter((a) => normalizeGender(a.parent.gender) === g);
    if (list.length >= 4) {
      byGender[g] = { avg: Math.round(list.reduce((s, a) => s + a.age, 0) / list.length), n: list.length };
    }
  }

  // 5-year buckets for the histogram, each carrying its own drill-down rows.
  const buckets = new Map();
  for (const a of ages) {
    const from = Math.floor(a.age / 5) * 5;
    if (!buckets.has(from)) buckets.set(from, []);
    buckets.get(from).push(a);
  }
  const histogram = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([from, list]) => ({
      from,
      to: from + 4,
      count: list.length,
      people: list.slice().sort((a, b) => a.age - b.age),
    }));

  return {
    avg,
    n: ages.length,
    min: Math.min(...ages.map((a) => a.age)),
    max: Math.max(...ages.map((a) => a.age)),
    byGender: Object.keys(byGender).length ? byGender : null,
    histogram,
  };
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
      const f = trackVariant(freq, normalizeTextKey(e.occ), e.occ, { count: 0, ids: [] });
      f.count++;
      f.ids.push(e.id);
    }
    resolveDisplay(freq);
    const top = [...freq.values()]
      .map((f) => ({ name: f.display, count: f.count, ids: f.ids }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
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
    const f = trackVariant(overall, normalizeTextKey(e.occ), e.occ, { count: 0, ids: [] });
    f.count++;
    f.ids.push(e.id);
  }
  resolveDisplay(overall);
  const distinct = overall.size;
  // Every distinct trade in the family, not just each era's top 3 — the
  // explorer's lookup pool (mirrors names()'s `all`/`top` split: `top`
  // stays curated for the always-visible bars, `all` backs "did we have
  // any carpet layers?" even when the answer is a single person).
  const all = [...overall.values()]
    .map((f) => ({ name: f.display, count: f.count, ids: f.ids }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    bands,
    firstTop: bands[0].top[0].name,
    lastTop: bands[bands.length - 1].top[0].name,
    distinct,
    total: entries.length,
    all,
  };
}

/* ── The gift of years: average lifespan per birth-decade cohort ─────────── */
function giftOfYears(graph) {
  const cohorts = new Map(); // decade -> [{ id, span }]
  for (const p of graph.people) {
    if (!p.is_deceased) continue;
    const b = year(p.birth_date), d = year(p.death_date);
    if (b == null || d == null) continue;
    // Precise age at death, not plain year subtraction — the latter
    // overstates a life by up to a year whenever death fell before that
    // year's birthday (the bug: "1946–1974" read as 28, the profile's own
    // age said 27).
    const span = yearsBetween(p.birth_date, p.death_date);
    if (span == null || span <= 0 || span >= 120) continue;
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

// "Mt. Gambier" and "Mt Gambier" (or "Builder" and "Builder.") are the same
// value typed two ways, not two different ones — a raw lowercase key treats
// a stray period or double space as a whole new place/trade, silently
// splitting one true count across two bars. Stripping punctuation and
// collapsing whitespace before keying merges those back together; shared by
// heartlands (places) and trades (occupations) below, the two spots that
// group people by free-text strings someone typed in by hand.
const normalizeTextKey = (display) => display.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();

// Track one raw-spelling variant against a normalized-key bucket, so the
// merged group can show whichever variant its members actually used most
// (via resolveDisplay below) rather than an arbitrary "whichever was seen
// first."
function trackVariant(bucket, key, display, extra) {
  if (!bucket.has(key)) bucket.set(key, { variants: new Map(), ...extra });
  const e = bucket.get(key);
  e.variants.set(display, (e.variants.get(display) || 0) + 1);
  return e;
}

// Resolve every bucket's `display` to its most-common raw spelling (ties
// keep whichever was seen first) and drop the now-unneeded variant tally.
function resolveDisplay(bucket) {
  for (const e of bucket.values()) {
    let best = null;
    for (const [display, n] of e.variants) {
      if (!best || n > best.n) best = { display, n };
    }
    e.display = best.display;
    delete e.variants;
  }
}

function heartlands(graph, gen) {
  const places = new Map(); // normalized key -> { display, count, ids, variants }
  const placeOf = (p) => {
    const raw = (p.birth_place || '').trim();
    if (!raw) return null;
    const display = raw.split(',')[0].trim();
    if (!display) return null;
    const key = normalizeTextKey(display);
    return key ? { key, display } : null;
  };
  let placed = 0;
  for (const p of graph.people) {
    const pl = placeOf(p);
    if (!pl) continue;
    placed++;
    const e = trackVariant(places, pl.key, pl.display, { count: 0, ids: [] });
    e.count++;
    e.ids.push(p.id);
  }
  resolveDisplay(places);
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
  const byGen = new Map(); // gen -> Map(placeKey -> {display, count, minYear, variants})
  for (const p of graph.people) {
    const pl = placeOf(p);
    if (!pl) continue;
    const g = gen.get(p.id) ?? 0;
    if (!byGen.has(g)) byGen.set(g, new Map());
    const m = byGen.get(g);
    const e = trackVariant(m, pl.key, pl.display, { count: 0, minYear: Infinity });
    e.count++;
    const y = year(p.birth_date);
    if (y != null && y < e.minYear) e.minYear = y;
  }
  for (const m of byGen.values()) resolveDisplay(m);
  const steps = [];
  let lastKey = null;
  for (const g of [...byGen.keys()].sort((a, b) => a - b)) {
    let bestKey = null, best = null;
    for (const [key, e] of byGen.get(g)) {
      if (e.count < 2) continue;
      if (!best || e.count > best.count) { best = e; bestKey = key; }
    }
    if (!best) continue;
    // Compare by normalized key, not display text — two generations can
    // each independently pick a different spelling of the SAME merged place
    // ("Mt Gambier" one generation, "Mt. Gambier" the next) as their own
    // most-common variant; that isn't a move, and shouldn't read as one.
    if (bestKey === lastKey) continue;
    lastKey = bestKey;
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
    birthdays.push({
      id: p.id, name: p.display_name, day: d, isToday: d === today, isPast: d < today,
      turning: b != null ? thisYear - b : null,
    });
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
  if (modules.livingLink) {
    const m = modules.livingLink;
    h.livingLink = {
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
  if (modules.parenthood) {
    h.parenthood = { avg: modules.parenthood.avg, n: modules.parenthood.n };
  }
  if (modules.surnames) {
    h.topSurname = { name: modules.surnames.top[0].name, count: modules.surnames.top[0].count };
  }
  if (modules.livingGenerations) {
    h.livingGenerations = { count: modules.livingGenerations.count };
  }
  if (modules.twinBirths) {
    h.twinBirths = { count: modules.twinBirths.count };
  }
  if (modules.newArrivals) {
    h.newArrivals = { count: modules.newArrivals.count, sinceYear: modules.newArrivals.sinceYear };
  }
  if (modules.blendedFamily) {
    h.blendedFamily = { total: modules.blendedFamily.total };
  }
  if (modules.tradeLineage) {
    h.tradeLineage = { occ: modules.tradeLineage.best.occ, generations: modules.tradeLineage.best.people.length };
  }
  if (modules.centenarians) {
    h.centenarians = { count: modules.centenarians.count };
  }
  // earlyLoss is deliberately excluded here (and from highlightCandidates
  // above) — a family member's early death is a fact for the considered,
  // dedicated Insights card, not something that should surface as a casual
  // rotating "did you know" teaser or an AI-narrative aside.
  return Object.keys(h).length ? h : null;
}

/* ── Every "did you know" sentence the current tree data supports — shared by
      pickDailyHighlight (the home hub's one fixed pick per day, below) and
      IdleFactHint (the tree screen's ambient hint, which cycles through
      several per browsing session without repeats — see that component).
      livingLink needs a real viewerId to mean anything ("just 4 living
      links from..."); computeInsightModules returns it null when
      called without one (the home hub's own call site passes null, so it
      simply never contributes a candidate there — no special-casing needed
      here). strata computes fine either way — its candidate sentence below
      deliberately sticks to tree-wide counts (generations/living/remembered),
      not the viewer-specific fields (viewerLabel etc.), so it works in both
      contexts. ────────────────────────────────────────────────────────── */
/*
 * Same candidate pool as before, but each entry now carries its category
 * `key` (for the emotional-weight table and freshness tracking below) and
 * `personIds` (who the sentence is actually about, for relevance scoring) —
 * neither existed when this only had to produce plain strings for a single
 * rotating teaser. A candidate with no specific "about" person (a genuinely
 * family-wide fact like "June is the busiest birthday month") gets an empty
 * personIds array on purpose rather than a guessed representative — see
 * relevanceFor's own baseline for why that's not treated as zero relevance.
 */
export function highlightCandidatesDetailed(modules) {
  if (!modules) return [];
  const out = [];
  const add = (key, text, personIds = []) => { if (text) out.push({ key, text, personIds }); };

  if (modules.giftOfYears) {
    const g = modules.giftOfYears;
    add('giftOfYears', `Relatives born in the ${g.first.decade}s lived to ${g.first.avg} on average — those born in the ${g.last.decade}s reached ${g.last.avg}.`);
  }
  if (modules.bridges) {
    add('bridges', `${modules.bridges.firstName} is the family's bridge — the one marriage joining its two biggest branches.`, [modules.bridges.personId]);
  }
  if (modules.names) {
    const n = modules.names.top[0];
    add('names', `${n.name} is the family's most-carried name — ${n.count} people across ${modules.names.thread.present} generations.`);
  }
  if (modules.heartlands) {
    add('heartlands', `Most of the family traces back to ${modules.heartlands.places[0].display}.`);
  }
  if (modules.trades) {
    add('trades', `The family's work has shifted from ${modules.trades.firstTop} to ${modules.trades.lastTop}.`);
  }
  if (modules.birthdays) {
    add('birthdays', `${modules.birthdays.peakLabel} is the family's busiest birthday month.`);
  }
  if (modules.birthdays?.monthMate) {
    const mm = modules.birthdays.monthMate;
    add('birthdayMonthMate', `${mm.name} shares a birthday month with ${mm.others} relative${mm.others === 1 ? '' : 's'}.`, [mm.id, ...mm.mateIds]);
  }
  if (modules.records?.records?.length) {
    const r = modules.records.records[0];
    // detail alone often omits who (e.g. "1927 to 1985, the longest
    // marriage on record.") — the title carries the name, so combine them.
    add('records', `${r.title} — ${r.detail}`, [r.personId]);
  }
  if (modules.parenthood) {
    add('parenthood', `On average, people in the family became parents at ${modules.parenthood.avg}.`);
  }
  if (modules.livingLink) {
    const h = modules.livingLink;
    const earliest = h.people[0];
    add('livingLink', `Just ${h.hops} living link${h.hops === 1 ? '' : 's'} from ${earliest.firstName}, born in ${earliest.birth}.`, [earliest.id]);
  }
  if (modules.strata) {
    const s = modules.strata;
    add('strata', `The family tree spans ${s.rows.length} generations — ${s.living} living, ${s.remembered} remembered.`);
  }
  if (modules.fullestYear) {
    const p = modules.fullestYear.peak;
    add('fullestYear', `${p.count} family members were alive at the same time in ${p.year} — the fullest year on record.`);
  }
  if (modules.brood?.record) {
    const r = modules.brood.record;
    add('brood', `${r.parentNames.join(' & ')} raised the family's biggest household — ${r.count} children${r.span ? ` between ${r.span}` : ''}.`, r.parentIds);
  }
  if (modules.serviceRecords) {
    const sr = modules.serviceRecords;
    add('serviceRecords', `${sr.count} family member${sr.count === 1 ? ' has' : 's have'} a documented military service record, spanning ${sr.generationsSpanned} generation${sr.generationsSpanned === 1 ? '' : 's'}.`);
  }
  if (modules.surnames) {
    const s = modules.surnames.top[0];
    add('surnames', `${s.count} people in the family carry the ${s.name} name.`);
  }
  if (modules.livingGenerations) {
    add('livingGenerations', `${modules.livingGenerations.count} generations of the family are alive together right now.`);
  }
  if (modules.twinBirths?.sets?.length) {
    const t = modules.twinBirths.sets[0];
    add('twinBirths', `The family has twins — born ${t.dateLabel} ${t.year}.`, t.ids);
  }
  if (modules.newArrivals) {
    add('newArrivals', `${modules.newArrivals.count} new arrivals have joined the family since ${modules.newArrivals.sinceYear}.`);
  }
  if (modules.blendedFamily) {
    add('blendedFamily', `${modules.blendedFamily.total} people in the family are connected by a step or adoptive bond.`);
  }
  if (modules.tradeLineage) {
    const c = modules.tradeLineage.best;
    add('tradeLineage', `${c.occ} has been passed down through ${c.people.length} generations of the family.`, c.people.map((p) => p.id));
  }
  if (modules.centenarians) {
    add('centenarians', `${modules.centenarians.count} family member${modules.centenarians.count === 1 ? ' has' : 's have'} lived to see 100.`);
  }
  if (modules.missingRecords?.missingPhotos) {
    const m = modules.missingRecords.missingPhotos;
    add('missingRecords', `You still have ${m.count} relative${m.count === 1 ? '' : 's'} missing a photograph.`);
  }
  if (modules.missingRecords?.unknownParentAncestors) {
    const u = modules.missingRecords.unknownParentAncestors;
    add('missingRecords', `${u.count} direct ancestor${u.count === 1 ? ' has' : 's have'} unknown parents — a brick wall waiting to be explored.`, u.ids);
  }
  if (modules.sameAgeMarriages) {
    const p = modules.sameAgeMarriages.pairs[0];
    add('sameAgeMarriages', `${p.aName} and ${p.bName} both married for the first time at ${p.age}.`, [p.aId, p.bId]);
  }
  if (modules.closestCousinsByAge) {
    const c = modules.closestCousinsByAge;
    add('closestCousinsByAge', `${c.cousinName} is your children's closest cousin by age — just ${c.gapYears} year${c.gapYears === 1 ? '' : 's'} apart from ${c.kidName}.`, [c.kidId, c.cousinId]);
  }
  if (modules.sharedBirthplaceGenerations) {
    const s = modules.sharedBirthplaceGenerations;
    add('sharedBirthplaceGenerations', `${s.generations} generations of the family were born in ${s.display}.`, s.ids);
  }
  if (modules.nearbyRelatives) {
    const n = modules.nearbyRelatives;
    add('nearbyRelatives', `You and ${n.name} live only ${n.km} km apart.`, [n.id]);
  }
  if (modules.forgottenPeople) {
    const f = modules.forgottenPeople;
    const years = Math.floor(f.ageDays / 365);
    const when = years >= 2 ? `${years} years` : 'over a year';
    add('forgottenPeople', `You haven't viewed ${f.name}'s profile in ${when}.`, [f.id]);
  }
  return out;
}

// Byte-identical to the old inline implementation — every existing caller
// (the home hub's rotating teaser, buildInsightHighlights below) keeps
// working unchanged; this is now just a thin projection.
export function highlightCandidates(modules) {
  return highlightCandidatesDetailed(modules).map((c) => c.text);
}

/*
 * Slice 1 of the Family Moments engine (docs/FAMILY-MOMENTS.md) — a
 * deterministic scorer, not a learned one: relevance (how close the viewer
 * is to who the candidate is actually about) + a fixed per-category
 * emotional-value weight + a freshness penalty for whatever was shown
 * recently. No engagement history feeds this yet (see Slice 6) — there's
 * nothing to learn from before real usage exists, so this is intentionally
 * a tunable formula, not a placeholder for one.
 *
 * livingLink's weight was deliberately lowered (real feedback: the
 * category read as more "tree-centric" trivia than personal, even once
 * reworded/renamed from "handshakes" — see livingLink()'s own header
 * comment) — it still computes and still appears in the full Insights
 * sheet, it just rarely wins the always-on banner / idle-hint slot now.
 */
const EMOTIONAL_WEIGHT = {
  giftOfYears: 5, bridges: 6, names: 4, heartlands: 5, trades: 4,
  birthdays: 5, records: 8, parenthood: 5, livingLink: 3, strata: 4,
  fullestYear: 6, brood: 6, serviceRecords: 7, surnames: 4,
  livingGenerations: 6, twinBirths: 8, newArrivals: 7, blendedFamily: 6,
  tradeLineage: 5, centenarians: 9,
  missingRecords: 6, sameAgeMarriages: 7,
  birthdayMonthMate: 6, closestCousinsByAge: 8, sharedBirthplaceGenerations: 5,
  nearbyRelatives: 7,
  forgottenPeople: 6,
};
const DEFAULT_EMOTIONAL_WEIGHT = 3;
// A candidate with no specific "about" person (a genuinely family-wide fact)
// is still relevant to everyone — this is its baseline, not a penalty for
// lacking personIds. Kept below the closest-possible personal relevance (a
// sibling or child, 1 hop, scores 5) so a real personal moment still wins a
// tie against a generic family-wide one, matching the whole point of this
// engine.
const FAMILY_WIDE_RELEVANCE = 2;
const FRESHNESS_PENALTY = 4;

function relevanceFor(personIds, distances) {
  if (!personIds?.length || !distances) return FAMILY_WIDE_RELEVANCE;
  let min = Infinity;
  for (const id of personIds) {
    const d = distances.get(id);
    if (d != null && d < min) min = d;
  }
  if (!Number.isFinite(min)) return FAMILY_WIDE_RELEVANCE;
  return Math.max(0, 6 - min); // 6+ hops away -> 0; the viewer themself -> 6
}

/*
 * `distances` (optional): a Map from graph.js's distancesFrom(graph,
 * viewerId), precomputed once per scoring pass rather than per candidate —
 * pass it in, don't recompute here. Omitted (no viewer, e.g. the Home hub
 * with nobody logged in) falls every candidate back to the family-wide
 * baseline, same as today's behavior.
 * `recentKeys` (optional): a Set of category keys shown recently on this
 * device — purely a lookup here; where that history is stored (localStorage,
 * how many days back) is a UI-layer concern, not this pure module's.
 */
export function scoreCandidate(candidate, { distances = null, recentKeys = null } = {}) {
  const relevance = relevanceFor(candidate.personIds, distances);
  const emotional = EMOTIONAL_WEIGHT[candidate.key] ?? DEFAULT_EMOTIONAL_WEIGHT;
  const freshnessPenalty = recentKeys?.has(candidate.key) ? FRESHNESS_PENALTY : 0;
  return relevance + emotional - freshnessPenalty;
}

// Highest score first. Ties broken by the same day-seeded shuffle every
// other per-day rotation in this file already uses, so a tie doesn't always
// favor whichever module happened to be evaluated first, but never
// reshuffles mid-session either.
export function rankCandidates(candidates, { distances = null, recentKeys = null, now = Date.now() } = {}) {
  const shuffled = seededShuffle(candidates, dayIndex(now));
  return shuffled
    .map((c) => ({ ...c, score: scoreCandidate(c, { distances, recentKeys }) }))
    .sort((a, b) => b.score - a.score);
}

/* ── The home hub's "did you know" teaser: one fact, rotated daily, that taps
      through to the full Insights sheet. Deliberately stable within a day
      (and across the hub's own re-renders, which happen on every tree edit)
      rather than random — see IdleFactHint for the browsing-session variant
      that DOES want a fresh pick each time. ─────────────────────────────── */
export function pickDailyHighlight(modules) {
  const candidates = highlightCandidates(modules);
  if (!candidates.length) return null;
  const day = Math.floor(Date.now() / 86400000);
  return candidates[day % candidates.length];
}

// A single fact about ONE person, for the moment they're front and centre —
// the tree screen's "quiet" insight (see the nameplate), vs. pickDailyHighlight's
// family-wide one for the idle stats pill. Deliberately silent (returns null)
// far more often than not: most people don't hold a record or share a
// birthday with anyone, and a generic filler line would cheapen the ones that
// are real. Checked cheapest-first — twins and records are just a lookup in
// data `modules` already computed once for the sheet; livingLinkTo is the
// only on-demand call, and only reached when the cheaper checks miss.
export function personHighlight(graph, viewerId, personId, modules) {
  if (!graph || !personId || personId === viewerId) return null;

  const twin = modules?.birthdays?.twins?.find((t) => t.aId === personId || t.bId === personId);
  if (twin) {
    const otherName = twin.aId === personId ? twin.bName : twin.aName;
    return `Shares a birthday with ${otherName} — both ${twin.dateLabel}.`;
  }

  const rec = modules?.records?.pool?.find((r) => r.personId === personId);
  if (rec) return rec.title;

  // Only worth surfacing once it's a real chain of a few hops — "1 living
  // link from your own parent" isn't a fact, it's a relationship you
  // already know.
  const hs = livingLinkTo(graph, viewerId, personId);
  if (hs && hs.hops >= 2) {
    return `You're ${hs.hops} living link${hs.hops === 1 ? '' : 's'} from ${firstNameOf(graph.byId.get(personId))} — back to ${hs.earliestBirth}.`;
  }

  return null;
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

  // Family Moments slice 2: per-person "shares a birthday month with N
  // relatives" — distinct from peakMonth above (a family-wide aggregate,
  // not necessarily anyone's own experience of it). Whoever has the most
  // OTHER people sharing their own birth month wins, regardless of which
  // month that is.
  let monthMate = null;
  for (let m = 0; m < 12; m++) {
    const list = monthPeople[m];
    if (list.length < 4) continue; // need the person + at least 3 others
    for (const entry of list) {
      const others = list.length - 1;
      if (!monthMate || others > monthMate.others) {
        monthMate = {
          id: entry.id, name: firstNameOf(graph.byId.get(entry.id)), others,
          mateIds: list.filter((x) => x.id !== entry.id).map((x) => x.id),
        };
      }
    }
  }

  return {
    months,
    monthPeople,
    sharedDays,
    peakMonth,
    peakCount: months[peakMonth],
    peakLabel: MONTHS[peakMonth],
    twins: twins.slice(0, 2),
    withMonth,
    monthMate,
  };
}

/* ── Surnames: the family names carried forward — the given-name hall of
      fame above, mirrored onto surnames. No generational "thread" (unlike
      names() a surname is continuous by definition down a bloodline, so it
      wouldn't say anything new) — just who carries which name, ranked. ──── */
function surnames(graph) {
  const freq = new Map(); // lowercased surname -> { name, count, people: [{id}] }
  for (const p of graph.people) {
    const s = surnameOf(p);
    if (!s) continue;
    const key = s.toLowerCase();
    if (!freq.has(key)) freq.set(key, { name: s, count: 0, people: [] });
    const e = freq.get(key);
    e.count++;
    e.people.push({ id: p.id });
  }
  const byBirth = (a, b) =>
    (year(graph.byId.get(a.id)?.birth_date) ?? 9999) - (year(graph.byId.get(b.id)?.birth_date) ?? 9999);
  const all = [...freq.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .map((e) => ({ name: e.name, count: e.count, people: e.people.slice().sort(byBirth) }));
  const top = all.filter((e) => e.count >= 3).slice(0, 5);
  if (top.length < 2) return null;
  return { top, all };
}

/* ── Living generations: how many generations of the family are alive
      together RIGHT NOW — a cross-section of strata's all-time totals,
      narrowed to just who's here today. ─────────────────────────────────── */
function livingGenerations(graph, gen) {
  const byGen = new Map();
  for (const p of graph.people) {
    if (p.is_deceased) continue;
    const g = gen.get(p.id) ?? 0;
    if (!byGen.has(g)) byGen.set(g, []);
    byGen.get(g).push(p.id);
  }
  if (byGen.size < 3) return null;
  const byBirth = (a, b) =>
    (year(graph.byId.get(a)?.birth_date) ?? 9999) - (year(graph.byId.get(b)?.birth_date) ?? 9999);
  const rows = [...byGen.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([g, ids], i) => ({ gen: g, label: `G${i + 1}`, ids: ids.slice().sort(byBirth), count: ids.length }));
  return { rows, count: rows.length, total: rows.reduce((s, r) => s + r.count, 0) };
}

/* ── Twin births: siblings sharing the exact same recorded birth date — real
      multiples, not birthdays()'s "same day, different year" birthday twins.
      Goes through birthMonthOf/birthDayOf so the January-1st "year only
      known" placeholder never counts as a shared date. ────────────────────── */
function twinBirths(graph) {
  const households = new Map(); // parent-set key -> [people]
  for (const p of graph.people) {
    const parents = graph.parents(p.id).filter((x) => isBioAdopt(x.qualifier));
    if (!parents.length) continue;
    const key = parents.map((x) => x.id).sort().join('|');
    if (!households.has(key)) households.set(key, []);
    households.get(key).push(p);
  }
  const sets = [];
  for (const kids of households.values()) {
    const byDate = new Map();
    for (const k of kids) {
      if (birthMonthOf(k.birth_date) == null || birthDayOf(k.birth_date) == null) continue;
      if (!byDate.has(k.birth_date)) byDate.set(k.birth_date, []);
      byDate.get(k.birth_date).push(k);
    }
    for (const [d, group] of byDate) {
      if (group.length < 2) continue;
      sets.push({
        date: d,
        year: year(d),
        dateLabel: `${birthDayOf(d)} ${MONTHS[birthMonthOf(d) - 1]}`,
        ids: group.map((p) => p.id),
      });
    }
  }
  if (!sets.length) return null;
  sets.sort((a, b) => b.ids.length - a.ids.length || b.year - a.year);
  return { sets, count: sets.length, peopleCount: sets.reduce((s, x) => s + x.ids.length, 0) };
}

/* ── Young lives remembered: family members who didn't live to see their
      twentieth year. Deliberately no minimum-count gate beyond "at least
      one" — like serviceRecords above, this is remembrance, not a
      statistical pattern, and a single life is already meaningful. Sorted
      youngest first: the most poignant fact leads, not an arbitrary one. ─── */
function earlyLoss(graph) {
  const list = [];
  for (const p of graph.people) {
    if (!p.is_deceased) continue;
    const age = yearsBetween(p.birth_date, p.death_date);
    if (age == null || age < 0 || age >= 20) continue;
    list.push({ id: p.id, age, birth: year(p.birth_date), death: year(p.death_date) });
  }
  if (!list.length) return null;
  list.sort((a, b) => a.age - b.age || (a.death ?? 9999) - (b.death ?? 9999));
  return { list, count: list.length, youngest: list[0] };
}

/* ── Centenarians: family members who reached (or, still living, are past)
      100 years old. Also gated at "at least one" — reaching 100 is rare
      enough that a single instance is already the whole story, same
      reasoning as earlyLoss above. A living centenarian's age is measured
      to `now` (injectable for tests), not frozen at whatever their last
      recorded birthday was. ─────────────────────────────────────────────── */
function centenarians(graph, now = Date.now()) {
  const todayStr = new Date(now).toISOString().slice(0, 10);
  const list = [];
  for (const p of graph.people) {
    const age = p.is_deceased ? yearsBetween(p.birth_date, p.death_date) : yearsBetween(p.birth_date, todayStr);
    if (age == null || age < 100 || age > 130) continue; // >130 is bad data, not a supercentenarian
    list.push({ id: p.id, age, birth: year(p.birth_date), death: p.is_deceased ? year(p.death_date) : null, living: !p.is_deceased });
  }
  if (!list.length) return null;
  list.sort((a, b) => b.age - a.age);
  return { list, count: list.length, oldest: list[0] };
}

/* ── The newest arrivals: family members born in the last five years — the
      family's own growing edge, not just its deep past. ────────────────────── */
function newArrivals(graph, now = Date.now()) {
  const thisYear = new Date(now).getFullYear();
  const cutoff = thisYear - 5;
  const list = [];
  for (const p of graph.people) {
    if (p.is_deceased) continue;
    const b = year(p.birth_date);
    if (b == null || b < cutoff || b > thisYear) continue;
    list.push({ id: p.id, year: b });
  }
  if (list.length < 2) return null;
  list.sort((a, b) => b.year - a.year);
  return { list, count: list.length, sinceYear: cutoff, thisYear };
}

/* ── The shapes of the family: how many step and adoptive bonds hold it
      together — celebrating the family beyond blood, not just counting it. ── */
function blendedFamily(graph) {
  let stepCount = 0, adoptCount = 0;
  const stepPeople = new Set(), adoptPeople = new Set();
  for (const r of graph.relationships) {
    if (r.type !== 'parent') continue;
    if (r.qualifier === 'step') { stepCount++; stepPeople.add(r.to_person); }
    else if (r.qualifier === 'adoptive') { adoptCount++; adoptPeople.add(r.to_person); }
  }
  const allIds = new Set([...stepPeople, ...adoptPeople]);
  if (allIds.size < 3) return null;
  return { stepCount, adoptCount, stepIds: [...stepPeople], adoptIds: [...adoptPeople], total: allIds.size };
}

/* ── Trade lineage: an occupation passed straight down a real parent→child
      line for three generations or more — continuity of work, distinct from
      trades()'s "most common job of the era" bands above. ─────────────────── */
function tradeLineage(graph) {
  const chains = [];
  for (const p of graph.people) {
    const occ = (p.occupation || '').trim();
    if (!occ) continue;
    const key = normalizeTextKey(occ);
    if (!key) continue;
    const chain = [{ id: p.id, occ }];
    let cur = p;
    while (true) {
      const parents = graph.parents(cur.id).filter((x) => isBioAdopt(x.qualifier));
      let matched = null;
      for (const par of parents) {
        const pp = graph.byId.get(par.id);
        if (pp && normalizeTextKey((pp.occupation || '').trim()) === key) { matched = pp; break; }
      }
      if (!matched) break;
      chain.push({ id: matched.id, occ: matched.occupation });
      cur = matched;
    }
    if (chain.length >= 3) {
      // The chain's own most-common raw spelling, not whichever variant the
      // starting (youngest) person happened to type — same "merge punctuation
      // variants, show the common form" convention as trades()/heartlands().
      const variants = new Map();
      for (const person of chain) variants.set(person.occ, (variants.get(person.occ) || 0) + 1);
      let display = occ, best = -1;
      for (const [v, n] of variants) if (n > best) { display = v; best = n; }
      chains.push({ occ: display, key, people: chain });
    }
  }
  if (!chains.length) return null;
  chains.sort((a, b) => b.people.length - a.people.length);
  const seenTop = new Set();
  const uniq = [];
  for (const c of chains) {
    const topId = c.people[c.people.length - 1].id;
    const dupKey = `${c.key}|${topId}`;
    if (seenTop.has(dupKey)) continue;
    seenTop.add(dupKey);
    uniq.push(c);
  }
  return { chains: uniq.slice(0, 5), best: uniq[0] };
}

/* ── Family Moments slice 2: Records & Discoveries — completeness gaps ─────
   Not a superlative like records() above (nobody "holds" a missing photo) —
   an invitation to fill in what's not there yet. missingPhotos is family-
   wide (every recorded person, living or deceased); unknownParentAncestors
   is scoped to the VIEWER's own direct ancestor line specifically (walking
   graph.parents() up to a generous depth), matching the vision brief's own
   framing ("Three DIRECT ancestors have unknown parents") — a random
   unrelated branch's brick wall isn't a personal discovery for this viewer,
   their own is. Returns null for a field with nothing to report rather than
   the whole module returning null, since either half can be independently
   true — a family with everyone photographed but three real brick walls
   should still surface the ancestor gap, and vice versa. */
const ANCESTOR_WALL_DEPTH = 8; // generations — generous; a real family tree rarely runs deeper than this in practice
function missingRecords(graph, viewerId) {
  const missingPhotoIds = graph.people.filter((p) => !p.photo).map((p) => p.id);

  let unknownParentAncestors = null;
  if (viewerId != null && graph.byId.has(viewerId)) {
    const ancestorIds = new Set();
    const stack = [{ id: viewerId, depth: 0 }];
    const seen = new Set([viewerId]);
    while (stack.length) {
      const { id, depth } = stack.pop();
      if (depth >= ANCESTOR_WALL_DEPTH) continue;
      for (const par of graph.parents(id)) {
        if (par.qualifier === 'step' || seen.has(par.id)) continue;
        seen.add(par.id);
        ancestorIds.add(par.id);
        stack.push({ id: par.id, depth: depth + 1 });
      }
    }
    const walls = [...ancestorIds].filter((id) => graph.parents(id).length === 0);
    if (walls.length) unknownParentAncestors = { count: walls.length, ids: walls };
  }

  if (!missingPhotoIds.length && !unknownParentAncestors) return null;
  return {
    missingPhotos: missingPhotoIds.length ? { count: missingPhotoIds.length, ids: missingPhotoIds } : null,
    unknownParentAncestors,
  };
}

/* ── Family Moments slice 2: Family Connections — married at the same age ──
   Pairs of people (any relation, not just the viewer) who married for the
   first time at the exact same age — "You and your uncle both married at
   29." Only the FIRST marriage counts (earliest marriage_date) per person,
   so someone's second marriage doesn't create a false echo of their own
   first. Needs both people's birth_date and marriage_date to compute an
   age, so this stays silent rather than guessing wherever either is
   missing — same "never invents, never half-renders" rule every other
   module here follows. */
function sameAgeMarriages(graph) {
  const firstMarriageAge = new Map(); // personId -> { age, date }
  for (const r of graph.relationships) {
    if (r.type !== 'partner' || !r.marriage_date) continue;
    for (const personId of [r.from_person, r.to_person]) {
      const person = graph.byId.get(personId);
      const age = yearsBetween(person?.birth_date, r.marriage_date);
      if (age == null) continue;
      const existing = firstMarriageAge.get(personId);
      if (!existing || r.marriage_date < existing.date) firstMarriageAge.set(personId, { age, date: r.marriage_date });
    }
  }
  const byAge = new Map(); // age -> [personId, ...]
  for (const [personId, { age }] of firstMarriageAge) {
    if (!byAge.has(age)) byAge.set(age, []);
    byAge.get(age).push(personId);
  }
  const pairs = [];
  for (const [age, ids] of byAge) {
    if (ids.length < 2) continue;
    // One pair per age bucket, oldest-recorded-birth-date-first for a
    // stable, deterministic pick rather than insertion order.
    const sorted = ids.slice().sort((a, b) => (graph.byId.get(a)?.birth_date || '') < (graph.byId.get(b)?.birth_date || '') ? -1 : 1);
    const [aId, bId] = sorted;
    pairs.push({ age, aId, bId, aName: firstNameOf(graph.byId.get(aId)), bName: firstNameOf(graph.byId.get(bId)) });
  }
  if (!pairs.length) return null;
  pairs.sort((a, b) => a.age - b.age);
  return { pairs };
}

/* ── Family Moments slice 2: Family Connections — closest cousin by age ────
   Viewer-specific by design, unlike every other module in this file —
   "Sarah is your children's closest cousin by age" is inherently about the
   viewer's own children and their first cousins (their aunts'/uncles' kids
   — i.e. the viewer's own nieces/nephews), not a family-wide search for the
   single tightest cousin pair anywhere in the tree. Silent whenever there's
   no viewer, the viewer has no children of their own yet, or none of their
   siblings do either — no family-wide fallback invented for those cases,
   since the fact stops meaning what it says the moment it's not about the
   viewer's own kids. Step-siblings' children are excluded — a step-cousin
   isn't a blood first cousin. */
function closestCousinsByAge(graph, viewerId) {
  if (viewerId == null || !graph.byId.has(viewerId)) return null;
  const myKids = graph.children(viewerId);
  if (!myKids.length) return null;
  const nieceNephews = graph.siblings(viewerId)
    .filter((s) => s.kind !== 'step')
    .flatMap((s) => graph.children(s.id));
  if (!nieceNephews.length) return null;

  let best = null;
  for (const kid of myKids) {
    const kidYear = year(graph.byId.get(kid.id)?.birth_date);
    if (kidYear == null) continue;
    for (const cousin of nieceNephews) {
      const cousinYear = year(graph.byId.get(cousin.id)?.birth_date);
      if (cousinYear == null) continue;
      const gapYears = Math.abs(kidYear - cousinYear);
      if (!best || gapYears < best.gapYears) {
        best = {
          kidId: kid.id, kidName: firstNameOf(graph.byId.get(kid.id)),
          cousinId: cousin.id, cousinName: firstNameOf(graph.byId.get(cousin.id)),
          gapYears,
        };
      }
    }
  }
  return best;
}

/* ── Family Moments slice 2: Shared History — generations born in the same
      place ─────────────────────────────────────────────────────────────
   Distinct from heartlands() above (the family's dominant ORIGIN and how
   it's shifted over time, an aggregate migration trend) — this counts how
   many separate GENERATIONS share an exact birthplace, the more personal
   "three generations were born in the same hospital" kind of fact. Merges
   punctuation-only spelling variants the same way heartlands()/trades() do
   ("Mt. Gambier" / "Mt Gambier"), showing whichever spelling is more common
   among the qualifying group. */
function sharedBirthplaceGenerations(graph, gen) {
  const byPlace = new Map(); // normalized key -> { variants: Map<display,count>, gens: Set, ids: [] }
  for (const p of graph.people) {
    const place = (p.birth_place || '').trim();
    if (!place) continue;
    const key = normalizeTextKey(place);
    if (!key) continue;
    if (!byPlace.has(key)) byPlace.set(key, { variants: new Map(), gens: new Set(), ids: [] });
    const e = byPlace.get(key);
    e.variants.set(place, (e.variants.get(place) || 0) + 1);
    e.gens.add(gen.get(p.id) ?? 0);
    e.ids.push(p.id);
  }
  const qualifying = [...byPlace.values()].filter((e) => e.gens.size >= 3);
  if (!qualifying.length) return null;
  qualifying.sort((a, b) => b.gens.size - a.gens.size || b.ids.length - a.ids.length);
  const best = qualifying[0];
  let display = null, bestCount = -1;
  for (const [v, count] of best.variants) if (count > bestCount) { display = v; bestCount = count; }
  return { display, generations: best.gens.size, ids: best.ids };
}

/* ── Family Moments slice 3: Geography — how close two living relatives
      actually are ──────────────────────────────────────────────────────
   Distance math is pure (lib/geo.js's haversineKm); the place -> coordinate
   resolution itself happens server-side (functions/_lib/geocode.js, a
   Nominatim proxy with a D1 cache) and is passed in already resolved via
   `geocodedByPlace` — this file makes no network calls. Only LIVING people
   with a recorded `residence` are considered — a present-tense "you live
   near" fact, not about where someone was born or died. Gated to a
   genuinely close NEARBY_MAX_KM so this never surfaces "your closest
   living relative happens to be 3000km away" framed as if it were a warm
   proximity fact — that reads as a non sequitur, not a discovery. */
const NEARBY_MAX_KM = 100;
function nearbyRelatives(graph, viewerId, geocodedByPlace) {
  if (viewerId == null || !geocodedByPlace) return null;
  const viewer = graph.byId.get(viewerId);
  if (!viewer || viewer.is_deceased || !viewer.residence) return null;
  const viewerCoords = geocodedByPlace[viewer.residence];
  if (!viewerCoords) return null;

  let best = null;
  for (const p of graph.people) {
    if (p.id === viewerId || p.is_deceased || !p.residence) continue;
    const coords = geocodedByPlace[p.residence];
    if (!coords) continue;
    const km = haversineKm(viewerCoords, coords);
    if (km == null || km > NEARBY_MAX_KM) continue;
    if (!best || km < best.km) best = { id: p.id, name: firstNameOf(p), km };
  }
  if (!best) return null;
  return { id: best.id, name: best.name, km: formatKm(best.km) };
}

/* ── Family Moments slice 4: Forgotten people — "you haven't viewed X's
      profile in over a year" ────────────────────────────────────────────
   `lastViewedByPersonId` is resolved server-side (functions/_lib/
   profileViews.js) and passed in already fetched — this file makes no
   network calls. Deliberately only surfaces someone who HAS been viewed at
   least once before (a real entry exists in the map) — "you haven't
   looked in a year" is a nudge back to something you used to check on;
   "you've never looked at all" is a different, less accusatory kind of
   prompt this module doesn't attempt. Scoped to the viewer's own relatives
   within a reasonable relational distance (distancesFrom, same BFS
   scoreCandidate's relevance uses) — a person the viewer has no real
   connection to isn't a "forgotten" relative, and a stale personId no
   longer in the tree at all (removed since it was last viewed) is simply
   skipped, not treated as an error. */
const FORGOTTEN_MIN_DAYS = 365;
const FORGOTTEN_MAX_HOPS = 6;
function forgottenPeople(graph, viewerId, lastViewedByPersonId, now = Date.now()) {
  if (viewerId == null || !lastViewedByPersonId || !graph.byId.has(viewerId)) return null;
  const distances = distancesFrom(graph, viewerId);
  const nowSeconds = Math.floor(now / 1000);
  const minAgeSeconds = FORGOTTEN_MIN_DAYS * 86400;

  let oldest = null;
  for (const [personId, viewedAt] of Object.entries(lastViewedByPersonId)) {
    if (personId === viewerId) continue;
    const p = graph.byId.get(personId);
    if (!p) continue; // stale entry — a person since removed from the tree
    const hops = distances.get(personId);
    if (hops == null || hops > FORGOTTEN_MAX_HOPS) continue;
    const ageSeconds = nowSeconds - viewedAt;
    if (ageSeconds < minAgeSeconds) continue;
    if (!oldest || ageSeconds > oldest.ageSeconds) {
      oldest = { id: personId, name: firstNameOf(p), ageDays: Math.floor(ageSeconds / 86400) };
    }
  }
  return oldest;
}

/*
 * Family Moments slice 5 — the always-on banner's picks. A genuine TODAY
 * birthday or wedding anniversary is the single most specific, unambiguous,
 * highest-emotional-value thing that can be true about "today" — no
 * scoring engine is needed to know that. Returns EVERY one of them (not
 * just the first found), since a family can easily have more than one
 * birthday on the same day — the banner rolls through the whole list,
 * odometer-style, rather than picking a single "winner" and silently
 * dropping the rest.
 *
 * Deliberately no trivia/scored fallback (this function used to fall back
 * to the full highlightCandidatesDetailed/rankCandidates pool when nothing
 * was happening today — real feedback was that a generic tree-wide fact
 * showing up in this birthday-shaped slot read as an ad, not a moment, so
 * it's gone). On a day with no real birthday or anniversary, this simply
 * returns null and the banner doesn't appear — trivia stays exclusively in
 * the Home hub's own rotating "did you know" card (pickDailyHighlight) and
 * the tree screen's idle hint (highlightCandidates), both unaffected.
 *
 * Distinct from pickDailyHighlight (the Home hub's own fixed-once-per-
 * calendar-day teaser, which never checks for a real birthday at all) —
 * this is the richer selection built for the proactive banner, but it now
 * derives everything from computeThisMonth alone — cheap and synchronous,
 * no viewer, no precomputed modules, no scoring inputs needed.
 *
 * Known, disclosed gap: computeThisMonth only considers LIVING people for
 * birthdays (deceased relatives are excluded there, not here), so "your
 * grandfather would have turned 102 today" from the original brief isn't
 * currently reachable — would need computeThisMonth itself extended, a
 * separate, deliberate decision given how differently that reads from a
 * living person's birthday.
 */
export function pickTodaysFamilyMoment(graph, now) {
  // computeThisMonth (unlike every other function in this file) takes a
  // real Date object, not a numeric timestamp — `now` here follows this
  // file's own now=Date.now() convention, so it needs converting.
  const month = computeThisMonth(graph, new Date(now));
  if (!month) return null;
  const moments = [];
  for (const b of month.birthdays) {
    if (!b.isToday) continue;
    moments.push({
      key: 'birthdayToday',
      personId: b.id,
      text: b.turning != null
        ? `It's ${b.name}'s birthday today — turning ${b.turning}.`
        : `It's ${b.name}'s birthday today.`,
    });
  }
  for (const a of month.anniversaries) {
    if (!a.isToday) continue;
    moments.push({
      key: 'anniversaryToday',
      personId: a.aId,
      text: a.years > 0
        ? `Today marks ${a.years} years since ${a.aName} and ${a.bName} married.`
        : `${a.aName} and ${a.bName} married today.`,
    });
  }
  return moments.length ? moments : null;
}

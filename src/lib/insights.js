import { distancesFrom, relationLabel } from '../data/graph.js';

/*
 * Tree Insights — layer 1: computed, instant, private.
 *
 * computeInsights(graph, viewerId) returns:
 *   {
 *     viewer:   { id, name, firstName },
 *     facts:    [ { key, icon, title, detail, personId? } ],   // perspective insights
 *     nudges:   [ { key, label, total, people: [{id,name}], all: [{id,name}] } ], // actionable gaps —
 *               people is the 4-wide chip preview, all is everyone (for the "+N more" drill-down)
 *     aggregates: { ... }                                       // privacy-safe, for the AI narrative
 *   }
 *
 * Everything degrades gracefully: a fact is omitted (never guessed) when the
 * underlying data is missing. Nothing here touches the network.
 */

const year = (d) => {
  if (!d) return null;
  const m = String(d).match(/\d{4}/);
  return m ? parseInt(m[0], 10) : null;
};
const firstNameOf = (p) => (p?.display_name || '').trim().split(/\s+/)[0] || '';
const surnameOf = (p) => {
  const parts = (p?.display_name || '').trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : '';
};

// Longest chain length following a relation accessor (parents or children).
function chainDepth(graph, startId, accessor) {
  let depth = 0;
  let frontier = [startId];
  const seen = new Set([startId]);
  while (frontier.length) {
    const next = [];
    for (const id of frontier) {
      for (const x of accessor(id)) {
        if (seen.has(x.id)) continue;
        seen.add(x.id);
        next.push(x.id);
      }
    }
    if (next.length) depth++;
    frontier = next;
  }
  return depth;
}

export function computeInsights(graph, viewerId) {
  const people = graph.people || [];
  const byId = graph.byId;
  const viewer = byId.get(viewerId) || people[0] || null;
  const vid = viewer?.id ?? null;
  const thisYear = new Date().getFullYear();

  const facts = [];
  const pushFact = (f) => { if (f) facts.push(f); };

  // ── Reachability from the viewer ────────────────────────────────────────
  const dist = vid ? distancesFrom(graph, vid) : new Map();
  const connectedIds = [...dist.keys()];
  const connected = connectedIds.map((id) => byId.get(id)).filter(Boolean);
  const livingConnected = connected.filter((p) => !p.is_deceased && p.id !== vid);

  // ── Your generations (above & below the viewer) ─────────────────────────
  const genUp = vid ? chainDepth(graph, vid, (id) => graph.parents(id)) : 0;
  const genDown = vid ? chainDepth(graph, vid, (id) => graph.children(id)) : 0;
  if (vid && (genUp || genDown)) {
    const span = genUp + genDown + 1;
    pushFact({
      key: 'generations',
      icon: 'layers',
      title: `${span} generations around you`,
      detail: `${genUp} above${genDown ? ` and ${genDown} below` : ''} — you sit in the middle of the story.`,
    });
  }

  // ── Your line: earliest direct ancestor up the parent chain ─────────────
  if (vid) {
    const ancestors = [];
    const seen = new Set([vid]);
    let frontier = [{ id: vid, up: 0 }];
    while (frontier.length) {
      const next = [];
      for (const { id, up } of frontier) {
        for (const par of graph.parents(id)) {
          if (seen.has(par.id)) continue;
          seen.add(par.id);
          next.push({ id: par.id, up: up + 1 });
          ancestors.push({ id: par.id, up: up + 1 });
        }
      }
      frontier = next;
    }
    // Prefer the ancestor with the earliest known birth year; else the deepest.
    let earliest = null;
    for (const a of ancestors) {
      const p = byId.get(a.id);
      const y = year(p?.birth_date);
      if (!earliest) { earliest = { ...a, y }; continue; }
      if (y != null && (earliest.y == null || y < earliest.y)) earliest = { ...a, y };
      else if (y == null && earliest.y == null && a.up > earliest.up) earliest = { ...a, y };
    }
    if (earliest) {
      const p = byId.get(earliest.id);
      pushFact({
        key: 'line',
        icon: 'roots',
        title: `Your line reaches back to ${p.display_name}`,
        detail: earliest.y
          ? `Born ${earliest.y} — ${earliest.up} generation${earliest.up === 1 ? '' : 's'} above you.`
          : `${earliest.up} generation${earliest.up === 1 ? '' : 's'} above you.`,
        personId: earliest.id,
      });
    }
  }

  // ── Your circle ─────────────────────────────────────────────────────────
  if (vid && connected.length > 1) {
    pushFact({
      key: 'circle',
      icon: 'people',
      title: `${connected.length - 1} relatives connect to you`,
      detail: `${livingConnected.length} living across the family.`,
    });
  }

  // ── Cousins ─────────────────────────────────────────────────────────────
  if (vid) {
    let cousins = 0;
    for (const p of connected) {
      if (p.id === vid) continue;
      if (/cousin/i.test(relationLabel(graph, vid, p.id))) cousins++;
    }
    if (cousins > 0) {
      pushFact({
        key: 'cousins',
        icon: 'people',
        title: `${cousins} cousin${cousins === 1 ? '' : 's'} in your tree`,
        detail: 'The wider family fanning out from your grandparents.',
      });
    }
  }

  // ── The heart of the tree: most-connected person ────────────────────────
  {
    let best = null, bestDeg = -1;
    for (const p of people) {
      const deg = graph.parents(p.id).length + graph.children(p.id).length + graph.partners(p.id).length;
      if (deg > bestDeg) { bestDeg = deg; best = p; }
    }
    if (best && bestDeg >= 3) {
      pushFact({
        key: 'heart',
        icon: 'heart',
        title: `${best.display_name} is the heart of your tree`,
        detail: `Directly connected to ${bestDeg} relatives.`,
        personId: best.id,
      });
    }
  }

  // ── Longest life ────────────────────────────────────────────────────────
  {
    let best = null, span = -1;
    for (const p of people) {
      const b = year(p.birth_date), d = year(p.death_date);
      if (b != null && d != null && d - b > span && d - b < 120) { span = d - b; best = p; }
    }
    if (best && span > 0) {
      pushFact({
        key: 'longest',
        icon: 'time',
        title: `${best.display_name} lived ${span} years`,
        detail: `${year(best.birth_date)}–${year(best.death_date)} — the longest life recorded so far.`,
        personId: best.id,
      });
    }
  }

  // ── Eldest living ───────────────────────────────────────────────────────
  {
    let best = null, age = -1;
    for (const p of people) {
      if (p.is_deceased) continue;
      const b = year(p.birth_date);
      if (b != null && thisYear - b > age && thisYear - b < 120) { age = thisYear - b; best = p; }
    }
    if (best && age > 0) {
      pushFact({
        key: 'eldest',
        icon: 'star',
        title: `${best.display_name} is your eldest living relative`,
        detail: `${age} years young.`,
        personId: best.id,
      });
    }
  }

  // ── Most common birth decade ────────────────────────────────────────────
  {
    const decades = new Map();
    for (const p of people) {
      const b = year(p.birth_date);
      if (b == null) continue;
      const dec = Math.floor(b / 10) * 10;
      decades.set(dec, (decades.get(dec) || 0) + 1);
    }
    let topDec = null, topN = 0;
    for (const [dec, n] of decades) if (n > topN) { topN = n; topDec = dec; }
    if (topDec != null && topN >= 3) {
      pushFact({
        key: 'decade',
        icon: 'time',
        title: `The ${topDec}s were your family's busiest decade`,
        detail: `${topN} people were born then.`,
      });
    }
  }

  // ── Surname frequency (also feeds the largest-line fact + aggregates) ────
  const freq = new Map();
  for (const p of people) {
    const s = surnameOf(p);
    if (s) freq.set(s, (freq.get(s) || 0) + 1);
  }
  const surnames = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  if (surnames[0] && surnames[0].count >= 3) {
    pushFact({
      key: 'surname',
      icon: 'roots',
      title: `${surnames[0].count} of you carry the ${surnames[0].name} name`,
      detail: 'The largest line in the tree.',
    });
  }

  // ── Completeness nudges (sorted by closeness to the viewer) ─────────────
  const closeness = (p) => (dist.has(p.id) ? dist.get(p.id) : 999);
  const byCloseness = (a, b) => closeness(a) - closeness(b);
  const nudgeList = (predicate, label, key) => {
    const missing = people.filter((p) => p.id !== vid && predicate(p)).sort(byCloseness);
    if (!missing.length) return null;
    const all = missing.map((p) => ({ id: p.id, name: p.display_name }));
    return {
      key,
      total: missing.length,
      label,
      people: all.slice(0, 4),
      all,
    };
  };
  const nudges = [
    nudgeList((p) => !(p.bio && p.bio.trim()), 'have no life story yet', 'bio'),
    nudgeList((p) => year(p.birth_date) == null, 'are missing a birth date', 'birth'),
    nudgeList((p) => !p.photo, 'have no portrait yet', 'photo'),
  ].filter(Boolean);

  // ── Aggregates for the grounded AI narrative (privacy-safe) ─────────────
  const withPhoto = people.filter((p) => p.photo).length;
  const withBio = people.filter((p) => p.bio && p.bio.trim()).length;
  const withBirth = people.filter((p) => year(p.birth_date) != null).length;
  const yearsAll = people.map((p) => year(p.birth_date)).filter((y) => y != null);
  const yMin = yearsAll.length ? Math.min(...yearsAll) : null;
  const yMax = yearsAll.length ? Math.max(...yearsAll) : null;
  const earliest = yMin != null ? people.find((p) => year(p.birth_date) === yMin) : null;
  const latest = yMax != null ? people.find((p) => year(p.birth_date) === yMax) : null;
  const heartFact = facts.find((f) => f.key === 'heart');

  const aggregates = {
    totalPeople: people.length,
    generations: vid ? genUp + genDown + 1 : null,
    surnames: surnames.slice(0, 6),
    span: {
      min: yMin, max: yMax,
      earliest: earliest ? earliest.display_name : null,
      latest: latest ? latest.display_name : null,
    },
    completeness: { portraits: withPhoto, biographies: withBio, birthDates: withBirth, total: people.length },
    viewer: viewer ? {
      firstName: firstNameOf(viewer),
      surname: surnameOf(viewer),
      generationsAbove: genUp,
      generationsBelow: genDown,
    } : null,
    heart: heartFact ? heartFact.title.replace(/ is the heart.*/, '') : null,
  };

  return {
    viewer: viewer ? { id: vid, name: viewer.display_name, firstName: firstNameOf(viewer) } : null,
    facts,
    nudges,
    aggregates,
  };
}

// Stable-ish hash of the aggregate facts, for caching the AI narrative.
export function aggregatesHash(aggregates) {
  const s = JSON.stringify(aggregates);
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return String(h);
}

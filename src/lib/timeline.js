/*
 * Family timeline — aggregate every dated moment across the whole family into
 * one chronological stream: births, deaths, life events, and photographs.
 * (Memories are recent reflections shared *now*, not historical moments, so
 * they're intentionally excluded from the history.)
 */

const yearOf = (d) => {
  const m = String(d || '').match(/\d{4}/);
  return m ? parseInt(m[0], 10) : null;
};

// Order within a single year: a birth opens it, a death closes it.
const TYPE_RANK = { birth: 0, event: 1, photo: 2, death: 3 };

export function buildTimeline(graph, photos = []) {
  const byId = graph.byId;
  const nameOf = (id) => byId.get(id)?.display_name || '';
  const entries = [];

  for (const p of graph.people) {
    const by = yearOf(p.birth_date);
    if (by) {
      entries.push({
        key: `b_${p.id}`, year: by, type: 'birth', personId: p.id,
        title: `${p.display_name} was born`,
        detail: p.birth_place || null,
        who: p.display_name,
      });
    }
    const dy = yearOf(p.death_date);
    if (dy) {
      entries.push({
        key: `d_${p.id}`, year: dy, type: 'death', personId: p.id,
        title: `${p.display_name} passed away`,
        detail: by ? `Aged ${dy - by}` : null,
        who: p.display_name,
      });
    }
    for (const ev of p.events || []) {
      const y = yearOf(ev.year);
      if (y && ev.title) {
        entries.push({
          key: `e_${p.id}_${y}_${ev.title}`, year: y, type: 'event', personId: p.id,
          title: ev.title, detail: ev.detail || null, who: p.display_name,
        });
      }
    }
  }

  for (const ph of photos) {
    const y = yearOf(ph.date);
    if (y) {
      entries.push({
        key: `p_${ph.id}`, year: y, type: 'photo', personId: ph.person_id,
        title: ph.caption || 'A photograph', detail: null,
        who: nameOf(ph.person_id), photoSrc: ph.src,
      });
    }
  }

  entries.sort((a, b) => a.year - b.year || (TYPE_RANK[a.type] - TYPE_RANK[b.type]));
  return entries;
}

// Which high-level filter bucket an entry belongs to.
export function bucketOf(type) {
  if (type === 'birth') return 'births';
  if (type === 'photo') return 'photos';
  return 'milestones'; // events + deaths
}

// Group an already-sorted entry list into decade sections for rendering.
export function groupByDecade(entries) {
  const groups = [];
  let cur = null;
  for (const e of entries) {
    const decade = Math.floor(e.year / 10) * 10;
    if (!cur || cur.decade !== decade) {
      cur = { decade, label: `${decade}s`, entries: [] };
      groups.push(cur);
    }
    cur.entries.push(e);
  }
  return groups;
}

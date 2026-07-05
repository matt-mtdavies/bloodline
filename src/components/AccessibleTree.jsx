import { useState, useMemo, useEffect, useRef } from 'react';
import Avatar from './Avatar.jsx';
import { lifespan } from '../lib/dates.js';
import { relationLabel } from '../data/graph.js';

/*
 * The parallel, fully accessible view (§1) — semantic, keyboard-navigable, and
 * screen-reader friendly. Anyone can use the whole product here without a single
 * pixel of canvas. It mirrors the ego model: the focused person, then the people
 * immediately around them, then a searchable directory of everyone.
 */
export default function AccessibleTree({ graph, focusId, onFocus, onOpenPerson, onShowOnMap }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const focus = graph.byId.get(focusId);
  const listRef = useRef(null);

  // This view stays mounted across a re-focus (same component, new focusId —
  // see App.jsx), so the scrollable .listview never reset on its own: tapping
  // a relative deep in the directory re-centred the page around them but left
  // you scrolled to wherever you'd been on the PREVIOUS person's page.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [focusId]);

  const groups = useMemo(() => {
    if (!focus) return [];
    const partners = graph.partners(focusId);
    const parents = graph.parents(focusId);
    const children = graph.children(focusId);
    const siblings = graph.siblings(focusId);

    const immediate = [
      { title: partners.length > 1 ? 'Partners' : 'Partner', items: partners },
      { title: 'Parents', items: parents },
      { title: 'Children', items: children },
      { title: 'Siblings', items: siblings },
    ].filter((g) => g.items.length);

    // Extended family — same derivation as PersonSheet, single dedup set.
    const immediateIds = new Set([
      focusId,
      ...partners.map((x) => x.id),
      ...parents.map((x) => x.id),
      ...children.map((x) => x.id),
      ...siblings.map((x) => x.id),
    ]);
    const extSeen = new Set();
    const ext = (items) => {
      const out = [];
      for (const item of items) {
        if (!immediateIds.has(item.id) && !extSeen.has(item.id)) {
          extSeen.add(item.id);
          out.push(item);
        }
      }
      return out;
    };

    const upwardParents = parents.filter(
      (p) => !p.qualifier || p.qualifier === 'biological' || p.qualifier === 'adoptive',
    );
    const rawGrandparentIds = upwardParents.flatMap((p) => graph.parents(p.id).map((gp) => gp.id));
    const grandparents = ext(rawGrandparentIds.map((id) => ({ id })));
    const auntsUncles = ext(upwardParents.flatMap((p) => graph.siblings(p.id).map((s) => ({ id: s.id }))));
    const rawGrandchildIds = children.flatMap((c) => graph.children(c.id).map((gc) => gc.id));
    const grandchildren = ext(rawGrandchildIds.map((id) => ({ id })));
    const niecesNephews = ext(siblings.flatMap((s) => graph.children(s.id).map((c) => ({ id: c.id }))));
    const greatGrandparents = ext(
      rawGrandparentIds.flatMap((gpId) => graph.parents(gpId).map((ggp) => ({ id: ggp.id }))),
    );
    const greatGrandchildren = ext(
      rawGrandchildIds.flatMap((gcId) => graph.children(gcId).map((ggc) => ({ id: ggc.id }))),
    );

    const extended = [
      { title: 'Great Grandparents', items: greatGrandparents },
      { title: 'Grandparents', items: grandparents },
      { title: 'Aunts & Uncles', items: auntsUncles },
      { title: 'Grandchildren', items: grandchildren },
      { title: 'Nieces & Nephews', items: niecesNephews },
      { title: 'Great Grandchildren', items: greatGrandchildren },
    ].filter((g) => g.items.length);

    return [...immediate, ...extended];
  }, [graph, focusId, focus]);

  const directory = useMemo(() => {
    const term = q.trim().toLowerCase();
    return graph.people
      .filter((p) => {
        if (filter === 'living' && p.is_deceased) return false;
        if (filter === 'deceased' && !p.is_deceased) return false;
        if (!term) return true;
        return (
          p.display_name.toLowerCase().includes(term) ||
          (p.occupation || '').toLowerCase().includes(term) ||
          (p.birth_place || '').toLowerCase().includes(term) ||
          (p.tags || []).some((t) => t.toLowerCase().includes(term))
        );
      })
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [graph, q, filter]);

  if (!focus) return null;

  const isFiltered = q.trim() || filter !== 'all';

  return (
    <main ref={listRef} className="listview" aria-label="Family directory">
      <section className="listview__focus">
        <button
          className="person-row person-row--focus"
          onClick={() => onOpenPerson(focusId)}
          aria-label={`Open ${focus.display_name}`}
        >
          <Avatar person={focus} size={64} />
          <span className="person-row__text">
            <span className="person-row__name">{focus.display_name}</span>
            <span className="person-row__meta">{lifespan(focus)} · centred here</span>
          </span>
        </button>

        {groups.map((g) => (
          <div className="listview__group" key={g.title}>
            <h3>{g.title}</h3>
            <ul>
              {g.items.map((item) => {
                const p = graph.byId.get(item.id);
                if (!p) return null;
                return (
                  <li key={item.id}>
                    <div className="person-row">
                      <button className="person-row__main" onClick={() => onFocus(item.id)}>
                        <Avatar person={p} size={46} />
                        <span className="person-row__text">
                          <span className="person-row__name">{p.display_name}</span>
                          <span className="person-row__meta">
                            {relationLabel(graph, focusId, item.id)} · {lifespan(p)}
                          </span>
                        </span>
                      </button>
                      <button
                        className="person-row__map"
                        onClick={() => onShowOnMap?.(item.id)}
                        aria-label={`Show ${p.display_name} in the tree`}
                      >
                        <TreeIcon />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      <section className="listview__directory">
        <h3>
          Everyone{isFiltered && directory.length !== graph.people.length
            ? ` · ${directory.length} of ${graph.people.length}`
            : ''}
        </h3>
        <div className="search-wrap">
          <input
            className="search"
            type="search"
            placeholder="Search by name, occupation, location, tag…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search the family"
          />
          {q && (
            <button className="input-clear" onClick={() => setQ('')} aria-label="Clear search" tabIndex={-1}>
              ×
            </button>
          )}
        </div>
        <div className="filter-pills" role="group" aria-label="Filter by status">
          {[
            { key: 'all', label: 'All' },
            { key: 'living', label: 'Living' },
            { key: 'deceased', label: 'Deceased' },
          ].map(({ key, label }) => (
            <button
              key={key}
              className={`filter-pill${filter === key ? ' filter-pill--active' : ''}`}
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
            >
              {label}
            </button>
          ))}
        </div>
        <ul>
          {directory.length > 0 ? (
            directory.map((p) => (
              <li key={p.id}>
                <div className={'person-row' + (p.id === focusId ? ' person-row--current' : '')}>
                  <button className="person-row__main" onClick={() => onFocus(p.id)}>
                    <Avatar person={p} size={42} />
                    <span className="person-row__text">
                      <span className="person-row__name">{p.display_name}</span>
                      <span className="person-row__meta">
                        {lifespan(p)}
                        {p.occupation ? ` · ${p.occupation}` : ''}
                      </span>
                    </span>
                  </button>
                  <button
                    className="person-row__map"
                    onClick={() => onShowOnMap?.(p.id)}
                    aria-label={`Show ${p.display_name} in the tree`}
                  >
                    <TreeIcon />
                  </button>
                </div>
              </li>
            ))
          ) : (
            <li className="listview__empty">No one matches this search.</li>
          )}
        </ul>
      </section>
    </main>
  );
}

// Same glyph as the topbar's tree/list view toggle and the profile page's
// "Show in tree" — the flight-across-the-tree flourish (see App.jsx's
// flyToPersonFromAnywhere), reused here as a per-row action distinct from
// the row's own tap-to-centre.
function TreeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="4" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="5" cy="19" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="19" cy="19" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 6.2v5.3M12 11.5l-5 4.8M12 11.5l5 4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

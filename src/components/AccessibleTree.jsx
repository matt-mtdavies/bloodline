import { useState, useMemo } from 'react';
import Avatar from './Avatar.jsx';
import { lifespan } from '../lib/dates.js';
import { relationLabel } from '../data/graph.js';

/*
 * The parallel, fully accessible view (§1) — semantic, keyboard-navigable, and
 * screen-reader friendly. Anyone can use the whole product here without a single
 * pixel of canvas. It mirrors the ego model: the focused person, then the people
 * immediately around them, then a searchable directory of everyone.
 */
export default function AccessibleTree({ graph, focusId, onFocus, onOpenPerson }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const focus = graph.byId.get(focusId);

  const groups = useMemo(() => {
    if (!focus) return [];
    const partners = graph.partners(focusId);
    return [
      { title: partners.length > 1 ? 'Partners' : 'Partner', items: partners },
      { title: 'Parents', items: graph.parents(focusId) },
      { title: 'Children', items: graph.children(focusId) },
      { title: 'Siblings', items: graph.siblings(focusId) },
    ].filter((g) => g.items.length);
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
    <main className="listview" aria-label="Family directory">
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
                    <button className="person-row" onClick={() => onFocus(item.id)}>
                      <Avatar person={p} size={46} />
                      <span className="person-row__text">
                        <span className="person-row__name">{p.display_name}</span>
                        <span className="person-row__meta">
                          {relationLabel(graph, focusId, item.id)} · {lifespan(p)}
                        </span>
                      </span>
                      <span className="person-row__go" aria-hidden="true">
                        Centre →
                      </span>
                    </button>
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
                <button
                  className={'person-row' + (p.id === focusId ? ' person-row--current' : '')}
                  onClick={() => onFocus(p.id)}
                >
                  <Avatar person={p} size={42} />
                  <span className="person-row__text">
                    <span className="person-row__name">{p.display_name}</span>
                    <span className="person-row__meta">
                      {lifespan(p)}
                      {p.occupation ? ` · ${p.occupation}` : ''}
                    </span>
                  </span>
                </button>
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

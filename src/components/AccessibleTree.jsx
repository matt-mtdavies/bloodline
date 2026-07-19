import { useState, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import Avatar from './Avatar.jsx';
import { lifespan } from '../lib/dates.js';
import { relationLabel, sortSiblings, sortChildren } from '../data/graph.js';
import { useKinTerms } from '../lib/kinTerms.js';

// Measured from a live render (390px viewport): a person-row is 62px tall,
// the directory <ul> has a 6px row gap — 68px is the fixed stride the
// virtualizer positions rows at. Kept in sync with .person-row / gap in
// components.css; if those change, update this too.
const DIRECTORY_ROW_HEIGHT = 68;

/*
 * The parallel, fully accessible view (§1) — semantic, keyboard-navigable, and
 * screen-reader friendly. Anyone can use the whole product here without a single
 * pixel of canvas. It mirrors the ego model: the focused person, then the people
 * immediately around them, then a searchable directory of everyone.
 */
export default function AccessibleTree({ graph, focusId, onFocus, onOpenPerson, onShowOnMap, onShowInChart }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const kinTerms = useKinTerms();
  const focus = graph.byId.get(focusId);
  const listRef = useRef(null);
  const focusSectionRef = useRef(null);
  const directoryListRef = useRef(null);
  const [scrollMargin, setScrollMargin] = useState(0);

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
    // Biological/adoptive children first, then step, then oldest-to-youngest,
    // alphabetical as the final tiebreak. Same helper PersonSheet uses, so
    // the two views never disagree on order.
    const children = sortChildren(graph.children(focusId), graph.byId);
    // Full (biological) siblings first, then half, then step — each tier
    // oldest-to-youngest, alphabetical as the final tiebreak. Same helper
    // PersonSheet uses, so the two views never disagree on order.
    const siblings = sortSiblings(graph.siblings(focusId), graph.byId);

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

  // The directory is virtualized but shares one continuous scroll container
  // with the focus/groups section above it, whose height varies with focusId
  // (different relatives → different group count). The virtualizer needs to
  // know the directory's actual pixel offset within that container to
  // position rows correctly — re-measure whenever that offset could shift.
  useLayoutEffect(() => {
    const container = listRef.current;
    const ul = directoryListRef.current;
    if (!container || !ul) return;
    const measure = () => {
      const containerRect = container.getBoundingClientRect();
      const ulRect = ul.getBoundingClientRect();
      setScrollMargin(ulRect.top - containerRect.top + container.scrollTop);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (focusSectionRef.current) ro.observe(focusSectionRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [focusId, groups.length]);

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

  const rowVirtualizer = useVirtualizer({
    count: directory.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => DIRECTORY_ROW_HEIGHT,
    overscan: 10,
    scrollMargin,
  });

  if (!focus) return null;

  const isFiltered = q.trim() || filter !== 'all';

  return (
    <main ref={listRef} className="listview" aria-label="Family directory">
      <section className="listview__focus" ref={focusSectionRef}>
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
                            {relationLabel(graph, focusId, item.id, kinTerms)} · {lifespan(p)}
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
                      <button
                        className="person-row__chart"
                        onClick={() => onShowInChart?.(item.id)}
                        aria-label={`Show ${p.display_name} in the chart`}
                      >
                        <ChartIcon />
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
        <ul
          ref={directoryListRef}
          style={
            directory.length > 0
              ? { position: 'relative', height: rowVirtualizer.getTotalSize(), display: 'block' }
              : undefined
          }
        >
          {directory.length > 0 ? (
            rowVirtualizer.getVirtualItems().map((vRow) => {
              const p = directory[vRow.index];
              return (
                <li
                  key={p.id}
                  data-index={vRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    // Bakes the directory ul's 6px row gap (see components.css)
                    // into each row's own measured box, since absolute
                    // positioning takes rows out of the grid flow that used
                    // to supply it.
                    paddingBottom: 6,
                    transform: `translateY(${vRow.start - scrollMargin}px)`,
                  }}
                >
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
                    <button
                      className="person-row__chart"
                      onClick={() => onShowInChart?.(p.id)}
                      aria-label={`Show ${p.display_name} in the chart`}
                    >
                      <ChartIcon />
                    </button>
                  </div>
                </li>
              );
            })
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

// Same glyph as the topbar's Tree/Chart/List switcher (ChartModeIcon) — the
// deliberate rectangular-cards-on-rows cue that pairs with TreeIcon's
// circles-and-branches, so the two row actions read as "same family,
// different destination" rather than mismatched icons.
function ChartIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="8" y="3" width="8" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="2" y="16" width="8" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="14" y="16" width="8" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 8v4M12 12H6v4M12 12h6v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

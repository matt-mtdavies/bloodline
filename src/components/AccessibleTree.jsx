import { useState, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import Avatar from './Avatar.jsx';
import { lifespan } from '../lib/dates.js';
import { relationLabel, sortSiblings, sortChildren, distancesFrom } from '../data/graph.js';
import { useKinTerms } from '../lib/kinTerms.js';

// A group past this many people gets a collapse toggle (the critique's own
// "unnavigable at scale" finding — nine non-collapsible headers, some
// growing with every cousin/grandchild). Small groups (partners, parents)
// stay plain, always-visible headers — nothing to hide.
const COLLAPSE_THRESHOLD = 6;

// A group past THIS many people skips the smooth animated collapse and
// unmounts its rows outright while closed, instead of just CSS-hiding them
// (audit finding: extended-family groups aren't virtualized like the main
// directory, so a large one stayed fully mounted in the DOM regardless of
// collapse state). Below this, the row count is small enough that keeping
// them mounted for the smooth grid-rows animation costs nothing real.
const UNMOUNT_THRESHOLD = 40;

// Just an initial estimate for the virtualizer's own scroll-math bootstrap —
// `rowVirtualizer.measureElement` (wired on each row below) re-measures the
// real rendered height immediately after mount and self-corrects, so this
// doesn't need to track components.css exactly.
const DIRECTORY_ROW_HEIGHT = 60;

// Simple last-token surname for the directory's "Surname" sort — deliberately
// not lib/duplicates.js's own nameKey() (that one strips Jr./Sr./II suffixes
// for duplicate-matching precision, a different job than an at-a-glance sort).
function surnameOf(p) {
  const parts = p.display_name.trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : parts[0] || '';
}

// Per-person cache of the lowercased fields the directory filter searches —
// keyed by object identity (see lib/search.js's identical rationale: store.js
// always replaces an edited person with a new object, so a WeakMap here
// self-invalidates correctly and lets an untouched person's normalized
// fields survive across every keystroke of a filter session, rather than
// re-lowercasing name/occupation/place/tags for every person on each one).
const directoryFieldCache = new WeakMap();
function normalizedDirectoryFields(p) {
  let cached = directoryFieldCache.get(p);
  if (cached) return cached;
  cached = {
    name: p.display_name.toLowerCase(),
    occupation: (p.occupation || '').toLowerCase(),
    birthPlace: (p.birth_place || '').toLowerCase(),
    residence: (p.residence || '').toLowerCase(),
    tags: (p.tags || []).map((t) => t.toLowerCase()),
  };
  directoryFieldCache.set(p, cached);
  return cached;
}

/*
 * The parallel, fully accessible view (§1) — semantic, keyboard-navigable, and
 * screen-reader friendly. Anyone can use the whole product here without a single
 * pixel of canvas. It mirrors the ego model: the focused person, then the people
 * immediately around them, then a searchable directory of everyone.
 */
export default function AccessibleTree({ graph, focusId, onOpenPerson, onShowOnMap, onShowInChart, perimeterActive = false, perimeterCount = null }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  // 'name' (first-name alphabetical, the long-standing default) / 'surname' /
  // 'closeness' (nearest-to-the-focused-person first, via the same BFS
  // distancesFrom already used elsewhere — parents/children surface before
  // distant in-laws instead of an arbitrary alphabetical starting point).
  const [sortMode, setSortMode] = useState('name');
  // Titles of extended-family groups the viewer has collapsed. Keyed by
  // title (stable across a re-focus) rather than reset per-person — a
  // once-collapsed "Grandparents" stays collapsed browsing to the next
  // relative too, same as any other persistent disclosure in the app.
  // Empty by default: nothing starts collapsed, so an existing view of a
  // small family looks byte-identical to before this feature existed.
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const toggleGroup = (title) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };
  const kinTerms = useKinTerms();
  const focus = graph.byId.get(focusId);
  const listRef = useRef(null);
  const focusSectionRef = useRef(null);
  const directoryListRef = useRef(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  // The letter currently under the finger while dragging the A–Z rail (null
  // when not dragging) — drives both the magnified-letter preview and which
  // letter counts as "current" so a drag across several letters only jumps
  // once per newly-entered letter, not once per pointermove event.
  const [scrubLetter, setScrubLetter] = useState(null);
  const [scrubY, setScrubY] = useState(0);
  const azRef = useRef(null);
  const lastScrubLetterRef = useRef(null);
  // Throttles handleScrubMove's own elementFromPoint + scrollToIndex work to
  // once per animation frame — pointermove can fire far faster than that
  // during a real drag, and neither hit-testing nor a virtualizer scroll
  // needs to run more often than the screen can actually repaint.
  const scrubFrameRef = useRef(null);
  const scrubPointRef = useRef(null);

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
    const filtered = graph.people.filter((p) => {
      if (filter === 'living' && p.is_deceased) return false;
      if (filter === 'deceased' && !p.is_deceased) return false;
      if (!term) return true;
      const f = normalizedDirectoryFields(p);
      return (
        f.name.includes(term) ||
        f.occupation.includes(term) ||
        f.birthPlace.includes(term) ||
        f.residence.includes(term) ||
        f.tags.some((t) => t.includes(term))
      );
    });
    if (sortMode === 'surname') {
      return filtered.sort((a, b) => surnameOf(a).localeCompare(surnameOf(b)) || a.display_name.localeCompare(b.display_name));
    }
    if (sortMode === 'closeness') {
      const dist = distancesFrom(graph, focusId);
      return filtered.sort((a, b) => {
        const da = dist.has(a.id) ? dist.get(a.id) : Infinity;
        const db = dist.has(b.id) ? dist.get(b.id) : Infinity;
        return da - db || a.display_name.localeCompare(b.display_name);
      });
    }
    return filtered.sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [graph, q, filter, sortMode, focusId]);

  // A–Z jump rail: only coherent for the two alphabetical sorts — "closest
  // to you" isn't ordered by letter at all, so the rail hides itself there
  // rather than jumping to a position that has nothing to do with the tapped
  // letter. Maps each present starting letter to the first directory index
  // it appears at (in the CURRENT sort/filter), so a tap can jump straight
  // there via the virtualizer.
  const letterIndex = useMemo(() => {
    if (sortMode === 'closeness') return null;
    const map = new Map();
    directory.forEach((p, i) => {
      const key = sortMode === 'surname' ? surnameOf(p) : p.display_name;
      const letter = (key[0] || '').toUpperCase();
      if (letter >= 'A' && letter <= 'Z' && !map.has(letter)) map.set(letter, i);
    });
    return map;
  }, [directory, sortMode]);

  const rowVirtualizer = useVirtualizer({
    count: directory.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => DIRECTORY_ROW_HEIGHT,
    overscan: 10,
    scrollMargin,
  });

  const jumpToLetter = (letter) => {
    const idx = letterIndex?.get(letter);
    if (idx != null) rowVirtualizer.scrollToIndex(idx, { align: 'start' });
  };

  // Press-and-drag scrubbing along the rail (the whole point of an A–Z index
  // — precisely tapping a 9.5px letter is hard, dragging your thumb down the
  // column and feeling it jump letter-by-letter is the actual iOS Contacts
  // interaction this rail is modelled on). Pointer Events cover touch and
  // mouse in one path; `setPointerCapture` keeps delivering move events to
  // this element even once the finger drifts off its narrow hit area.
  const letterAtPoint = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const btn = el?.closest?.('[data-letter]');
    return btn?.dataset.letter || null;
  };
  const processScrubFrame = () => {
    scrubFrameRef.current = null;
    const pt = scrubPointRef.current;
    if (!pt) return;
    const letter = letterAtPoint(pt.x, pt.y);
    if (!letter) return;
    setScrubLetter(letter);
    setScrubY(pt.y);
    if (letter !== lastScrubLetterRef.current) {
      lastScrubLetterRef.current = letter;
      jumpToLetter(letter);
    }
  };
  const handleScrubStart = (e) => {
    azRef.current?.setPointerCapture(e.pointerId);
    handleScrubMove(e);
  };
  const handleScrubMove = (e) => {
    scrubPointRef.current = { x: e.clientX, y: e.clientY };
    if (scrubFrameRef.current == null) {
      scrubFrameRef.current = requestAnimationFrame(processScrubFrame);
    }
  };
  const handleScrubEnd = () => {
    if (scrubFrameRef.current != null) {
      cancelAnimationFrame(scrubFrameRef.current);
      scrubFrameRef.current = null;
    }
    scrubPointRef.current = null;
    lastScrubLetterRef.current = null;
    setScrubLetter(null);
  };

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
            <span className="person-row__meta">{lifespan(focus)}</span>
          </span>
        </button>

        {groups.map((g) => {
          const collapsible = g.items.length > COLLAPSE_THRESHOLD;
          const isOpen = !collapsible || !collapsedGroups.has(g.title);
          // A group large enough to matter for DOM size skips the smooth
          // animated collapse and unmounts its rows outright while closed —
          // see UNMOUNT_THRESHOLD above. Below it, rows stay mounted (CSS
          // grid-rows animates the reveal) since the DOM cost is trivial.
          const large = g.items.length > UNMOUNT_THRESHOLD;
          const rows = large && !isOpen ? null : (
            <ul>
              {g.items.map((item) => {
                const p = graph.byId.get(item.id);
                if (!p) return null;
                return (
                  <li key={item.id}>
                    <div className="person-row">
                      <button className="person-row__main" onClick={() => onOpenPerson(item.id)}>
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
          );
          return (
            <div className="listview__group" key={g.title}>
              {collapsible ? (
                <h3>
                  <button
                    type="button"
                    className="listview__group-toggle"
                    onClick={() => toggleGroup(g.title)}
                    aria-expanded={isOpen}
                  >
                    <span>{g.title} ({g.items.length})</span>
                    <ChevronIcon open={isOpen} />
                  </button>
                </h3>
              ) : (
                <h3>{g.title} ({g.items.length})</h3>
              )}
              {!collapsible ? (
                rows
              ) : large ? (
                rows
              ) : (
                <div className={`privacy-section__reveal${isOpen ? ' is-open' : ''}`} aria-hidden={!isOpen}>
                  <div className="privacy-section__reveal-inner">{rows}</div>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="listview__directory">
        <h3>
          {/* §6.11: List stays the complete-family view unconditionally
              (never filtered by perimeter) — only the COUNT is
              perimeter-aware, and always labelled per §4.3's "every count
              says whether it covers your perimeter or the complete tree."
              A search/status filter already has its own "N of M" label;
              that one takes priority since it's the more specific/active
              state — the perimeter count only shows on the plain,
              unfiltered "Everyone" heading. */}
          Everyone{isFiltered && directory.length !== graph.people.length
            ? ` · ${directory.length} of ${graph.people.length}`
            : perimeterActive && perimeterCount != null
              ? ` · ${perimeterCount} within your Family Perimeter · ${graph.people.length} in the complete family tree`
              : ''}
        </h3>
        {/* Sticky within .listview's own scroll: at a real family's scale this
            is otherwise a long scroll below the immediate-family groups
            (which grow with every aunt, cousin and grandchild), so search
            stays reachable without hunting for it. */}
        <div className="listview__directory-head">
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
              <button className="input-clear" onClick={() => setQ('')} aria-label="Clear search">
                ×
              </button>
            )}
          </div>
          <div className="filter-pills" role="group" aria-label="Filter by status">
            {[
              { key: 'all', label: 'All' },
              { key: 'living', label: 'Living' },
              { key: 'deceased', label: 'Passed away' },
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
            <label className="listview__sort">
              <span className="visually-hidden">Sort by</span>
              <select value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
                <option value="name">First name</option>
                <option value="surname">Surname</option>
                <option value="closeness">Closest to you</option>
              </select>
            </label>
          </div>
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
                    transform: `translateY(${vRow.start - scrollMargin}px)`,
                  }}
                >
                  <div className={'person-row' + (p.id === focusId ? ' person-row--current' : '')}>
                    <button className="person-row__main" onClick={() => onOpenPerson(p.id)}>
                      <Avatar person={p} size={42} />
                      <span className="person-row__text">
                        <span className="person-row__name">{p.display_name}</span>
                        <span className="person-row__meta">
                          {relationLabel(graph, focusId, p.id, kinTerms)} · {lifespan(p)}
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

      {/* Jump-to-letter rail — only shown for the two sorts it can actually
          honor (First name / Surname); "Closest to you" isn't alphabetical,
          so a rail there would jump to a position unrelated to the tapped
          letter. Fixed to the viewport (not `.listview`'s own scroll), so
          it stays reachable from anywhere in the list, not just once
          scrolled down to the directory. Supports both a plain tap (the
          button's own onClick, so keyboard/switch access still works with
          no pointer involved at all) and a press-and-drag scrub down the
          whole column (the pointer handlers below) — whichever the visitor
          reaches for. `disabled` is deliberately NOT used on the letter
          buttons: a real `disabled` element is invisible to
          `elementFromPoint` in some browsers, which would make the drag
          gesture silently skip every unavailable letter instead of just
          ignoring it; `aria-disabled` + the dimmed CSS give the same visual
          and keyboard-activation result without that hit-testing gap. */}
      {letterIndex && (
        <nav
          ref={azRef}
          className="listview__az"
          aria-label="Jump to letter"
          onPointerDown={handleScrubStart}
          onPointerMove={(e) => e.buttons === 1 && handleScrubMove(e)}
          onPointerUp={handleScrubEnd}
          onPointerCancel={handleScrubEnd}
        >
          {ALPHABET.map((letter) => {
            const idx = letterIndex.get(letter);
            const available = idx != null;
            return (
              <button
                key={letter}
                type="button"
                data-letter={letter}
                className="listview__az-btn"
                aria-disabled={!available}
                // aria-disabled alone (deliberately not the native `disabled`
                // attribute — see the comment above on elementFromPoint hit
                // testing) leaves the element focusable, so an unavailable
                // letter would otherwise sit in the Tab order doing nothing.
                // tabIndex has no bearing on elementFromPoint, so this keeps
                // the drag gesture working while removing the dead stop for
                // keyboard/switch users.
                tabIndex={available ? 0 : -1}
                onClick={() => jumpToLetter(letter)}
                aria-label={`Jump to ${letter}`}
              >
                {letter}
              </button>
            );
          })}
        </nav>
      )}

      {/* The magnified current-letter preview while scrubbing — without it,
          the letter under a thumb is hidden by the thumb itself at 9.5px. */}
      {scrubLetter && (
        <div className="listview__az-magnifier" style={{ top: scrubY }} aria-hidden="true">
          {scrubLetter}
        </div>
      )}
    </main>
  );
}

const ALPHABET = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));

function ChevronIcon({ open }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"
      style={{ flexShrink: 0, transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }}>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Same glyph as the topbar's tree/list view toggle and the profile page's
// "Show in tree" — the flight-across-the-tree flourish (see App.jsx's
// flyToPersonFromAnywhere), reused here as a per-row action distinct from
// the row's own tap-to-open (which opens the profile sheet directly; "show
// in tree"/"show in chart" fly the canvas camera to them instead).
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

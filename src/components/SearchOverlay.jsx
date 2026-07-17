import { useState, useEffect, useRef, useMemo } from 'react';
import Avatar from './Avatar.jsx';
import { relationshipCategories } from '../data/graph.js';
import { rankPeopleByName } from '../lib/search.js';

// Coarser than PersonSheet's extended-family groups (which fold in
// great-grandparents/great-grandchildren and split grandchildren from
// nieces/nephews) — these are quick shortcuts to a shortlist, not a full
// relationship breakdown; List View already covers that in more depth.
const CATEGORIES = [
  { key: 'immediate', label: 'Immediate Family' },
  { key: 'grandparents', label: 'Grandparents' },
  { key: 'aunts_uncles', label: 'Aunts & Uncles' },
  { key: 'cousins', label: 'Cousins' },
  { key: 'descendants', label: 'Nieces, Nephews & Grandchildren' },
  { key: 'everyone_else', label: 'Everyone Else' },
];

const STATUSES = [
  { key: 'all', label: 'All' },
  { key: 'living', label: 'Living' },
  { key: 'deceased', label: 'Deceased' },
];

export default function SearchOverlay({ people, graph, viewerId, onSelect, onClose, hint = null }) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [category, setCategory] = useState(null); // one of CATEGORIES[].key, or null
  const [status, setStatus] = useState('all');
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Focus the input as soon as the sheet mounts, on every device — tapping
  // the search icon should bring the keyboard straight up rather than
  // requiring a second tap on the field. The short delay keeps this inside
  // the window browsers (notably iOS Safari) honour for showing the
  // keyboard off the tap that opened the sheet, since the sheet's own mount
  // happens on the next render after that tap, not synchronously within it.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Bucket the whole tree relative to the viewer once — cheap (a handful of
  // graph walks), memoized on viewer/graph identity.
  const categoryMap = useMemo(() => relationshipCategories(graph, viewerId), [graph, viewerId]);

  // Only offer chips for buckets that actually have someone in them — no
  // point showing "Cousins" as a live option if this tree has none.
  const availableCategories = useMemo(() => {
    const counts = new Map();
    for (const c of categoryMap.values()) counts.set(c, (counts.get(c) ?? 0) + 1);
    return CATEGORIES.filter((c) => counts.get(c.key) > 0);
  }, [categoryMap]);

  // Everyone matching the active chip + status filter — the pool a text
  // query further narrows, and what a chip-only browse (no query) lists in full.
  const basePool = useMemo(() => {
    return people.filter((p) => {
      if (category && categoryMap.get(p.id) !== category) return false;
      if (status === 'living' && p.is_deceased) return false;
      if (status === 'deceased' && !p.is_deceased) return false;
      return true;
    });
  }, [people, category, status, categoryMap]);

  const results = useMemo(() => rankPeopleByName(basePool, query), [query, basePool]);

  // No text typed, but a chip or status filter narrowed the pool — browse it
  // in full (alphabetical, uncapped) rather than showing the "start typing"
  // hint over an already-deliberate choice to filter.
  const browsing = !query.trim() && (category || status !== 'all');
  const browseList = useMemo(() => {
    if (!browsing) return [];
    return [...basePool].sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [browsing, basePool]);

  const activeList = query.trim() ? results : browseList;

  useEffect(() => { setCursor(0); }, [activeList]);

  function handleKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, activeList.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter' && activeList[cursor]) {
      onSelect(activeList[cursor].id);
    }
  }

  // Keep focused row in view
  useEffect(() => {
    listRef.current?.children[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  function birthYear(p) {
    if (!p.birth_date) return null;
    const y = String(p.birth_date).slice(0, 4);
    return /^\d{4}$/.test(y) ? y : null;
  }

  function toggleCategory(key) {
    setCategory((c) => (c === key ? null : key));
  }

  return (
    <div className="search-scrim" onClick={onClose} role="dialog" aria-modal="true" aria-label="Search people">
      <div className="search-sheet" onClick={(e) => e.stopPropagation()}>
        {hint && (
          <div className="search-hint-banner">
            <LineageIcon />
            <span>{hint}</span>
          </div>
        )}
        {/* Input */}
        <div className="search-input-row">
          <SearchIcon />
          <input
            ref={inputRef}
            className="search-input"
            type="search"
            placeholder={hint ? 'Search for who to trace to…' : 'Search family members…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button className="search-clear" onClick={() => { setQuery(''); inputRef.current?.focus(); }} aria-label="Clear">
              <ClearIcon />
            </button>
          )}
        </div>

        {availableCategories.length > 0 && (
          <div className="search-chips" role="group" aria-label="Filter by relationship">
            {availableCategories.map((c) => (
              <button
                key={c.key}
                type="button"
                className={`filter-pill${category === c.key ? ' filter-pill--active' : ''}`}
                onClick={() => toggleCategory(c.key)}
                aria-pressed={category === c.key}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        {availableCategories.length > 0 && (
          <div className="filter-pills filter-pills--search" role="group" aria-label="Filter by status">
            {STATUSES.map(({ key, label }) => (
              <button
                key={key}
                className={`filter-pill${status === key ? ' filter-pill--active' : ''}`}
                onClick={() => setStatus(key)}
                aria-pressed={status === key}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Results */}
        {query && (
          <ul ref={listRef} className="search-results" role="listbox">
            {results.length === 0 ? (
              <li className="search-empty">No one found for "{query}"</li>
            ) : results.map((p, i) => (
              <li
                key={p.id}
                role="option"
                aria-selected={i === cursor}
                className={`search-result${i === cursor ? ' search-result--focus' : ''}`}
                onClick={() => onSelect(p.id)}
                onMouseEnter={() => setCursor(i)}
              >
                <Avatar person={p} size={40} />
                <div className="search-result__info">
                  <span className="search-result__name">
                    {highlight(p.display_name, query)}
                    {p._birthName && !p.display_name.toLowerCase().includes(p._birthName.toLowerCase()) && (
                      <span className="search-result__nee"> née {highlight(p._birthName, query)}</span>
                    )}
                    {p._middleName && !p.display_name.toLowerCase().includes(p._middleName.toLowerCase()) && (
                      <span className="search-result__nee"> · middle name {highlight(p._middleName, query)}</span>
                    )}
                  </span>
                  <span className="search-result__meta">
                    {birthYear(p) && <>b. {birthYear(p)}{p.is_deceased ? ' – ' + (p.death_date?.slice(0, 4) || '†') : ''}</>}
                    {p.occupation && <>{birthYear(p) ? ' · ' : ''}{p.occupation}</>}
                    {!birthYear(p) && !p.occupation && (p.is_deceased ? 'Deceased' : 'Living')}
                  </span>
                </div>
                <ChevronIcon />
              </li>
            ))}
          </ul>
        )}

        {!query && browsing && (
          <ul ref={listRef} className="search-results" role="listbox">
            {browseList.length === 0 ? (
              <li className="search-empty">No one matches this filter</li>
            ) : browseList.map((p, i) => (
              <li
                key={p.id}
                role="option"
                aria-selected={i === cursor}
                className={`search-result${i === cursor ? ' search-result--focus' : ''}`}
                onClick={() => onSelect(p.id)}
                onMouseEnter={() => setCursor(i)}
              >
                <Avatar person={p} size={40} />
                <div className="search-result__info">
                  <span className="search-result__name">{p.display_name}</span>
                  <span className="search-result__meta">
                    {birthYear(p) && <>b. {birthYear(p)}{p.is_deceased ? ' – ' + (p.death_date?.slice(0, 4) || '†') : ''}</>}
                    {p.occupation && <>{birthYear(p) ? ' · ' : ''}{p.occupation}</>}
                    {!birthYear(p) && !p.occupation && (p.is_deceased ? 'Deceased' : 'Living')}
                  </span>
                </div>
                <ChevronIcon />
              </li>
            ))}
          </ul>
        )}

        {!query && !browsing && (
          <p className="search-hint">Start typing a name to find anyone in the tree</p>
        )}
      </div>
    </div>
  );
}

function highlight(name, query) {
  const q = query.trim();
  if (!q) return name;
  const idx = name.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return name;
  return (
    <>
      {name.slice(0, idx)}
      <mark className="search-mark">{name.slice(idx, idx + q.length)}</mark>
      {name.slice(idx + q.length)}
    </>
  );
}

function LineageIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="4" r="2.5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="4" cy="20" r="2.5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="20" cy="20" r="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 6.5v4M12 10.5l-5.5 7M12 10.5l5.5 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="search-input-icon">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8"/>
      <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.15"/>
      <path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="search-result__chevron">
      <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

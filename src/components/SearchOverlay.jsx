import { useState, useEffect, useRef, useMemo } from 'react';
import Avatar from './Avatar.jsx';

export default function SearchOverlay({ people, onSelect, onClose }) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return people
      .map((p) => {
        const name = (p.display_name || '').toLowerCase();
        const parts = name.split(/\s+/);
        let score = 0;
        if (name === q)               score = 10;
        else if (name.startsWith(q))  score = 6;
        else if (parts.some((w) => w.startsWith(q))) score = 4;
        else if (name.includes(q))    score = 2;
        // Partial first-word match (typing "mat" matches "Matthew")
        else if (parts[0]?.includes(q)) score = 1;
        return score > 0 ? { ...p, _score: score } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b._score - a._score || a.display_name.localeCompare(b.display_name))
      .slice(0, 10);
  }, [query, people]);

  useEffect(() => { setCursor(0); }, [results]);

  function handleKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter' && results[cursor]) {
      onSelect(results[cursor].id);
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

  return (
    <div className="search-scrim" onClick={onClose} role="dialog" aria-modal="true" aria-label="Search people">
      <div className="search-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grip" />

        {/* Input */}
        <div className="search-input-row">
          <SearchIcon />
          <input
            ref={inputRef}
            className="search-input"
            type="search"
            placeholder="Search family members…"
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
                  <span className="search-result__name">{highlight(p.display_name, query)}</span>
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

        {!query && (
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

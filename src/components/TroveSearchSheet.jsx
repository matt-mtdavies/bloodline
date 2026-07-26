import { useState } from 'react';
import { searchTrove } from '../lib/trove.js';

/*
 * Search Trove (National Library of Australia — historic newspapers,
 * gazettes, and biographical records) for a person, and offer any matches
 * as candidate CITATIONS — never a confirmed match, since Trove's free-text
 * search has no notion of a "person record" the way FamilySearch's Tree API
 * does. Adding a candidate hands off to onAddAsDocument (App.jsx), which
 * fetches the full article + runs it through the existing document
 * extraction pipeline and opens it in the ordinary DocViewer — this sheet's
 * only job is search and selection, not review; review reuses the exact
 * same accept/dismiss UI a scanned upload already gets.
 */
export default function TroveSearchSheet({ person, onAddAsDocument, onClose }) {
  const [name, setName] = useState(person?.display_name || '');
  const [place, setPlace] = useState(person?.birth_place || person?.residence || '');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [addingId, setAddingId] = useState(null);

  const runSearch = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    setResults(null);
    const found = await searchTrove({ name, place });
    setLoading(false);
    if (found === null) {
      setError('Could not search Trove right now — try again in a moment.');
      return;
    }
    setResults(found);
  };

  const handleAdd = async (candidate) => {
    setAddingId(candidate.id);
    try {
      await onAddAsDocument?.(candidate);
    } finally {
      setAddingId(null);
    }
  };

  return (
    <div className="sheet-scrim trove-search-scrim" role="dialog" aria-modal="true" aria-label="Search Trove" onClick={onClose}>
      <div className="sheet trove-search" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grip" />
        <div className="trove-search__head">
          <h2 className="trove-search__title"><TroveIcon /> Search Trove</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </div>
        <p className="trove-search__intro">
          Searches historic Australian newspapers, gazettes, and biographical records held by
          the National Library of Australia. Results are candidate matches to review — nothing
          is added to this profile until you choose to.
        </p>

        <form
          className="trove-search__form"
          onSubmit={(e) => { e.preventDefault(); runSearch(); }}
        >
          <input
            className="trove-search__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            aria-label="Name to search"
          />
          <input
            className="trove-search__input"
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            placeholder="Place (optional)"
            aria-label="Place to narrow the search"
          />
          <button type="submit" className="trove-search__go" disabled={loading || !name.trim()}>
            {loading ? <span className="mw__spinner mw__spinner--sm" aria-hidden="true" /> : 'Search'}
          </button>
        </form>

        {error && <p className="trove-search__error">{error}</p>}

        {results && results.length === 0 && !error && (
          <p className="trove-search__empty">No matches found — try a different spelling, or add a place to narrow it down.</p>
        )}

        {results && results.length > 0 && (
          <ul className="trove-search__results">
            {results.map((r) => (
              <li key={`${r.category}-${r.id}`} className="trove-result">
                <div className="trove-result__body">
                  <span className="trove-result__type">
                    {r.articleType || (r.category === 'people' ? 'People & Organisations' : r.category)}
                  </span>
                  <p className="trove-result__heading">{r.heading || 'Untitled'}</p>
                  <p className="trove-result__meta">
                    {[r.newspaper, r.date, r.page != null ? `p. ${r.page}` : null].filter(Boolean).join(' · ')}
                  </p>
                  {r.snippet && <p className="trove-result__snippet">{r.snippet}</p>}
                  <a href={r.troveUrl} target="_blank" rel="noreferrer" className="trove-result__link">
                    View on Trove ↗
                  </a>
                </div>
                {(r.category === 'newspaper' || r.category === 'gazette') && (
                  <button
                    className="trove-result__add"
                    onClick={() => handleAdd(r)}
                    disabled={addingId === r.id}
                  >
                    {addingId === r.id ? <span className="mw__spinner mw__spinner--sm" aria-hidden="true" /> : 'Add as document'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TroveIcon() {
  return (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6.5 12 3l8 3.5M4 6.5v11L12 21m-8-3.5L12 21m8-14.5v11L12 21m8-14.5L12 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>);
}
function CloseIcon() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>);
}

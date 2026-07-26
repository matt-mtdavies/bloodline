import { useEffect, useState } from 'react';
import { searchTrove } from '../lib/trove.js';
import { getRelevantArchives, buildArchiveUrl } from '../lib/externalArchives.js';
import { yearOf } from '../lib/dates.js';

const KIND_LABEL = {
  'civil-registration': 'Civil registration',
  archive: 'Archive',
  military: 'Military',
  commercial: 'Genealogy site',
  memorial: 'Memorial',
  newspapers: 'Newspapers',
};
const KIND_ICON = {
  'civil-registration': ScrollIcon,
  archive: ArchiveBoxIcon,
  military: RibbonIcon,
  commercial: CompassIcon,
  memorial: HeadstoneIcon,
  newspapers: TroveIcon,
};

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
 *
 * Below Trove's own live search, this sheet also lists OTHER archives worth
 * checking — deep links, not another data integration (see
 * lib/externalArchives.js's own header comment on why: no fetching,
 * storing, or reuse of anyone else's data, so none of the ToS/license
 * questions that came up for Trove/PROV apply here at all). Which archives
 * show up is inferred from the person's own place fields — an Australian
 * profile sees Australian civil-registration/archive/military sources, a
 * UK one sees UK sources, and so on; a few cross-cutting sources (CWGC,
 * the big commercial sites) always show regardless.
 */
export default function TroveSearchSheet({ person, onAddAsDocument, onClose }) {
  const [name, setName] = useState(person?.display_name || '');
  const [place, setPlace] = useState(person?.birth_place || person?.residence || '');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [addingId, setAddingId] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Trove itself is excluded from the "other archives" list below — it
  // already has its own dedicated live search right above in this same
  // sheet, so listing it again as a plain link would just read as a
  // confusing duplicate of the feature already on screen.
  const relevantArchives = getRelevantArchives(person).filter((a) => a.id !== 'trove');
  const archiveFields = {
    name,
    givenName: person?.given_names?.split(/\s+/)[0] || name.split(/\s+/)[0],
    surname: person?.family_name || name.split(/\s+/).slice(-1)[0],
    birthYear: yearOf(person?.birth_date),
  };
  // Country-specific groups first (in the order lib/externalArchives.js
  // lists them), a "General" group last for the cross-cutting entries —
  // reads as "here's what's specific to them, then everything else worth
  // trying regardless."
  const groups = [];
  for (const a of relevantArchives) {
    const key = a.country || 'General';
    let group = groups.find((g) => g.key === key);
    if (!group) { group = { key, items: [] }; groups.push(group); }
    group.items.push(a);
  }
  const COUNTRY_NAME = { AU: 'Australia', UK: 'United Kingdom', CA: 'Canada' };

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
    <div className="sheet-scrim trove-search-scrim" role="dialog" aria-modal="true" aria-label="Search archives" onClick={onClose}>
      <div className="sheet trove-search" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grip" />
        <div className="trove-search__head">
          <h2 className="trove-search__title"><TroveIcon /> Search archives</h2>
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
                    View on Trove <ArrowIcon />
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

        <div className="trove-search__other">
          <h3 className="trove-search__other-title">Other archives to check</h3>
          <p className="trove-search__other-note">
            These open in a new tab — nothing is fetched or stored here, you do your own
            reading on the source site.
          </p>
          {groups.map((group) => (
            <div className="trove-search__group" key={group.key}>
              <span className="trove-search__group-label">
                {group.key === 'General' ? 'General' : COUNTRY_NAME[group.key] || group.key}
              </span>
              <ul className="trove-search__other-list">
                {group.items.map((a) => {
                  const Icon = KIND_ICON[a.kind] || CompassIcon;
                  return (
                    <li key={a.id}>
                      <a
                        href={buildArchiveUrl(a, archiveFields)}
                        target="_blank"
                        rel="noreferrer"
                        className="trove-other"
                      >
                        <span className="trove-other__icon" aria-hidden="true"><Icon /></span>
                        <span className="trove-other__body">
                          <span className="trove-other__kind">{KIND_LABEL[a.kind] || a.kind}</span>
                          <span className="trove-other__label">{a.label}</span>
                          <span className="trove-other__desc">{a.description}</span>
                        </span>
                        <span className={`trove-other__action${a.prefill ? ' trove-other__action--search' : ''}`}>
                          {a.prefill ? 'Search' : 'Open'}
                          <ArrowIcon />
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
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
// Small, one-per-`kind` line icons for the "other archives" list — the same
// 18px outline style already used across the insights modules (thin 1.5–1.6
// stroke, rounded joins) rather than borrowing a filled/duotone set that
// would clash with the rest of this sheet.
function ScrollIcon() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 4h10a2 2 0 0 1 2 2v13a1.5 1.5 0 0 1-3 0V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M7 10h8M7 13h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>);
}
function ArchiveBoxIcon() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="4" rx="1.2" stroke="currentColor" strokeWidth="1.5" /><path d="M4.5 8.5v9a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-9" stroke="currentColor" strokeWidth="1.5" /><path d="M10 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>);
}
function RibbonIcon() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8.5" r="4.5" stroke="currentColor" strokeWidth="1.5" /><path d="M9 12.5 7 21l5-2.5 5 2.5-2-8.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>);
}
function CompassIcon() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.5" /><path d="m14.5 9.5-1.8 4.7a1 1 0 0 1-.5.5l-4.7 1.8 1.8-4.7a1 1 0 0 1 .5-.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>);
}
function HeadstoneIcon() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 21V11a6 6 0 0 1 12 0v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 21h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><path d="M12 8.5v4.5M9.75 10.75h4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>);
}
function ArrowIcon() {
  return (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>);
}

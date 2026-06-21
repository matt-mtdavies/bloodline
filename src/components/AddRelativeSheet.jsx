import { useEffect, useRef, useState, useMemo } from 'react';
import { RELATIONSHIPS, QUALIFIER_KEYS, bioParentGendersFilled } from '../data/store.js';

const QUALIFIERS = [
  { key: 'biological', label: 'Biological' },
  { key: 'step', label: 'Step' },
  { key: 'adoptive', label: 'Adopted' },
];

// Relationship types that support linking to an already-existing person.
const LINKABLE = new Set(['partner', 'ex_partner', 'mother', 'father', 'son', 'daughter', 'brother', 'sister']);

/*
 * Relationship-first add (§4): the only required answer is *who* they are to
 * the anchor person and their name — three seconds. Dates and "no longer with
 * us" are optional, revealed progressively so the form never feels like work.
 *
 * When the relationship type is linkable, a toggle lets the user pick an
 * existing person from the tree instead of creating a new one.
 */
export default function AddRelativeSheet({ anchor, people = [], relationships = [], onClose, onAdd, onLinkExisting }) {
  const [relKey, setRelKey] = useState(null);
  const [qualifier, setQualifier] = useState('biological');
  const [mode, setMode] = useState('new'); // 'new' | 'existing'
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [more, setMore] = useState(false);
  const [birthYear, setBirthYear] = useState('');
  const [deceased, setDeceased] = useState(false);
  const [deathYear, setDeathYear] = useState('');
  const nameRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Reset mode to 'new' when relationship type changes.
  const pickRel = (key) => {
    setRelKey(key);
    setQualifier('biological');
    setMode('new');
    setSearch('');
  };

  // Which bio-parent genders are already filled for the anchor.
  const filledGenders = useMemo(() => bioParentGendersFilled
    ? bioParentGendersFilled(anchor.id)
    : new Set(), [anchor.id]);

  // A relationship chip is disabled if adding it would violate a bio constraint.
  const isDisabled = (r) => {
    if (r.key === 'mother' && filledGenders.has('female')) return true;
    if (r.key === 'father' && filledGenders.has('male')) return true;
    return false;
  };

  // Already-linked person ids for duplicate-edge guard.
  const alreadyLinked = useMemo(() => {
    const ids = new Set();
    for (const rel of relationships) {
      if (rel.from_person === anchor.id) ids.add(rel.to_person);
      if (rel.to_person === anchor.id) ids.add(rel.from_person);
    }
    return ids;
  }, [relationships, anchor.id]);

  // Candidates for link-existing mode: filter by search, exclude anchor + already linked.
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter((p) => {
      if (alreadyLinked.has(p.id)) return false;
      if (!q) return true;
      return p.display_name.toLowerCase().includes(q);
    });
  }, [people, search, alreadyLinked]);

  const canAdd = relKey && name.trim().length > 0;
  const canLink = relKey && mode === 'existing';

  const submit = () => {
    if (!canAdd) return;
    onAdd({
      relKey,
      qualifier: QUALIFIER_KEYS.has(relKey) ? qualifier : 'biological',
      name,
      birth_date: birthYear.trim() || null,
      is_deceased: deceased,
      death_date: deceased ? deathYear.trim() || null : null,
    });
  };

  const linkTo = (personId) => {
    // Map relKey to the edge type expected by addRelationship.
    const type = relKey === 'partner' ? 'partner'
      : relKey === 'ex_partner' ? 'ex_partner'
      : (relKey === 'mother' || relKey === 'father') ? 'parent'
      : (relKey === 'son' || relKey === 'daughter') ? 'parent'
      : null;
    if (!type) return;
    // For parent edges the direction matters: parent is from_person, child is to_person.
    // When relKey is mother/father the existing person IS the parent of anchor.
    // When relKey is son/daughter the anchor IS the parent, existing is the child.
    if (relKey === 'mother' || relKey === 'father') {
      onLinkExisting?.(personId, type); // addRelationship(anchor, existing, 'parent') → existing is parent of anchor
      // But we need existing as parent → pass a flag via a wrapper that swaps the direction.
      // Simplest: use a different callback convention.
    } else {
      onLinkExisting?.(personId, type);
    }
  };

  // Simpler: pass relKey directly and let App decide direction.
  const linkToExisting = (personId) => {
    onLinkExisting?.(personId, relKey);
  };

  const firstName = anchor.display_name.split(/\s+/)[0];
  const showLinkToggle = relKey && LINKABLE.has(relKey) && people.length > 0;

  return (
    <div className="sheet-scrim sheet-scrim--modal" onClick={onClose}>
      <section
        className="sheet sheet--form"
        role="dialog"
        aria-modal="true"
        aria-label={`Add a relative of ${anchor.display_name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="form__head">
          <h2>Add to {firstName}&apos;s family</h2>
          <p className="form__sub">Who are they to {firstName}?</p>
        </header>

        <div className="chipgrid" role="radiogroup" aria-label="Relationship">
          {RELATIONSHIPS.map((r) => {
            const disabled = isDisabled(r);
            return (
              <button
                key={r.key}
                role="radio"
                aria-checked={relKey === r.key}
                aria-disabled={disabled}
                className={'chip' + (relKey === r.key ? ' chip--on' : '') + (disabled ? ' chip--disabled' : '')}
                onClick={() => !disabled && pickRel(r.key)}
                title={disabled ? `${firstName} already has a biological ${r.label.toLowerCase()}` : undefined}
              >
                {r.label}
              </button>
            );
          })}
        </div>

        {/* Mode toggle: new person vs link existing */}
        {showLinkToggle && (
          <div className="mode-toggle" role="group" aria-label="Add mode">
            <button
              className={'mode-tab' + (mode === 'new' ? ' mode-tab--on' : '')}
              onClick={() => { setMode('new'); setSearch(''); }}
            >
              New person
            </button>
            <button
              className={'mode-tab' + (mode === 'existing' ? ' mode-tab--on' : '')}
              onClick={() => { setMode('existing'); setTimeout(() => searchRef.current?.focus(), 50); }}
            >
              Already in tree
            </button>
          </div>
        )}

        {QUALIFIER_KEYS.has(relKey) && mode === 'new' && (
          <div className="qualifier-row" role="radiogroup" aria-label="Qualifier">
            {QUALIFIERS.map((q) => (
              <button
                key={q.key}
                role="radio"
                aria-checked={qualifier === q.key}
                className={'qualifier-chip' + (qualifier === q.key ? ' qualifier-chip--on' : '')}
                onClick={() => setQualifier(q.key)}
              >
                {q.label}
              </button>
            ))}
          </div>
        )}

        {/* New person form */}
        {mode === 'new' && (
          <div className={'form__reveal' + (relKey ? ' form__reveal--open' : '')}>
            <label className="field">
              <span className="field__label">Their name</span>
              <div className="input-wrap">
                <input
                  ref={nameRef}
                  className="field__input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                  placeholder="e.g. Margaret Davies"
                  autoComplete="off"
                />
                {name && <button type="button" className="input-clear" onClick={() => setName('')} aria-label="Clear" tabIndex={-1}>×</button>}
              </div>
            </label>

            {!more ? (
              <button className="link-btn" onClick={() => setMore(true)}>
                + Add a few details
              </button>
            ) : (
              <div className="form__more">
                <label className="field field--inline">
                  <span className="field__label">Born</span>
                  <div className="input-wrap">
                    <input
                      className="field__input field__input--year"
                      value={birthYear}
                      onChange={(e) => setBirthYear(e.target.value)}
                      placeholder="Year"
                      inputMode="numeric"
                    />
                    {birthYear && <button type="button" className="input-clear" onClick={() => setBirthYear('')} aria-label="Clear" tabIndex={-1}>×</button>}
                  </div>
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={deceased}
                    onChange={(e) => setDeceased(e.target.checked)}
                  />
                  <span>No longer with us</span>
                </label>
                {deceased && (
                  <label className="field field--inline">
                    <span className="field__label">Passed</span>
                    <div className="input-wrap">
                      <input
                        className="field__input field__input--year"
                        value={deathYear}
                        onChange={(e) => setDeathYear(e.target.value)}
                        placeholder="Year"
                        inputMode="numeric"
                      />
                      {deathYear && <button type="button" className="input-clear" onClick={() => setDeathYear('')} aria-label="Clear" tabIndex={-1}>×</button>}
                    </div>
                  </label>
                )}
              </div>
            )}
          </div>
        )}

        {/* Link existing person picker */}
        {mode === 'existing' && relKey && (
          <div className="link-existing">
            <div className="input-wrap link-existing__search">
              <input
                ref={searchRef}
                className="field__input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name…"
                autoComplete="off"
              />
              {search && <button type="button" className="input-clear" onClick={() => setSearch('')} aria-label="Clear" tabIndex={-1}>×</button>}
            </div>
            <ul className="link-existing__list" role="listbox">
              {candidates.length === 0 && (
                <li className="link-existing__empty">No matching people found</li>
              )}
              {candidates.map((p) => (
                <li key={p.id} role="option">
                  <button
                    className="link-existing__item"
                    onClick={() => linkToExisting(p.id)}
                  >
                    <span className="link-existing__name">{p.display_name}</span>
                    {p.birth_date && <span className="link-existing__date">b. {p.birth_date}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <footer className="sheet__foot">
          {mode === 'new' ? (
            <>
              <button className="btn btn--primary" disabled={!canAdd} onClick={submit}>
                {name.trim() ? `Add ${name.trim().split(/\s+/)[0]}` : 'Add'}
              </button>
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

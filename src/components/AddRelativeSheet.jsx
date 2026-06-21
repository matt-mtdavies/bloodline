import { useEffect, useRef, useState } from 'react';
import { RELATIONSHIPS, QUALIFIER_KEYS } from '../data/store.js';

const QUALIFIERS = [
  { key: 'biological', label: 'Biological' },
  { key: 'step', label: 'Step' },
  { key: 'adoptive', label: 'Adopted' },
];

export default function AddRelativeSheet({ anchor, people = [], onClose, onAdd }) {
  const [relKey, setRelKey] = useState(null);
  const [qualifier, setQualifier] = useState('biological');
  const [mode, setMode] = useState('new'); // 'new' | 'existing'
  const [name, setName] = useState('');
  const [more, setMore] = useState(false);
  const [birthYear, setBirthYear] = useState('');
  const [deceased, setDeceased] = useState(false);
  const [deathYear, setDeathYear] = useState('');
  const [search, setSearch] = useState('');
  const nameRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const canAdd = relKey && name.trim().length > 0;

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

  const submitExisting = (existingId) => {
    onAdd({
      relKey,
      qualifier: QUALIFIER_KEYS.has(relKey) ? qualifier : 'biological',
      existingId,
    });
  };

  const selectRel = (key) => {
    setRelKey(key);
    setQualifier('biological');
    setMode('new');
    setSearch('');
  };

  const filteredPeople = people.filter((p) =>
    p.display_name.toLowerCase().includes(search.toLowerCase()),
  );

  const firstName = anchor.display_name.split(/\s+/)[0];

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
          <h2>Add to {firstName}'s family</h2>
          <p className="form__sub">Who are they to {firstName}?</p>
        </header>

        <div className="chipgrid" role="radiogroup" aria-label="Relationship">
          {RELATIONSHIPS.map((r) => (
            <button
              key={r.key}
              role="radio"
              aria-checked={relKey === r.key}
              className={'chip' + (relKey === r.key ? ' chip--on' : '')}
              onClick={() => selectRel(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>

        {QUALIFIER_KEYS.has(relKey) && (
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

        {relKey && people.length > 0 && (
          <div className="mode-toggle" role="radiogroup" aria-label="Add mode">
            <button
              role="radio"
              aria-checked={mode === 'new'}
              className={'mode-toggle__btn' + (mode === 'new' ? ' mode-toggle__btn--on' : '')}
              onClick={() => setMode('new')}
            >
              New person
            </button>
            <button
              role="radio"
              aria-checked={mode === 'existing'}
              className={'mode-toggle__btn' + (mode === 'existing' ? ' mode-toggle__btn--on' : '')}
              onClick={() => { setMode('existing'); setSearch(''); }}
            >
              Already in tree
            </button>
          </div>
        )}

        {mode === 'existing' ? (
          <div className="existing-picker">
            <div className="input-wrap">
              <input
                className="field__input"
                placeholder="Search by name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
              {search && (
                <button type="button" className="input-clear" onClick={() => setSearch('')} tabIndex={-1}>×</button>
              )}
            </div>
            <div className="existing-picker__list">
              {filteredPeople.map((p) => (
                <button key={p.id} className="existing-picker__item" onClick={() => submitExisting(p.id)}>
                  <span className="existing-picker__name">{p.display_name}</span>
                  {p.birth_date && (
                    <span className="existing-picker__year">{p.birth_date.toString().slice(0, 4)}</span>
                  )}
                </button>
              ))}
              {filteredPeople.length === 0 && (
                <p className="existing-picker__empty">No matches</p>
              )}
            </div>
          </div>
        ) : (
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

        <footer className="sheet__foot">
          {mode === 'new' && (
            <button className="btn btn--primary" disabled={!canAdd} onClick={submit}>
              {name.trim() ? `Add ${name.trim().split(/\s+/)[0]}` : 'Add'}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </footer>
      </section>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { RELATIONSHIPS } from '../data/store.js';

/*
 * Relationship-first add (§4): the only required answer is *who* they are to
 * the anchor person and their name — three seconds. Dates and "no longer with
 * us" are optional, revealed progressively so the form never feels like work.
 */
export default function AddRelativeSheet({ anchor, onClose, onAdd }) {
  const [relKey, setRelKey] = useState(null);
  const [name, setName] = useState('');
  const [more, setMore] = useState(false);
  const [birthYear, setBirthYear] = useState('');
  const [deceased, setDeceased] = useState(false);
  const [deathYear, setDeathYear] = useState('');
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
      name,
      birth_date: birthYear.trim() || null,
      is_deceased: deceased,
      death_date: deceased ? deathYear.trim() || null : null,
    });
  };

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
          <h2>Add to {firstName}’s family</h2>
          <p className="form__sub">Who are they to {firstName}?</p>
        </header>

        <div className="chipgrid" role="radiogroup" aria-label="Relationship">
          {RELATIONSHIPS.map((r) => (
            <button
              key={r.key}
              role="radio"
              aria-checked={relKey === r.key}
              className={'chip' + (relKey === r.key ? ' chip--on' : '')}
              onClick={() => setRelKey(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className={'form__reveal' + (relKey ? ' form__reveal--open' : '')}>
          <label className="field">
            <span className="field__label">Their name</span>
            <input
              ref={nameRef}
              className="field__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="e.g. Margaret Davies"
              autoComplete="off"
            />
          </label>

          {!more ? (
            <button className="link-btn" onClick={() => setMore(true)}>
              + Add a few details
            </button>
          ) : (
            <div className="form__more">
              <label className="field field--inline">
                <span className="field__label">Born</span>
                <input
                  className="field__input field__input--year"
                  value={birthYear}
                  onChange={(e) => setBirthYear(e.target.value)}
                  placeholder="Year"
                  inputMode="numeric"
                />
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
                  <input
                    className="field__input field__input--year"
                    value={deathYear}
                    onChange={(e) => setDeathYear(e.target.value)}
                    placeholder="Year"
                    inputMode="numeric"
                  />
                </label>
              )}
            </div>
          )}
        </div>

        <footer className="sheet__foot">
          <button className="btn btn--primary" disabled={!canAdd} onClick={submit}>
            {name.trim() ? `Add ${name.trim().split(/\s+/)[0]}` : 'Add'}
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </footer>
      </section>
    </div>
  );
}

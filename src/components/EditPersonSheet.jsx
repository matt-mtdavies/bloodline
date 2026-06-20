import { useEffect, useState } from 'react';

/*
 * Edit a person. Still progressive in spirit — every field is optional — but
 * laid out cleanly so updating a date or adding a story is effortless.
 */
export default function EditPersonSheet({ person, onClose, onSave }) {
  const [f, setF] = useState({
    display_name: person.display_name || '',
    gender: person.gender || '',
    birth_date: person.birth_date || '',
    birth_place: person.birth_place || '',
    bio: person.bio || '',
    is_deceased: !!person.is_deceased,
    death_date: person.death_date || '',
  });

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const save = () => {
    onSave({
      display_name: f.display_name.trim() || person.display_name,
      gender: f.gender.trim() || null,
      birth_date: f.birth_date.trim() || null,
      birth_place: f.birth_place.trim() || null,
      bio: f.bio.trim() || null,
      is_deceased: f.is_deceased,
      is_living: !f.is_deceased,
      death_date: f.is_deceased ? f.death_date.trim() || null : null,
    });
  };

  return (
    <div className="sheet-scrim sheet-scrim--modal" onClick={onClose}>
      <section
        className="sheet sheet--form"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${person.display_name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="form__head">
          <h2>Edit details</h2>
        </header>

        <div className="form__fields">
          <label className="field">
            <span className="field__label">Name</span>
            <input className="field__input" value={f.display_name} onChange={set('display_name')} />
          </label>

          <div className="field-row">
            <label className="field">
              <span className="field__label">Born</span>
              <input
                className="field__input"
                value={f.birth_date}
                onChange={set('birth_date')}
                placeholder="Year or 1985-04-12"
              />
            </label>
            <label className="field">
              <span className="field__label">Gender</span>
              <input
                className="field__input"
                value={f.gender}
                onChange={set('gender')}
                placeholder="Optional"
              />
            </label>
          </div>

          <label className="field">
            <span className="field__label">Birthplace</span>
            <input
              className="field__input"
              value={f.birth_place}
              onChange={set('birth_place')}
              placeholder="e.g. Cardiff, Wales"
            />
          </label>

          <label className="toggle">
            <input
              type="checkbox"
              checked={f.is_deceased}
              onChange={(e) => setF((s) => ({ ...s, is_deceased: e.target.checked }))}
            />
            <span>No longer with us</span>
          </label>
          {f.is_deceased && (
            <label className="field">
              <span className="field__label">Passed</span>
              <input
                className="field__input"
                value={f.death_date}
                onChange={set('death_date')}
                placeholder="Year"
              />
            </label>
          )}

          <label className="field">
            <span className="field__label">A memory or story</span>
            <textarea
              className="field__input field__input--area"
              rows={4}
              value={f.bio}
              onChange={set('bio')}
              placeholder="Something only you would know…"
            />
          </label>
        </div>

        <footer className="sheet__foot">
          <button className="btn btn--primary" onClick={save}>
            Save
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </footer>
      </section>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { VISIBILITY_LABELS, VISIBILITY_DESCS, SECTIONS } from '../lib/visibility.js';

/*
 * Edit a person. Still progressive in spirit — every field is optional — but
 * laid out cleanly so updating a date or adding a story is effortless.
 * Includes a Privacy section for visibility and per-section controls.
 */
export default function EditPersonSheet({ person, onClose, onSave, onDelete }) {
  const [f, setF] = useState({
    display_name: person.display_name || '',
    gender: person.gender || '',
    birth_date: person.birth_date || '',
    birth_place: person.birth_place || '',
    residence: person.residence || '',
    occupation: person.occupation || '',
    tags: (person.tags || []).join(', '),
    bio: person.bio || '',
    is_deceased: !!person.is_deceased,
    death_date: person.death_date || '',
    visibility: person.visibility || 'full',
    sectionVisibility: person.sectionVisibility || {},
  });
  const [privacyOpen, setPrivacyOpen] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const clear = (k) => () => setF((s) => ({ ...s, [k]: '' }));

  const save = () => {
    onSave({
      display_name: f.display_name.trim() || person.display_name,
      gender: f.gender.trim() || null,
      birth_date: f.birth_date.trim() || null,
      birth_place: f.birth_place.trim() || null,
      residence: f.residence.trim() || null,
      occupation: f.occupation.trim() || null,
      tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
      bio: f.bio.trim() || null,
      is_deceased: f.is_deceased,
      is_living: !f.is_deceased,
      death_date: f.is_deceased ? f.death_date.trim() || null : null,
      visibility: f.visibility,
      sectionVisibility: f.sectionVisibility,
    });
  };

  const toggleSection = (key) =>
    setF((s) => ({
      ...s,
      sectionVisibility: { ...s.sectionVisibility, [key]: s.sectionVisibility[key] === false },
    }));

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
            <div className="input-wrap">
              <input className="field__input" value={f.display_name} onChange={set('display_name')} />
              {f.display_name && <button type="button" className="input-clear" onClick={clear('display_name')} aria-label="Clear" tabIndex={-1}>×</button>}
            </div>
          </label>

          <div className="field-row">
            <label className="field">
              <span className="field__label">Born</span>
              <div className="input-wrap">
                <input className="field__input" value={f.birth_date} onChange={set('birth_date')} placeholder="Year or 1985-04-12" />
                {f.birth_date && <button type="button" className="input-clear" onClick={clear('birth_date')} aria-label="Clear" tabIndex={-1}>×</button>}
              </div>
            </label>
            <label className="field">
              <span className="field__label">Gender</span>
              <div className="input-wrap">
                <input className="field__input" value={f.gender} onChange={set('gender')} placeholder="Optional" />
                {f.gender && <button type="button" className="input-clear" onClick={clear('gender')} aria-label="Clear" tabIndex={-1}>×</button>}
              </div>
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span className="field__label">Birthplace</span>
              <div className="input-wrap">
                <input className="field__input" value={f.birth_place} onChange={set('birth_place')} placeholder="e.g. Cardiff, Wales" />
                {f.birth_place && <button type="button" className="input-clear" onClick={clear('birth_place')} aria-label="Clear" tabIndex={-1}>×</button>}
              </div>
            </label>
            <label className="field">
              <span className="field__label">Lives in</span>
              <div className="input-wrap">
                <input className="field__input" value={f.residence} onChange={set('residence')} placeholder="Optional" />
                {f.residence && <button type="button" className="input-clear" onClick={clear('residence')} aria-label="Clear" tabIndex={-1}>×</button>}
              </div>
            </label>
          </div>

          <label className="field">
            <span className="field__label">Occupation</span>
            <div className="input-wrap">
              <input className="field__input" value={f.occupation} onChange={set('occupation')} placeholder="e.g. Architect" />
              {f.occupation && <button type="button" className="input-clear" onClick={clear('occupation')} aria-label="Clear" tabIndex={-1}>×</button>}
            </div>
          </label>

          <label className="field">
            <span className="field__label">Tags</span>
            <div className="input-wrap">
              <input className="field__input" value={f.tags} onChange={set('tags')} placeholder="Veteran, Teacher, Immigrant" />
              {f.tags && <button type="button" className="input-clear" onClick={clear('tags')} aria-label="Clear" tabIndex={-1}>×</button>}
            </div>
            <span className="field__hint">Separate with commas</span>
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
              <div className="input-wrap">
                <input className="field__input" value={f.death_date} onChange={set('death_date')} placeholder="Year" />
                {f.death_date && <button type="button" className="input-clear" onClick={clear('death_date')} aria-label="Clear" tabIndex={-1}>×</button>}
              </div>
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

          {/* Privacy */}
          <div className="field privacy-section">
            <button
              type="button"
              className="privacy-section__toggle"
              onClick={() => setPrivacyOpen((o) => !o)}
              aria-expanded={privacyOpen}
            >
              <span>🔒 Privacy</span>
              <span className="privacy-section__cur">{VISIBILITY_LABELS[f.visibility]}</span>
              <span className="privacy-section__caret">{privacyOpen ? '▲' : '▼'}</span>
            </button>

            {privacyOpen && (
              <div className="privacy-section__body">
                <p className="field__hint" style={{ marginBottom: 12 }}>
                  Controls what family members with Viewer or Contributor roles can see.
                  Owners and Co-Admins always see everything.
                </p>

                <div className="vis-opts">
                  {Object.entries(VISIBILITY_LABELS).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      className={`vis-opt${f.visibility === val ? ' vis-opt--on' : ''}`}
                      onClick={() => setF((s) => ({ ...s, visibility: val }))}
                    >
                      <span className="vis-opt__label">{label}</span>
                      <span className="vis-opt__desc">{VISIBILITY_DESCS[val]}</span>
                    </button>
                  ))}
                </div>

                {f.visibility === 'full' && (
                  <div className="section-vis">
                    <p className="field__label" style={{ marginBottom: 8 }}>Section visibility</p>
                    {SECTIONS.map(({ key, label }) => (
                      <label key={key} className="toggle">
                        <input
                          type="checkbox"
                          checked={f.sectionVisibility[key] !== false}
                          onChange={() => toggleSection(key)}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <footer className="sheet__foot">
          <button className="btn btn--primary" onClick={save}>
            Save
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </footer>

        {onDelete && (
          <div className="edit-danger">
            <button
              type="button"
              className="edit-danger__btn"
              onClick={() => {
                if (window.confirm(`Remove ${person.display_name} from the tree? This cannot be undone.`)) {
                  onDelete(person.id);
                }
              }}
            >
              Remove {person.display_name.split(' ')[0]} from tree
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

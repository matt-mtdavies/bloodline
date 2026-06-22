import { useEffect, useState } from 'react';
import { VISIBILITY_LABELS, VISIBILITY_DESCS, SECTIONS } from '../lib/visibility.js';

/*
 * Edit a person. Still progressive in spirit — every field is optional — but
 * laid out cleanly so updating a date or adding a story is effortless.
 * Includes a Privacy section for visibility and per-section controls.
 */
export default function EditPersonSheet({ person, onClose, onSave, onRemove }) {
  const [f, setF] = useState({
    display_name: person.display_name || '',
    gender: person.gender || '',
    birth_date: person.birth_date || '',
    birth_place: person.birth_place || '',
    residence: person.residence || '',
    occupation: person.occupation || '',
    email: person.email || '',
    phone: person.phone || '',
    tags: (person.tags || []).join(', '),
    bio: person.bio || '',
    is_deceased: !!person.is_deceased,
    death_date: person.death_date || '',
    visibility: person.visibility || 'full',
    sectionVisibility: person.sectionVisibility || {},
  });
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

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
      email: f.email.trim() || null,
      phone: f.phone.trim() || null,
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

          {!f.is_deceased && (
            <div className="field-row">
              <label className="field">
                <span className="field__label">Email</span>
                <div className="input-wrap">
                  <input className="field__input" type="email" inputMode="email" value={f.email} onChange={set('email')} placeholder="their@email.com" autoComplete="off" />
                  {f.email && <button type="button" className="input-clear" onClick={clear('email')} aria-label="Clear" tabIndex={-1}>×</button>}
                </div>
              </label>
              <label className="field">
                <span className="field__label">Phone</span>
                <div className="input-wrap">
                  <input className="field__input" type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} placeholder="+44 7700…" autoComplete="off" />
                  {f.phone && <button type="button" className="input-clear" onClick={clear('phone')} aria-label="Clear" tabIndex={-1}>×</button>}
                </div>
              </label>
            </div>
          )}

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
              <span className="privacy-section__label"><LockIcon /> Privacy</span>
              <span className="privacy-section__cur">{VISIBILITY_LABELS[f.visibility]}</span>
              <span className="privacy-section__caret"><ChevronIcon open={privacyOpen} /></span>
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
          {confirmRemove ? (
            <>
              <span className="remove-confirm-text">Remove {person.display_name} from the tree?</span>
              <button className="btn btn--danger" onClick={onRemove}>Yes, remove</button>
              <button className="btn" onClick={() => setConfirmRemove(false)}>Keep</button>
            </>
          ) : (
            <>
              <button className="btn btn--primary" onClick={save}>Save</button>
              <button className="btn" onClick={onClose}>Cancel</button>
              {onRemove && (
                <button className="btn btn--remove" onClick={() => setConfirmRemove(true)}>
                  Remove from tree
                </button>
              )}
            </>
          )}
        </footer>
      </section>
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.7"/>
      <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
    </svg>
  );
}

function ChevronIcon({ open }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"
      style={{ flexShrink: 0, transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }}>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

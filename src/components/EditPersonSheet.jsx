import { useEffect, useState } from 'react';
import { VISIBILITY_LABELS, VISIBILITY_DESCS, SECTIONS } from '../lib/visibility.js';
import { formatPhone } from '../lib/phone.js';
import { formatDate } from '../lib/dates.js';
import Avatar from './Avatar.jsx';
import PhoneField from './PhoneField.jsx';
import DateField from './DateField.jsx';

const GENDER_OPTIONS = ['Male', 'Female', 'Non-binary', 'Other'];

const EYE_OPTIONS = [
  { value: 'Brown',  dot: '#6b4226' },
  { value: 'Blue',   dot: '#4a7fbf' },
  { value: 'Green',  dot: '#3d8c55' },
  { value: 'Hazel',  dot: '#8b6914' },
  { value: 'Grey',   dot: '#8a9099' },
  { value: 'Amber',  dot: '#c8860a' },
  { value: 'Other',  dot: null },
];

const HAIR_OPTIONS = [
  { value: 'Black',  dot: '#1a1a1a' },
  { value: 'Brown',  dot: '#6b4226' },
  { value: 'Blonde', dot: '#d4b483' },
  { value: 'Auburn', dot: '#9b3a1e' },
  { value: 'Red',    dot: '#c0392b' },
  { value: 'Grey',   dot: '#9e9e9e' },
  { value: 'White',  dot: '#ddd', dotBorder: true },
  { value: 'Other',  dot: null },
];

const TODAY = new Date().toISOString().slice(0, 10);

/*
 * Validate email loosely — only flag on blur if it looks wrong.
 */
function isValidEmail(v) {
  return !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}

export default function EditPersonSheet({ person, onClose, onSave, onRemove, startInEdit = false }) {
  // Opens on a read-only "Profile" view — birthday, birthplace, contact info,
  // etc. are all visible without entering edit mode. "Edit profile" switches
  // to the actual form below; cancelling the form returns to the view rather
  // than closing outright. startInEdit skips straight to the form — used
  // right after creating a person via "Add & edit details", where a view of
  // an almost-empty profile isn't the point, filling it in is.
  const [mode, setMode] = useState(startInEdit ? 'edit' : 'view'); // 'view' | 'edit'
  const [f, setF] = useState({
    display_name:  person.display_name  || '',
    middle_name:   person.middle_name   || '',
    birth_name:    person.birth_name    || '',
    gender:        person.gender        || '',
    birth_date:    person.birth_date    || '',
    birth_place:   person.birth_place   || '',
    residence:     person.residence     || '',
    occupation:    person.occupation    || '',
    eye_color:     person.eye_color     || '',
    hair_color:    person.hair_color    || '',
    email:         person.email         || '',
    phone:         person.phone         || '',
    tags:          (person.tags || []).join(', '),
    bio:           person.bio           || '',
    is_deceased:   !!person.is_deceased,
    death_date:    person.death_date    || '',
    cause_of_death: person.cause_of_death || '',
    visibility:        person.visibility        || 'full',
    sectionVisibility: person.sectionVisibility || {},
  });

  const [emailError,   setEmailError]   = useState(false);
  const [privacyOpen,  setPrivacyOpen]  = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (mode === 'edit') setMode('view');
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, mode]);

  const set  = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const clear = (k) => () => setF((s) => ({ ...s, [k]: '' }));
  const pick  = (k) => (v) => setF((s) => ({ ...s, [k]: s[k] === v ? '' : v }));

  const dobIsFullDate = f.birth_date.includes('-');
  const dobYearOnly   = f.birth_date && !dobIsFullDate;

  const onDobChange = (value) => setF((s) => ({ ...s, birth_date: value }));

  const save = () => {
    onSave({
      display_name:  f.display_name.trim()  || person.display_name,
      middle_name:   f.middle_name.trim()   || null,
      birth_name:    f.birth_name.trim()    || null,
      gender:        f.gender               || null,
      birth_date:    f.birth_date.trim()    || null,
      birth_place:   f.birth_place.trim()   || null,
      residence:     f.residence.trim()     || null,
      occupation:    f.occupation.trim()    || null,
      eye_color:     f.eye_color            || null,
      hair_color:    f.hair_color           || null,
      email:         f.email.trim()         || null,
      phone:         f.phone                || null,
      tags:          f.tags.split(',').map((t) => t.trim()).filter(Boolean),
      bio:           f.bio.trim()           || null,
      is_deceased:   f.is_deceased,
      is_living:     !f.is_deceased,
      death_date:    f.is_deceased ? f.death_date.trim() || null : null,
      cause_of_death: f.is_deceased ? f.cause_of_death.trim() || null : null,
      visibility:        f.visibility,
      sectionVisibility: f.sectionVisibility,
    });
  };

  const toggleSection = (key) =>
    setF((s) => ({
      ...s,
      sectionVisibility: { ...s.sectionVisibility, [key]: s.sectionVisibility[key] !== false ? false : undefined },
    }));

  if (mode === 'view') {
    const sections = [
      {
        title: 'Identity',
        rows: [
          ['Middle name', person.middle_name],
          ['Birth name', person.birth_name],
          ['Gender', person.gender],
          ['Date of birth', person.birth_date ? formatDate(person.birth_date) : null],
          ...(person.is_deceased ? [
            ['Date passed', person.death_date ? formatDate(person.death_date) : null],
            ['Cause of death', person.cause_of_death],
          ] : []),
        ],
      },
      {
        title: 'Life',
        rows: [
          ['Birthplace', person.birth_place],
          ['Lives in', person.residence],
          ['Occupation', person.occupation],
        ],
      },
      {
        title: 'Appearance',
        rows: [
          ['Hair colour', person.hair_color],
          ['Eye colour', person.eye_color],
        ],
      },
      {
        title: 'Contact',
        rows: [
          ['Email', person.email],
          ['Phone', person.phone ? formatPhone(person.phone) : null],
        ],
      },
    ]
      .map((s) => ({ ...s, rows: s.rows.filter(([, value]) => !!value) }))
      .filter((s) => s.rows.length);

    const hasAnything = sections.length || person.tags?.length || person.bio;

    return (
      <div className="sheet-scrim sheet-scrim--modal" onClick={onClose}>
        <section
          className="sheet sheet--form"
          role="dialog"
          aria-modal="true"
          aria-label={`${person.display_name} profile`}
          onClick={(e) => e.stopPropagation()}
        >
          <header className="form__head">
            <h2>Profile</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <CloseIcon />
            </button>
          </header>

          <div className="profile-view__hero">
            <Avatar person={person} size={52} />
            <span className="profile-view__hero-name">{person.display_name}</span>
          </div>

          {hasAnything ? (
            <div className="profile-view">
              {sections.map((s) => (
                <div className="profile-view__section" key={s.title}>
                  <h3 className="profile-section__title">{s.title}</h3>
                  {s.rows.map(([label, value]) => (
                    <div className="profile-view__row" key={label}>
                      <span className="profile-view__label">{label}</span>
                      <span className="profile-view__value">{value}</span>
                    </div>
                  ))}
                </div>
              ))}

              {person.tags?.length > 0 && (
                <div className="profile-view__section">
                  <h3 className="profile-section__title">Tags</h3>
                  <ul className="chipgrid">
                    {person.tags.map((t) => (
                      <li className="tag" key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}

              {person.bio && (
                <div className="profile-view__section">
                  <h3 className="profile-section__title">A memory or story</h3>
                  <p className="profile__about">{person.bio}</p>
                </div>
              )}
            </div>
          ) : (
            <p className="profile-view__empty">No details added yet.</p>
          )}

          <footer className="sheet__foot">
            <button className="btn btn--primary" onClick={() => setMode('edit')}>
              <PencilIcon /> Edit profile
            </button>
          </footer>
        </section>
      </div>
    );
  }

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
          <button type="button" className="icon-btn form__back" onClick={() => setMode('view')} aria-label="Back to profile">
            <BackIcon />
          </button>
          <h2>Edit details</h2>
        </header>

        <div className="form__fields">

          {/* ── Name ── */}
          <label className="field">
            <span className="field__label">Name</span>
            <div className="input-wrap">
              <input className="field__input" value={f.display_name} onChange={set('display_name')} />
              {f.display_name && <button type="button" className="input-clear" onClick={clear('display_name')} aria-label="Clear" tabIndex={-1}>×</button>}
            </div>
          </label>

          <label className="field">
            <span className="field__label">Middle name <span className="field__label-sub">optional</span></span>
            <div className="input-wrap">
              <input className="field__input" value={f.middle_name} onChange={set('middle_name')} placeholder="e.g. James" />
              {f.middle_name && <button type="button" className="input-clear" onClick={clear('middle_name')} aria-label="Clear" tabIndex={-1}>×</button>}
            </div>
          </label>

          <label className="field">
            <span className="field__label">Birth name <span className="field__label-sub">/ maiden name</span></span>
            <div className="input-wrap">
              <input className="field__input" value={f.birth_name} onChange={set('birth_name')} placeholder="If different from current name" />
              {f.birth_name && <button type="button" className="input-clear" onClick={clear('birth_name')} aria-label="Clear" tabIndex={-1}>×</button>}
            </div>
          </label>

          {/* ── DOB + Gender ── */}
          <div className="field-row">
            <label className="field">
              <span className="field__label">Date of Birth</span>
              <div className="input-wrap dob-wrap">
                <DateField value={f.birth_date} max={TODAY} onChange={onDobChange} />
                {f.birth_date && (
                  <button type="button" className="input-clear" onClick={clear('birth_date')} aria-label="Clear" tabIndex={-1}>×</button>
                )}
              </div>
              {dobYearOnly && (
                <span className="field__hint">Year {f.birth_date} — pick full date for exact age</span>
              )}
            </label>

            <label className="field">
              <span className="field__label">Gender</span>
              <div className="pill-pick pill-pick--gender">
                {GENDER_OPTIONS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={`pill-pick__opt${f.gender === g ? ' pill-pick__opt--on' : ''}`}
                    onClick={() => pick('gender')(g)}
                  >{g}</button>
                ))}
              </div>
            </label>
          </div>

          {/* ── Birthplace + Lives in ── */}
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
                <input className="field__input" value={f.residence} onChange={set('residence')} placeholder="City, Country" />
                {f.residence && <button type="button" className="input-clear" onClick={clear('residence')} aria-label="Clear" tabIndex={-1}>×</button>}
              </div>
            </label>
          </div>

          {/* ── Hair + Eye colour ── */}
          <div className="field-row">
            <label className="field">
              <span className="field__label">Hair colour</span>
              <div className="pill-pick pill-pick--colors">
                {HAIR_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={`pill-pick__opt${f.hair_color === o.value ? ' pill-pick__opt--on' : ''}`}
                    onClick={() => pick('hair_color')(o.value)}
                  >
                    {o.dot && (
                      <span
                        className="pill-pick__dot"
                        style={{ background: o.dot, boxShadow: o.dotBorder ? 'inset 0 0 0 1px #ccc' : undefined }}
                      />
                    )}
                    {o.value}
                  </button>
                ))}
              </div>
            </label>

            <label className="field">
              <span className="field__label">Eye colour</span>
              <div className="pill-pick pill-pick--colors">
                {EYE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={`pill-pick__opt${f.eye_color === o.value ? ' pill-pick__opt--on' : ''}`}
                    onClick={() => pick('eye_color')(o.value)}
                  >
                    {o.dot && (
                      <span className="pill-pick__dot" style={{ background: o.dot }} />
                    )}
                    {o.value}
                  </button>
                ))}
              </div>
            </label>
          </div>

          {/* ── Occupation ── */}
          <label className="field">
            <span className="field__label">Occupation</span>
            <div className="input-wrap">
              <input className="field__input" value={f.occupation} onChange={set('occupation')} placeholder="e.g. Architect" />
              {f.occupation && <button type="button" className="input-clear" onClick={clear('occupation')} aria-label="Clear" tabIndex={-1}>×</button>}
            </div>
          </label>

          {/* ── Email ── */}
          {!f.is_deceased && (
            <label className="field">
              <span className="field__label">Email</span>
              <div className={`input-wrap${emailError ? ' input-wrap--err' : ''}`}>
                <input
                  className="field__input"
                  type="email"
                  inputMode="email"
                  value={f.email}
                  onChange={(e) => { setEmailError(false); set('email')(e); }}
                  onBlur={() => setEmailError(!isValidEmail(f.email))}
                  placeholder="their@email.com"
                  autoComplete="off"
                />
                {f.email && <button type="button" className="input-clear" onClick={() => { clear('email')(); setEmailError(false); }} aria-label="Clear" tabIndex={-1}>×</button>}
              </div>
              {emailError && <span className="field__err">Enter a valid email address</span>}
            </label>
          )}

          {/* ── Phone (full width — a country selector + national number needs the room) ── */}
          {!f.is_deceased && (
            <label className="field">
              <span className="field__label">Phone</span>
              <PhoneField
                value={f.phone}
                residence={f.residence}
                onChange={(e164) => setF((s) => ({ ...s, phone: e164 }))}
              />
            </label>
          )}

          {/* ── Tags ── */}
          <label className="field">
            <span className="field__label">Tags</span>
            <div className="input-wrap">
              <input className="field__input" value={f.tags} onChange={set('tags')} placeholder="Veteran, Teacher, Immigrant" />
              {f.tags && <button type="button" className="input-clear" onClick={clear('tags')} aria-label="Clear" tabIndex={-1}>×</button>}
            </div>
            <span className="field__hint">Separate with commas</span>
          </label>

          {/* ── Deceased ── */}
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
              <span className="field__label">Date Passed</span>
              <div className="input-wrap dob-wrap">
                <DateField
                  value={f.death_date}
                  max={TODAY}
                  onChange={(value) => setF((s) => ({ ...s, death_date: value }))}
                />
                {f.death_date && <button type="button" className="input-clear" onClick={clear('death_date')} aria-label="Clear" tabIndex={-1}>×</button>}
              </div>
              {f.death_date && !f.death_date.includes('-') && (
                <span className="field__hint">Year {f.death_date} — pick date for precision</span>
              )}
            </label>
          )}
          {f.is_deceased && (
            <label className="field">
              <span className="field__label">Cause of death <span className="field__label-sub">optional</span></span>
              <div className="input-wrap">
                <input className="field__input" value={f.cause_of_death} onChange={set('cause_of_death')} placeholder="e.g. Heart disease" />
                {f.cause_of_death && <button type="button" className="input-clear" onClick={clear('cause_of_death')} aria-label="Clear" tabIndex={-1}>×</button>}
              </div>
            </label>
          )}

          {/* ── Bio ── */}
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

          {/* ── Privacy ── */}
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
              <button className="btn" onClick={() => setMode('view')}>Cancel</button>
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

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 20h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
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

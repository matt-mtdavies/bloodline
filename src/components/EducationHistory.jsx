import { useState } from 'react';
import { geocodePlace, geoFields } from '../lib/places.js';
import { EDUCATION_STAGES, resolveStageLabel } from '../lib/educationTerms.js';

// Stages that plausibly have a named degree or trade/field of study — a
// primary or secondary stage never does, so the form only asks for it
// where it makes sense, matching the fields the user actually described.
const STAGES_WITH_FIELD_OF_STUDY = new Set(['trade', 'university']);

/*
 * Education History — a chronological, multi-stage record of schooling
 * (primary/secondary/trade/university), replacing the earlier plain
 * `education` text field with real structure: stage, institution, degree/
 * field of study, location, years attended, and an optional personal note.
 *
 * Deliberately NOT the wave-timeline pattern already used three times on
 * this profile (Places Lived, Military Service, Ancestry Story) — explicit
 * feedback was that a fourth instance of the same visual theme was too
 * much. Instead: a vertical "ladder" of full stage cards connected by one
 * solid spine, with a distinct icon per stage (satchel/book/tool/cap)
 * carrying the sense of progression instead of geometry doing the work.
 * Every card shows its full detail inline — unlike the waypoint chips
 * elsewhere, there's no separate shared detail panel to tap into, since a
 * handful of life stages (rarely more than 3-4) is fine to show in full.
 *
 * Stage terminology is resolved PER ENTRY from its own geocoded country
 * (lib/educationTerms.js) — "Primary School" in Australia, "Elementary
 * School" in Canada — not a per-viewer preference like kinTerms.js, since
 * the correct term is tied to where the schooling actually happened.
 * Location is a single free-text box (unlike Places Lived's suburb/state
 * split) — best-effort geocoded on save the same way (lib/places.js), the
 * resolved country silently driving the stage label; the typed text is
 * always what's shown, geocoding only ever adds the country behind it.
 */
export default function EducationHistory({ person, canEdit, onAdd, onUpdate, onRemove }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState(null);

  const entries = [...(person.education || [])].sort((a, b) => {
    if (a.from_year == null) return 1;
    if (b.from_year == null) return -1;
    return a.from_year - b.from_year;
  });

  const handleAdd = async (fields) => {
    setAdding(false);
    const geo = await geocodePlace(fields.location);
    const geoResolved = geoFields(geo, {});
    onAdd({ ...fields, location: fields.location, country: geoResolved.country, lat: geoResolved.lat, lon: geoResolved.lon });
  };

  const handleUpdate = async (id, fields) => {
    setEditingId(null);
    const geo = await geocodePlace(fields.location);
    const geoResolved = geoFields(geo, {});
    onUpdate(id, { ...fields, location: fields.location, country: geoResolved.country, lat: geoResolved.lat, lon: geoResolved.lon });
  };

  const handleRemove = (id) => {
    onRemove(id);
    setConfirmRemoveId(null);
  };

  return (
    <section className="profile-section">
      <div className="profile-section__head">
        <h3 className="profile-section__title">
          Education{entries.length > 0 ? ` · ${entries.length}` : ''}
        </h3>
        {canEdit && !adding && (
          <button className="section-edit" onClick={() => { setAdding(true); setEditingId(null); }}>Add</button>
        )}
      </div>

      {entries.length > 0 && (
        <div className="education-ladder">
          {entries.map((entry) => (
            <div className="education-rung" key={entry.id}>
              <span className="education-rung__icon" aria-hidden="true">
                <StageIcon stage={entry.stage} />
              </span>
              {editingId === entry.id ? (
                <div className="education-rung__card">
                  <EducationForm
                    initial={entry}
                    onCancel={() => setEditingId(null)}
                    onSubmit={(fields) => handleUpdate(entry.id, fields)}
                  />
                </div>
              ) : (
                <div className="education-rung__card">
                  <p className="education-rung__kicker">{resolveStageLabel(entry.stage, entry.country)}</p>
                  <p className="education-rung__institution">{entry.institution}</p>
                  {entry.field_of_study && <p className="education-rung__field">{entry.field_of_study}</p>}
                  <p className="education-rung__meta">
                    {[entry.location, formatRange(entry.from_year, entry.to_year)].filter(Boolean).join(' · ')}
                  </p>
                  {entry.note && <p className="education-rung__note">{entry.note}</p>}
                  {canEdit && (
                    confirmRemoveId === entry.id ? (
                      <div className="places-detail__confirm">
                        <span>Remove this stage?</span>
                        <div className="places-detail__confirm-btns">
                          <button className="doc-card__confirm-remove" onClick={() => handleRemove(entry.id)}>Remove</button>
                          <button className="doc-card__confirm-cancel" onClick={() => setConfirmRemoveId(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="places-detail__actions">
                        <button className="places-detail__edit" onClick={() => { setEditingId(entry.id); setAdding(false); }} aria-label={`Edit ${entry.institution}`}>
                          <PencilIcon />
                        </button>
                        <button className="places-detail__del" onClick={() => setConfirmRemoveId(entry.id)} aria-label={`Remove ${entry.institution}`}>
                          <CloseIcon />
                        </button>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="places-detail">
          <EducationForm onCancel={() => setAdding(false)} onSubmit={handleAdd} />
        </div>
      )}

      {entries.length === 0 && !adding && (
        canEdit ? (
          <button className="empty-add" onClick={() => setAdding(true)}>
            <PlusIcon />
            Add a school or stage of education
          </button>
        ) : (
          <p className="profile-section__empty">No education history recorded yet</p>
        )
      )}
    </section>
  );
}

function formatRange(fromYear, toYear) {
  if (fromYear == null) return null;
  return toYear ? `${fromYear}–${toYear}` : `${fromYear}–present`;
}

function EducationForm({ initial, onCancel, onSubmit }) {
  const [stage, setStage] = useState(initial?.stage || 'primary');
  const [institution, setInstitution] = useState(initial?.institution || '');
  const [fieldOfStudy, setFieldOfStudy] = useState(initial?.field_of_study || '');
  const [location, setLocation] = useState(initial?.location || '');
  const [fromYear, setFromYear] = useState(initial?.from_year ?? '');
  const [toYear, setToYear] = useState(initial?.to_year ?? '');
  const [current, setCurrent] = useState(initial ? initial.to_year == null && initial.from_year != null : false);
  const [note, setNote] = useState(initial?.note || '');

  const canSave = institution.trim().length > 0;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSave) return;
    onSubmit({
      stage,
      institution: institution.trim(),
      field_of_study: STAGES_WITH_FIELD_OF_STUDY.has(stage) && fieldOfStudy.trim() ? fieldOfStudy.trim() : null,
      location: location.trim() || null,
      from_year: fromYear ? Number(fromYear) : null,
      to_year: current ? null : (toYear ? Number(toYear) : null),
      note: note.trim() || null,
    });
  };

  return (
    <form className="places-form" onSubmit={handleSubmit}>
      <div className="education-form__stages">
        {EDUCATION_STAGES.map((s) => (
          <button
            key={s.key}
            type="button"
            className={'education-form__stage' + (stage === s.key ? ' education-form__stage--active' : '')}
            onClick={() => setStage(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <input
        className="places-form__input"
        value={institution}
        onChange={(e) => setInstitution(e.target.value)}
        placeholder="Institution name"
        aria-label="Institution name"
        autoFocus
      />
      {STAGES_WITH_FIELD_OF_STUDY.has(stage) && (
        <input
          className="places-form__input"
          value={fieldOfStudy}
          onChange={(e) => setFieldOfStudy(e.target.value)}
          placeholder="Degree / field of study (optional)"
          aria-label="Degree or field of study"
        />
      )}
      <input
        className="places-form__input"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder="Location (e.g. Melbourne, Australia)"
        aria-label="Location"
      />
      <div className="places-form__years">
        <input
          className="places-form__year"
          value={fromYear}
          onChange={(e) => setFromYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="From year"
          inputMode="numeric"
          aria-label="Year started"
        />
        <span className="places-form__dash">–</span>
        <input
          className="places-form__year"
          value={current ? '' : toYear}
          onChange={(e) => setToYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder={current ? 'Present' : 'To year'}
          inputMode="numeric"
          disabled={current}
          aria-label="Year finished"
        />
      </div>
      <label className="places-form__current">
        <input type="checkbox" checked={current} onChange={(e) => setCurrent(e.target.checked)} />
        Currently studying here
      </label>
      <input
        className="places-form__input education-form__note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Personal note (optional) — e.g. Met lifelong friends here"
        aria-label="Personal note"
      />
      <div className="places-form__actions">
        <button type="submit" className="places-form__save" disabled={!canSave}>Save</button>
        <button type="button" className="places-form__cancel" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function StageIcon({ stage }) {
  if (stage === 'secondary') return <BookIcon />;
  if (stage === 'trade') return <ToolIcon />;
  if (stage === 'university') return <CapIcon />;
  return <SatchelIcon />;
}

function SatchelIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="9" width="16" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 9V7a4 4 0 0 1 8 0v2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 13v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function BookIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 5.5C4 4.7 4.7 4 5.5 4H12v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H12v16h6.5a1.5 1.5 0 0 0 1.5-1.5v-13Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
function ToolIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 1 5.4-5.4l-2.6 2.6-2-2 2.6-2.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
function CapIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5 2 9.5 12 14l10-4.5L12 5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6 11.5V16c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M20 10v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PencilIcon() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M14 6l4 4" stroke="currentColor" strokeWidth="1.7" /></svg>);
}
function CloseIcon() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>);
}
function PlusIcon() {
  return (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>);
}

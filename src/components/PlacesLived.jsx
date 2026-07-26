import { useState } from 'react';
import { geocodePlace } from '../lib/places.js';

/*
 * Places Lived — a chronological record of where someone lived through
 * their life, distinct from the single `residence` string (their current/
 * most recent place) every other part of the app already reads. Two
 * pieces, both reusing an established visual language rather than
 * inventing a new widget:
 *   1. A chain of place chips connected by arrows — the exact same
 *      pattern InsightModules.jsx's HeartlandsModule already uses for a
 *      family's migration path (`.tim-mig`/`.tim-mig__step`), reimplemented
 *      here with its own class names since this is a single person's
 *      history, not a family-wide aggregate — but the visual is
 *      deliberately identical.
 *   2. A horizontal scroll-snap strip of "chapter" cards below it, one per
 *      residence, each auto-captioned from whatever life events happened
 *      during that stay (a birth, a marriage — pulled straight from
 *      `person.events`, no new data entry needed for that part).
 *
 * Deliberately suburb-level only — `place` is free text, but the add/edit
 * form's placeholder guides toward "Suburb, State" rather than a street
 * address, matching the same privacy stance already applied to the
 * Trove/PROV archive work (never store more precise location data than a
 * family history actually needs).
 *
 * Geocoding (lib/places.js) is best-effort and optional: a residence saves
 * immediately on the place/year fields alone, and lat/lon — plus a
 * suburb/state/country breakdown, for reliably GROUPING places later (an
 * insight, a future filter) rather than matching on raw free-typed spelling —
 * fill in afterward if geocoding succeeds. The chain and cards never depend
 * on having any of that.
 */
export default function PlacesLived({ person, canEdit, onAddResidence, onUpdateResidence, onRemoveResidence }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState(null);

  const residences = [...(person.residences || [])].sort((a, b) => {
    if (a.from_year == null) return 1;
    if (b.from_year == null) return -1;
    return a.from_year - b.from_year;
  });

  const handleAdd = async (fields) => {
    setAdding(false);
    const geo = await geocodePlace(fields.place);
    onAddResidence({ ...fields, ...geoFields(geo) });
  };

  const handleUpdate = async (id, fields) => {
    setEditingId(null);
    const geo = await geocodePlace(fields.place);
    onUpdateResidence(id, { ...fields, ...geoFields(geo) });
  };

  return (
    <section className="profile-section">
      <div className="profile-section__head">
        <h3 className="profile-section__title">
          Places Lived{residences.length > 0 ? ` · ${residences.length}` : ''}
        </h3>
        {canEdit && !adding && (
          <button className="section-edit" onClick={() => setAdding(true)}>Add</button>
        )}
      </div>

      {residences.length > 0 && (
        <div className="places-chain" aria-label="Places lived, in order">
          {residences.map((r, i) => (
            <span className="places-chain__step" key={r.id}>
              {i > 0 && <ChainArrowIcon />}
              <b>{r.place}</b>
              <em>{formatRange(r.from_year, r.to_year)}</em>
            </span>
          ))}
        </div>
      )}

      {residences.length > 0 && (
        <ul className="places-cards">
          {residences.map((r) => (
            <li key={r.id} className="places-card">
              {editingId === r.id ? (
                <PlaceForm
                  initial={r}
                  onCancel={() => setEditingId(null)}
                  onSubmit={(fields) => handleUpdate(r.id, fields)}
                />
              ) : (
                <>
                  <p className="places-card__place">{r.place}</p>
                  <p className="places-card__range">{formatRange(r.from_year, r.to_year)}</p>
                  {(() => {
                    const caption = captionFor(person.events, r.from_year, r.to_year);
                    return caption ? <p className="places-card__caption">{caption}</p> : null;
                  })()}
                  {canEdit && (
                    confirmRemoveId === r.id ? (
                      <div className="places-card__confirm">
                        <span>Remove this place?</span>
                        <div className="places-card__confirm-btns">
                          <button className="doc-card__confirm-remove" onClick={() => { onRemoveResidence(r.id); setConfirmRemoveId(null); }}>Remove</button>
                          <button className="doc-card__confirm-cancel" onClick={() => setConfirmRemoveId(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="places-card__actions">
                        <button className="places-card__edit" onClick={() => setEditingId(r.id)} aria-label={`Edit ${r.place}`}>
                          <PencilIcon />
                        </button>
                        <button className="places-card__del" onClick={() => setConfirmRemoveId(r.id)} aria-label={`Remove ${r.place}`}>
                          <CloseIcon />
                        </button>
                      </div>
                    )
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="places-card places-card--new">
          <PlaceForm onCancel={() => setAdding(false)} onSubmit={handleAdd} />
        </div>
      )}

      {residences.length === 0 && !adding && (
        canEdit ? (
          <button className="empty-add" onClick={() => setAdding(true)}>
            <PlusIcon />
            Add where they've lived
          </button>
        ) : (
          <p className="profile-section__empty">No places recorded yet</p>
        )
      )}
    </section>
  );
}

// Pulls just the fields a successful (or failed) geocode contributes, so a
// residence always ends up with a consistent shape regardless of whether
// geocoding actually ran — a failure (geo === null) still saves the place/
// year fields alone, with every geocoded field explicitly null rather than
// simply absent.
function geoFields(geo) {
  return { lat: geo?.lat ?? null, lon: geo?.lon ?? null, suburb: geo?.suburb ?? null, state: geo?.state ?? null, country: geo?.country ?? null };
}

function formatRange(fromYear, toYear) {
  if (fromYear == null) return 'Unknown period';
  return toYear ? `${fromYear}–${toYear}` : `${fromYear}–present`;
}

// Pulls a short caption from whatever life events fall within this
// residence's own year range — e.g. a birth or marriage that happened
// while they lived there — so a bare place-and-years card reads as part
// of the actual story, not just a geography fact. Purely additive: a
// residence with no overlapping events just shows no caption, never a
// placeholder.
function captionFor(events, fromYear, toYear) {
  if (!events?.length || fromYear == null) return null;
  const end = toYear ?? new Date().getFullYear();
  const matches = events
    .filter((e) => {
      const y = Number(e.year);
      return Number.isFinite(y) && y >= fromYear && y <= end;
    })
    .map((e) => e.title);
  if (!matches.length) return null;
  return matches.slice(0, 2).join(' · ');
}

function PlaceForm({ initial, onCancel, onSubmit }) {
  const [place, setPlace] = useState(initial?.place || '');
  const [fromYear, setFromYear] = useState(initial?.from_year ?? '');
  const [toYear, setToYear] = useState(initial?.to_year ?? '');
  const [current, setCurrent] = useState(initial ? initial.to_year == null : false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!place.trim() || !fromYear) return;
    onSubmit({
      place: place.trim(),
      from_year: Number(fromYear),
      to_year: current ? null : (toYear ? Number(toYear) : null),
    });
  };

  return (
    <form className="places-form" onSubmit={handleSubmit}>
      <input
        className="places-form__input"
        value={place}
        onChange={(e) => setPlace(e.target.value)}
        placeholder="Suburb, State"
        aria-label="Place (suburb-level)"
        autoFocus
      />
      <div className="places-form__years">
        <input
          className="places-form__year"
          value={fromYear}
          onChange={(e) => setFromYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="From year"
          inputMode="numeric"
          aria-label="Year moved in"
        />
        <span className="places-form__dash">–</span>
        <input
          className="places-form__year"
          value={current ? '' : toYear}
          onChange={(e) => setToYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder={current ? 'Present' : 'To year'}
          inputMode="numeric"
          disabled={current}
          aria-label="Year moved away"
        />
      </div>
      <label className="places-form__current">
        <input type="checkbox" checked={current} onChange={(e) => setCurrent(e.target.checked)} />
        Still lives here
      </label>
      <div className="places-form__actions">
        <button type="submit" className="places-form__save" disabled={!place.trim() || !fromYear}>Save</button>
        <button type="button" className="places-form__cancel" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ChainArrowIcon() {
  return (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>);
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

import { useState } from 'react';
import { geocodePlace, geoFields } from '../lib/places.js';

/*
 * Resting place — where someone is buried or interred. Shown only on a
 * deceased profile, directly beneath Key Life Events' own "Passed away"
 * row (the last chapter of the timeline, not a separate destination) —
 * a single record (person.resting_place | null), not a dated array like
 * Places Lived's residences[], since there's only ever one.
 *
 * Reuses Places Lived's own suburb/state two-box + best-effort-geocode
 * pattern (typed state always wins over whatever geocoding resolves —
 * see lib/places.js#geoFields) for the same reason that pattern exists:
 * a bare cemetery/suburb name often can't be confidently resolved to a
 * state on its own.
 *
 * Deliberately no in-app map here, unlike Places Lived (which needed one
 * because a multi-stop life journey has no clean Google Maps
 * equivalent) — a grave is a single point, and turn-by-turn directions
 * are exactly what a real map app already does well. A geocoded record
 * gets a plain "Get directions" link out to Google Maps instead of
 * reinventing that.
 *
 * Tinted with the app's one dedicated memorial color (`--memorial`,
 * already used by the "In loving memory" badge) rather than the ordinary
 * terracotta accent every other section uses — this section only ever
 * exists on a profile already carrying that badge, so it reads as part
 * of the same moment.
 */
export default function RestingPlace({ person, canEdit, onSet, onClear }) {
  const [editing, setEditing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const rp = person.resting_place || null;

  if (!person.is_deceased) return null;
  if (!rp && !editing && !canEdit) return null; // nothing to show, no way to add it

  const handleSubmit = async (fields) => {
    setEditing(false);
    const geo = await geocodePlace(fields.place);
    onSet({ ...fields, ...geoFields(geo, fields) });
  };

  return (
    <section className="profile-section profile-section--resting">
      <div className="profile-section__head">
        <h3 className="profile-section__title">
          <span className="resting-title-icon" aria-hidden="true"><LaurelIcon /></span>
          Resting place
        </h3>
        {canEdit && !editing && (
          <button className="section-edit" onClick={() => setEditing(true)}>{rp ? 'Edit' : 'Add'}</button>
        )}
      </div>

      {editing ? (
        <RestingPlaceForm initial={rp} onCancel={() => setEditing(false)} onSubmit={handleSubmit} />
      ) : rp ? (
        <div className="resting-card">
          <p className="resting-card__name">{headingFor(rp)}</p>
          {subtitleFor(rp) && <p className="resting-card__sub">{subtitleFor(rp)}</p>}
          {rp.plot && <p className="resting-card__plot">Plot {rp.plot}</p>}
          <div className="resting-card__actions">
            {rp.lat != null && rp.lon != null && (
              <a
                className="resting-card__directions"
                href={`https://www.google.com/maps/search/?api=1&query=${rp.lat},${rp.lon}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <CompassIcon />
                Get directions
              </a>
            )}
            {canEdit && (
              confirmClear ? (
                <span className="resting-card__confirm">
                  <span>Remove?</span>
                  <button className="doc-card__confirm-remove" onClick={() => { setConfirmClear(false); onClear(); }}>Remove</button>
                  <button className="doc-card__confirm-cancel" onClick={() => setConfirmClear(false)}>Cancel</button>
                </span>
              ) : (
                <button className="resting-card__del" onClick={() => setConfirmClear(true)} aria-label="Remove resting place">
                  <CloseIcon />
                </button>
              )
            )}
          </div>
        </div>
      ) : (
        <button className="empty-add" onClick={() => setEditing(true)}>
          <PlusIcon />
          Add resting place
        </button>
      )}
    </section>
  );
}

// A short label — the cemetery/site name if known, else falling back to
// the suburb — so the card always has SOME heading rather than reading
// as blank when only a bare location was recorded.
function headingFor(rp) {
  return rp.cemetery || shortPlace(rp.place) || 'Unknown location';
}

// When the cemetery name is the heading, the subtitle is the full
// suburb/state/country location. When there's no cemetery name, the
// suburb IS the heading, so the subtitle is just state/country — same
// duplicate-string guard Places Lived uses for a city-state (Singapore,
// Monaco...) whose suburb/state/country can all resolve to the same name.
function subtitleFor(rp) {
  if (rp.cemetery) {
    return [rp.suburb, rp.state, rp.country].filter(Boolean).join(', ') || null;
  }
  const loc = [rp.state, rp.country].filter(Boolean).join(', ');
  if (!loc || loc === shortPlace(rp.place)) return null;
  return loc;
}

function shortPlace(place) {
  return (place || '').split(',')[0].trim();
}

// Mirrors PlacesLived.jsx's own splitPlace — best-effort split of an
// existing free-typed `place` string for editing a record that predates
// the two-box form.
function splitPlace(place) {
  const [suburb = '', ...rest] = (place || '').split(',');
  return { suburb: suburb.trim(), state: rest.join(',').trim() };
}

function RestingPlaceForm({ initial, onCancel, onSubmit }) {
  const fallback = splitPlace(initial?.place);
  const [cemetery, setCemetery] = useState(initial?.cemetery || '');
  const [suburb, setSuburb] = useState(initial?.suburb || fallback.suburb);
  const [stateName, setStateName] = useState(initial?.state || fallback.state);
  const [plot, setPlot] = useState(initial?.plot || '');

  const canSave = cemetery.trim() || suburb.trim();

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSave) return;
    onSubmit({
      cemetery: cemetery.trim() || null,
      plot: plot.trim() || null,
      place: [suburb.trim(), stateName.trim()].filter(Boolean).join(', '),
      suburb: suburb.trim() || null,
      state: stateName.trim() || null,
    });
  };

  return (
    <form className="places-form" onSubmit={handleSubmit}>
      <input
        className="places-form__input"
        value={cemetery}
        onChange={(e) => setCemetery(e.target.value)}
        placeholder="Cemetery or site name"
        aria-label="Cemetery or site name"
        autoFocus
      />
      <div className="places-form__location">
        <input
          className="places-form__input places-form__input--suburb"
          value={suburb}
          onChange={(e) => setSuburb(e.target.value)}
          placeholder="Suburb"
          aria-label="Suburb"
        />
        <input
          className="places-form__input places-form__input--state"
          value={stateName}
          onChange={(e) => setStateName(e.target.value)}
          placeholder="State"
          aria-label="State"
        />
      </div>
      <input
        className="places-form__input"
        value={plot}
        onChange={(e) => setPlot(e.target.value)}
        placeholder="Plot / section (optional)"
        aria-label="Plot or section"
      />
      <div className="places-form__actions">
        <button type="submit" className="places-form__save" disabled={!canSave}>Save</button>
        <button type="button" className="places-form__cancel" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// A quiet laurel sprig — a resting/memorial mark that reads as dignified
// rather than literal (no headstone/cross clipart), matching the same
// restrained 18px outline language as the rest of the app's icon set.
function LaurelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 20V6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 8c-2-3-5-4-7-3.4C4.6 6.5 6.6 9.4 9.6 10c1 .2 1.9 0 2.4-.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 12c-2-3-5-4-7-3.4C4.6 10.5 6.6 13.4 9.6 14c1 .2 1.9 0 2.4-.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 8c2-3 5-4 7-3.4C19.4 6.5 17.4 9.4 14.4 10c-1 .2-1.9 0-2.4-.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 12c2-3 5-4 7-3.4C19.4 10.5 17.4 13.4 14.4 14c-1 .2-1.9 0-2.4-.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CompassIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M15 9l-2 6-6 2 2-6 6-2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>);
}

function CloseIcon() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>);
}

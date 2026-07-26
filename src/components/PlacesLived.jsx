import { useState } from 'react';
import { geocodePlace } from '../lib/places.js';

/*
 * Places Lived — a chronological record of where someone lived through
 * their life, distinct from the single `residence` string (their current/
 * most recent place) every other part of the app already reads.
 *
 * Consolidated design (a design review found the original three-layer
 * version — a text chain, a scroll-snap row of chapter cards, AND a
 * geographic "constellation map" — genuinely redundant: the chain and the
 * cards showed near-identical content at two densities, and the map's
 * abstract lat/lon plot broke down exactly on real, richly-filled data —
 * many places clustered in one metro area plus a couple of big moves is the
 * NORM, not an edge case, and no amount of point-separation fixes label
 * crowding at that density). Replaced with ONE horizontal timeline —
 * `.places-route`/`.places-waypoint` — deliberately modeled on
 * MilitaryService.jsx's own `.military__route`/`.military__waypoint`
 * campaign timeline (own class names, not shared ones — this is a
 * different section with its own edit/remove/add interactions — but the
 * same visual language) for cross-feature consistency and because that
 * design already solves the exact problem the map didn't: position encodes
 * ONLY chronology (array order), never real-world distance, so it can never
 * collide no matter how many entries or how tightly clustered the real
 * places are.
 *
 * Tapping a waypoint shows its full detail (place, range, an auto-caption
 * pulled from whatever life events happened during that stay, edit/remove)
 * in the single `.places-detail` panel below — one shared detail slot
 * rather than a card per residence, so browsing many places stays a light
 * horizontal scroll, not a growing stack of near-duplicate cards. Defaults
 * to the most recent (or still-current) chapter — the one a visitor to the
 * profile most likely wants to see first.
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
 * fill in afterward if geocoding succeeds. The timeline never depends on
 * having any of that; it reads only place/from_year/to_year.
 */
export default function PlacesLived({ person, canEdit, onAddResidence, onUpdateResidence, onRemoveResidence }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  const residences = [...(person.residences || [])].sort((a, b) => {
    if (a.from_year == null) return 1;
    if (b.from_year == null) return -1;
    return a.from_year - b.from_year;
  });

  // Falls back to the most recent chapter whenever nothing's explicitly
  // selected yet, or the previously-selected residence no longer exists
  // (just removed) — never gets stuck showing nothing when there's still
  // at least one place on record.
  const selected = residences.find((r) => r.id === selectedId) || residences[residences.length - 1] || null;

  const select = (id) => { setSelectedId(id); setAdding(false); setEditingId(null); };

  const handleAdd = async (fields) => {
    setAdding(false);
    const geo = await geocodePlace(fields.place);
    const id = onAddResidence({ ...fields, ...geoFields(geo) });
    if (id) setSelectedId(id);
  };

  const handleUpdate = async (id, fields) => {
    setEditingId(null);
    const geo = await geocodePlace(fields.place);
    onUpdateResidence(id, { ...fields, ...geoFields(geo) });
  };

  const handleRemove = (id) => {
    onRemoveResidence(id);
    setConfirmRemoveId(null);
    if (selectedId === id) setSelectedId(null); // falls back to the new most-recent entry automatically
  };

  return (
    <section className="profile-section">
      <div className="profile-section__head">
        <h3 className="profile-section__title">
          Places Lived{residences.length > 0 ? ` · ${residences.length}` : ''}
        </h3>
        {canEdit && !adding && (
          <button className="section-edit" onClick={() => { setAdding(true); setEditingId(null); }}>Add</button>
        )}
      </div>

      {residences.length > 0 && (
        <div className="places-route" aria-label="Places lived, in order">
          {residences.map((r) => {
            const isActive = !adding && selected?.id === r.id;
            return (
              <button
                key={r.id}
                type="button"
                className={'places-waypoint' + (isActive ? ' places-waypoint--active' : '')}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => select(r.id)}
              >
                <span className="places-waypoint-dot" aria-hidden="true" />
                <span className="places-waypoint-range">{formatRange(r.from_year, r.to_year)}</span>
                <span className="places-waypoint-title">{shortPlace(r.place)}</span>
              </button>
            );
          })}
        </div>
      )}

      {adding ? (
        <div className="places-detail">
          <PlaceForm onCancel={() => setAdding(false)} onSubmit={handleAdd} />
        </div>
      ) : editingId ? (
        <div className="places-detail">
          <PlaceForm
            initial={residences.find((r) => r.id === editingId)}
            onCancel={() => setEditingId(null)}
            onSubmit={(fields) => handleUpdate(editingId, fields)}
          />
        </div>
      ) : selected ? (
        <div className="places-detail">
          <p className="places-detail__place">{selected.place}</p>
          <p className="places-detail__range">{formatRange(selected.from_year, selected.to_year)}</p>
          {(() => {
            const caption = captionFor(person.events, selected.from_year, selected.to_year);
            return caption ? <p className="places-detail__caption">{caption}</p> : null;
          })()}
          {canEdit && (
            confirmRemoveId === selected.id ? (
              <div className="places-detail__confirm">
                <span>Remove this place?</span>
                <div className="places-detail__confirm-btns">
                  <button className="doc-card__confirm-remove" onClick={() => handleRemove(selected.id)}>Remove</button>
                  <button className="doc-card__confirm-cancel" onClick={() => setConfirmRemoveId(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="places-detail__actions">
                <button className="places-detail__edit" onClick={() => setEditingId(selected.id)} aria-label={`Edit ${selected.place}`}>
                  <PencilIcon />
                </button>
                <button className="places-detail__del" onClick={() => setConfirmRemoveId(selected.id)} aria-label={`Remove ${selected.place}`}>
                  <CloseIcon />
                </button>
              </div>
            )
          )}
        </div>
      ) : null}

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

// A short label ("Cardiff" not "Cardiff, Wales, UK") so the waypoint stays
// scannable at a glance — the full place string is always shown in the
// detail panel the moment it's selected.
function shortPlace(place) {
  return (place || '').split(',')[0].trim();
}

// Pulls a short caption from whatever life events fall within this
// residence's own year range — e.g. a birth or marriage that happened
// while they lived there — so a bare place-and-years detail reads as part
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

function PencilIcon() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M14 6l4 4" stroke="currentColor" strokeWidth="1.7" /></svg>);
}
function CloseIcon() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>);
}
function PlusIcon() {
  return (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>);
}

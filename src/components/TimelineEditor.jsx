import { useEffect, useRef, useState } from 'react';
import { yearOf } from '../lib/dates.js';

// Swaps just the leading year of a partial date ('YYYY' | 'YYYY-MM' |
// 'YYYY-MM-DD'), keeping whatever month/day precision was already there.
function withYear(dateStr, newYear) {
  const y = (newYear || '').trim();
  if (!dateStr) return y || null;
  const rest = dateStr.split('-').slice(1).join('-');
  return rest ? `${y}-${rest}` : (y || null);
}

// A row identity that only ever lives for the life of this editing session —
// never persisted (see save() below) — so dragging can reorder the array
// without React losing track of which textarea is which (index-as-key would
// otherwise hand a reordered row's DOM node, cursor position and all, to
// whatever data now sits at that index).
const rowKey = () => 'r_' + Math.random().toString(36).slice(2, 9);

function arrayMove(arr, from, to) {
  const copy = arr.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

/*
 * Edit the key life events on the timeline. Two rows are special: Born and
 * Passed away aren't stored in person.events — they're derived from the
 * profile's own birth/death fields (see lib/profile.js's lifeEvents) — but
 * they're exactly the two duplicates a document-extracted fact is most
 * likely to create, so they need to be editable and removable right here
 * too, not just the stored events below them. Everything else behaves as
 * before: a year, a title, an optional detail; empty rows are dropped on
 * save; the rest are sorted by year so the timeline always reads in order.
 *
 * Same-year events (a dense military record with six things happening in
 * 1917, say) have no natural order once reduced to a bare year — sorting
 * alone can't tell them apart, so ties fall back to array order. Both this
 * editor's initial load AND lib/profile.js's lifeEvents() use a stable sort,
 * so whatever relative order the rows end up in here — including drag
 * reordering — is exactly what the read-only timeline will show for ties.
 * Loading already-sorted (instead of raw storage order, which is usually
 * document-extraction order) is itself half the fix: it's what made the
 * editor look scrambled even when the profile read fine.
 */
export default function TimelineEditor({ person, onClose, onSave }) {
  const [rows, setRows] = useState(() =>
    (person.events || [])
      .map((e) => ({
        _key: rowKey(),
        year: String(e.year ?? ''),
        title: e.title || '',
        detail: e.detail || '',
        tag: e.tag || null, // carried through untouched — not user-editable here
      }))
      .sort((a, b) => Number(a.year) - Number(b.year)),
  );
  const [draggingKey, setDraggingKey] = useState(null);
  const dragRef = useRef(null); // { key, pointerId } while a handle drag is live
  const rowElsRef = useRef(new Map()); // _key -> row DOM node, for live midpoint checks
  const listRef = useRef(null); // the never-reordered .tl-edit container — see onHandleDown

  const hasBorn = !!person.birth_date;
  const [born, setBorn] = useState(() => ({
    year: hasBorn ? yearOf(person.birth_date) : '',
    detail: person.birth_place || '',
    removed: false,
  }));

  const hasDied = person.is_deceased && !!person.death_date;
  const [died, setDied] = useState(() => ({
    year: hasDied ? yearOf(person.death_date) : '',
    detail: person.cause_of_death || '',
    removed: false,
  }));

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Armed by index, not id — rows have none. remove() always clears it
  // (not just on its own confirm) so a stale index from a row above never
  // lingers onto whatever shifted into that slot. Synthetic rows are armed
  // separately, by key ('born' | 'died'), since they're not part of `rows`.
  const [confirmRemoveIdx, setConfirmRemoveIdx] = useState(null);
  const [confirmRemoveSynthetic, setConfirmRemoveSynthetic] = useState(null);

  const update = (i, key) => (e) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: e.target.value } : r)));
  const remove = (i) => {
    setRows((rs) => rs.filter((_, j) => j !== i));
    setConfirmRemoveIdx(null);
  };
  const add = () => setRows((rs) => [...rs, { _key: rowKey(), year: '', title: '', detail: '' }]);

  function moveRow(fromKey, delta) {
    setRows((rs) => {
      const from = rs.findIndex((r) => r._key === fromKey);
      if (from === -1) return rs;
      const to = Math.max(0, Math.min(rs.length - 1, from + delta));
      return to === from ? rs : arrayMove(rs, from, to);
    });
  }

  // Reordering is driven entirely by the dragged row's live position against
  // the others' CURRENT midpoints (re-measured every move, not cached at
  // drag start) — simple to reason about and plenty fast for a list this
  // small, with no transform math or reflow-animation bookkeeping to get
  // wrong.
  //
  // Pointer capture is set on the OUTER LIST CONTAINER (listRef), not on the
  // handle button itself, and move/up/cancel are listened for there too —
  // deliberately, after finding that capturing on the handle silently drops
  // (hasPointerCapture flips to false mid-gesture, confirmed with the node
  // still attached to the document) the moment a drag reorders the array:
  // React's reconciliation touching the handle's own subtree during that
  // re-render is enough to revoke it, even with a stable key preserving the
  // DOM node itself. The container is never reordered, so it never loses
  // capture — the same reason KeepsakeBook.jsx captures on its outer stage
  // rather than the moving leaf.
  function onHandleDown(e, key) {
    listRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = { key, pointerId: e.pointerId };
    setDraggingKey(key);
    setConfirmRemoveIdx(null);
  }
  function onListMove(e) {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const y = e.clientY;
    let targetIndex = rows.length - 1;
    for (let idx = 0; idx < rows.length; idx++) {
      const el = rowElsRef.current.get(rows[idx]._key);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) { targetIndex = idx; break; }
    }
    const currentIndex = rows.findIndex((r) => r._key === drag.key);
    if (currentIndex !== -1 && targetIndex !== currentIndex) {
      setRows((rs) => arrayMove(rs, currentIndex, targetIndex));
    }
  }
  function onListUp(e) {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    setDraggingKey(null);
  }
  function onHandleKeyDown(e, key) {
    if (e.key === 'ArrowUp') { e.preventDefault(); moveRow(key, -1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); moveRow(key, 1); }
  }

  const save = () => {
    const events = rows
      .filter((r) => r.year.trim() && r.title.trim())
      .map((r) => {
        const ev = { year: Number(r.year) || r.year.trim(), title: r.title.trim() };
        if (r.detail.trim()) ev.detail = r.detail.trim();
        if (r.tag) ev.tag = r.tag;
        return ev;
      })
      .sort((a, b) => Number(a.year) - Number(b.year));

    // Only ever touches birth/death fields when there was something to edit
    // in the first place (hasBorn / hasDied) — this editor never invents a
    // birth or death record that wasn't already on the profile.
    const corePatch = {};
    if (hasBorn) {
      if (born.removed || !born.year.trim()) {
        corePatch.birth_date = null;
        corePatch.birth_place = null;
      } else {
        const nextDate = withYear(person.birth_date, born.year);
        if (nextDate !== person.birth_date) corePatch.birth_date = nextDate;
        const nextPlace = born.detail.trim() || null;
        if (nextPlace !== (person.birth_place || null)) corePatch.birth_place = nextPlace;
      }
    }
    if (hasDied) {
      if (died.removed || !died.year.trim()) {
        corePatch.death_date = null;
        corePatch.cause_of_death = null;
      } else {
        const nextDate = withYear(person.death_date, died.year);
        if (nextDate !== person.death_date) corePatch.death_date = nextDate;
        const nextCause = died.detail.trim() || null;
        if (nextCause !== (person.cause_of_death || null)) corePatch.cause_of_death = nextCause;
      }
    }

    onSave(events, corePatch);
  };

  const showEmpty = rows.length === 0 && !(hasBorn && !born.removed) && !(hasDied && !died.removed);

  return (
    <div className="sheet-scrim sheet-scrim--modal" onClick={onClose}>
      <section
        className="sheet sheet--form"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit timeline for ${person.display_name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="form__head form__head--stack">
          <h2>Key life events</h2>
          <p className="form__sub">The milestones worth remembering, in {person.display_name}’s life.</p>
        </header>

        <div
          className="tl-edit"
          ref={listRef}
          onPointerMove={onListMove}
          onPointerUp={onListUp}
          onPointerCancel={onListUp}
        >
          {showEmpty && (
            <p className="tl-edit__empty">No events yet. Add the first one below.</p>
          )}

          {hasBorn && !born.removed && (
            <SyntheticRow
              badge="Profile"
              title="Born"
              year={born.year}
              onYear={(v) => setBorn((b) => ({ ...b, year: v }))}
              detail={born.detail}
              detailPlaceholder="Birthplace (optional)"
              onDetail={(v) => setBorn((b) => ({ ...b, detail: v }))}
              confirming={confirmRemoveSynthetic === 'born'}
              confirmText="Remove the birth date and place from the profile? This clears more than just this row — the rest of the app uses it too (ages, sorting)."
              onArm={() => setConfirmRemoveSynthetic('born')}
              onConfirm={() => { setBorn((b) => ({ ...b, removed: true })); setConfirmRemoveSynthetic(null); }}
              onCancel={() => setConfirmRemoveSynthetic(null)}
            />
          )}

          {hasDied && !died.removed && (
            <SyntheticRow
              badge="Profile"
              title="Passed away"
              year={died.year}
              onYear={(v) => setDied((d) => ({ ...d, year: v }))}
              detail={died.detail}
              detailPlaceholder="Cause (optional)"
              onDetail={(v) => setDied((d) => ({ ...d, detail: v }))}
              confirming={confirmRemoveSynthetic === 'died'}
              confirmText="Remove the death date and cause from the profile?"
              onArm={() => setConfirmRemoveSynthetic('died')}
              onConfirm={() => { setDied((d) => ({ ...d, removed: true })); setConfirmRemoveSynthetic(null); }}
              onCancel={() => setConfirmRemoveSynthetic(null)}
            />
          )}

          {rows.length > 1 && (
            <p className="tl-edit__hint">Drag the handle to reorder — useful when a few events share a year.</p>
          )}
          {rows.map((r, i) => (
            <div
              key={r._key}
              ref={(el) => {
                if (el) rowElsRef.current.set(r._key, el);
                else rowElsRef.current.delete(r._key);
              }}
            >
              <div className={`tl-row${draggingKey === r._key ? ' tl-row--dragging' : ''}`}>
                <button
                  type="button"
                  className="tl-row__handle"
                  onPointerDown={(e) => onHandleDown(e, r._key)}
                  onKeyDown={(e) => onHandleKeyDown(e, r._key)}
                  aria-label={`Reorder "${r.title || 'this event'}" — drag, or use arrow keys`}
                  title="Drag to reorder"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <circle cx="5" cy="3" r="1.3" />
                    <circle cx="11" cy="3" r="1.3" />
                    <circle cx="5" cy="8" r="1.3" />
                    <circle cx="11" cy="8" r="1.3" />
                    <circle cx="5" cy="13" r="1.3" />
                    <circle cx="11" cy="13" r="1.3" />
                  </svg>
                </button>
                <div className="tl-row__year">
                  <input
                    className="field__input"
                    value={r.year}
                    onChange={update(i, 'year')}
                    placeholder="Year"
                    inputMode="numeric"
                    aria-label="Year"
                  />
                </div>
                <div className="tl-row__main">
                  <AutoGrowField
                    value={r.title}
                    onChange={update(i, 'title')}
                    placeholder="What happened — e.g. Married"
                    ariaLabel="Event"
                  />
                  <AutoGrowField
                    value={r.detail}
                    onChange={update(i, 'detail')}
                    placeholder="A detail (optional)"
                    ariaLabel="Detail"
                  />
                </div>
                <button
                  className="tl-row__del"
                  onClick={() => {
                    // Blank rows (e.g. a just-added one the user changed their
                    // mind about) have nothing to lose — no point guarding those.
                    const hasContent = r.year.trim() || r.title.trim() || r.detail.trim();
                    if (hasContent) setConfirmRemoveIdx(i);
                    else remove(i);
                  }}
                  aria-label="Remove event"
                  title="Remove"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              {confirmRemoveIdx === i && (
                <div className="inline-confirm">
                  <span>Remove this event?</span>
                  <div className="inline-confirm-btns">
                    <button className="inline-confirm-remove" onClick={() => remove(i)}>Remove</button>
                    <button className="inline-confirm-cancel" onClick={() => setConfirmRemoveIdx(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          <button className="link-btn" onClick={add}>
            + Add an event
          </button>
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

// The two profile-derived rows (Born, Passed away) — same visual family as a
// regular event row, tinted and badged so it's clear editing them touches
// the profile's own fields, with a fixed (non-editable) title since "Born"
// isn't free text the way a stored event's title is.
function SyntheticRow({ badge, title, year, onYear, detail, detailPlaceholder, onDetail, confirming, confirmText, onArm, onConfirm, onCancel }) {
  return (
    <div>
      <div className="tl-row tl-row--synthetic">
        <div className="tl-row__year">
          <input
            className="field__input"
            value={year}
            onChange={(e) => onYear(e.target.value)}
            placeholder="Year"
            inputMode="numeric"
            aria-label={`${title} year`}
          />
        </div>
        <div className="tl-row__main">
          <div className="tl-row__title-static">
            {title}
            <span className="tl-row__badge">{badge}</span>
          </div>
          <AutoGrowField
            value={detail}
            onChange={(e) => onDetail(e.target.value)}
            placeholder={detailPlaceholder}
            ariaLabel={`${title} detail`}
          />
        </div>
        <button className="tl-row__del" onClick={onArm} aria-label={`Remove ${title.toLowerCase()}`} title="Remove">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {confirming && (
        <div className="inline-confirm">
          <span>{confirmText}</span>
          <div className="inline-confirm-btns">
            <button className="inline-confirm-remove" onClick={onConfirm}>Remove</button>
            <button className="inline-confirm-cancel" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// A single-line-by-default field that grows to fit its content instead of
// clipping it. Titles and details here come from free text — a placename,
// an AI-extracted phrase, a cause of death — that can easily run past what
// a fixed-height input can show, and a plain input gives no hint there's
// more to see. Grows on every keystroke and on mount (so pre-filled long
// values are visible immediately, not just after the user touches them).
function AutoGrowField({ value, onChange, placeholder, ariaLabel }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      className="field__input field__input--area field__input--auto"
      rows={1}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      aria-label={ariaLabel}
    />
  );
}

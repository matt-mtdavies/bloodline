import { useEffect, useState } from 'react';

/*
 * Edit the key life events on the timeline. Each row is a year, a title, and an
 * optional detail. Empty rows are dropped on save; the rest are sorted by year
 * so the timeline always reads in order.
 */
export default function TimelineEditor({ person, onClose, onSave }) {
  const [rows, setRows] = useState(() =>
    (person.events || []).map((e) => ({
      year: String(e.year ?? ''),
      title: e.title || '',
      detail: e.detail || '',
    })),
  );

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = (i, key) => (e) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: e.target.value } : r)));
  const remove = (i) => setRows((rs) => rs.filter((_, j) => j !== i));
  const add = () => setRows((rs) => [...rs, { year: '', title: '', detail: '' }]);

  const save = () => {
    const events = rows
      .filter((r) => r.year.trim() && r.title.trim())
      .map((r) => {
        const ev = { year: Number(r.year) || r.year.trim(), title: r.title.trim() };
        if (r.detail.trim()) ev.detail = r.detail.trim();
        return ev;
      })
      .sort((a, b) => Number(a.year) - Number(b.year));
    onSave(events);
  };

  return (
    <div className="sheet-scrim sheet-scrim--modal" onClick={onClose}>
      <section
        className="sheet sheet--form"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit timeline for ${person.display_name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="form__head">
          <h2>Key life events</h2>
          <p className="form__sub">The milestones worth remembering, in {person.display_name}’s life.</p>
        </header>

        <div className="tl-edit">
          {rows.length === 0 && (
            <p className="tl-edit__empty">No events yet. Add the first one below.</p>
          )}
          {rows.map((r, i) => (
            <div className="tl-row" key={i}>
              <input
                className="field__input tl-row__year"
                value={r.year}
                onChange={update(i, 'year')}
                placeholder="Year"
                inputMode="numeric"
                aria-label="Year"
              />
              <div className="tl-row__main">
                <input
                  className="field__input"
                  value={r.title}
                  onChange={update(i, 'title')}
                  placeholder="What happened — e.g. Married"
                  aria-label="Event"
                />
                <input
                  className="field__input"
                  value={r.detail}
                  onChange={update(i, 'detail')}
                  placeholder="A detail (optional)"
                  aria-label="Detail"
                />
              </div>
              <button
                className="tl-row__del"
                onClick={() => remove(i)}
                aria-label="Remove event"
                title="Remove"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
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

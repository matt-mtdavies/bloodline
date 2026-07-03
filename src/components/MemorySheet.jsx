import { useEffect, useState } from 'react';

/*
 * Add a memory. The little things — a habit, a phrase, a Sunday ritual — that
 * say more about a person than any set of dates. Short and human by design.
 *
 * Author is always the real signed-in viewer (never free-typed) — see
 * store.js#addMemory — so "who wrote this" can later gate editing/removing.
 * The "post anonymously" toggle only affects display; the author keeps their
 * own edit/remove rights either way.
 */
export default function MemorySheet({ person, viewerName, onClose, onAdd }) {
  const [text, setText] = useState('');
  const [anonymous, setAnonymous] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = () => {
    if (!text.trim()) return;
    onAdd({ text, anonymous });
  };

  return (
    <div className="sheet-scrim sheet-scrim--modal" onClick={onClose}>
      <section
        className="sheet sheet--form"
        role="dialog"
        aria-modal="true"
        aria-label={`Add a memory of ${person.display_name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="form__head">
          <h2>Add a memory</h2>
          <p className="form__sub">A small, specific thing about {person.display_name}.</p>
        </header>

        <div className="form__fields">
          <label className="field">
            <span className="field__label">The memory</span>
            <textarea
              className="field__input field__input--area"
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Every Christmas he made pancakes for everyone…"
            />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
            />
            <span>
              Post anonymously
              {!anonymous && viewerName && (
                <span className="field__hint"> — otherwise posted as {viewerName}</span>
              )}
            </span>
          </label>
        </div>

        <footer className="sheet__foot">
          <button className="btn btn--primary" onClick={save} disabled={!text.trim()}>
            Add memory
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </footer>
      </section>
    </div>
  );
}

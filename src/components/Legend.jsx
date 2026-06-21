import { useEffect } from 'react';

// A quiet key to what the bubbles and bonds mean. Opened from the top bar.
export default function Legend({ open, onClose, mergeParents, onToggleMerge }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <section
        className="sheet sheet--legend"
        role="dialog"
        aria-modal="true"
        aria-label="What the styles mean"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet__grip" />
        <h2 className="legend__title">Reading your tree</h2>
        <ul className="legend">
          <li>
            <span className="swatch swatch--membrane" />
            <span><b>A soft pod</b> binds a couple — one warm shape for two people.</span>
          </li>
          <li>
            <span className="swatch swatch--former" />
            <span><b>A faded dashed bond</b> is a former partner — still part of the story.</span>
          </li>
          <li>
            <span className="swatch swatch--widow" />
            <span><b>A violet pod</b> remembers a partner who has passed.</span>
          </li>
          <li>
            <span className="swatch swatch--coparent" />
            <span><b>A grey V-junction</b> connects divorced co-parents who share a child — both still very much parents.</span>
          </li>
          <li>
            <span className="swatch swatch--bio" />
            <span><b>A solid line</b> is a biological parent.</span>
          </li>
          <li>
            <span className="swatch swatch--nonbio" />
            <span><b>A dashed line</b> is an adopted, step or foster bond — equal, just distinct.</span>
          </li>
          <li>
            <span className="swatch swatch--memorial" />
            <span><b>A violet ring</b> honours someone who has passed — softened, never greyed out.</span>
          </li>
          <li>
            <span className="swatch swatch--uncertain" />
            <span><b>A dotted ring</b> marks a detail the family hasn't confirmed yet.</span>
          </li>
        </ul>

        <div className="legend__setting">
          <label className="toggle toggle--row">
            <span className="legend__setting-text">
              <b>Combine parent lines</b>
              <span>One line from a couple to each child, instead of one per parent.</span>
            </span>
            <input type="checkbox" checked={!!mergeParents} onChange={onToggleMerge} />
          </label>
        </div>

        <p className="legend__privacy">
          We never sell your family's data and there is no ad tracking. Details about
          living people — especially children — stay within your family.
        </p>
        <button className="btn btn--primary legend__close" onClick={onClose}>
          Got it
        </button>
      </section>
    </div>
  );
}

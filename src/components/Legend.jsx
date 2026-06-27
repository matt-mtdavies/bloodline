import { useEffect } from 'react';

// A quiet key to what the bubbles and bonds mean. Opened from the top bar.
const LAYOUTS = [
  { id: 'organic', label: 'Organic', desc: 'Free-flowing network' },
  { id: 'weighted', label: 'Weighted', desc: 'Closest family pulled in' },
  { id: 'hybrid', label: 'Generational', desc: 'Clear vertical bands' },
  { id: 'chart', label: 'Chart', desc: 'Traditional family tree chart' },
];

export default function Legend({ open, onClose, mergeParents, onToggleMerge, layout = 'organic', onSetLayout }) {
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
            <span><b>A dashed pod</b> marks former partners who share children — both still very much parents.</span>
          </li>
          <li>
            <span className="swatch swatch--bio" />
            <span><b>A solid line</b> is a biological parent.</span>
          </li>
          <li>
            <span className="swatch swatch--nonbio" />
            <span><b>A dashed line</b> is an adopted or foster bond — equal, just distinct. Step-bonds are read through the couple, so the tree stays clean; tap a person to reveal any standalone step links.</span>
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

        <div className="legend__setting legend__setting--layout">
          <span className="legend__setting-text">
            <b>Layout algorithm</b>
            <span>How the network arranges itself.</span>
          </span>
          <div className="layout-seg" role="group" aria-label="Layout algorithm">
            {LAYOUTS.map((m) => (
              <button
                key={m.id}
                className={`layout-seg__btn${layout === m.id ? ' layout-seg__btn--on' : ''}`}
                onClick={() => onSetLayout?.(m.id)}
                title={m.desc}
              >
                {m.label}
              </button>
            ))}
          </div>
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

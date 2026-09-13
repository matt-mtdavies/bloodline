import { useEffect } from 'react';

// A quiet key to what the bubbles and bonds mean. Opened from the top bar.
// Switching how the family is DISPLAYED (tree/chart/list) lives in its own
// menu next to the thing it controls, not here — this stays a pure reference.
//
// `chartMode` swaps the organic tree's own pod/membrane language (which
// doesn't exist in Chart view — Chart has no pods, just flat plate cards
// joined by lines) for a reference grounded in what Chart actually draws:
// see ChartTree.jsx's `.ped-partnerlink`/`.ped-link` stroke rules and the
// `.ped-up--add` "add" pips. Each entry below was checked against that
// source directly rather than assumed from the organic tree's own list.
export default function Legend({ open, onClose, chartMode = false }) {
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
        <h2 className="legend__title">{chartMode ? 'Reading your chart' : 'Reading your tree'}</h2>
        {chartMode ? (
          <ul className="legend">
            <li>
              <span className="swatch swatch--chart-current" />
              <span><b>A solid warm line</b> joins a current couple.</span>
            </li>
            <li>
              <span className="swatch swatch--former" />
              <span><b>A faded dashed line</b> is a former partnership — still part of the story.</span>
            </li>
            <li>
              <span className="swatch swatch--chart-widowed" />
              <span><b>A solid violet line</b> remembers a partner who has passed.</span>
            </li>
            <li>
              <span className="swatch swatch--bio" />
              <span><b>A solid line down</b> to a child is a biological parent.</span>
            </li>
            <li>
              <span className="swatch swatch--chart-step" />
              <span><b>A faded dashed line down</b> is an adopted or step bond — equal, just distinct.</span>
            </li>
            <li>
              <span className="swatch swatch--chart-add" aria-hidden="true">+</span>
              <span><b>A dashed circle with a plus</b> means nothing's recorded there yet — tap it to add a parent or child right from the chart.</span>
            </li>
          </ul>
        ) : (
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
        )}

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

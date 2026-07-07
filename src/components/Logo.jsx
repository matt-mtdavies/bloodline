/*
 * The Bloodline mark: two bound circles (a union) with a third budding below
 * (a child) — a family in three bubbles, echoing the tree itself. White
 * knockout rings keep the overlaps crisp on any ground. The bubbles pop in on
 * load with a gentle stagger.
 *
 * `loading` swaps that one-shot pop-in for a slow, looping breathe: the three
 * bubbles shrink just enough to reveal the lines connecting them (implied by
 * overlap at rest, drawn explicit here), then grow back together — giving the
 * loading screen's otherwise-static wait a bit of the same "family, connected"
 * idea the mark already carries, rather than a generic spinner.
 */
export default function Logo({ size = 30, animate = true, loading = false }) {
  const cls = 'logo' + (animate ? ' logo--in' : '') + (loading ? ' logo--loading' : '');
  return (
    <svg
      className={cls}
      width={size}
      height={(size * 40) / 42}
      viewBox="0 0 42 40"
      fill="none"
      aria-hidden="true"
    >
      {loading && (
        <g className="logo__links">
          <line className="logo__link" x1="15" y1="17" x2="27" y2="17" />
          <line className="logo__link" x1="15" y1="17" x2="21" y2="29" />
          <line className="logo__link" x1="27" y1="17" x2="21" y2="29" />
        </g>
      )}
      <circle className="logo__a" cx="15" cy="17" r="10" fill="#c2603a" stroke="#fff" strokeWidth="2.4" />
      <circle className="logo__b" cx="27" cy="17" r="10" fill="#3f5e4e" stroke="#fff" strokeWidth="2.4" />
      <circle className="logo__c" cx="21" cy="29" r="6.6" fill="#b08642" stroke="#fff" strokeWidth="2.4" />
    </svg>
  );
}

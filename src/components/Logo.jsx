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
 *
 * `idle` is the quiet, permanent version of that same idea for the topbar
 * mark — a barely-there independent drift per bubble (fractions of a pixel,
 * nothing like the loading screen's more obvious reveal) so the mark reads
 * as alive rather than a static icon, without competing for attention while
 * someone's actually using the app. Picks up seamlessly once the entrance
 * pop-in finishes, rather than fighting it for the same frames.
 */
export default function Logo({ size = 30, animate = true, loading = false, idle = false }) {
  const cls = 'logo' + (animate ? ' logo--in' : '') + (loading ? ' logo--loading' : '') + (idle ? ' logo--idle' : '');
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
          <line className="logo__link" x1="13.9" y1="16.5" x2="28.1" y2="16.5" />
          <line className="logo__link" x1="13.9" y1="16.5" x2="21" y2="30.6" />
          <line className="logo__link" x1="28.1" y1="16.5" x2="21" y2="30.6" />
        </g>
      )}
      <circle className="logo__a" cx="13.9" cy="16.5" r="11.8" fill="#c2603a" stroke="#fff" strokeWidth="2.8" />
      <circle className="logo__b" cx="28.1" cy="16.5" r="11.8" fill="#3f5e4e" stroke="#fff" strokeWidth="2.8" />
      <circle className="logo__c" cx="21" cy="30.6" r="7.8" fill="#c4913f" stroke="#fff" strokeWidth="2.8" />
    </svg>
  );
}

/*
 * A one-time coach-mark pointing at the logo — the only way anyone on touch
 * (no hover, so no hover-tip) would ever learn tapping it opens the home
 * hub. Shown once ever (see the bl_home_nudge_seen flag in App.jsx),
 * auto-dismisses on its own after a few seconds so it never needs to be
 * acted on to go away.
 */
export default function HomeNudge({ onDismiss }) {
  return (
    <div className="home-nudge" role="status">
      <span className="home-nudge__arrow" aria-hidden="true" />
      <span className="home-nudge__text">Tap the logo anytime for your family's story hub</span>
      <button className="home-nudge__close" onClick={onDismiss} aria-label="Dismiss">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

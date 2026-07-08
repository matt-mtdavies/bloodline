import { useEffect } from 'react';
import { relativeTime } from './ActivityFeed.jsx';

/*
 * The activity recap's cinematic tour — a slow, deliberate flythrough of
 * everyone who's changed since you were last here, one person at a time
 * (see App.jsx's openRecap() and BubbleTree's spotlightTour). This component
 * owns none of the camera choreography; it just renders the scrim, the
 * per-stop caption, and a small progress pill, and reports "stop the tour"
 * back up as onCloseAll/onClose.
 *
 * There is deliberately NO queue-list panel here any more, on any screen
 * size. The camera's target bubble is always screen-CENTRED (see
 * BubbleTree's world.position.set), and the old right-hand drawer reached
 * well past that centre even on an iPad — a panel narrating the reveal was
 * covering the reveal. The caption at the bubble already names every
 * distinct change (plus who made them and when, below), and the Activity
 * tab remains the place to browse or revisit updates at leisure — this
 * overlay is for sitting back and watching, so the only chrome it keeps is
 * a count of what's left and a way out.
 */
export default function RecapTour({ queue, reducedMotion, allDone, onCloseAll, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCloseAll(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCloseAll]);

  // Auto-close a beat after the tour finishes on its own — the payoff
  // (everyone lit up) lingers for a moment rather than vanishing the instant
  // the camera stops, but doesn't require a tap to dismiss.
  useEffect(() => {
    if (!allDone) return;
    const t = setTimeout(onClose, 3400);
    return () => clearTimeout(t);
  }, [allDone, onClose]);

  const active = queue.find((q) => q.status === 'active');
  const remaining = queue.filter((q) => q.status !== 'done').length;

  return (
    <div className="recap-tour" role="dialog" aria-label="What's changed" aria-modal="true">
      <div className="recap-tour__scrim" onClick={onCloseAll} aria-hidden="true" />

      {!reducedMotion && active && !allDone && (
        <div className="recap-caption" role="status" aria-live="polite">
          <span className="recap-caption__name">{active.personName}</span>
          <span className="recap-caption__what">{active.caption}</span>
          {(active.authorName || active.at) && (
            <span className="recap-caption__meta">
              {active.authorName ? `by ${active.authorName}` : ''}
              {active.authorName && active.at ? ' · ' : ''}
              {active.at ? relativeTime(active.at) : ''}
            </span>
          )}
        </div>
      )}

      {allDone && (
        <div className="recap-caption recap-caption--done" role="status" aria-live="polite">
          <span className="recap-caption__name">✨ All caught up</span>
        </div>
      )}

      {!allDone && (
        <div className="recap-progress">
          <span className="recap-progress__count">{remaining}</span>
          <span>to go</span>
          <button className="recap-progress__close" onClick={onCloseAll} aria-label="Stop the tour">
            <CloseIcon />
          </button>
        </div>
      )}
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

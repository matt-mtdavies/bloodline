import { useEffect } from 'react';
import Avatar from './Avatar.jsx';

/*
 * The activity recap's cinematic tour — a slow, deliberate flythrough of
 * everyone who's changed since you were last here, one person at a time
 * (see App.jsx's openRecap() and BubbleTree's spotlightTour). This component
 * owns none of the camera choreography; it just renders the scrim, the
 * per-stop caption, and the queue list, and reports taps back up as
 * onSkipTo/onDismiss/onCloseAll/onClose.
 *
 * The queue panel doubles as a bottom drawer on narrow phones and a side
 * panel on wider screens — same markup, repositioned by CSS — since a fixed
 * side panel has no room next to a live canvas at phone width.
 */
export default function RecapTour({ graph, queue, reducedMotion, allDone, onDismiss, onSkipTo, onCloseAll, onClose }) {
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
        </div>
      )}

      {allDone && (
        <div className="recap-caption recap-caption--done" role="status" aria-live="polite">
          <span className="recap-caption__name">✨ All caught up</span>
        </div>
      )}

      <div className="recap-queue">
        <div className="recap-queue__header">
          <div>
            <p className="recap-queue__title">What&apos;s changed</p>
            {!allDone && <p className="recap-queue__sub">{remaining} to go</p>}
          </div>
          <button className="recap-queue__close" onClick={allDone ? onClose : onCloseAll} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <ul className="recap-queue__list">
          {queue.map((item) => {
            const person = graph.byId.get(item.personId) ?? { display_name: item.personName };
            return (
              <li key={item.personId}>
                <div className={`recap-row recap-row--${item.status}`}>
                  <button
                    className="recap-row__main"
                    onClick={() => onSkipTo(item.personId)}
                    disabled={item.status === 'done'}
                  >
                    <Avatar person={person} size={38} />
                    <span className="recap-row__text">
                      <span className="recap-row__name">{item.personName}</span>
                      <span className="recap-row__caption">{item.caption}</span>
                    </span>
                  </button>
                  {item.status !== 'done' && (
                    <button
                      className="recap-row__dismiss"
                      onClick={() => onDismiss(item.personId)}
                      aria-label={`Skip ${item.personName}`}
                    >
                      <CloseIcon />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {!allDone && (
          <button className="recap-queue__closeall" onClick={onCloseAll}>Close all</button>
        )}
      </div>
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

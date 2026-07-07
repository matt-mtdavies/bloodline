import { useEffect, useState } from 'react';
import Avatar from './Avatar.jsx';

/*
 * The activity recap's cinematic tour — a slow, deliberate flythrough of
 * everyone who's changed since you were last here, one person at a time
 * (see App.jsx's openRecap() and BubbleTree's spotlightTour). This component
 * owns none of the camera choreography; it just renders the scrim, the
 * per-stop caption, and the queue list, and reports taps back up as
 * onSkipTo/onDismiss/onCloseAll/onClose.
 *
 * The camera's target bubble is always screen-CENTRED (see BubbleTree's
 * world.position.set), and on a phone the queue panel's width reaches well
 * past that centre point — so on narrow screens it starts collapsed to a
 * small peek pill (tap to expand) rather than a full list, leaving the
 * actual reveal visible instead of covered by an overlay competing for the
 * same screen real estate. Wider screens have room for both, so the full
 * panel there is unaffected by this state. Auto-expands once the tour
 * finishes — there's no more animation to protect at that point.
 */
export default function RecapTour({ graph, queue, reducedMotion, allDone, onDismiss, onSkipTo, onCloseAll, onClose }) {
  const [expanded, setExpanded] = useState(false);

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

      {!expanded && !allDone && (
        <button className="recap-queue-peek" onClick={() => setExpanded(true)}>
          <span className="recap-queue-peek__count">{remaining}</span>
          <span>to go</span>
          <ChevronUpIcon />
        </button>
      )}

      <div className={`recap-queue${(expanded || allDone) ? ' recap-queue--expanded' : ''}`}>
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
                      <span className="recap-row__caption">{item.detail || item.caption}</span>
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

function ChevronUpIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 15l-6-6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

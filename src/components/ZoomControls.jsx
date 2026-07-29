import { useEffect, useRef, useState } from 'react';

// On-screen zoom controls for the tree canvas — built for trackpad users on
// Mac laptops, where the wheel/pinch gesture (see BubbleTree.jsx's own wheel-
// sensitivity fix) is still the primary way to zoom, but a discoverable,
// precise alternative removes the need to fight the gesture at all.
//
// Desktop/trackpad-only by design (gated in CSS via `pointer: fine` — see
// components.css): touchscreens already have native pinch-zoom that works
// well, and the bottom edge on mobile is already occupied by the dock and
// the "back to you" pill, so a third permanent cluster there would be a
// regression in the name of fixing a desktop-only problem.
const HOLD_INITIAL_DELAY_MS = 380;
const HOLD_REPEAT_MS = 90;
const AT_LIMIT_FLASH_MS = 220;

export default function ZoomControls({ viewApi }) {
  const [atLimit, setAtLimit] = useState(null); // 'in' | 'out' | null
  const holdTimer = useRef(null);
  const flashTimer = useRef(null);

  useEffect(() => () => {
    clearTimeout(holdTimer.current);
    clearTimeout(flashTimer.current);
  }, []);

  const step = (dir, which) => {
    const result = viewApi.current?.zoomStep?.(dir);
    if (result?.atLimit) {
      setAtLimit(which);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setAtLimit(null), AT_LIMIT_FLASH_MS);
    }
  };

  // Press-and-hold repeat: the initial step comes from onClick (so a single
  // tap — mouse or keyboard — always steps exactly once); pointerdown only
  // arms a delayed repeat in case the press is actually held, mirroring the
  // native OS "spinner button" convention.
  const startHold = (dir, which) => {
    clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(function repeat() {
      step(dir, which);
      holdTimer.current = setTimeout(repeat, HOLD_REPEAT_MS);
    }, HOLD_INITIAL_DELAY_MS);
  };
  const endHold = () => {
    clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  return (
    <div className="zoom-controls">
      <button
        className={`zoom-controls__btn zoom-controls__btn--in${atLimit === 'in' ? ' zoom-controls__btn--limit' : ''}`}
        onClick={() => step(1, 'in')}
        onPointerDown={() => startHold(1, 'in')}
        onPointerUp={endHold}
        onPointerLeave={endHold}
        aria-label="Zoom in"
      >
        <PlusIcon />
      </button>
      <span className="zoom-controls__divider" aria-hidden="true" />
      <button
        className="zoom-controls__btn zoom-controls__btn--fit"
        onClick={() => viewApi.current?.recenter()}
        aria-label="Fit the tree to screen"
      >
        <FitIcon />
      </button>
      <span className="zoom-controls__divider" aria-hidden="true" />
      <button
        className={`zoom-controls__btn zoom-controls__btn--out${atLimit === 'out' ? ' zoom-controls__btn--limit' : ''}`}
        onClick={() => step(-1, 'out')}
        onPointerDown={() => startHold(-1, 'out')}
        onPointerUp={endHold}
        onPointerLeave={endHold}
        aria-label="Zoom out"
      >
        <MinusIcon />
      </button>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function MinusIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
// Same crosshair glyph PersonSheet's "Centre the tree here" button already
// uses — this button performs the identical recenter() action, so it should
// read as the same control, not a new one.
function FitIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

import { useEffect, useState } from 'react';

// The tree screen's ambient, idle-only insight (nav brief: "give the tree
// screen a quiet version of Home's Did-you-know teaser"). Waits out a long
// settled pause in browse mode before appearing — comfortably longer than
// IntroHint's own 5.2s window, so the two quiet hints at the bottom of the
// screen never compete for the same moment — then behaves exactly like
// IntroHint: self-dismisses on the first touch or after a few seconds, once
// per session so it never nags on every return to browse mode.
const IDLE_MS = 8000;
const VISIBLE_MS = 6000;

export default function IdleFactHint({ fact, active }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active || !fact) return;
    if (sessionStorage.getItem('bl_idle_fact_seen') === '1') return;
    const t = setTimeout(() => setVisible(true), IDLE_MS);
    return () => clearTimeout(t);
  }, [active, fact]);

  useEffect(() => {
    if (!visible) return;
    const hide = () => {
      sessionStorage.setItem('bl_idle_fact_seen', '1');
      setVisible(false);
    };
    const t = setTimeout(hide, VISIBLE_MS);
    window.addEventListener('pointerdown', hide, { once: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', hide);
    };
  }, [visible]);

  if (!visible || !fact) return null;
  return (
    <div className="intro-hint intro-hint--fact" role="status">
      <span className="intro-hint__spark" aria-hidden="true">✨</span>
      {fact}
    </div>
  );
}

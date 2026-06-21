import { useEffect, useState } from 'react';
import Logo from './Logo.jsx';

/*
 * A one-time animated open: the Bloodline bubbles assemble, the wordmark
 * settles, then the whole thing lifts and dissolves to reveal the tree. Shown
 * once per session; tap to skip.
 */
export default function Splash() {
  const [gone, setGone] = useState(() => sessionStorage.getItem('bl_splash') === '1');

  useEffect(() => {
    if (gone) return;
    const t = setTimeout(dismiss, 2300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = () => {
    sessionStorage.setItem('bl_splash', '1');
    setGone(true);
  };

  if (gone) return null;
  return (
    <div className="splash" onClick={dismiss} role="presentation">
      <div className="splash__inner">
        <Logo size={92} />
        <span className="splash__word">Bloodline</span>
      </div>
    </div>
  );
}

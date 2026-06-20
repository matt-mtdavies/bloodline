import { useEffect, useState } from 'react';

// A single, gentle nudge on first load. Fades itself away — and the moment the
// user touches the tree, it's gone. The glide should teach the rest.
export default function IntroHint() {
  const [visible, setVisible] = useState(
    () => sessionStorage.getItem('bl_hint_seen') !== '1',
  );
  useEffect(() => {
    if (!visible) return;
    const hide = () => {
      sessionStorage.setItem('bl_hint_seen', '1');
      setVisible(false);
    };
    const t = setTimeout(hide, 5200);
    window.addEventListener('pointerdown', hide, { once: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', hide);
    };
  }, [visible]);
  if (!visible) return null;
  return (
    <div className="intro-hint" role="status">
      Tap a face to grow your family
    </div>
  );
}

import { useEffect, useState } from 'react';

// A single, gentle nudge on first load. Fades itself away — and the moment the
// user touches the tree, it's gone. The glide should teach the rest.
export default function IntroHint() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 5200);
    const dismiss = () => setVisible(false);
    window.addEventListener('pointerdown', dismiss, { once: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', dismiss);
    };
  }, []);
  if (!visible) return null;
  return (
    <div className="intro-hint" role="status">
      Tap any face to fly to them
    </div>
  );
}

import { useEffect, useState } from 'react';
import Logo from './Logo.jsx';

// Duration each phase is shown before auto-advancing (null = stays until user acts)
const PHASE_MS = [2000, 3200, 2800, 2400, null];
const LAST = PHASE_MS.length - 1;

export default function Intro({ onBegin }) {
  const [phase, setPhase] = useState(0);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const ms = PHASE_MS[phase];
    if (ms == null) return;
    const t = setTimeout(() => setPhase((p) => p + 1), ms);
    return () => clearTimeout(t);
  }, [phase]);

  const skip = (e) => {
    e?.stopPropagation();
    setPhase(LAST);
  };

  const begin = () => {
    setLeaving(true);
    setTimeout(onBegin, 540);
  };

  return (
    <div className={`intro${leaving ? ' intro--exit' : ''}`} onClick={() => phase < LAST && skip()}>
      <div key={phase} className="intro__slide">
        {phase === 0 && <SlideMark />}
        {phase === 1 && <SlideThesis />}
        {phase === 2 && <SlideTree />}
        {phase === 3 && <SlideMemory />}
        {phase === 4 && <SlideCta onBegin={begin} />}
      </div>

      {phase < LAST && (
        <button className="intro__skip" onClick={skip} aria-label="Skip intro">
          Skip
        </button>
      )}
    </div>
  );
}

function SlideMark() {
  return (
    <>
      <Logo size={80} animated />
      <p className="intro__word">Bloodline</p>
    </>
  );
}

function SlideThesis() {
  return (
    <div className="intro__thesis-group">
      <p className="intro__thesis" style={{ '--d': '0ms' }}>The tree is navigation.</p>
      <p className="intro__thesis" style={{ '--d': '680ms' }}>The profile is the destination.</p>
      <p className="intro__thesis intro__thesis--accent" style={{ '--d': '1360ms' }}>
        The stories are the product.
      </p>
    </div>
  );
}

function SlideTree() {
  return (
    <div className="intro__tree">
      <svg viewBox="0 0 200 226" width="176" height="199" aria-hidden="true">
        <line x1="100" y1="42" x2="100" y2="88" className="itree__line itree__line--1" stroke="#d4c4ba" strokeWidth="1.6" strokeLinecap="round" />
        <line x1="100" y1="88" x2="54"  y2="130" className="itree__line itree__line--2" stroke="#d4c4ba" strokeWidth="1.6" strokeLinecap="round" />
        <line x1="100" y1="88" x2="146" y2="130" className="itree__line itree__line--3" stroke="#d4c4ba" strokeWidth="1.6" strokeLinecap="round" />
        <line x1="54"  y1="130" x2="34"  y2="182" className="itree__line itree__line--4" stroke="#d4c4ba" strokeWidth="1.6" strokeLinecap="round" />
        <line x1="54"  y1="130" x2="74"  y2="182" className="itree__line itree__line--5" stroke="#d4c4ba" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="100" cy="28"  r="20" className="itree__node itree__node--1" fill="#b85838" />
        <circle cx="54"  cy="116" r="18" className="itree__node itree__node--2" fill="#4a7c6f" />
        <circle cx="146" cy="116" r="18" className="itree__node itree__node--3" fill="#7c6244" />
        <circle cx="34"  cy="194" r="14" className="itree__node itree__node--4" fill="#4a5a7c" />
        <circle cx="74"  cy="194" r="14" className="itree__node itree__node--5" fill="#6f4a7c" />
      </svg>
      <p className="intro__tree-label">A family, at a glance.</p>
    </div>
  );
}

function SlideMemory() {
  return (
    <div className="intro__memory">
      <div className="intro__memory-mark">"</div>
      <p className="intro__memory-text">
        Every Christmas he made pancakes for everyone in the house,
        even if he'd only met you once.
      </p>
      <p className="intro__memory-attr">— Sarah, 2024</p>
    </div>
  );
}

function SlideCta({ onBegin }) {
  return (
    <>
      <p className="intro__headline">
        Your family deserves<br />to be remembered.
      </p>
      <button className="intro__cta" onClick={(e) => { e.stopPropagation(); onBegin(); }}>
        Begin your story →
      </button>
      <p className="intro__cta-note">Private by design · Free to start</p>
    </>
  );
}

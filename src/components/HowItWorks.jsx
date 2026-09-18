import { useEffect, useRef } from 'react';
import ReturnMark from './ReturnMark.jsx';
import { useDialogFocus } from '../lib/useDialogFocus.js';
import { useReducedMotion } from '../hooks/useReducedMotion.js';

/*
 * A quick tour — the four feature clips that used to live inline on Home,
 * now a page of its own reached by tapping "How it works" there. Same real
 * screen recordings (see public/tutorials/), just off the home scroll so
 * Home itself reads as a launch point rather than the whole app in one feed.
 */
export default function HowItWorks({ onClose }) {
  const panelRef = useRef(null);
  // Real gap found by /impeccable audit: this was the one sheet in the app
  // that declared role="dialog" aria-modal="true" but never got wired into
  // the shared focus trap from the profile-view critique, the same miss
  // ActivityFeed/Home.jsx each had before their own audits reached them.
  useDialogFocus(panelRef, true, { initialFocus: '.return-mark' });

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="subpage" role="dialog" aria-modal="true" aria-label="How it works" ref={panelRef}>
      <div className="subpage__top">
        <ReturnMark onClick={onClose} label="Back to home" />
        <span className="subpage__top-title">How it works</span>
        <span className="subpage__top-spacer" aria-hidden="true" />
      </div>

      <div className="subpage__scroll">
        <p className="subpage__eyebrow">A quick tour</p>
        <h1 className="subpage__title">Four ways to explore</h1>

        <FeatureClip
          src="/tutorials/tap.mp4"
          poster="/tutorials/tap.jpg"
          title="Tap a face"
          desc="Bring their branch of the family into view."
        />
        <FeatureClip
          src="/tutorials/search.mp4"
          poster="/tutorials/search.jpg"
          title="Search"
          desc="Jump straight to anyone and expand their relationships."
        />
        <FeatureClip
          src="/tutorials/lineage.mp4"
          poster="/tutorials/lineage.jpg"
          title="Lineage mode"
          desc="Trace the direct bloodline between two people."
        />
        <FeatureClip
          src="/tutorials/timeline.mp4"
          poster="/tutorials/timeline.jpg"
          title="Timeline"
          desc="Play your family's history back in order."
        />
      </div>
    </div>
  );
}

function FeatureClip({ src, poster, title, desc }) {
  // Real gap found by /impeccable audit: four autoplaying, looping clips
  // with no prefers-reduced-motion consideration at all. Reuses the same
  // hook Intro.jsx's own phase timer already respects — the poster frame
  // alone is a perfectly legible stand-in for a still, non-autoplaying tour.
  const reducedMotion = useReducedMotion();
  return (
    <div className="home__feature-card">
      <video
        className="home__clip"
        src={src}
        poster={poster}
        autoPlay={!reducedMotion}
        loop={!reducedMotion}
        muted
        playsInline
        preload="metadata"
      />
      <div className="home__feature-text">
        <span className="home__feature-title">{title}</span>
        <span className="home__feature-desc">{desc}</span>
      </div>
    </div>
  );
}

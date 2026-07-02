import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import { relationLabel } from '../data/graph.js';
import { lifespan, ageOrAt } from '../lib/dates.js';

const CARD_WIDTH = 288;
const MARGIN = 16;
const FLIP_THRESHOLD = 260; // px from top before the card flips below the bubble
const EXIT_MS = 150; // keep mounted this long after hover ends, to let the fade play

/*
 * Desktop-only hover preview — rests over a bubble for a beat and a small
 * card surfaces their core details, without the weight of opening the full
 * profile. Position tracks the bubble live via getPos() (same rAF pattern as
 * FocusNameplate); the reveal/dismiss transition runs on a separate inner
 * element so the per-frame position writes never fight the CSS transition.
 */
export default function HoverCard({ graph, personId, viewerId, getPos }) {
  const anchorRef = useRef(null);
  const lastPos = useRef(null);
  const [displayId, setDisplayId] = useState(null);
  const [show, setShow] = useState(false);
  const hideTimer = useRef(null);

  useEffect(() => {
    clearTimeout(hideTimer.current);
    if (personId) {
      setDisplayId(personId);
      let raf1 = requestAnimationFrame(() => {
        raf1 = requestAnimationFrame(() => setShow(true));
      });
      return () => cancelAnimationFrame(raf1);
    }
    setShow(false);
    hideTimer.current = setTimeout(() => setDisplayId(null), EXIT_MS);
    return () => clearTimeout(hideTimer.current);
  }, [personId]);

  useEffect(() => {
    let raf;
    const tick = () => {
      const el = anchorRef.current;
      if (el) {
        const p = getPos?.() || lastPos.current;
        if (p) {
          lastPos.current = p;
          const flip = p.y < FLIP_THRESHOLD;
          const gap = 66; // clears the bubble + its name label
          const y = flip ? p.y + gap : p.y - gap;
          const halfW = CARD_WIDTH / 2;
          const minX = halfW + MARGIN;
          const maxX = (window.innerWidth || 1200) - halfW - MARGIN;
          const x = Math.max(minX, Math.min(maxX, p.x));
          el.style.transform = `translate(${x}px, ${y}px) translate(-50%, ${flip ? '0%' : '-100%'})`;
          el.style.setProperty('--card-origin', flip ? '50% 0%' : '50% 100%');
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getPos]);

  useEffect(() => {
    if (!personId) lastPos.current = null;
  }, [personId]);

  const person = displayId ? graph.byId.get(displayId) : null;
  if (!person) return null;

  const minor = person.is_minor && !person.is_deceased;
  const vis = person.visibility || 'full';
  const sealed = vis === 'private';
  const summaryOnly = vis === 'summary';
  const restricted = minor || sealed || summaryOnly;

  const relToViewer = viewerId && viewerId !== person.id ? relationLabel(graph, viewerId, person.id) : null;
  const location = !restricted && (person.residence || person.birth_place);
  const age = ageOrAt(person);

  const metaBits = [];
  if (!sealed) {
    if (!restricted && person.occupation) metaBits.push(person.occupation);
    metaBits.push(lifespan(person));
    if (!minor && age) metaBits.push(person.is_deceased ? age : `age ${age}`);
  }
  const bio = !restricted ? person.bio : null;
  const tags = !restricted && person.tags?.length ? person.tags.slice(0, 3) : [];

  // A quick "what's their story" hook — child/grandchild counts read as an
  // invitation to explore ("oh, 5 grandchildren?") in a way a bare
  // relationship label doesn't. Skipped for restricted profiles for the same
  // reason bio/tags/location are — it's still information about who's
  // connected to them.
  //
  // Siblings are handled separately (see siblingLabels below), NOT as a
  // count: "5 siblings" flattens full/half/step into one number, which a
  // blended family may not want implied about them. Every other relation
  // label in this app already spells out "Half-Brother" / "Step-Sister"
  // rather than hiding it in a tally, so folding siblings into an aggregate
  // count here was the actual inconsistency.
  const familyBits = [];
  if (!restricted) {
    const childCount = graph.children(person.id).length;
    const grandchildIds = new Set();
    for (const c of graph.children(person.id)) {
      for (const gc of graph.children(c.id)) grandchildIds.add(gc.id);
    }
    if (childCount) familyBits.push(`${childCount} ${childCount === 1 ? 'child' : 'children'}`);
    if (grandchildIds.size) familyBits.push(`${grandchildIds.size} grandchild${grandchildIds.size === 1 ? '' : 'ren'}`);
  }

  // Each sibling named by their actual relation to THIS person — "Sister",
  // "Half-Brother", "Step-Sibling" — never bucketed into a single number.
  // Beyond a few, a static line would overflow the card, so it scrolls as a
  // ticker instead of getting truncated or wrapping into a wall of text.
  const siblingLabels = !restricted
    ? graph.siblings(person.id).map((s) => relationLabel(graph, person.id, s.id))
    : [];

  return (
    <div className="hover-card-anchor" ref={anchorRef} style={{ width: CARD_WIDTH }} aria-hidden="true">
      <div className={`hover-card${show ? ' hover-card--show' : ''}`}>
        <div className="hover-card__head">
          <Avatar person={person} size={56} />
          <div className="hover-card__id">
            <span className="hover-card__name">{person.display_name}</span>
            {relToViewer && <span className="hover-card__kin">{relToViewer}</span>}
          </div>
        </div>
        {!sealed && metaBits.length > 0 && (
          <p className="hover-card__meta">{metaBits.join(' · ')}</p>
        )}
        {siblingLabels.length > 0 && (
          <div className="hover-card__family hover-card__siblings">
            <FamilyIcon />
            {siblingLabels.length > 3 ? (
              <div className="hover-card__ticker">
                <div
                  className="hover-card__ticker-track"
                  style={{ animationDuration: `${siblingLabels.length * 1.4}s` }}
                >
                  {[...siblingLabels, ...siblingLabels].map((label, i) => (
                    <span className="hover-card__ticker-item" key={i}>{label}</span>
                  ))}
                </div>
              </div>
            ) : (
              <span>{siblingLabels.join(' · ')}</span>
            )}
          </div>
        )}
        {familyBits.length > 0 && (
          <p className="hover-card__family"><FamilyIcon />{familyBits.join(' · ')}</p>
        )}
        {location && (
          <p className="hover-card__where"><PinIcon />{location}</p>
        )}
        {bio && <p className="hover-card__bio">&ldquo;{snippet(bio)}&rdquo;</p>}
        {tags.length > 0 && (
          <div className="hover-card__tags">
            {tags.map((t) => <span className="hover-card__tag" key={t}>{t}</span>)}
          </div>
        )}
        {sealed && <p className="hover-card__sealed">Private profile</p>}
      </div>
    </div>
  );
}

// A "snapshot", not the full bio — trims to a clause/word boundary near
// 110 chars so it reads as a teaser rather than getting hard-clipped mid-word.
function snippet(text, max = 110) {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastBreak = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(', '), cut.lastIndexOf(' '));
  return `${cut.slice(0, lastBreak > 40 ? lastBreak : max).trim()}…`;
}

function FamilyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="hover-card__pin">
      <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17" cy="9" r="2.6" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3 20v-1.5A4.5 4.5 0 0 1 7.5 14h1A4.5 4.5 0 0 1 13 18.5V20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M14.5 14.3A3.6 3.6 0 0 1 21 16.6V17.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="hover-card__pin">
      <path d="M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="10" r="2.3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

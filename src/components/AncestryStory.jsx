import { useEffect, useMemo, useState } from 'react';
import { buildAncestryFacts, ancestryReady, factsHash } from '../lib/ancestryStory.js';
import { buildTimelineLayout } from '../lib/placesTimeline.js';
import { fetchWithTimeout } from '../lib/net.js';

// Same fix as KeepsakeView.jsx (the Ancestry Story shares its compiled-
// edition architecture) — a real user report of the app "freezing" during
// AI generation traced to fetch() having no timeout anywhere here.
const LOAD_TIMEOUT_MS = 25_000;
const COMPILE_TIMEOUT_MS = 90_000;

/*
 * The Ancestry Story — "where you come from," told forward in time from the
 * earliest recorded ancestor down to the subject, on four threads grouped
 * into two sides — Father's side (his father's line + his mother's line)
 * and Mother's side (her mother's line + her father's line) — switched via a
 * toggle, since showing all four stacked at once was too long for what's
 * meant to read as a story (see lib/ancestryStory.js's own header for the
 * full shape and why not the exponential full pedigree). Real feedback: v1
 * only ever showed the pure patrilineal + matrilineal pair, "half the
 * picture" — the other two grandparent lines were added alongside this
 * toggle. Same architecture as the Keepsake (a compiled, R2-stored,
 * hash-keyed edition; a quiet banner offers to "weave in the changes" the
 * moment the tree grows past what the last edition was compiled from) but
 * scoped to an inline profile section, not a full-screen reader — there's no
 * per-section manual editing here (v1; PUT /api/ancestry-story exists
 * server-side for a future pass), and, same as the Keepsake's own compile
 * button, any family member may compile or regenerate — this only ever
 * writes a stored narrative, never tree data.
 *
 * Every chain reuses lib/placesTimeline.js's buildTimelineLayout verbatim —
 * the exact same "position encodes chronology only, never distance" wave
 * timeline Places Lived and Military Service already use, just fed
 * ancestors instead of residences. Waypoints here are read-only (an
 * ancestor isn't a separate editable record the way a residence is).
 */
const SIDES = [
  { key: 'father', label: "Father's side" },
  { key: 'mother', label: "Mother's side" },
];

export default function AncestryStory({ graph, personId, onCompiled }) {
  const facts = useMemo(() => buildAncestryFacts(graph, personId), [graph, personId]);
  const [side, setSide] = useState('father');

  const [state, setState] = useState('loading'); // loading | ready | unavailable
  const [edition, setEdition] = useState(null);
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState(false);

  useEffect(() => {
    let alive = true;
    setState('loading');
    setEdition(null);
    setCompileError(false);
    setSide('father');
    (async () => {
      try {
        const r = await fetchWithTimeout(`/api/ancestry-story?personId=${encodeURIComponent(personId)}`, {}, LOAD_TIMEOUT_MS);
        if (!alive) return;
        if (!r.ok) { setState('unavailable'); return; }
        const body = await r.json().catch(() => null);
        if (!alive) return;
        setEdition(body || null);
        setState('ready');
      } catch {
        if (alive) setState('unavailable');
      }
    })();
    return () => { alive = false; };
  }, [personId]);

  const layoutFor = (line) => buildTimelineLayout(line?.map((a) => ({ id: a.id })));
  const fatherFatherLayout = useMemo(() => layoutFor(facts?.fatherSide?.fatherLine), [facts]);
  const fatherMotherLayout = useMemo(() => layoutFor(facts?.fatherSide?.motherLine), [facts]);
  const motherMotherLayout = useMemo(() => layoutFor(facts?.motherSide?.motherLine), [facts]);
  const motherFatherLayout = useMemo(() => layoutFor(facts?.motherSide?.fatherLine), [facts]);

  if (!facts) return null; // private subject — never generatable, same rule as the Keepsake
  const ready = ancestryReady(facts);
  if (!ready && !edition) return null; // too thin to tell yet, and nothing already compiled
  if (state === 'loading') return null; // avoid flashing "not compiled" before we know an edition might exist

  const stale = edition && edition.hash !== factsHash(facts);
  const canCompile = state === 'ready';

  async function compile() {
    if (compiling) return;
    setCompiling(true);
    setCompileError(false);
    try {
      const r = await fetchWithTimeout('/api/ancestry-story', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ personId, facts }),
      }, COMPILE_TIMEOUT_MS);
      const body = await r.json().catch(() => null);
      if (!r.ok || !body?.narrative) { setCompileError(true); return; }
      setEdition(body);
      onCompiled?.(body);
    } catch {
      // A missing catch here previously meant a network failure (including
      // the timeout above firing) surfaced as an unhandled promise
      // rejection instead of the same compileError state every other
      // failure path already sets — the spinner would clear (`finally`
      // below still runs) but with no visible error and a scary console
      // warning. Matches KeepsakeView.jsx's own compile()/saveEdit().
      setCompileError(true);
    } finally {
      setCompiling(false);
    }
  }

  const activeFatherLine = side === 'father' ? facts.fatherSide.fatherLine : facts.motherSide.fatherLine;
  const activeMotherLine = side === 'father' ? facts.fatherSide.motherLine : facts.motherSide.motherLine;
  const sideEmpty = activeFatherLine.length === 0 && activeMotherLine.length === 0;
  const narrative = edition?.narrative;
  const activeNarrative = narrative && (side === 'father' ? narrative.fatherSide : narrative.motherSide);

  return (
    <section className="profile-section">
      <div className="profile-section__head">
        <h3 className="profile-section__title">Ancestry Story</h3>
      </div>

      <div className="ancestry-side-toggle" role="tablist" aria-label="Which side of the family">
        {SIDES.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={side === s.key}
            className={`ancestry-side-btn${side === s.key ? ' ancestry-side-btn--on' : ''}`}
            onClick={() => setSide(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {side === 'father' ? (
        <>
          {activeFatherLine.length > 0 && (
            <AncestryChain label="Father's father's line" line={activeFatherLine} layout={fatherFatherLayout} />
          )}
          {activeMotherLine.length > 0 && (
            <AncestryChain label="Father's mother's line" line={activeMotherLine} layout={fatherMotherLayout} />
          )}
        </>
      ) : (
        <>
          {activeMotherLine.length > 0 && (
            <AncestryChain label="Mother's mother's line" line={activeMotherLine} layout={motherMotherLayout} />
          )}
          {activeFatherLine.length > 0 && (
            <AncestryChain label="Mother's father's line" line={activeFatherLine} layout={motherFatherLayout} />
          )}
        </>
      )}
      {sideEmpty && (
        <p className="ancestry-chain__empty">No ancestors recorded on this side yet.</p>
      )}

      {canCompile && (compiling || compileError || !edition || stale) && (
        <div className={`ancestry-banner${compileError ? ' ancestry-banner--error' : ''}`} role="status">
          <span className={`ancestry-banner__badge${compiling ? ' ancestry-banner__badge--busy' : ''}`} aria-hidden="true">
            {compiling ? <SpinnerIcon /> : compileError ? <AlertIcon /> : !edition ? <QuillIcon /> : <SparkleIcon />}
          </span>
          <span className="ancestry-banner__text">
            <span className="ancestry-banner__kicker">
              {compiling ? 'Compiling' : compileError ? 'Trouble compiling' : !edition ? 'First chronicle' : 'New chapters'}
            </span>
            <span className="ancestry-banner__note">
              {compiling
                ? 'Weaving the lines together…'
                : compileError
                ? "Couldn't compile this chronicle."
                : !edition
                ? "This chronicle hasn't been written yet."
                : 'The tree has grown since this was compiled.'}
            </span>
          </span>
          {!compiling && (
            <button className="ancestry-banner__btn" onClick={compile}>
              {compileError ? 'Try again' : !edition ? 'Tell the story' : 'Weave in the changes'}
            </button>
          )}
        </div>
      )}

      {narrative && (
        <div className="ancestry-narrative">
          <h4 className="ancestry-narrative__title">{narrative.title}</h4>
          {(activeNarrative || []).map((p, i) => <p key={`s${i}`} className="story">{p}</p>)}
          {(narrative.convergence || []).map((p, i) => <p key={`c${i}`} className="story">{p}</p>)}
        </div>
      )}
    </section>
  );
}

function AncestryChain({ label, line, layout }) {
  if (!layout) return null;
  return (
    <div className="ancestry-chain">
      <p className="ancestry-chain__label">{label}</p>
      <div className="ancestry-route" aria-label={`${label}, oldest to youngest`}>
        {layout.pathD && (
          <svg
            className="ancestry-route__svg"
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            aria-hidden="true"
          >
            <path d={layout.pathD} className="ancestry-route__path" fill="none" />
          </svg>
        )}
        {line.map((a) => {
          const detail = a.restricted
            ? a.name
            : [a.name, a.born?.year, a.born?.place, a.occupation].filter(Boolean).join(' · ');
          return (
            <div key={a.id} className="ancestry-waypoint" title={detail}>
              <span className="ancestry-waypoint-dotzone"><span className="ancestry-waypoint-dot" aria-hidden="true" /></span>
              <span className="ancestry-waypoint-year">{a.restricted ? '' : (a.born?.year || '?')}</span>
              <span className="ancestry-waypoint-name">{a.name}</span>
              {!a.restricted && a.born?.place && (
                <span className="ancestry-waypoint-place">{a.born.place}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Same glyphs as the Keepsake's own edition banner (KeepsakeView.jsx) —
// a quill for the not-yet-written state, a sparkle for weaving in new
// chapters, an alert for a failed compile, a spinner while one is in flight.
function QuillIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 4c-4.5 0-11 2.5-13.5 9C5 16.5 4 19 3 20c1-.3 4-1.2 6.5-2.7 5-3 8.5-8.8 8.5-11.7 0-.6-.2-1.1-.5-1.4-.3-.3-.8-.5-1.4-.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9.5 14.5c1.2-2.5 3.3-5.7 6-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" fill="currentColor" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" fill="currentColor" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4l9 16H3l9-16z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 10.5v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" />
    </svg>
  );
}
function SpinnerIcon() {
  return (
    <svg className="ancestry-banner__spin" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2.4" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

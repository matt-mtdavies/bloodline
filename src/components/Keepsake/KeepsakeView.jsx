import { useEffect, useMemo, useRef, useState } from 'react';
import { buildKeepsake, applyNarrative } from '../../lib/keepsake.js';
import {
  CoverSpread, FrontispieceSpread, OriginsSpread, ConstellationSpread,
  ChaptersSpread, ServiceSpread, PlacesSpread, VoicesSpread, AlbumSpread,
  DocumentsSpread, RecordSpread, LegacySpread, ColophonSpread,
} from './spreads.jsx';
import '../../styles/keepsake.css';

/*
 * The Keepsake reader — a full-screen book over the app (docs/KEEPSAKE.md).
 * Phase 1 built the static magazine; Phase 2 wires the narrative engine:
 * on open, fetch the latest compiled edition from /api/keepsake (stored in
 * R2, shared by the whole family). If the tree has grown since it was
 * compiled (facts hash differs), a quiet banner offers to weave the new
 * records in; while recompiling, the previous edition stays readable.
 * Signed-out / demo sessions simply read the Phase-1 book, placeholders
 * and all — no banner, no errors.
 */

const SPREADS = {
  cover: CoverSpread,
  frontispiece: FrontispieceSpread,
  origins: OriginsSpread,
  constellation: ConstellationSpread,
  chapters: ChaptersSpread,
  service: ServiceSpread,
  places: PlacesSpread,
  voices: VoicesSpread,
  album: AlbumSpread,
  documents: DocumentsSpread,
  record: RecordSpread,
  legacy: LegacySpread,
  colophon: ColophonSpread,
};

export default function KeepsakeView({
  graph, personId, memories, photos, documents, activity, familyName, onClose,
}) {
  const keepsake = useMemo(
    () => buildKeepsake(graph, personId, { memories, photos, documents, activity, familyName }),
    [graph, personId, memories, photos, documents, activity, familyName],
  );

  // 'loading' → 'ready' (authed, edition or null) | 'unavailable' (signed
  // out, no server, storage unconfigured — the static book still reads fine).
  const [editionState, setEditionState] = useState('loading');
  const [edition, setEdition] = useState(null);
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState(false);

  useEffect(() => {
    let alive = true;
    setEditionState('loading');
    setEdition(null);
    setCompileError(false);
    (async () => {
      try {
        const r = await fetch(`/api/keepsake?personId=${encodeURIComponent(personId)}`);
        if (!alive) return;
        if (!r.ok) { setEditionState('unavailable'); return; }
        const body = await r.json().catch(() => null);
        if (!alive) return;
        setEdition(body || null);
        setEditionState('ready');
      } catch {
        if (alive) setEditionState('unavailable');
      }
    })();
    return () => { alive = false; };
  }, [personId]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ── Motion (Phase 3) ──────────────────────────────────────────────────────
  // One observer marks each spread .ks-in the first time a quarter of it is
  // on screen — every entrance animation keys off that class. Under
  // prefers-reduced-motion the class is inert (all motion CSS lives inside
  // a no-preference media block), so this can run unconditionally.
  const containerRef = useRef(null);
  const progressRef = useRef(null);
  const spreadCount = keepsake?.spreads.length || 0;

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('ks-in');
            io.unobserve(e.target);
          }
        }
      },
      { root, threshold: 0.25 },
    );
    root.querySelectorAll('.ks-spread').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [spreadCount]);

  // One rAF-throttled scroll listener drives both the reading-progress
  // hairline and the chapters rail fill (--ks-read on the chapters spread).
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const max = root.scrollHeight - root.clientHeight;
      const p = max > 0 ? root.scrollTop / max : 0;
      if (progressRef.current) progressRef.current.style.transform = `scaleX(${p})`;
      const chapters = root.querySelector('.ks-spread--chapters');
      if (chapters) {
        const r = chapters.getBoundingClientRect();
        const read = Math.max(0, Math.min(1, (root.clientHeight * 0.8 - r.top) / r.height));
        chapters.style.setProperty('--ks-read', String(read));
      }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    root.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => { root.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [spreadCount]);

  if (!keepsake) return null;

  const stale = edition && edition.hash !== keepsake.factsHash;
  const canCompile = editionState === 'ready';

  async function compile() {
    if (compiling) return;
    setCompiling(true);
    setCompileError(false);
    try {
      const chaptersSpread = keepsake.spreads.find((s) => s.key === 'chapters');
      const colophon = keepsake.spreads.find((s) => s.key === 'colophon');
      const r = await fetch('/api/keepsake', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          personId,
          facts: keepsake.facts,
          chapterPlan: (chaptersSpread?.chapters || []).map((c) => c.label),
          recordCount: colophon?.recordCount ?? null,
        }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok || !body?.narrative) { setCompileError(true); return; }
      setEdition(body);
    } catch {
      setCompileError(true);
    } finally {
      setCompiling(false);
    }
  }

  const spreads = applyNarrative(keepsake.spreads, edition?.narrative);

  return (
    <div ref={containerRef} className="keepsake-view" role="dialog" aria-modal="true" aria-label={`${keepsake.subject.name} — Keepsake`}>
      <div className="ks-progress" aria-hidden="true">
        <div ref={progressRef} className="ks-progress__bar" />
      </div>
      <div className="ks-chrome">
        <span className="ks-chrome__mark">A Bloodline Keepsake</span>
        <div className="ks-chrome__btns">
          <button className="ks-chrome__btn" onClick={onClose} aria-label="Close the Keepsake">
            <CloseIcon />
          </button>
        </div>
      </div>

      {/* The edition bar — compile / weave-in / error, never blocking the read. */}
      {canCompile && (compiling || compileError || !edition || stale) && (
        <div className="ks-banner" role="status">
          {compiling ? (
            <span className="ks-banner__note">Compiling this edition — the story is being written…</span>
          ) : compileError ? (
            <>
              <span className="ks-banner__note">Couldn&apos;t compile this edition.</span>
              <button className="ks-banner__btn" onClick={compile}>Try again</button>
            </>
          ) : !edition ? (
            <>
              <span className="ks-banner__note">This book hasn&apos;t been written yet.</span>
              <button className="ks-banner__btn" onClick={compile}>Compile the first edition</button>
            </>
          ) : (
            <>
              <span className="ks-banner__note">The tree has grown since this edition was compiled.</span>
              <button className="ks-banner__btn" onClick={compile}>Weave in the changes</button>
            </>
          )}
        </div>
      )}

      {spreads.map((spread) => {
        const Spread = SPREADS[spread.key];
        return Spread ? <Spread key={spread.key} spread={spread} edition={edition} /> : null;
      })}
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/*
 * The page-turn reader (book mode) — the Keepsake read as a physical
 * magazine. One leaf pivots on the sheet's left edge in 3D: drag it and the
 * page follows your finger; tap a margin, click a chevron, or press an
 * arrow key and it turns itself. The leaf's front face is the current page,
 * its back is bare paper, and the next page already waits beneath — a real
 * magazine's anatomy, so the metaphor never lies.
 *
 * All motion is imperative (inline transforms driven by pointer events and
 * one rAF loop); React state only decides WHICH pages are mounted — a back
 * turn swaps the previous page onto the leaf before it lifts. Under
 * prefers-reduced-motion a turn is an instant page change, and the shine /
 * cast-shadow never appear.
 */

const TURN_MS = 620;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export default function KeepsakeBook({ pages, renderPage, onProgress }) {
  const [index, setIndex] = useState(0);
  const [turn, setTurn] = useState(null); // { dir: 1 | -1 } while a leaf is lifted
  const [hint, setHint] = useState(false);
  const stageRef = useRef(null);
  const leafRef = useRef(null);
  const drag = useRef(null); // live pointer-drag state
  const anim = useRef(null); // { dir } while the rAF loop is turning the leaf
  const rafRef = useRef(0);
  const interacted = useRef(false);
  const reduced = useRef(
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  const last = pages.length - 1;
  const i = Math.min(index, last);

  // A recompiled or revised edition can shrink the page list — stay in range.
  useEffect(() => { if (index > last) setIndex(Math.max(0, last)); }, [index, last]);

  useEffect(() => { onProgress?.((i + 1) / pages.length); }, [i, pages.length, onProgress]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // The first-open nudge: the cover peeks at its own turn until any input.
  useEffect(() => {
    const t = setTimeout(() => { if (!interacted.current) setHint(true); }, 2400);
    return () => clearTimeout(t);
  }, []);

  function applyP(dir, p) {
    const leaf = leafRef.current;
    if (!leaf) return;
    const clamped = Math.max(0, Math.min(1, p));
    const deg = dir === 1 ? -180 * clamped : -180 * (1 - clamped);
    leaf.style.transform = `rotateY(${deg}deg)`;
    // Paper catches the light mid-turn; the page beneath sits in its shadow.
    const sh = Math.sin(clamped * Math.PI);
    leaf.style.setProperty('--ks-shine', String(sh * 0.55));
    stageRef.current?.style.setProperty('--ks-turnshadow', String(sh * 0.5));
  }

  // At rest the leaf lies flat showing the current page.
  useLayoutEffect(() => {
    if (!turn && leafRef.current) {
      leafRef.current.style.transform = 'rotateY(0deg)';
      leafRef.current.style.setProperty('--ks-shine', '0');
      stageRef.current?.style.setProperty('--ks-turnshadow', '0');
    }
  }, [turn, i]);

  function finish(dir, commit) {
    anim.current = null;
    if (commit) setIndex((n) => Math.max(0, Math.min(last, Math.min(n, last) + dir)));
    setTurn(null);
  }

  function animateP(dir, from, to, ease, commit) {
    const t0 = performance.now();
    const dur = Math.max(1, TURN_MS * Math.abs(to - from));
    const step = (now) => {
      if (!anim.current) return;
      const k = Math.min(1, (now - t0) / dur);
      applyP(dir, from + (to - from) * ease(k));
      if (k < 1) rafRef.current = requestAnimationFrame(step);
      else finish(dir, commit);
    };
    rafRef.current = requestAnimationFrame(step);
  }

  function startTurn(dir) {
    if (anim.current || turn) return;
    if (dir === 1 ? i >= last : i <= 0) return;
    interacted.current = true;
    setHint(false);
    if (reduced.current) { setIndex(i + dir); return; }
    anim.current = { dir };
    setTurn({ dir });
    // One frame for the leaf's contents to mount at rest, then the turn.
    requestAnimationFrame(() => {
      applyP(dir, 0);
      animateP(dir, 0, 1, easeInOutCubic, true);
    });
  }

  function settleDrag(dir, p, complete) {
    if (complete && p >= 0.999) { finish(dir, true); return; }
    if (!complete && p <= 0.001) { finish(dir, false); return; }
    anim.current = { dir };
    animateP(dir, p, complete ? 1 : 0, easeOutCubic, complete);
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('button, a, input, textarea')) return;
    interacted.current = true;
    setHint(false);
    if (anim.current) return;
    drag.current = {
      id: e.pointerId, x0: e.clientX, y0: e.clientY,
      active: false, dir: 0, p: 0, lastX: e.clientX, lastT: e.timeStamp, v: 0,
    };
  }

  function onPointerMove(e) {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.active) {
      // Horizontal intent only — vertical stays native page scroll.
      if (reduced.current) return;
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      const dir = dx < 0 ? 1 : -1;
      if (dir === 1 ? i >= last : i <= 0) { drag.current = null; return; }
      d.active = true;
      d.dir = dir;
      stageRef.current?.setPointerCapture?.(e.pointerId);
      setTurn({ dir });
    }
    const w = stageRef.current?.clientWidth || window.innerWidth;
    d.p = Math.max(0, Math.min(1, (d.dir === 1 ? -dx : dx) / (w * 0.7)));
    d.v = (e.clientX - d.lastX) / Math.max(1, e.timeStamp - d.lastT);
    d.lastX = e.clientX;
    d.lastT = e.timeStamp;
    applyP(d.dir, d.p);
  }

  function onPointerUp(e) {
    const d = drag.current;
    drag.current = null;
    if (!d || e.pointerId !== d.id) return;
    if (d.active) {
      const flick = d.dir === 1 ? d.v < -0.5 : d.v > 0.5;
      settleDrag(d.dir, d.p, d.p > 0.3 || flick);
      return;
    }
    // A clean tap in the margins turns the page.
    if (Math.abs(e.clientX - d.x0) > 8 || Math.abs(e.clientY - d.y0) > 8) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const fx = (e.clientX - rect.left) / rect.width;
    if (fx > 0.74) startTurn(1);
    else if (fx < 0.26) startTurn(-1);
  }

  function onPointerCancel() {
    const d = drag.current;
    drag.current = null;
    if (d?.active) settleDrag(d.dir, d.p, false);
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (document.querySelector('.ks-editsheet')) return;
      startTurn(e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // A back turn lifts the PREVIOUS page from the left; forward lifts the
  // current one. Whatever the leaf hides sits mounted beneath it.
  const leafPage = turn?.dir === -1 ? pages[i - 1] : pages[i];
  const underPage = turn?.dir === -1 ? pages[i] : pages[i + 1];
  const edgeR = Math.min(12, (last - i) * 1.5);
  const edgeL = Math.min(12, i * 1.5);

  return (
    <div
      ref={stageRef}
      className="ks-book"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div className="ks-sheet">
        {edgeL > 0 && <div className="ks-edges ks-edges--left" style={{ width: edgeL }} aria-hidden="true" />}
        {edgeR > 0 && <div className="ks-edges ks-edges--right" style={{ width: edgeR }} aria-hidden="true" />}
        <div className="ks-page ks-page--under" aria-hidden={turn ? undefined : 'true'}>
          {underPage && <PageContent key={underPage.pageKey} page={underPage} renderPage={renderPage} />}
        </div>
        <div ref={leafRef} className={`ks-leaf${hint ? ' ks-leaf--hint' : ''}`}>
          <div className="ks-leaf__front">
            {leafPage && <PageContent key={leafPage.pageKey} page={leafPage} renderPage={renderPage} />}
            <div className="ks-leaf__shine" aria-hidden="true" />
          </div>
          <div className="ks-leaf__back" aria-hidden="true">
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 0l5 5-5 5-5-5z" fill="currentColor" /></svg>
          </div>
        </div>
      </div>
      <button
        className="ks-booknav ks-booknav--prev"
        onClick={() => startTurn(-1)}
        disabled={i <= 0}
        aria-label="Previous page"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M14.5 5.5L8 12l6.5 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        className="ks-booknav ks-booknav--next"
        onClick={() => startTurn(1)}
        disabled={i >= last}
        aria-label="Next page"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M9.5 5.5L16 12l-6.5 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <p className="ks-label ks-bookcounter" aria-live="polite">{i + 1} of {pages.length}</p>
    </div>
  );
}

// The reveal choreography keys off .ks-in (motion CSS gate). In book mode
// each page marks its spreads the moment it mounts — content settles while
// still hidden beneath the leaf, so a turn never uncovers a blank page. The
// classList write is imperative on purpose: spread section classNames must
// stay static (see CoverSpread's note) so React never wipes it.
function PageContent({ page, renderPage }) {
  return (
    <div
      className="ks-page__scroll"
      ref={(el) => el?.querySelectorAll('.ks-spread').forEach((s) => s.classList.add('ks-in'))}
    >
      {renderPage(page)}
    </div>
  );
}

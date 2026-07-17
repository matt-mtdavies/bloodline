import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  blocksOf, paginate, contentWidth, PRINT_FOLIO, PHONE_FOLIO,
} from '../../lib/typeset.js';
import BookPage, { TypesetBlock } from './BookPage.jsx';

/*
 * The page-turn reader (book mode) — the Keepsake read as a physical
 * magazine. Pages are TYPESET (lib/typeset.js): fixed canvases, measured
 * offscreen, packed so that no page ever scrolls — content that doesn't fit
 * becomes the next page, like paper. The stage scales the whole sheet down
 * to fit the viewport (never up), so the book is identical at any window
 * size within a mode.
 *
 * Three modes off one engine:
 *   phone  (<700px)  — the pocket folio, one page, near-1:1 scale.
 *   single (<1140px) — the print folio, one page, scaled to fit.
 *   spread (≥1140px) — a true verso/recto opening of two print-folio pages;
 *     the cover sits alone on the recto (blank inside cover beside it), then
 *     pages pair 2–3, 4–5… The turning leaf is the right half of the sheet
 *     pivoting on the centre spine, its back face carrying the next verso.
 *
 * Every turn — both directions, all modes — is the same live-DOM leaf
 * rotating in 3D with shine and a cast shadow. (An earlier build drove
 * forward turns on phones through a canvas "page curl" fed by SVG
 * foreignObject snapshots; an SVG data-URI document can't fetch external
 * resources, so photos went blank and webfonts fell back mid-curl — it
 * looked broken because it was. The leaf uses the real DOM: always correct.)
 *
 * All motion is imperative (inline transforms driven by pointer events and
 * one rAF loop); React state only decides WHICH pages are mounted. Under
 * prefers-reduced-motion a turn is an instant page change and the shine /
 * cast-shadows never appear.
 */

const TURN_MS = 560;
// The very first turn — leaving the resting cover splash — is a deliberate
// set piece: much slower, paired with the sheet's own un-tilt/zoom (see
// .ks-sheet--rest in keepsake.css) so it reads as the camera pushing into
// the book rather than an ordinary page flip.
const GRAND_OPEN_MS = 1500;
const SPREAD_MQ = '(min-width: 1140px)';
const PHONE_MQ = '(max-width: 699px)';
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

function modeOf() {
  if (typeof window.matchMedia !== 'function') return 'single';
  if (window.matchMedia(SPREAD_MQ).matches) return 'spread';
  if (window.matchMedia(PHONE_MQ).matches) return 'phone';
  return 'single';
}

/*
 * The galley proof: render every flow block once, offscreen, at the active
 * canvas's content width; measure; pack. Re-typesets when the edition
 * changes, the canvas changes (crossing a breakpoint), or the webfonts
 * finish loading (metrics shift).
 */
export function useTypeset(spreads, canvas, onEditSection) {
  const blocks = useMemo(() => blocksOf(spreads), [spreads]);
  const [pages, setPages] = useState(null);
  const [fontsReady, setFontsReady] = useState(false);
  const measureRef = useRef(null);

  useEffect(() => {
    let alive = true;
    document.fonts?.ready?.then(() => { if (alive) setFontsReady(true); });
    return () => { alive = false; };
  }, []);

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const heights = {};
    el.querySelectorAll('[data-mid]').forEach((n) => {
      heights[n.dataset.mid] = n.getBoundingClientRect().height;
    });
    setPages(paginate(blocks, heights, canvas));
  }, [blocks, canvas, fontsReady]);

  // The measurer must live under the same style scope as real pages so the
  // measured metrics ARE the layout metrics.
  const measurer = (
    <div
      ref={measureRef}
      className={`ks-measure ks-pgs ks-pgs--${canvas.id}`}
      style={{ width: contentWidth(canvas) }}
      aria-hidden="true"
    >
      {blocks.filter((b) => !b.fixed).map((b) => (
        <div key={b.id} data-mid={b.id}>
          <TypesetBlock block={b} onEditSection={onEditSection} />
        </div>
      ))}
    </div>
  );

  return { pages, measurer };
}

export default function KeepsakeBook({ spreads, subjectName, edition, onEditSection, onProgress }) {
  const [mode, setMode] = useState(modeOf);
  const canvas = mode === 'phone' ? PHONE_FOLIO : PRINT_FOLIO;
  const wide = mode === 'spread';
  const { pages, measurer } = useTypeset(spreads, canvas, onEditSection);

  const [index, setIndex] = useState(0); // always a PAGE index, in all modes
  const [turn, setTurn] = useState(null); // { dir: 1 | -1 } while a leaf is lifted
  const [hint, setHint] = useState(false);
  // Once true, stays true for the life of this mount — even paging back to
  // the cover later reads as an ordinary closed-book page, never the
  // coffee-table splash again.
  const [everOpened, setEverOpened] = useState(false);
  const [scale, setScale] = useState(1);
  const stageRef = useRef(null);
  const fitRef = useRef(null); // the unpadded box the sheet must fit inside
  const leafRef = useRef(null);
  const drag = useRef(null); // live pointer-drag state
  const anim = useRef(null); // { dir, target } while the rAF loop is turning
  const rafRef = useRef(0);
  const interacted = useRef(false);
  const reduced = useRef(
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mqs = [window.matchMedia(SPREAD_MQ), window.matchMedia(PHONE_MQ)];
    const on = () => setMode(modeOf());
    mqs.forEach((m) => m.addEventListener('change', on));
    return () => mqs.forEach((m) => m.removeEventListener('change', on));
  }, []);

  const pageList = pages || [];
  const last = pageList.length - 1;
  const i = Math.min(index, Math.max(0, last));

  // ── Spread bookkeeping (wide only) ────────────────────────────────────────
  // Spread 0 = the cover alone on the recto; spread s pairs pages 2s-1 | 2s.
  const s = Math.ceil(i / 2);
  const sLast = Math.ceil(Math.max(0, last) / 2);
  const leftOf = (sp) => (sp <= 0 ? null : pageList[2 * sp - 1] || null);
  const rightOf = (sp) => pageList[2 * sp] || null;
  const canFwd = wide ? s < sLast : i < last;
  const canBack = wide ? s > 0 : i > 0;
  const targetIndexFor = (dir) => {
    if (!wide) return i + dir;
    const ns = s + dir;
    return ns <= 0 ? 0 : Math.min(last, 2 * ns - 1);
  };

  // The coffee-table splash: a physical object at rest, not yet opened.
  const resting = !everOpened && i === 0 && !turn;
  const closedSpread = wide && s === 0 && !turn;
  // The sheet's logical (pre-scale) size — the spread shows two trims side
  // by side except while closed on the cover.
  const logicalW = wide && !closedSpread ? canvas.w * 2 : canvas.w;
  const logicalH = canvas.h;

  // ── Scale-to-fit (never above 1) ──────────────────────────────────────────
  useLayoutEffect(() => {
    const el = fitRef.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      setScale(Math.min(r.width / logicalW, r.height / logicalH, 1));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [logicalW, logicalH]);

  // A recompiled or revised edition can shrink the page list — stay in range.
  useEffect(() => { if (pages && index > last) setIndex(Math.max(0, last)); }, [pages, index, last]);

  useEffect(() => {
    if (!pageList.length) return;
    const visible = wide ? (rightOf(s) ? 2 * s : 2 * s - 1) : i;
    onProgress?.((Math.max(0, visible) + 1) / pageList.length);
  });

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
    // Paper catches the light mid-turn; the page being uncovered sits in
    // the leaf's shadow — the right side going forward, the left coming back.
    const sh = Math.sin(clamped * Math.PI);
    leaf.style.setProperty('--ks-shine', String(sh * 0.55));
    const stage = stageRef.current;
    if (stage) {
      stage.style.setProperty('--ks-turnshadow', String(!wide || dir === 1 ? sh * 0.5 : 0));
      stage.style.setProperty('--ks-turnshadow-l', String(wide && dir === -1 ? sh * 0.5 : 0));
    }
  }

  // Pose the leaf at its start angle BEFORE paint the moment a turn mounts
  // (a back turn starts at -180°, lying where the old page was — without
  // this the previous page flashes flat for a frame); lie flat at rest.
  useLayoutEffect(() => {
    if (turn) { applyP(turn.dir, 0); return; }
    const leaf = leafRef.current;
    if (leaf) {
      leaf.style.transform = 'rotateY(0deg)';
      leaf.style.setProperty('--ks-shine', '0');
    }
    stageRef.current?.style.setProperty('--ks-turnshadow', '0');
    stageRef.current?.style.setProperty('--ks-turnshadow-l', '0');
  }, [turn, i, wide]);

  // A mid-turn layout flip (window resized past a breakpoint): land the
  // book instantly wherever it was headed rather than tearing the leaf.
  useEffect(() => {
    if (anim.current) { cancelAnimationFrame(rafRef.current); finish(true); }
    else if (drag.current?.active) { drag.current = null; setTurn(null); }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  function finish(commit) {
    const a = anim.current;
    anim.current = null;
    if (commit && a) setIndex(a.target);
    if (commit && a?.grandOpen) setEverOpened(true);
    setTurn(null);
  }

  // durMs is the FULL-turn duration; a settle from p covers the remainder.
  // A flick hands its release velocity in as extra urgency — the leaf keeps
  // the finger's energy instead of easing off politely (inertia).
  function animateP(dir, from, to, ease, commit, durMs = TURN_MS, velocity = 0) {
    const t0 = performance.now();
    const urgency = Math.min(Math.abs(velocity) / 1.5, 0.65);
    const dur = Math.max(140, durMs * Math.abs(to - from) * (1 - urgency));
    const step = (now) => {
      if (!anim.current) return;
      const k = Math.min(1, (now - t0) / dur);
      applyP(dir, from + (to - from) * ease(k));
      if (k < 1) rafRef.current = requestAnimationFrame(step);
      else finish(commit);
    };
    rafRef.current = requestAnimationFrame(step);
  }

  // Leaving the cover for the very first time — the grand-open set piece.
  const isGrandOpen = (dir) => dir === 1 && i === 0 && !everOpened;

  function startTurn(dir) {
    if (anim.current || turn) return;
    if (dir === 1 ? !canFwd : !canBack) return;
    interacted.current = true;
    setHint(false);
    const grandOpen = isGrandOpen(dir);
    if (reduced.current) {
      setIndex(targetIndexFor(dir));
      if (grandOpen) setEverOpened(true);
      return;
    }
    anim.current = { dir, target: targetIndexFor(dir), grandOpen };
    setTurn({ dir });
    // The layout effect poses the leaf at rest; animate from there.
    requestAnimationFrame(() => animateP(dir, 0, 1, easeInOutCubic, true, grandOpen ? GRAND_OPEN_MS : TURN_MS));
  }

  function settleDrag(dir, p, complete, velocity = 0) {
    const grandOpen = isGrandOpen(dir);
    anim.current = { dir, target: targetIndexFor(dir), grandOpen };
    if (complete && p >= 0.999) { finish(true); return; }
    if (!complete && p <= 0.001) { finish(false); return; }
    animateP(dir, p, complete ? 1 : 0, easeOutCubic, complete, grandOpen && complete ? GRAND_OPEN_MS : TURN_MS, velocity);
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
      if (reduced.current) return;
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      const dir = dx < 0 ? 1 : -1;
      if (dir === 1 ? !canFwd : !canBack) { drag.current = null; return; }
      d.active = true;
      d.dir = dir;
      stageRef.current?.setPointerCapture?.(e.pointerId);
      setTurn({ dir });
    }
    const w = stageRef.current?.clientWidth || window.innerWidth;
    d.p = Math.max(0, Math.min(1, (d.dir === 1 ? -dx : dx) / (w * (wide ? 0.5 : 0.7))));
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
      settleDrag(d.dir, d.p, d.p > 0.3 || flick, d.v);
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
    if (!d?.active) return;
    settleDrag(d.dir, d.p, false);
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

  if (!pages) {
    // The galley proof measures on the first layout pass — one blank beat.
    return <div ref={stageRef} className="ks-book">{measurer}</div>;
  }

  // ── What sits where ─────────────────────────────────────────────────────
  let baseLeft = null, baseRight, leafFront, leafBack = null, leafMounted;
  if (wide) {
    // Beneath the leaf: forward reveals the next recto; back reveals the
    // previous verso. The leaf itself is only mounted while turning.
    baseLeft = turn?.dir === -1 ? leftOf(s - 1) : leftOf(s);
    baseRight = turn?.dir === 1 ? rightOf(s + 1) : rightOf(s);
    leafFront = turn ? (turn.dir === 1 ? rightOf(s) : rightOf(s - 1)) : null;
    leafBack = turn ? (turn.dir === 1 ? leftOf(s + 1) : leftOf(s)) : null;
    leafMounted = !!turn;
  } else {
    leafFront = turn?.dir === -1 ? pageList[i - 1] : pageList[i];
    baseRight = turn?.dir === -1 ? pageList[i] : pageList[i + 1];
    leafMounted = true;
  }

  const pageNoOf = (page) => pageList.indexOf(page) + 1;
  const renderFace = (page) => page && (
    <BookPage
      key={page.pageKey}
      page={page}
      pageNo={pageNoOf(page)}
      canvas={canvas}
      subjectName={subjectName}
      edition={edition}
      onEditSection={onEditSection}
    />
  );

  const firstVisible = wide ? (s === 0 ? 0 : 2 * s - 1) : i;
  const lastVisible = wide ? (rightOf(s) ? 2 * s : 2 * s - 1) : i;
  // Resting on the cover, the edge stack reads as "a real, thick magazine"
  // rather than the subtler depth cue it is once actually reading.
  const edgeCap = i === 0 && !turn ? 20 : 12;
  const edgeL = Math.min(edgeCap, firstVisible * 1.5);
  const edgeR = Math.min(edgeCap, (last - lastVisible) * 1.5);
  const counter = wide && s > 0 && rightOf(s)
    ? `${2 * s}–${2 * s + 1} of ${pageList.length}`
    : `${lastVisible + 1} of ${pageList.length}`;

  return (
    <div
      ref={stageRef}
      className={`ks-book${resting ? ' ks-book--rest' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {/* The tabletop scene — a genuinely darker travertine field with one
          directional key light, so the white magazine is the brightest
          object in frame (the reference-photo rule). Fades back to the calm
          reading wash as the grand-open pushes in. The prop is the blurred,
          out-of-focus stone dish cropped at the corner — depth-of-field set
          dressing, never a literal object. */}
      <div className="ks-scene" aria-hidden="true">
        <div className="ks-scene__prop" />
      </div>
      <div className="ks-stage" ref={fitRef}>
      <div
        className="ks-scale"
        style={{ width: logicalW, height: logicalH, transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        {/* The contact shadow anchoring the resting magazine to its table —
            separate from the ambient drop shadow, tight and directional. */}
        {resting && <div className="ks-contact" aria-hidden="true" />}
        <div
          className={`ks-sheet${wide ? ' ks-sheet--spread' : ''}${closedSpread ? ' ks-sheet--closed' : ''}${resting ? ' ks-sheet--rest' : ''}${resting && hint ? ' ks-sheet--breathe' : ''}`}
        >
          {edgeL > 0 && <div className="ks-edges ks-edges--left" style={{ width: edgeL }} aria-hidden="true" />}
          {edgeR > 0 && <div className="ks-edges ks-edges--right" style={{ width: edgeR }} aria-hidden="true" />}
          {wide && !closedSpread && (
            <div className="ks-page ks-page--left">
              {baseLeft ? renderFace(baseLeft) : <BlankPage />}
            </div>
          )}
          <div className="ks-page ks-page--under" aria-hidden={turn || wide ? undefined : 'true'}>
            {baseRight ? renderFace(baseRight) : wide ? <BlankPage /> : null}
          </div>
          {leafMounted && (
            <div ref={leafRef} className="ks-leaf">
              <div className="ks-leaf__front">
                {renderFace(leafFront)}
                <div className="ks-leaf__shine" aria-hidden="true" />
              </div>
              <div className={`ks-leaf__back${leafBack ? ' ks-leaf__back--page' : ''}`} aria-hidden="true">
                {leafBack
                  ? (
                    <>
                      {renderFace(leafBack)}
                      <div className="ks-leaf__shine" aria-hidden="true" />
                    </>
                  )
                  : <Diamond />}
              </div>
            </div>
          )}
          {wide && !closedSpread && <div className="ks-spine" aria-hidden="true" />}
        </div>
      </div>
      </div>
      {/* Dappled foliage light drifting across the whole scene — the table
          AND the object, the way the light in a real photograph belongs to
          the room, not the magazine. Always mounted so it can crossfade out
          with the scene as the book opens (.ks-book--rest gates opacity). */}
      <div className="ks-dapple" aria-hidden="true" />
      <button
        className="ks-booknav ks-booknav--prev"
        onClick={() => startTurn(-1)}
        disabled={!canBack}
        aria-label="Previous page"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M14.5 5.5L8 12l6.5 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        className="ks-booknav ks-booknav--next"
        onClick={() => startTurn(1)}
        disabled={!canFwd}
        aria-label="Next page"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M9.5 5.5L16 12l-6.5 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <p className="ks-label ks-bookcounter" aria-live="polite">{counter}</p>
      {measurer}
    </div>
  );
}

function Diamond() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 0l5 5-5 5-5-5z" fill="currentColor" /></svg>
  );
}

// The blank verso beside the cover (and a blank recto when the book ends on
// a left page) — bare stock, like a magazine's inside cover.
function BlankPage() {
  return (
    <div className="ks-blank" aria-hidden="true">
      <Diamond />
    </div>
  );
}

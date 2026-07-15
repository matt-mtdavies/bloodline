import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/*
 * The page-turn reader (book mode) — the Keepsake read as a physical
 * magazine. Drag a page and it follows your finger; tap a margin, click a
 * chevron, or press an arrow key and it turns itself.
 *
 * Two layouts share one turn engine:
 *
 * SINGLE (phones, narrow windows): one leaf pivots on the sheet's left
 * edge. Front face = current page, back = bare stock, next page mounted
 * beneath.
 *
 * SPREAD (wide desktop, ≥1140px): a true verso/recto opening. The cover
 * sits alone on the recto (a blank verso beside it, like an inside cover),
 * then pages pair 2–3, 4–5… The leaf is the right half of the sheet and
 * pivots on the centre spine; its BACK face carries the next left page —
 * real paper, printed on both sides. Turning back lifts the left page over
 * to the right the same way.
 *
 * All motion is imperative (inline transforms driven by pointer events and
 * one rAF loop); React state only decides WHICH pages are mounted. Under
 * prefers-reduced-motion a turn is an instant page change, and the shine /
 * cast-shadows never appear.
 */

const TURN_MS = 620;
// The very first turn — leaving the resting cover splash — is a deliberate
// set piece: much slower and paired with the sheet's own un-tilt/zoom (see
// .ks-sheet--rest in keepsake.css), so it reads as the camera pushing into
// the book rather than an ordinary page flip.
const GRAND_OPEN_MS = 1500;
const SPREAD_MQ = '(min-width: 1140px)';
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export default function KeepsakeBook({ pages, renderPage, onProgress }) {
  const [index, setIndex] = useState(0); // always a PAGE index, in both layouts
  const [turn, setTurn] = useState(null); // { dir: 1 | -1 } while a leaf is lifted
  const [hint, setHint] = useState(false);
  // Once true, stays true for the life of this mount — even paging back to
  // the cover later reads as an ordinary closed-book page, never the
  // coffee-table splash again.
  const [everOpened, setEverOpened] = useState(false);
  const [wide, setWide] = useState(() => window.matchMedia?.(SPREAD_MQ).matches ?? false);
  const stageRef = useRef(null);
  const leafRef = useRef(null);
  const drag = useRef(null); // live pointer-drag state
  const anim = useRef(null); // { dir, target } while the rAF loop is turning
  const rafRef = useRef(0);
  const interacted = useRef(false);
  const reduced = useRef(
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  const last = pages.length - 1;
  const i = Math.min(index, last);

  // ── Spread bookkeeping (wide only) ─────────────────────────────────────────
  // Spread 0 = the cover alone on the recto; spread s pairs pages 2s-1 | 2s.
  const s = Math.ceil(i / 2);
  const sLast = Math.ceil(last / 2);
  const leftOf = (sp) => (sp <= 0 ? null : pages[2 * sp - 1] || null);
  const rightOf = (sp) => pages[2 * sp] || null;
  const canFwd = wide ? s < sLast : i < last;
  const canBack = wide ? s > 0 : i > 0;
  const targetIndexFor = (dir) => {
    if (!wide) return i + dir;
    const ns = s + dir;
    return ns <= 0 ? 0 : Math.min(last, 2 * ns - 1);
  };

  useEffect(() => {
    const mq = window.matchMedia?.(SPREAD_MQ);
    if (!mq) return;
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // A recompiled or revised edition can shrink the page list — stay in range.
  useEffect(() => { if (index > last) setIndex(Math.max(0, last)); }, [index, last]);

  useEffect(() => {
    const visible = wide ? (rightOf(s) ? 2 * s : 2 * s - 1) : i;
    onProgress?.((Math.max(0, visible) + 1) / pages.length);
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

  // A mid-turn layout flip (window resized past the breakpoint): land the
  // book instantly wherever it was headed rather than tearing the leaf.
  useEffect(() => {
    if (anim.current) { cancelAnimationFrame(rafRef.current); finish(true); }
    else if (drag.current?.active) { drag.current = null; setTurn(null); }
  }, [wide]); // eslint-disable-line react-hooks/exhaustive-deps

  function finish(commit) {
    const a = anim.current;
    anim.current = null;
    if (commit && a) setIndex(a.target);
    if (commit && a?.grandOpen) setEverOpened(true);
    setTurn(null);
  }

  function animateP(dir, from, to, ease, commit, durMs = TURN_MS) {
    const t0 = performance.now();
    const dur = Math.max(1, durMs * Math.abs(to - from));
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

  function settleDrag(dir, p, complete) {
    const grandOpen = isGrandOpen(dir);
    anim.current = { dir, target: targetIndexFor(dir), grandOpen };
    if (complete && p >= 0.999) { finish(true); return; }
    if (!complete && p <= 0.001) { finish(false); return; }
    animateP(dir, p, complete ? 1 : 0, easeOutCubic, complete, grandOpen && complete ? GRAND_OPEN_MS : TURN_MS);
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

  // ── What sits where ─────────────────────────────────────────────────────────
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
    leafFront = turn?.dir === -1 ? pages[i - 1] : pages[i];
    baseRight = turn?.dir === -1 ? pages[i] : pages[i + 1];
    leafMounted = true;
  }

  const firstVisible = wide ? (s === 0 ? 0 : 2 * s - 1) : i;
  const lastVisible = wide ? (rightOf(s) ? 2 * s : 2 * s - 1) : i;
  // Resting on the cover, the edge stack reads as "a real, thick magazine"
  // rather than the subtler depth cue it is once actually reading.
  const edgeCap = i === 0 && !turn ? 20 : 12;
  const edgeL = Math.min(edgeCap, firstVisible * 1.5);
  const edgeR = Math.min(edgeCap, (last - lastVisible) * 1.5);
  const counter = wide && s > 0 && rightOf(s)
    ? `${2 * s}–${2 * s + 1} of ${pages.length}`
    : `${lastVisible + 1} of ${pages.length}`;

  // The coffee-table splash: a physical object at rest, not yet opened —
  // gone for good the instant the reader actually turns the cover.
  const resting = !everOpened && i === 0 && !turn;

  return (
    <div
      ref={stageRef}
      className={`ks-book${resting ? ' ks-book--rest' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div className={`ks-sheet${wide ? ' ks-sheet--spread' : ''}${wide && s === 0 && !turn ? ' ks-sheet--closed' : ''}${resting ? ' ks-sheet--rest' : ''}`}>
        {edgeL > 0 && <div className="ks-edges ks-edges--left" style={{ width: edgeL }} aria-hidden="true" />}
        {edgeR > 0 && <div className="ks-edges ks-edges--right" style={{ width: edgeR }} aria-hidden="true" />}
        {resting && <div className="ks-sheet__gloss" aria-hidden="true" />}
        {resting && hint && <div className="ks-page-curl ks-page-curl--hero" aria-hidden="true" />}
        {/* The same curl, quiet and small, on every ordinary page — an
            always-available "there's more" cue. Purely visual (pointer-
            events:none): it sits inside the right margin that already
            turns the page forward on tap (see onPointerUp's fx>0.74), so
            it doesn't need its own handler — just marks where to tap.
            Hidden during rest (the hero curl covers that moment) and
            mid-turn (the real leaf is already curling). */}
        {!resting && !turn && canFwd && (
          <div className="ks-page-curl ks-page-curl--page" aria-hidden="true" />
        )}
        {wide && (
          <div className="ks-page ks-page--left">
            {baseLeft
              ? <PageContent key={baseLeft.pageKey} page={baseLeft} renderPage={renderPage} />
              : <BlankPage />}
          </div>
        )}
        <div className="ks-page ks-page--under" aria-hidden={turn || wide ? undefined : 'true'}>
          {baseRight
            ? <PageContent key={baseRight.pageKey} page={baseRight} renderPage={renderPage} />
            : wide ? <BlankPage /> : null}
        </div>
        {leafMounted && (
          <div ref={leafRef} className="ks-leaf">
            <div className="ks-leaf__front">
              {leafFront && <PageContent key={leafFront.pageKey} page={leafFront} renderPage={renderPage} />}
              <div className="ks-leaf__shine" aria-hidden="true" />
            </div>
            <div className={`ks-leaf__back${leafBack ? ' ks-leaf__back--page' : ''}`} aria-hidden="true">
              {leafBack
                ? (
                  <>
                    <PageContent key={leafBack.pageKey} page={leafBack} renderPage={renderPage} />
                    <div className="ks-leaf__shine" aria-hidden="true" />
                  </>
                )
                : <Diamond />}
            </div>
          </div>
        )}
        {wide && <div className="ks-spine" aria-hidden="true" />}
      </div>
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

// The reveal choreography keys off .ks-in (motion CSS gate). In book mode
// each page marks its spreads the moment it mounts — content settles while
// still hidden beneath the leaf, so a turn never uncovers a blank page. The
// classList write is imperative on purpose: spread section classNames must
// stay static (see CoverSpread's note) so React never wipes it.
//
// A page taller than the leaf scrolls internally, with a background-shadow
// cue at the cut edge — too subtle for readers to notice on a first pass
// (confirmed by repeated reports of "the text is cut off" that were really
// just an unscrolled page). This adds an unmissable second cue: a bouncing
// chevron pinned to the bottom of the page, showing only while there's
// unread content below and hiding once scrolled near the end. It renders as
// a sibling of .ks-page__scroll (not a child) so it stays fixed to the
// page's own frame instead of scrolling away with the content — every
// mount site (.ks-page--left, .ks-page--under, .ks-leaf__front/back) is
// already position:absolute, so this positions correctly in all of them.
function PageContent({ page, renderPage }) {
  const scrollRef = useRef(null);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const overflowing = el.scrollHeight > el.clientHeight + 4;
      const nearEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 32;
      setShowMore(overflowing && !nearEnd);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    return () => el.removeEventListener('scroll', update);
  }, []);

  return (
    <>
      <div
        className="ks-page__scroll"
        ref={(el) => {
          scrollRef.current = el;
          el?.querySelectorAll('.ks-spread').forEach((sp) => sp.classList.add('ks-in'));
        }}
      >
        {renderPage(page)}
      </div>
      {showMore && (
        <div className="ks-page__more" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </>
  );
}

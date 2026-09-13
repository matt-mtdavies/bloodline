import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { computePedigree, primaryUnionPartner, unionCandidates } from './pedigreeLayout.js';
import { PLATE_W, PLATE_H, LINK_GAP } from './pedigreeMetrics.js';
import { lifespan, ageOrAt } from '../lib/dates.js';
import Avatar from '../components/Avatar.jsx';

/*
 * The pedigree chart — the "traditional chart" view, rebuilt around the
 * classic genealogy pedigree (FamilySearch's landscape view is the
 * reference): the focal person's union card at the root, each member of
 * every card carrying their OWN expandable line upward, children drawn one
 * row below the focal card, and everything further behind deliberate taps
 * — a children popover to navigate down (re-rooting the chart), per-member
 * arrows to grow it up. The layout is lazy: nothing outside what's been
 * revealed is ever computed (see pedigreeLayout.js for why the previous
 * whole-tree engine could never stop sprawling or mis-pairing remarriages).
 *
 * DOM/CSS rather than canvas for the same reasons as before: crisp text at
 * any zoom, and cards/arrows/popovers are just elements. Self-contained
 * pan/pinch/zoom, swapped in wholesale for BubbleTree when layout==='chart'.
 */

const MIN_ZOOM = 0.28;
const FIT_MIN_ZOOM = 0.06;
// Floor for the AUTOMATIC opening/re-root frame only (never fitToView's own
// explicit "fit everything" button, which keeps FIT_MIN_ZOOM) — real user
// feedback: a fresh Chart open shouldn't ever start smaller than a
// comfortable reading zoom, even for a wide family. Content beyond the
// frame is reachable by panning rather than being force-fit onto screen.
const OPEN_MIN_ZOOM = 0.55;
const MAX_ZOOM = 1.6;
const FIT_PADDING = 72;

// The framing box for a layout's bounds, sized so the FOCAL card (always at
// local (0,0) — see place(focal, 0) in pedigreeLayout.js) lands exactly at
// screen centre once panned, rather than the raw bounding box's own midpoint.
// A real family's ancestor branches almost never sprawl equally on both
// sides of the focal couple (one partner's line recorded three generations
// deep, the other only one), and children rarely spread evenly around zero
// either — centring on the true midpoint of an asymmetric box visibly drags
// the focal person off-centre (a real production report: the couple's own
// connecting line rendered nowhere near the middle of the screen). Sizing
// each axis symmetrically around 0 (using whichever side reaches furthest)
// keeps "you" fixed in the middle at the cost of some empty margin on the
// shorter side — the same trade-off this file's horizontal/landscape
// orientation already made deliberately; this extends it to vertical
// orientation's cross axis (X — ancestor/sibling spread), which never had
// it. Vertical's OTHER axis (Y — purely generational: ancestors above,
// descendants below) keeps the true midpoint: there's no single "row" that
// needs to stay visually fixed the way the focal card's column does.
function focalCenteredBox(bounds, orient) {
  const { minX, maxX, minY, maxY } = bounds;
  if (orient === 'horizontal') {
    return {
      boxW: Math.max(1, Math.max(Math.abs(minX), Math.abs(maxX)) * 2),
      boxH: Math.max(1, Math.max(Math.abs(minY), Math.abs(maxY)) * 2),
      cx: 0,
      cy: 0,
    };
  }
  return {
    boxW: Math.max(1, Math.max(Math.abs(minX), Math.abs(maxX)) * 2),
    boxH: Math.max(1, maxY - minY),
    cx: 0,
    cy: (minY + maxY) / 2,
  };
}

// The opening state for a fresh root: the focal couple's own parents
// revealed (one generation up both sides), with the grandparents' slots
// ready behind their own arrows, not pre-expanded — focused, not sprawling.
//
// Real production report: a fresh Chart open looked "way too zoomed out."
// Root cause was here, not in the camera math — this function used to ALSO
// add the focal person's own PARENTS' ids to the set (`for (const p of
// graph.parents(focusId))`), which doesn't just reveal the parents (already
// covered by `focusId` itself being in the set) — it marks THEIR slots
// expanded too, silently pulling in a second generation (grandparents) on
// the focal's own line only, never the partner's. That's a real, asymmetric,
// deeper-than-documented default this comment never actually described —
// exactly what made a fresh open both needlessly wide (forcing a smaller
// fit-to-screen zoom) and asymmetric (the very drift the vertical-centering
// fix above has to correct for). Fixed by expanding only `focusId` and
// `partner` themselves — their own parents' cards render (one generation up,
// symmetric on both sides), and those parents' own up-arrows stay present
// but un-toggled, exactly matching this comment's original wording.
function initialExpandedUp(graph, focusId) {
  const set = new Set([focusId]);
  const partner = primaryUnionPartner(graph, focusId);
  if (partner) set.add(partner);
  return set;
}

export default function ChartTree({ graph, activeId, viewerId, bloodlineOnly = false, onOpenPerson, onAddRelative, onActivate, persistRef }) {
  // Switching to List/organic/Canopy/Atlas and back unmounts and remounts
  // this component (App.jsx renders exactly one canvas at a time) — real
  // user report: expanded ancestor branches, orientation, and pan/zoom all
  // silently reset on a round trip that never actually left the same person.
  // `persistRef` (a plain ref App.jsx owns and never reads itself) lets THIS
  // instance hand its own state to whichever instance mounts next. Restoring
  // is keyed on activeId matching: if the focal person changed while this was
  // unmounted (e.g. re-rooted via List view), that's a genuine re-root, not a
  // resumed session, and everything below falls back to the normal fresh-open
  // behavior — byte-identical to before this fix in that case.
  // TEMPORARY diagnostic aid — ?chartdebug in the URL shows a live readout
  // of the camera-fit math on screen. Added specifically to investigate a
  // real report (a family's own cards clipped on both edges on an iPhone 13
  // Pro, Safari) that repeated, careful reproduction against demo data and
  // synthetic fixtures matching the reported family shape could not turn
  // up — this captures real numbers from the real device/data instead of
  // guessing further. Remove once that's resolved; never gated behind
  // anything but an explicit opt-in query param, so it's inert for every
  // ordinary user.
  const chartDebug = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('chartdebug');
  const saved = persistRef?.current;
  const resumed = saved?.activeId === activeId;
  const [orientation, setOrientation] = useState(() => saved?.orientation ?? 'vertical');
  const [expandedUp, setExpandedUp] = useState(() => (resumed ? saved.expandedUp : initialExpandedUp(graph, activeId)));
  const [partnerChoice, setPartnerChoice] = useState(() => (resumed ? saved.partnerChoice : new Map()));
  const [childrenFor, setChildrenFor] = useState(null); // cardId with open children popover
  const [switcherFor, setSwitcherFor] = useState(null); // memberId with open spouse menu
  const [view, setView] = useState(() => (resumed && saved.view ? saved.view : { zoom: 0.9, panX: 0, panY: 0 }));
  const [gliding, setGliding] = useState(false);
  const [debugOverflow, setDebugOverflow] = useState(null); // TEMPORARY — see chartDebug above
  // The three mount-time effects below (re-root / orientation / bloodlineOnly)
  // each recompute the camera — needed on an ordinary fresh open (nothing has
  // positioned the camera yet), but on a RESUMED mount all three would each
  // stomp the just-restored `view` in turn. Each ref below is seeded with a
  // sentinel `null` on a fresh mount, guaranteed to differ from any real
  // activeId/orientation/bloodlineOnly value, so that mount's first effect
  // pass actually runs and performs the real initial centering (a REAL
  // regression this shipped with and had to be hotfixed: seeding the ref with
  // the CURRENT value unconditionally made even a genuinely fresh mount look
  // "unchanged" and silently skip centering altogether, leaving the camera at
  // the raw uncentered default). On a RESUMED mount, the ref is seeded with
  // the actual current value instead, so it correctly looks "unchanged" and
  // skips, preserving the restored `view`. Either way, this is also safe
  // under React 18 StrictMode's dev-only double-invoke of effects: a SHARED
  // flag that the last effect clears is NOT safe there (the second pass sees
  // an already-cleared flag and fires for real) — a real bug this also
  // shipped with. Comparing against "the value I already handled" instead of
  // a one-shot boolean is idempotent: once an effect's first real pass sets
  // its own ref to the current value, any further invocation with the same
  // dependency is always a no-op, no matter how many times it re-runs.
  const lastRootedIdRef = useRef(resumed ? activeId : null);
  const lastOrientationRef = useRef(resumed ? orientation : null);
  const lastBloodlineOnlyRef = useRef(resumed ? bloodlineOnly : null);
  const viewportRef = useRef(null);
  const dragRef = useRef(null);
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(null);
  const glideTimer = useRef(null);

  const layout = useMemo(
    () => computePedigree(graph, activeId, { expandedUp, partnerChoice, orientation, bloodlineOnly }),
    [graph, activeId, expandedUp, partnerChoice, orientation, bloodlineOnly],
  );
  const cardById = useMemo(() => new Map(layout.cards.map((c) => [c.id, c])), [layout]);

  // Entry stagger — borrowing Canopy's own "grows outward from what's
  // already there" principle for this DOM-rendered chart: rows further from
  // the focal row lead in later, and within a row, cards further along lag
  // slightly behind their neighbour, so a re-root or expansion reads as the
  // family opening outward rather than the whole picture flashing in as one
  // flat batch. A card that's already mounted keeps its animation-delay
  // recomputed on every render, but since its CSS animation already played
  // (see .pcard's `backwards` fill-mode note in components.css) a changed
  // delay on an already-finished animation is inert — this only ever
  // affects cards genuinely mounting for the first time.
  const entryDelayById = useMemo(() => {
    const byGen = new Map();
    for (const c of layout.cards) {
      const g = c._gen ?? 0;
      if (!byGen.has(g)) byGen.set(g, []);
      byGen.get(g).push(c);
    }
    const out = new Map();
    for (const row of byGen.values()) {
      row.sort((a, b) => (a._cross ?? 0) - (b._cross ?? 0));
      row.forEach((c, i) => {
        const dist = Math.abs(c._gen ?? 0);
        out.set(c.id, Math.min(420, dist * 90 + i * 45));
      });
    }
    return out;
  }, [layout]);

  // Smooth programmatic camera moves: the world glides via a CSS transform
  // transition that is ONLY enabled around deliberate moves (re-root, fit,
  // zoom buttons) — never during a drag or pinch, where it would lag the
  // finger.
  const glideTo = useCallback((next) => {
    setGliding(true);
    setView(next);
    clearTimeout(glideTimer.current);
    glideTimer.current = setTimeout(() => setGliding(false), 620);
  }, []);
  useEffect(() => () => clearTimeout(glideTimer.current), []);

  // Opening frame: fit the (small, focused) initial layout inside the safe
  // area — real clearance for the topbar above and the dock below — capped
  // at a fully-legible zoom so a compact family isn't blown up huge, and
  // floored at OPEN_MIN_ZOOM so a wide reveal never starts smaller than a
  // comfortable reading size — pan reaches whatever doesn't fit, rather than
  // the frame shrinking indefinitely to show all of it at once (that's what
  // the explicit "fit to screen" button, fitToView below, is for — it keeps
  // the much lower FIT_MIN_ZOOM deliberately). See focalCenteredBox's own
  // header comment for why the box is sized around the focal card rather
  // than the raw bounding box.
  //
  // Real follow-up report, with a screenshot: on a narrow enough phone, the
  // FOCAL couple's own card — the exact thing this whole frame exists to
  // show — was itself clipped on both edges. A union card has a fixed
  // physical width (UNION_W, ~466px) regardless of zoom target; on a narrow
  // viewport, OPEN_MIN_ZOOM's flat floor can still render that card WIDER
  // than the available safe area, since the floor only knows "don't go
  // below a comfortable reading size," not "don't exceed what this specific
  // device can show." `focalCap` closes that gap: an upper bound (zoom must
  // NEVER be larger than this — raising zoom only makes the card BIGGER,
  // never smaller, so this is a ceiling here, the opposite role from
  // OPEN_MIN_ZOOM's floor) on whatever zoom keeps the actual focal card's
  // own rendered footprint inside the safe area. It sits alongside the 0.92
  // legibility cap and can, on a genuinely tiny viewport, win out over
  // OPEN_MIN_ZOOM too — never rendering the primary subject of this whole
  // view in a visibly broken, overflowing state is worth more than hitting
  // the comfortable-zoom target exactly.
  const centerOnFocal = useCallback((lay, orient) => {
    const vp = viewportRef.current;
    if (!vp || !lay.cards.length) return;
    const rect = vp.getBoundingClientRect();
    const PAD = { top: 170, bottom: 150, side: 36 };
    const { boxW, boxH, cx, cy } = focalCenteredBox(lay.bounds, orient);
    const focalCard = lay.cards.find((c) => c.id === lay.focalCardId);
    const availW = rect.width - PAD.side * 2;
    const availH = rect.height - PAD.top - PAD.bottom;
    const focalCap = focalCard ? Math.min(availW / focalCard.w, availH / focalCard.h) : Infinity;
    const zoom = Math.min(0.92, focalCap, Math.max(OPEN_MIN_ZOOM, Math.min(availW / boxW, availH / boxH)));
    glideTo({
      zoom,
      panX: rect.width / 2 - cx * zoom,
      panY: PAD.top + (rect.height - PAD.top - PAD.bottom) / 2 - cy * zoom,
    });
  }, [glideTo]);

  // Re-root: reset expansion + choices to the fresh opening state and glide
  // the camera to the new focal card. Skipped when activeId hasn't actually
  // changed since we last handled it (an ordinary mount — resumed or fresh —
  // or a StrictMode duplicate invoke both look like "unchanged" here).
  useEffect(() => {
    if (lastRootedIdRef.current === activeId) return;
    lastRootedIdRef.current = activeId;
    const nextExpanded = initialExpandedUp(graph, activeId);
    setExpandedUp(nextExpanded);
    setPartnerChoice(new Map());
    setChildrenFor(null);
    setSwitcherFor(null);
    centerOnFocal(
      computePedigree(graph, activeId, { expandedUp: nextExpanded, partnerChoice: new Map(), orientation, bloodlineOnly }),
      orientation,
    );
    // Intentionally NOT keyed on graph/orientation — edits elsewhere must
    // not discard expansion state; orientation has its own effect below.
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (lastOrientationRef.current === orientation) return;
    lastOrientationRef.current = orientation;
    centerOnFocal(computePedigree(graph, activeId, { expandedUp, partnerChoice, orientation, bloodlineOnly }), orientation);
  }, [orientation]); // eslint-disable-line react-hooks/exhaustive-deps
  // Toggling Bloodline mode re-fits: children appear/disappear, so re-frame
  // the (now differently-shaped) tree rather than leaving it half off-screen.
  useEffect(() => {
    if (lastBloodlineOnlyRef.current === bloodlineOnly) return;
    lastBloodlineOnlyRef.current = bloodlineOnly;
    centerOnFocal(computePedigree(graph, activeId, { expandedUp, partnerChoice, orientation, bloodlineOnly }), orientation);
  }, [bloodlineOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hand this instance's exploration state to whichever ChartTree mounts next
  // (App.jsx owns `persistRef` but never reads it itself — see the header
  // comment on the ref's creation above). Runs on every render, deliberately
  // with no dependency array, so a plain camera drag/pan (which only touches
  // `view` and shouldn't force its own dedicated effect) is captured too.
  useEffect(() => {
    if (persistRef) persistRef.current = { activeId, orientation, expandedUp, partnerChoice, view };
  });

  // TEMPORARY — see chartDebug above. Measures every actually-rendered
  // .pcard against the actual viewport rect after each settle, so the
  // on-screen readout reflects real DOM geometry, not just the intended
  // math — the two could differ for reasons the math alone wouldn't show
  // (a CSS quirk, a stale rect, a native browser zoom).
  useEffect(() => {
    if (!chartDebug) return;
    const id = setTimeout(() => {
      const vp = viewportRef.current;
      if (!vp) return;
      const vpRect = vp.getBoundingClientRect();
      const cards = [...document.querySelectorAll('.pcard')].map((el) => {
        const r = el.getBoundingClientRect();
        return { left: Math.round(r.left), right: Math.round(r.right), overflowL: r.left < -0.5, overflowR: r.right > vpRect.width + 0.5 };
      });
      setDebugOverflow({
        vpRectW: Math.round(vpRect.width),
        vpRectH: Math.round(vpRect.height),
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        visualViewportW: window.visualViewport?.width,
        visualViewportH: window.visualViewport?.height,
        dpr: window.devicePixelRatio,
        cardCount: cards.length,
        anyOverflow: cards.some((c) => c.overflowL || c.overflowR),
        cards,
      });
    }, 700);
    return () => clearTimeout(id);
  }, [chartDebug, view, layout]);

  const fitToView = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || !layout.cards.length) return;
    const rect = vp.getBoundingClientRect();
    const { boxW, boxH, cx, cy } = focalCenteredBox(layout.bounds, orientation);
    const zoom = Math.min(MAX_ZOOM, Math.max(FIT_MIN_ZOOM,
      Math.min((rect.width - FIT_PADDING * 2) / boxW, (rect.height - FIT_PADDING * 2) / boxH)));
    glideTo({ zoom, panX: rect.width / 2 - cx * zoom, panY: rect.height / 2 - cy * zoom });
  }, [layout, glideTo, orientation]);

  const zoomBy = (factor, anchor) => {
    setView((v) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      const ax = anchor?.x ?? (rect ? rect.width / 2 : 0);
      const ay = anchor?.y ?? (rect ? rect.height / 2 : 0);
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      const ratio = nextZoom / v.zoom;
      return { zoom: nextZoom, panX: ax - (ax - v.panX) * ratio, panY: ay - (ay - v.panY) * ratio };
    });
  };

  // ── Gestures (unchanged mechanics from the previous chart) ───────────────
  const onWheel = (e) => {
    e.preventDefault();
    setGliding(false);
    const rect = viewportRef.current?.getBoundingClientRect();
    const anchor = rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : null;
    zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08, anchor);
  };
  const beginPinch = (rect) => {
    const pts = [...pointersRef.current.values()];
    const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
    const midY = (pts[0].y + pts[1].y) / 2 - rect.top;
    pinchRef.current = {
      startDist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
      startZoom: view.zoom,
      worldX: (midX - view.panX) / view.zoom,
      worldY: (midY - view.panY) / view.zoom,
    };
  };
  const onPointerDown = (e) => {
    if (pointersRef.current.size === 0 && (
      e.target.closest('.ped-card') || e.target.closest('.pcard') || e.target.closest('.pnav')
      || e.target.closest('.pbar-menu') || e.target.closest('.chart-controls')
      || e.target.closest('.ped-pop') || e.target.closest('.ped-backchip')
    )) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
    setGliding(false);
    setChildrenFor(null);
    setSwitcherFor(null); // tap empty canvas dismisses the open spouse menu
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = viewportRef.current?.getBoundingClientRect();
    if (pointersRef.current.size === 2 && rect) {
      dragRef.current = null;
      beginPinch(rect);
    } else if (pointersRef.current.size === 1) {
      dragRef.current = { startX: e.clientX, startY: e.clientY, panX: view.panX, panY: view.panY };
    }
  };
  const onPointerMove = (e) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const pts = [...pointersRef.current.values()].slice(0, 2);
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
      const midY = (pts[0].y + pts[1].y) / 2 - rect.top;
      const { startDist, startZoom, worldX, worldY } = pinchRef.current;
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, startZoom * (dist / startDist)));
      setView({ zoom: nextZoom, panX: midX - worldX * nextZoom, panY: midY - worldY * nextZoom });
      return;
    }
    if (dragRef.current) {
      const { startX, startY, panX, panY } = dragRef.current;
      setView((v) => ({ ...v, panX: panX + (e.clientX - startX), panY: panY + (e.clientY - startY) }));
    }
  };
  const onPointerUp = (e) => {
    pointersRef.current.delete(e.pointerId);
    pinchRef.current = null;
    const remaining = [...pointersRef.current.values()];
    dragRef.current = remaining.length === 1
      ? { startX: remaining[0].x, startY: remaining[0].y, panX: view.panX, panY: view.panY }
      : null;
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { setChildrenFor(null); setSwitcherFor(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleUp = (memberId) => {
    setSwitcherFor(null);
    setExpandedUp((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId); else next.add(memberId);
      return next;
    });
  };

  const chooseSpouse = (lineMemberId, partnerId) => {
    setSwitcherFor(null);
    setPartnerChoice((prev) => {
      const next = new Map(prev);
      if (partnerId === undefined) next.delete(lineMemberId);
      else next.set(lineMemberId, partnerId);
      return next;
    });
  };

  // ── Geometry helpers shared by cards and connectors ──────────────────────
  const horizontal = orientation === 'horizontal';
  const portrait = !horizontal;

  // A member's plate centre within its card. Portrait: plates sit side by side
  // (offset along X). Landscape: plates stack (offset along Y). Handles a solo
  // card too (a single plate centred on the card).
  const plateGeom = (card, i) => {
    if (portrait) return { cx: card.x - card.w / 2 + PLATE_W / 2 + i * (PLATE_W + LINK_GAP), cy: card.y };
    return { cx: card.x, cy: card.y - card.h / 2 + PLATE_H / 2 + i * (PLATE_H + LINK_GAP) };
  };

  // Consistent ports (Direction B). Ancestry leaves the member's OWN plate —
  // its top-centre in portrait, its left-centre in landscape — so the two
  // lines out of a couple visibly belong to their own people, in both layouts.
  const upAnchor = (card, memberId) => {
    const i = card.members.indexOf(memberId);
    const g = plateGeom(card, i);
    return portrait ? { x: g.cx, y: card.y - card.h / 2 } : { x: card.x - card.w / 2, y: g.cy };
  };
  // The mirror of upAnchor for descent: a member's OWN plate — its
  // bottom-centre in portrait, its right-centre in landscape — so a child
  // linked to only one half of a pod visibly hangs from that person, not
  // the couple's shared middle.
  const downAnchor = (card, memberId) => {
    const i = card.members.indexOf(memberId);
    const g = plateGeom(card, i);
    return portrait ? { x: g.cx, y: card.y + card.h / 2 } : { x: card.x + card.w / 2, y: g.cy };
  };

  // Rounded orthogonal elbow between two points. axis 'v' turns on the Y run,
  // 'h' on the X run. `turnAt` (0..1, v-axis) places the horizontal jog along
  // the run — 0 near the start, 1 near the end; default 0.5 (midpoint).
  const elbow = (x0, y0, x1, y1, axis, turnAt = 0.5) => {
    const r = 9;
    if (axis === 'v') {
      if (Math.abs(x1 - x0) < 1) return `M ${x0} ${y0} L ${x1} ${y1}`;
      const dx = x1 > x0 ? 1 : -1, dy = y1 > y0 ? 1 : -1;
      const midY = y0 + (y1 - y0) * turnAt;
      const rr = Math.min(r, Math.abs(x1 - x0) / 2, Math.abs(midY - y0), Math.abs(y1 - midY));
      return `M ${x0} ${y0} L ${x0} ${midY - rr * dy} Q ${x0} ${midY} ${x0 + rr * dx} ${midY} L ${x1 - rr * dx} ${midY} Q ${x1} ${midY} ${x1} ${midY + rr * dy} L ${x1} ${y1}`;
    }
    const midX = (x0 + x1) / 2;
    if (Math.abs(y1 - y0) < 1) return `M ${x0} ${y0} L ${x1} ${y1}`;
    const dx = x1 > x0 ? 1 : -1, dy = y1 > y0 ? 1 : -1;
    const rr = Math.min(r, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2);
    return `M ${x0} ${y0} L ${midX - rr * dx} ${y0} Q ${midX} ${y0} ${midX} ${y0 + rr * dy} L ${midX} ${y1 - rr * dy} Q ${midX} ${y1} ${midX + rr * dx} ${y1} L ${x1} ${y1}`;
  };

  const paths = [];
  // Partner links — a short segment across the seam of each couple, its style
  // carrying the union's status (married / former / widowed). Portrait draws it
  // horizontally between the side-by-side plates; landscape draws it vertically
  // between the stacked plates. Either way it bridges the LINK_GAP seam.
  for (const card of layout.cards) {
    if (card.kind === 'child' || card.members.length !== 2) continue;
    const status = card.marriage?.status;
    const cls = 'ped-partnerlink'
      + (status === 'former' ? ' ped-partnerlink--former' : '')
      + (status === 'widowed' ? ' ped-partnerlink--widowed' : '');
    let d;
    if (portrait) {
      const y = card.y, x0 = card.x - LINK_GAP / 2 - 1, x1 = card.x + LINK_GAP / 2 + 1;
      d = `M ${x0} ${y} L ${x1} ${y}`;
    } else {
      const x = card.x, seam = card.y - card.h / 2 + PLATE_H + LINK_GAP / 2;
      d = `M ${x} ${seam - LINK_GAP / 2 - 1} L ${x} ${seam + LINK_GAP / 2 + 1}`;
    }
    paths.push(<path key={'plink_' + card.id} d={d} className={cls} style={{ animationDelay: `${entryDelayById.get(card.id) ?? 0}ms` }} />);
  }

  // Ancestry (up) connectors — timed to the ARRIVING ancestor card, so the
  // branch and the person at its tip appear together rather than the line
  // reaching a target that already popped in a beat earlier.
  for (const conn of layout.connectors) {
    if (conn.kind !== 'up') continue;
    const from = cardById.get(conn.fromCardId);
    const to = cardById.get(conn.toCardId);
    if (!from || !to) continue;
    const linkDelay = { animationDelay: `${entryDelayById.get(to.id) ?? 0}ms` };
    const a = upAnchor(from, conn.fromMemberId);
    if (portrait) {
      const b = { x: to.x, y: to.y + to.h / 2 };
      // Rise straight up in the child's own column, then jog into the parent
      // near the top — ancestry reads as belonging to that person.
      paths.push(<path key={conn.id} d={elbow(a.x, a.y, b.x, b.y, 'v', 0.72)} className="ped-link" style={linkDelay} />);
    } else {
      // Landscape: leave the member's plate leftward, jog into the parent
      // union's right-centre.
      const b = { x: to.x + to.w / 2, y: to.y };
      paths.push(<path key={conn.id} d={elbow(a.x, a.y, b.x, b.y, 'h')} className="ped-link" style={linkDelay} />);
    }
  }

  // Children — portrait draws ONE sibling bus per side-group from its own
  // origin: a stem to a shared bar, then a drop into each child's top-centre
  // — the classic sibling bracket the eye reads instantly. The focal card
  // can have up to three such buses at once: 'a' and 'b' each hang from that
  // ONE member's own plate (a child who is only that person's, not their
  // partner's — most often a step-child, drawn dashed and low-emphasis for
  // 'b' since it's the non-focus member's own line), 'both' hangs from the
  // pod's shared middle exactly as before.
  const downConns = layout.connectors.filter((c) => c.kind === 'down');
  const downByFrom = new Map();
  for (const c of downConns) {
    if (!downByFrom.has(c.fromCardId)) downByFrom.set(c.fromCardId, []);
    downByFrom.get(c.fromCardId).push(c);
  }
  const drawBus = (origin, kids, dashed, keyBase) => {
    const cls = 'ped-link' + (dashed ? ' ped-link--step' : '');
    const r = 8;
    // The stem+bar lead with the EARLIEST child in the group (the branch
    // starts drawing before any single child's own arrival); each branch
    // down to a specific child carries that child's own delay, so kids
    // within the same bus still arrive staggered rather than all at once.
    const kidDelay = (k) => entryDelayById.get(k.id) ?? 0;
    const busDelay = { animationDelay: `${Math.min(...kids.map(kidDelay))}ms` };
    if (portrait) {
      const stemX = origin.x, stemTop = origin.y;
      const kidTop = Math.min(...kids.map((k) => k.y - k.h / 2));
      const busY = stemTop + (kidTop - stemTop) * 0.5;
      const xs = kids.map((k) => k.x);
      const minX = Math.min(...xs, stemX), maxX = Math.max(...xs, stemX);
      paths.push(<path key={keyBase + '_stem'} d={`M ${stemX} ${stemTop} L ${stemX} ${busY}`} className={cls} style={busDelay} />);
      if (kids.length > 1) paths.push(<path key={keyBase + '_bar'} d={`M ${minX} ${busY} L ${maxX} ${busY}`} className={cls} style={busDelay} />);
      for (const k of kids) {
        const kx = k.x, ky = k.y - k.h / 2;
        const dx = kx > stemX ? 1 : kx < stemX ? -1 : 0;
        const rr = Math.min(r, Math.abs(ky - busY) / 2, dx ? Math.abs(kx - stemX) / 2 : r);
        const d = dx === 0
          ? `M ${kx} ${busY} L ${kx} ${ky}`
          : `M ${kx - rr * dx} ${busY} Q ${kx} ${busY} ${kx} ${busY + rr} L ${kx} ${ky}`;
        paths.push(<path key={keyBase + '_kid_' + k.id} d={d} className={cls} style={{ animationDelay: `${kidDelay(k)}ms` }} />);
      }
    } else {
      // Landscape: ONE sibling bus to the RIGHT — a stem out of the origin to
      // a shared vertical bar, then a branch into each child's left-centre.
      const stemY = origin.y, stemLeft = origin.x;
      const kidLeft = Math.min(...kids.map((k) => k.x - k.w / 2));
      const busX = stemLeft + (kidLeft - stemLeft) * 0.5;
      const ys = kids.map((k) => k.y);
      const minY = Math.min(...ys, stemY), maxY = Math.max(...ys, stemY);
      paths.push(<path key={keyBase + '_stem'} d={`M ${stemLeft} ${stemY} L ${busX} ${stemY}`} className={cls} style={busDelay} />);
      if (kids.length > 1) paths.push(<path key={keyBase + '_bar'} d={`M ${busX} ${minY} L ${busX} ${maxY}`} className={cls} style={busDelay} />);
      for (const k of kids) {
        const kx = k.x - k.w / 2, ky = k.y;
        const dy = ky > stemY ? 1 : ky < stemY ? -1 : 0;
        const rr = Math.min(r, Math.abs(kx - busX) / 2, dy ? Math.abs(ky - stemY) / 2 : r);
        const d = dy === 0
          ? `M ${busX} ${ky} L ${kx} ${ky}`
          : `M ${busX} ${ky - rr * dy} Q ${busX} ${ky} ${busX + rr} ${ky} L ${kx} ${ky}`;
        paths.push(<path key={keyBase + '_kid_' + k.id} d={d} className={cls} style={{ animationDelay: `${kidDelay(k)}ms` }} />);
      }
    }
  };
  for (const [fromCardId, conns] of downByFrom) {
    const from = cardById.get(fromCardId);
    if (!from) continue;
    for (const side of ['both', 'a', 'b']) {
      const kids = conns.filter((c) => c.side === side).map((c) => cardById.get(c.toCardId)).filter(Boolean);
      if (!kids.length) continue;
      const origin = side === 'both'
        ? (portrait ? { x: from.x, y: from.y + from.h / 2 } : { x: from.x + from.w / 2, y: from.y })
        : downAnchor(from, from.members[side === 'a' ? 0 : from.members.length - 1]);
      drawBus(origin, kids, side === 'b', `bus_${fromCardId}_${side}`);
    }
  }

  // ── Children popover ──────────────────────────────────────────────────────
  const popCard = childrenFor ? cardById.get(childrenFor) : null;
  const popover = popCard ? buildPopoverData(graph, popCard) : null;
  const popoverScreen = popCard && viewportRef.current ? (() => {
    const rect = viewportRef.current.getBoundingClientRect();
    const sx = view.panX + popCard.x * view.zoom;
    const sy = view.panY + (popCard.y + popCard.h / 2) * view.zoom;
    return {
      left: Math.min(Math.max(sx, 150), rect.width - 150),
      top: Math.min(sy + 10, rect.height - 120),
    };
  })() : null;

  // ── Spouse-switcher popover position ──────────────────────────────────────
  // The swap pip (per-member, always visible when that member has recorded
  // alternate partners) opens this menu right where it was tapped, in screen
  // space so it stays crisp at any zoom — same anchoring idea the old
  // hover-bar used, just keyed on `switcherFor` (a slot id) instead of a
  // selected/hovered person.
  const switcherCard = switcherFor ? layout.cards.find((c) => c.members.includes(switcherFor)) : null;
  const switcherScreen = switcherCard && viewportRef.current ? (() => {
    const rect = viewportRef.current.getBoundingClientRect();
    const i = switcherCard.members.indexOf(switcherFor);
    const g = plateGeom(switcherCard, i);
    // Portrait: the pip sits at the card's outer bottom edge, so the menu
    // opens just below it. Landscape: the pip sits at the outer right edge,
    // so the menu opens just to the right.
    const worldX = portrait ? g.cx : switcherCard.x + switcherCard.w / 2 + 16;
    const worldY = portrait ? switcherCard.y + switcherCard.h / 2 + 16 : g.cy;
    const sx = view.panX + worldX * view.zoom;
    const sy = view.panY + worldY * view.zoom;
    return {
      left: Math.min(Math.max(sx, 130), rect.width - 130),
      top: Math.min(Math.max(sy, 8), rect.height - 130),
    };
  })() : null;

  return (
    <div className="chart-tree">
      <div
        ref={viewportRef}
        className="chart-tree__viewport"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className={'chart-tree__world' + (gliding ? ' chart-tree__world--glide' : '')}
          style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}
        >
          <svg className="chart-tree__lines" width="1" height="1" style={{ overflow: 'visible' }}>
            {paths}
          </svg>
          {layout.cards.map((card) => (
            <PedCard
              key={card.id}
              card={card}
              graph={graph}
              activeId={activeId}
              horizontal={horizontal}
              isFocal={card.id === layout.focalCardId}
              entryDelayMs={entryDelayById.get(card.id) ?? 0}
              switcherFor={switcherFor}
              onOpenPerson={onOpenPerson}
              onActivate={onActivate}
              onToggleUp={toggleUp}
              onOpenChildren={(id) => { setSwitcherFor(null); setChildrenFor((cur) => (cur === id ? null : id)); }}
              onOpenSwitcher={(memberId) => { setChildrenFor(null); setSwitcherFor((cur) => (cur === memberId ? null : memberId)); }}
              onAddRelative={onAddRelative}
            />
          ))}
        </div>

        {popover && popoverScreen && (
          <div className="ped-pop" style={{ left: popoverScreen.left, top: popoverScreen.top }} role="dialog" aria-label="Children">
            <div className="ped-pop__head">
              <span>{popover.total} {popover.total === 1 ? 'child' : 'children'}</span>
              <button className="ped-pop__close" onClick={() => setChildrenFor(null)} aria-label="Close">×</button>
            </div>
            <div className="ped-pop__scroll">
              {popover.groups.map((g) => (
                <div key={g.key} className="ped-pop__group">
                  {g.label && <p className="ped-pop__grouplabel">{g.label}</p>}
                  {g.rows.map((row) => {
                    const person = graph.byId.get(row.id);
                    if (!person) return null;
                    return (
                      <button key={row.id} className="ped-pop__row" onClick={() => { setChildrenFor(null); onActivate?.(row.id); }}>
                        <Avatar person={person} size={30} shape="squircle" />
                        <span className="ped-pop__rowtext">
                          <span className="ped-pop__rowname">{person.display_name}</span>
                          <span className="ped-pop__rowdates">{lifespan(person)}</span>
                        </span>
                        {row.chip && <span className="ped-chip">{row.chip}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <button
              className="ped-pop__add"
              onClick={() => { setChildrenFor(null); onAddRelative?.(popCard.members[0]); }}
            >
              + Add a child
            </button>
          </div>
        )}

        {/* Spouse switcher — the only floating popover chrome left. Opened by
            a card's own always-visible swap pip, never by selection/hover. */}
        {switcherCard && switcherScreen && (
          <div className="pbar-menu" style={{ left: switcherScreen.left, top: switcherScreen.top }}>
            <SpouseMenu
              graph={graph}
              memberId={switcherFor}
              card={switcherCard}
              partnerChoice={partnerChoice}
              bloodlineOnly={bloodlineOnly}
              onChoose={chooseSpouse}
            />
          </div>
        )}
      </div>

      {viewerId && activeId !== viewerId && graph.byId.has(viewerId) && (
        <button className="ped-backchip" onClick={() => onActivate?.(viewerId)}>
          <BackIcon /> Back to you
        </button>
      )}

      <div className="chart-controls">
        <div className="chart-controls__seg" role="group" aria-label="Chart orientation">
          <button
            className={'chart-controls__btn' + (orientation === 'vertical' ? ' chart-controls__btn--on' : '')}
            onClick={() => setOrientation('vertical')}
            title="Portrait — ancestors above"
            aria-pressed={orientation === 'vertical'}
          >
            <LayoutVerticalIcon />
          </button>
          <button
            className={'chart-controls__btn' + (orientation === 'horizontal' ? ' chart-controls__btn--on' : '')}
            onClick={() => setOrientation('horizontal')}
            title="Landscape — ancestors to the left"
            aria-pressed={orientation === 'horizontal'}
          >
            <LayoutHorizontalIcon />
          </button>
        </div>
        <span className="chart-controls__divider" aria-hidden="true" />
        <button className="chart-controls__btn" onClick={() => zoomBy(1 / 1.25)} title="Zoom out" aria-label="Zoom out">
          <MinusIcon />
        </button>
        <button className="chart-controls__btn" onClick={() => zoomBy(1.25)} title="Zoom in" aria-label="Zoom in">
          <PlusIcon />
        </button>
        <button className="chart-controls__btn" onClick={fitToView} title="Fit to screen" aria-label="Fit to screen">
          <FitIcon />
        </button>
      </div>

      {/* TEMPORARY — see chartDebug above. Fixed a real usability bug in this
          overlay itself: pointerEvents:'none' made it impossible to touch
          or scroll on a real device (a desktop mouse can still scroll a
          non-interactive element under the cursor; a phone's finger cannot)
          — the one report this shipped to investigate couldn't even be
          read. Now interactive, with the single most load-bearing number
          (how far panX truly is from dead-center, in px) pinned above the
          scrollable full dump so it's never hidden behind a scroll the
          reporter can't perform. */}
      {chartDebug && (() => {
        const vpRectW = debugOverflow?.vpRectW ?? viewportRef.current?.getBoundingClientRect()?.width ?? null;
        const centerOffsetPx = vpRectW != null ? Math.round((view.panX - vpRectW / 2) * 100) / 100 : null;
        return (
          <div
            style={{
              position: 'fixed', left: 8, right: 8, bottom: 92, zIndex: 99999,
              maxHeight: '55vh', display: 'flex', flexDirection: 'column',
              background: 'rgba(10,10,10,0.92)', color: '#7CFC7C',
              fontSize: 11, lineHeight: 1.4, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              borderRadius: 10, overflow: 'hidden',
            }}
          >
            <div style={{ padding: '10px 10px 8px', borderBottom: '1px solid rgba(124,252,124,0.35)', flex: '0 0 auto' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: centerOffsetPx != null && Math.abs(centerOffsetPx) > 5 ? '#FF6B6B' : '#7CFC7C' }}>
                center offset: {centerOffsetPx == null ? '…' : `${centerOffsetPx}px`}
              </div>
              <div style={{ fontSize: 11, opacity: 0.85 }}>
                zoom {view.zoom.toFixed(3)} · any card overflowing: {String(debugOverflow?.anyOverflow ?? '…')}
              </div>
            </div>
            <pre
              style={{
                margin: 0, padding: '8px 10px', flex: '1 1 auto', overflow: 'auto',
                WebkitOverflowScrolling: 'touch', whiteSpace: 'pre-wrap',
              }}
            >
              {JSON.stringify(
                {
                  activeId, orientation, view, centerOffsetPx,
                  boxBounds: layout.bounds,
                  focalCardId: layout.focalCardId,
                  focalCardWH: (() => {
                    const f = layout.cards.find((c) => c.id === layout.focalCardId);
                    return f ? [f.w, f.h] : null;
                  })(),
                  cardCount: layout.cards.length,
                  ...debugOverflow,
                },
                null,
                1,
              )}
            </pre>
          </div>
        );
      })()}
    </div>
  );
}

// ── One card ─────────────────────────────────────────────────────────────────

function PedCard(props) {
  return <PlateCard {...props} />;
}

// ── Flat-plate card (Direction B) — one renderer, both orientations ───────────
// A couple is two flat plates joined across the LINK_GAP seam: side by side in
// portrait, stacked in landscape. Ancestry leaves each member's own plate
// (top in portrait, left in landscape); children leave the union's centre
// (bottom / right). Tapping a plate mirrors Tree View exactly: tapping
// someone who ISN'T already the centred/focal person re-roots the chart on
// them; tapping the person already at the centre opens their profile — no
// separate action bar, no double-tap. A small always-visible swap pip per
// member (when they have a recorded alternate partner) opens the spouse
// switcher directly.
function PlateCard({ card, graph, horizontal, isFocal, entryDelayMs = 0, activeId, switcherFor, onOpenPerson, onActivate, onToggleUp, onOpenChildren, onOpenSwitcher, onAddRelative }) {
  const isChild = card.kind === 'child';
  // Emphasis tiers — the eye follows the active family. Focal + immediate
  // (parents, children) at full strength; each generation further up recedes
  // a step, so deep ancestors settle quietly into the past.
  const depth = Math.abs(card._gen ?? 0);
  const recede = depth <= 1 ? '' : depth === 2 ? ' pcard--recede1' : ' pcard--recede2';
  // The soft back-shading wash only makes sense behind an actual COUPLE —
  // a solo card (lone ancestor, or a drawn child) has nothing to unify, so
  // it stays plain and lets its one .pplate read as an ordinary individual
  // card with nothing competing behind it.
  const isPod = card.members.length === 2;
  return (
    <div
      className={'pcard' + (horizontal ? ' pcard--land' : '') + (isChild ? ' pcard--child' : '') + (isPod ? ' pcard--pod' : '') + recede}
      style={{ left: card.x - card.w / 2, top: card.y - card.h / 2, width: card.w, height: card.h, animationDelay: `${entryDelayMs}ms` }}
    >
      <div className="pcard__row">
        {card.members.map((personId) => {
          const person = graph.byId.get(personId);
          if (!person) return null;
          const age = !person.is_minor || person.is_deceased ? ageOrAt(person) : null;
          const dates = age ? `${lifespan(person)} · ${person.is_deceased ? age : `age ${age}`}` : lifespan(person);
          // side 'b' means this child is linked to the pod's non-focus member
          // only — relationally a step-child of the focus-side line even
          // when no edge is explicitly qualified 'step' (there IS no edge to
          // focus at all in that case), so it labels the same way.
          const stepChip = isChild && (card.qualifiers?.a === 'step' || card.qualifiers?.b === 'step' || card.side === 'b') ? 'Step'
            : isChild && ['adopted', 'adoptive'].includes(card.qualifiers?.a) ? 'Adopted' : null;
          return (
            <button
              key={personId}
              className={'pplate' + (person.is_deceased ? ' pplate--passed' : '') + (personId === activeId ? ' pplate--active' : '')}
              style={{ width: PLATE_W }}
              onClick={() => { if (personId === activeId) onOpenPerson?.(personId); else onActivate?.(personId); }}
            >
              <Avatar person={person} size={42} shape="squircle" />
              <span className="pplate__text">
                <span className="pplate__name">
                  <span className="pplate__name-text">{person.display_name}</span>
                  {stepChip && <span className="ped-chip ped-chip--inline">{stepChip}</span>}
                </span>
                <span className="pplate__dates">{dates}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Navigation pips: expand a member's ancestry, or drop into this
          card's children. Portrait: ancestry up, children down. Landscape:
          ancestry left, children right. */}
      {!isChild && card.slots.map((slot, i) => {
        const person = graph.byId.get(slot.id);
        const style = horizontal
          ? { left: -11, top: PLATE_H / 2 + i * (PLATE_H + LINK_GAP) - 11 }
          : { left: (card.members.length === 2 ? PLATE_W / 2 + i * (PLATE_W + LINK_GAP) : card.w / 2) - 11, top: -11 };
        if (!slot.hasMoreUp) {
          // No recorded parents at all for this member — offer to add one
          // right here rather than leaving the chart silently dead-end.
          // Reuses the same generic "open Add Relative" entry point as the
          // existing "+ Add a child" popover button below: no relationship-
          // type pre-selection, matching that established precedent.
          if (!slot.canAddParent) return null;
          return (
            <button
              key={'addup_' + slot.id}
              className="pnav pnav--up ped-up--add"
              style={style}
              onClick={(e) => { e.stopPropagation(); onAddRelative?.(slot.id); }}
              title={`Add ${person?.display_name.split(' ')[0]}’s parent`}
            >
              <PlusIcon />
            </button>
          );
        }
        return (
          <button
            key={'up_' + slot.id}
            className={'pnav pnav--up' + (slot.expanded ? ' pnav--on' : '')}
            style={style}
            onClick={(e) => { e.stopPropagation(); onToggleUp(slot.id); }}
            title={slot.expanded ? `Hide ${person?.display_name.split(' ')[0]}’s parents` : `Show ${person?.display_name.split(' ')[0]}’s parents`}
            aria-expanded={slot.expanded}
          >
            {horizontal
              ? (slot.expanded ? <ChevronRightIcon /> : <ChevronLeftIcon />)
              : (slot.expanded ? <ChevronDownIcon /> : <ChevronUpIcon />)}
          </button>
        );
      })}

      {/* Swap pip — per member, always visible when that member has a
          recorded alternate partner. Opposite side from the up pip so the
          two never collide: portrait puts it at the plate's own outer
          bottom edge, landscape at the card's outer right edge. */}
      {!isChild && card.slots.map((slot, i) => {
        if (!slot.altPartnerIds?.length) return null;
        const person = graph.byId.get(slot.id);
        const style = horizontal
          ? { left: card.w - 11, top: PLATE_H / 2 + i * (PLATE_H + LINK_GAP) - 11 }
          : { left: (card.members.length === 2 ? PLATE_W / 2 + i * (PLATE_W + LINK_GAP) : card.w / 2) - 11, top: card.h - 11 };
        return (
          <button
            key={'swap_' + slot.id}
            className={'pnav pnav--swap' + (switcherFor === slot.id ? ' pnav--on' : '')}
            style={style}
            onClick={(e) => { e.stopPropagation(); onOpenSwitcher(slot.id); }}
            title={`Show ${person?.display_name.split(' ')[0]} with a different partner`}
            aria-expanded={switcherFor === slot.id}
          >
            <SwapIcon />
          </button>
        );
      })}

      {card.childrenCount > 0 && !isFocal && (
        <button
          className="pnav pnav--down"
          style={horizontal ? { left: card.w - 11, top: card.h / 2 - 11 } : { left: card.w / 2 - 11, top: card.h - 11 }}
          onClick={(e) => { e.stopPropagation(); isChild ? onActivate?.(card.members[0]) : onOpenChildren(card.id); }}
          title={isChild ? 'Focus the chart here' : `Show ${card.childrenCount} ${card.childrenCount === 1 ? 'child' : 'children'}`}
        >
          {isChild ? (horizontal ? <ArrowRightIcon /> : <ArrowDownIcon />) : (horizontal ? <ChevronRightIcon /> : <ChevronDownIcon />)}
        </button>
      )}

      {/* No recorded children at all for this ancestor/couple card — offer
          to add the first one, same "add" pip language as the parent-side
          gap above. Deliberately not offered on a drawn child card itself
          (that's what the arrow-to-refocus pip above already does) — but
          IS offered on the focal card despite the ordinary children-popover
          pip being suppressed there: a childless focal person is exactly
          where this affordance matters most, and there's no popover to
          collide with when childrenCount is already 0. */}
      {!isChild && card.childrenCount === 0 && (
        <button
          className="pnav pnav--down ped-up--add"
          style={horizontal ? { left: card.w - 11, top: card.h / 2 - 11 } : { left: card.w / 2 - 11, top: card.h - 11 }}
          onClick={(e) => { e.stopPropagation(); onAddRelative?.(card.members[0]); }}
          title="Add a child"
        >
          <PlusIcon />
        </button>
      )}
    </div>
  );
}

function SpouseMenu({ graph, memberId, card, partnerChoice, bloodlineOnly = false, onChoose }) {
  const current = card.members.find((m) => m !== memberId) ?? null;
  const candidates = unionCandidates(graph, memberId, bloodlineOnly).filter((c) => c.id !== current);
  const hasChoice = partnerChoice.get(memberId) !== undefined;
  return (
    <div className="ped-spouse-menu" role="menu" aria-label="Show with which partner">
      {candidates.map((c) => {
        const p = graph.byId.get(c.id);
        if (!p) return null;
        const note = c.sharedChildren > 0
          ? `${c.sharedChildren} ${c.sharedChildren === 1 ? 'child' : 'children'} together`
          : c.status === 'former' ? 'Former partner' : c.status === 'widowed' ? 'Widowed' : 'Partner';
        return (
          <button key={c.id} className="ped-spouse-menu__row" onClick={() => onChoose(memberId, c.id)} role="menuitem">
            <Avatar person={p} size={26} shape="squircle" />
            <span className="ped-spouse-menu__text">
              <span>{p.display_name}</span>
              <span className="ped-spouse-menu__note">{note}</span>
            </span>
          </button>
        );
      })}
      {hasChoice && current && (
        <button className="ped-spouse-menu__row ped-spouse-menu__reset" onClick={() => onChoose(memberId, undefined)} role="menuitem">
          ↩ Back to {graph.byId.get(current)?.display_name?.split(' ')[0] ?? 'default'}
        </button>
      )}
    </div>
  );
}

// The popover's grouped rows: children of both displayed members first
// (plain), then per-outside-partner groups for children this union's
// members had elsewhere — named honestly rather than silently mixed in.
function buildPopoverData(graph, card) {
  const [aId, bId] = card.members;
  const rows = card.childRows;
  const shared = [], byOther = new Map();
  for (const row of rows) {
    const linkedBoth = row.aQualifier != null && (bId ? row.bQualifier != null : true);
    const chipQ = [row.aQualifier, row.bQualifier].find((q) => q && q !== 'biological');
    const chip = chipQ === 'step' ? 'Step' : chipQ === 'adopted' || chipQ === 'adoptive' ? 'Adopted' : chipQ ? capitalize(chipQ) : null;
    if (linkedBoth) shared.push({ id: row.id, chip });
    else {
      const key = row.otherParentId ?? '__solo__';
      if (!byOther.has(key)) byOther.set(key, []);
      byOther.get(key).push({ id: row.id, chip });
    }
  }
  const groups = [];
  if (shared.length) groups.push({ key: 'shared', label: null, rows: shared });
  for (const [otherId, list] of byOther) {
    const insideId = graph.parents(list[0].id).some((p) => p.id === aId) ? aId : bId;
    const inside = graph.byId.get(insideId)?.display_name?.split(' ')[0] ?? '';
    const label = otherId === '__solo__'
      ? `${inside}’s`
      : `${inside}’s, with ${graph.byId.get(otherId)?.display_name ?? 'another partner'}`;
    groups.push({ key: 'o_' + otherId, label, rows: list });
  }
  return { total: rows.length, groups };
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ── Icons ────────────────────────────────────────────────────────────────────

// Three straight rewrites of the same glyph (SVG path, coordinate-shifted;
// then the same path rendered directly instead of CSS-rotated) each measured
// centred in this sandbox and each still reported off-centre on the real
// device — pointing at the SVG rendering pipeline itself (a 24-unit viewBox
// scaled onto an 11px box, a non-integer factor, then stroked and possibly
// rotated) as the actual variable, not the coordinates. This drops SVG
// entirely: a plain CSS box with two borders, rotated 45deg, is the same
// "arrow" every framework's own utility classes use — no viewBox, no path,
// no scale factor, nothing left for a rendering engine to disagree about.
function NavChevron({ dir }) {
  return <span className={`pnav__chev pnav__chev--${dir}`} aria-hidden="true" />;
}
function ChevronUpIcon() { return <NavChevron dir="up" />; }
function ChevronDownIcon() { return <NavChevron dir="down" />; }
function ChevronLeftIcon() { return <NavChevron dir="left" />; }
function ChevronRightIcon() { return <NavChevron dir="right" />; }
function ArrowRightIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function ArrowDownIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function PlusIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>;
}
function MinusIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>;
}
function SwapIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 16V5m0 0L3 9m4-4l4 4M17 8v11m0 0l4-4m-4 4l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function BackIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function FitIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 4H5a1 1 0 00-1 1v4M15 4h4a1 1 0 011 1v4M9 20H5a1 1 0 01-1-1v-4M15 20h4a1 1 0 001-1v-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function LayoutVerticalIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="3" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.6" /><rect x="4" y="17" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.6" /><rect x="14" y="17" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.6" /><path d="M12 7v5M12 12H7v5M12 12h5v5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}
function LayoutHorizontalIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="9" width="4" height="6" rx="1" stroke="currentColor" strokeWidth="1.6" /><rect x="17" y="4" width="4" height="6" rx="1" stroke="currentColor" strokeWidth="1.6" /><rect x="17" y="14" width="4" height="6" rx="1" stroke="currentColor" strokeWidth="1.6" /><path d="M7 12h5M12 12V7h5M12 12v5h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}

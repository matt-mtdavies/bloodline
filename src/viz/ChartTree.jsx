import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { computePedigree, primaryUnionPartner, unionCandidates } from './pedigreeLayout.js';
import { ROW_H, MARRIAGE_H, PLATE_W, PLATE_H, LINK_GAP } from './pedigreeMetrics.js';
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
const MAX_ZOOM = 1.6;
const FIT_PADDING = 72;
const isBioAdopt = (q) => !q || q === 'biological' || q === 'adoptive' || q === 'adopted';

// The opening state for a fresh root: the focal couple's own parents
// revealed (one generation up both sides), plus the focal person's
// grandparents' slots ready behind their arrows — focused, not sprawling.
function initialExpandedUp(graph, focusId) {
  const set = new Set([focusId]);
  const partner = primaryUnionPartner(graph, focusId);
  if (partner) set.add(partner);
  for (const p of graph.parents(focusId)) {
    if (isBioAdopt(p.qualifier)) set.add(p.id);
  }
  return set;
}

export default function ChartTree({ graph, activeId, viewerId, bloodlineOnly = false, onOpenPerson, onAddRelative, onActivate }) {
  const [orientation, setOrientation] = useState('vertical');
  const [expandedUp, setExpandedUp] = useState(() => initialExpandedUp(graph, activeId));
  const [partnerChoice, setPartnerChoice] = useState(() => new Map());
  const [childrenFor, setChildrenFor] = useState(null); // cardId with open children popover
  const [switcherFor, setSwitcherFor] = useState(null); // memberId with open spouse menu
  const [selectedId, setSelectedId] = useState(null); // personId selected → contextual action bar
  const [hoveredId, setHoveredId] = useState(null);   // desktop hover-preview of the action bar
  const hoverClear = useRef(null);
  // Desktop only: hover previews a person's action bar; a short grace lets the
  // pointer travel from the plate up into the bar without it closing.
  const hoverEnter = useCallback((id) => { clearTimeout(hoverClear.current); setHoveredId(id); }, []);
  const hoverLeave = useCallback(() => {
    clearTimeout(hoverClear.current);
    hoverClear.current = setTimeout(() => setHoveredId(null), 130);
  }, []);
  useEffect(() => () => clearTimeout(hoverClear.current), []);
  const [view, setView] = useState({ zoom: 0.9, panX: 0, panY: 0 });
  const [gliding, setGliding] = useState(false);
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
  // at a fully-legible zoom so a compact family isn't blown up huge.
  //
  // Horizontal mode additionally guarantees the focal card sits exactly at
  // the viewport's horizontal centre (it's always at local x=0 — see
  // place(focal, 0) in pedigreeLayout.js): ancestor branches usually sprawl
  // wider than the children row, so centring on the bounding box's own
  // midpoint would otherwise drift focal off-centre. Sizing the box
  // symmetrically around 0 (using whichever side reaches furthest) keeps
  // "you" fixed in the middle at the cost of some empty margin on the
  // shorter side — the intended trade-off, not a bug.
  const centerOnFocal = useCallback((lay, orient) => {
    const vp = viewportRef.current;
    if (!vp || !lay.cards.length) return;
    const rect = vp.getBoundingClientRect();
    const PAD = { top: 170, bottom: 150, side: 36 };
    const { minX, maxX, minY, maxY } = lay.bounds;
    let boxW, boxH, cx, cy;
    if (orient === 'horizontal') {
      boxW = Math.max(1, Math.max(Math.abs(minX), Math.abs(maxX)) * 2);
      boxH = Math.max(1, Math.max(Math.abs(minY), Math.abs(maxY)) * 2);
      cx = 0; cy = 0;
    } else {
      boxW = Math.max(1, maxX - minX); boxH = Math.max(1, maxY - minY);
      cx = (minX + maxX) / 2; cy = (minY + maxY) / 2;
    }
    const zoom = Math.min(0.92, Math.max(FIT_MIN_ZOOM,
      Math.min((rect.width - PAD.side * 2) / boxW, (rect.height - PAD.top - PAD.bottom) / boxH)));
    glideTo({
      zoom,
      panX: rect.width / 2 - cx * zoom,
      panY: PAD.top + (rect.height - PAD.top - PAD.bottom) / 2 - cy * zoom,
    });
  }, [glideTo]);

  // Re-root: reset expansion + choices to the fresh opening state and glide
  // the camera to the new focal card.
  useEffect(() => {
    const nextExpanded = initialExpandedUp(graph, activeId);
    setExpandedUp(nextExpanded);
    setPartnerChoice(new Map());
    setChildrenFor(null);
    setSwitcherFor(null);
    setSelectedId(null);
    centerOnFocal(
      computePedigree(graph, activeId, { expandedUp: nextExpanded, partnerChoice: new Map(), orientation, bloodlineOnly }),
      orientation,
    );
    // Intentionally NOT keyed on graph/orientation — edits elsewhere must
    // not discard expansion state; orientation has its own effect below.
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    centerOnFocal(computePedigree(graph, activeId, { expandedUp, partnerChoice, orientation, bloodlineOnly }), orientation);
  }, [orientation]); // eslint-disable-line react-hooks/exhaustive-deps
  // Toggling Bloodline mode re-fits: children appear/disappear, so re-frame
  // the (now differently-shaped) tree rather than leaving it half off-screen.
  useEffect(() => {
    centerOnFocal(computePedigree(graph, activeId, { expandedUp, partnerChoice, orientation, bloodlineOnly }), orientation);
  }, [bloodlineOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const fitToView = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || !layout.cards.length) return;
    const rect = vp.getBoundingClientRect();
    const { minX, maxX, minY, maxY } = layout.bounds;
    let boxW, boxH, cx, cy;
    if (orientation === 'horizontal') {
      boxW = Math.max(1, Math.max(Math.abs(minX), Math.abs(maxX)) * 2);
      boxH = Math.max(1, Math.max(Math.abs(minY), Math.abs(maxY)) * 2);
      cx = 0; cy = 0;
    } else {
      boxW = Math.max(1, maxX - minX); boxH = Math.max(1, maxY - minY);
      cx = (minX + maxX) / 2; cy = (minY + maxY) / 2;
    }
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
      || e.target.closest('.pbar') || e.target.closest('.pbar-menu') || e.target.closest('.chart-controls')
      || e.target.closest('.ped-pop') || e.target.closest('.ped-backchip')
    )) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
    setGliding(false);
    setChildrenFor(null);
    setSwitcherFor(null);
    setSelectedId(null); // tap empty canvas dismisses the selection
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
      if (e.key === 'Escape') { setChildrenFor(null); setSwitcherFor(null); setSelectedId(null); }
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

  // Portrait: a couple is two plates side by side. Member i's plate centre.
  const plateCenterX = (card, i) =>
    card.members.length === 2
      ? card.x - card.w / 2 + PLATE_W / 2 + i * (PLATE_W + LINK_GAP)
      : card.x;

  // Landscape (stacked rows) — kept from the previous chart.
  const rowCenterOffset = (card, i) => -card.h / 2 + ROW_H / 2 + (i === 1 ? ROW_H + MARRIAGE_H : 0);

  // Consistent ports (Direction B). Portrait: ancestry leaves the TOP-CENTRE
  // of the member's own plate; children enter the TOP-CENTRE of the child
  // plate and descend from the union's BOTTOM-CENTRE. Landscape retains the
  // side-entry FamilySearch look.
  const upAnchor = (card, memberId) => {
    const i = card.members.indexOf(memberId);
    if (portrait) return { x: plateCenterX(card, i), y: card.y - card.h / 2 };
    const rowCenter = rowCenterOffset(card, i);
    if (horizontal) return { x: card.x - card.w / 2, y: card.y + rowCenter };
    if (card.members.length === 2) {
      const dir = i === 0 ? -1 : 1;
      return { x: card.x + dir * card.w / 2, y: card.y + rowCenter, dir };
    }
    return { x: card.x, y: card.y - card.h / 2 };
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
  // carrying the union's status (married / former / widowed). Portrait only;
  // landscape's marriage strip lives inside the stacked card.
  if (portrait) {
    for (const card of layout.cards) {
      if (card.kind === 'child' || card.members.length !== 2) continue;
      const y = card.y;
      const x0 = card.x - LINK_GAP / 2 - 1, x1 = card.x + LINK_GAP / 2 + 1;
      const status = card.marriage?.status;
      const cls = 'ped-partnerlink'
        + (status === 'former' ? ' ped-partnerlink--former' : '')
        + (status === 'widowed' ? ' ped-partnerlink--widowed' : '');
      paths.push(<path key={'plink_' + card.id} d={`M ${x0} ${y} L ${x1} ${y}`} className={cls} />);
    }
  }

  // Ancestry (up) connectors.
  for (const conn of layout.connectors) {
    if (conn.kind !== 'up') continue;
    const from = cardById.get(conn.fromCardId);
    const to = cardById.get(conn.toCardId);
    if (!from || !to) continue;
    const a = upAnchor(from, conn.fromMemberId);
    if (portrait) {
      const b = { x: to.x, y: to.y + to.h / 2 };
      // Rise straight up in the child's own column, then jog into the parent
      // near the top — ancestry reads as belonging to that person.
      paths.push(<path key={conn.id} d={elbow(a.x, a.y, b.x, b.y, 'v', 0.72)} className="ped-link" />);
    } else {
      const b = horizontal ? { x: to.x + to.w / 2, y: to.y } : { x: to.x, y: to.y + to.h / 2 };
      paths.push(<path key={conn.id} d={elbow(a.x, a.y, b.x, b.y, horizontal ? 'h' : 'v', a.dir ? 0.18 : 0.5)} className="ped-link" />);
    }
  }

  // Children — portrait draws ONE sibling bus from the union's bottom-centre:
  // a stem down to a shared horizontal bar, then a drop into each child's
  // top-centre. The classic sibling bracket the eye reads instantly.
  const downConns = layout.connectors.filter((c) => c.kind === 'down');
  if (downConns.length) {
    const from = cardById.get(downConns[0].fromCardId);
    const kids = downConns.map((c) => cardById.get(c.toCardId)).filter(Boolean);
    if (from && kids.length) {
      if (portrait) {
        const stemX = from.x, stemTop = from.y + from.h / 2;
        const kidTop = Math.min(...kids.map((k) => k.y - k.h / 2));
        const busY = stemTop + (kidTop - stemTop) * 0.5;
        const r = 8;
        const xs = kids.map((k) => k.x);
        const minX = Math.min(...xs, stemX), maxX = Math.max(...xs, stemX);
        paths.push(<path key="bus_stem" d={`M ${stemX} ${stemTop} L ${stemX} ${busY}`} className="ped-link" />);
        if (kids.length > 1) paths.push(<path key="bus_bar" d={`M ${minX} ${busY} L ${maxX} ${busY}`} className="ped-link" />);
        for (const k of kids) {
          const kx = k.x, ky = k.y - k.h / 2;
          const dx = kx > stemX ? 1 : kx < stemX ? -1 : 0;
          const rr = Math.min(r, Math.abs(ky - busY) / 2, dx ? Math.abs(kx - stemX) / 2 : r);
          const d = dx === 0
            ? `M ${kx} ${busY} L ${kx} ${ky}`
            : `M ${kx - rr * dx} ${busY} Q ${kx} ${busY} ${kx} ${busY + rr} L ${kx} ${ky}`;
          paths.push(<path key={'kid_' + k.id} d={d} className="ped-link" />);
        }
      } else {
        for (const conn of downConns) {
          const to = cardById.get(conn.toCardId);
          if (!to) continue;
          const a = { x: from.x + from.w / 2, y: from.y + (conn.side === 'a' ? -from.h / 4 : conn.side === 'b' ? from.h / 4 : 0) };
          const b = { x: to.x - to.w / 2, y: to.y };
          paths.push(<path key={conn.id} d={elbow(a.x, a.y, b.x, b.y, 'h')} className="ped-link" />);
        }
      }
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

  // ── Selection / hover → contextual action bar (Direction B) ──────────────
  // The bar targets the selected person, or (desktop) the hovered one as a
  // preview. Positioned in screen space so it stays crisp at any zoom.
  const barId = selectedId || hoveredId;
  const selInfo = (() => {
    if (!barId || !portrait) return null;
    const card = layout.cards.find((c) => c.members.includes(barId));
    if (!card) return null;
    const i = card.members.indexOf(barId);
    const plateCx = card.members.length === 2
      ? card.x - card.w / 2 + PLATE_W / 2 + i * (PLATE_W + LINK_GAP)
      : card.x;
    const slot = card.slots?.find((s) => s.id === barId) ?? null;
    return { card, plateCx, plateTop: card.y - card.h / 2, slot };
  })();
  const selScreen = selInfo && viewportRef.current ? (() => {
    const rect = viewportRef.current.getBoundingClientRect();
    const sx = view.panX + selInfo.plateCx * view.zoom;
    const sy = view.panY + selInfo.plateTop * view.zoom;
    return {
      left: Math.min(Math.max(sx, 130), rect.width - 130),
      top: Math.max(sy - 54, 8),
    };
  })() : null;
  const selPerson = barId ? graph.byId.get(barId) : null;
  const dismissSel = () => { setSelectedId(null); setHoveredId(null); };

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
              switcherFor={switcherFor}
              onOpenPerson={onOpenPerson}
              onActivate={onActivate}
              onToggleUp={toggleUp}
              onAddRelative={onAddRelative}
              onOpenChildren={(id) => { setSwitcherFor(null); setChildrenFor((cur) => (cur === id ? null : id)); }}
              onOpenSwitcher={(memberId) => { setChildrenFor(null); setSwitcherFor((cur) => (cur === memberId ? null : memberId)); }}
              onChooseSpouse={chooseSpouse}
              partnerChoice={partnerChoice}
              selectedId={selectedId}
              onSelect={(id) => { setChildrenFor(null); setSelectedId((cur) => (cur === id ? null : id)); }}
              onHoverEnter={hoverEnter}
              onHoverLeave={hoverLeave}
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
                        <Avatar person={person} size={30} />
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

        {/* Contextual action bar — the ONLY editing chrome, and only for the
            selected person. Everything else stays calm. */}
        {selInfo && selScreen && selPerson && (
          <div
            className="pbar"
            style={{ left: selScreen.left, top: selScreen.top }}
            role="toolbar"
            aria-label={`Actions for ${selPerson.display_name}`}
            onPointerEnter={(e) => { if (e.pointerType === 'mouse') hoverEnter(barId); }}
            onPointerLeave={(e) => { if (e.pointerType === 'mouse') hoverLeave(); }}
          >
            <button className="pbar__btn" onClick={() => { dismissSel(); onOpenPerson?.(barId); }}>
              <ProfileIcon /><span>Profile</span>
            </button>
            {activeId !== barId && (
              <button className="pbar__btn" onClick={() => { dismissSel(); onActivate?.(barId); }}>
                <CentreIcon /><span>Centre</span>
              </button>
            )}
            <button className="pbar__btn" onClick={() => { dismissSel(); onAddRelative?.(barId); }}>
              <PlusIcon /><span>Add</span>
            </button>
            {selInfo.slot?.altPartnerIds?.length > 0 && (
              <button
                className={'pbar__btn' + (switcherFor === barId ? ' pbar__btn--on' : '')}
                onClick={() => { setSelectedId(barId); setSwitcherFor((cur) => (cur === barId ? null : barId)); }}
                aria-expanded={switcherFor === barId}
              >
                <SwapIcon /><span>Partner</span>
              </button>
            )}
          </div>
        )}
        {selInfo && selScreen && switcherFor === barId && (
          <div className="pbar-menu" style={{ left: selScreen.left, top: selScreen.top + 46 }}>
            <SpouseMenu
              graph={graph}
              memberId={barId}
              card={selInfo.card}
              partnerChoice={partnerChoice}
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
    </div>
  );
}

// ── One card ─────────────────────────────────────────────────────────────────

function PedCard(props) {
  const { card, horizontal } = props;
  if (!horizontal) return <PortraitCard {...props} />;
  return <StackedCard {...props} />;
}

// ── Portrait: horizontal-couple plates (Direction B) ──────────────────────────
// Two flat plates side by side (one, if solo), joined across the seam by the
// partner-link drawn in the SVG layer. Ancestry rises from each plate's top;
// children descend from the union's centre. Editing chrome is deferred to the
// on-select action bar — the resting card carries only navigation pips.
function PortraitCard({ card, graph, isFocal, selectedId, onOpenPerson, onSelect, onActivate, onToggleUp, onAddRelative, onOpenChildren, onHoverEnter, onHoverLeave }) {
  const isChild = card.kind === 'child';
  // Emphasis tiers — the eye follows the active family. Focal + immediate
  // (parents, children) at full strength; each generation further up recedes
  // a step, so deep ancestors settle quietly into the past.
  const depth = Math.abs(card._gen ?? 0);
  const recede = depth <= 1 ? '' : depth === 2 ? ' pcard--recede1' : ' pcard--recede2';
  return (
    <div
      className={'pcard' + (isFocal ? ' pcard--focal' : '') + (isChild ? ' pcard--child' : '') + recede}
      style={{ left: card.x - card.w / 2, top: card.y - card.h / 2, width: card.w, height: card.h }}
    >
      <div className="pcard__row">
        {card.members.map((personId, i) => {
          const person = graph.byId.get(personId);
          if (!person) return null;
          const age = !person.is_minor || person.is_deceased ? ageOrAt(person) : null;
          const dates = age ? `${lifespan(person)} · ${person.is_deceased ? age : `age ${age}`}` : lifespan(person);
          const stepChip = isChild && (card.qualifiers?.a === 'step' || card.qualifiers?.b === 'step') ? 'Step'
            : isChild && ['adopted', 'adoptive'].includes(card.qualifiers?.a) ? 'Adopted' : null;
          return (
            <button
              key={personId}
              className={'pplate'
                + (person.is_deceased ? ' pplate--passed' : '')
                + (personId === selectedId ? ' pplate--selected' : '')}
              style={{ width: PLATE_W }}
              onClick={() => onSelect?.(personId)}
              onDoubleClick={() => onOpenPerson?.(personId)}
              onPointerEnter={(e) => { if (e.pointerType === 'mouse') onHoverEnter?.(personId); }}
              onPointerLeave={(e) => { if (e.pointerType === 'mouse') onHoverLeave?.(); }}
            >
              <Avatar person={person} size={32} />
              <span className="pplate__text">
                <span className="pplate__name">
                  {person.display_name}
                  {stepChip && <span className="ped-chip ped-chip--inline">{stepChip}</span>}
                </span>
                <span className="pplate__dates">{dates}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Navigation pips (viewing state): expand a member's ancestry, or drop
          into this card's children. Editing actions live in the action bar. */}
      {!isChild && card.slots.map((slot, i) => {
        if (!slot.hasMoreUp) return null;
        const person = graph.byId.get(slot.id);
        const cx = card.members.length === 2 ? PLATE_W / 2 + i * (PLATE_W + LINK_GAP) : card.w / 2;
        return (
          <button
            key={'up_' + slot.id}
            className={'pnav pnav--up' + (slot.expanded ? ' pnav--on' : '')}
            style={{ left: cx - 11, top: -11 }}
            onClick={(e) => { e.stopPropagation(); onToggleUp(slot.id); }}
            title={slot.expanded ? `Hide ${person?.display_name.split(' ')[0]}’s parents` : `Show ${person?.display_name.split(' ')[0]}’s parents`}
            aria-expanded={slot.expanded}
          >
            <ChevronUpIcon />
          </button>
        );
      })}

      {card.childrenCount > 0 && !isFocal && (
        <button
          className="pnav pnav--down"
          style={{ left: card.w / 2 - 11, top: card.h - 11 }}
          onClick={(e) => { e.stopPropagation(); isChild ? onActivate?.(card.members[0]) : onOpenChildren(card.id); }}
          title={isChild ? 'Focus the chart here' : `Show ${card.childrenCount} ${card.childrenCount === 1 ? 'child' : 'children'}`}
        >
          {isChild ? <ArrowDownIcon /> : <ChevronDownIcon />}
        </button>
      )}
    </div>
  );
}

// ── Landscape: the previous stacked-row union card, unchanged ─────────────────
function StackedCard({ card, graph, activeId, horizontal, isFocal, switcherFor, partnerChoice, onOpenPerson, onActivate, onToggleUp, onAddRelative, onOpenChildren, onOpenSwitcher, onChooseSpouse }) {
  const isChild = card.kind === 'child';
  return (
    <div
      className={'ped-card' + (isFocal ? ' ped-card--focal' : '') + (isChild ? ' ped-card--child' : '')}
      style={{ left: card.x - card.w / 2, top: card.y - card.h / 2, width: card.w, height: card.h }}
    >
      {card.members.map((personId, i) => {
        const person = graph.byId.get(personId);
        if (!person) return null;
        const slot = card.slots.find((s) => s.id === personId);
        const age = !person.is_minor || person.is_deceased ? ageOrAt(person) : null;
        const dates = age ? `${lifespan(person)} · ${person.is_deceased ? age : `age ${age}`}` : lifespan(person);
        const stepChip = isChild && (card.qualifiers?.a === 'step' || card.qualifiers?.b === 'step') ? 'Step'
          : isChild && ['adopted', 'adoptive'].includes(card.qualifiers?.a) ? 'Adopted' : null;
        return (
          <div key={personId} className="ped-row-wrap">
            {i === 1 && <MarriageStrip marriage={card.marriage} />}
            <div className={'ped-row' + (person.is_deceased ? ' ped-row--passed' : '')}>
              <button className="ped-row__main" onClick={() => onOpenPerson?.(personId)} title="Open profile">
                <Avatar person={person} size={34} />
                <span className="ped-row__text">
                  <span className="ped-row__name">
                    {person.display_name}
                    {stepChip && <span className="ped-chip ped-chip--inline">{stepChip}</span>}
                  </span>
                  <span className="ped-row__dates">{dates}</span>
                </span>
              </button>
              {!isChild && slot?.isLine && slot.altPartnerIds.length > 0 && (
                <button
                  className={'ped-switch' + (switcherFor === personId ? ' ped-switch--on' : '')}
                  onClick={() => onOpenSwitcher(personId)}
                  title="Show a different partner"
                  aria-label={`Show a different partner of ${person.display_name}`}
                  aria-expanded={switcherFor === personId}
                >
                  <SwapIcon />
                </button>
              )}
              {switcherFor === personId && (
                <SpouseMenu
                  graph={graph}
                  memberId={personId}
                  card={card}
                  partnerChoice={partnerChoice}
                  onChoose={onChooseSpouse}
                />
              )}
            </div>
          </div>
        );
      })}

      {/* Per-member up-lines: expand arrow when parents exist, a quiet
          "add parent" affordance when the line simply hasn't been recorded
          yet — placed exactly where the missing card would appear. */}
      {!isChild && card.slots.map((slot, i) => {
        const person = graph.byId.get(slot.id);
        const pos = upButtonStyle(card, i, horizontal);
        if (slot.hasMoreUp) {
          return (
            <button
              key={'up_' + slot.id}
              className={'ped-up' + (slot.expanded ? ' ped-up--open' : '')}
              style={pos}
              onClick={() => onToggleUp(slot.id)}
              title={slot.expanded ? `Hide ${person?.display_name.split(' ')[0]}’s parents` : `Show ${person?.display_name.split(' ')[0]}’s parents`}
              aria-expanded={slot.expanded}
            >
              <ChevronUpIcon />
            </button>
          );
        }
        return (
          <button
            key={'add_' + slot.id}
            className="ped-up ped-up--add"
            style={pos}
            onClick={() => onAddRelative?.(slot.id)}
            title={`Add ${person?.display_name.split(' ')[0]}’s parents`}
          >
            <PlusIcon />
          </button>
        );
      })}

      {card.childrenCount > 0 && !isFocal && (
        <button
          className="ped-footer"
          onClick={() => (isChild ? onActivate?.(card.members[0]) : onOpenChildren(card.id))}
          title={isChild ? 'Focus the chart here' : 'Show children'}
        >
          {card.childrenCount} {card.childrenCount === 1 ? 'child' : 'children'}
          {isChild ? <ArrowRightIcon /> : <ChevronDownIcon />}
        </button>
      )}
    </div>
  );
}

// Two tiers, nothing in between. No marriage evidence: the plain
// partner_status word (current → "Partners", former → "Former partners",
// widowed → "Widowed") — this base wording is deliberately untouched by
// marriage evidence at all. Evidence (the explicit is_married flag, or a
// recorded date/place implying it): just "Married", full stop — no date, no
// place, no "Formerly" variant. The date/place still lives in the profile's
// marriage editor for anyone who wants it; the compact card only ever
// needs to answer "were they married," not recite the wedding details.
function MarriageStrip({ marriage }) {
  let text = null;
  if (marriage) {
    const wed = marriage.isMarried || marriage.date || marriage.place;
    if (wed) text = 'Married';
    else if (marriage.status === 'former') text = 'Former partners';
    else if (marriage.status === 'widowed') text = 'Widowed';
    else text = 'Partners';
  }
  return (
    <div className={'ped-marriage' + (text ? '' : ' ped-marriage--bare')}>
      {text && <span className="ped-marriage__text">{text === 'Married' ? <RingsIcon /> : null} {text}</span>}
    </div>
  );
}

function SpouseMenu({ graph, memberId, card, partnerChoice, onChoose }) {
  const current = card.members.find((m) => m !== memberId) ?? null;
  const candidates = unionCandidates(graph, memberId).filter((c) => c.id !== current);
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
            <Avatar person={p} size={26} />
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

// Mirrors upAnchor's geometry exactly (see the connector-drawing code
// above) so a member's expand/add-parent control always sits right where
// their own line actually meets the card — never floating somewhere else
// on a shared edge where it's unclear whose arrow is whose.
function upButtonStyle(card, slotIndex, horizontal) {
  if (horizontal) {
    const rowCenter = ROW_H / 2 + (slotIndex === 1 ? ROW_H + MARRIAGE_H : 0);
    return { right: -13, top: rowCenter - 13 };
  }
  if (card.members.length === 2) {
    const rowCenter = ROW_H / 2 + (slotIndex === 1 ? ROW_H + MARRIAGE_H : 0);
    return slotIndex === 0 ? { left: -13, top: rowCenter - 13 } : { right: -13, top: rowCenter - 13 };
  }
  return { left: card.w / 2 - 13, top: -13 };
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

function ChevronUpIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 15l7-7 7 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function ChevronDownIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 9l7 7 7-7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function ArrowRightIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function ArrowDownIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function ProfileIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8.5" r="3.6" stroke="currentColor" strokeWidth="1.7" /><path d="M5 19.5c1.3-3.3 4-5 7-5s5.7 1.7 7 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
}
function CentreIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.7" /><path d="M12 3v3.2M12 17.8V21M3 12h3.2M17.8 12H21" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
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
function RingsIcon() {
  return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="9" cy="13" r="6" stroke="currentColor" strokeWidth="1.8" /><circle cx="15" cy="11" r="6" stroke="currentColor" strokeWidth="1.8" /></svg>;
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

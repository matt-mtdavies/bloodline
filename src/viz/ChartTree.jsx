import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { computeChartPods } from './chartLayout.js';
import { lifespan, ageOrAt } from '../lib/dates.js';
import Avatar from '../components/Avatar.jsx';

// MIN_ZOOM floors manual zoom-out (the − button) at a level where cards are
// still legible. Fit-to-view deliberately does NOT clamp to it — a large
// family can genuinely need a smaller zoom than that to show every branch at
// once, and flooring it there would force the fitted zoom back up, clipping
// cards off the edges (the actual bug this comment replaced).
const MIN_ZOOM = 0.28;
const FIT_MIN_ZOOM = 0.06;
const MAX_ZOOM = 1.6;
const FIT_PADDING = 72;

// Parent pointers for every pod reachable from the root(s), via a plain BFS
// over childPods — shared by the spine calculation below and by toggleCollapse's
// accordion logic, so both agree on the same notion of "ancestor chain".
function buildParentMap(pods, rootPodIds) {
  const parentOf = new Map();
  const visited = new Set(rootPodIds);
  const queue = [...rootPodIds];
  while (queue.length) {
    const id = queue.shift();
    const pod = pods.get(id);
    if (!pod) continue;
    for (const child of pod.childPods) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      parentOf.set(child.id, id);
      queue.push(child.id);
    }
  }
  return parentOf;
}
function ancestorChain(parentOf, targetPodId) {
  const chain = new Set([targetPodId]);
  let cur = targetPodId;
  while (parentOf.has(cur)) { cur = parentOf.get(cur); chain.add(cur); }
  return chain;
}

// Every pod that has children AND isn't on the spine from the tree's root(s)
// down to the focal person starts collapsed. A big family fully expanded
// doesn't fit a phone screen at any legible zoom (the actual bug this
// replaced — "fit everything" forced text down to unreadable size); this
// keeps the direct line + the focal person's own immediate family open by
// default and lets everything else be expanded on demand, same as how a
// paper family chart is usually drawn "solid line, dotted elsewhere".
function findSpinePodIds(pods, rootPodIds, activeId) {
  let targetId = null;
  for (const [id, pod] of pods) {
    if (!pod.placeholder && pod.members.includes(activeId)) { targetId = id; break; }
  }
  if (!targetId) return new Set();
  return ancestorChain(buildParentMap(pods, rootPodIds), targetId);
}
function computeDefaultCollapsed(pods, rootPodIds, activeId) {
  const spine = findSpinePodIds(pods, rootPodIds, activeId);
  const collapsed = new Set();
  for (const [id, pod] of pods) {
    if (!pod.placeholder && pod.childPods.length && !spine.has(id)) collapsed.add(id);
  }
  return collapsed;
}

/*
 * The "traditional" chart view — a DOM/CSS tree of rectangular cards, not the
 * canvas/WebGL bubbles the other views share. Built as a self-contained
 * sibling renderer (own pan/zoom, own click handling) so it can be swapped in
 * for BubbleTree wholesale when layout === 'chart' without touching anything
 * BubbleTree.jsx does for the organic/focus/lineage/time views.
 *
 * Real DOM text stays crisp at any zoom (unlike Pixi text, which needs
 * per-scale texture regeneration) — the main reason this exists as HTML
 * rather than more canvas drawing, plus it makes per-branch collapse and
 * "Add Father/Mother" placeholder buttons trivial (they're just elements).
 */
export default function ChartTree({ graph, activeId, onOpenPerson, onAddRelative }) {
  const [orientation, setOrientation] = useState('vertical');
  const [collapsed, setCollapsed] = useState(() => {
    const full = computeChartPods(graph, activeId, { collapsed: new Set(), orientation: 'vertical' });
    return computeDefaultCollapsed(full.pods, full.rootPodIds, activeId);
  });
  const [view, setView] = useState({ zoom: 0.85, panX: 0, panY: 0 });
  const viewportRef = useRef(null);
  const dragRef = useRef(null);
  const pointersRef = useRef(new Map()); // pointerId -> {x, y}, live touches only
  const pinchRef = useRef(null);

  const layout = useMemo(
    () => computeChartPods(graph, activeId, { collapsed, orientation }),
    [graph, activeId, collapsed, orientation],
  );

  const childrenByParent = useMemo(() => {
    const m = new Map();
    for (const c of layout.connectors) {
      if (!m.has(c.parentPodId)) m.set(c.parentPodId, []);
      m.get(c.parentPodId).push(c.childPodId);
    }
    return m;
  }, [layout.connectors]);

  const fitLayoutToView = useCallback((lay) => {
    const vp = viewportRef.current;
    if (!vp || !lay.pos.size) return;
    const rect = vp.getBoundingClientRect();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of lay.pos.values()) {
      minX = Math.min(minX, p.x - p.w / 2); maxX = Math.max(maxX, p.x + p.w / 2);
      minY = Math.min(minY, p.y - p.h / 2); maxY = Math.max(maxY, p.y + p.h / 2);
    }
    const boxW = Math.max(1, maxX - minX), boxH = Math.max(1, maxY - minY);
    const availW = Math.max(1, rect.width - FIT_PADDING * 2);
    const availH = Math.max(1, rect.height - FIT_PADDING * 2);
    const zoom = Math.min(MAX_ZOOM, Math.max(FIT_MIN_ZOOM, Math.min(availW / boxW, availH / boxH)));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    setView({ zoom, panX: rect.width / 2 - cx * zoom, panY: rect.height / 2 - cy * zoom });
  }, []);
  const fitToView = useCallback(() => fitLayoutToView(layout), [fitLayoutToView, layout]);

  // A whole family "fit to screen" forces text down to unreadable size on a
  // phone (the actual bug this replaced) — genealogy charts are meant to be
  // panned, not shown whole. So the default view instead centres the focal
  // person's own card at a fixed, legible zoom; "Fit" (fitToView, above)
  // stays available as an explicit, deliberate zoom-out overview action.
  const CENTER_ZOOM = 0.92;
  const centerOnActive = useCallback((lay) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    let target = null;
    for (const [id, pod] of lay.pods) {
      if (!pod.placeholder && pod.members.includes(activeId)) { target = id; break; }
    }
    const p = target ? lay.pos.get(target) : null;
    const cx = p ? p.x : 0, cy = p ? p.y : 0;
    setView({ zoom: CENTER_ZOOM, panX: rect.width / 2 - cx * CENTER_ZOOM, panY: rect.height / 2 - cy * CENTER_ZOOM });
  }, [activeId]);

  // Whenever the focal person (or orientation) changes, reset which branches
  // are collapsed back to the spine-only default AND re-centre on that
  // freshly-collapsed layout in the same pass — computed directly rather
  // than via the memoized `layout`, since state set here hasn't re-rendered
  // yet and reading it would still see the previous focal person's shape.
  // Collapsing/expanding a single branch by hand deliberately does NOT
  // re-centre or reset its siblings — that would yank the view out from
  // under someone who just wanted to peek at one branch.
  useEffect(() => {
    const full = computeChartPods(graph, activeId, { collapsed: new Set(), orientation });
    const nextCollapsed = computeDefaultCollapsed(full.pods, full.rootPodIds, activeId);
    setCollapsed(nextCollapsed);
    centerOnActive(computeChartPods(graph, activeId, { collapsed: nextCollapsed, orientation }));
    // Intentionally NOT keyed on `graph` — an edit anywhere else in the tree
    // (a bio tweak, a synced update) shouldn't discard the collapse choices
    // someone already made in this view. Reads the latest `graph` from
    // closure regardless; only re-fires on a focal-person or orientation change.
  }, [activeId, orientation]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onResize = () => fitToView();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fitToView]);

  const zoomBy = (factor, anchor) => {
    setView((v) => {
      const vp = viewportRef.current;
      const rect = vp?.getBoundingClientRect();
      const ax = anchor?.x ?? (rect ? rect.width / 2 : 0);
      const ay = anchor?.y ?? (rect ? rect.height / 2 : 0);
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      const ratio = nextZoom / v.zoom;
      return {
        zoom: nextZoom,
        panX: ax - (ax - v.panX) * ratio,
        panY: ay - (ay - v.panY) * ratio,
      };
    });
  };

  const onWheel = (e) => {
    e.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    const anchor = rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : null;
    zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08, anchor);
  };

  // Anchors the pinch on whatever world point sits under the fingers' START
  // midpoint, then keeps solving for the pan that keeps that same world
  // point under the CURRENT midpoint every move — one formula covers zoom
  // (the distance ratio) and a two-finger drag (the midpoint moving) at
  // once, rather than treating them as separate gestures.
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
    // Only the FIRST finger gets excluded for landing on a card/control —
    // once a gesture is already in progress, a second finger completing a
    // pinch must register no matter what it happens to land on, or pinching
    // near any card (common in a dense chart) would silently only track one
    // finger and never zoom.
    if (pointersRef.current.size === 0 && (e.target.closest('.chart-card') || e.target.closest('.chart-controls'))) return;
    // Capture can reject a pointer the browser doesn't consider active (seen
    // from embedded webviews/synthetic input) — losing capture only means an
    // in-progress drag can end early if the finger leaves the element, not a
    // functional break, so it's not worth failing the whole gesture over.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
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
    // One finger still down after lifting the other — resume a plain pan
    // from here instead of stopping dead until a fresh gesture starts.
    dragRef.current = remaining.length === 1
      ? { startX: remaining[0].x, startY: remaining[0].y, panX: view.panX, panY: view.panY }
      : null;
  };

  // Opening a branch closes whichever other branch was open — same idea as
  // a paper chart's arrows: only one line is ever expanded outside the
  // direct spine, so the chart never sprawls into a messy everything-open
  // tangle. Closing a branch is a plain toggle-off; opening one rebuilds
  // the collapse set from the default (spine only) plus this pod's own
  // ancestor chain, so every OTHER branch folds back at the same time.
  const toggleCollapse = (podId) => {
    setCollapsed((prev) => {
      if (!prev.has(podId)) {
        const next = new Set(prev);
        next.add(podId);
        return next;
      }
      const parentOf = buildParentMap(layout.pods, layout.rootPodIds);
      const spine = findSpinePodIds(layout.pods, layout.rootPodIds, activeId);
      const keepOpen = ancestorChain(parentOf, podId);
      const next = new Set();
      for (const [id, pod] of layout.pods) {
        if (pod.placeholder) continue;
        if (pod.childPods.length && !spine.has(id) && !keepOpen.has(id)) next.add(id);
      }
      return next;
    });
  };

  const cards = [];
  for (const [id, p] of layout.pos) {
    const pod = layout.pods.get(id);
    if (!pod) continue;
    if (pod.placeholder) {
      cards.push(
        <button
          key={id}
          className="chart-card chart-card--placeholder"
          style={{ left: p.x - p.w / 2, top: p.y - p.h / 2, width: p.w, height: p.h }}
          onClick={() => onAddRelative?.(pod.forPersonId)}
        >
          <PlusIcon />
          <span>Add {pod.slot === 'father' ? 'Father' : pod.slot === 'mother' ? 'Mother' : 'Parents'}</span>
        </button>,
      );
      continue;
    }
    const hasKids = pod.childPods.length > 0;
    const isCollapsed = collapsed.has(id);
    cards.push(
      <div
        key={id}
        className={'chart-card' + (activeId && pod.members.includes(activeId) ? ' chart-card--active' : '')}
        style={{ left: p.x - p.w / 2, top: p.y - p.h / 2, width: p.w, height: p.h }}
      >
        {pod.members.map((personId) => {
          const person = graph.byId.get(personId);
          if (!person) return null;
          // Age is withheld for minors — same privacy guard HoverCard/PersonSheet
          // apply, since a birth year is far less identifying than a live age.
          const age = !person.is_minor || person.is_deceased ? ageOrAt(person) : null;
          const dates = age ? `${lifespan(person)} · ${person.is_deceased ? age : `age ${age}`}` : lifespan(person);
          return (
            <button key={personId} className="chart-card__row" onClick={() => onOpenPerson?.(personId)}>
              <Avatar person={person} size={32} />
              <span className="chart-card__row-text">
                <span className="chart-card__name">{person.display_name}</span>
                <span className="chart-card__dates">{dates}</span>
              </span>
            </button>
          );
        })}
        {hasKids && (
          <button
            className="chart-card__collapse"
            onClick={() => toggleCollapse(id)}
            title={isCollapsed ? 'Show children' : 'Hide children'}
          >
            {isCollapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
            <span>{pod.childPods.length} {pod.childPods.length === 1 ? 'child' : 'children'}</span>
          </button>
        )}
      </div>,
    );
  }

  const lines = [];
  for (const [parentId, kidIds] of childrenByParent) {
    const parentPos = layout.pos.get(parentId);
    if (!parentPos) continue;
    const kidPositions = kidIds.map((k) => layout.pos.get(k)).filter(Boolean);
    if (!kidPositions.length) continue;
    if (orientation === 'horizontal') {
      const px = parentPos.x + parentPos.w / 2;
      const py = parentPos.y;
      const trunkX = px + (kidPositions[0].x - px) * 0.5;
      const minY = Math.min(py, ...kidPositions.map((k) => k.y));
      const maxY = Math.max(py, ...kidPositions.map((k) => k.y));
      lines.push(<line key={`${parentId}-h1`} x1={px} y1={py} x2={trunkX} y2={py} className="chart-link" />);
      if (kidPositions.length > 1 || Math.abs(kidPositions[0].y - py) > 1) {
        lines.push(<line key={`${parentId}-h2`} x1={trunkX} y1={minY} x2={trunkX} y2={maxY} className="chart-link" />);
      }
      kidPositions.forEach((k, i) => {
        lines.push(<line key={`${parentId}-h3-${i}`} x1={trunkX} y1={k.y} x2={k.x - k.w / 2} y2={k.y} className="chart-link" />);
      });
    } else {
      const px = parentPos.x;
      const py = parentPos.y + parentPos.h / 2;
      const trunkY = py + (kidPositions[0].y - py) * 0.5;
      const minX = Math.min(px, ...kidPositions.map((k) => k.x));
      const maxX = Math.max(px, ...kidPositions.map((k) => k.x));
      lines.push(<line key={`${parentId}-v1`} x1={px} y1={py} x2={px} y2={trunkY} className="chart-link" />);
      if (kidPositions.length > 1 || Math.abs(kidPositions[0].x - px) > 1) {
        lines.push(<line key={`${parentId}-v2`} x1={minX} y1={trunkY} x2={maxX} y2={trunkY} className="chart-link" />);
      }
      kidPositions.forEach((k, i) => {
        lines.push(<line key={`${parentId}-v3-${i}`} x1={k.x} y1={trunkY} x2={k.x} y2={k.y - k.h / 2} className="chart-link" />);
      });
    }
  }

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
          className="chart-tree__world"
          style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}
        >
          <svg className="chart-tree__lines" width="1" height="1" style={{ overflow: 'visible' }}>
            {lines}
          </svg>
          {cards}
        </div>
      </div>

      <div className="chart-controls">
        <div className="chart-controls__seg" role="group" aria-label="Chart orientation">
          <button
            className={'chart-controls__btn' + (orientation === 'vertical' ? ' chart-controls__btn--on' : '')}
            onClick={() => setOrientation('vertical')}
            title="Vertical layout"
            aria-pressed={orientation === 'vertical'}
          >
            <LayoutVerticalIcon />
          </button>
          <button
            className={'chart-controls__btn' + (orientation === 'horizontal' ? ' chart-controls__btn--on' : '')}
            onClick={() => setOrientation('horizontal')}
            title="Horizontal layout"
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

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 9l7 7 7-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ChevronRightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
function MinusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
function FitIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 4H5a1 1 0 00-1 1v4M15 4h4a1 1 0 011 1v4M9 20H5a1 1 0 01-1-1v-4M15 20h4a1 1 0 001-1v-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function LayoutVerticalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <rect x="4" y="17" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <rect x="14" y="17" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7v5M12 12H7v5M12 12h5v5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function LayoutHorizontalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="9" width="4" height="6" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <rect x="17" y="4" width="4" height="6" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <rect x="17" y="14" width="4" height="6" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 12h5M12 12V7h5M12 12v5h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

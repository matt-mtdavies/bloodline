/*
 * The Focus Layer — the arrival.
 *
 * Two layers, with different jobs. The CONTEXT layer is the whole tree drawn
 * once to a canvas: dim, small, blurred, and under no obligation to be legible.
 * Its only purpose is to be the place you came from. The FOCUS layer is one
 * person's family, planned by focusLayout.js, drawn as real DOM at real size
 * with real names — that layer is the product.
 *
 * WHY CSS TRANSITIONS AND NOT A SIMULATION
 * This whole feature exists because a force simulation could not hold the
 * arrangement still. So the motion here is declarative: every element's resting
 * state is a transform, and going between two states is a transition. When the
 * transition ends the element is at EXACTLY its planned coordinate and the
 * compositor stops — drift at rest is 0.000 px/frame by construction, not by
 * tuning. There is no rAF loop in this file at all.
 *
 * THE FOUR STAGES (all overlapping; ~1.4s end to end)
 *   1. descent      the tree recedes — scales down, desaturates, blurs, dims,
 *                   while the selected family holds its colour.
 *   2. lift         the family travels from where it genuinely was in the tree
 *                   to where the planner says it belongs, each person on their
 *                   own arc, staggered outward from the selected person.
 *   3. settle       a spring, not an ease — a spring has a moment of arriving.
 *   4. connection   the lines draw themselves outward, ring by ring: partner,
 *                   children, siblings, parents, grandparents, and the former
 *                   partner's tie last of all.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { planFocusView, RADIUS } from './focusLayout.js';
import { planContext } from './contextLayout.js';
import { monogramColors, initials } from '../../lib/color.js';

/** Base box the disc is drawn at; every disc is a scale of this, so size
 *  changes ride the compositor instead of triggering layout. */
const DISC = 200;
/** Milliseconds between one choreography ring and the next. */
const STAGGER = 78;
const TRAVEL_MS = 820;
const LEAVE_MS = 560;

const prefersReducedMotion = () =>
  typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* ── The context layer ─────────────────────────────────────────────────── */

function ContextCanvas({ graph, layout, camera, dimmed, onPick }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !layout.bounds) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Faint connective texture first, so bubbles sit on top of it.
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(138, 125, 107, 0.30)';
    ctx.beginPath();
    for (const r of graph.relationships) {
      const a = layout.positions.get(r.from_person);
      const b = layout.positions.get(r.to_person);
      if (!a || !b) continue;
      ctx.moveTo(camera.x(a.x), camera.y(a.y));
      ctx.lineTo(camera.x(b.x), camera.y(b.y));
    }
    ctx.stroke();

    for (const p of graph.people) {
      const pos = layout.positions.get(p.id);
      if (!pos) continue;
      const { base } = monogramColors(p.display_name);
      ctx.beginPath();
      ctx.arc(camera.x(pos.x), camera.y(pos.y), camera.r, 0, Math.PI * 2);
      ctx.fillStyle = base;
      ctx.fill();
    }
  }, [graph, layout, camera]);

  const pick = (e) => {
    if (!onPick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    let best = null, bestD = Infinity;
    for (const p of graph.people) {
      const pos = layout.positions.get(p.id);
      if (!pos) continue;
      const d = Math.hypot(camera.x(pos.x) - px, camera.y(pos.y) - py);
      if (d < bestD) { bestD = d; best = p.id; }
    }
    if (best && bestD < Math.max(18, camera.r * 3)) onPick(best);
  };

  return (
    <canvas
      ref={ref}
      className={`fx-context${dimmed ? ' is-receded' : ''}`}
      onClick={pick}
      aria-hidden="true"
    />
  );
}

/* ── One person in the focus layer ─────────────────────────────────────── */

function FocusNode({ node, at, shown, leaving, onSelect }) {
  const [broken, setBroken] = useState(false);
  const { base, light } = monogramColors(node.person?.display_name || node.id);
  const photo = node.person?.photo && !broken ? node.person.photo : null;
  const delay = (leaving ? (5 - node.ring) : node.ring) * STAGGER;

  return (
    <div
      className={`fx-node fx-node--${node.role}${shown ? ' is-there' : ''}${leaving ? ' is-leaving' : ''}`}
      style={{
        transform: `translate3d(${at.x}px, ${at.y}px, 0)`,
        transitionDelay: `${delay}ms`,
      }}
    >
      <button
        type="button"
        className="fx-node__disc"
        style={{
          transform: `translate(-50%, -50%) scale(${at.s})`,
          transitionDelay: `${delay}ms`,
          '--tint': base,
          '--tint-light': light,
        }}
        onClick={() => onSelect?.(node.id)}
        aria-label={`${node.person?.display_name || node.id} — ${node.label}`}
      >
        <span className="fx-node__ring" aria-hidden="true" />
        {photo
          ? <img className="fx-node__photo" src={photo} alt="" onError={() => setBroken(true)} />
          : <span className="fx-node__initials" aria-hidden="true">{initials(node.person?.display_name)}</span>}
      </button>
      <span
        className="fx-node__plate"
        style={{
          transform: `translate(-50%, ${at.plate}px)`,
          transitionDelay: `${delay + 380}ms`,
          '--plate-w': `${at.plateW}px`,
        }}
      >
        <span className="fx-node__name">{node.person?.display_name || node.id}</span>
        <span className="fx-node__kin">{node.label}</span>
      </span>
    </div>
  );
}

/* ── The connective tissue ─────────────────────────────────────────────── */

/** A descent: trunk down from the union, a junction, then a fan to each child.
 *  Exactly the model links.js already uses on the main canvas, so the focus
 *  layer speaks the same visual language rather than inventing a second one. */
function descentPath(from, junctionX, child, camera) {
  const x0 = camera.x(from.x), y0 = camera.y(from.y);
  const jy = camera.y(from.y + (child.y - from.y) * 0.62);
  const jx = camera.x(junctionX);
  const x1 = camera.x(child.x), y1 = camera.y(child.y - child.r);
  return `M ${x0} ${y0} C ${x0} ${(y0 + jy) / 2}, ${jx} ${(y0 + jy) / 2}, ${jx} ${jy}`
    + ` C ${jx} ${(jy + y1) / 2}, ${x1} ${(jy + y1) / 2}, ${x1} ${y1}`;
}

function Lines({ plan, camera, shown }) {
  const paths = [];
  for (const b of plan.bundles) {
    for (const child of b.to) {
      paths.push({
        key: `d:${child.id}`,
        d: descentPath(b.from, b.junctionX, child, camera),
        cls: `fx-line fx-line--descent${child.qualifier && child.qualifier !== 'biological' ? ' fx-line--dashed' : ''}`,
        ring: b.ring,
      });
    }
  }
  for (const t of plan.ties) {
    const ax = camera.x(t.a.x), ay = camera.y(t.a.y);
    const bx = camera.x(t.b.x), by = camera.y(t.b.y);
    // A partner tie bows very slightly, so a couple reads as a bond rather
    // than a ruler line between two circles.
    const mx = (ax + bx) / 2, my = (ay + by) / 2 + (t.kind === 'former' ? -14 : 10);
    paths.push({
      key: `t:${t.a.id}:${t.b.id}`,
      d: `M ${ax} ${ay} Q ${mx} ${my} ${bx} ${by}`,
      cls: `fx-line fx-line--${t.kind}`,
      ring: t.ring,
    });
  }
  return (
    <svg className="fx-lines" aria-hidden="true">
      {paths.map((p) => (
        <path
          key={p.key}
          className={`${p.cls}${shown ? ' is-drawn' : ''}`}
          d={p.d}
          pathLength="1"
          style={{ transitionDelay: `${340 + p.ring * 92}ms` }}
        />
      ))}
    </svg>
  );
}

/* ── The stage ─────────────────────────────────────────────────────────── */

export default function FocusStage({ graph, personId, onSelect, onExit, insetTop = 0 }) {
  const hostRef = useRef(null);
  const [size, setSize] = useState({ width: 1200, height: 800 });
  const [shown, setShown] = useState(false);
  const [leaving, setLeaving] = useState([]);
  /* ── Getting around ──────────────────────────────────────────────────────
   * `view` is the user's own adjustment on top of the planned camera:
   * a translation in screen pixels and a multiplier on the plan's zoom.
   * Identity ({0,0,1}) is exactly what the planner chose.
   *
   * The legibility floor (MIN_DIAMETER) governs the DEFAULT, not what the
   * reader is allowed to do. Before this, a family too wide to fit could only
   * be shoved around — there was no way to pull back and see it whole, which
   * made a phone feel like looking through a letterbox.
   */
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [dragging, setDragging] = useState(false);
  const gesture = useRef(null);
  const pointers = useRef(new Map());
  const panned = useRef(false);
  const lastPlaces = useRef(new Map()); // id → {x,y,s,plate}, where each node last rested
  const reduced = useMemo(prefersReducedMotion, []);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({ width: Math.round(r.width), height: Math.round(r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* The context layer's own camera: fit the whole tree, once. */
  const context = useMemo(() => planContext(graph), [graph]);
  const ctxCamera = useMemo(() => {
    const b = context.bounds;
    if (!b) return { x: () => 0, y: () => 0, r: 3, zoom: 1 };
    const pad = 40;
    const zoom = Math.min(
      (size.width - pad * 2) / b.width,
      (size.height - pad * 2 - insetTop) / b.height,
      1,
    );
    const cx = size.width / 2, cy = (size.height + insetTop) / 2;
    const mx = (b.minX + b.maxX) / 2, my = (b.minY + b.maxY) / 2;
    return {
      zoom,
      r: Math.max(2.2, 13 * zoom),
      x: (wx) => cx + (wx - mx) * zoom,
      y: (wy) => cy + (wy - my) * zoom,
    };
  }, [context, size, insetTop]);

  /* The focus layer's own camera: the selected person is the fixed point. */
  const plan = useMemo(() => {
    if (!personId || !graph.byId.has(personId)) return null;
    return planFocusView({
      graph,
      personId,
      viewport: { width: size.width, height: size.height - insetTop },
    });
  }, [graph, personId, size, insetTop]);

  const focusCamera = useMemo(() => {
    if (!plan?.bounds) return null;
    const z = plan.zoom;
    // When the whole family fits, centre its bounding box — a lopsided family
    // shouldn't leave half the screen empty. When it does NOT fit and the view
    // is pannable, centre the SELECTED PERSON instead (they are world origin):
    // opening a pannable view on the box centre can put the person you just
    // chose near an edge, which is the one thing this layer must never do.
    const mx = plan.pannable ? 0 : (plan.bounds.minX + plan.bounds.maxX) / 2;
    const my = plan.pannable ? 0 : (plan.bounds.minY + plan.bounds.maxY) / 2;
    const cx = size.width / 2, cy = (size.height + insetTop) / 2;
    return { zoom: z, x: (wx) => cx + (wx - mx) * z, y: (wy) => cy + (wy - my) * z };
  }, [plan, size, insetTop]);

  /** Where a person sits in the CONTEXT layer, in the focus layer's own
   *  coordinate space — this is what makes the lift start from somewhere real
   *  instead of from nowhere. */
  const seedOf = (id) => {
    const pos = context.positions.get(id);
    const s = (ctxCamera.r * 2) / DISC;
    const common = { s, plate: 0, plateW: 180 };
    if (!pos) return { x: size.width / 2, y: size.height / 2, ...common };
    return { x: ctxCamera.x(pos.x), y: ctxCamera.y(pos.y), ...common };
  };

  const restOf = (node) => ({
    x: focusCamera.x(node.x),
    y: focusCamera.y(node.y),
    s: (node.r * 2 * focusCamera.zoom) / DISC,
    plate: node.r * focusCamera.zoom + 16,
    // A label may never grow wider than the gap the planner reserved for it
    // (MIN_NEIGHBOUR), which is what makes truncation, not collision, the
    // worst case on a crowded row.
    plateW: Math.round(node.r * 2 * focusCamera.zoom * 1.95),
  });

  /* Seed for one frame, then bloom. A node that was already resting somewhere
   * seeds AT that resting place, so re-selecting never snaps anybody back to
   * the context layer and re-flies them — they simply travel. */
  useEffect(() => {
    if (!plan) { setShown(false); return undefined; }
    if (reduced) { setShown(true); return undefined; }
    setShown(false);
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setShown(true)); });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [plan, reduced]);

  /* Anyone who was in focus and no longer is descends back into the tree. */
  const prevIds = useRef([]);
  useEffect(() => {
    const now = plan ? plan.nodes : [];
    const nowIds = new Set(now.map((n) => n.id));
    const gone = prevIds.current.filter((n) => !nowIds.has(n.id));
    prevIds.current = now.map((n) => ({ id: n.id, node: n }));
    if (!gone.length) return undefined;
    setLeaving(gone);
    const t = setTimeout(() => setLeaving([]), LEAVE_MS + 400);
    return () => clearTimeout(t);
  }, [plan]);

  // Remember where everyone came to rest, for the next selection's seed.
  useEffect(() => {
    if (!plan || !focusCamera) return;
    for (const n of plan.nodes) lastPlaces.current.set(n.id, restOf(n));
  });

  // A new selection re-frames from scratch; a stale pan or zoom would put the
  // person you just chose off-centre, or off-screen entirely.
  useEffect(() => { setView({ x: 0, y: 0, k: 1 }); }, [personId]);

  const inFocus = !!plan;

  /* How far out the reader may pull back: far enough to see the whole family
   * with a little air, whatever the planner decided. `fitK` < 1 exactly when
   * the plan is pannable, so on a family that already fits this is a no-op. */
  const fitK = plan?.zoom ? Math.min(1, (plan.fitZoom / plan.zoom) * 0.94) : 1;
  const minK = Math.min(1, fitK);
  const maxK = 2.2;
  const clampK = (k) => Math.min(maxK, Math.max(minK, k));

  /* Keep the family reachable. On an axis where the family is bigger than the
   * screen the reader may move it freely, but never so far that nothing is
   * left in view. On an axis where it now FITS — which is exactly what pinching
   * out is for — it snaps to centred, so pulling back lands on a properly
   * framed view instead of a correctly-sized one drifting off in a corner. */
  const clampPan = (next, k) => {
    if (!plan?.bounds || !focusCamera) return { ...next, k };
    const b = plan.bounds;
    const keep = 120; // this much of the family always stays in view
    const axis = (lo, hi, want, extent) => {
      const span = hi - lo;
      if (span <= extent) return (extent - span) / 2 - lo;
      return Math.min(extent - keep - lo, Math.max(keep - hi, want));
    };
    return {
      x: axis(focusCamera.x(b.minX) * k, focusCamera.x(b.maxX) * k, next.x, size.width),
      y: axis(focusCamera.y(b.minY) * k, focusCamera.y(b.maxY) * k, next.y, size.height),
      k,
    };
  };

  /** Zoom about a fixed screen point, so what is under the fingers stays put. */
  const zoomAbout = (nextK, ax, ay) => setView((v) => {
    const k = clampK(nextK);
    const ratio = k / v.k;
    return clampPan({ x: ax - (ax - v.x) * ratio, y: ay - (ay - v.y) * ratio }, k);
  });

  /* Pointer capture is taken LAZILY, only once a drag genuinely starts moving.
   * Capturing on pointerdown retargets the subsequent `click` to the capturing
   * element — which silently broke both tapping a person and the Re-centre
   * button, since their clicks were delivered to the stage instead. A tap now
   * never captures at all, so clicks land where they were aimed; a real drag
   * captures the moment it becomes a drag, and keeps tracking off-element. */
  const capture = (pointerId) => {
    try { hostRef.current?.setPointerCapture?.(pointerId); } catch { /* already gone */ }
  };

  const localPoint = (e) => {
    const r = hostRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const onPointerDown = (e) => {
    if (!inFocus || e.button === 2) return;
    if (e.target?.closest?.('.fx-reframe')) return; // a control, not the canvas
    const p = localPoint(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) {
      gesture.current = { kind: 'pan', ox: p.x - view.x, oy: p.y - view.y, moved: false };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        kind: 'pinch',
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        k0: view.k,
        moved: true, // a pinch is never also a tap
      };
      capture(e.pointerId);
    }
    setDragging(true);
  };

  const onPointerMove = (e) => {
    if (!gesture.current || !pointers.current.has(e.pointerId)) return;
    const p = localPoint(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (g.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      zoomAbout(g.k0 * (dist / g.dist), (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (g.kind !== 'pan') return;
    const next = { x: p.x - g.ox, y: p.y - g.oy };
    if (!g.moved && Math.abs(next.x - view.x) + Math.abs(next.y - view.y) > 3) {
      g.moved = true;
      capture(e.pointerId);
    }
    if (!g.moved) return; // still inside the tap slop — do not nudge anything
    setView((v) => clampPan(next, v.k));
  };

  const endGesture = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) return; // still pinching with the other finger
    // A drag or pinch that actually moved must not also register as a tap, or
    // looking around a large family would select somebody, or drop you out.
    panned.current = !!gesture.current?.moved;
    gesture.current = null;
    setDragging(false);
  };

  const onWheel = (e) => {
    if (!inFocus) return;
    const p = localPoint(e);
    zoomAbout(view.k * Math.exp(-e.deltaY * 0.0016), p.x, p.y);
  };

  // Tapping a person while looking around must not fire on the release of a
  // drag — the same guard the backdrop already uses.
  const selectIfTap = (id) => {
    if (panned.current) { panned.current = false; return; }
    onSelect?.(id);
  };

  const framed = Math.abs(view.x) < 0.5 && Math.abs(view.y) < 0.5 && Math.abs(view.k - 1) < 0.005;
  const reframe = () => setView({ x: 0, y: 0, k: 1 });

  return (
    <div
      ref={hostRef}
      className={`fx-stage${inFocus ? ' is-focused' : ''}${reduced ? ' is-still' : ''}`
        + `${inFocus ? ' can-move' : ''}${dragging ? ' is-dragging' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onWheel={onWheel}
    >
      <ContextCanvas
        graph={graph}
        layout={context}
        camera={ctxCamera}
        dimmed={inFocus}
        onPick={inFocus ? null : onSelect}
      />

      {inFocus && !framed && (
        <button type="button" className="fx-reframe" onClick={reframe}>
          Re-centre
        </button>
      )}

      {inFocus && (
        <div
          className="fx-veil"
          onClick={() => { if (!panned.current) onExit?.(); panned.current = false; }}
          role="presentation"
        />
      )}

      {inFocus && focusCamera && (
        <div
          className="fx-pan"
          style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.k})` }}
        >
          <Lines plan={plan} camera={focusCamera} shown={shown} />
          <div className="fx-nodes">
            {plan.nodes.map((n) => {
              const rest = restOf(n);
              const seed = lastPlaces.current.get(n.id) || seedOf(n.id);
              return (
                <FocusNode
                  key={n.id}
                  node={n}
                  at={shown ? rest : seed}
                  shown={shown}
                  leaving={false}
                  onSelect={selectIfTap}
                />
              );
            })}
            {leaving.map(({ id, node }) => (
              <FocusNode
                key={`leaving:${id}`}
                node={node}
                at={seedOf(id)}
                shown={false}
                leaving
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export { DISC, RADIUS };

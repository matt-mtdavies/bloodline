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
  // Panning exists for the case the planner refuses to solve by shrinking: a
  // family too wide to fit at MIN_DIAMETER. It is a drag on the focus layer
  // only — the context layer behind never moves, so the sense of one thing
  // lifted above another is preserved while you look around.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragFrom = useRef(null);
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

  // A new selection re-frames from scratch; a stale pan would put the person
  // you just chose off-centre.
  useEffect(() => { setPan({ x: 0, y: 0 }); }, [personId]);

  const inFocus = !!plan;
  const canPan = !!plan?.pannable;

  const onPointerDown = (e) => {
    if (!canPan || e.button === 2) return;
    dragFrom.current = { x: e.clientX - pan.x, y: e.clientY - pan.y, moved: false };
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragFrom.current) return;
    const next = { x: e.clientX - dragFrom.current.x, y: e.clientY - dragFrom.current.y };
    if (Math.abs(next.x - pan.x) + Math.abs(next.y - pan.y) > 2) dragFrom.current.moved = true;
    setPan(next);
  };
  const endDrag = () => {
    // A drag that actually moved must not also register as a backdrop click,
    // or looking around a large family would drop you out of it.
    panned.current = !!dragFrom.current?.moved;
    dragFrom.current = null;
    setDragging(false);
  };

  return (
    <div
      ref={hostRef}
      className={`fx-stage${inFocus ? ' is-focused' : ''}${reduced ? ' is-still' : ''}`
        + `${canPan ? ' can-pan' : ''}${dragging ? ' is-dragging' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <ContextCanvas
        graph={graph}
        layout={context}
        camera={ctxCamera}
        dimmed={inFocus}
        onPick={inFocus ? null : onSelect}
      />

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
          style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0)` }}
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
                  onSelect={onSelect}
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

/*
 * Atlas — the stage.
 *
 * The whole family as one world, treated like a map. The layout (layout.js)
 * is computed once and never changes; the camera is the only thing that
 * moves. Zoom out and the family is a shape — generation bands, a silhouette
 * of four centuries; zoom in and faces surface. Selecting a person is a
 * flight, never a re-plan, so nothing ever rearranges under you.
 *
 * Reuses Canopy's renderer wholesale — its pods, tapered descent ribbons,
 * portraits, springs, breathing and elastic pull — because that motion layer
 * was always the asset. Only the planner was the keyhole.
 *
 * Level of detail is what makes 1,200 people affordable: no simulation runs,
 * bonds are drawn ONCE into a static layer, portraits load lazily only once
 * you're close enough to see them, names appear only once they'd be legible,
 * and off-screen nodes are simply not updated.
 */

import { useEffect, useRef } from 'react';
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { planAtlas, isFarReach, NODE_R, ROW_GAP } from './layout.js';
import { Scalar, ambientOffset, Deflection, rubberBand, SWAY_POD, SWAY_BRANCH } from '../canopy/motion.js';
import { drawBonds, CanopyNode, easeBud, progressAt, tintFor } from '../canopy/render.js';
import { ancestorsWithDistance, descendantsWithDistance } from '../../data/graph.js';

const TAP_SLOP = 8;
const MIN_DOT_PX = 3.4;          // a person never shrinks below a visible dot
const NAME_ZOOM = 0.44;          // names appear once they'd be legible
const SUB_ZOOM = 0.82;           // dates a little later
const PHOTO_ZOOM = 0.30;         // portraits load once you're this close
const DOT_ZOOM = 0.16;           // below this a person is a dot: one flat layer, not 1,200 portrait containers
const ERA_ZOOM = 0.62;           // era labels fade out as faces take over
const FLY_ZOOM = 0.9;
const ERA_MARGIN_PX = 110;       // screen pixels reserved for the era axis at the fit zoom
const BRANCH = 0x8a7563;
const GOLD = 0xb0802f;
const INK_SOFT = 0x6b6259;
const FULLY_GROWN = { bonds: new Map(), nodes: new Map(), reduced: false };

function yearOf(s) {
  const m = String(s || '').match(/\d{4}/);
  return m ? Number(m[0]) : null;
}

export default function AtlasStage({ graph, focusId, year = null, onSelect, onOpen, onLayout, apiRef, reducedMotion = false }) {
  const hostRef = useRef(null);
  const graphRef = useRef(graph); graphRef.current = graph;
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  const onOpenRef = useRef(onOpen); onOpenRef.current = onOpen;
  const onLayoutRef = useRef(onLayout); onLayoutRef.current = onLayout;
  const yearRef = useRef(year); yearRef.current = year;
  const innerApi = useRef(null);

  useEffect(() => {
    let alive = true;
    const host = hostRef.current;
    const app = new Application();

    (async () => {
      try {
        await app.init({ antialias: true, backgroundAlpha: 0, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true, resizeTo: host, preference: 'webgl' });
      } catch { return; }
      if (!alive) { app.destroy(true); return; }
      host.appendChild(app.canvas);

      const world = new Container();
      const bgLayer = new Graphics();
      const farBonds = new Graphics();
      const longBonds = new Graphics();    // descents spanning several rows — faint, honest
      const lateralBonds = new Graphics(); // ex-partners and extra partners — only up close
      const reachStubs = new Graphics();   // the leads of reaches that leave the screen
      const nearBonds = new Graphics();    // pods and one-row descents — Canopy's ribbons
      const dotLayer = new Graphics();     // everyone as a dot, for the far view
      const nodeLayer = new Container();
      const eraLayer = new Container();
      world.addChild(bgLayer, farBonds, reachStubs, longBonds, lateralBonds, nearBonds, dotLayer, nodeLayer, eraLayer);
      app.stage.addChild(world);
      app.stage.eventMode = 'static';
      app.stage.hitArea = { contains: () => true };

      let frame = null;
      let fitZoom = 0.05;
      let currentFocus = null;
      let lineage = null;          // Set of ids lit when someone is selected
      let clock = 0;               // ms since the current world was born
      let schedule = new Map();    // id -> { delay, dur } entrance
      const nodes = new Map();     // id -> CanopyNode
      const eras = [];
      const defl = new Map();
      const deflOf = (id) => defl.get(id)?.value;
      const deflFor = (id) => { let d = defl.get(id); if (!d) { d = new Deflection(); defl.set(id, d); } return d; };

      const zoom = new Scalar(0.05, 1.1);
      const anchorX = new Scalar(0, 1.15);
      const anchorY = new Scalar(0, 1.15);

      const eraStyle = new TextStyle({ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 15, fontWeight: '600', fill: GOLD, align: 'right', letterSpacing: 1 });
      const eraSubStyle = new TextStyle({ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 11, fill: INK_SOFT, align: 'right' });

      /* ── build the world ─────────────────────────────────────────────── */
      const build = () => {
        const g = graphRef.current;
        frame = planAtlas(g);
        for (const [, n] of nodes) n.destroy();
        nodes.clear();
        nodeLayer.removeChildren();
        for (const [id, node] of frame.nodes) {
          const person = g.byId.get(id);
          if (!person) continue;
          // Portraits are deferred: the node is born as a monogram and only
          // asks for its photo once the camera is close enough to see it.
          const cn = new CanopyNode({ ...person, photo: null }, node);
          cn.pendingPhoto = person.photo || null;
          cn.person = person;
          nodes.set(id, cn);
          nodeLayer.addChild(cn.root);
        }
        // Static bonds: drawn once. Nothing about them changes until a drag.
        splitBonds();
        drawAllBonds(null);
        drawFar();
        drawEras();
        scheduleEntrance(null);
        onLayoutRef.current?.(frame.stats, frame);
      };

      const unitById = () => new Map(frame.units.map((u) => [u.id, u]));

      // Bonds are split by what they mean at scale. A pod and a child hanging
      // one row beneath its parents are the family's own shape and stay full
      // strength. A descent spanning several rows (a partner levelled down
      // to a spouse's deeper generation) is true but would read as a rope
      // through the whole picture — kept, faint. A lateral link (an ex, an
      // extra partner) is only useful up close, where it is a short dashed
      // thread between two people you can see — from orbit it is a slash
      // across strangers, so it fades out entirely.
      let nearFrame = null, longFrame = null, lateralFrame = null;
      const splitBonds = () => {
        const byId = unitById();
        const near = [], long = [], lateral = [];
        for (const b of frame.bonds) {
          if (b.kind === 'descent') {
            const pu = byId.get(b.parentUnit), c = frame.nodes.get(b.child);
            const a = pu ? anchorOf(pu) : null;
            // Several rows down, or a long reach across the row (a spouse's
            // own parents standing far away): true, kept, but faint.
            (a && c && isFarReach(c.x - a.x, c.y - a.y) ? long : near).push(b);
          } else if (b.kind === 'thread') {
            lateral.push(b);
          } else {
            const p = frame.nodes.get(b.a), q = frame.nodes.get(b.b);
            (p && q && Math.hypot(q.x - p.x, q.y - p.y) > 400 ? lateral : near).push(b);
          }
        }
        nearFrame = { ...frame, bonds: near };
        longFrame = { ...frame, bonds: long };
        lateralFrame = { ...frame, bonds: lateral };
      };
      /* A far-reaching link — a descent to a child standing under their
       * other parent thousands of pixels away, an ex three families over —
       * is never drawn end to end up close. On a map you don't draw the
       * whole road to the next city; you draw the road LEAVING town. Each
       * end gets a short dashed lead that sets off in the true direction of
       * the other end and fades, so the fact of the connection is honest and
       * findable (follow it, and the camera will get you there) without a
       * rope crossing everyone in between. The full curve only exists in the
       * far silhouette, where it is one hairline among the veins. */
      const STUB_FRAC = 0.2;
      const curvePts = (p0, p1, p2, p3, n = 36) => {
        const pts = [];
        for (let i = 0; i <= n; i++) {
          const t = i / n, s = 1 - t;
          pts.push({
            x: s * s * s * p0.x + 3 * s * s * t * p1.x + 3 * s * t * t * p2.x + t * t * t * p3.x,
            y: s * s * s * p0.y + 3 * s * s * t * p1.y + 3 * s * t * t * p2.y + t * t * t * p3.y,
          });
        }
        return pts;
      };
      const fadingDashes = (g, pts, color, alpha, width) => {
        // Alternate segments drawn, each fainter than the last, so the lead
        // trails off toward the far end rather than stopping dead.
        for (let i = 0; i + 1 < pts.length; i += 2) {
          const k = 1 - i / pts.length;
          g.moveTo(pts[i].x, pts[i].y).lineTo(pts[i + 1].x, pts[i + 1].y)
            .stroke({ color, width, alpha: alpha * k * k, cap: 'round' });
        }
      };
      const drawStubs = (g, pts, color, alpha, width = 2.2) => {
        const k = Math.max(4, Math.round(pts.length * STUB_FRAC));
        fadingDashes(g, pts.slice(0, k), color, alpha, width);
        fadingDashes(g, pts.slice(pts.length - k).reverse(), color, alpha, width);
      };
      const livePoint = (id, offsetOf) => {
        const n = frame.nodes.get(id);
        if (!n) return null;
        const o = (offsetOf && offsetOf(id)) || { x: 0, y: 0 };
        return { x: n.x + o.x, y: n.y + o.y };
      };
      /* The rule is about the VIEW, not the bond: a reach whose both ends are
       * on screen is a family line you can see whole, and is drawn exactly
       * like any other (a parent two rows up, levelled down beside a spouse,
       * must not lose the line to their own child). Only a reach that leaves
       * the screen is reduced to its leads. Re-split whenever the camera has
       * moved; a few hundred bonds, so cheap. */
      let lastViewKey = '', lastSplitSig = null, lastSplitAt = 0;
      let lastDotKey = '', lineageVersion = 0;
      const drawReaches = (offsetOf, force = false) => {
        if (!frame) return;
        const W = app.screen.width, H = app.screen.height, z = zoom.value;
        const m = 240;
        const vx0 = (-anchorX.value - m) / z, vx1 = (W - anchorX.value + m) / z;
        const vy0 = (-anchorY.value - m) / z, vy1 = (H - anchorY.value + m) / z;
        const key = `${Math.round(vx0)}|${Math.round(vx1)}|${Math.round(vy0)}|${Math.round(vy1)}`;
        if (!force && key === lastViewKey) return;
        lastViewKey = key;
        const inside = (p) => p.x >= vx0 && p.x <= vx1 && p.y >= vy0 && p.y <= vy1;
        const byId = unitById();
        // First decide which reaches are whole in this view. Everything drawn
        // lives in world space, so unless that membership changed there is
        // nothing to redraw — a camera flight is a few membership changes,
        // not a redraw per frame.
        const geom = [];
        const wholeLong = [], wholeLateral = [];
        let sig = '';
        longFrame.bonds.forEach((b, i) => {
          const pu = byId.get(b.parentUnit), c = livePoint(b.child, offsetOf);
          const a = pu ? anchorOf(pu) : null;
          if (!a || !c) return;
          if (inside(a) && inside(c)) { wholeLong.push(b); sig += `L${i},`; return; }
          geom.push({ a, c, kind: 'descent' });
        });
        lateralFrame.bonds.forEach((b, i) => {
          const p = livePoint(b.a, offsetOf), q = livePoint(b.b, offsetOf);
          if (!p || !q) return;
          if (inside(p) && inside(q)) { wholeLateral.push(b); sig += `T${i},`; return; }
          geom.push({ a: p, c: q, kind: b.kind === 'union' && b.status === 'former' ? 'former' : 'thread' });
        });
        if (!force && sig === lastSplitSig) return;
        // During a flight the membership changes every frame; redrawing a
        // few hundred curves at 60Hz is wasted on a picture in motion.
        const now = performance.now();
        if (!force && now - lastSplitAt < 120) return;
        lastSplitAt = now;
        lastSplitSig = sig;
        reachStubs.clear();
        for (const { a, c, kind } of geom) {
          if (kind === 'descent') {
            const midY = a.y + (c.y - a.y) * 0.55;
            drawStubs(reachStubs, curvePts({ x: a.x, y: a.y + NODE_R }, { x: a.x, y: midY }, { x: c.x, y: midY }, { x: c.x, y: c.y - NODE_R }), BRANCH, 0.9);
          } else {
            // Bows beneath the row, the way Canopy's threads pass behind the
            // people between their ends.
            const dip = Math.max(a.y, c.y) + Math.min(ROW_GAP * 0.4, Math.abs(c.x - a.x) * 0.12);
            drawStubs(reachStubs, curvePts({ x: a.x, y: a.y + NODE_R }, { x: a.x, y: dip }, { x: c.x, y: dip }, { x: c.x, y: c.y + NODE_R }), kind === 'former' ? 0x9a8f86 : BRANCH, 0.8, 1.8);
          }
        }
        // A whole reach is a thin, plain curve — visibly a link, not one of
        // the family's own limbs (those are the tapered ribbons), and one
        // stroke for the lot rather than a ribbon and a fork each.
        longBonds.clear();
        for (const b of wholeLong) {
          const pu = byId.get(b.parentUnit), c = livePoint(b.child, offsetOf);
          const a = pu ? anchorOf(pu) : null;
          if (!a || !c) continue;
          const midY = a.y + (c.y - a.y) * 0.55;
          longBonds.moveTo(a.x, a.y + NODE_R).bezierCurveTo(a.x, midY, c.x, midY, c.x, c.y - NODE_R);
        }
        longBonds.stroke({ color: BRANCH, width: 1.6, alpha: 0.4, cap: 'round' });
        drawBonds(lateralBonds, { ...frame, bonds: wholeLateral }, FULLY_GROWN, 1e9, offsetOf);
      };
      const drawAllBonds = (offsetOf) => {
        drawBonds(nearBonds, nearFrame, FULLY_GROWN, 1e9, offsetOf);
        drawReaches(offsetOf, true);
      };
      const anchorOf = (u) => {
        const ids = u.anchorMemberIds?.length ? u.anchorMemberIds : u.memberIds;
        let sx = 0, sy = 0, n = 0;
        for (const m of ids) { const nd = frame.nodes.get(m); if (nd) { sx += nd.x; sy += nd.y; n++; } }
        return n ? { x: sx / n, y: sy / n } : null;
      };

      // The far layer: one hairline per descent, sized to read at the
      // fit-to-family zoom — the silhouette's veins. Cross-faded against the
      // near layer (Canopy's ribbons) as the camera closes in.
      const drawFar = () => {
        farBonds.clear();
        const W = app.screen.width, H = app.screen.height;
        const bw = frame.bounds.maxX - frame.bounds.minX, bh = frame.bounds.maxY - frame.bounds.minY;
        // Room on the left for the era axis (its labels hold a constant
        // on-screen size, so they need screen pixels, not world units).
        fitZoom = Math.max(0.003, Math.min(1.2, Math.min((W - 90 - ERA_MARGIN_PX) / Math.max(1, bw), (H - 140) / Math.max(1, bh))));
        // One screen pixel at the fit zoom — the veins of the silhouette. They
        // are faded out (see the loop) long before the camera is close enough
        // for that width to read as rope.
        const width = 0.9 / fitZoom;
        const byId = unitById();
        for (const b of frame.bonds) {
          if (b.kind !== 'descent') continue;
          const pu = byId.get(b.parentUnit), c = frame.nodes.get(b.child);
          if (!pu || !c) continue;
          const a = anchorOf(pu);
          if (!a) continue;
          // A descent that spans several rows is drawn faint up close (see
          // splitBonds) and not at all in the silhouette — it would cut a
          // rope through the whole shape.
          if (Math.abs(c.y - a.y) > ROW_GAP * 1.5) continue;
          const midY = a.y + (c.y - a.y) * 0.55;
          farBonds.moveTo(a.x, a.y + NODE_R);
          farBonds.bezierCurveTo(a.x, midY, c.x, midY, c.x, c.y - NODE_R);
        }
        farBonds.stroke({ color: BRANCH, width, alpha: 0.5, cap: 'round' });
        // Pods as short strokes so a couple still reads as a couple from orbit.
        for (const b of frame.bonds) {
          if (b.kind !== 'union' || b.status === 'former') continue;
          const p = frame.nodes.get(b.a), q = frame.nodes.get(b.b);
          if (!p || !q) continue;
          farBonds.moveTo(p.x, p.y).lineTo(q.x, q.y);
        }
        farBonds.stroke({ color: 0xc2603a, width: width * 1.6, alpha: 0.35, cap: 'round' });
      };

      // Generation strata: alternating bands behind the rows, and an era
      // label in the left margin — the time axis, read off the shape itself.
      const drawEras = () => {
        bgLayer.clear();
        for (const t of eras) t.destroy();
        eras.length = 0;
        eraLayer.removeChildren();
        const x0 = frame.bounds.minX - 900, x1 = frame.bounds.maxX + 900;
        frame.eras.forEach((e, i) => {
          if (i % 2 === 0) {
            bgLayer.rect(x0, e.y - ROW_GAP / 2, x1 - x0, ROW_GAP).fill({ color: 0x2b2622, alpha: 0.03 });
          }
          const label = new Text({ text: e.label || '·', style: eraStyle });
          label.anchor.set(1, 1);
          label.position.set(frame.bounds.minX - 120, e.y);
          const sub = new Text({ text: `${e.count} ${e.count === 1 ? 'person' : 'people'}`, style: eraSubStyle });
          sub.anchor.set(1, 0);
          sub.position.set(frame.bounds.minX - 120, e.y + 4);
          label.__sub = sub;
          eraLayer.addChild(label, sub);
          eras.push(label, sub);
        });
      };

      // Entrance: the world blooms outward from the focus row (or the
      // middle), a generation at a time, each row rippling outward from its
      // centre — the same "unfolding, not fading" idea Canopy grows by.
      const scheduleEntrance = (fromId) => {
        schedule = new Map();
        clock = 0;
        const fromRow = fromId && frame.nodes.get(fromId) ? frame.nodes.get(fromId).row : Math.round(frame.stats.generations / 2);
        const fromX = fromId && frame.nodes.get(fromId) ? frame.nodes.get(fromId).x : 0;
        const spread = Math.max(1, frame.bounds.maxX - frame.bounds.minX);
        for (const [id, n] of frame.nodes) {
          const rowDelay = Math.abs(n.row - fromRow) * 120;
          const xDelay = (Math.abs(n.x - fromX) / spread) * 900;
          schedule.set(id, { delay: reducedMotion ? 0 : rowDelay + xDelay, dur: reducedMotion ? 200 : 380 });
        }
      };

      /* ── camera ─────────────────────────────────────────────────────── */
      const fitAll = ({ instant = false } = {}) => {
        if (!frame) return;
        const W = app.screen.width, H = app.screen.height;
        const cx = (frame.bounds.minX + frame.bounds.maxX) / 2;
        const cy = (frame.bounds.minY + frame.bounds.maxY) / 2;
        const z = fitZoom;
        const ax = W / 2 - cx * z + ERA_MARGIN_PX / 2, ay = H / 2 - cy * z + 10;
        if (instant) { zoom.set(z); anchorX.set(ax); anchorY.set(ay); }
        else { zoom.to(z); anchorX.to(ax); anchorY.to(ay); }
      };
      const flyTo = (id, targetZoom = FLY_ZOOM) => {
        const n = frame?.nodes.get(id);
        if (!n) return;
        const W = app.screen.width, H = app.screen.height;
        const z = Math.max(fitZoom, Math.min(1.4, targetZoom));
        zoom.to(z);
        anchorX.to(W / 2 - n.x * z);
        anchorY.to(H * 0.47 - n.y * z);
      };

      const setFocus = (id) => {
        currentFocus = id && frame?.nodes.has(id) ? id : null;
        for (const [nid, cn] of nodes) {
          const node = frame.nodes.get(nid);
          const isFocus = nid === currentFocus;
          node.isFocus = isFocus;
          if (cn.isFocus !== isFocus) { cn.isFocus = isFocus; cn.drawRing(node); }
        }
        lineageVersion++;
        if (!currentFocus) { lineage = null; return; }
        const g = graphRef.current;
        const set = new Set([currentFocus]);
        for (const [aid] of ancestorsWithDistance(g, currentFocus, 60)) set.add(aid);
        for (const [did] of descendantsWithDistance(g, currentFocus, 60)) set.add(did);
        const u = frame.units.find((x) => !x.anchorOnly && x.memberIds.includes(currentFocus));
        if (u) for (const m of u.memberIds) set.add(m);
        lineage = set;
      };

      /* ── interaction: pan, pinch, wheel, tap, pull ───────────────────── */
      const drag = { active: false, moved: false, x: 0, y: 0, id: null, startX: 0, startY: 0 };
      let hoverId = null;
      const pointers = new Map();
      const pinch = { active: false, dist0: 0, zoom0: 1 };
      const twoFingers = () => { const [a, b] = [...pointers.values()]; return { dist: Math.hypot(b.x - a.x, b.y - a.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
      const zoomAbout = (nz, sx, sy) => {
        const clamped = Math.max(fitZoom * 0.6, Math.min(1.6, nz));
        const wx = (sx - anchorX.value) / zoom.value, wy = (sy - anchorY.value) / zoom.value;
        zoom.set(clamped); anchorX.set(sx - wx * clamped); anchorY.set(sy - wy * clamped);
      };
      const idFromTarget = (t) => { let n = t; while (n && n.__canopyId === undefined) n = n.parent; return n ? n.__canopyId : null; };
      const swayTargets = (id) => {
        const out = [];
        const unit = frame.units.find((u) => !u.anchorOnly && u.memberIds.includes(id));
        if (unit) for (const m of unit.memberIds) if (m !== id) out.push([m, SWAY_POD]);
        for (const b of frame.bonds) {
          if (b.kind === 'descent') {
            const pu = frame.units.find((u) => u.id === b.parentUnit);
            if (!pu) continue;
            const pids = pu.anchorMemberIds?.length ? pu.anchorMemberIds : pu.memberIds;
            if (b.child === id) { for (const m of pids) out.push([m, SWAY_BRANCH]); }
            else if (pids.includes(id)) out.push([b.child, SWAY_BRANCH]);
          }
        }
        return out;
      };
      const releaseDrag = () => { for (const [, d] of defl) d.release(); drag.id = null; };

      app.stage.on('pointerdown', (e) => {
        pointers.set(e.pointerId, { x: e.global.x, y: e.global.y });
        if (pointers.size === 2) {
          const f = twoFingers();
          pinch.active = true; pinch.dist0 = f.dist; pinch.zoom0 = zoom.value;
          drag.active = false; drag.moved = false; releaseDrag();
          return;
        }
        if (pointers.size > 2) return;
        drag.active = true; drag.moved = false;
        drag.x = drag.startX = e.global.x; drag.y = drag.startY = e.global.y;
        // Pressing ON somebody grabs them (only once they're big enough to
        // be a thing you can hold); pressing on paper pans the map.
        drag.id = zoom.value > 0.35 ? idFromTarget(e.target) : null;
      });
      app.stage.on('pointermove', (e) => {
        if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.global.x, y: e.global.y });
        if (pinch.active && pointers.size >= 2) { const f = twoFingers(); if (pinch.dist0 > 0) zoomAbout(pinch.zoom0 * (f.dist / pinch.dist0), f.mx, f.my); return; }
        if (!drag.active) {
          const over = zoom.value > 0.2 ? idFromTarget(e.target) : null;
          if (over !== hoverId) { if (hoverId) nodes.get(hoverId)?.setHover(false); hoverId = over; if (hoverId) nodes.get(hoverId)?.setHover(true); }
          return;
        }
        const dx = e.global.x - drag.x, dy = e.global.y - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > TAP_SLOP) drag.moved = true;
        if (!drag.moved) return;
        if (drag.id) {
          const pulled = rubberBand((e.global.x - drag.startX) / zoom.value, (e.global.y - drag.startY) / zoom.value);
          deflFor(drag.id).hold(pulled.x, pulled.y);
          for (const [id, k] of swayTargets(drag.id)) deflFor(id).lean(pulled.x * k, pulled.y * k);
        } else {
          anchorX.set(anchorX.value + dx); anchorY.set(anchorY.value + dy);
        }
        drag.x = e.global.x; drag.y = e.global.y;
      });
      const endDrag = (e) => {
        if (e) pointers.delete(e.pointerId);
        if (pinch.active && pointers.size < 2) {
          pinch.active = false;
          if (pointers.size === 1) { const [p] = [...pointers.values()]; drag.active = true; drag.moved = true; drag.id = null; drag.x = drag.startX = p.x; drag.y = drag.startY = p.y; }
          return;
        }
        if (!drag.active) return;
        drag.active = false;
        releaseDrag();
        if (drag.moved) return;
        let id = idFromTarget(e.target);
        if (!id && zoom.value < DOT_ZOOM && frame) {
          // From orbit there is nothing to hit-test, so a tap is a map tap:
          // the nearest dot within reach is the person you meant; otherwise
          // dive in about the point you touched.
          const z = zoom.value;
          let best = null, bestD = 14;
          for (const [nid, n] of frame.nodes) {
            const d = Math.hypot(anchorX.value + n.x * z - e.global.x, anchorY.value + n.y * z - e.global.y);
            if (d < bestD) { bestD = d; best = nid; }
          }
          if (!best) { zoomAbout(Math.min(FLY_ZOOM, z * 2.6), e.global.x, e.global.y); return; }
          id = best;
        }
        if (!id) return;
        if (id === currentFocus) onOpenRef.current?.(id);
        else onSelectRef.current?.(id);
      };
      app.stage.on('pointerup', endDrag);
      app.stage.on('pointerupoutside', (e) => { pointers.delete(e?.pointerId); if (pointers.size < 2) pinch.active = false; drag.active = false; releaseDrag(); });
      const onWheel = (e) => {
        e.preventDefault();
        const factor = Math.pow(2, -Math.max(-240, Math.min(240, e.deltaY)) * 0.0022);
        zoomAbout(zoom.value * factor, e.offsetX, e.offsetY);
      };
      app.canvas.addEventListener('wheel', onWheel, { passive: false });

      /* ── the loop ────────────────────────────────────────────────────── */
      app.ticker.add((ticker) => {
        if (!frame) return;
        const dtMs = Math.min(ticker.deltaMS, 50);
        clock += dtMs;
        const dt = dtMs / 1000;
        const tSec = performance.now() / 1000;
        zoom.step(dt); anchorX.step(dt); anchorY.step(dt);
        const z = zoom.value;
        world.scale.set(z);
        world.position.set(anchorX.value, anchorY.value);

        for (const [id, d] of defl) { d.step(dt); if (d.resting && id !== drag.id) defl.delete(id); }

        // Level of detail, all derived from one number.
        const dotScale = Math.max(1, MIN_DOT_PX / (NODE_R * z));
        const shadowFade = Math.max(0, Math.min(1, (z - 0.09) / 0.2));
        const showNames = z > NAME_ZOOM, showSub = z > SUB_ZOOM;
        const entrance = Math.min(1, clock / 900);
        const nearAlpha = Math.max(0, Math.min(1, (z - fitZoom * 1.6) / (fitZoom * 3)));
        const farAlpha = z < fitZoom * 1.8 ? 1 : Math.max(0, 1 - (z - fitZoom * 1.8) / (fitZoom * 2.4));
        nearBonds.alpha = nearAlpha * entrance;
        // Reach stubs are a close-range device: they only mean something
        // once the person they leave from is big enough to be someone.
        const reachAlpha = Math.max(0, Math.min(1, (z - 0.3) / 0.3)) * entrance;
        reachStubs.alpha = reachAlpha * 0.7;
        longBonds.alpha = nearAlpha * 0.8 * entrance;
        lateralBonds.alpha = nearAlpha * 0.8 * entrance;
        farBonds.alpha = farAlpha * entrance;
        bgLayer.alpha = entrance;

        const W = app.screen.width, H = app.screen.height;
        const margin = 180;
        const yr = yearRef.current;
        const presence = (id, person) => {
          let a = 1;
          // Lineage: when someone is selected, their whole bloodline stays lit
          // through the entire shape and everyone else steps back.
          if (lineage && !lineage.has(id)) a *= 0.18;
          // Time: scrub a year and the family alive that year is who you see.
          if (yr != null) {
            const b = yearOf(person.birth_date), d = yearOf(person.death_date);
            if (b != null && b > yr) a *= 0.05;
            else if (d != null && d < yr) a *= 0.22;
            else if (b == null) a *= 0.5;
          }
          return a;
        };

        /* The far view. From orbit a person is a dot a few pixels across; a
         * masked portrait container per person — shadow, disc, mask, ring,
         * two texts — is the single biggest cost in the whole stage at that
         * range, for nothing anyone can see. Below DOT_ZOOM the node layer
         * is switched off and everyone is drawn into ONE graphics object,
         * redrawn only when the picture would actually differ (zoom step,
         * lineage, year, or the entrance still playing). */
        const far = z < DOT_ZOOM;
        nodeLayer.visible = !far;
        dotLayer.visible = far;
        if (far) {
          const opening = clock < 2600;
          const key = `${Math.round(z * 600)}|${lineageVersion}|${yr}|${opening ? clock : 'x'}`;
          if (key !== lastDotKey) {
            lastDotKey = key;
            dotLayer.clear();
            // A little finer than the node floor: from orbit a thousand
            // people need to read as a texture, not a pile of coins.
            const r = Math.max(NODE_R, (MIN_DOT_PX * 0.7) / z);
            for (const [id, node] of frame.nodes) {
              const cn = nodes.get(id);
              if (!cn) continue;
              const open = opening ? easeBud(progressAt(schedule.get(id), clock)) : 1;
              if (open <= 0) continue;
              const a = presence(id, cn.person) * Math.min(1, open * 1.3) * entrance;
              dotLayer.circle(node.x, node.y, r * open).fill({ color: tintFor(cn.person), alpha: a });
              if (node.isFocus) dotLayer.circle(node.x, node.y, r * open + 2.4 / z).stroke({ color: 0xc2603a, width: 1.6 / z, alpha: 0.9 });
            }
            if (lineage) {
              // The lit bloodline gets a hairline halo so it reads from orbit.
              for (const id of lineage) {
                const node = frame.nodes.get(id);
                if (node) dotLayer.circle(node.x, node.y, r + 1.2 / z).stroke({ color: 0xc2603a, width: 0.9 / z, alpha: 0.5 });
              }
            }
          }
        }

        for (const [id, node] of frame.nodes) {
          if (far) break;
          const cn = nodes.get(id);
          if (!cn) continue;
          const sx = anchorX.value + node.x * z, sy = anchorY.value + node.y * z;
          const onScreen = sx > -margin && sx < W + margin && sy > -margin && sy < H + margin;
          cn.root.visible = onScreen;
          if (!onScreen) continue;
          const open = easeBud(progressAt(schedule.get(id), clock));
          const amb = node.isFocus || reducedMotion ? { x: 0, y: 0, scale: 1 } : ambientOffset(node.unitId, tSec);
          cn.apply(node, open, amb, deflOf(id));
          if (dotScale > 1) cn.root.scale.set(cn.root.scale.x * dotScale);
          if (cn.shadow) cn.shadow.alpha *= shadowFade;
          if (cn.name) cn.name.visible = showNames;
          if (cn.sub) cn.sub.visible = showSub;
          cn.root.alpha *= presence(id, cn.person);
          if (z > PHOTO_ZOOM && cn.pendingPhoto) { cn.person = { ...cn.person, photo: cn.pendingPhoto }; cn.pendingPhoto = null; cn.loadPhoto(cn.baseR); }
        }

        // Era labels hold a constant on-screen size, and give way to faces.
        const eraAlpha = Math.max(0, Math.min(1, (ERA_ZOOM - z) / 0.3)) * entrance;
        eraLayer.alpha = eraAlpha;
        eraLayer.visible = eraAlpha > 0.01;
        if (eraLayer.visible) {
          const s = 1 / z;
          // Rows are ROW_GAP apart in the world but only ROW_GAP·z on screen:
          // when that's tighter than a label, show every Nth row's label so
          // the axis thins rather than piling into an unreadable stack.
          const rowPx = ROW_GAP * z;
          const step = Math.max(1, Math.ceil(24 / rowPx));
          const showCounts = rowPx > 44;
          for (let i = 0; i < eras.length; i += 2) {
            const rowIndex = i / 2;
            const on = rowIndex % step === 0;
            eras[i].visible = on;
            eras[i].scale.set(s);
            eras[i + 1].visible = on && showCounts;
            eras[i + 1].scale.set(s);
          }
        }

        if (defl.size) drawAllBonds(deflOf);
        else drawReaches(null);
      });

      innerApi.current = {
        build, fitAll, flyTo, setFocus,
        rebuild: () => { build(); fitAll({ instant: true }); },
        get stats() { return frame?.stats; },
        destroy: () => { app.canvas.removeEventListener('wheel', onWheel); for (const [, n] of nodes) n.destroy(); nodes.clear(); },
      };
      if (apiRef) apiRef.current = innerApi.current;
      build();
      fitAll({ instant: true });
    })();

    return () => {
      alive = false;
      innerApi.current?.destroy?.();
      innerApi.current = null;
      if (apiRef) apiRef.current = null;
      try { app.destroy(true, { children: true }); } catch { /* already gone */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  useEffect(() => { innerApi.current?.rebuild?.(); }, [graph]);
  useEffect(() => {
    const api = innerApi.current;
    if (!api) return;
    api.setFocus(focusId);
    if (focusId) api.flyTo(focusId);
  }, [focusId]);

  return <div ref={hostRef} className="atlas-host" aria-hidden="true" />;
}

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
 * Map conventions this stage follows, each of which the first real-tree
 * review found missing:
 *   - Names are labels on a map, not part of the marker: they live in
 *     SCREEN space at a constant size, are decluttered per generation row
 *     (a colliding name drops to a second tier or waits), and the lit
 *     bloodline's names show at every zoom, even from orbit.
 *   - The time axis is a graticule: era labels stick to the viewport edge
 *     rather than sitting at the far left of the world where a phone never
 *     sees them.
 *   - A flight is an arc — out, over, and in — so you see where you are
 *     going, with names settling in on landing.
 *   - Off-screen relatives of the selected person are edge markers you can
 *     tap, never lines drawn through someone else's name.
 *   - Lighting a bloodline lights its LINES, and steps everyone else back a
 *     little; it never ghosts the rest of the family into a rendering fault.
 *
 * Level of detail is what makes 1,200 people affordable: no simulation runs,
 * bonds are drawn once into static layers, portraits load lazily, and from
 * orbit everyone is one flat layer of dots.
 */

import { useEffect, useRef } from 'react';
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { planAtlas, isFarReach, NODE_R, ROW_GAP } from './layout.js';
import { Scalar, ambientOffset, Deflection, rubberBand, SWAY_POD, SWAY_BRANCH } from '../canopy/motion.js';
import { drawBonds, CanopyNode, easeBud, progressAt, tintFor, descentPath, liveAnchor, livePos } from '../canopy/render.js';
import { ancestorsWithDistance, descendantsWithDistance, isBioOrAdoptive } from '../../data/graph.js';

const TAP_SLOP = 8;
const MIN_DOT_PX = 3.4;          // a person never shrinks below a visible dot
const NAME_ZOOM = 0.22;          // names once a portrait is ~24px across
const SUB_ZOOM = 0.82;           // dates a little later
const PHOTO_ZOOM = 0.26;         // portraits load once you're this close
const DOT_ZOOM = 0.16;           // below this a person is a dot: one flat layer, not 1,200 portrait containers
const FLY_ZOOM = 0.9;
const LAND_Y = 0.42;             // where a flight lands its person (a little above centre: children stay clear of the foot)
const ERA_MARGIN_PX = 96;        // screen pixels reserved for the era axis at the fit zoom
const BRANCH = 0x8a7563;
const TERRA = 0xc2603a;
const GOLD = 0xb0802f;
const INK = 0x2b2622;
const DIM = 0.42;                // everyone outside a lit bloodline
const FULLY_GROWN = { bonds: new Map(), nodes: new Map(), reduced: false };

function yearOf(s) {
  const m = String(s || '').match(/\d{4}/);
  return m ? Number(m[0]) : null;
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (p) => p * p * (3 - 2 * p);
const firstName = (p) => (p?.display_name || '').trim().split(/\s+/)[0] || '';
const byGender = (p, f, m, other) => (p?.gender === 'female' ? f : p?.gender === 'male' ? m : other);

export default function AtlasStage({ graph, focusId, year = null, onSelect, onOpen, onLayout, onEdge, apiRef, reducedMotion = false }) {
  const hostRef = useRef(null);
  const graphRef = useRef(graph); graphRef.current = graph;
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  const onOpenRef = useRef(onOpen); onOpenRef.current = onOpen;
  const onLayoutRef = useRef(onLayout); onLayoutRef.current = onLayout;
  const onEdgeRef = useRef(onEdge); onEdgeRef.current = onEdge;
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

      /* World space: the map itself. */
      const world = new Container();
      const bgLayer = new Graphics();
      const farBonds = new Graphics();     // the silhouette's veins, for the far view
      const longBonds = new Graphics();    // far-reaching descents with both ends on screen — thin, plain
      const lateralBonds = new Graphics(); // ex-partners and extra partners with both ends on screen
      const nearBonds = new Graphics();    // pods and one-row descents — Canopy's ribbons
      const litBonds = new Graphics();     // the selected bloodline's own lines, full strength and warm
      const dotLayer = new Graphics();     // everyone as a dot, for the far view
      const nodeLayer = new Container();
      world.addChild(bgLayer, farBonds, longBonds, lateralBonds, nearBonds, litBonds, dotLayer, nodeLayer);
      /* Screen space: labels and the axis hold a constant size and stick to
       * the viewport, the way a map's type and graticule do. */
      const labelLayer = new Container();
      const axisLayer = new Container();
      app.stage.addChild(world, labelLayer, axisLayer);
      app.stage.eventMode = 'static';
      app.stage.hitArea = { contains: () => true };

      let frame = null;
      let fitZoom = 0.05;
      let currentFocus = null;
      let lineage = null;          // Set of ids lit when someone is selected
      let lineageVersion = 0;
      let clock = 0;               // ms since the current world was born
      let schedule = new Map();    // id -> { delay, dur } entrance
      const nodes = new Map();     // id -> CanopyNode
      const defl = new Map();
      const deflOf = (id) => defl.get(id)?.value;
      const deflFor = (id) => { let d = defl.get(id); if (!d) { d = new Deflection(); defl.set(id, d); } return d; };

      const zoom = new Scalar(0.05, 1.1);
      const anchorX = new Scalar(0, 1.15);
      const anchorY = new Scalar(0, 1.15);
      let flight = null;           // an arc in progress (see flyTo)

      // Map type carries a paper halo so it stays legible across a line.
      const labelStyle = new TextStyle({ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 14, fontWeight: '600', fill: INK, align: 'center', stroke: { color: 0xfdfbf7, width: 3, join: 'round' } });
      const eraStyle = new TextStyle({ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 12, fontWeight: '600', fill: GOLD, letterSpacing: 1.2, stroke: { color: 0xfdfbf7, width: 3, join: 'round' } });

      /* ── build the world ─────────────────────────────────────────────── */
      const labels = new Map();    // id -> Text (screen-space name)
      const eraTexts = [];
      const build = () => {
        const g = graphRef.current;
        frame = planAtlas(g);
        for (const [, n] of nodes) n.destroy();
        nodes.clear();
        nodeLayer.removeChildren();
        for (const [, t] of labels) t.destroy();
        labels.clear();
        labelLayer.removeChildren();
        for (const [id, node] of frame.nodes) {
          const person = g.byId.get(id);
          if (!person) continue;
          // Portraits are deferred: the node is born as a monogram and only
          // asks for its photo once the camera is close enough to see it.
          const cn = new CanopyNode({ ...person, photo: null }, node);
          cn.pendingPhoto = person.photo || null;
          cn.person = person;
          // Names are drawn by the label layer, not by the node.
          if (cn.name) cn.name.visible = false;
          nodes.set(id, cn);
          nodeLayer.addChild(cn.root);
        }
        splitBonds();
        drawAllBonds(null);
        drawFar();
        drawEras();
        drawLit();
        scheduleEntrance(null);
        onLayoutRef.current?.(frame.stats, frame);
      };

      const unitById = () => new Map(frame.units.map((u) => [u.id, u]));
      const anchorOf = (u) => {
        const ids = u.anchorMemberIds?.length ? u.anchorMemberIds : u.memberIds;
        let sx = 0, sy = 0, n = 0;
        for (const m of ids) { const nd = frame.nodes.get(m); if (nd) { sx += nd.x; sy += nd.y; n++; } }
        return n ? { x: sx / n, y: sy / n } : null;
      };

      /* Bonds are split by what they mean at scale. A pod and a child hanging
       * one row beneath its parents are the family's own shape. A descent
       * spanning several rows, or reaching a long way along one, is true but
       * would read as a rope; it is drawn thin and plain, and only when both
       * of its ends are on screen. A lateral link (an ex, an extra partner)
       * likewise. */
      let nearFrame = null, longFrame = null, lateralFrame = null, nearSet = new Set();
      const splitBonds = () => {
        const byId = unitById();
        const near = [], long = [], lateral = [];
        for (const b of frame.bonds) {
          if (b.kind === 'descent') {
            const pu = byId.get(b.parentUnit), c = frame.nodes.get(b.child);
            const a = pu ? anchorOf(pu) : null;
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
        nearSet = new Set(near);
      };

      const livePoint = (id, offsetOf) => {
        const n = frame.nodes.get(id);
        if (!n) return null;
        const o = (offsetOf && offsetOf(id)) || { x: 0, y: 0 };
        return { x: n.x + o.x, y: n.y + o.y };
      };
      const reachCurve = (g, a, c) => {
        const midY = a.y + (c.y - a.y) * 0.55;
        g.moveTo(a.x, a.y + NODE_R).bezierCurveTo(a.x, midY, c.x, midY, c.x, c.y - NODE_R);
      };

      /* Reaches: a far-reaching link is drawn whole only while both ends are
       * on screen. Re-split when the camera has moved; redraw only when the
       * membership actually changed. */
      let lastViewKey = '', lastSplitSig = null, lastSplitAt = 0;
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
        const wholeLong = [], wholeLateral = [];
        let sig = '';
        longFrame.bonds.forEach((b, i) => {
          const pu = byId.get(b.parentUnit), c = livePoint(b.child, offsetOf);
          const a = pu ? anchorOf(pu) : null;
          if (a && c && inside(a) && inside(c)) { wholeLong.push({ b, a, c }); sig += `L${i},`; }
        });
        lateralFrame.bonds.forEach((b, i) => {
          const p = livePoint(b.a, offsetOf), q = livePoint(b.b, offsetOf);
          if (p && q && inside(p) && inside(q)) { wholeLateral.push(b); sig += `T${i},`; }
        });
        if (!force && sig === lastSplitSig) return;
        const now = performance.now();
        if (!force && now - lastSplitAt < 120) return;
        lastSplitAt = now;
        lastSplitSig = sig;
        longBonds.clear();
        for (const { a, c } of wholeLong) reachCurve(longBonds, a, c);
        longBonds.stroke({ color: BRANCH, width: 1.6, alpha: 0.4, cap: 'round' });
        drawBonds(lateralBonds, { ...frame, bonds: wholeLateral }, FULLY_GROWN, 1e9, offsetOf);
      };
      const drawAllBonds = (offsetOf) => {
        drawBonds(nearBonds, nearFrame, FULLY_GROWN, 1e9, offsetOf);
        drawReaches(offsetOf, true);
        if (offsetOf) drawLit(offsetOf);
      };

      /* The lit bloodline: its own pods and descents drawn again on top at
       * full strength, plus a warm thread along every descent in the line —
       * near ones along Canopy's bough, far ones whole regardless of view,
       * because the line you are following must never disappear. */
      const drawLit = (offsetOf = null) => {
        litBonds.clear();
        if (!lineage || !frame) return;
        const byId = unitById();
        const inL = (id) => lineage.has(id);
        const mine = frame.bonds.filter((b) => {
          if (b.kind === 'union') return inL(b.a) && inL(b.b);
          if (b.kind !== 'descent') return false;
          const pu = byId.get(b.parentUnit);
          if (!pu) return false;
          const ids = pu.anchorMemberIds?.length ? pu.anchorMemberIds : pu.memberIds;
          return inL(b.child) && ids.some(inL);
        });
        drawBonds(litBonds, { ...frame, bonds: mine.filter((b) => nearSet.has(b)) }, FULLY_GROWN, 1e9, offsetOf);
        for (const b of mine) {
          if (b.kind !== 'descent') continue;
          const from = liveAnchor(frame, b.parentUnit, offsetOf), to = livePos(frame, b.child, offsetOf);
          if (!from || !to) continue;
          if (nearSet.has(b)) {
            const pts = descentPath(from, to, b.junctionLevel || 0);
            litBonds.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) litBonds.lineTo(pts[i].x, pts[i].y);
            litBonds.stroke({ color: TERRA, width: 2.2, alpha: 0.55, cap: 'round', join: 'round' });
          } else {
            reachCurve(litBonds, { x: from.x, y: from.y }, to);
            litBonds.stroke({ color: TERRA, width: 2, alpha: 0.6, cap: 'round' });
          }
        }
      };

      /* The far layer: one hairline per descent, sized to read at the fit
       * zoom — the silhouette's veins. */
      const drawFar = () => {
        farBonds.clear();
        const W = app.screen.width, H = app.screen.height;
        const bw = frame.bounds.maxX - frame.bounds.minX, bh = frame.bounds.maxY - frame.bounds.minY;
        fitZoom = Math.max(0.003, Math.min(1.2, Math.min((W - 60 - ERA_MARGIN_PX) / Math.max(1, bw), (H - 150) / Math.max(1, bh))));
        const width = 1.1 / fitZoom;
        const byId = unitById();
        for (const b of frame.bonds) {
          if (b.kind !== 'descent') continue;
          const pu = byId.get(b.parentUnit), c = frame.nodes.get(b.child);
          if (!pu || !c) continue;
          const a = anchorOf(pu);
          if (!a || Math.abs(c.y - a.y) > ROW_GAP * 1.5) continue;
          reachCurve(farBonds, a, c);
        }
        farBonds.stroke({ color: BRANCH, width, alpha: 0.55, cap: 'round' });
        for (const b of frame.bonds) {
          if (b.kind !== 'union' || b.status === 'former') continue;
          const p = frame.nodes.get(b.a), q = frame.nodes.get(b.b);
          if (!p || !q) continue;
          farBonds.moveTo(p.x, p.y).lineTo(q.x, q.y);
        }
        farBonds.stroke({ color: TERRA, width: width * 1.6, alpha: 0.35, cap: 'round' });
      };

      /* Generation strata in the world; the era labels are screen-space and
       * positioned every frame (see the loop). */
      const drawEras = () => {
        bgLayer.clear();
        for (const t of eraTexts) t.destroy();
        eraTexts.length = 0;
        axisLayer.removeChildren();
        const x0 = frame.bounds.minX - 4000, x1 = frame.bounds.maxX + 4000;
        frame.eras.forEach((e, i) => {
          if (i % 2 === 0) bgLayer.rect(x0, e.y - ROW_GAP / 2, x1 - x0, ROW_GAP).fill({ color: 0x2b2622, alpha: 0.03 });
          const t = new Text({ text: e.label || '·', style: eraStyle });
          t.anchor.set(0, 0.5);
          t.__y = e.y;
          axisLayer.addChild(t);
          eraTexts.push(t);
        });
      };

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
        flight = null;
        const W = app.screen.width, H = app.screen.height;
        const cx = (frame.bounds.minX + frame.bounds.maxX) / 2;
        const cy = (frame.bounds.minY + frame.bounds.maxY) / 2;
        const z = fitZoom;
        const ax = W / 2 - cx * z + ERA_MARGIN_PX / 2, ay = H / 2 - cy * z + 10;
        if (instant) { zoom.set(z); anchorX.set(ax); anchorY.set(ay); }
        else { zoom.to(z); anchorX.to(ax); anchorY.to(ay); }
      };
      /* A flight is an arc: the camera rises as it travels and settles as it
       * arrives, so a long journey reads as a journey rather than a cut. The
       * rise is sized to the distance — across a family, up to the far view;
       * to the next pod over, hardly at all. */
      const flyTo = (id, targetZoom = FLY_ZOOM) => {
        const n = frame?.nodes.get(id);
        if (!n) return;
        const W = app.screen.width, H = app.screen.height;
        const z1 = Math.max(fitZoom, Math.min(1.4, targetZoom));
        const z0 = zoom.value;
        const lx = W / 2, ly = H * LAND_Y;
        const c0 = { x: (lx - anchorX.value) / z0, y: (ly - anchorY.value) / z0 };
        const c1 = { x: n.x, y: n.y };
        const d = Math.hypot(c1.x - c0.x, c1.y - c0.y);
        const screens = (d * z1) / Math.max(W, H);
        const zPeak = screens > 0.8 ? Math.max(fitZoom, Math.min(z1, (1.3 * Math.max(W, H)) / d)) : Math.min(z0, z1);
        const midLog = (Math.log(z0) + Math.log(z1)) / 2;
        const bump = Math.max(0, midLog - Math.log(zPeak));
        const dur = reducedMotion ? 1 : 700 + Math.min(1200, 380 * bump + screens * 90);
        flight = { t0: performance.now(), dur, z0, z1, c0, c1, bump, lx, ly };
      };
      // Wall-clock, not frame deltas: a dropped frame must not slow a flight.
      const stepFlight = () => {
        if (!flight) return;
        const p = clamp01((performance.now() - flight.t0) / flight.dur);
        const e = smooth(p);
        const zLog = Math.log(flight.z0) + (Math.log(flight.z1) - Math.log(flight.z0)) * e - flight.bump * Math.sin(Math.PI * e);
        const z = Math.exp(zLog);
        const cx = flight.c0.x + (flight.c1.x - flight.c0.x) * e;
        const cy = flight.c0.y + (flight.c1.y - flight.c0.y) * e;
        zoom.set(z); anchorX.set(flight.lx - cx * z); anchorY.set(flight.ly - cy * z);
        if (p >= 1) flight = null;
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
        if (!currentFocus) { lineage = null; drawLit(); return; }
        const g = graphRef.current;
        const set = new Set([currentFocus]);
        for (const [aid] of ancestorsWithDistance(g, currentFocus, 60)) set.add(aid);
        for (const [did] of descendantsWithDistance(g, currentFocus, 60)) set.add(did);
        const u = frame.units.find((x) => !x.anchorOnly && x.memberIds.includes(currentFocus));
        if (u) for (const m of u.memberIds) set.add(m);
        lineage = set;
        drawLit();
      };

      /* ── edge markers: the selected person's off-screen relatives ───── */
      let lastEdgeKey = '', lastEdgeAt = 0;
      const reportEdges = () => {
        const cb = onEdgeRef.current;
        if (!cb || !frame) return;
        const now = performance.now();
        if (now - lastEdgeAt < 120) return;
        lastEdgeAt = now;
        const z = zoom.value, W = app.screen.width, H = app.screen.height;
        let chips = [];
        if (currentFocus && z >= 0.3 && !flight) {
          const g = graphRef.current;
          const rels = [];
          const add = (id, relation) => { if (id !== currentFocus && frame.nodes.has(id)) rels.push({ id, relation }); };
          for (const p of g.parents(currentFocus)) add(p.id, isBioOrAdoptive(p.qualifier) ? byGender(g.byId.get(p.id), 'Mother', 'Father', 'Parent') : 'Step-parent');
          for (const c of g.children(currentFocus)) add(c.id, byGender(g.byId.get(c.id), 'Daughter', 'Son', 'Child'));
          for (const pt of g.partners(currentFocus)) add(pt.id, pt.status === 'former' ? 'Former partner' : 'Partner');
          for (const s of g.siblings(currentFocus)) add(s.id, byGender(g.byId.get(s.id), 'Sister', 'Brother', 'Sibling'));
          // Insets keep a whole pill on screen, clear of the corner buttons
          // above and the foot below.
          const inset = Math.min(120, W * 0.26), top = 64, bottom = 96;
          const cx = W / 2, cy = (top + (H - bottom)) / 2;
          for (const r of rels) {
            const n = frame.nodes.get(r.id);
            const sx = anchorX.value + n.x * z, sy = anchorY.value + n.y * z;
            if (sx > -NODE_R * z && sx < W + NODE_R * z && sy > -NODE_R * z && sy < H + NODE_R * z) continue;
            const dx = sx - cx, dy = sy - cy;
            const kx = dx ? (W / 2 - inset) / Math.abs(dx) : Infinity;
            const ky = dy ? (cy - top - 8) / Math.abs(dy) : Infinity;
            const k = Math.min(1, kx, ky);
            const x = cx + dx * k, y = cy + dy * k;
            const near = chips.find((c) => Math.hypot(c.x - x, c.y - y) < 48);
            if (near) { near.ids.push(r.id); near.relations.push(r.relation); continue; }
            chips.push({ ids: [r.id], relations: [r.relation], x, y, angle: Math.atan2(dy, dx) });
          }
          chips = chips.slice(0, 8).map((c) => ({
            key: c.ids.join('+'),
            ids: c.ids,
            label: c.ids.length === 1 ? `${c.relations[0]} · ${firstName(g.byId.get(c.ids[0]))}`
              : c.ids.length === 2 ? c.relations.join(' & ')
              : `${c.ids.length} relatives`,
            x: Math.round(c.x), y: Math.round(c.y), angle: c.angle,
          }));
        }
        const key = chips.map((c) => `${c.key}@${c.x},${c.y}`).join('|');
        if (key === lastEdgeKey) return;
        lastEdgeKey = key;
        cb(chips);
      };

      /* ── interaction: pan, pinch, wheel, tap, pull ───────────────────── */
      const drag = { active: false, moved: false, x: 0, y: 0, id: null, startX: 0, startY: 0 };
      let hoverId = null;
      const pointers = new Map();
      const pinch = { active: false, dist0: 0, zoom0: 1 };
      const twoFingers = () => { const [a, b] = [...pointers.values()]; return { dist: Math.hypot(b.x - a.x, b.y - a.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
      const zoomAbout = (nz, sx, sy) => {
        flight = null;
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
        flight = null;
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

      /* ── labels: a decluttered, screen-space layer ───────────────────── */
      const labelFor = (id, person) => {
        let t = labels.get(id);
        if (!t) {
          t = new Text({ text: person.display_name || '', style: labelStyle });
          t.anchor.set(0.5, 0);
          t.alpha = 0; t.visible = false;
          labelLayer.addChild(t);
          labels.set(id, t);
        }
        return t;
      };
      /* Candidates are placed in priority order — the focus, then the lit
       * line, then everyone else by row and x — and a name that would sit on
       * another takes a second tier beneath it or waits for more zoom. */
      const placeLabels = (cands, z, scale) => {
        const placed = new Set();
        cands.sort((a, b) => a.pri - b.pri || a.row - b.row || a.sx - b.sx);
        // Collisions are checked in SCREEN bands, not layout rows: from orbit
        // several generations share a few pixels of height.
        const lineH = 15 * scale;
        const bands = new Map(); // band -> intervals
        const free = (band, l, r) => !(bands.get(band) || []).some(([a, b]) => r > a && l < b);
        const take = (band, l, r) => { if (!bands.has(band)) bands.set(band, []); bands.get(band).push([l, r]); };
        for (const c of cands) {
          const t = labelFor(c.id, c.person);
          const hw = (t.width * scale) / 2 + 4;
          let placedTier = -1;
          for (let k = 0; k < 2 && placedTier < 0; k++) {
            const y = c.sy + c.rPx + 5 + k * lineH;
            const band = Math.round(y / lineH);
            if (free(band, c.sx - hw, c.sx + hw)) { take(band, c.sx - hw, c.sx + hw); placedTier = k; t.position.set(c.sx, y); }
          }
          if (placedTier < 0) continue;
          t.scale.set(scale);
          t.__target = c.alpha;
          placed.add(c.id);
        }
        for (const [id, t] of labels) {
          const target = placed.has(id) ? t.__target : 0;
          t.alpha += (target - t.alpha) * labelEase;
          t.visible = t.alpha > 0.02;
        }
      };
      let labelEase = 0.22;

      /* ── the loop ────────────────────────────────────────────────────── */
      app.ticker.add((ticker) => {
        if (!frame) return;
        const dtMs = Math.min(ticker.deltaMS, 50);
        clock += dtMs;
        const dt = dtMs / 1000;
        const tSec = performance.now() / 1000;
        if (flight) stepFlight();
        else { zoom.step(dt); anchorX.step(dt); anchorY.step(dt); }
        const z = zoom.value;
        world.scale.set(z);
        world.position.set(anchorX.value, anchorY.value);

        for (const [id, d] of defl) { d.step(dt); if (d.resting && id !== drag.id) defl.delete(id); }

        // Level of detail, all derived from one number.
        const dotScale = Math.max(1, MIN_DOT_PX / (NODE_R * z));
        const shadowFade = clamp01((z - 0.09) / 0.2);
        const showSub = z > SUB_ZOOM;
        const entrance = Math.min(1, clock / 900);
        const nearAlpha = clamp01((z - fitZoom * 1.6) / (fitZoom * 3));
        const farAlpha = z < fitZoom * 1.8 ? 1 : clamp01(1 - (z - fitZoom * 1.8) / (fitZoom * 2.4));
        const dimBonds = lineage ? DIM : 1;
        nearBonds.alpha = nearAlpha * entrance * dimBonds;
        longBonds.alpha = nearAlpha * 0.8 * entrance * dimBonds;
        lateralBonds.alpha = nearAlpha * 0.8 * entrance * dimBonds;
        litBonds.alpha = nearAlpha * entrance;
        farBonds.alpha = farAlpha * entrance * (lineage ? 0.6 : 1);
        bgLayer.alpha = entrance;

        const W = app.screen.width, H = app.screen.height;
        const margin = 180;
        const yr = yearRef.current;
        const presence = (id, person) => {
          let a = 1;
          if (lineage && !lineage.has(id)) a *= DIM;
          if (yr != null) {
            const b = yearOf(person.birth_date), d = yearOf(person.death_date);
            if (b != null && b > yr) a *= 0.05;
            else if (d != null && d < yr) a *= 0.22;
            else if (b == null) a *= 0.5;
          }
          return a;
        };

        const far = z < DOT_ZOOM;
        nodeLayer.visible = !far;
        dotLayer.visible = far;
        const cands = [];
        const nameScale = 0.78 + 0.22 * clamp01((z - NAME_ZOOM) / (0.9 - NAME_ZOOM));
        const nameFade = clamp01((z - NAME_ZOOM) / 0.08);

        if (far) {
          /* From orbit everyone is one flat layer of dots, redrawn only when
           * the picture would actually differ. The lit line gets a halo and
           * carries its names. */
          const opening = clock < 2600;
          const key = `${Math.round(z * 600)}|${lineageVersion}|${yr}|${opening ? clock : 'x'}`;
          if (key !== lastDotKey) {
            lastDotKey = key;
            dotLayer.clear();
            const r = Math.max(NODE_R, (MIN_DOT_PX * 0.7) / z);
            for (const [id, node] of frame.nodes) {
              const cn = nodes.get(id);
              if (!cn) continue;
              const open = opening ? easeBud(progressAt(schedule.get(id), clock)) : 1;
              if (open <= 0) continue;
              const a = presence(id, cn.person) * Math.min(1, open * 1.3) * entrance;
              dotLayer.circle(node.x, node.y, r * open).fill({ color: tintFor(cn.person), alpha: a });
              if (node.isFocus) dotLayer.circle(node.x, node.y, r * open + 2.4 / z).stroke({ color: TERRA, width: 1.6 / z, alpha: 0.9 });
            }
            if (lineage) {
              for (const id of lineage) {
                const node = frame.nodes.get(id);
                if (node) dotLayer.circle(node.x, node.y, r + 1.2 / z).stroke({ color: TERRA, width: 0.9 / z, alpha: 0.5 });
              }
            }
          }
          if (lineage) {
            // Names along the lit line, once generations are far enough
            // apart on screen to carry a line of type each; otherwise only
            // the person themselves.
            const rPx = Math.max(NODE_R * z, MIN_DOT_PX * 0.7);
            const roomy = ROW_GAP * z >= 15;
            for (const id of roomy ? lineage : [currentFocus]) {
              const node = frame.nodes.get(id), cn = nodes.get(id);
              if (!node || !cn) continue;
              const sx = anchorX.value + node.x * z, sy = anchorY.value + node.y * z;
              if (sx < -60 || sx > W + 60 || sy < -20 || sy > H + 20) continue;
              cands.push({ id, person: cn.person, sx, sy, rPx, row: node.row, pri: node.isFocus ? 0 : 1, alpha: 0.9 * entrance });
            }
          }
        } else {
          for (const [id, node] of frame.nodes) {
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
            if (cn.sub) cn.sub.visible = showSub;
            const pres = presence(id, cn.person);
            cn.root.alpha *= pres;
            if (z > PHOTO_ZOOM && cn.pendingPhoto) { cn.person = { ...cn.person, photo: cn.pendingPhoto }; cn.pendingPhoto = null; cn.loadPhoto(cn.baseR); }
            const lit = !lineage || lineage.has(id);
            if ((z > NAME_ZOOM || lit) && open > 0.5 && sx > -80 && sx < W + 80 && sy > -40 && sy < H + 40) {
              const rPx = NODE_R * z * cn.root.scale.x;
              cands.push({ id, person: cn.person, sx, sy, rPx, row: node.row, pri: node.isFocus ? 0 : lit && lineage ? 1 : 2, alpha: (lit && lineage ? 1 : nameFade) * pres * Math.min(1, open * 1.3) });
            }
          }
        }
        labelEase = Math.min(1, dt * 14); // settle in ~150ms regardless of frame rate
        placeLabels(cands, z, nameScale);

        /* The era axis: a graticule. Labels sit at the left edge of the
         * viewport, tucked just under the top edge of their generation's
         * band — the quiet strip between rows, where a portrait at the left
         * edge never sits — and thinned when rows are tighter on screen
         * than a label. */
        const rowPx = ROW_GAP * z;
        const step = Math.max(1, Math.ceil(22 / rowPx));
        const axisAlpha = entrance * (lineage ? 0.7 : 0.85);
        const tuck = rowPx > 40 ? rowPx * 0.5 - 12 : 0;
        for (let i = 0; i < eraTexts.length; i++) {
          const t = eraTexts[i];
          const sy = anchorY.value + t.__y * z - tuck;
          const on = i % step === 0 && sy > 54 && sy < H - 72;
          t.visible = on;
          if (on) { t.position.set(12, sy); t.alpha = axisAlpha; }
        }

        if (defl.size) drawAllBonds(deflOf);
        else drawReaches(null);
        reportEdges();
      });
      let lastDotKey = '';

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

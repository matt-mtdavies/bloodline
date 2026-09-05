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
import { composePortrait } from './portrait.js';
import { buildNamePill, layoutLabels } from './nameplate.js';
import { Scalar, ambientOffset, Deflection, rubberBand, SWAY_POD, SWAY_BRANCH } from '../canopy/motion.js';
import { drawBonds, CanopyNode, easeBud, progressAt, tintFor, descentPath, liveAnchor, livePos } from '../canopy/render.js';
import { ancestorsWithDistance, descendantsWithDistance, isBioOrAdoptive } from '../../data/graph.js';
import { BirthEffect } from '../birth.js';

const TAP_SLOP = 8;
const MIN_DOT_PX = 3.4;          // a person never shrinks below a visible dot
const NAME_ZOOM = 0.22;          // names once a portrait is ~24px across
const SUB_ZOOM = 0.82;           // dates a little later
const PHOTO_ZOOM = 0.26;         // portraits load once you're this close
const DOT_ZOOM = 0.16;           // below this a person is a dot, not a portrait container
/* And below THIS the map shows territories rather than people at all: soft
 * bounded regions for the branches, named. The progression is the family as
 * geography, then as individuals, then as faces. */
/* Above this many people the whole-family view stops drawing individuals
 * and draws named branch territories instead. Not a preference: a canvas
 * cannot hold thousands of per-person shapes at orbit — that is what took
 * the renderer down at 5,000 — and a thousand identical dots was never
 * geography anyway. Below it, nothing changes: the silhouette of dots is
 * affordable and reads as the family's own shape. */
const FAR_DOT_BUDGET = 2500;
const FLY_ZOOM = 0.9;
const LAND_Y = 0.42;             // where a flight lands its person (a little above centre: children stay clear of the foot)
const ERA_MARGIN_PX = 96;        // screen pixels reserved for the era axis at the fit zoom
const BRANCH = 0x8a7563;
const TERRA = 0xc2603a;
const GOLD = 0xb0802f;
const INK = 0x2b2622;
const INK_SOFT = 0x6b6259;
const DIM = 0.42;                // everyone outside a lit bloodline
/* The portrait lens: the selected person's immediate family, composed and
 * lifted into the foreground. It only makes sense once the camera is close
 * enough for a face to be a face — from orbit the map IS the picture. That
 * threshold is measured in SCREEN PIXELS PER PERSON, not in zoom: a phone
 * frames the same composition at roughly half a desktop's zoom, so an
 * absolute cutoff left the lens permanently half-risen on a small screen. */
const LENS_MIN_PX = 34;          // disc diameter at which the lens starts to rise
const LENS_FULL_PX = 50;         // ...and at which it is fully up
const PORTRAIT_MAP_DIM = 0.3;    // the map, while a portrait is held over it
const FULLY_GROWN = { bonds: new Map(), nodes: new Map(), reduced: false };
const ZERO_AMBIENT = { x: 0, y: 0, scale: 1 }; // a lens portrait's fixed pose: no drift, no hover
const LABEL_GAP = 16; // matches organic's own baseRadius+16 pill placement
// The desktop on-screen zoom controls (ZoomControls.jsx) step by this factor
// per click — the exact figure BubbleTree's own zoom buttons use, so the two
// views feel like the same control rather than two different ones that
// happen to look alike.
const ZOOM_BUTTON_FACTOR = 1.35;
const ZOOM_LIMIT_EPS = 0.02;

function yearOf(s) {
  const m = String(s || '').match(/\d{4}/);
  return m ? Number(m[0]) : null;
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (p) => p * p * (3 - 2 * p);
const firstName = (p) => (p?.display_name || '').trim().split(/\s+/)[0] || '';
const byGender = (p, f, m, other) => (p?.gender === 'female' ? f : p?.gender === 'male' ? m : other);

export default function AtlasStage({
  graph, focusId, year = null, onSelect, onOpen, onLayout, onEdge, apiRef,
  reducedMotion = false,
  /* Chrome the map must stay clear of: the app mounts this behind a real top
   * bar, the lab behind its own thin one. Everything that has to sit inside
   * the readable band — the framing, where a flight lands, the era axis, the
   * name layer, the edge markers — measures from these rather than from the
   * raw canvas edges. Same convention (and same reason) as CanopyTree's. */
  topInset = 0,
  bottomInset = 0,
}) {
  const hostRef = useRef(null);
  const graphRef = useRef(graph); graphRef.current = graph;
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  const onOpenRef = useRef(onOpen); onOpenRef.current = onOpen;
  const onLayoutRef = useRef(onLayout); onLayoutRef.current = onLayout;
  const onEdgeRef = useRef(onEdge); onEdgeRef.current = onEdge;
  const yearRef = useRef(year); yearRef.current = year;
  /* The stage initialises asynchronously (Pixi's own `app.init`), so the
   * mount-time `focusId`/`graph` effects below run while `innerApi` is still
   * null and no-op. The lab never noticed — it opens with no focus and sets
   * one on a timer — but the app mounts this view with someone already in
   * focus, and without this ref that person was silently never travelled to.
   * Read once initialisation finishes; see the arrival at the end of the
   * effect. */
  const focusIdRef = useRef(focusId); focusIdRef.current = focusId;
  const insetRef = useRef({ topInset, bottomInset });
  insetRef.current = { topInset, bottomInset };
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
      const territoryLayer = new Graphics(); // branch regions, for the whole-family view
      const dotLayer = new Graphics();     // everyone as a dot, for the far view
      const nodeLayer = new Container();
      const fxLayer = new Container();     // Time mode's birth-arrival celebrations
      /* The lens sits over the map, in world space, so it pans and zooms with
       * the geography rather than floating over it as a panel. */
      const portraitLayer = new Container();
      const portraitBonds = new Graphics();
      const portraitNodes = new Container();
      // Labels get their own top layer so a name is never clipped under a
      // neighbouring portrait in a tightly packed row.
      const portraitLabels = new Container();
      portraitLayer.addChild(portraitBonds, portraitNodes, portraitLabels);
      portraitLayer.visible = false;
      world.addChild(bgLayer, territoryLayer, farBonds, longBonds, lateralBonds, nearBonds, litBonds, dotLayer, nodeLayer, portraitLayer, fxLayer);
      /* Screen space: labels and the axis hold a constant size and stick to
       * the viewport, the way a map's type and graticule do. */
      const labelLayer = new Container();
      const axisLayer = new Container();
      // Branch names get their own layer: drawEras clears the axis layer, and
      // territory labels are rebuilt on a different schedule entirely.
      const branchLayer = new Container();
      app.stage.addChild(world, branchLayer, labelLayer, axisLayer);
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
      /* Time mode's birth-arrival celebration — the same BirthEffect the
       * organic tree plays when its own progressive reveal crosses someone's
       * birth year, ported as an overlay rather than copied: Atlas keeps the
       * whole family laid out permanently (see the file header) and only
       * DIMS someone who isn't born yet, it never removes their node the way
       * organic's structural reveal does — so there is no "a bubble just
       * appeared" moment to hang the effect on here. Instead this tracks who
       * reads as truly alive at the scrubbed year (`wasAliveIds`, mirroring
       * App.jsx's own `aliveAtYear`) and fires the effect the exact tick a
       * newcomer's OWN birth year is reached, at their permanent map
       * position — the mote still descends from their parents' fixed spot,
       * it just lands on a face that was already dimly there rather than one
       * that didn't exist a moment ago. `lastYearChecked` is a sentinel
       * (not `null`, since `null` is Time mode's own "off" value) so the
       * very first tick after Time mode turns on — or after a rebuild —
       * only seeds the baseline, exactly like organic's `fxSeeded`: nothing
       * fireworks for a family that was simply already mid-timeline. */
      const birthFx = new Map();   // id -> BirthEffect, in flight
      let wasAliveIds = new Set();
      let lastYearChecked = 'unset';

      const zoom = new Scalar(0.05, 1.1);
      const anchorX = new Scalar(0, 1.15);
      const anchorY = new Scalar(0, 1.15);
      let flight = null;           // an arc in progress (see flyTo)
      /* What the viewer last asked to see — 'all' or 'person'. Resize and
       * orientation re-apply this rather than guessing from the camera. */
      let framing = 'all';

      // Map type carries a paper halo so it stays legible across a line.
      const labelStyle = new TextStyle({ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 14, fontWeight: '600', fill: INK, align: 'center', stroke: { color: 0xfdfbf7, width: 3, join: 'round' } });
      const eraStyle = new TextStyle({ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 12, fontWeight: '600', fill: GOLD, letterSpacing: 1.2, stroke: { color: 0xfdfbf7, width: 3, join: 'round' } });
      const branchStyle = new TextStyle({ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 15, fontWeight: '600', fill: INK, letterSpacing: 0.6, align: 'center', stroke: { color: 0xfdfbf7, width: 4, join: 'round' } });
      const branchSubStyle = new TextStyle({ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 11.5, fill: INK_SOFT, align: 'center', stroke: { color: 0xfdfbf7, width: 3, join: 'round' } });

      /* ── build the world ─────────────────────────────────────────────── */
      const labels = new Map();    // id -> Text (screen-space name)
      const eraTexts = [];
      const build = () => {
        const g = graphRef.current;
        disposePortrait();
        frame = planAtlas(g);
        for (const [, n] of nodes) n.destroy();
        nodes.clear();
        nodeLayer.removeChildren();
        for (const [, fx] of birthFx) fx.destroy();
        birthFx.clear();
        wasAliveIds = new Set();
        lastYearChecked = 'unset';
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
        buildUnitMaps();
        splitBonds();
        drawAllBonds(null);
        drawFar();
        drawTerritories();
        drawEras();
        drawLit();
        scheduleEntrance(null);
        onLayoutRef.current?.(frame.stats, frame);
      };

      /* One id->unit lookup per frame, shared by every consumer and handed
        * to Canopy's renderer (see liveAnchor), plus a member->unit lookup.
        * Rebuilding these per call — or scanning the array — is O(units)
        * inside loops that are already O(bonds), which is what made this view
        * hang at 2,000 people and crash the tab at 3,000. */
      let unitsById = new Map();
      let unitOfMember = new Map();
      const unitById = () => unitsById;
      const buildUnitMaps = () => {
        unitsById = new Map(frame.units.map((u) => [u.id, u]));
        frame.unitById = unitsById;
        unitOfMember = new Map();
        for (const u of frame.units) {
          if (u.anchorOnly) continue;
          for (const m of u.memberIds) unitOfMember.set(m, u);
        }
      };
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
      /* Resize and orientation. Pixi resizes its own canvas, but the fit
        * zoom and the composition are computed from the viewport and would
        * otherwise stay at whatever the last size implied — rotate a phone
        * and the map is framed for the old shape. Debounced so a desktop
        * drag-resize recomposes once it settles rather than every frame. */
      let lastW = 0, lastH = 0, resizeAt = 0;
      const noteViewport = () => {
        const W = app.screen.width, H = app.screen.height;
        if (W === lastW && H === lastH) return;
        lastW = W; lastH = H;
        resizeAt = performance.now();
      };
      const applyResize = () => {
        if (!resizeAt || performance.now() - resizeAt < 180) return;
        resizeAt = 0;
        drawFar();           // fitZoom is derived from the viewport
        drawAllBonds(null);
        // Re-apply the framing the viewer ASKED for, not whatever the camera
        // happens to hold: rotating after "Whole family" must re-fit the
        // whole family, not silently swap it for a close-up of one person.
        // Instant: a window resize is not a journey, and animating one would
        // read as the map wandering off on its own.
        if (framing === 'person' && currentFocus) flyTo(currentFocus, zoom.value);
        else fitAll({ instant: true });
      };

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
        /* A link between two PLATES is held back until you are close enough
         * to be inside one. Only ~5-7% of parent links span plates, but each
         * is enormous, and drawn from the overview they sweep right across
         * the atlas and bury the structure inside every plate — measurably
         * worse than the smear plating exists to fix. An atlas does not draw
         * the roads between its plates either; it marks where they continue,
         * which is what the edge markers already do. Your own lit bloodline
         * is the deliberate exception (see drawLit) — lighting it threads
         * your line through whichever plates it actually runs through. */
        const platesQuiet = zoom.value < fitZoom * 3;
        longFrame.bonds.forEach((b, i) => {
          if (bondHeld(b)) return;
          if (b.crossPlate && platesQuiet) return;
          const pu = byId.get(b.parentUnit), c = livePoint(b.child, offsetOf);
          const a = pu ? anchorOf(pu) : null;
          if (a && c && inside(a) && inside(c)) { wholeLong.push({ b, a, c }); sig += `L${i},`; }
        });
        lateralFrame.bonds.forEach((b, i) => {
          if (bondHeld(b)) return;
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
      /* While the lens holds a family, the map's own drawing of the links
       * BETWEEN those same people comes out too — otherwise a couple's pod
       * capsule stays behind as a smudge under the composed one, and the rule
       * that nobody appears twice would hold for the faces but not the lines
       * joining them. Everything with even one end still out on the map is
       * left exactly as it is: the lens is a foreground, not a hole. */
      let heldFrame = null;
      const bondHeld = (b) => {
        const held = heldFrame?.nodes;
        if (!held) return false;
        if (b.kind === 'descent') {
          if (!held.has(b.child)) return false;
          const pu = unitById().get(b.parentUnit);
          const ids = pu ? (pu.anchorMemberIds?.length ? pu.anchorMemberIds : pu.memberIds) : [];
          return ids.length > 0 && ids.every((m) => held.has(m));
        }
        return held.has(b.a) && held.has(b.b);
      };
      const unheld = (f) => (heldFrame ? { ...f, bonds: f.bonds.filter((b) => !bondHeld(b)) } : f);
      const drawAllBonds = (offsetOf) => {
        drawBonds(nearBonds, unheld(nearFrame), FULLY_GROWN, 1e9, offsetOf);
        drawReaches(offsetOf, true);
        drawLit(offsetOf);
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
          if (bondHeld(b)) return false;
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
        const { topInset: ti, bottomInset: bi } = insetRef.current;
        /* The era axis owns a strip down the left — but only when there IS
         * one. A plated atlas has no global generation rows to label and
         * publishes no eras (see plates.js), and reserving the strip anyway
         * threw away 96px of a 390px phone: a quarter of the width, for a
         * margin holding nothing. */
        const eraMargin = frame.eras.length ? ERA_MARGIN_PX : 0;
        fitZoom = Math.max(0.003, Math.min(1.2, Math.min(
          (W - 60 - eraMargin) / Math.max(1, bw),
          (H - 60 - ti - bi) / Math.max(1, bh),
        )));
        const width = 1.1 / fitZoom;
        const byId = unitById();
        for (const b of frame.bonds) {
          if (b.kind !== 'descent' || b.crossPlate) continue;
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

      /* Branch territories — the whole-family view's geography.
       *
       * Each branch already occupies a contiguous span per generation (the
       * tidy tree put it there), so a territory is that span drawn as a
       * soft region: no clustering, no invented boundaries. Warm washes at
       * very low alpha, rotating through a few hues so neighbours separate
       * without the map turning into a chart. A dozen-odd regions of a few
       * rows each is a handful of shapes, where the people they stand for
       * were thousands. */
      const TERRITORY_TINTS = [0xc2603a, 0x7d8a72, 0xb0802f, 0x8a7563, 0x9a8570, 0x79837f];
      const branchLabels = [];
      const drawTerritories = () => {
        territoryLayer.clear();
        for (const t of branchLabels) t.destroy();
        branchLabels.length = 0;
        branchLayer.removeChildren();
        const list = frame.branches || [];
        list.forEach((b, i) => {
          const tint = TERRITORY_TINTS[i % TERRITORY_TINTS.length];
          const pad = ROW_GAP * 0.34;
          for (const band of b.bands) {
            territoryLayer.roundRect(band.x0 - pad, band.y - ROW_GAP * 0.42, (band.x1 - band.x0) + pad * 2, ROW_GAP * 0.84, ROW_GAP * 0.3)
              .fill({ color: tint, alpha: b.minor ? 0.05 : 0.16 });
          }
          if (b.minor || !b.surname) return;
          const name = new Text({ text: b.surname, style: branchStyle });
          name.anchor.set(0.5, 1);
          const span = b.from && b.to && b.from !== b.to ? `${b.people} people · ${b.from}–${b.to}` : `${b.people} people`;
          const sub = new Text({ text: span, style: branchSubStyle });
          sub.anchor.set(0.5, 0);
          name.__branch = b; sub.__branch = b; sub.__isSub = true;
          branchLayer.addChild(name, sub);
          branchLabels.push(name, sub);
        });
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
      /* Back out to the whole family.
       *
       * This used to hand the camera's own springs a target and let them
       * ease there — which works for a nudge and fails completely for the
       * journey this actually is. Backing out of a landed portrait on a
       * 1,200-person tree is a SIXTY-FOLD zoom change (0.9 → ~0.015), and a
       * spring eases linearly in zoom VALUE: measured, it covered barely a
       * sixth of that in three seconds, and was still visibly short — the
       * family cropped, the framing wrong — six seconds after the tap. The
       * one control that says "show me everything" was the slowest thing in
       * the view.
       *
       * A flight already solves this: stepFlight interpolates zoom in LOG
       * space, so each frame covers a constant RATIO rather than a constant
       * amount, which is how a zoom is actually perceived. Reusing it here
       * lands the whole family in about a second and a half, exactly framed,
       * instead of drifting toward it. No arc (`bump: 0`) — we are already
       * travelling outward, so rising first would be a rise to nowhere. */
      const fitAll = ({ instant = false } = {}) => {
        if (!frame) return;
        framing = 'all';
        const W = app.screen.width, H = app.screen.height;
        const { topInset: ti, bottomInset: bi } = insetRef.current;
        const cx = (frame.bounds.minX + frame.bounds.maxX) / 2;
        const cy = (frame.bounds.minY + frame.bounds.maxY) / 2;
        const z1 = fitZoom;
        // The era axis owns a strip down the left, so the family sits just
        // right of true centre — the same offset the old anchor maths baked
        // in, expressed as the screen point the map's centre lands on. With
        // no axis (a plated atlas) there is nothing to make room for, and
        // the family sits dead centre.
        const lx = W / 2 + (frame.eras.length ? ERA_MARGIN_PX / 2 : 0), ly = ti + (H - ti - bi) / 2;
        if (instant || reducedMotion) {
          flight = null;
          zoom.set(z1); anchorX.set(lx - cx * z1); anchorY.set(ly - cy * z1);
          return;
        }
        const z0 = zoom.value;
        const c0 = { x: (lx - anchorX.value) / z0, y: (ly - anchorY.value) / z0 };
        const dur = 700 + Math.min(800, Math.abs(Math.log(z1 / z0)) * 190);
        flight = { t0: performance.now(), dur, z0, z1, c0, c1: { x: cx, y: cy }, bump: 0, lx, ly };
      };
      /* A flight is an arc: the camera rises as it travels and settles as it
       * arrives, so a long journey reads as a journey rather than a cut. The
       * rise is sized to the distance — across a family, up to the far view;
       * to the next pod over, hardly at all. */
      const flyTo = (id, targetZoom = FLY_ZOOM) => {
        const n = frame?.nodes.get(id);
        if (!n) return;
        framing = 'person';
        const W = app.screen.width, H = app.screen.height;
        const { topInset: ti, bottomInset: bi } = insetRef.current;
        /* A flight to the selected person is really a flight to their FAMILY:
         * the lens gathers a generation above and below them, so the camera
         * frames that whole composition rather than landing on the person and
         * leaving their parents under the top bar. */
        const lens = id === currentFocus && portrait ? portrait.frame.bounds : null;
        const band = Math.max(120, H - ti - bi);
        const fitLens = lens
          ? Math.min((W - 90) / Math.max(1, lens.maxX - lens.minX), (band - 90) / Math.max(1, lens.maxY - lens.minY))
          : Infinity;
        // Never land so far out that the lens can only half-rise: fitting the
        // whole composition matters less than the composition being readable.
        const z1 = Math.max(fitZoom, Math.min(1.4, targetZoom, Math.max(LENS_FULL_PX / (NODE_R * 2), fitLens)));
        const z0 = zoom.value;
        const lx = W / 2, ly = ti + band * (lens ? 0.5 : LAND_Y);
        const c0 = { x: (lx - anchorX.value) / z0, y: (ly - anchorY.value) / z0 };
        const c1 = { x: n.x + (lens ? (lens.minX + lens.maxX) / 2 : 0), y: n.y + (lens ? (lens.minY + lens.maxY) / 2 : 0) };
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

      /* ── the portrait lens ───────────────────────────────────────────── */
      /* A map is not a family. Landing on someone in a thousand-person tree
       * leaves the people who actually matter to them scattered by the
       * layout's own logic — a mother two screens left because that is where
       * her line runs. So selection gathers them: composePortrait builds the
       * immediate family around the person, in world offsets from their own
       * place, and it is drawn in the foreground while the map settles back.
       * Everyone lifted fades out of their permanent place for exactly as
       * long as they are held here, so nobody is ever on screen twice. */
      let portrait = null;         // { frame, nodes: Map<id, CanopyNode> }
      let portraitT = 0;           // 0..1 how present the lens is
      const portraitLabelNodes = new Map(); // id -> pill Container, so dispose can destroy them
      const disposePortrait = () => {
        if (portrait) for (const [, cn] of portrait.nodes) cn.destroy();
        portrait = null;
        // A new family gathers as you LAND on them, rather than the old
        // composition teleporting across the map mid-flight at full strength.
        portraitT = 0;
        portraitNodes.removeChildren();
        portraitBonds.clear();
        for (const [, pill] of portraitLabelNodes) pill.destroy({ children: true });
        portraitLabelNodes.clear();
        portraitLabels.removeChildren();
      };
      const buildPortrait = () => {
        disposePortrait();
        const base = currentFocus ? frame?.nodes.get(currentFocus) : null;
        if (!base) return;
        const p = composePortrait(graphRef.current, currentFocus);
        // One person alone is not a gathering — the map already says it
        // better than a composed group of one would.
        if (!p || p.count < 2) return;
        portraitLayer.position.set(base.x, base.y);
        const cns = new Map();
        const labelDefs = [];
        const pills = new Map();
        for (const [id, node] of p.nodes) {
          const person = graphRef.current.byId.get(id);
          if (!person) continue;
          const cn = new CanopyNode(person, node);
          cn.person = person;
          cn.apply(node, 1, ZERO_AMBIENT, null);
          cns.set(id, cn);
          portraitNodes.addChild(cn.root);
          // The lens gets its own compact pill name (see nameplate.js) —
          // Canopy's own stacked serif label, built into every CanopyNode,
          // is hidden here the same way the main map already hides it in
          // favour of ITS OWN label layer (see build(), above).
          if (cn.name) cn.name.visible = false;
          if (cn.sub) cn.sub.visible = false;
          // The focus carries their dates; everyone else is a name. The
          // caption is part of the pill now (see nameplate.js) rather than
          // Canopy's own serif `sub` left stranded beneath it.
          const { container: pill, halfWidth } = buildNamePill(person, { withDates: id === currentFocus });
          pills.set(id, pill);
          labelDefs.push({ id, x: node.x, y: node.y + node.r + LABEL_GAP, halfWidth });
        }
        const placed = layoutLabels(labelDefs);
        for (const [id, pill] of pills) {
          const own = p.nodes.get(id);
          const pos = placed.get(id) || { x: own.x, y: own.y + own.r + LABEL_GAP };
          pill.position.set(pos.x, pos.y);
          portraitLabels.addChild(pill);
          portraitLabelNodes.set(id, pill);
        }
        drawBonds(portraitBonds, p, FULLY_GROWN, 1e9, null);
        portrait = { frame: p, nodes: cns };
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
        buildPortrait();
        if (!currentFocus) { lineage = null; drawLit(); return; }
        const g = graphRef.current;
        const set = new Set([currentFocus]);
        for (const [aid] of ancestorsWithDistance(g, currentFocus, 60)) set.add(aid);
        for (const [did] of descendantsWithDistance(g, currentFocus, 60)) set.add(did);
        const u = unitOfMember.get(currentFocus);
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
          /* An edge marker points at a relative the map has pushed off
           * screen. Once the lens is up they are not off screen — they are
           * gathered in it — so pointing away at them would be both wrong
           * and drawn straight over the composition. */
          const held = portraitT > 0.5 ? portrait?.frame.nodes : null;
          const add = (id, relation) => { if (id !== currentFocus && frame.nodes.has(id) && !held?.has(id)) rels.push({ id, relation }); };
          for (const p of g.parents(currentFocus)) add(p.id, isBioOrAdoptive(p.qualifier) ? byGender(g.byId.get(p.id), 'Mother', 'Father', 'Parent') : 'Step-parent');
          for (const c of g.children(currentFocus)) add(c.id, byGender(g.byId.get(c.id), 'Daughter', 'Son', 'Child'));
          for (const pt of g.partners(currentFocus)) add(pt.id, pt.status === 'former' ? 'Former partner' : 'Partner');
          for (const s of g.siblings(currentFocus)) add(s.id, byGender(g.byId.get(s.id), 'Sister', 'Brother', 'Sibling'));
          // Insets keep a whole pill on screen, clear of the corner buttons
          // above and the foot below.
          const { topInset: ti, bottomInset: bi } = insetRef.current;
          const inset = Math.min(120, W * 0.26), top = ti + 22, bottom = bi + 26;
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
      /* The desktop on-screen zoom buttons (ZoomControls.jsx) — a discrete
       * step anchored on the middle of the readable band, since a button
       * click has no cursor position of its own to anchor on. Mirrors
       * BubbleTree's own zoomStep almost exactly (same factor, same
       * "already at the limit" check against the last COMMANDED target
       * rather than the live easing value, for the same reason: a click
       * fired the instant after reaching the floor would otherwise report
       * "still moving" for several frames while the ease catches up) —
       * eased via the same Scalar springs a flight already uses, rather
       * than zoomAbout's instant `.set()`, so a click reads as a deliberate
       * step, not a snap. */
      const zoomStep = (dir) => {
        if (flight) return { zoom: zoom.value, atLimit: true };
        const lo = fitZoom * 0.6, hi = 1.6;
        const priorTarget = zoom.target;
        const alreadyAtLimit = dir > 0 ? priorTarget >= hi - ZOOM_LIMIT_EPS : priorTarget <= lo + ZOOM_LIMIT_EPS;
        const before = Math.max(lo, Math.min(hi, zoom.value));
        const nz = Math.max(lo, Math.min(hi, before * (dir > 0 ? ZOOM_BUTTON_FACTOR : 1 / ZOOM_BUTTON_FACTOR)));
        const W = app.screen.width, H = app.screen.height;
        const { topInset: ti, bottomInset: bi } = insetRef.current;
        const sx = W / 2, sy = ti + (H - ti - bi) / 2;
        const wx = (sx - anchorX.value) / zoom.value, wy = (sy - anchorY.value) / zoom.value;
        if (reducedMotion) { zoom.set(nz); anchorX.set(sx - wx * nz); anchorY.set(sy - wy * nz); }
        else { zoom.to(nz); anchorX.to(sx - wx * nz); anchorY.to(sy - wy * nz); }
        return { zoom: nz, atLimit: alreadyAtLimit };
      };
      // The ZoomControls "fit" button: back to wherever you actually are —
      // the person in focus if there is one (the same framing a flight
      // already lands on, lens included), the whole family otherwise. A
      // second, identically-behaving door onto the exact same two actions
      // the view already offers (arriveAt/flyTo and the "Whole family"
      // pill) rather than a third distinct camera behaviour.
      const recenter = () => (currentFocus ? flyTo(currentFocus) : fitAll());
      const idFromTarget = (t) => { let n = t; while (n && n.__canopyId === undefined) n = n.parent; return n ? n.__canopyId : null; };
      const swayTargets = (id) => {
        const out = [];
        const unit = unitOfMember.get(id);
        if (unit) for (const m of unit.memberIds) if (m !== id) out.push([m, SWAY_POD]);
        for (const b of frame.bonds) {
          if (b.kind === 'descent') {
            const pu = unitsById.get(b.parentUnit);
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
      const placeLabels = (cands, z, scale, W) => {
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
          // Nudged inside the viewport rather than clipped at its edge: a
          // surname sliced in half by the screen edge is worse than a name
          // sitting a few pixels off its person. A name too wide for the
          // screen is skipped instead of being pinned meaninglessly.
          if (hw * 2 > W - 12) continue;
          const x = Math.max(hw + 6, Math.min(W - hw - 6, c.sx));
          let placedTier = -1;
          for (let k = 0; k < 2 && placedTier < 0; k++) {
            const y = c.sy + c.rPx + 5 + k * lineH;
            const band = Math.round(y / lineH);
            if (free(band, x - hw, x + hw)) { take(band, x - hw, x + hw); placedTier = k; t.position.set(x, y); }
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
        noteViewport();
        applyResize();
        if (flight) stepFlight();
        else { zoom.step(dt); anchorX.step(dt); anchorY.step(dt); }
        const z = zoom.value;
        world.scale.set(z);
        world.position.set(anchorX.value, anchorY.value);

        for (const [id, d] of defl) { d.step(dt); if (d.resting && id !== drag.id) defl.delete(id); }

        // ── Birth celebrations in flight (Time mode) ──────────────────────
        if (birthFx.size) {
          for (const [id, fx] of birthFx) {
            fx.update(dt);
            if (fx.done) { fx.destroy(); birthFx.delete(id); }
          }
        }

        // Level of detail, all derived from one number.
        const dotScale = Math.max(1, MIN_DOT_PX / (NODE_R * z));
        const shadowFade = clamp01((z - 0.09) / 0.2);
        const showSub = z > SUB_ZOOM;
        const entrance = Math.min(1, clock / 900);
        const nearAlpha = clamp01((z - fitZoom * 1.6) / (fitZoom * 3));
        const farAlpha = z < fitZoom * 1.8 ? 1 : clamp01(1 - (z - fitZoom * 1.8) / (fitZoom * 2.4));
        /* The lens rises as you arrive and settles away as you pull back out
         * — one number, eased, so the map never snaps between two states. */
        const wantPortrait = portrait ? clamp01((NODE_R * 2 * z - LENS_MIN_PX) / (LENS_FULL_PX - LENS_MIN_PX)) : 0;
        portraitT += (wantPortrait - portraitT) * (reducedMotion ? 1 : Math.min(1, dt * 7));
        if (portraitT < 0.002) portraitT = 0;
        portraitLayer.visible = portraitT > 0.01;
        portraitLayer.alpha = portraitT;
        /* A lens portrait is built once and never re-laid-out — nobody in
         * it moves — so `apply()` was only ever called at construction, a
         * single frame before an async photo even has a chance to decode.
         * The cross-fade from monogram to photo lives entirely INSIDE
         * apply() (see CanopyNode, above), gated on `photoSprite.alpha < 1`
         * — the map's own portraits get this for free because their apply()
         * runs every tick already; a lens portrait never got a second call
         * at all, so a photo that finished loading sat at its own initial
         * alpha of 0 forever, invisible behind an untouched monogram. This
         * is the fix: run the same call every tick here too, with the exact
         * fixed pose it was built with (no ambient drift, no hover) — cheap
         * regardless, since a portrait is at most a few dozen people. */
        if (portrait) for (const [id, cn] of portrait.nodes) {
          const node = portrait.frame.nodes.get(id);
          if (!node) continue;
          cn.apply(node, 1, ZERO_AMBIENT, null);
          const settledScale = cn.root.scale.x;
          // Time mode reaches the lens too: someone gathered into a
          // composed family group is still a person on the SAME map, and
          // should fade the same way their own map dot would if you pulled
          // back out. Same rule as presence() below, year-only — the lens
          // deliberately never dims for the lit bloodline, only for time.
          const yr = yearRef.current;
          if (yr != null) {
            const b = yearOf(cn.person.birth_date), d = yearOf(cn.person.death_date);
            let a = 1;
            if (b != null && b > yr) a = 0.05;
            else if (d != null && d < yr) a = 0.22;
            else if (b == null) a = 0.5;
            cn.root.alpha *= a;
          }
          // A birth celebration reaches into the lens too — the birthday
          // person is often exactly who you composed the lens around, or
          // one of the family gathered alongside them, and it would look
          // like a bug for the map's own bubble to celebrate an arrival
          // while their lens portrait, right next to it, just sits there
          // already fully formed. Same override as the map's own loop.
          const birth = birthFx.get(id);
          if (birth && !birth.bubbleSettled) {
            const ent = birth.bubbleEntrance();
            cn.root.scale.set(settledScale * ent.scale);
            cn.root.alpha *= ent.alpha;
          }
        }
        // The map's own lines between held people come out once the lens has
        // clearly taken over, and go back the moment it lets go.
        const heldNow = portrait && portraitT > 0.5 ? portrait.frame : null;
        if (heldNow !== heldFrame) { heldFrame = heldNow; drawAllBonds(null); }
        const behind = 1 - portraitT * (1 - PORTRAIT_MAP_DIM);

        const dimBonds = (lineage ? DIM : 1) * behind;
        nearBonds.alpha = nearAlpha * entrance * dimBonds;
        longBonds.alpha = nearAlpha * 0.8 * entrance * dimBonds;
        lateralBonds.alpha = nearAlpha * 0.8 * entrance * dimBonds;
        litBonds.alpha = nearAlpha * entrance * behind;
        farBonds.alpha = farAlpha * entrance * (lineage ? 0.6 : 1);
        bgLayer.alpha = entrance;

        const W = app.screen.width, H = app.screen.height;
        const { topInset: topInsetPx, bottomInset: bottomInsetPx } = insetRef.current;
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

        /* The far view is either everyone as dots, or the branches as named
         * territories — whichever the family's size can actually carry. Both
         * hand over to portraits at DOT_ZOOM. Thresholds are relative to the
         * fit zoom, since "zoomed out" means something different for a
         * hundred people and for five thousand. */
        const far = z < DOT_ZOOM;
        const aggregated = (frame.stats?.people || 0) > FAR_DOT_BUDGET;
        const territoryAlpha = aggregated
          ? clamp01((fitZoom * 3.2 - z) / (fitZoom * 2.2)) * entrance
          : 0;
        territoryLayer.alpha = territoryAlpha * (lineage ? 0.55 : 1);
        territoryLayer.visible = territoryAlpha > 0.01;
        nodeLayer.visible = !far;
        fxLayer.visible = !far;

        /* Birth arrivals: who just crossed into life this scrub. Checked
         * only on an actual year change — a scrub or a play tick, not every
         * animation frame at a year that's just sitting still — the same
         * boundary App.jsx's own `aliveAtYear` memo draws for organic,
         * re-derived here per tick since this stage owns no React state of
         * its own to memoize against. */
        if (yr !== lastYearChecked) {
          const nowAliveIds = new Set();
          if (yr != null) {
            for (const [id] of frame.nodes) {
              const cn = nodes.get(id);
              if (!cn) continue;
              const b = yearOf(cn.person.birth_date), d = yearOf(cn.person.death_date);
              if ((b == null || b <= yr) && (d == null || d >= yr)) nowAliveIds.add(id);
            }
          }
          // `far` is skipped — from orbit there is no individual node to land
          // the mote on, and a family big enough to still be a dot silhouette
          // at this zoom is exactly the case the concurrent-effect cap below
          // exists to protect against anyway.
          if (lastYearChecked !== 'unset' && yr != null && !far && !reducedMotion) {
            const g = graphRef.current;
            // A birthday person gathered into the lens is composed at the
            // lens's own LOCAL position (an offset from the focus, not a
            // world coordinate — see buildPortrait's own
            // `portraitLayer.position.set(base.x, base.y)`, which is what
            // actually places the lens in the world; fxLayer is a sibling
            // of the lens, not a child of it, so it never inherits that
            // offset for free). Real, confirmed bug: without adding it back
            // in here, a lens member's birth mote landed wherever their
            // small local offset happened to fall when misread as a WORLD
            // coordinate — nowhere near them, and nowhere near anyone in
            // particular. Land the mote where they are actually seen,
            // same as the lens's own per-frame override does.
            const posOf = (pid) => {
              const n = portrait?.frame.nodes.get(pid);
              if (n) return { x: portraitLayer.position.x + n.x, y: portraitLayer.position.y + n.y };
              return frame.nodes.get(pid);
            };
            // Real report on a large (1,200+ person) family: the birth
            // celebration "only seemed to happen for out of focus people,
            // not the main ones in focus." Root cause — the concurrent-
            // effect cap (mirrors organic's own `births.size < 14`, there
            // to protect a dense simultaneous cluster from becoming visual
            // noise) used to gate the WHOLE creation pass at once: whichever
            // ids happened to iterate first claimed the 14 slots, so on a
            // busy year a background stranger sharing that birth year could
            // fill every slot before the person actually being watched —
            // the one who's ACTIVE, or gathered into their own lens — ever
            // got a turn. Sorting candidates so the focus/lens always go
            // first, and checking the cap per person rather than upfront,
            // guarantees whoever you're actually looking at is never the
            // one left out.
            const inFocus = (id) => id === currentFocus || !!portrait?.frame.nodes.has(id);
            const candidates = [];
            for (const id of nowAliveIds) {
              if (wasAliveIds.has(id) || birthFx.has(id)) continue;
              const cn = nodes.get(id);
              if (!cn || yearOf(cn.person.birth_date) !== yr) continue; // only a true birth, not "alive again" from rewinding past a death
              candidates.push(id);
            }
            candidates.sort((a, b) => Number(inFocus(b)) - Number(inFocus(a)));
            for (const id of candidates) {
              if (birthFx.size >= 14) break;
              const node = posOf(id);
              if (!node) continue;
              const born = yearOf(nodes.get(id).person.birth_date);
              const vps = g.parents(id).map((p) => posOf(p.id)).filter(Boolean);
              const origin = vps.length
                ? { x: vps.reduce((s, p) => s + p.x, 0) / vps.length, y: vps.reduce((s, p) => s + p.y, 0) / vps.length }
                : { x: node.x, y: node.y - NODE_R * 5 };
              const fx = new BirthEffect({ x: node.x, y: node.y }, origin, NODE_R, born);
              fxLayer.addChild(fx.root);
              birthFx.set(id, fx);
            }
          }
          wasAliveIds = nowAliveIds;
          lastYearChecked = yr;
        }

        const dotAlpha = aggregated ? clamp01((z - fitZoom * 1.6) / (fitZoom * 1.8)) : 1;
        dotLayer.visible = far && dotAlpha > 0.01;
        dotLayer.alpha = dotAlpha;
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
              if (sx < -60 || sx > W + 60 || sy < topInsetPx || sy > H - bottomInsetPx) continue;
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
            const settledScale = cn.root.scale.x; // before the far-zoom dot boost, below
            if (dotScale > 1) cn.root.scale.set(cn.root.scale.x * dotScale);
            if (cn.shadow) cn.shadow.alpha *= shadowFade;
            if (cn.sub) cn.sub.visible = showSub;
            // Held in the lens: fade out of the permanent place, so a lifted
            // person is in exactly one spot on screen at any moment.
            const held = portraitT > 0 && portrait.frame.nodes.has(id) ? 1 - portraitT : 1;
            const pres = presence(id, cn.person) * behind * held;
            cn.root.alpha *= pres;
            // While a birth celebration hasn't yet handed the bubble back
            // (see BirthEffect's own phase A/B), the EFFECT owns how the
            // node looks — invisible while its mote is still falling, then
            // popping in with an elastic overshoot exactly as it does for
            // the organic tree. Multiplies on top of the ordinary dimming
            // above rather than replacing it outright, so a birth landing
            // on someone in a dimmed lineage, or mid-lens-hold, still comes
            // in at the right final brightness once it settles.
            const birth = birthFx.get(id);
            if (birth && !birth.bubbleSettled) {
              const ent = birth.bubbleEntrance();
              cn.root.scale.set(settledScale * ent.scale * (dotScale > 1 ? dotScale : 1));
              cn.root.alpha *= ent.alpha;
            }
            if (z > PHOTO_ZOOM && cn.pendingPhoto) { cn.person = { ...cn.person, photo: cn.pendingPhoto }; cn.pendingPhoto = null; cn.loadPhoto(cn.baseR); }
            const lit = !lineage || lineage.has(id);
            // A name is culled against the READABLE band, not the canvas —
            // one drawn under the app's top bar is not a label, it is litter.
            /* Under a risen lens the map keeps its faces as geography but
             * hands the TYPE over: a background name colliding with a
             * composed one is the worst of both. */
            if ((z > NAME_ZOOM || lit) && open > 0.5 && pres > 0.06 + portraitT * 0.3 && sx > -80 && sx < W + 80 && sy > topInsetPx - 10 && sy < H - bottomInsetPx) {
              const rPx = NODE_R * z * cn.root.scale.x;
              cands.push({ id, person: cn.person, sx, sy, rPx, row: node.row, pri: node.isFocus ? 0 : lit && lineage ? 1 : 2, alpha: (lit && lineage ? 1 : nameFade) * pres * Math.min(1, open * 1.3) });
            }
          }
        }
        labelEase = Math.min(1, dt * 14); // settle in ~150ms regardless of frame rate
        placeLabels(cands, z, nameScale, W);

        /* Branch names sit over their own territory, at a constant size,
         * and only while the territories are the picture. */
        if (branchLabels.length) {
          const on = territoryAlpha > 0.02;
          /* A branch is named only where its territory actually is. Clamping
           * an off-screen branch's label to the viewport edge stacked every
           * one of them in the same corner — a pile of names belonging to
           * regions you cannot see. Off-screen branches simply go unnamed,
           * and the ones that remain are decluttered largest-first, so the
           * biggest territory always keeps its name. */
          const taken = [];
          const free = (l, r, t0, b0) => !taken.some(([a, b, c, d]) => r > a && l < b && b0 > c && t0 < d);
          for (const t of branchLabels) t.visible = false;
          for (let i = 0; i < branchLabels.length; i += 2) {
            if (!on) break;
            const name = branchLabels[i], sub = branchLabels[i + 1];
            const b = name.__branch;
            const sx = anchorX.value + b.x * z, sy = anchorY.value + b.y * z;
            if (sx < 60 || sx > W - 60) continue;
            const y = Math.max(topInsetPx + 20, Math.min(H - bottomInsetPx - 24, sy));
            const hw = Math.max(name.width, sub.width) / 2 + 8;
            if (!free(sx - hw, sx + hw, y - 20, y + 20)) continue;
            taken.push([sx - hw, sx + hw, y - 20, y + 20]);
            name.visible = true; sub.visible = true;
            name.alpha = territoryAlpha; sub.alpha = territoryAlpha * 0.85;
            name.position.set(sx, y - 3);
            sub.position.set(sx, y + 3);
          }
        }

        /* The era axis: a graticule. Labels sit at the left edge of the
         * viewport, tucked just under the top edge of their generation's
         * band — the quiet strip between rows, where a portrait at the left
         * edge never sits — and thinned when rows are tighter on screen
         * than a label. */
        const rowPx = ROW_GAP * z;
        // 22px between labels was the label's own height, which is not a gap
        // at all: nineteen generations came out as a cramped stack of type
        // with nothing between the lines. A graticule is meant to be quiet;
        // it needs real air, so thin harder and let more rows go unlabelled.
        const step = Math.max(1, Math.ceil(30 / rowPx));
        const axisAlpha = entrance * (lineage ? 0.7 : 0.85);
        const tuck = rowPx > 40 ? rowPx * 0.5 - 12 : 0;
        for (let i = 0; i < eraTexts.length; i++) {
          const t = eraTexts[i];
          const sy = anchorY.value + t.__y * z - tuck;
          const on = i % step === 0 && sy > topInsetPx + 14 && sy < H - bottomInsetPx - 14;
          t.visible = on;
          if (on) { t.position.set(12, sy); t.alpha = axisAlpha; }
        }

        if (defl.size) drawAllBonds(deflOf);
        else drawReaches(null);
        reportEdges();
      });
      let lastDotKey = '';

      /* Arrival: the family blooms as a whole, then the camera travels to
       * whoever is in focus and lights their line — the map first, then
       * where you are on it. A rebuild (the graph changed under an edit)
       * re-applies the same focus rather than stranding the camera at the
       * fit view, since positions may have moved. */
      let arrival = null;
      const arriveAt = (id, delay) => {
        clearTimeout(arrival);
        if (!id || !frame?.nodes.has(id)) return;
        setFocus(id);
        if (!delay) { flyTo(id); return; }
        arrival = setTimeout(() => { if (alive) flyTo(id); }, delay);
      };

      innerApi.current = {
        build, fitAll, flyTo, setFocus, zoomStep, recenter,
        rebuild: () => { build(); fitAll({ instant: true }); arriveAt(focusIdRef.current, 700); },
        get stats() { return frame?.stats; },
        destroy: () => {
          clearTimeout(arrival);
          app.canvas.removeEventListener('wheel', onWheel);
          disposePortrait();
          for (const [, n] of nodes) n.destroy();
          nodes.clear();
        },
      };
      if (apiRef) apiRef.current = innerApi.current;
      build();
      fitAll({ instant: true });
      arriveAt(focusIdRef.current, reducedMotion ? 0 : 1400);
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

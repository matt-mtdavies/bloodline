import { useEffect, useRef } from 'react';
import { Application, Container, Graphics } from 'pixi.js';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
} from 'd3-force';
import { Bubble } from './bubble.js';
import { drawLinks, drawLinksChart } from './links.js';
import { distancesFrom } from '../data/graph.js';
import { Spring } from '../lib/spring.js';

const BASE_RADIUS = 46;
const COLLIDE = 70;
const GEN_GAP = 280; // shorter bands so wide screens use horizontal space too
const ORGANIC_CHARGE = -1800; // stronger repulsion spreads generations sideways
const SPREAD_X = 0.004; // weaker centring lets nodes fan out naturally
const MAX_ZOOM = 2.0; // auto-fit (follow mode) — higher cap so small focus families fill the screen
const MIN_ZOOM = 0.32; // free zoom-out: take in a huge tree at a glance
const MAX_ZOOM_FREE = 2.8; // free zoom-in: lean right into a single face
const PAN_FRICTION = 0.92; // inertial glide decay (per 1/60 s)
const FLICK_STOP = 1.5; // world units/s below which the glide rests
const DOUBLE_TAP_MS = 280; // window for a double-tap-to-recentre

/*
 * The visualization. Everything that matters in Phase 1 lives here:
 *   - a continuous d3-force layout so the tree is always gently alive,
 *   - an ego camera that springs to centre on whoever is focused,
 *   - bubbles that grow / sharpen near the focus and recede / blur far from it,
 *   - tap a bubble to fly the whole graph to it; tap the centred one to open it.
 *
 * React owns *which* person is focused (state); this component owns the motion.
 */
export default function BubbleTree({
  graph,
  activeId,
  visibleIds,
  onActivate,
  onOpenPerson,
  reducedMotion,
  layout = 'organic',
  mergeParents = false,
  lineagePath = null,
  invitedIds = null,
  onCameraMode,
  apiRef,
}) {
  const hostRef = useRef(null);
  const api = useRef(null);
  const activeRef = useRef(activeId);
  const visibleRef = useRef(visibleIds);
  visibleRef.current = visibleIds;
  const graphRef = useRef(graph);
  graphRef.current = graph; // always the live graph for the loop + sync
  const mergeRef = useRef(mergeParents);
  mergeRef.current = mergeParents;
  const lineageRef = useRef(lineagePath);
  lineageRef.current = lineagePath;
  const invitedRef = useRef(invitedIds);
  invitedRef.current = invitedIds;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  // Callbacks are captured once in the mount effect, so we route them through
  // refs to ensure React prop changes (e.g. lineage mode toggling onOpenPerson)
  // are always reflected without re-mounting the canvas.
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;
  const onOpenPersonRef = useRef(onOpenPerson);
  onOpenPersonRef.current = onOpenPerson;
  const onCameraModeRef = useRef(onCameraMode);
  onCameraModeRef.current = onCameraMode;

  // ── Mount Pixi + the simulation once ──────────────────────────────────────
  useEffect(() => {
    let alive = true;
    const host = hostRef.current;
    const app = new Application();

    (async () => {
      await app.init({
        antialias: true,
        backgroundAlpha: 0,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
        resizeTo: host,
        preference: 'webgl',
      });
      if (!alive) {
        app.destroy(true);
        return;
      }
      host.appendChild(app.canvas);
      app.stage.cursor = 'grab'; // empty canvas reads as draggable (bubbles stay 'pointer')

      // World container: links underneath, bubbles on top. The camera transforms
      // this whole container; bubbles never move in screen space themselves.
      const world = new Container();
      app.stage.addChild(world);
      const genBandsGfx = new Graphics(); // drawn behind links in chart mode
      world.addChild(genBandsGfx);
      const linkGfx = new Graphics();
      world.addChild(linkGfx);
      const bubbleLayer = new Container();
      bubbleLayer.sortableChildren = true; // nearer bubbles draw above farther
      world.addChild(bubbleLayer);

      const graph = graphRef.current; // initial build snapshot

      // Generation index (roots = 0) gives the layout legible vertical bands
      // and the radial sectors. Recomputed when people are added.
      let gen = computeGenerations(graph);

      // Simulation nodes, spread by generation so the layout settles cleanly.
      const nodes = graph.people.map((p, i) => ({
        id: p.id,
        x: (Math.random() - 0.5) * 600,
        y: (gen.get(p.id) ?? 0) * GEN_GAP - 260 + (Math.random() - 0.5) * 30,
      }));
      const nodeById = new Map(nodes.map((n) => [n.id, n]));
      const pos = new Map(nodes.map((n) => [n.id, n]));

      const buildLinks = (rels) =>
        rels
          .filter((r) => r.type === 'partner' || r.type === 'parent')
          .map((r) => ({ source: r.from_person, target: r.to_person, kind: r.type }));

      const linkForce = forceLink(buildLinks(graph.relationships))
        .id((d) => d.id)
        .distance((l) => (l.kind === 'partner' ? 112 : 280))
        .strength((l) => (l.kind === 'partner' ? 0.9 : 0.26));

      const sim = forceSimulation(nodes)
        .force('link', linkForce)
        .force('charge', forceManyBody().strength(ORGANIC_CHARGE).distanceMax(1200))
        .force('collide', forceCollide(COLLIDE).strength(0.9))
        .force('x', forceX(0).strength(SPREAD_X))
        .force('y', forceY((d) => (gen.get(d.id) ?? 0) * GEN_GAP - 260).strength(0.085))
        .alpha(1)
        .alphaDecay(0.018)
        .alphaTarget(reducedMotion ? 0 : 0.012)
        .stop();

      // Partner Y-alignment: pull each partner pair toward the same Y so they
      // read as a horizontal couple in organic/weighted/hybrid modes. Chart mode
      // uses fixed positions; radial has its own orbit targets — skip both.
      sim.force('partnerY', (alpha) => {
        const mode = layoutRef.current;
        if (mode === 'chart' || mode === 'radial') return;
        for (const r of graphRef.current.relationships) {
          if (r.type !== 'partner') continue;
          const na = nodeById.get(r.from_person);
          const nb = nodeById.get(r.to_person);
          if (!na || !nb) continue;
          const dy = nb.y - na.y;
          na.vy += dy * 0.20 * alpha;
          nb.vy -= dy * 0.20 * alpha;
        }
      });

      // Warm the layout so the tree opens already settled, not reorganising.
      for (let i = 0; i < 220; i++) sim.tick();
      sim.alpha(0.35); // a little life left to breathe into

      // Bubbles. Each root carries its id so the single stage-level pointer
      // handler can tell which person was grabbed. bubblePerson tracks the
      // person object a bubble was built from, so edits can refresh in place.
      const bubbles = new Map();
      const bubblePerson = new Map();
      for (const p of graph.people) {
        const b = new Bubble(p, BASE_RADIUS);
        b.root.__bubbleId = p.id;
        bubbleLayer.addChild(b.root);
        bubbles.set(p.id, b);
        bubblePerson.set(p.id, p);
      }

      // ── Camera ───────────────────────────────────────────────────────────
      // ONE authoritative camera: (camX, camY) is the world point shown at the
      // screen anchor; zoom is the scale. Two modes share it seamlessly:
      //   • follow — the camera springs to frame the revealed family (the reveal
      //     "wow": tap a person and the whole tree glides + fits around them).
      //   • free   — you’ve grabbed the canvas: pan sticks 1:1 to your finger and
      //     coasts on release; pinch/wheel zoom around the focal point. The view
      //     stays exactly where you leave it until you tap someone or recentre.
      // The springs ARE the live camera in follow mode; in free mode we drive
      // their .value directly (with inertia) and keep target == value so flipping
      // back to follow is jump-free.
      const camX = new Spring(0, { stiffness: 55, damping: 15 });
      const camY = new Spring(0, { stiffness: 55, damping: 15 });
      const zoom = new Spring(1, { stiffness: 130, damping: 20 });
      const biasX = new Spring(0, { stiffness: 90, damping: 18 }); // shift on card open
      let camMode = 'follow'; // 'follow' | 'free'
      let vx = 0, vy = 0; // free-pan inertia, world units / second
      let onModeChange = null;

      let dist = distancesFrom(graph, activeRef.current);

      let reorgTimer = null; // tracks the forceY strength-restore after a tap

      const state = {
        app,
        world,
        sim,
        nodes,
        nodeById,
        pos,
        bubbles,
        linkGfx,
        camX,
        camY,
        zoom,
        gen,
        dist,
        pinnedId: null,
        layoutMode: layoutRef.current,
        radialTargets: new Map(),
        // Rebuild the positioning forces for the current layout mode. In radial
        // mode this recomputes the sectored targets and pulls nodes to them
        // (reheating, which animates the orbit re-centre); organic restores the
        // generational bands + repulsion.
        relayout() {
          state.radialTargets = new Map();
          const mode = state.layoutMode;
          const genY = (d) => (gen.get(d.id) ?? 0) * GEN_GAP - 260;
          if (mode === 'radial') {
            state.radialTargets = computeRadialTargets(
              graphRef.current,
              activeRef.current,
              visibleRef.current,
              gen,
            );
            const strength = (d) =>
              d.id === activeRef.current ? 0.7 : state.radialTargets.has(d.id) ? 0.32 : 0.03;
            sim.force('charge', forceManyBody().strength(-70).distanceMax(500));
            sim.force('x', forceX((d) => state.radialTargets.get(d.id)?.x ?? 0).strength(strength));
            sim.force('y', forceY((d) => state.radialTargets.get(d.id)?.y ?? 0).strength(strength));
            linkForce
              .distance((l) => (l.kind === 'partner' ? 112 : 280))
              .strength((l) => (l.kind === 'partner' ? 0.3 : 0.04));
          } else if (mode === 'weighted') {
            // Relationship-weighted: immediate family pulled close, extended drifts
            // outward naturally. Stronger gen-band so generations read as rows.
            const nid = state.nodeId;
            const dist = state.dist;
            sim.force('charge', forceManyBody().strength(-1100).distanceMax(900));
            sim.force('x', forceX(0).strength(0.008));
            sim.force('y', forceY(genY).strength(0.22));
            linkForce
              .distance((l) => {
                if (l.kind === 'partner') return 95;
                const r = Math.min(dist.get(nid(l.source)) ?? 4, dist.get(nid(l.target)) ?? 4);
                return r <= 1 ? 210 : r <= 2 ? 265 : 320;
              })
              .strength((l) => {
                if (l.kind === 'partner') return 0.95;
                const r = Math.min(dist.get(nid(l.source)) ?? 4, dist.get(nid(l.target)) ?? 4);
                return r <= 1 ? 0.48 : r <= 2 ? 0.28 : 0.12;
              });
          } else if (mode === 'hybrid') {
            // Organic feel but with clear generational banding (70% organic / 30% gen)
            sim.force('charge', forceManyBody().strength(-1400).distanceMax(1100));
            sim.force('x', forceX(0).strength(SPREAD_X));
            sim.force('y', forceY(genY).strength(0.22));
            linkForce
              .distance((l) => (l.kind === 'partner' ? 112 : 280))
              .strength((l) => (l.kind === 'partner' ? 0.9 : 0.26));
          } else if (mode === 'chart') {
            // Traditional hierarchical chart — physics silenced; positions held by fx/fy.
            sim.force('charge', forceManyBody().strength(-30).distanceMax(80));
            sim.force('x', forceX(0).strength(0));
            sim.force('y', forceY(0).strength(0));
            linkForce.distance(() => 0).strength(() => 0);
            sim.alphaTarget(0);
            state.applyChartLayout();
          } else {
            // organic — the default; free-flowing with gentle gen bands
            sim.force('charge', forceManyBody().strength(ORGANIC_CHARGE).distanceMax(1200));
            sim.force('x', forceX(0).strength(SPREAD_X));
            sim.force('y', forceY(genY).strength(0.085));
            linkForce
              .distance((l) => (l.kind === 'partner' ? 112 : 280))
              .strength((l) => (l.kind === 'partner' ? 0.9 : 0.26));
          }
          sim.alpha(0.7);
        },
        applyChartLayout() {
          const chartPos = computeChartLayout(graphRef.current, gen, visibleRef.current);
          for (const n of nodes) {
            const p = chartPos.get(n.id);
            if (p) {
              // Snap position immediately so the first rendered frame is correct.
              n.x = p.x; n.y = p.y;
              n.vx = 0; n.vy = 0;
              n.fx = p.x; n.fy = p.y;
            } else {
              n.fx = null; n.fy = null;
            }
          }
          sim.alpha(0.08);
        },
        setLayout(mode) {
          if (state.layoutMode === mode) return;
          if (state.layoutMode === 'chart') {
            // Restore dynamics when leaving chart mode.
            for (const n of nodes) { n.fx = null; n.fy = null; }
            sim.alphaTarget(reducedMotion ? 0 : 0.012);
            sim.alpha(0.5);
          }
          state.layoutMode = mode;
          state.relayout();
        },
        setActive(id, animate = true) {
          activeRef.current = id;
          state.dist = distancesFrom(graphRef.current, id);
          state.enterFollow();
          if (!reducedMotion && animate) {
            zoom.velocity -= 1.6;
            // Briefly spike the Y-generational force so parents visibly float
            // upward and children sink down, making the clicked person's family
            // obvious before settling back to the gentle resting drift.
            const mode = state.layoutMode;
            if (mode !== 'chart' && mode !== 'radial') {
              if (reorgTimer) clearTimeout(reorgTimer);
              const genY = (d) => (gen.get(d.id) ?? 0) * GEN_GAP - 260;
              sim.force('y', forceY(genY).strength(0.45));
              sim.alpha(0.88);
              reorgTimer = setTimeout(() => {
                reorgTimer = null;
                if (state.layoutMode !== 'chart' && state.layoutMode !== 'radial') {
                  sim.force('y', forceY(genY).strength(0.085));
                }
              }, 1800);
            }
          }
          if (state.layoutMode === 'radial' || state.layoutMode === 'weighted') state.relayout();
          if (state.layoutMode === 'chart') state.applyChartLayout();
        },
        // Hand the camera to the user: pan/zoom now stick where they leave them.
        enterFree() {
          if (camMode === 'free') return;
          camMode = 'free';
          vx = vy = 0;
          onModeChange?.(true);
        },
        // Take the camera back: it will spring to frame the active family.
        enterFollow() {
          vx = vy = 0;
          camX.velocity = camY.velocity = 0;
          if (camMode === 'follow') return;
          camMode = 'follow';
          onModeChange?.(false);
        },
        get cameraFree() {
          return camMode === 'free';
        },
        // Smoothly return to the framed view (the floating "recentre" control).
        // Also clears any stuck pointer/gesture state from iOS not firing pointerup
        // for all fingers — that leaves phantom entries in the pointers Map which
        // make subsequent single-finger taps look like a multi-touch, silently
        // blocking bubble selection until the state is reset.
        recenter() {
          if (!reducedMotion) zoom.velocity -= 1.2;
          pointers.clear();
          pinch.active = false;
          drag.type = 'none';
          drag.moved = false;
          drag.node = null;
          vx = vy = 0;
          state.enterFollow();
        },
        // Let React mirror the camera mode (to show/hide the recentre control).
        onCameraMode(fn) {
          onModeChange = fn;
        },
        // Shorthand: resolve node id from d3's source/target (may be object or string).
        nodeId: (n) => (typeof n === 'string' ? n : n?.id),
        // Reconcile the canvas with a new graph: spawn bubbles for new people
        // (near whoever they connect to, so they appear to sprout from them),
        // refresh edited bubbles, drop removed ones, and rewire the links.
        sync(g) {
          for (const p of g.people) {
            if (!nodeById.has(p.id)) {
              const rel = g.relationships.find(
                (r) =>
                  (r.from_person === p.id && nodeById.has(r.to_person)) ||
                  (r.to_person === p.id && nodeById.has(r.from_person)),
              );
              const anchor = rel
                ? nodeById.get(rel.from_person === p.id ? rel.to_person : rel.from_person)
                : null;
              const node = {
                id: p.id,
                x: (anchor?.x ?? 0) + (Math.random() - 0.5) * 24,
                y: (anchor?.y ?? 0) + (Math.random() - 0.5) * 24,
              };
              nodes.push(node);
              nodeById.set(p.id, node);
              pos.set(p.id, node);
              const b = new Bubble(p, BASE_RADIUS);
              b.root.__bubbleId = p.id;
              b.root.position.set(node.x, node.y);
              bubbleLayer.addChild(b.root);
              bubbles.set(p.id, b);
              bubblePerson.set(p.id, p);
            } else if (bubblePerson.get(p.id) !== p) {
              // The person object changed (an edit / new photo): rebuild in place.
              const node = nodeById.get(p.id);
              bubbles.get(p.id)?.destroy();
              const b = new Bubble(p, BASE_RADIUS);
              b.root.__bubbleId = p.id;
              b.root.position.set(node.x, node.y);
              bubbleLayer.addChild(b.root);
              bubbles.set(p.id, b);
              bubblePerson.set(p.id, p);
            }
          }
          for (const id of [...nodeById.keys()]) {
            if (!g.byId.has(id)) {
              bubbles.get(id)?.destroy();
              bubbles.delete(id);
              bubblePerson.delete(id);
              nodeById.delete(id);
              pos.delete(id);
              const i = nodes.findIndex((n) => n.id === id);
              if (i >= 0) nodes.splice(i, 1);
            }
          }
          sim.nodes(nodes);
          linkForce.links(buildLinks(g.relationships));
          sim.alpha(0.5);
          gen = computeGenerations(g);
          state.dist = distancesFrom(g, activeRef.current);
          if (state.layoutMode === 'radial' || state.layoutMode === 'weighted') state.relayout();
          if (state.layoutMode === 'chart') state.applyChartLayout();
        },
        // Screen-space centre of a person's bubble — the card animates out of it.
        getScreenPos(id) {
          const n = nodeById.get(id);
          if (!n) return null;
          const p = world.toGlobal({ x: n.x, y: n.y });
          return { x: p.x, y: p.y };
        },
        // Hold a person still (while their card is open) so the tether stays put.
        pin(id) {
          const n = nodeById.get(id);
          if (!n) return;
          state.pinnedId = id;
          n.fx = n.x;
          n.fy = n.y;
        },
        unpin() {
          const n = state.pinnedId && nodeById.get(state.pinnedId);
          if (n) {
            n.fx = null;
            n.fy = null;
          }
          state.pinnedId = null;
        },
        // Re-cluster visible nodes around the active person and snap the camera instantly.
        // Called when Focus Family, Life Journey, or Time mode activates so nodes don't
        // stay at their full-tree world positions while the slow spring catches up.
        refocus(alpha = 0.5) {
          const vis = visibleRef.current;
          const f = nodeById.get(activeRef.current);
          if (f && vis.size > 0) {
            const others = [...vis].filter((id) => id !== activeRef.current && nodeById.has(id));
            const count = others.length;
            if (count > 0) {
              const r = GEN_GAP * 0.6;
              others.forEach((id, idx) => {
                const n = nodeById.get(id);
                const angle = (idx / count) * Math.PI * 2 - Math.PI / 2;
                n.x = f.x + Math.cos(angle) * r + (Math.random() - 0.5) * 24;
                n.y = f.y + Math.sin(angle) * r + (Math.random() - 0.5) * 24;
                n.vx = 0;
                n.vy = 0;
              });
            }
            // Snap camera values AND targets directly — no slow spring pan.
            camX.value = camX.target = f.x;
            camY.value = camY.target = f.y;
            camX.velocity = camY.velocity = 0;
            zoom.value = zoom.target = Math.min(MAX_ZOOM, 1.5);
            zoom.velocity = 0;
          }
          vx = vy = 0;
          sim.alpha(alpha);
          camMode = 'follow';
          onModeChange?.(false);
        },
      };
      api.current = state;
      if (apiRef) apiRef.current = state;
      state.onCameraMode((free) => onCameraModeRef.current?.(free));
      if (state.layoutMode === 'radial') state.relayout();

      // Centre instantly on the first active person so we don't fly in.
      const f0 = nodeById.get(activeRef.current);
      if (f0) {
        camX.set(f0.x);
        camY.set(f0.y);
      }

      // ── Interaction ────────────────────────────────────────────────────────
      // One stage-level gesture handler that reads like the gestures feel:
      //   • Press a bubble + drag → fling it; it pins to your finger and the sim
      //     reheats so neighbours shove and settle. Release → it rejoins the flow.
      //   • Press empty space + drag → pan the whole tree 1:1; release with speed
      //     and it coasts to a graceful stop. The view STAYS where you leave it.
      //   • Two fingers → pinch-zoom locked to the point between them.
      //   • Wheel / trackpad → zoom toward the cursor.
      //   • Tap a bubble → fly to that person (re-frames). Tap the active one →
      //     open their profile. Double-tap empty space → recentre.
      app.stage.eventMode = 'static';
      app.stage.hitArea = { contains: () => true };
      const TAP_SLOP = 8; // px of movement still considered a tap
      const drag = { type: 'none', node: null, id: null, start: null, moved: false };
      let last = null;
      let lastT = 0;
      let lastTap = { t: 0, x: 0, y: 0 };
      const pointers = new Map();
      const pinch = { active: false, dist0: 0, zoom0: 1 };

      const twoFingerDist = () => {
        const p = [...pointers.values()];
        return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      };
      const twoFingerMid = () => {
        const p = [...pointers.values()];
        return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
      };
      // The on-screen anchor (≈ centre of the safe area) and current render scale.
      const screenAnchor = () => {
        const W = app.screen.width, H = app.screen.height;
        const topInset = Math.min(120, H * 0.16);
        return {
          ax: W / 2 + biasX.value,
          ay: (H + topInset) / 2,
          z: clamp(zoom.value, MIN_ZOOM, MAX_ZOOM_FREE),
        };
      };
      // Zoom toward a screen-space focal point, keeping the world point under it
      // pinned — the essential trick that makes pinch / wheel feel "right".
      const zoomTo = (newZ, sx, sy) => {
        const { ax, ay, z } = screenAnchor();
        const wx = (sx - ax) / z + camX.value;
        const wy = (sy - ay) / z + camY.value;
        const nz = clamp(newZ, MIN_ZOOM, MAX_ZOOM_FREE);
        zoom.value = zoom.target = nz;
        zoom.velocity = 0;
        camX.value = camX.target = wx - (sx - ax) / nz;
        camY.value = camY.target = wy - (sy - ay) / nz;
        camX.velocity = camY.velocity = 0;
      };

      const bubbleIdFromTarget = (t) => {
        let n = t;
        while (n && n.__bubbleId === undefined) n = n.parent;
        return n ? n.__bubbleId : null;
      };

      app.stage.on('pointerdown', (e) => {
        const g = e.global;
        pointers.set(e.pointerId, { x: g.x, y: g.y });

        // Second finger down → begin pinch; abandon any single-finger gesture.
        if (pointers.size === 2) {
          if (drag.type === 'bubble' && drag.node && drag.id !== state.pinnedId) {
            drag.node.fx = null;
            drag.node.fy = null;
          }
          drag.type = 'none';
          drag.node = null;
          pinch.active = true;
          pinch.dist0 = twoFingerDist();
          pinch.zoom0 = screenAnchor().z;
          state.enterFree();
          return;
        }
        if (pointers.size > 2) return;

        last = { x: g.x, y: g.y };
        lastT = performance.now();
        drag.start = { x: g.x, y: g.y };
        drag.moved = false;
        const id = bubbleIdFromTarget(e.target);
        if (id) {
          drag.type = 'bubble';
          drag.id = id;
          drag.node = nodeById.get(id);
        } else {
          drag.type = 'pan';
          drag.node = null;
          vx = vy = 0; // catch the moving tree the instant you touch it
          // Double-tap empty space → recentre on the active family.
          const now = performance.now();
          if (now - lastTap.t < DOUBLE_TAP_MS &&
              Math.hypot(g.x - lastTap.x, g.y - lastTap.y) < 28) {
            state.recenter();
            lastTap = { t: 0, x: 0, y: 0 };
            drag.type = 'none';
          } else {
            lastTap = { t: now, x: g.x, y: g.y };
          }
        }
      });

      app.stage.on('pointermove', (e) => {
        if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.global.x, y: e.global.y });

        // Pinch: zoom from the finger gap, locked to the moving midpoint (so you
        // can pan and zoom in the same gesture, which feels wonderfully fluid).
        if (pinch.active && pointers.size >= 2) {
          const d = twoFingerDist();
          if (pinch.dist0 > 0) {
            const mid = twoFingerMid();
            zoomTo(pinch.zoom0 * (d / pinch.dist0), mid.x, mid.y);
          }
          return;
        }

        if (drag.type === 'none' || !last) return;
        const g = e.global;
        if (!drag.moved && Math.hypot(g.x - drag.start.x, g.y - drag.start.y) > TAP_SLOP) {
          drag.moved = true;
        }
        if (drag.type === 'bubble' && drag.moved && drag.node) {
          const local = world.toLocal(g);
          drag.node.fx = local.x;
          drag.node.fy = local.y;
          if (!reducedMotion) sim.alphaTarget(0.35); // reheat so neighbours react
        } else if (drag.type === 'pan' && drag.moved) {
          state.enterFree();
          app.stage.cursor = 'grabbing';
          const z = screenAnchor().z;
          const dwx = -(g.x - last.x) / z;
          const dwy = -(g.y - last.y) / z;
          camX.value = camX.target = camX.value + dwx;
          camY.value = camY.target = camY.value + dwy;
          camX.velocity = camY.velocity = 0;
          // Track world-space velocity (EMA) so release flicks into inertia.
          const now = performance.now();
          const dt = Math.max(now - lastT, 8) / 1000;
          vx = vx * 0.35 + (dwx / dt) * 0.65;
          vy = vy * 0.35 + (dwy / dt) * 0.65;
          lastT = now;
        }
        last = { x: g.x, y: g.y };
      });

      const endGesture = (e) => {
        if (e) pointers.delete(e.pointerId);
        if (pointers.size < 2 && pinch.active) {
          pinch.active = false;
          // One finger remains after a pinch → hand straight back to panning so
          // the gesture never stutters.
          if (pointers.size === 1) {
            const p = [...pointers.values()][0];
            last = { x: p.x, y: p.y };
            lastT = performance.now();
            drag.type = 'pan';
            drag.moved = true;
            drag.node = null;
            vx = vy = 0;
            return;
          }
        }
        if (drag.type === 'bubble') {
          if (!drag.moved) {
            // A clean tap: fly to / activate, or open the already-active person.
            if (activeRef.current === drag.id) onOpenPersonRef.current?.(drag.id);
            else onActivateRef.current?.(drag.id);
          } else if (drag.node && drag.id !== state.pinnedId) {
            drag.node.fx = null;
            drag.node.fy = null;
          }
          if (!reducedMotion) sim.alphaTarget(0.012); // settle back to idle drift
        }
        // A flick that's barely moving shouldn't drift; reduced-motion never coasts.
        if (reducedMotion || Math.hypot(vx, vy) < FLICK_STOP) vx = vy = 0;
        app.stage.cursor = 'grab';
        drag.type = 'none';
        drag.node = null;
        last = null;
      };
      app.stage.on('pointerup', endGesture);
      app.stage.on('pointerupoutside', endGesture);
      state.isDraggingBubble = () => drag.type === 'bubble' && drag.moved;

      app.canvas.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          state.enterFree();
          const factor = e.deltaY > 0 ? 0.9 : 1.0 / 0.9;
          zoomTo(screenAnchor().z * factor, e.offsetX, e.offsetY);
        },
        { passive: false },
      );

      // ── The frame loop ─────────────────────────────────────────────────────
      app.ticker.add((ticker) => {
        const dt = Math.min(ticker.deltaMS / 1000, 1 / 30);

        // Gentle perpetual drift gives the organic modes life. Skip in chart mode
        // where clean static positions are the whole point.
        if (!reducedMotion && layoutRef.current !== 'chart') {
          const t = performance.now() / 1000;
          for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            n.vx += Math.sin(t * 0.6 + i * 1.3) * 0.012;
            n.vy += Math.cos(t * 0.5 + i * 0.7) * 0.012;
          }
        }
        sim.tick();
        const vis = visibleRef.current;

        const W = app.screen.width;
        const H = app.screen.height;
        // Reserve a band at the top for the masthead so bubbles never sit under
        // it; the visible family is framed in the centre of the safe area.
        const topInset = Math.min(120, H * 0.16);
        const cx = W / 2;
        const cy = (H + topInset) / 2;

        const f = nodeById.get(activeRef.current);
        if (camMode === 'follow' && f && !state.isDraggingBubble?.()) {
          // FOLLOW — frame the whole revealed family: centre on the bounding box
          // of the visible bubbles (gently biased toward the active person so
          // they stay central) and zoom so it fills the safe area. Even a handful
          // of people then spread out and use the screen instead of huddling.
          const rr = BASE_RADIUS * 1.5;
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (const id of vis) {
            const n = nodeById.get(id);
            if (!n) continue;
            if (n.x - rr < minX) minX = n.x - rr;
            if (n.x + rr > maxX) maxX = n.x + rr;
            if (n.y - rr < minY) minY = n.y - rr;
            if (n.y + rr > maxY) maxY = n.y + rr;
          }
          if (!isFinite(minX)) {
            minX = f.x - rr; maxX = f.x + rr; minY = f.y - rr; maxY = f.y + rr;
          }
          // Bias the framed centre a third of the way toward the active person.
          const BIAS = 0.34;
          const camTX = ((minX + maxX) / 2) * (1 - BIAS) + f.x * BIAS;
          const camTY = ((minY + maxY) / 2) * (1 - BIAS) + f.y * BIAS;
          camX.setTarget(camTX);
          camY.setTarget(camTY);
          // Fit from the half-extents around the (biased) centre so nothing
          // clips on the far side.
          const halfX = Math.max(camTX - minX, maxX - camTX, rr);
          const halfY = Math.max(camTY - minY, maxY - camTY, rr);
          const PAD = 18;
          const fit = Math.min(
            MAX_ZOOM,
            (W / 2 - PAD) / halfX,
            ((H - topInset) / 2 - PAD) / halfY,
          );
          zoom.setTarget(clamp(fit, 0.4, MAX_ZOOM));
          camX.step(dt);
          camY.step(dt);
          zoom.step(dt);
        } else if (camMode === 'free') {
          // FREE — glide on released momentum, then rest. Soft-clamp so the
          // family can never be flung entirely off-screen and lost: if the
          // camera drifts past the world's edges it eases elastically back.
          const panning = drag.type === 'pan' && !!last; // finger down, moving it
          if (!state.isDraggingBubble?.()) {
            if (panning) {
              // The pointer handler is moving the camera directly; just let any
              // stale momentum bleed off so a pause before lifting kills the flick.
              const decay = Math.pow(0.86, dt * 60);
              vx *= decay;
              vy *= decay;
            } else if (vx || vy) {
              camX.value += vx * dt;
              camY.value += vy * dt;
              const decay = Math.pow(PAN_FRICTION, dt * 60);
              vx *= decay;
              vy *= decay;
              if (Math.hypot(vx, vy) < FLICK_STOP) vx = vy = 0;
            }
          }
          const z = clamp(zoom.value, MIN_ZOOM, MAX_ZOOM_FREE);
          const marginX = (W * 0.5) / z * 0.85;
          const marginY = (H * 0.5) / z * 0.85;
          let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
          for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (n.x < bMinX) bMinX = n.x;
            if (n.x > bMaxX) bMaxX = n.x;
            if (n.y < bMinY) bMinY = n.y;
            if (n.y > bMaxY) bMaxY = n.y;
          }
          if (isFinite(bMinX)) {
            const loX = bMinX - marginX, hiX = bMaxX + marginX;
            const loY = bMinY - marginY, hiY = bMaxY + marginY;
            const clampedX = clamp(camX.value, loX, hiX);
            const clampedY = clamp(camY.value, loY, hiY);
            if (clampedX !== camX.value) { camX.value += (clampedX - camX.value) * Math.min(1, dt * 10); vx = 0; }
            if (clampedY !== camY.value) { camY.value += (clampedY - camY.value) * Math.min(1, dt * 10); vy = 0; }
          }
          camX.target = camX.value;
          camY.target = camY.value;
          zoom.target = zoom.value;
        }

        // When a card is open, slide the anchored bubble to the left so the card
        // can expand out to its side.
        biasX.setTarget(state.pinnedId ? -W * 0.24 : 0);
        biasX.step(dt);
        const z = clamp(zoom.value, MIN_ZOOM, MAX_ZOOM_FREE);
        world.scale.set(z);
        world.position.set(
          cx + biasX.value - camX.value * z,
          cy - camY.value * z,
        );

        // Per-bubble visual state. Only revealed (visible) people show; the rest
        // stay collapsed. When a card is open, the active bubble stays sharp and
        // everyone else blurs and dims back. In lineage mode non-path bubbles dim.
        const dmap = state.dist;
        const cardOpen = !!state.pinnedId;
        const lineage = lineageRef.current;
        for (const [id, b] of bubbles) {
          const n = nodeById.get(id);
          b.root.position.set(n.x, n.y);
          const d = dmap.has(id) ? dmap.get(id) : 6;
          let target;
          if (!vis.has(id)) {
            target = { scale: 0.5, alpha: 0, lift: 1, blur: 0 }; // collapsed
          } else if (lineage && !lineage.has(id)) {
            target = { ...visualForDistance(d), alpha: 0.12, blur: 1.5 }; // off-path — recede
          } else if (lineage && lineage.has(id)) {
            // On lineage path: uniform, prominent, un-dimmed regardless of hop distance.
            target = { scale: 1.02, alpha: 1, lift: 1.3, blur: 0 };
          } else if (cardOpen && id !== state.pinnedId) {
            target = { ...visualForDistance(d), alpha: 0.28, blur: 5 }; // dimmed behind card
          } else {
            // Focus fading: immediate family pops; extended family recedes softly.
            // This gives the graph visible hierarchy without a card being open.
            const base = visualForDistance(d);
            const focusAlpha = d <= 1 ? 1 : d === 2 ? 0.62 : d === 3 ? 0.38 : 0.2;
            target = { ...base, alpha: focusAlpha };
          }
          // Name labels: all visible bubbles, hidden when card open or lineage active
          const labelAlpha = (!cardOpen && !lineage && vis.has(id)) ? 1 : 0;
          b.setVisualState({ ...target, labelAlpha }, dt);
          b.setActive(id === activeRef.current);
          b.setInvited(!!(invitedRef.current?.has(id)));
          b.setChartBadge(layoutRef.current === 'chart');
          // Depth hints: show on visible bubbles that have family beyond the current reveal.
          if (vis.has(id)) {
            const gg = graphRef.current;
            b.setDepthHint(
              gg.parents(id).some((x) => !vis.has(x.id)),
              gg.children(id).some((x) => !vis.has(x.id)),
            );
          } else {
            b.setDepthHint(false, false);
          }
          b.root.zIndex = id === activeRef.current ? 100 : -d;
        }

        // Generation row backgrounds in chart mode — alternating warm bands behind the links.
        genBandsGfx.clear();
        if (layoutRef.current === 'chart') {
          const byGen = new Map();
          for (const id of vis) {
            const n = nodeById.get(id);
            if (!n) continue;
            const g = gen.get(id) ?? 0;
            if (!byGen.has(g)) byGen.set(g, { minX: Infinity, maxX: -Infinity, y: n.y });
            const row = byGen.get(g);
            if (n.x - BASE_RADIUS < row.minX) row.minX = n.x - BASE_RADIUS;
            if (n.x + BASE_RADIUS > row.maxX) row.maxX = n.x + BASE_RADIUS;
          }
          const PAD_X = 56, BAND_H = GEN_GAP * 0.72;
          const bandColors = [0xfaf7f4, 0xf5f0eb];
          for (const [gi, row] of byGen) {
            if (!isFinite(row.minX)) continue;
            const bx = row.minX - PAD_X;
            const bw = row.maxX - row.minX + PAD_X * 2;
            const by = row.y - BAND_H / 2;
            genBandsGfx.roundRect(bx, by, bw, BAND_H, 12)
              .fill({ color: bandColors[gi % 2], alpha: 0.72 });
          }
        }

        linkGfx.alpha = cardOpen ? 0.18 : 1;
        genBandsGfx.alpha = cardOpen ? 0.1 : 1;
        if (layoutRef.current === 'chart') {
          drawLinksChart(linkGfx, graphRef.current, pos, (id) => vis.has(id), BASE_RADIUS, lineage);
        } else {
          drawLinks(linkGfx, graphRef.current, pos, (id) => vis.has(id), BASE_RADIUS, mergeRef.current, lineage);
        }
      });
    })();

    return () => {
      alive = false;
      api.current?.sim?.stop();
      try {
        app.destroy(true, { children: true });
      } catch {
        /* already torn down */
      }
      api.current = null;
      if (apiRef) apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  // React drives the active person into the imperative camera.
  useEffect(() => {
    if (api.current) api.current.setActive(activeId);
    else activeRef.current = activeId;
  }, [activeId]);

  // Reconcile the canvas whenever people/relationships change (add / edit).
  useEffect(() => {
    api.current?.sync(graph);
  }, [graph]);

  // Switch layout mode (organic ↔ radial prototype).
  useEffect(() => {
    api.current?.setLayout(layout);
  }, [layout]);

  // Re-place nodes when the visible set changes: radial/weighted re-run forces,
  // chart re-computes fixed grid positions.
  useEffect(() => {
    const m = api.current?.layoutMode;
    if (m === 'radial' || m === 'weighted') api.current.relayout();
    if (m === 'chart') api.current?.applyChartLayout();
  }, [visibleIds]);

  return <div className="stage" ref={hostRef} aria-hidden="true" />;
}

// Sizing for revealed bubbles by hop-distance from the active person.
// Four tiers give the graph a clear hierarchy: you always know where to look.
function visualForDistance(d) {
  switch (d) {
    case 0: return { scale: 1.38, alpha: 1, lift: 1.6, blur: 0 }; // active
    case 1: return { scale: 1.0,  alpha: 1, lift: 1.2, blur: 0 }; // immediate
    case 2: return { scale: 0.78, alpha: 1, lift: 1,   blur: 0 }; // extended
    case 3: return { scale: 0.67, alpha: 1, lift: 1,   blur: 0 }; // distant
    default: return { scale: 0.58, alpha: 1, lift: 1,  blur: 0 }; // far
  }
}

// Longest-path generation index from the eldest ancestors (no parents = 0).
function computeGenerations(graph) {
  const gen = new Map();
  const visit = (id, guard) => {
    if (gen.has(id)) return gen.get(id);
    if (guard.has(id)) return 0;
    guard.add(id);
    const parents = graph.parents(id);
    let g = 0;
    for (const p of parents) g = Math.max(g, visit(p.id, guard) + 1);
    guard.delete(id);
    gen.set(id, g);
    return g;
  };
  for (const p of graph.people) visit(p.id, new Set());
  // Level partners so couples sit on the same band.
  for (const p of graph.people) {
    for (const partner of graph.partners(p.id)) {
      const a = gen.get(p.id);
      const b = gen.get(partner.id);
      if (a != null && b != null && a !== b) {
        const lvl = Math.max(a, b);
        gen.set(p.id, lvl);
        gen.set(partner.id, lvl);
      }
    }
  }
  return gen;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/*
 * Traditional hierarchical family chart layout. Returns a Map of id → {x, y}
 * with all visible people placed in generation rows, couples kept adjacent,
 * and children sorted under their parents by barycenter heuristic. Positions
 * are set as d3 fx/fy constraints so physics doesn't move them.
 */
function computeChartLayout(graph, gen, visible) {
  const COL_GAP = 148; // world units between adjacent bubbles

  // Group visible people by generation row.
  const byGen = new Map();
  for (const id of visible) {
    const g = gen.get(id) ?? 0;
    if (!byGen.has(g)) byGen.set(g, []);
    byGen.get(g).push(id);
  }

  const posMap = new Map();
  const gens = [...byGen.keys()].sort((a, b) => a - b);

  for (const g of gens) {
    const row = byGen.get(g);

    // Sort people in this row by the average x of their visible parents (barycenter).
    // This naturally groups siblings together under their parents.
    row.sort((a, b) => {
      const bary = (id) => {
        const ps = graph.parents(id).filter((p) => visible.has(p.id));
        if (!ps.length) return 0;
        return ps.reduce((s, p) => s + (posMap.get(p.id)?.x ?? 0), 0) / ps.length;
      };
      return bary(a) - bary(b);
    });

    // Ensure each couple sits immediately adjacent. Walk the sorted row; whenever
    // we encounter a person with a partner still unplaced, insert the partner next.
    const rowSet = new Set(row);
    const paired = new Map();
    for (const id of row) {
      if (paired.has(id)) continue;
      for (const p of graph.partners(id)) {
        if (rowSet.has(p.id) && !paired.has(p.id)) {
          paired.set(id, p.id);
          paired.set(p.id, id);
          break;
        }
      }
    }

    const ordered = [];
    const placed = new Set();
    for (const id of row) {
      if (placed.has(id)) continue;
      placed.add(id);
      ordered.push(id);
      const partner = paired.get(id);
      if (partner && !placed.has(partner)) {
        placed.add(partner);
        ordered.push(partner);
      }
    }

    // Assign x positions centred around 0.
    const n = ordered.length;
    for (let i = 0; i < n; i++) {
      posMap.set(ordered[i], {
        x: (i - (n - 1) / 2) * COL_GAP,
        y: g * GEN_GAP - 260,
      });
    }
  }

  return posMap;
}

/*
 * Sectored-radial target positions (the prototype layout). The active person is
 * the hub at (0,0); everyone visible is placed on a ring by hop-distance and in
 * a sector by generation direction — ancestors up, descendants down, same
 * generation (siblings, partners, cousins) to the sides — evenly spread within
 * each sector. These are fed to the force sim as *targets*, so the result is
 * ordered and even yet still soft, alive, and draggable.
 */
const RING = 190;
function computeRadialTargets(graph, activeId, visible, gen) {
  const targets = new Map([[activeId, { x: 0, y: 0 }]]);
  const dist = distancesFrom(graph, activeId);
  const aGen = gen.get(activeId) ?? 0;

  const buckets = new Map();
  for (const id of visible) {
    if (id === activeId) continue;
    const d = Math.max(1, dist.get(id) ?? 1);
    const gd = (gen.get(id) ?? 0) - aGen;
    // Smaller generation index = nearer the roots = ancestors (placed up).
    const sector = gd < 0 ? 'up' : gd > 0 ? 'down' : 'side';
    const key = `${sector}:${d}`;
    (buckets.get(key) || buckets.set(key, []).get(key)).push(id);
  }

  const ARC = { up: [-Math.PI * 0.8, -Math.PI * 0.2], down: [Math.PI * 0.2, Math.PI * 0.8] };
  for (const [key, ids] of buckets) {
    const [sector, dStr] = key.split(':');
    const radius = RING * Number(dStr);
    if (sector === 'side') {
      // Split evenly between the right and left flanks.
      ids.forEach((id, i) => {
        const right = i % 2 === 0;
        const lane = ids.filter((_, j) => (j % 2 === 0) === right);
        const k = lane.indexOf(id);
        const spread = lane.length > 1 ? k / (lane.length - 1) - 0.5 : 0;
        const ang = (right ? 0 : Math.PI) + spread * Math.PI * 0.5;
        targets.set(id, { x: Math.cos(ang) * radius, y: Math.sin(ang) * radius });
      });
    } else {
      const [a0, a1] = ARC[sector];
      ids.forEach((id, i) => {
        const t = ids.length === 1 ? 0.5 : i / (ids.length - 1);
        const ang = a0 + (a1 - a0) * t;
        targets.set(id, { x: Math.cos(ang) * radius, y: Math.sin(ang) * radius });
      });
    }
  }
  return targets;
}

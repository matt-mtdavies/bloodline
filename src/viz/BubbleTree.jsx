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
import { BirthEffect } from './birth.js';
import { LandingBurst } from './landing.js';
import { drawLinks, drawLinksChart } from './links.js';
import { computeChartLayout } from './chartLayout.js';
import { distancesFrom, relationLabel } from '../data/graph.js';
import { Spring } from '../lib/spring.js';

const BASE_RADIUS = 46;
const COLLIDE = 70;
const GEN_GAP = 280; // shorter bands so wide screens use horizontal space too
// Chart-view layout lives in ./chartLayout.js (tidy descendant tree).
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
  expandedIds = null,
  onActivate,
  onCollapse,
  onOpenPerson,
  reducedMotion,
  layout = 'organic',
  mergeParents = false,
  lineagePath = null,
  lineageEndId = null,
  invitedIds = null,
  timeMode = false,
  timeYear = null,
  focusMode = false,
  browse = false,
  onDeselect,
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
  const lineageEndRef = useRef(lineageEndId);
  lineageEndRef.current = lineageEndId;
  const invitedRef = useRef(invitedIds);
  invitedRef.current = invitedIds;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const timeModeRef = useRef(timeMode);
  timeModeRef.current = timeMode;
  const timeYearRef = useRef(timeYear);
  timeYearRef.current = timeYear;
  const focusRef = useRef(focusMode);
  focusRef.current = focusMode;
  const browseRef = useRef(browse);
  browseRef.current = browse;
  const onDeselectRef = useRef(onDeselect);
  onDeselectRef.current = onDeselect;
  // Callbacks are captured once in the mount effect, so we route them through
  // refs to ensure React prop changes (e.g. lineage mode toggling onOpenPerson)
  // are always reflected without re-mounting the canvas.
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;
  const onCollapseRef = useRef(onCollapse);
  onCollapseRef.current = onCollapse;
  const expandedRef = useRef(expandedIds);
  expandedRef.current = expandedIds;
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
      // Birth-celebration effects (time view) render above the bubbles so the
      // bloom + motes read over neighbours. Transient; self-cleaning.
      const fxLayer = new Container();
      fxLayer.eventMode = 'none';
      world.addChild(fxLayer);
      const births = new Map();      // personId → BirthEffect (currently animating)
      const wasVisible = new Set();  // bubbles visible last frame, to spot new arrivals
      let fxSeeded = false;          // first frame seeds wasVisible without celebrating
      // Focus-mode relationship captions (e.g. "Father", "Niece"), cached by id
      // and rebuilt when the active person or graph changes (relationships are
      // relative to the active person).
      const relCache = new Map();

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

      // Resting generational pull. Focus Family wants crisp rows — parents
      // clearly above, children clearly below — so the band force is much
      // stronger while focused; otherwise it's a gentle organic drift.
      const restingYStrength = () => (focusRef.current ? 0.4 : 0.085);

      // Y-band target generation. A partner with no ancestry of their own (a
      // childless in-law, including a former partner we deliberately keep out
      // of generation *leveling*) would otherwise default to gen 0 and float
      // up to the eldest row. Lift them to sit on their partner's row instead —
      // layout only; the stored `gen` (chart rows, labels) is untouched. Safe
      // because a childless person has no descendants to cascade.
      const layoutGen = (id) => {
        let g = gen.get(id) ?? 0;
        if (graphRef.current.parents(id).length === 0) {
          for (const p of graphRef.current.partners(id)) {
            const pg = gen.get(p.id) ?? 0;
            if (pg > g) g = pg;
          }
        }
        return g;
      };
      const genYTarget = (d) => layoutGen(d.id) * GEN_GAP - 260;

      const sim = forceSimulation(nodes)
        .force('link', linkForce)
        .force('charge', forceManyBody().strength(ORGANIC_CHARGE).distanceMax(1200))
        .force('collide', forceCollide(COLLIDE).strength(0.9))
        .force('x', forceX(0).strength(SPREAD_X))
        .force('y', forceY(genYTarget).strength(restingYStrength()))
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
      const manualPins = new Set(); // nodes the user has manually repositioned
      let flight = null;      // active search flyover, see state.flyAlong()
      let landingFx = null;   // the flyover's arrival burst (single-slot, self-cleaning)

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
          const genY = genYTarget;
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
            // (stronger generational rows while Focus Family is active).
            sim.force('charge', forceManyBody().strength(ORGANIC_CHARGE).distanceMax(1200));
            sim.force('x', forceX(0).strength(SPREAD_X));
            sim.force('y', forceY(genY).strength(restingYStrength()));
            linkForce
              .distance((l) => (l.kind === 'partner' ? 112 : 280))
              .strength((l) => (l.kind === 'partner' ? 0.9 : 0.26));
          }
          sim.alpha(0.7);
        },
        applyChartLayout() {
          const chartPos = computeChartLayout(graphRef.current, activeRef.current);
          state._chartVisible = new Set(chartPos.keys());
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
            // Restore dynamics when leaving chart mode, but keep manual drag pins.
            for (const n of nodes) {
              if (!manualPins.has(n.id)) { n.fx = null; n.fy = null; }
            }
            sim.alphaTarget(reducedMotion ? 0 : 0.012);
            sim.alpha(0.5);
          }
          state.layoutMode = mode;
          state.relayout();
        },
        setActive(id, animate = true) {
          // De-dupe: React re-syncs activeId via a prop effect even when this
          // imperative state already made the same person active (e.g. right
          // after a flyover lands) — skip the reorg/zoom kick the second time
          // so landing doesn't get an extra redundant jolt.
          const alreadyActive = id === activeRef.current;
          activeRef.current = id;
          state.dist = distancesFrom(graphRef.current, id);
          relCache.clear(); // relationships are relative to the active person
          state.enterFollow();
          if (!reducedMotion && animate && !alreadyActive) {
            zoom.velocity -= 1.6;
            // Briefly spike the Y-generational force so parents visibly float
            // upward and children sink down, making the clicked person's family
            // obvious before settling back to the gentle resting drift.
            const mode = state.layoutMode;
            if (mode !== 'chart' && mode !== 'radial') {
              if (reorgTimer) clearTimeout(reorgTimer);
              const genY = genYTarget;
              sim.force('y', forceY(genY).strength(0.45));
              sim.alpha(0.88);
              reorgTimer = setTimeout(() => {
                reorgTimer = null;
                if (state.layoutMode !== 'chart' && state.layoutMode !== 'radial') {
                  sim.force('y', forceY(genY).strength(restingYStrength()));
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
          relCache.clear(); // graph changed — relationship labels may differ
          if (state.layoutMode === 'radial' || state.layoutMode === 'weighted') state.relayout();
          if (state.layoutMode === 'chart') state.applyChartLayout();
        },
        // Focus Family toggled — re-apply the (now stronger/weaker) generational
        // banding, refresh relationship captions, and reheat so rows re-form.
        refreshFocus() {
          relCache.clear();
          if (state.layoutMode !== 'chart' && state.layoutMode !== 'radial') {
            sim.force('y', forceY(genYTarget).strength(restingYStrength()));
            sim.alpha(0.6);
          }
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
          // Release manual drag pins so refocus can rearrange freely.
          for (const id of manualPins) {
            const n = nodeById.get(id);
            if (n) { n.fx = null; n.fy = null; }
          }
          manualPins.clear();
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
        // Search's "wow" moment: fly the camera along an ordered chain of people
        // (from the active person to a search result) instead of jump-cutting.
        // A single continuous glide through everyone's real position — never a
        // slideshow of stops — with the path progressively lighting up as the
        // camera passes (see the ticker's 'flight' branch + effectiveLineage
        // below). Ends with a tight landing punch, then hands back to the
        // normal follow framing so the spring eases out to reveal the family.
        flyAlong(orderedIds, opts = {}) {
          const pts = orderedIds.map((id) => nodeById.get(id)).filter(Boolean);
          if (reducedMotion || pts.length < 2) {
            if (pts.length) state.setActive(orderedIds[orderedIds.length - 1]);
            opts.onLand?.();
            return;
          }
          vx = vy = 0;
          pointers.clear();
          pinch.active = false;
          drag.type = 'none';
          drag.node = null;
          camMode = 'flight';
          const hops = pts.length - 1;
          flight = {
            ids: orderedIds,
            pts,
            hops,
            t: 0,
            duration: clamp(1.8 + hops * 0.65, 2.4, 4.8),
            landDuration: 0.9,
            phase: 'transit',
            litIndex: 0,
            startZoom: zoom.value,
            onSegment: opts.onSegment || null,
            onLand: opts.onLand || null,
          };
          flight.onSegment?.(orderedIds[0]);
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
      const drag = { type: 'none', node: null, id: null, start: null, moved: false, onPip: false };
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

      // True when the tapped element is a bubble's collapse pip (the little "−"),
      // so we can collapse only on the pip and select on the rest of the bubble.
      const isCollapsePipTarget = (t) => {
        let n = t;
        while (n) {
          if (n.__isCollapsePip) return true;
          if (n.__bubbleId !== undefined) return false;
          n = n.parent;
        }
        return false;
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
          if (flight) { flight = null; landingFx?.destroy(); landingFx = null; }
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
          drag.onPip = isCollapsePipTarget(e.target);
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
          // A real drag interrupts the flyover — hand control back to the user
          // right where the camera is, no jump.
          if (flight) { flight = null; landingFx?.destroy(); landingFx = null; }
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
          if (!drag.moved && flight) {
            // Ignore taps while the flyover is mid-flight — let it land cleanly
            // rather than racing a manual selection.
          } else if (!drag.moved) {
            // Tap routing:
            //   • the little "−" pip   → collapse this branch (only the pip does this)
            //   • the active person    → open their profile
            //   • anyone else          → select them (even if already expanded)
            if (drag.onPip) {
              onCollapseRef.current?.(drag.id);
            } else if (!browseRef.current && activeRef.current === drag.id) {
              onOpenPersonRef.current?.(drag.id);
            } else {
              onActivateRef.current?.(drag.id);
            }
          } else if (drag.node && drag.id !== state.pinnedId) {
            // Leave fx/fy set — node stays where dropped; neighbours settle around it.
            manualPins.add(drag.id);
          }
          if (!reducedMotion) sim.alphaTarget(0.012); // settle back to idle drift
        } else if (drag.type === 'pan' && !drag.moved) {
          // A clean tap on empty canvas → deselect into browse mode (every bubble
          // back to full brightness). Only in the free-flowing views: chart,
          // lineage and focus-family all rely on a selection, so skip them.
          const mode = layoutRef.current;
          if (mode !== 'chart' && !lineageRef.current && !focusRef.current) {
            onDeselectRef.current?.();
          }
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
        // In chart mode we render a scoped subset (±2 generations around the focal
        // person) rather than the full visible set, so 76 people don't collapse to
        // unreadably small bubbles. effectiveVis drives all rendering and camera framing.
        const effectiveVis = layoutRef.current === 'chart' && state._chartVisible
          ? state._chartVisible
          : vis;

        const W = app.screen.width;
        const H = app.screen.height;
        // Reserve a band at the top for the masthead so bubbles never sit under
        // it; the visible family is framed in the centre of the safe area.
        const topInset = Math.min(120, H * 0.16);
        const cx = W / 2;
        const cy = (H + topInset) / 2;

        const f = nodeById.get(activeRef.current);
        if (camMode === 'flight' && flight) {
          // FLIGHT — the search flyover. One continuous glide through everyone's
          // real position (a Catmull-Rom curve through the path, not a straight
          // line — see sampleAlongPath), never stopping until landing. Wide
          // "travel" zoom gives it a drone feel; the landing phase punches in
          // tight on the destination before handing back to normal follow.
          if (flight.phase === 'transit') {
            flight.t += dt;
            const u = clamp(flight.t / flight.duration, 0, 1);
            const eased = easeInOutCubic(u);
            const p = sampleAlongPath(flight.pts, eased);
            camX.value = camX.target = p.x;
            camY.value = camY.target = p.y;
            camX.velocity = camY.velocity = 0;

            const travelZ = clamp(0.72, MIN_ZOOM, MAX_ZOOM);
            const zt = easeInOutCubic(Math.min(1, u / 0.3));
            zoom.value = zoom.target = flight.startZoom + (travelZ - flight.startZoom) * zt;
            zoom.velocity = 0;

            const idx = Math.min(flight.hops, Math.round(eased * flight.hops));
            if (idx > flight.litIndex) {
              flight.litIndex = idx;
              flight.onSegment?.(flight.ids[idx]);
            }

            if (u >= 1) {
              flight.phase = 'landing';
              flight.t = 0;
              flight.landStartZoom = zoom.value;
              flight.litIndex = flight.hops;
              const dest = flight.pts[flight.pts.length - 1];
              landingFx?.destroy();
              landingFx = new LandingBurst({ x: dest.x, y: dest.y }, BASE_RADIUS);
              fxLayer.addChild(landingFx.root);
            }
          } else {
            // 'landing' — punch in tight on the destination, then hand off.
            flight.t += dt;
            const u = clamp(flight.t / flight.landDuration, 0, 1);
            const dest = flight.pts[flight.pts.length - 1];
            camX.value = camX.target = dest.x;
            camY.value = camY.target = dest.y;
            camX.velocity = camY.velocity = 0;
            const punchZ = clamp(1.85, MIN_ZOOM, MAX_ZOOM);
            const ez = easeInOutCubic(u);
            zoom.value = zoom.target = flight.landStartZoom + (punchZ - flight.landStartZoom) * ez;
            zoom.velocity = 0;
            if (u >= 1) {
              const finished = flight;
              flight = null;
              state.setActive(finished.ids[finished.ids.length - 1], false);
              camMode = 'follow'; // setActive() re-enters follow anyway; explicit for clarity
              finished.onLand?.();
            }
          }
        } else if (camMode === 'follow' && f && !state.isDraggingBubble?.()) {
          // FOLLOW — frame the whole revealed family: centre on the bounding box
          // of the visible bubbles (gently biased toward the active person so
          // they stay central) and zoom so it fills the safe area. Even a handful
          // of people then spread out and use the screen instead of huddling.
          const rr = BASE_RADIUS * 1.5;
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (const id of effectiveVis) {
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
          let camTX = ((minX + maxX) / 2) * (1 - BIAS) + f.x * BIAS;
          let camTY = ((minY + maxY) / 2) * (1 - BIAS) + f.y * BIAS;

          // During a birth celebration (time view), pull the frame toward the
          // newest arrival so the bloom + motes land in the clear centre of the
          // safe area, never under the dock/slider. Eases back when it ends.
          if (births.size && timeModeRef.current) {
            let bx = 0, by = 0, bn = 0;
            for (const id of births.keys()) {
              const node = nodeById.get(id);
              if (node) { bx += node.x; by += node.y; bn++; }
            }
            if (bn) {
              const BB = 0.6;
              camTX = camTX * (1 - BB) + (bx / bn) * BB;
              camTY = camTY * (1 - BB) + (by / bn) * BB;
            }
          }
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
        // During a search flyover, shadow the real lineage prop with the path
        // "lit" so far (grows each time the camera passes a hop) — same dim /
        // highlight / ring rendering Lineage Mode already uses, just fed a
        // progressively-growing set instead of a static one.
        const lineage = flight ? new Set(flight.ids.slice(0, flight.litIndex + 1)) : lineageRef.current;
        const lineageEnd = flight ? flight.ids[flight.ids.length - 1] : lineageEndRef.current;

        // ── Landing burst (search flyover arrival) ───────────────────────────
        if (landingFx) {
          landingFx.update(dt);
          if (landingFx.done) { landingFx.destroy(); landingFx = null; }
        }

        // ── Birth celebrations (time view) ──────────────────────────────────
        // Spot bubbles that *just* appeared because the timeline crossed their
        // birth year, and greet each with a light-arrival animation. The first
        // frame only seeds the baseline so the initial population never all
        // fireworks at once.
        if (!fxSeeded) {
          for (const id of effectiveVis) wasVisible.add(id);
          fxSeeded = true;
        } else if (!reducedMotion && timeModeRef.current && births.size < 14) {
          const yr = timeYearRef.current;
          for (const id of effectiveVis) {
            if (wasVisible.has(id) || births.has(id)) continue;
            const person = bubblePerson.get(id);
            const born = person?.birth_date ? parseInt(person.birth_date, 10) : null;
            if (born == null || yr == null || born !== yr) continue; // only true births
            const dest = nodeById.get(id);
            if (!dest) continue;
            // Light descends from the midpoint of any visible parents, else from
            // just above — a root is "born into the world" from above.
            const vps = graphRef.current.parents(id).filter((p) => effectiveVis.has(p.id));
            let origin;
            if (vps.length) {
              const pn = vps.map((p) => nodeById.get(p.id)).filter(Boolean);
              origin = {
                x: pn.reduce((s, p) => s + p.x, 0) / pn.length,
                y: pn.reduce((s, p) => s + p.y, 0) / pn.length,
              };
            } else {
              origin = { x: dest.x, y: dest.y - BASE_RADIUS * 5 };
            }
            const fx = new BirthEffect({ x: dest.x, y: dest.y }, origin, BASE_RADIUS);
            fxLayer.addChild(fx.root);
            births.set(id, fx);
          }
        }
        // Sync the baseline for next frame.
        for (const id of [...wasVisible]) if (!effectiveVis.has(id)) wasVisible.delete(id);
        for (const id of effectiveVis) wasVisible.add(id);

        for (const [id, b] of bubbles) {
          const n = nodeById.get(id);
          b.root.position.set(n.x, n.y);
          const d = dmap.has(id) ? dmap.get(id) : 6;
          let target;
          if (!effectiveVis.has(id)) {
            target = { scale: 0.5, alpha: 0, lift: 1, blur: 0 }; // collapsed
          } else if (browseRef.current && layoutRef.current !== 'chart' && !lineage) {
            // Browse mode: nobody selected — every bubble equal and fully lit so
            // you can pan through and study the whole tree.
            target = { scale: 0.95, alpha: 1, lift: 1, blur: 0 };
          } else if (layoutRef.current === 'chart') {
            // Chart mode: uniform scale so every drop-line lands exactly on the
            // bubble edge (variable scale would create gaps/overlaps with the
            // fixed baseRadius used in the line endpoint calculation).
            const isActive = id === activeRef.current;
            target = { scale: isActive ? 1.1 : 1.0, alpha: 1, lift: isActive ? 1.2 : 1, blur: 0 };
          } else if (lineage && !lineage.has(id)) {
            target = { ...visualForDistance(d), alpha: 0.12, blur: 1.5 }; // off-path — recede
          } else if (lineage && lineage.has(id)) {
            // On lineage path: uniform, prominent, un-dimmed regardless of hop distance.
            // The flyover's destination gets an extra punch during the landing beat.
            const landingPunch = flight?.phase === 'landing' && id === lineageEnd;
            target = landingPunch
              ? { scale: 1.22, alpha: 1, lift: 1.6, blur: 0 }
              : { scale: 1.02, alpha: 1, lift: 1.3, blur: 0 };
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
          const labelAlpha = (!cardOpen && !lineage && effectiveVis.has(id)) ? 1 : 0;
          const birth = births.get(id);
          if (birth && !birth.bubbleSettled && effectiveVis.has(id)) {
            // The birth effect owns the pop: it scales the bubble up with an
            // elastic overshoot synced to the bloom, then hands back seamlessly.
            const ent = birth.bubbleEntrance();
            b.applyBirthEntrance(target.scale, ent.scale, ent.alpha);
          } else {
            b.setVisualState({ ...target, labelAlpha }, dt);
          }
          // Ring both ends of a traced lineage so the line's poles stand out.
          const ringed = id === activeRef.current || (lineage && id === lineageEnd);
          b.setActive(!browseRef.current && ringed);
          b.setCollapsePip(
            !flight &&
            effectiveVis.has(id) &&
            id !== activeRef.current &&
            !!(expandedRef.current?.has(id)),
          );
          b.setInvited(!!(invitedRef.current?.has(id)));
          b.setChartBadge(layoutRef.current === 'chart');

          // Focus Family: caption each bubble with its relationship to the active
          // person ("Father", "Niece", …). Cached per id (cleared on active/graph
          // change). In focus mode this caption replaces the depth-hint dots so
          // the space below the name reads cleanly.
          // Relationship caption ("Father", "Niece", …) — shown in Focus Family
          // and in the Chart view (both want the perspective spelled out), but
          // not when a card or lineage path is open.
          const showRel = (focusRef.current || layoutRef.current === 'chart')
            && !cardOpen && !lineage;
          let relText = null;
          if (showRel && effectiveVis.has(id) && id !== activeRef.current) {
            relText = relCache.get(id);
            if (relText === undefined) {
              relText = relationLabel(graphRef.current, activeRef.current, id);
              relCache.set(id, relText);
            }
          }
          b.setRelationLabel(relText);

          // Depth hints: show on visible bubbles that have family beyond the
          // current reveal — suppressed in focus mode, the chart, and mid-flight
          // (the relationship caption / flyover glow takes that slot).
          if (!flight && effectiveVis.has(id) && !focusRef.current && layoutRef.current !== 'chart') {
            const gg = graphRef.current;
            b.setDepthHint(
              gg.parents(id).some((x) => !effectiveVis.has(x.id)),
              gg.children(id).some((x) => !effectiveVis.has(x.id)),
            );
          } else {
            b.setDepthHint(false, false);
          }
          b.root.zIndex = id === activeRef.current ? 100 : -d;
        }

        // Advance + retire birth celebrations. An effect ends when its clock
        // runs out, or early if its person was collapsed/scrubbed away.
        if (births.size) {
          for (const [id, fx] of births) {
            fx.update(dt);
            if (fx.done || !effectiveVis.has(id)) {
              fx.destroy();
              births.delete(id);
            }
          }
        }

        // Generation row backgrounds in chart mode — alternating warm bands.
        // Keyed by the layout's row Y (each generation shares one Y) so bands
        // line up exactly with the tidy-tree rows.
        genBandsGfx.clear();
        if (layoutRef.current === 'chart') {
          const byRow = new Map();
          for (const id of effectiveVis) {
            const n = nodeById.get(id);
            if (!n) continue;
            const key = Math.round(n.y);
            if (!byRow.has(key)) byRow.set(key, { minX: Infinity, maxX: -Infinity, y: n.y });
            const row = byRow.get(key);
            if (n.x - BASE_RADIUS < row.minX) row.minX = n.x - BASE_RADIUS;
            if (n.x + BASE_RADIUS > row.maxX) row.maxX = n.x + BASE_RADIUS;
          }
          const PAD_X = 56, BAND_H = 150;
          const bandColors = [0xfaf7f4, 0xf5f0eb];
          [...byRow.keys()].sort((a, b) => a - b).forEach((key, gi) => {
            const row = byRow.get(key);
            if (!isFinite(row.minX)) return;
            const bx = row.minX - PAD_X;
            const bw = row.maxX - row.minX + PAD_X * 2;
            const by = row.y - BAND_H / 2;
            genBandsGfx.roundRect(bx, by, bw, BAND_H, 12)
              .fill({ color: bandColors[gi % 2], alpha: 0.72 });
          });
        }

        linkGfx.alpha = cardOpen ? 0.18 : 1;
        genBandsGfx.alpha = cardOpen ? 0.1 : 1;
        if (layoutRef.current === 'chart') {
          drawLinksChart(linkGfx, graphRef.current, pos, (id) => effectiveVis.has(id), BASE_RADIUS, lineage);
        } else {
          drawLinks(linkGfx, graphRef.current, pos, (id) => vis.has(id), BASE_RADIUS, mergeRef.current, lineage, activeRef.current);
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

  // Focus Family toggled: tighten/loosen the generational rows + refresh the
  // relationship captions shown on bubbles.
  useEffect(() => {
    focusRef.current = focusMode;
    api.current?.refreshFocus();
  }, [focusMode]);

  // Re-place nodes when the visible set changes: radial/weighted re-run forces,
  // chart re-computes fixed grid positions.
  useEffect(() => {
    const m = api.current?.layoutMode;
    if (m === 'radial' || m === 'weighted') api.current.relayout();
    if (m === 'chart') api.current?.applyChartLayout();
  }, [visibleIds]);

  return <div className="stage" ref={hostRef} aria-hidden="true" />;
}

const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// Smooth Catmull-Rom curve through an ordered list of {x,y} points — the
// search flyover's flight path. u is normalised progress across the WHOLE
// route (0 = first point, 1 = last), so the camera glides through every hop
// as one continuous curve rather than a chain of straight-line segments.
// End segments clamp by duplicating the boundary point (standard Catmull-Rom).
function sampleAlongPath(pts, u) {
  const n = pts.length;
  if (n === 1) return { x: pts[0].x, y: pts[0].y };
  const segCount = n - 1;
  const scaled = clamp(u, 0, 1) * segCount;
  let seg = Math.floor(scaled);
  if (seg >= segCount) seg = segCount - 1;
  const t = scaled - seg;
  const p0 = pts[seg - 1] || pts[seg];
  const p1 = pts[seg];
  const p2 = pts[seg + 1];
  const p3 = pts[seg + 2] || pts[seg + 1];
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
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

  // Level active partners onto the same generation band using MAX — the deeper
  // partner's row wins, pulling the shallower one down to meet them.
  //
  // Former/ex partners are deliberately EXCLUDED: an ex from a different family
  // branch may have deeper ancestry, and dragging the current family member
  // down to match would cascade incorrectly (e.g. Jason getting pulled to
  // Kate's row instead of staying with Matthew).
  //
  // Multi-pass until stable so any chains converge (A=B, B=C → A=B=C).
  let changed = true;
  while (changed) {
    changed = false;
    const seen = new Set();
    for (const p of graph.people) {
      for (const partner of graph.partners(p.id)) {
        if (partner.status === 'former') continue;
        const key = [p.id, partner.id].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        const a = gen.get(p.id) ?? 0;
        const b = gen.get(partner.id) ?? 0;
        if (a === b) continue;
        const lvl = Math.max(a, b);
        if (a !== lvl) { gen.set(p.id, lvl);           changed = true; }
        if (b !== lvl) { gen.set(partner.id, lvl);     changed = true; }
      }
    }
  }

  return gen;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
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

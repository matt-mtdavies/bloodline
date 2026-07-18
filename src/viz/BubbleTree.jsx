import { useEffect, useRef, useState } from 'react';
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
import { IgniteEffect } from './ignite.js';
import { FlightComet } from './comet.js';
import { drawLinks, drawLinksChart } from './links.js';
import { computeChartLayout } from './chartLayout.js';
import { distancesFrom, relationLabel, computeGenerations } from '../data/graph.js';
import { Spring } from '../lib/spring.js';
import { kinTermsStore } from '../lib/kinTerms.js';

const BASE_RADIUS = 46;
const COLLIDE = 70;
const GEN_GAP = 280; // shorter bands so wide screens use horizontal space too
// Chart-view layout lives in ./chartLayout.js (tidy descendant tree).
const ORGANIC_CHARGE = -1800; // stronger repulsion spreads generations sideways
const SPREAD_X = 0.004; // weaker centring lets nodes fan out naturally
const MAX_ZOOM = 2.0; // auto-fit (follow mode) — higher cap so small focus families fill the screen
const MIN_ZOOM = 0.16; // free zoom-out: take in a huge tree at a glance (double the old 0.32 floor's field of view)
// Two different floors for the same follow-mode fit, on purpose: an ordinary
// tap-to-reveal should keep behaving exactly as it always did (a modest
// pull-back to frame whoever's newly visible, floor 0.4) — it should never
// borrow the deep zoom-out meant for the deliberate "show everyone" moment.
// That one (WHOLE_TREE_FIT_FLOOR, 0.2) only applies once every person in the
// tree is actually expanded (see wholeTreeActive below), which is otherwise
// only reachable via the explicit "Show all" toggle.
const FIT_FLOOR = 0.4;
const WHOLE_TREE_FIT_FLOOR = 0.2;
// Below this zoom, bubbles are too small and packed together to grab on
// purpose — a finger meant for panning the canvas keeps landing on one
// instead, dragging it out of place. A tap still selects (see
// drag.tapCandidateId below); only the drag-to-reposition behaviour is
// disabled, and only this far out.
const BUBBLE_DRAG_MIN_ZOOM = 0.3;
const MAX_ZOOM_FREE = 2.8; // free zoom-in: lean right into a single face
const RECAP_ZOOM = 2.2; // the recap tour's "hero" close-up — big and dramatic, but under MAX_ZOOM_FREE
const PAN_FRICTION = 0.92; // inertial glide decay (per 1/60 s)
const FLICK_STOP = 1.5; // world units/s below which the glide rests
const DOUBLE_TAP_MS = 280; // window for a double-tap-to-recentre
const SEARCH_LANDED_SCALE = 1.55; // bigger than the default active-person baseline (1.38) — the just-found search target keeps reading as the standout even once the camera has zoomed back out to fit the family

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
  lineagePath = null,
  lineageEndId = null,
  invitedIds = null,
  timeMode = false,
  timeYear = null,
  focusMode = false,
  browse = false,
  onDeselect,
  onCameraMode,
  onHover,
  apiRef,
}) {
  const hostRef = useRef(null);
  // WebGL context creation can fail silently on some devices (observed on
  // iOS Safari: repeated PWA suspend/relaunch cycles can exhaust its
  // per-process WebGL context limit) — app.init() then rejects and, with no
  // handler, the canvas just never appears with no visible error at all.
  // Catching it turns that into a legible "reload" state instead.
  const [initFailed, setInitFailed] = useState(false);
  const api = useRef(null);
  const activeRef = useRef(activeId);
  const visibleRef = useRef(visibleIds);
  visibleRef.current = visibleIds;
  const graphRef = useRef(graph);
  graphRef.current = graph; // always the live graph for the loop + sync
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
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;

  // ── Mount Pixi + the simulation once ──────────────────────────────────────
  useEffect(() => {
    let alive = true;
    let hoverTimer = null; // shared with the cleanup below, which runs outside the async IIFE
    let onVisibility = null; // ditto — assigned inside the IIFE, removed in the cleanup
    let unsubKinTerms = null; // ditto — assigned inside the IIFE, called in the cleanup
    const host = hostRef.current;
    const app = new Application();

    (async () => {
      try {
        await app.init({
          antialias: true,
          backgroundAlpha: 0,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          autoDensity: true,
          resizeTo: host,
          preference: 'webgl',
        });
      } catch (err) {
        console.error('BubbleTree: PixiJS/WebGL failed to initialize', err);
        if (alive) setInitFailed(true);
        return;
      }
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
      const recapFx = new Map();     // personId → BirthEffect-style bloom (recap tour arrivals)
      const recapVisited = new Set(); // personId → already visited this recap tour (stays legible, not blurred)
      let searchSpotlightId = null;  // personId just landed on via search flyover — stays visually elevated until focus moves elsewhere
      const crumbPulse = new Map();  // personId → pulseAt, a brief tap-feedback bump when a landed FlightCaption crumb is tapped
      const wasVisible = new Set();  // bubbles visible last frame, to spot new arrivals
      let fxSeeded = false;          // first frame seeds wasVisible without celebrating
      // Focus-mode relationship captions (e.g. "Father", "Niece"), cached by id
      // and rebuilt when the active person or graph changes (relationships are
      // relative to the active person), or when the viewer changes their
      // grandparent term preference (kinTerms.js) — a plain subscribe rather
      // than a React prop, since this whole closure is imperative/mount-once.
      const relCache = new Map();
      unsubKinTerms = kinTermsStore.subscribe(() => relCache.clear());

      const graph = graphRef.current; // initial build snapshot

      // Generation index (roots = 0) gives the layout legible vertical bands
      // and the radial sectors. Recomputed when people are added.
      let gen = computeGenerations(graph);

      // Simulation nodes exist only for people who are actually part of the
      // revealed set — not the whole family. A 1000-person tree someone is
      // quietly browsing one branch of shouldn't pay simulation/render cost
      // for the other 950 they've never navigated to. Anyone not yet tracked
      // is spawned lazily the moment they enter visibleIds — see
      // ensureVisible() below and its [visibleIds] effect.
      const nodes = graph.people
        .filter((p) => visibleRef.current?.has(p.id))
        .map((p) => ({
          id: p.id,
          x: (Math.random() - 0.5) * 600,
          y: (gen.get(p.id) ?? 0) * GEN_GAP - 260 + (Math.random() - 0.5) * 30,
        }));
      const nodeById = new Map(nodes.map((n) => [n.id, n]));
      const pos = new Map(nodes.map((n) => [n.id, n]));
      // Tracks whether the last sync() actually changed the tree's shape, so a
      // purely cosmetic edit (a photo/bio/tag update background-migrated to
      // R2, someone else's unrelated save merging in, etc.) doesn't reheat
      // the whole simulation and visibly "jiggle" every bubble on screen.
      // Content-based (not reference-based): every server merge/reload
      // rebuilds a fresh relationships array even when nothing changed.
      let lastRelationshipSig = relSignature(graph.relationships);

      // Only links between two currently-tracked people are meaningful to the
      // simulation — a relationship reaching an untracked (not-yet-revealed)
      // person would otherwise hand d3-force an unresolvable link id.
      const buildLinks = (rels) =>
        rels
          .filter(
            (r) => (r.type === 'partner' || r.type === 'parent')
              && nodeById.has(r.from_person) && nodeById.has(r.to_person),
          )
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

      // Parent-above-child correction: the resting Y-band force (restingYStrength)
      // is deliberately gentle so the organic layout can drift and breathe, which
      // occasionally lets local crowding (siblings bunching, charge/collision) push
      // a parent below their own child even though its band target is correctly
      // above. This only nudges pairs that are ACTUALLY inverted right now — a
      // correctly-ordered pair is left completely alone, so most of the time this
      // does nothing at all. It never touches a manually-dragged bubble's resting
      // spot: nodes with fx/fy set are repositioned by the simulation's own tick
      // regardless of any vy this adds, so a pinned bubble still doesn't move.
      sim.force('parentAbove', (alpha) => {
        const mode = layoutRef.current;
        if (mode === 'chart' || mode === 'radial') return;
        const minGap = GEN_GAP * 0.35;
        for (const r of graphRef.current.relationships) {
          if (r.type !== 'parent') continue;
          const parent = nodeById.get(r.from_person);
          const child = nodeById.get(r.to_person);
          if (!parent || !child) continue;
          const violation = (parent.y + minGap) - child.y; // >0 → parent too low
          if (violation <= 0) continue;
          const push = violation * 0.1 * alpha;
          parent.vy -= push;
          child.vy += push;
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
      for (const n of nodes) {
        const p = graph.byId.get(n.id);
        const b = new Bubble(p, BASE_RADIUS);
        b.root.__bubbleId = p.id;
        bubbleLayer.addChild(b.root);
        bubbles.set(p.id, b);
        bubblePerson.set(p.id, p);
      }

      // Materializes a sim node + Pixi bubble for a person who wasn't tracked
      // yet — either a brand-new person from a data edit (sync()) or an
      // existing person who's only just entered the revealed set
      // (ensureVisible()). Anchored near whichever already-tracked relative
      // connects to them, so they appear to sprout from that person rather
      // than pop in at the world origin.
      const spawnBubble = (p) => {
        const rel = graphRef.current.relationships.find(
          (r) =>
            (r.from_person === p.id && nodeById.has(r.to_person)) ||
            (r.to_person === p.id && nodeById.has(r.from_person)),
        );
        const anchor = rel
          ? nodeById.get(rel.from_person === p.id ? rel.to_person : rel.from_person)
          : nodeById.get(activeRef.current);
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
      };

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
      let recap = null;       // active recap tour, see state.spotlightTour()
      let flightComet = null; // the "drone light" riding the route during transit
      const igniteFx = new Set(); // in-flight IgniteEffect instances, self-removing when done
      // The lit path persists after the flight lands (not just the caption) —
      // see the frame loop below. null once expired/not applicable; when set,
      // these are the SAME Map instances flight.litSet / flight.edgeLitAt
      // held (id/edge-key -> { litAt, hopIndex }), so the pop/burn/extinguish
      // timing continues uninterrupted into the linger window. hopIndex is
      // what drives the extinguish sweep below — it has nothing to do with
      // when a thing was lit, only where it sits along the route.
      let postFlightIds = null;    // Map<personId, {litAt, hopIndex}>
      let postFlightEdges = null; // Map<edgeKey, {litAt, hopIndex}>
      let postFlightLandedAt = 0; // 0 = not applicable (no flight has landed since)
      let postFlightHops = 0;     // how many hops the finished flight had, for the sweep + overall expiry
      // The lit path doesn't fade all at once — it goes dark the same order it
      // lit, starting from the viewer's own seat (hopIndex 0) and sweeping
      // toward the destination, each hop's fade starting STAGGER_MS after the
      // previous one's. Held fully bright for HOLD_MS after landing first.
      const HOLD_MS = 3200;
      const STAGGER_MS = 480;
      const FADE_MS = 1500;

      // 1 while a hop hasn't reached its turn to fade yet, easing to 0 over
      // FADE_MS once it has. landedAt === 0 means "still mid-flight, or no
      // flight involved at all" — always fully lit, no sweep.
      const hopFade = (landedAt, hopIndex, nowMs) => {
        if (!landedAt) return 1;
        const age = nowMs - (landedAt + HOLD_MS + hopIndex * STAGGER_MS);
        if (age <= 0) return 1;
        return clamp(1 - age / FADE_MS, 0, 1);
      };

      // The *specific* co-parent bonus: when a hop is a real parent-child
      // step (parentId is a recorded parent of childId), their current
      // partner lights too ONLY if that partner is *also* a recorded parent
      // of the same child — the actual other half of "childId's parents",
      // not just whoever parentId happens to be married to today. A parent
      // who has since repartnered with someone unrelated to this child stays
      // dark; a genuine co-parent (including an ex, if still on record as a
      // parent) lights alongside them.
      const coParentsOf = (parentId, childId) => graphRef.current.partners(parentId)
        .filter((p) => nodeById.has(p.id))
        .filter((p) => graphRef.current.parents(childId).some((par) => par.id === p.id))
        .map((p) => p.id);

      // Every relationship edge directly between two currently-lit people
      // gets its own ignite record (litAt + the later of the two ends'
      // hopIndex, since that's when the comet actually finished "delivering"
      // to this edge) the moment BOTH ends are lit — recorded once, never
      // reset, so the burn-in only plays once per edge even as later hops
      // add more lit people around it.
      const markNewEdgesLit = (litMap, edgeMap) => {
        const now = performance.now();
        for (const r of graphRef.current.relationships) {
          if (r.type !== 'parent' && r.type !== 'partner') continue;
          const from = litMap.get(r.from_person);
          const to = litMap.get(r.to_person);
          if (!from || !to) continue;
          const key = [r.from_person, r.to_person].sort().join('|') + r.type;
          if (!edgeMap.has(key)) {
            edgeMap.set(key, { litAt: now, hopIndex: Math.max(from.hopIndex, to.hopIndex) });
          }
        }
      };

      // Lights flight.ids[idx] (if not already lit) plus, when the step from
      // idx-1 to idx is a genuine parent-child edge, that parent's actual
      // co-parent for this child — see coParentsOf above. Spawns an ignite
      // flourish for every id newly lit this call (the very first, idx=0,
      // never gets one for itself — it's the journey's start, not an
      // arrival — but a bonus co-parent revealed alongside it still does).
      const lightHop = (idx) => {
        const id = flight.ids[idx];
        const litAt = performance.now();
        const isNewArrival = !flight.litSet.has(id);
        if (isNewArrival) flight.litSet.set(id, { litAt, hopIndex: idx });
        if (isNewArrival && idx > 0) {
          const n = nodeById.get(id);
          if (n) {
            const fx = new IgniteEffect({ x: n.x, y: n.y }, BASE_RADIUS);
            fxLayer.addChild(fx.root);
            igniteFx.add(fx);
          }
        }
        if (idx > 0) {
          const prevId = flight.ids[idx - 1];
          const prevIsParent = graphRef.current.parents(id).some((p) => p.id === prevId);
          const curIsParent = !prevIsParent && graphRef.current.parents(prevId).some((p) => p.id === id);
          const parentId = prevIsParent ? prevId : curIsParent ? id : null;
          const childId = prevIsParent ? id : curIsParent ? prevId : null;
          const parentHopIndex = prevIsParent ? idx - 1 : idx;
          if (parentId) {
            for (const pid of coParentsOf(parentId, childId)) {
              if (flight.litSet.has(pid)) continue;
              flight.litSet.set(pid, { litAt, hopIndex: parentHopIndex });
              const pn = nodeById.get(pid);
              if (pn) {
                const pfx = new IgniteEffect({ x: pn.x, y: pn.y }, BASE_RADIUS);
                fxLayer.addChild(pfx.root);
                igniteFx.add(pfx);
              }
            }
          }
        }
        markNewEdgesLit(flight.litSet, flight.edgeLitAt);
      };

      // Starts the travel phase toward recap.ids[recap.idx]'s current world
      // position, timed from wherever the camera actually is right now (not
      // the previous stop's position — matters after a skip-ahead or a
      // mid-flight removal, where "now" and "the previous stop" differ).
      const beginRecapTravel = () => {
        const node = recap.pts[recap.idx];
        recap.phase = 'travel';
        recap.t = 0;
        recap.startX = camX.value;
        recap.startY = camY.value;
        recap.startZ = zoom.value;
        const dist = Math.hypot(node.x - camX.value, node.y - camY.value);
        recap.travelDuration = clamp(2.0 + dist / 1400, 2.2, 4.5);
      };

      // Ends the current dwell (if any) and either moves to the next stop or,
      // if this was the last one, finishes the tour and hands back to follow.
      const advanceRecap = () => {
        if (!recap) return;
        const nextIdx = recap.idx + 1;
        if (nextIdx >= recap.ids.length) {
          const onDone = recap.onDone;
          const lastId = recap.ids[recap.idx];
          recap = null;
          camMode = 'follow';
          // Land the tree's own focus on whoever the tour just finished on,
          // rather than snapping back to whoever was active before it
          // started — false (no animate) since the camera is already there.
          // React's activeId is the actual source of truth (a prop-effect
          // pushes it back into this internal state on every change — see
          // that effect's de-dupe comment), so this call alone won't stick;
          // onDone(lastId) below tells the caller to setActiveId too, same
          // two-call pattern flyAlong's onLand already uses.
          if (lastId) state.setActive(lastId, false);
          onDone?.(lastId);
          return;
        }
        recap.idx = nextIdx;
        beginRecapTravel();
      };

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
          // A search-landed spotlight (see flyAlong) stays elevated until
          // focus genuinely moves elsewhere — this is that "elsewhere".
          if (searchSpotlightId && id !== searchSpotlightId) searchSpotlightId = null;
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
          let structuralChange = false;
          for (const p of g.people) {
            if (!nodeById.has(p.id)) {
              // Not yet part of the revealed set — stays untracked until the
              // user actually navigates to them (see ensureVisible()), so a
              // bulk import of hundreds of new people doesn't spawn hundreds
              // of bubbles nobody's looking at yet.
              if (!visibleRef.current?.has(p.id)) continue;
              structuralChange = true;
              spawnBubble(p);
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
              structuralChange = true;
              bubbles.get(id)?.destroy();
              bubbles.delete(id);
              bubblePerson.delete(id);
              nodeById.delete(id);
              pos.delete(id);
              const i = nodes.findIndex((n) => n.id === id);
              if (i >= 0) nodes.splice(i, 1);
            }
          }
          const relSig = relSignature(g.relationships);
          if (relSig !== lastRelationshipSig) structuralChange = true;
          lastRelationshipSig = relSig;
          sim.nodes(nodes);
          linkForce.links(buildLinks(g.relationships));
          // Only reheat the simulation when the tree's actual shape changed
          // (someone added/removed, or a relationship changed) — a cosmetic
          // edit (photo, bio, tags, an R2 migration, an unrelated merge from
          // another editor) shouldn't make every bubble on screen jiggle.
          if (structuralChange) sim.alpha(0.5);
          gen = computeGenerations(g);
          state.dist = distancesFrom(g, activeRef.current);
          relCache.clear(); // graph changed — relationship labels may differ
          if (state.layoutMode === 'radial' || state.layoutMode === 'weighted') state.relayout();
          if (state.layoutMode === 'chart') state.applyChartLayout();
        },
        // Called whenever the revealed set (visibleIds) grows — materializes
        // a sim node + bubble for anyone newly part of it who wasn't tracked
        // yet. A mild, LOCAL reheat (not sync()'s full 0.5) lets the new
        // arrival settle in among its neighbours without visibly jiggling the
        // whole tree on every single expand tap.
        ensureVisible(ids) {
          let added = false;
          for (const id of ids ?? []) {
            if (nodeById.has(id)) continue;
            const p = graphRef.current.byId.get(id);
            if (!p) continue;
            spawnBubble(p);
            added = true;
          }
          if (added) {
            sim.nodes(nodes);
            linkForce.links(buildLinks(graphRef.current.relationships));
            sim.alpha(Math.max(sim.alpha(), 0.3));
          }
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
        // (from the viewer's own seat to a search result) instead of jump-cutting.
        // A single continuous glide through everyone's real position — never a
        // slideshow of stops — with the path progressively lighting up as the
        // camera passes (see the ticker's 'flight' branch + effectiveLineage
        // below). Ends with a tight landing punch, then hands back to the
        // normal follow framing so the spring eases out to reveal the family.
        flyAlong(orderedIds, opts = {}) {
          // The caller (search flyover) expands orderedIds into visibleIds in
          // the same handler that calls this, but that's an async React state
          // update — this runs synchronously, before the [visibleIds] effect
          // has had a chance to spawn them. Ensure directly rather than
          // trusting timing, or un-tracked hops would just vanish from pts.
          state.ensureVisible(orderedIds);
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
          postFlightIds = null; // a fresh flight supersedes any lingering previous one
          postFlightEdges = null;
          postFlightLandedAt = 0;
          searchSpotlightId = null; // ditto for the previous search's spotlight
          const hops = pts.length - 1;
          flight = {
            ids: orderedIds,
            pts,
            hops,
            t: 0,
            // Slow and cinematic — this is a drone gliding the family's real
            // shape, not a quick cut. ~55-70% longer than the original pacing.
            duration: clamp(2.8 + hops * 1.05, 3.6, 8.5),
            landDuration: 1.1,
            phase: 'transit',
            litIndex: 0,
            litSet: new Map(),    // personId -> {litAt, hopIndex}, drives the pop + extinguish sweep
            edgeLitAt: new Map(), // edgeKey  -> {litAt, hopIndex}, drives the burn + extinguish sweep
            startZoom: zoom.value,
            // The route's start (the viewer's seat) may be far from wherever the
            // camera actually is right now (e.g. it had wandered to look at
            // someone else's branch) — blend away from the real camera position
            // over the flight's first stretch instead of a jump-cut.
            camStartX: camX.value,
            camStartY: camY.value,
            onSegment: opts.onSegment || null,
            onLand: opts.onLand || null,
            // Fired when a manual drag/pinch takes the camera back mid-flight
            // (see endGesture/pointermove below) — never on a natural landing,
            // that's onLand's job. Lets the caller (the search flyover's
            // caption card) know the journey was abandoned rather than being
            // left showing a "still flying" state with no way to land it.
            onAbort: opts.onAbort || null,
          };
          lightHop(0); // origin lights immediately, no ignite flourish for itself
          flightComet?.destroy();
          flightComet = new FlightComet(BASE_RADIUS);
          fxLayer.addChild(flightComet.root);
          flight.onSegment?.(orderedIds[0]);
        },
        // The activity recap's "wow" moment — a slow, deliberate tour that
        // visits one changed person at a time (never a continuous glide like
        // flyAlong; each stop gets its own dwell), lands close, blooms a
        // recognition glow, and leaves a lingering ring so by the end you can
        // see the whole constellation of who changed. `orderedIds` need not be
        // connected by any relationship — recap groups are an arbitrary set of
        // people, not a path — so each hop just eases camera position/zoom
        // directly toward the next id's real position.
        spotlightTour(orderedIds, opts = {}) {
          // Same defensive reasoning as flyAlong — don't assume the caller's
          // visibleIds expansion has already been reconciled into tracked
          // nodes by the time this runs.
          state.ensureVisible(orderedIds);
          const pts = orderedIds.map((id) => nodeById.get(id)).filter(Boolean);
          if (!pts.length) { opts.onDone?.(); return; }
          recapVisited.clear();
          if (reducedMotion) {
            // No flythrough — just light every bubble at once so the (fully
            // static) queue list the caller shows instead still has something
            // to point at, and hand back immediately.
            for (const id of orderedIds) { bubbles.get(id)?.setRecapGlow(true); recapVisited.add(id); }
            const lastId = orderedIds[orderedIds.length - 1];
            if (lastId) state.setActive(lastId, false);
            opts.onDone?.(lastId);
            return;
          }
          vx = vy = 0;
          pointers.clear();
          pinch.active = false;
          drag.type = 'none';
          drag.node = null;
          camMode = 'recap';
          recap = {
            ids: [...orderedIds],
            pts,
            idx: 0,
            phase: 'travel',
            t: 0,
            startX: camX.value,
            startY: camY.value,
            startZ: zoom.value,
            dwellDuration: 3.2,
            onArrive: opts.onArrive || null,
            onDone: opts.onDone || null,
          };
          beginRecapTravel();
        },
        // Jump the tour straight to a given person (the queue list's
        // "skip ahead" tap) — cancels whatever hop is in flight and eases
        // toward the new target from wherever the camera is right now.
        spotlightGoTo(id) {
          if (!recap) return;
          const idx = recap.ids.indexOf(id);
          if (idx === -1) return;
          const fx = recapFx.get(recap.ids[recap.idx]);
          if (fx) { fx.destroy(); recapFx.delete(recap.ids[recap.idx]); }
          recap.idx = idx;
          beginRecapTravel();
        },
        // Drop one person from the active tour (the queue list's per-row
        // dismiss) without disturbing the rest of the sequence. If it was the
        // stop currently being visited, moves straight on to whatever's next.
        spotlightRemove(id) {
          if (!recap) return;
          const idx = recap.ids.indexOf(id);
          if (idx === -1) return;
          const wasCurrent = idx === recap.idx;
          recap.ids.splice(idx, 1);
          recap.pts.splice(idx, 1);
          const fx = recapFx.get(id);
          if (fx) { fx.destroy(); recapFx.delete(id); }
          if (!recap.ids.length) {
            const onDone = recap.onDone;
            recap = null;
            camMode = 'follow';
            onDone?.();
            return;
          }
          if (wasCurrent) {
            if (recap.idx >= recap.ids.length) recap.idx = recap.ids.length - 1;
            beginRecapTravel();
          } else if (idx < recap.idx) {
            recap.idx -= 1;
          }
        },
        // End the tour right now (the queue list's "Close all") — camera
        // hands back to normal follow framing. Lingering rings are left lit;
        // the caller decides when to call spotlightClearGlow() (typically
        // after a short grace period, so the "who changed" picture doesn't
        // vanish the instant you dismiss the panel).
        spotlightEnd() {
          if (recap) {
            const onDone = recap.onDone;
            const lastId = recap.ids[recap.idx];
            recap = null;
            // Same reasoning as advanceRecap's natural-completion path: land
            // on whoever the tour was showing when it was cut short, rather
            // than snapping back to whoever was active before it began.
            if (lastId) state.setActive(lastId, false);
            onDone?.(lastId);
          }
          camMode = 'follow';
          for (const [, fx] of recapFx) fx.destroy();
          recapFx.clear();
        },
        // Turn off the lingering recap rings — for the given ids, or every
        // bubble if omitted.
        spotlightClearGlow(ids) {
          const list = ids || [...bubbles.keys()];
          for (const id of list) { bubbles.get(id)?.setRecapGlow(false); recapVisited.delete(id); }
        },
        // A landed FlightCaption's reopened chain calls this when a hop is
        // tapped — brief "there it is" bump on that bubble, no camera move
        // (the whole path is already on screen, per flyToSearchResult
        // expanding every hop before the flight starts).
        pulseBubble(id) {
          crumbPulse.set(id, performance.now());
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
      const drag = {
        type: 'none', node: null, id: null, start: null, moved: false, onPip: false,
        tapCandidateId: null, // a bubble tapped while too zoomed-out to drag (see BUBBLE_DRAG_MIN_ZOOM)
      };
      let last = null;
      let lastT = 0;
      let lastTap = { t: 0, x: 0, y: 0 };
      const pointers = new Map();
      const pinch = { active: false, dist0: 0, zoom0: 1 };

      // iOS (and some Android WebViews) can suspend JS mid-touch when the app
      // is backgrounded — a finger lifted while away never fires its
      // pointerup/pointercancel, leaving a phantom entry in `pointers` that
      // survives the trip. On return, that stale entry plus a real new touch
      // reads as two fingers, silently forcing every single-finger drag into
      // pinch-zoom; a second background/foreground cycle can wedge `drag` in
      // a stuck state that swallows taps entirely. This is the same reset
      // `recenter()` already applies for the user-visible symptom (tapping
      // Browse "unsticks" it) — running it automatically the moment the page
      // becomes visible again means it never gets stuck in the first place.
      onVisibility = () => {
        if (document.visibilityState !== 'visible') return;
        pointers.clear();
        pinch.active = false;
        drag.type = 'none';
        drag.node = null;
        drag.moved = false;
        vx = vy = 0;
      };
      document.addEventListener('visibilitychange', onVisibility);

      // ── Hover preview (desktop only) ──────────────────────────────────────
      // Fine-pointer devices only — never activates from touch. A short dwell
      // avoids firing a card for every bubble the cursor sweeps past while
      // panning; any drag/pinch/pointer-leave cancels it instantly.
      const hoverCapable = typeof window !== 'undefined'
        && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
      const HOVER_DELAY = 350;
      let hoverCandidate = null; // bubble id the pointer is currently over
      let hoveredId = null; // committed, debounced — what's actually shown
      const setHovered = (id) => {
        if (id === hoveredId) return;
        hoveredId = id;
        onHoverRef.current?.(id);
      };
      const clearHover = () => {
        hoverCandidate = null;
        clearTimeout(hoverTimer);
        setHovered(null);
      };

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
        clearHover();

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
          if (flight) { flight.onAbort?.(); flight = null; landingFx?.destroy(); landingFx = null; flightComet?.destroy(); flightComet = null; }
          postFlightIds = null; // the user's taken control — stop lingering on the old route
          postFlightEdges = null;
          postFlightLandedAt = 0;
          state.enterFree();
          return;
        }
        if (pointers.size > 2) return;

        last = { x: g.x, y: g.y };
        lastT = performance.now();
        drag.start = { x: g.x, y: g.y };
        drag.moved = false;
        drag.tapCandidateId = null;
        const id = bubbleIdFromTarget(e.target);
        if (id && zoom.value >= BUBBLE_DRAG_MIN_ZOOM) {
          drag.type = 'bubble';
          drag.id = id;
          drag.node = nodeById.get(id);
          drag.onPip = isCollapsePipTarget(e.target);
        } else {
          drag.type = 'pan';
          drag.node = null;
          drag.tapCandidateId = id || null; // too zoomed out to drag it — a clean tap still selects
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

        // Hover preview: only when resting (no active drag/pan), not while a
        // card is already pinned open. Includes the active bubble itself —
        // it normally just carries the plain nameplate (name + dates), but
        // hovering it should upgrade to the same richer card everyone else
        // gets, not stay stuck on the terser default. App.jsx hides the
        // nameplate while hoveredId === activeId so the two don't overlap.
        if (hoverCapable && drag.type === 'none' && pointers.size <= 1 && !state.pinnedId) {
          const id = bubbleIdFromTarget(e.target);
          const candidate = id && visibleRef.current?.has(id) ? id : null;
          if (candidate !== hoverCandidate) {
            hoverCandidate = candidate;
            clearTimeout(hoverTimer);
            if (candidate) {
              hoverTimer = setTimeout(() => setHovered(candidate), HOVER_DELAY);
            } else {
              setHovered(null);
            }
          }
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
          if (flight) { flight.onAbort?.(); flight = null; landingFx?.destroy(); landingFx = null; flightComet?.destroy(); flightComet = null; }
          postFlightIds = null; // the user's taken control — stop lingering on the old route
          postFlightEdges = null;
          postFlightLandedAt = 0;
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
          if (flight) {
            // Same guard as the 'bubble' branch above — a tap on empty canvas,
            // or on a bubble too zoomed-out to drag (see BUBBLE_DRAG_MIN_ZOOM,
            // very likely mid-flyover, which deliberately zooms out to a wide
            // "drone" view), used to reach deselect()/activate()/openPerson()
            // below. Those flip the camera out of 'flight' mode without ever
            // clearing the flight itself — freezing the camera mid-glide and,
            // since the bubble-tap guard above checks the same still-truthy
            // `flight`, silently swallowing every tap from then on. Ignoring
            // the tap here instead lets the flyover land cleanly, exactly
            // like a mid-flight bubble tap already does.
          } else if (drag.tapCandidateId) {
            // Too zoomed out to drag this bubble (see BUBBLE_DRAG_MIN_ZOOM), but
            // a clean tap still selects it exactly like the 'bubble' path would.
            if (!browseRef.current && activeRef.current === drag.tapCandidateId) {
              onOpenPersonRef.current?.(drag.tapCandidateId);
            } else {
              onActivateRef.current?.(drag.tapCandidateId);
            }
          } else {
            // A clean tap on empty canvas → deselect into browse mode (every
            // bubble back to full brightness). Only in the free-flowing views:
            // chart, lineage and focus-family all rely on a selection, so skip.
            const mode = layoutRef.current;
            if (mode !== 'chart' && !lineageRef.current && !focusRef.current) {
              onDeselectRef.current?.();
            }
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
          clearHover();
          const factor = e.deltaY > 0 ? 0.9 : 1.0 / 0.9;
          zoomTo(screenAnchor().z * factor, e.offsetX, e.offsetY);
        },
        { passive: false },
      );
      // Leaving the canvas entirely (mouse exits the app area) always clears
      // the hover preview — the stage's pointermove alone won't fire for that.
      app.canvas.addEventListener('pointerleave', clearHover);

      // ── The frame loop ─────────────────────────────────────────────────────
      // The whole per-frame body is wrapped in a try/catch: this runs on every
      // single animation frame, so any uncaught exception here (a bad data
      // shape the flight/lit-path logic didn't expect, a stale reference after
      // a concurrent merge, anything) would otherwise repeat on every
      // subsequent frame forever — freezing the canvas permanently blank,
      // surviving even a reload once the state that triggers it is loaded
      // again. Catching it and resetting the flight/camera state instead lets
      // the tree keep rendering even if the cinematic search flyover itself
      // has to be abandoned mid-flight.
      app.ticker.add((ticker) => {
        try {
          frameBody(ticker);
        } catch (err) {
          console.error('[BubbleTree] frame error — recovering to a safe state:', err);
          flight?.onAbort?.();
          flight = null;
          landingFx?.destroy();
          landingFx = null;
          flightComet?.destroy();
          flightComet = null;
          for (const fx of igniteFx) fx.destroy();
          igniteFx.clear();
          postFlightIds = null;
          postFlightEdges = null;
          postFlightLandedAt = 0;
          if (recap) { const onDone = recap.onDone; recap = null; onDone?.(); }
          for (const [, fx] of recapFx) fx.destroy();
          recapFx.clear();
          camMode = 'follow';
        }
      });

      function frameBody(ticker) {
        const dt = Math.min(ticker.deltaMS / 1000, 1 / 30);
        // The flyover's own clock uses a much more generous clamp than the
        // spring-safety dt above. It's a plain linear accumulator (not a
        // physics integrator), so there's no explosion risk from a bigger
        // step — but reusing the 1/30 clamp meant that on any device
        // sustaining under ~30fps (a big tree, a slower phone, a software-
        // rendering fallback), the flight would run in slow motion relative
        // to wall-clock time, since each real frame only ever credited it
        // 33ms regardless of how long the frame actually took.
        const flightDt = Math.min(ticker.deltaMS / 1000, 0.1);

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
            flight.t += flightDt;
            const u = clamp(flight.t / flight.duration, 0, 1);
            const eased = easeInOutCubic(u);
            const p = sampleAlongPath(flight.pts, eased);
            // Blend away from wherever the camera actually was (not necessarily
            // the route's first point) over the opening stretch, so a flight
            // starting far from the current view eases into the route instead
            // of snapping to it.
            const bt = easeInOutCubic(Math.min(1, u / 0.22));
            // A slow, gentle drift orbiting the path point — the "drone hover"
            // rather than a perfectly rigid camera-on-rails glide. Small enough
            // to read as atmosphere, never enough to fight the route itself.
            const swayAmt = BASE_RADIUS * 0.14 * bt;
            const swayX = Math.sin(flight.t * 2 * Math.PI * 0.5) * swayAmt;
            const swayY = Math.cos(flight.t * 2 * Math.PI * 0.63) * swayAmt * 0.7;
            camX.value = camX.target = flight.camStartX + (p.x - flight.camStartX) * bt + swayX;
            camY.value = camY.target = flight.camStartY + (p.y - flight.camStartY) * bt + swayY;
            camX.velocity = camY.velocity = 0;

            // Wider "travel" zoom than before — more altitude, more drone-like,
            // taking in more of the family as the route glides past it.
            const travelZ = clamp(0.6, MIN_ZOOM, MAX_ZOOM);
            const zt = easeInOutCubic(Math.min(1, u / 0.3));
            zoom.value = zoom.target = flight.startZoom + (travelZ - flight.startZoom) * zt;
            zoom.velocity = 0;

            flightComet?.update(dt, p);

            const idx = Math.min(flight.hops, Math.round(eased * flight.hops));
            if (idx > flight.litIndex) {
              flight.litIndex = idx;
              lightHop(idx);
              flight.onSegment?.(flight.ids[idx]);
            }

            if (u >= 1) {
              flight.phase = 'landing';
              flight.t = 0;
              flight.landStartZoom = zoom.value;
              flight.litIndex = flight.hops;
              const dest = flight.pts[flight.pts.length - 1];
              flightComet?.destroy();
              flightComet = null;
              landingFx?.destroy();
              landingFx = new LandingBurst({ x: dest.x, y: dest.y }, BASE_RADIUS);
              fxLayer.addChild(landingFx.root);
            }
          } else {
            // 'landing' — punch in tight on the destination, then hand off.
            flight.t += flightDt;
            const u = clamp(flight.t / flight.landDuration, 0, 1);
            const dest = flight.pts[flight.pts.length - 1];
            const punchZ = clamp(1.85, MIN_ZOOM, MAX_ZOOM);
            const ez = easeInOutCubic(u);
            const z = flight.landStartZoom + (punchZ - flight.landStartZoom) * ez;
            // The flight caption sits in a fixed banner up top and grows a line
            // per hop — centring dead-on the destination (as the generic safe
            // area assumes a short nameplate) lets a deep, many-hop chain's
            // caption overlap the couple pod it just lit. Nudge the landing
            // point down proportionally so longer chains land further from it.
            const captionBias = Math.min(90, flight.hops * 16) / clamp(z, MIN_ZOOM, MAX_ZOOM_FREE);
            camX.value = camX.target = dest.x;
            camY.value = camY.target = dest.y - captionBias;
            camX.velocity = camY.velocity = 0;
            zoom.value = zoom.target = z;
            zoom.velocity = 0;
            if (u >= 1) {
              const finished = flight;
              flight = null;
              // The fully-lit path (every hop + each one's partner) lingers on
              // screen for a while after landing — the payoff of the whole
              // flight, not something that should vanish the instant the
              // camera stops moving. It fades out the same order it lit, not
              // all at once — see hopFade above.
              postFlightIds = finished.litSet;
              postFlightEdges = finished.edgeLitAt;
              postFlightLandedAt = performance.now();
              postFlightHops = finished.hops;
              state.setActive(finished.ids[finished.ids.length - 1], false);
              camMode = 'follow'; // setActive() re-enters follow anyway; explicit for clarity
              // Keep the found person visually elevated even once the camera
              // has zoomed back out to fit the whole family — see the
              // lineage-linger and default-branch checks below for how this
              // is applied, and setActive() above for how it's cleared.
              searchSpotlightId = finished.ids[finished.ids.length - 1];
              finished.onLand?.();
            }
          }
        } else if (camMode === 'recap' && recap) {
          // RECAP — the activity tour. Unlike flight (one continuous glide),
          // this is deliberately a slideshow of stops: ease to each person in
          // turn, hold there while their bloom/caption reads, then move on.
          const node = recap.pts[recap.idx];
          if (recap.phase === 'travel') {
            recap.t += flightDt;
            const u = clamp(recap.t / recap.travelDuration, 0, 1);
            const e = easeInOutCubic(u);
            camX.value = camX.target = recap.startX + (node.x - recap.startX) * e;
            camY.value = camY.target = recap.startY + (node.y - recap.startY) * e;
            camX.velocity = camY.velocity = 0;
            zoom.value = zoom.target = recap.startZ + (RECAP_ZOOM - recap.startZ) * e;
            zoom.velocity = 0;
            if (u >= 1) {
              recap.phase = 'dwell';
              recap.t = 0;
              const id = recap.ids[recap.idx];
              bubbles.get(id)?.setRecapGlow(true);
              recapVisited.add(id);
              // BirthEffect's halo rings peak at ~3.1x whatever radius they're
              // given, in WORLD units — multiplied by RECAP_ZOOM (2.2) that's
              // a ~314px screen radius at full-size BASE_RADIUS, big enough to
              // blanket nearly an entire phone screen. A smaller radius here
              // keeps the bloom a contained flourish around the bubble rather
              // than a burst that swallows the whole viewport.
              const fx = new BirthEffect({ x: node.x, y: node.y }, { x: node.x, y: node.y }, BASE_RADIUS * 0.55);
              fxLayer.addChild(fx.root);
              recapFx.set(id, fx);
              recap.onArrive?.(id);
            }
          } else {
            camX.value = camX.target = node.x;
            camY.value = camY.target = node.y;
            zoom.value = zoom.target = RECAP_ZOOM;
            zoom.velocity = camX.velocity = camY.velocity = 0;
            recap.t += flightDt;
            if (recap.t >= recap.dwellDuration) advanceRecap();
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
          // Fit from the half-extents around the (biased) centre so nothing
          // clips on the far side.
          const PAD = 18;
          let halfX = Math.max(camTX - minX, maxX - camTX, rr);
          let halfY = Math.max(camTY - minY, maxY - camTY, rr);
          let fit = Math.min(MAX_ZOOM, (W / 2 - PAD) / halfX, ((H - topInset) / 2 - PAD) / halfY);

          // Only the deliberate "every person expanded" moment gets the deeper
          // floor — an ordinary tap that reveals a handful of relatives keeps
          // the original, tighter one (see the two constants' comment above).
          const g = graphRef.current;
          const wholeTreeActive = !!expandedRef.current && g.people.length > 0
            && expandedRef.current.size >= g.people.length;
          const fitFloor = wholeTreeActive ? WHOLE_TREE_FIT_FLOOR : FIT_FLOOR;

          // The revealed family can be wide enough that fitting everyone would
          // need to zoom out further than the follow-mode floor allows — most
          // likely right after a search flyover reveals a long path's full
          // neighbourhoods at once. The zoom clamp below can't stretch to
          // compensate, so when that happens, re-centre fully on the active
          // person and re-fit from there: keeping them actually on screen
          // matters more than fitting every revealed relative.
          if (fit < fitFloor) {
            camTX = f.x;
            camTY = f.y;
            halfX = Math.max(camTX - minX, maxX - camTX, rr);
            halfY = Math.max(camTY - minY, maxY - camTY, rr);
            fit = Math.min(MAX_ZOOM, (W / 2 - PAD) / halfX, ((H - topInset) / 2 - PAD) / halfY);
          }

          camX.setTarget(camTX);
          camY.setTarget(camTY);
          zoom.setTarget(clamp(fit, fitFloor, MAX_ZOOM));
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
        const nowMs = performance.now();
        if (postFlightLandedAt) {
          const expiresAt = postFlightLandedAt + HOLD_MS + postFlightHops * STAGGER_MS + FADE_MS;
          if (nowMs > expiresAt) { postFlightIds = null; postFlightEdges = null; postFlightLandedAt = 0; }
        }
        const lineage = flight ? flight.litSet : (postFlightIds || lineageRef.current);
        const lineageEdges = flight ? flight.edgeLitAt : postFlightEdges; // null in real Lineage Mode — no burn timing, just static
        const lineageEnd = flight ? flight.ids[flight.ids.length - 1] : lineageEndRef.current;
        // 0 during an active flight (always fully lit, no sweep yet) or in
        // real Lineage Mode (static, no timing at all); the actual landing
        // timestamp once the flight's afterglow is what's showing, which is
        // what makes hopFade() below sweep the extinguish from the viewer's
        // own seat (hopIndex 0) through to the destination.
        const lineageLandedAt = flight ? 0 : postFlightLandedAt;

        // ── Landing burst (search flyover arrival) ───────────────────────────
        if (landingFx) {
          landingFx.update(dt);
          if (landingFx.done) { landingFx.destroy(); landingFx = null; }
        }

        // ── Ignite flourishes (search flyover, one per bubble as it's lit) ───
        if (igniteFx.size) {
          for (const fx of igniteFx) {
            fx.update(dt);
            if (fx.done) { fx.destroy(); igniteFx.delete(fx); }
          }
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
            const fx = new BirthEffect({ x: dest.x, y: dest.y }, origin, BASE_RADIUS, born);
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
            // lineage.get exists only for the flight/post-flight Maps (real
            // Lineage Mode is a plain Set with no per-person timing) — that's
            // what drives the "grows as the camera passes" pop: a brief big
            // burst right as it's lit, settling to a smaller-but-still-clearly-
            // elevated size, easing back toward baseline in hopIndex order as
            // the sweep reaches this person — a co-parent shares their
            // partner's hopIndex, so both fade on the same beat too.
            const entry = lineage.get ? lineage.get(id) : null;
            let restScale = 1.06;
            if (entry != null) {
              const age = nowMs - entry.litAt;
              const POP_MS = 450;
              const fade = hopFade(lineageLandedAt, entry.hopIndex, nowMs);
              // The search target eases toward SEARCH_LANDED_SCALE instead of
              // the normal 1.0 floor, so there's no dip when postFlightIds
              // eventually clears and the default branch's spotlight check
              // (below) picks up at exactly the same value — one continuous
              // ease from the landing punch to "settled but still the star",
              // never a shrink-then-regrow.
              // Not `id === lineageEnd` — that ref falls back to the (unrelated)
              // real Lineage Mode prop once flight is null, i.e. exactly during
              // the post-flight lingering phase this needs to work correctly in.
              const isSearchTarget = searchSpotlightId === id;
              const settledRest = isSearchTarget
                ? SEARCH_LANDED_SCALE + (1.85 - SEARCH_LANDED_SCALE) * fade
                : 1 + (1.32 - 1) * fade; // eases back toward 1.0 as its turn to extinguish arrives
              restScale = age < POP_MS ? 1.85 : settledRest;
              // A co-parent lights alongside its partner (see coParentsOf), so a
              // couple pod can have BOTH members popping at once — at a fixed
              // 112px partner-link distance, the normal 1.85/1.32 bump balloons
              // them into each other. Cap the pop for whichever half of a pod is
              // currently sharing the spotlight so the two bubbles never grow
              // past what that link distance can hold (2 × BASE_RADIUS × 1.15
              // stays comfortably inside the 112px gap). Exempt the search
              // target — it's the whole point of the spotlight.
              const hasLitPartner = graphRef.current
                .partners(id)
                .some((x) => lineage.has(x.id));
              if (hasLitPartner && !isSearchTarget) restScale = Math.min(restScale, 1.15);
            }
            target = landingPunch
              ? { scale: 1.22, alpha: 1, lift: 1.6, blur: 0 }
              : { scale: restScale, alpha: 1, lift: 1.1 + (restScale - 1) * 0.6, blur: 0 };
          } else if (cardOpen && id !== state.pinnedId) {
            target = { ...visualForDistance(d), alpha: 0.28, blur: 5 }; // dimmed behind card
          } else if (camMode === 'recap' && recap) {
            // Recap tour: the person currently being visited must read as
            // sharp regardless of their graph-distance from whoever was
            // active before the tour started — the whole point is jumping
            // to scattered, often-unrelated parts of the tree, so falling
            // through to the default distance-based fade below would leave
            // the target greyed out instead of in focus. Already-visited
            // people (their gold ring still lit) stay legible but recede a
            // touch, so the current stop still reads as the standout one.
            const isCurrent = id === recap.ids[recap.idx];
            target = isCurrent
              ? { scale: 1.08, alpha: 1, lift: 1.3, blur: 0 }
              : recapVisited.has(id)
                ? { ...visualForDistance(d), alpha: 0.7, blur: 0 }
                : { ...visualForDistance(d), alpha: 0.2, blur: 1.5 };
          } else {
            // Focus fading: immediate family pops; extended family recedes softly.
            // This gives the graph visible hierarchy without a card being open.
            const base = visualForDistance(d);
            const focusAlpha = d <= 1 ? 1 : d === 2 ? 0.62 : d === 3 ? 0.38 : 0.2;
            // Once the post-flight lingering (above) finally clears, hand off
            // at the same elevated size rather than dropping back to the
            // ordinary active-person baseline — see searchSpotlightId.
            const spotlighted = id === searchSpotlightId && d === 0;
            target = { ...base, alpha: focusAlpha, scale: spotlighted ? SEARCH_LANDED_SCALE : base.scale };
          }
          // Desktop hover preview: a small pop so the canvas and the floating
          // card visibly agree on who's being previewed — never touches alpha,
          // so a dimmed/background bubble stays dim, just a touch larger.
          if (id === hoveredId) {
            target = { ...target, scale: target.scale * 1.05, lift: (target.lift ?? 1) * 1.15 };
          }
          // Tapping a hop in the landed FlightCaption's reopened chain (see
          // pulseBubble) — a single brief "there it is" bump layered on top
          // of whatever this bubble's base treatment already is, regardless
          // of camera mode or how far it is from the active person.
          const pulseAt = crumbPulse.get(id);
          if (pulseAt != null) {
            const PULSE_MS = 700;
            const page = nowMs - pulseAt;
            if (page > PULSE_MS) crumbPulse.delete(id);
            else {
              const bump = Math.sin(clamp(page / PULSE_MS, 0, 1) * Math.PI) * 0.28;
              target = { ...target, scale: target.scale * (1 + bump), lift: (target.lift ?? 1) * (1 + bump * 0.5) };
            }
          }
          // A barely-there scale pulse on every living bubble — "these are the
          // people still with us" without a label. Deceased bubbles hold
          // still, same quiet distinction the memorial ring already carries.
          // Desynced per person (phase/period seeded in bubble.js) rather than
          // one shared clock — a whole tree pulsing in lockstep would read as
          // anxious, not alive. Skipped for chart layout (exact scale=1.0 is
          // load-bearing there) and reduced-motion.
          if (!reducedMotion && !b.deceased && layoutRef.current !== 'chart') {
            const t = (nowMs / 1000) * ((Math.PI * 2) / b._breathPeriod) + b._breathPhase;
            target = { ...target, scale: target.scale * (1 + Math.sin(t) * 0.018) };
          }
          // Name labels: all visible bubbles, hidden when card open or lineage
          // active — and hidden for the active person specifically, since
          // FocusNameplate already floats their name (plus lifespan/age)
          // above the bubble; showing both was pure duplication. Mirrors the
          // exact conditions App.jsx uses to decide whether the nameplate
          // itself is showing (browse mode / chart layout / self-hover), so
          // the two can never disagree about which one the person is seeing.
          const nameplateShowing = id === activeRef.current
            && !browseRef.current
            && layoutRef.current !== 'chart'
            && hoveredId !== activeRef.current;
          const labelAlpha = (!cardOpen && !lineage && effectiveVis.has(id) && !nameplateShowing) ? 1 : 0;
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
              relText = relationLabel(graphRef.current, activeRef.current, id, kinTermsStore.getState());
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

        // Advance + retire recap-tour arrival blooms (the transient flash/
        // halo/motes only — the lingering ring itself lives on the bubble via
        // setRecapGlow and isn't touched here).
        if (recapFx.size) {
          for (const [id, fx] of recapFx) {
            fx.update(dt);
            if (fx.done) {
              fx.destroy();
              recapFx.delete(id);
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
          drawLinks(
            linkGfx, graphRef.current, pos, (id) => vis.has(id), BASE_RADIUS,
            lineage, activeRef.current, lineageEdges, nowMs, lineageLandedAt, HOLD_MS, STAGGER_MS, FADE_MS,
          );
        }
      }
    })();

    return () => {
      alive = false;
      clearTimeout(hoverTimer);
      if (unsubKinTerms) unsubKinTerms();
      if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
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
  // chart re-computes fixed grid positions. ensureVisible runs first so any
  // newly-revealed person already has a tracked node/bubble before relayout
  // tries to place them.
  useEffect(() => {
    api.current?.ensureVisible(visibleIds);
    const m = api.current?.layoutMode;
    if (m === 'radial' || m === 'weighted') api.current.relayout();
    if (m === 'chart') api.current?.applyChartLayout();
  }, [visibleIds]);

  return (
    <>
      <div className="stage" ref={hostRef} aria-hidden="true" />
      {initFailed && (
        <div className="stage-error">
          <p className="stage-error__text">Couldn't load the tree view.</p>
          <button type="button" className="stage-error__btn" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )}
    </>
  );
}

const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// Content signature for a relationships array — a server merge or reload
// always rebuilds this array from scratch (new reference every time), even
// when nothing in it actually changed, so reference equality can't tell
// "did the tree's shape change" from "did we just re-fetch the same data".
// This compares what's actually in it instead.
function relSignature(rels) {
  return (rels || [])
    .map((r) => `${r.id}~${r.from_person}~${r.to_person}~${r.type}~${r.qualifier ?? ''}~${r.partner_status ?? ''}`)
    .sort()
    .join('|');
}

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

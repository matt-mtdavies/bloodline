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
import { drawLinks } from './links.js';
import { distancesFrom } from '../data/graph.js';
import { Spring } from '../lib/spring.js';

const BASE_RADIUS = 46;
const COLLIDE = 70;
const GEN_GAP = 400; // tall generation bands: the layout fills the height of a phone
const ORGANIC_CHARGE = -560; // gentle repulsion: lets a wide generation settle near its
// collision floor so width-fit stays generous while the tall bands fill the height
const SPREAD_X = 0.008; // gentle horizontal centring — loose enough to spread out
const MAX_ZOOM = 1.5; // small families can scale up this far to fill the screen

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
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  // Callbacks are captured once in the mount effect, so we route them through
  // refs to ensure React prop changes (e.g. lineage mode toggling onOpenPerson)
  // are always reflected without re-mounting the canvas.
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;
  const onOpenPersonRef = useRef(onOpenPerson);
  onOpenPersonRef.current = onOpenPerson;

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

      // World container: links underneath, bubbles on top. The camera transforms
      // this whole container; bubbles never move in screen space themselves.
      const world = new Container();
      app.stage.addChild(world);
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
        .distance((l) => (l.kind === 'partner' ? 112 : 240))
        .strength((l) => (l.kind === 'partner' ? 0.9 : 0.26));

      const sim = forceSimulation(nodes)
        .force('link', linkForce)
        .force('charge', forceManyBody().strength(ORGANIC_CHARGE).distanceMax(780))
        .force('collide', forceCollide(COLLIDE).strength(0.9))
        .force('x', forceX(0).strength(SPREAD_X))
        .force('y', forceY((d) => (gen.get(d.id) ?? 0) * GEN_GAP - 260).strength(0.085))
        .alpha(1)
        .alphaDecay(0.018)
        .alphaTarget(reducedMotion ? 0 : 0.012)
        .stop();

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

      // Camera springs. camX/camY follow the focused node; zoom dips on a jump
      // to give the flight a sense of pulling back before swooping in. panX/panY
      // let you drag the tree and have it spring affectionately back to centre.
      // Slower, gentler glide (the expansion should feel calm).
      const camX = new Spring(0, { stiffness: 55, damping: 15 });
      const camY = new Spring(0, { stiffness: 55, damping: 15 });
      const zoom = new Spring(1, { stiffness: 130, damping: 20 });
      const panX = new Spring(0, { stiffness: 120, damping: 18 });
      const panY = new Spring(0, { stiffness: 120, damping: 18 });
      const biasX = new Spring(0, { stiffness: 90, damping: 18 }); // shift on card open
      let userZoom = 1;

      let dist = distancesFrom(graph, activeRef.current);

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
        panX,
        panY,
        gen,
        get userZoom() {
          return userZoom;
        },
        set userZoom(v) {
          userZoom = v;
        },
        dist,
        pinnedId: null,
        layoutMode: layoutRef.current,
        radialTargets: new Map(),
        // Rebuild the positioning forces for the current layout mode. In radial
        // mode this recomputes the sectored targets and pulls nodes to them
        // (reheating, which animates the orbit re-centre); organic restores the
        // generational bands + repulsion.
        relayout() {
          if (state.layoutMode === 'radial') {
            state.radialTargets = computeRadialTargets(
              graphRef.current,
              activeRef.current,
              visibleRef.current,
              gen,
            );
            // The active hub is pulled hard to centre; the ring sits at its
            // targets; links go soft so they don't drag the geometry around.
            const strength = (d) =>
              d.id === activeRef.current ? 0.7 : state.radialTargets.has(d.id) ? 0.32 : 0.03;
            sim.force('charge', forceManyBody().strength(-70).distanceMax(500));
            sim.force('x', forceX((d) => state.radialTargets.get(d.id)?.x ?? 0).strength(strength));
            sim.force('y', forceY((d) => state.radialTargets.get(d.id)?.y ?? 0).strength(strength));
            linkForce.strength((l) => (l.kind === 'partner' ? 0.3 : 0.04));
          } else {
            state.radialTargets = new Map();
            sim.force('charge', forceManyBody().strength(ORGANIC_CHARGE).distanceMax(780));
            sim.force('x', forceX(0).strength(SPREAD_X));
            sim.force('y', forceY((d) => (gen.get(d.id) ?? 0) * GEN_GAP - 260).strength(0.085));
            linkForce.strength((l) => (l.kind === 'partner' ? 0.9 : 0.26));
          }
          sim.alpha(0.7);
        },
        setLayout(mode) {
          if (state.layoutMode === mode) return;
          state.layoutMode = mode;
          state.relayout();
        },
        setActive(id, animate = true) {
          activeRef.current = id;
          state.dist = distancesFrom(graphRef.current, id);
          if (!reducedMotion && animate) zoom.velocity -= 1.6; // gentle pull-back
          if (state.layoutMode === 'radial') state.relayout();
        },
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
          if (state.layoutMode === 'radial') state.relayout();
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
      };
      api.current = state;
      if (apiRef) apiRef.current = state;
      if (state.layoutMode === 'radial') state.relayout();

      // Centre instantly on the first active person so we don't fly in.
      const f0 = nodeById.get(activeRef.current);
      if (f0) {
        camX.set(f0.x);
        camY.set(f0.y);
      }

      // ── Interaction ────────────────────────────────────────────────────────
      // One stage-level gesture handler. Press a bubble and drag to fling it
      // around — it pins to your finger and the force sim reheats so everyone
      // else genuinely shoves and settles around it; release and it floats back
      // into the flow. Press empty space and drag to pan the whole tree. A press
      // that doesn't move is a tap: recentre, or open the centred person.
      app.stage.eventMode = 'static';
      app.stage.hitArea = { contains: () => true };
      const TAP_SLOP = 8; // px of movement still considered a tap
      const drag = { type: 'none', node: null, id: null, start: null, moved: false };
      let last = null;
      // Active touch points, for two-finger pinch zoom.
      const pointers = new Map();
      const pinch = { active: false, dist0: 0, zoom0: 1 };
      const twoFingerDist = () => {
        const p = [...pointers.values()];
        return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      };

      const bubbleIdFromTarget = (t) => {
        let n = t;
        while (n && n.__bubbleId === undefined) n = n.parent;
        return n ? n.__bubbleId : null;
      };

      app.stage.on('pointerdown', (e) => {
        const g = e.global;
        pointers.set(e.pointerId, { x: g.x, y: g.y });

        // Second finger down → start pinch; abandon any single-finger gesture.
        if (pointers.size === 2) {
          if (drag.type === 'bubble' && drag.node && drag.id !== state.pinnedId) {
            drag.node.fx = null;
            drag.node.fy = null;
          }
          drag.type = 'none';
          drag.node = null;
          pinch.active = true;
          pinch.dist0 = twoFingerDist();
          pinch.zoom0 = userZoom;
          return;
        }
        if (pointers.size > 2) return;

        last = { x: g.x, y: g.y };
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
        }
      });
      app.stage.on('pointermove', (e) => {
        if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.global.x, y: e.global.y });

        // Pinch: scale from the gap between the two fingers.
        if (pinch.active && pointers.size >= 2) {
          const d = twoFingerDist();
          if (pinch.dist0 > 0) userZoom = clamp(pinch.zoom0 * (d / pinch.dist0), 0.5, 2.4);
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
        } else if (drag.type === 'pan') {
          panX.value += g.x - last.x;
          panY.value += g.y - last.y;
        }
        last = { x: g.x, y: g.y };
      });
      const endGesture = (e) => {
        if (e) pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch.active = false;
        if (drag.type === 'bubble') {
          if (!drag.moved) {
            // A clean tap: expand/activate, or open the already-active person.
            if (activeRef.current === drag.id) onOpenPersonRef.current?.(drag.id);
            else onActivateRef.current?.(drag.id);
          } else if (drag.node && drag.id !== state.pinnedId) {
            // Let the flung bubble rejoin the simulation (unless it's pinned
            // open as a card anchor).
            drag.node.fx = null;
            drag.node.fy = null;
          }
          if (!reducedMotion) sim.alphaTarget(0.012); // settle back to idle drift
        }
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
          userZoom = clamp(userZoom * (e.deltaY > 0 ? 0.92 : 1.08), 0.55, 1.9);
        },
        { passive: false },
      );

      // ── The frame loop ─────────────────────────────────────────────────────
      app.ticker.add((ticker) => {
        const dt = Math.min(ticker.deltaMS / 1000, 1 / 30);

        // Keep it breathing: a hair of perpetual drift unless reduced-motion.
        if (!reducedMotion) {
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

        // Frame the whole revealed family: centre on the bounding box of the
        // visible bubbles (gently biased toward the active person so they stay
        // central) and zoom so it fills the safe area. This way even a handful
        // of people spread out and use the screen instead of huddling in the
        // middle. We hold still while a bubble is being flung.
        const f = nodeById.get(activeRef.current);
        if (f && !state.isDraggingBubble?.()) {
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
        }
        camX.step(dt);
        camY.step(dt);
        zoom.step(dt);
        panX.setTarget(0);
        panY.setTarget(0);
        panX.step(dt);
        panY.step(dt);

        // When a card is open, slide the anchored bubble to the left so the card
        // can expand out to its side.
        biasX.setTarget(state.pinnedId ? -W * 0.24 : 0);
        biasX.step(dt);
        const z = clamp(zoom.value, 0.35, 2) * userZoom;
        world.scale.set(z);
        world.position.set(
          cx - camX.value * z + panX.value + biasX.value,
          cy - camY.value * z + panY.value,
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
            target = { ...visualForDistance(d), alpha: 0.13, blur: 1.5 }; // off-path — recede
          } else if (cardOpen && id !== state.pinnedId) {
            target = { ...visualForDistance(d), alpha: 0.28, blur: 5 }; // dimmed
          } else {
            target = visualForDistance(d);
          }
          b.setVisualState(target, dt);
          b.root.zIndex = id === activeRef.current ? 100 : -d;
        }

        linkGfx.alpha = cardOpen ? 0.18 : 1;
        drawLinks(linkGfx, graphRef.current, pos, (id) => vis.has(id), BASE_RADIUS, mergeRef.current, lineage);
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

  // In radial mode, re-place the ring as the revealed set grows.
  useEffect(() => {
    if (api.current?.layoutMode === 'radial') api.current.relayout();
  }, [visibleIds]);

  return <div className="stage" ref={hostRef} aria-hidden="true" />;
}

// Sizing for revealed bubbles by hop-distance from the active person. (Whether
// a bubble shows at all is decided separately by the visible set.)
function visualForDistance(d) {
  switch (d) {
    case 0:
      return { scale: 1.34, alpha: 1, lift: 1.6, blur: 0 };
    case 1:
      return { scale: 1.0, alpha: 1, lift: 1.2, blur: 0 };
    case 2:
      return { scale: 0.82, alpha: 1, lift: 1, blur: 0 };
    default:
      return { scale: 0.7, alpha: 1, lift: 1, blur: 0 };
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

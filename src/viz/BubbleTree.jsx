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
const COLLIDE = 62;
const GEN_GAP = 168;

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
  apiRef,
}) {
  const hostRef = useRef(null);
  const api = useRef(null);
  const activeRef = useRef(activeId);
  const visibleRef = useRef(visibleIds);
  visibleRef.current = visibleIds;
  const graphRef = useRef(graph);
  graphRef.current = graph; // always the live graph for the loop + sync

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

      // Generation index (roots = 0) gives the layout legible vertical bands.
      const gen = computeGenerations(graph);

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
        .distance((l) => (l.kind === 'partner' ? 84 : 150))
        .strength((l) => (l.kind === 'partner' ? 0.95 : 0.28));

      const sim = forceSimulation(nodes)
        .force('link', linkForce)
        .force('charge', forceManyBody().strength(-560).distanceMax(620))
        .force('collide', forceCollide(COLLIDE).strength(0.9))
        .force('x', forceX(0).strength(0.012))
        .force('y', forceY((d) => (gen.get(d.id) ?? 0) * GEN_GAP - 260).strength(0.085))
        .alpha(1)
        .alphaDecay(0.018)
        .alphaTarget(reducedMotion ? 0 : 0.012)
        .stop();

      // Warm the layout so the tree opens already settled, not reorganising.
      for (let i = 0; i < 140; i++) sim.tick();
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
        setActive(id, animate = true) {
          activeRef.current = id;
          state.dist = distancesFrom(graphRef.current, id);
          if (!reducedMotion && animate) zoom.velocity -= 1.6; // gentle pull-back
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
          state.dist = distancesFrom(g, activeRef.current);
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
            if (activeRef.current === drag.id) onOpenPerson?.(drag.id);
            else onActivate?.(drag.id);
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

        // Camera follows the active node — but holds still while you're
        // flinging a bubble around, so it doesn't chase your finger.
        const f = nodeById.get(activeRef.current);
        if (f && !state.isDraggingBubble?.()) {
          camX.setTarget(f.x);
          camY.setTarget(f.y);
        }
        camX.step(dt);
        camY.step(dt);
        zoom.step(dt);
        panX.setTarget(0);
        panY.setTarget(0);
        panX.step(dt);
        panY.step(dt);

        const cx = app.screen.width / 2;
        const cy = app.screen.height / 2;
        // When a card is open, slide the anchored bubble to the left so the card
        // can expand out to its side with the tether visible between them.
        biasX.setTarget(state.pinnedId ? -app.screen.width * 0.24 : 0);
        biasX.step(dt);
        const z = clamp(zoom.value, 0.4, 2) * userZoom;
        world.scale.set(z);
        world.position.set(
          cx - camX.value * z + panX.value + biasX.value,
          cy - camY.value * z + panY.value,
        );

        // Per-bubble visual state. Only revealed (visible) people show; the rest
        // stay collapsed. When a card is open, the active bubble stays sharp and
        // everyone else blurs and dims back.
        const dmap = state.dist;
        const vis = visibleRef.current;
        const cardOpen = !!state.pinnedId;
        for (const [id, b] of bubbles) {
          const n = nodeById.get(id);
          b.root.position.set(n.x, n.y);
          const d = dmap.has(id) ? dmap.get(id) : 6;
          let target;
          if (!vis.has(id)) {
            target = { scale: 0.5, alpha: 0, lift: 1, blur: 0 }; // collapsed
          } else if (cardOpen && id !== state.pinnedId) {
            target = { ...visualForDistance(d), alpha: 0.28, blur: 5 }; // dimmed
          } else {
            target = visualForDistance(d);
          }
          b.setVisualState(target, dt);
          b.root.zIndex = id === activeRef.current ? 100 : -d;
        }

        linkGfx.alpha = cardOpen ? 0.18 : 1;
        drawLinks(linkGfx, graphRef.current, pos, (id) => vis.has(id), BASE_RADIUS);
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

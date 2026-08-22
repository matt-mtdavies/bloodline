/*
 * Canopy — the view.
 *
 * Mounts once, then runs an imperative loop. React drives exactly two things
 * into it: who is in focus, and the graph. Everything else — planning,
 * growth, camera, interaction — lives below in a closure, because a
 * per-frame render loop and React's reconciler have no business negotiating
 * with each other sixty times a second.
 *
 * THE SELECTION CONTRACT, which is the heart of the view:
 *
 *   setFocus(id)
 *     1. remember where that person is on screen RIGHT NOW;
 *     2. plan one new frame — they become world origin;
 *     3. re-point the camera anchor to that remembered point, instantly;
 *     4. spring the zoom toward the new ideal, and grow the frame.
 *
 * Because the focus sits at world origin, their screen position is exactly
 * the anchor for ANY zoom — so step 3 costs nothing visually (they are
 * already there) and step 4 cannot move them however far the zoom travels.
 * The world recomposes around the person you tapped instead of throwing them
 * across the canvas. Once growth finishes, the anchor eases — slowly, and
 * deliberately — to the ideal composition.
 */

import { useEffect, useRef } from 'react';
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import './canopy.css';
import { planCanopy } from './plan.js';
import { scheduleGrowth, progressAt, easeBud } from './growth.js';
import { Scalar, ambientOffset, composeCamera, Deflection, rubberBand, SWAY_POD, SWAY_BRANCH } from './motion.js';
import { drawBonds, drawHorizons, horizonOffset, CanopyNode } from './render.js';

const TAP_SLOP = 8;
/* Below this canvas width the frame drops its Reach band — see the note at
 * the setFocus call and in plan.js. Sits above every common phone width in
 * portrait and below every tablet's. */
const REACH_MIN_WIDTH = 700;

export default function CanopyTree({
  graph,
  focusId,
  onActivate,
  onOpenPerson,
  reducedMotion = false,
  topInset = 96,
  bottomInset = 104,
}) {
  const hostRef = useRef(null);
  const apiRef = useRef(null);
  const graphRef = useRef(graph);
  graphRef.current = graph;
  // Declared above the mount effect on purpose. It is only read inside the
  // effect's async body (which runs after this whole function has), so the
  // ordering is not load-bearing at runtime — but this file has a sibling in
  // the repo whose history includes a real temporal-dead-zone crash from
  // exactly this shape, and "safe because of when it happens to run" is not
  // worth the next reader's time.
  const focusIdRef = useRef(focusId);
  focusIdRef.current = focusId;
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;
  const onOpenPersonRef = useRef(onOpenPerson);
  onOpenPersonRef.current = onOpenPerson;
  const insetRef = useRef({ topInset, bottomInset });
  insetRef.current = { topInset, bottomInset };

  useEffect(() => {
    let alive = true;
    const host = hostRef.current;
    let app = new Application();

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
      } catch {
        return; // no WebGL — the caller's fallback view stays on screen
      }
      if (!alive) { app.destroy(true); return; }
      host.appendChild(app.canvas);

      const world = new Container();
      const bondLayer = new Graphics();
      const horizonLayer = new Graphics();
      const horizonLabels = new Container();
      const nodeLayer = new Container();
      world.addChild(bondLayer, horizonLayer, horizonLabels, nodeLayer);
      app.stage.addChild(world);
      app.stage.eventMode = 'static';
      app.stage.hitArea = { contains: () => true };

      let frame = null;
      let schedule = null;
      let clock = 0;            // ms since the current frame started growing
      let composed = false;     // has the anchor adopted the ideal yet?
      let currentFocus = null;
      const nodes = new Map();  // id -> CanopyNode
      const hLabels = new Map();
      /* Elastic deflection per person — see motion.js's Deflection. Kept
       * beside the nodes rather than on them so bonds can resolve a live
       * position for someone whose CanopyNode has not been built yet. */
      const defl = new Map();
      const deflOf = (id) => defl.get(id)?.value;
      const deflFor = (id) => {
        let d = defl.get(id);
        if (!d) { d = new Deflection(); defl.set(id, d); }
        return d;
      };

      const zoom = new Scalar(1, 0.7);
      const anchorX = new Scalar(0, 0.9);
      const anchorY = new Scalar(0, 0.9);

      const labelStyle = new TextStyle({
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontSize: 13, fontWeight: '600', fill: 0xb0802f, align: 'center',
      });

      const rebuildNodes = () => {
        const keep = new Set(frame.nodes.keys());
        for (const [id, n] of nodes) {
          if (!keep.has(id)) { n.destroy(); nodes.delete(id); }
        }
        for (const [id, node] of frame.nodes) {
          const existing = nodes.get(id);
          if (existing) {
            /* A person who survives into the new frame is REUSED — that is
             * what makes navigation feel continuous rather than like a slide
             * change. But two things about them are baked in at construction
             * and must be reconciled, or the frame lies:
             *   • radius and label size come from the band, so a person who
             *     moved between bands has to be rebuilt at the new size;
             *   • the ring says who is in focus. A real bug caught in review:
             *     navigating left the terracotta focus ring on the PREVIOUS
             *     focus, so two people appeared selected at once. */
            if (existing.band !== node.band) {
              existing.destroy();
              nodes.delete(id);
            } else {
              if (existing.isFocus !== node.isFocus) {
                existing.isFocus = node.isFocus;
                existing.drawRing(node);
              }
              continue;
            }
          }
          const person = graphRef.current.byId.get(id);
          if (!person) continue;
          const cn = new CanopyNode(person, node);
          nodes.set(id, cn);
          nodeLayer.addChild(cn.root);
        }
        // Horizon labels are rebuilt with the frame — their counts change.
        for (const [, t] of hLabels) t.destroy();
        hLabels.clear();
        horizonLabels.removeChildren();
        for (const h of frame.horizons) {
          const t = new Text({ text: `+${h.count}`, style: labelStyle });
          t.anchor.set(0.5);
          t.__horizonId = h.id;
          hLabels.set(h.id, t);
          horizonLabels.addChild(t);
        }
      };

      /* Who leans when this person is pulled. A partner shares their pod and
       * follows most; anyone joined by a branch follows a little. Everyone
       * else is unaffected — sway is a property of connection, which is the
       * whole point of showing it. */
      const swayTargets = (id) => {
        const out = [];
        const unit = frame.units.find((u) => u.memberIds.includes(id));
        if (unit) for (const m of unit.memberIds) if (m !== id) out.push([m, SWAY_POD]);
        for (const b of frame.bonds) {
          if (b.kind === 'union') {
            if (b.a === id) out.push([b.b, SWAY_POD * 0.6]);
            else if (b.b === id) out.push([b.a, SWAY_POD * 0.6]);
          } else {
            const pu = frame.units.find((u) => u.id === b.parentUnit);
            if (!pu) continue;
            if (b.child === id) { for (const m of pu.memberIds) out.push([m, SWAY_BRANCH]); }
            else if (pu.memberIds.includes(id)) out.push([b.child, SWAY_BRANCH]);
          }
        }
        return out;
      };

      const idealCamera = () => composeCamera(frame, {
        width: app.screen.width,
        height: app.screen.height,
        ...insetRef.current,
      });

      const setFocus = (id, { instant = false } = {}) => {
        const g = graphRef.current;
        if (!g?.byId?.has(id)) return;

        // 1 — where is this person on screen right now?
        const prior = frame?.nodes.get(id);
        const priorScreenX = prior ? anchorX.value + prior.x * zoom.value : null;
        const priorScreenY = prior ? anchorY.value + prior.y * zoom.value : null;

        // 2 — plan the new frame; they become world origin. The Reach band
        // is dropped on a narrow screen (see plan.js) — a phone cannot hold
        // a five-unit row at a readable size, and pretending otherwise is
        // what leaves the family stranded as a postage stamp.
        currentFocus = id;
        frame = planCanopy(g, id, { includeReach: app.screen.width >= REACH_MIN_WIDTH });
        schedule = scheduleGrowth(frame, { reducedMotion });
        clock = 0;
        composed = false;
        rebuildNodes();

        const ideal = idealCamera();
        if (instant || priorScreenX === null) {
          zoom.set(ideal.zoom);
          anchorX.set(ideal.anchorX);
          anchorY.set(ideal.anchorY);
          composed = true;
        } else {
          // 3 — re-point the anchor instantly. Costs nothing: the focus is at
          // world origin, so this is exactly where they already are.
          anchorX.set(priorScreenX);
          anchorY.set(priorScreenY);
          // 4 — zoom may spring freely; it cannot move them.
          zoom.to(ideal.zoom);
        }
      };

      /* ── interaction ───────────────────────────────────────────────────
       * Deliberately small: tap to travel, tap the focus to open their
       * profile, drag to pan, wheel to zoom. A manual pan or zoom simply
       * offsets the composition until the next selection re-composes it —
       * it never fights the layout, because it cannot change it. */
      const drag = { active: false, moved: false, x: 0, y: 0, id: null, startX: 0, startY: 0 };
      let hoverId = null;

      const idFromTarget = (t) => {
        let n = t;
        while (n && n.__canopyId === undefined) n = n.parent;
        return n ? n.__canopyId : null;
      };
      const horizonHit = (gx, gy) => {
        for (const [id, t] of hLabels) {
          const b = t.getBounds();
          if (gx >= b.x - 14 && gx <= b.x + b.width + 14 && gy >= b.y - 10 && gy <= b.y + b.height + 10) return id;
        }
        return null;
      };

      app.stage.on('pointerdown', (e) => {
        drag.active = true; drag.moved = false;
        drag.x = e.global.x; drag.y = e.global.y;
        drag.startX = e.global.x; drag.startY = e.global.y;
        // Pressing ON somebody grabs THEM; pressing on paper pans the camera.
        drag.id = idFromTarget(e.target);
      });
      app.stage.on('pointermove', (e) => {
        // Hover lift, only while nothing is being dragged.
        if (!drag.active) {
          const over = idFromTarget(e.target);
          if (over !== hoverId) {
            if (hoverId) nodes.get(hoverId)?.setHover(false);
            hoverId = over;
            if (hoverId) nodes.get(hoverId)?.setHover(true);
          }
          return;
        }
        const dx = e.global.x - drag.x, dy = e.global.y - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > TAP_SLOP) drag.moved = true;
        if (!drag.moved) return;

        if (drag.id) {
          /* Pulling a person. The displacement is in WORLD units — divided by
           * zoom — so a pull feels the same distance under the finger at any
           * scale, and rubber-banded so it resists rather than hitting a wall.
           * Nothing here writes to the plan: this is a deflection FROM where
           * they belong, and letting go returns them to it. */
          const pulled = rubberBand(
            (e.global.x - drag.startX) / zoom.value,
            (e.global.y - drag.startY) / zoom.value,
          );
          deflFor(drag.id).hold(pulled.x, pulled.y);
          for (const [id, k] of swayTargets(drag.id)) {
            deflFor(id).lean(pulled.x * k, pulled.y * k);
          }
        } else {
          anchorX.set(anchorX.value + dx);
          anchorY.set(anchorY.value + dy);
          composed = true; // the viewer has taken the camera; stop auto-composing
        }
        drag.x = e.global.x; drag.y = e.global.y;
      });
      const releaseDrag = () => {
        // Everyone springs home. The plan was always the authority; the pull
        // was only ever a deflection from it.
        for (const [, d] of defl) d.release();
        drag.id = null;
      };
      const endDrag = (e) => {
        if (!drag.active) return;
        drag.active = false;
        releaseDrag();
        if (drag.moved) return;
        const hid = horizonHit(e.global.x, e.global.y);
        if (hid) {
          const h = frame.horizons.find((x) => x.id === hid);
          const unit = frame.units.find((u) => u.id === h?.unitId);
          if (unit) onActivateRef.current?.(unit.anchorId || unit.memberIds[0]);
          return;
        }
        const id = idFromTarget(e.target);
        if (!id) return;
        if (id === currentFocus) onOpenPersonRef.current?.(id);
        else onActivateRef.current?.(id);
      };
      app.stage.on('pointerup', endDrag);
      app.stage.on('pointerupoutside', () => { drag.active = false; releaseDrag(); });

      const onWheel = (e) => {
        e.preventDefault();
        const factor = Math.pow(2, -Math.max(-240, Math.min(240, e.deltaY)) * 0.0022);
        const nz = Math.max(0.24, Math.min(1.6, zoom.value * factor));
        // Keep the world point under the cursor pinned while zooming.
        const wx = (e.offsetX - anchorX.value) / zoom.value;
        const wy = (e.offsetY - anchorY.value) / zoom.value;
        zoom.set(nz);
        anchorX.set(e.offsetX - wx * nz);
        anchorY.set(e.offsetY - wy * nz);
        composed = true;
      };
      app.canvas.addEventListener('wheel', onWheel, { passive: false });

      /* ── the loop ─────────────────────────────────────────────────────── */
      app.ticker.add((ticker) => {
        if (!frame || !schedule) return;
        const dtMs = Math.min(ticker.deltaMS, 50);
        clock += dtMs;
        const dt = dtMs / 1000;
        const tSec = performance.now() / 1000;

        // Once the frame has finished growing, the camera settles into its
        // composition — a deliberate beat AFTER the fixed point has done its
        // job, never during, so the person you tapped is never dragged.
        if (!composed && clock >= schedule.total) {
          const ideal = idealCamera();
          anchorX.to(ideal.anchorX);
          anchorY.to(ideal.anchorY);
          zoom.to(ideal.zoom);
          composed = true;
        }

        zoom.step(dt); anchorX.step(dt); anchorY.step(dt);
        world.scale.set(zoom.value);
        world.position.set(anchorX.value, anchorY.value);

        // Step every elastic deflection, then let it settle out of the map so
        // an idle frame is not iterating hundreds of resting springs.
        for (const [id, d] of defl) {
          d.step(dt);
          if (d.resting && id !== drag.id) defl.delete(id);
        }

        for (const [id, node] of frame.nodes) {
          const cn = nodes.get(id);
          if (!cn) continue;
          const sched = schedule.nodes.get(id);
          const raw = progressAt(sched, clock);
          const open = schedule.reduced ? raw : (sched?.dur ? easeBud(raw) : 1);
          const amb = node.isFocus || reducedMotion
            ? { x: 0, y: 0, scale: 1 }
            : ambientOffset(node.unitId, tSec);
          cn.apply(node, open, amb, deflOf(id));
        }

        drawBonds(bondLayer, frame, schedule, clock, deflOf);
        drawHorizons(horizonLayer, frame, schedule, clock, horizonLabels);
        for (const h of frame.horizons) {
          const t = hLabels.get(h.id);
          if (!t) continue;
          const u = frame.units.find((x) => x.id === h.unitId);
          if (!u) continue;
          const offs = u.memberIds.map((m) => u.offsets.get(m));
          const mid = (Math.min(...offs) + Math.max(...offs)) / 2;
          const n = frame.nodes.get(u.memberIds[0]);
          const dir = h.dir === 'up' ? -1 : 1;
          t.position.set(u.x + mid, n.y + dir * horizonOffset(n.r, dir, u.band));
        }
      });

      apiRef.current = {
        setFocus,
        setGraph: () => { if (currentFocus) setFocus(currentFocus, { instant: true }); },
        destroy: () => {
          app.canvas.removeEventListener('wheel', onWheel);
          for (const [, n] of nodes) n.destroy();
          nodes.clear();
        },
      };
      setFocus(focusIdRef.current, { instant: true });
    })();

    return () => {
      alive = false;
      apiRef.current?.destroy?.();
      apiRef.current = null;
      try { app.destroy(true, { children: true }); } catch { /* already gone */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  useEffect(() => { apiRef.current?.setFocus(focusId); }, [focusId]);
  useEffect(() => { apiRef.current?.setGraph(graph); }, [graph]);

  return <div ref={hostRef} className="canopy-host" aria-hidden="true" />;
}

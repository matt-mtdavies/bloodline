import { planFamilyLayout, toScreen } from './layoutPlanner.js';
import { SpringField, Spring1D } from './springs.js';
import { LocalCollision } from './collision.js';
import { createAmbient } from './ambient.js';
import { MotionRecorder } from './metrics.js';

/*
 * The V2 motion engine — layout, springs, collision and camera as ONE object.
 *
 * Deliberately headless: it owns no DOM, no canvas and no renderer, and it is
 * driven by explicit `step(dtMs)` calls rather than a requestAnimationFrame it
 * starts itself. That is what lets tests/treeMotionV2.test.mjs drive a real
 * transition frame by frame and assert on the combination, rather than on a
 * custom force in isolation — testing the pieces separately is exactly how V1's
 * problems got through: every part behaved, the composite did not.
 *
 * The selection contract, which is the heart of the experiment:
 *
 *   select(id, { anchor })
 *     1. plan ONE layout for the new active person (they land on the origin);
 *     2. compute ONE camera destination — the origin pinned to `anchor`;
 *     3. hand both to the springs and stop.
 *
 *   There is no reheat, no per-frame re-planning and no live re-framing. The
 *   destination is fixed the instant you click, and every subsequent frame is
 *   just easing toward it. `anchor` defaults to wherever the person already is
 *   on screen, so the thing you tapped does not move while its family
 *   rearranges around it.
 */

/*
 * Why the screen anchor JUMPS on selection while the zoom springs.
 *
 * The camera's screen anchor is "where world origin appears", and selecting
 * somebody re-plans the layout so THEY are the world origin. Springing the
 * anchor from the old active person's screen point to the new one would
 * therefore drag the newly selected person across the screen — the precise
 * thing this experiment exists to eliminate. So the anchor is re-pointed
 * instantly and exactly, which costs nothing visually because the person it
 * points at is, by construction, already at that screen position.
 *
 * Zoom is different: the active person sits AT the origin, so screen position
 * = anchor + (world − origin) × zoom = anchor, for any zoom at all. Zoom can
 * animate as freely as it likes and the selected person still cannot move.
 * (An integrated test asserts exactly this, with the zoom provably changing.)
 *
 * Moving the composition back toward the middle of the screen is therefore a
 * SEPARATE, deliberate action — recenter() — and never something a transition
 * does behind your back.
 */

export function createMotionEngine({
  graph,
  viewport = { width: 1200, height: 800 },
  visibleIds = null,
  reducedMotion = false,
  settleSeconds = 0.62,
  cameraSettleSeconds = 0.72,
  ambient = true,
  collision = true,
  seed = 1234567,
} = {}) {
  const springs = new SpringField({ settleSeconds });
  const collider = new LocalCollision({ seed });
  const breath = createAmbient({ enabled: ambient && !reducedMotion });
  const recorder = new MotionRecorder();

  const zoomSpring = new Spring1D(1, { settleSeconds: cameraSettleSeconds });
  const anchorX = new Spring1D(viewport.width / 2, { settleSeconds: cameraSettleSeconds });
  const anchorY = new Spring1D(viewport.height / 2, { settleSeconds: cameraSettleSeconds });

  let plan = null;
  let activeId = null;
  let elapsed = 0;                 // seconds, for ambient phase
  let lastActiveScreen = null;
  let displacement = new Map();
  let firstSelection = true;
  let atRest = false;          // true once macro motion has been snapped to its targets
  let restingMaxPush = 0;
  // Per-frame instrumentation state (P2 #6): every-node screen positions,
  // spring velocities, and collision push magnitudes from the PREVIOUS
  // frame, so this frame can report the largest CHANGE in each — the
  // signals a single-number-per-transition metric (like activeDrift) can't
  // see, because a bug can hide in one node on one frame.
  let lastAllScreen = null;
  let lastSpringVel = null;
  let lastPushMag = null;

  const camera = () => ({
    worldX: 0, worldY: 0,
    screenX: anchorX.value, screenY: anchorY.value,
    zoom: zoomSpring.value,
  });

  /** Rendered position = spring + clamped collision relief + ambient breath. */
  const worldPositions = () => {
    const base = springs.positions();
    const out = new Map();
    // The WHOLE active pod holds still, not just the literal active person —
    // otherwise the active person breathes zero while their own partner
    // breathes the unit's full amplitude, visibly stretching and squashing
    // the pod's own rigid spacing every cycle. A pod is supposed to read as
    // one object; that only holds if none of it moves while it's the one
    // thing the camera is anchored to.
    const activeUnitId = plan?.unitOf?.get(activeId)?.id;
    for (const [id, pt] of base) {
      const d = displacement.get(id) ?? { x: 0, y: 0 };
      const inActivePod = activeUnitId != null && plan?.unitOf?.get(id)?.id === activeUnitId;
      const b = inActivePod ? { x: 0, y: 0 } : breath.offsetFor(id, plan?.unitOf, elapsed);
      out.set(id, { x: pt.x + d.x + b.x, y: pt.y + d.y + b.y });
    }
    return out;
  };

  const toScreenAll = (cam, world) => {
    const out = new Map();
    for (const [id, pt] of world) out.set(id, toScreen(cam, pt));
    return out;
  };

  const screenPositions = () => toScreenAll(camera(), worldPositions());

  function select(nextActiveId, { anchor = null, immediate = false } = {}) {
    // For the selection-boundary instrumentation below: everyone's screen
    // position and pod membership exactly as they were the instant BEFORE
    // this call does anything at all.
    const beforeScreen = plan ? screenPositions() : null;
    const prevPlanForMetrics = plan;

    // Where is this person on screen RIGHT NOW, under the OLD frame and OLD
    // camera? That point becomes the fixed point of the whole transition
    // unless the caller names another. Captured before anything below moves.
    // Deliberately their full RENDERED position — spring value plus whatever
    // collision displacement and ambient breath they currently carry, not
    // just the bare spring value — because both the screen anchor AND the
    // rebase below have to agree on the same reference point. Using only the
    // raw spring value here was a real bug: it under-counted by exactly this
    // person's own displacement+breath, so the anchor jumped to where they
    // "really" were but the rebase shifted everyone else by a slightly
    // different amount, leaving a several-pixel residual jump for everyone
    // ELSE even after the coordinate-frame fix below.
    const hadPrev = activeId && springs.get(nextActiveId);
    const prevWorld = hadPrev ? worldPositions().get(nextActiveId) : null;
    const currentScreen = prevWorld ? toScreen(camera(), prevWorld) : null;

    activeId = nextActiveId;
    plan = planFamilyLayout({ graph, activeId, visibleIds, viewport, anchor: null });

    // Anchor policy, in order of preference: explicit > wherever the person
    // already is > the plan's composition-centred default (first paint only).
    // Honoured EXACTLY — no clamping, no nudging toward the middle — because
    // any correction here is a correction the selected person would visibly
    // make on screen, and they are supposed to be the one fixed thing.
    const raw = anchor ?? currentScreen ?? { x: plan.camera.screenX, y: plan.camera.screenY };
    const screenAnchor = {
      x: Number.isFinite(raw.x) ? raw.x : viewport.width / 2,
      y: Number.isFinite(raw.y) ? raw.y : viewport.height / 2,
    };

    // Re-express every already-tracked node in the NEW frame BEFORE handing
    // out new targets. Without this, a node's numeric spring value still
    // means "however far from the OLD active person" — the renderer reads it
    // as "however far from the NEW one" the instant this function returns, a
    // real on-screen jump that happens before springs.step() is ever called
    // again, so no per-frame drift metric can see it (a real report: most of
    // a live "remarried" fixture jumped tens of pixels, one person ~129px,
    // the instant Matthew was selected, while every metric read "0 drift").
    if (prevWorld) springs.translate(-prevWorld.x, -prevWorld.y);

    springs.setTargets(plan.positions, {
      // A person appearing for the first time grows out of the active person
      // rather than flying in from wherever the last layout happened to leave
      // them — new arrivals should read as "revealed", not "thrown".
      spawnAt: () => ({ x: 0, y: 0 }),
    });
    springs.clearPins();
    springs.pin(activeId);

    zoomSpring.setTarget(plan.camera.zoom);
    // Re-point, don't travel — see the note at the top of this file.
    anchorX.jump(screenAnchor.x);
    anchorY.jump(screenAnchor.y);

    const landImmediately = firstSelection || immediate || reducedMotion;
    if (landImmediately) {
      // First paint has nothing to animate FROM, and reduced-motion asks us not
      // to animate at all: land on the composition directly.
      springs.snap();
      zoomSpring.jump(plan.camera.zoom);
      anchorX.jump(screenAnchor.x);
      anchorY.jump(screenAnchor.y);
      firstSelection = false;
    }

    // Landing immediately IS being at rest — otherwise reduced-motion would
    // report an animation in progress that is never going to happen, and the
    // engine would keep integrating springs that are already exactly home.
    atRest = landImmediately;
    // Collision is only resolved fresh here when landing immediately (nothing
    // further will animate to smooth it over). Otherwise the PREVIOUS
    // displacement is left exactly as it was: recomputing it synchronously
    // against the NEW pinned obstacle would itself be a small discontinuity —
    // a different person is now immovable, so forceCollide can redistribute
    // an existing overlap's correction differently even though every node's
    // position relative to every OTHER node hasn't changed at all. The very
    // next step() recomputes it naturally once real motion is already
    // underway, exactly like every other frame does.
    if (collision) {
      if (landImmediately) {
        displacement = collider.resolve(springs.positions(), activeId, plan?.unitOf);
      } else if (displacement.has(activeId)) {
        // The newly active person's WHOLE POD must be displaced by exactly
        // zero — collision resolves at pod granularity (see collision.js),
        // so leaving just the active person's own entry zeroed while their
        // partner's stale entry (from whichever pod THEY were part of a
        // moment ago) is left untouched would itself violate pod rigidity
        // for exactly one frame: the fixed point's own pod would visibly
        // stretch apart until the next step() recomputes it properly.
        // Everyone else's stale entry is left exactly as it was, for the
        // same continuity reason recomputing the whole map here would break.
        displacement = new Map(displacement);
        const activePodIds = plan?.unitOf?.get(activeId)?.memberIds ?? [activeId];
        for (const id of activePodIds) displacement.set(id, { x: 0, y: 0 });
      }
    } else {
      displacement = new Map();
    }
    lastActiveScreen = toScreen(camera(), worldPositions().get(activeId) ?? { x: 0, y: 0 });

    // Selection-boundary instrumentation: the max screen-space jump of any
    // node that DIDN'T need to move, at the exact instant of select() —
    // this is the one class of bug frame-by-frame metrics structurally
    // cannot see (it happens between two calls, not during a frame). Two
    // designed exceptions, matching the reasoning above and in
    // layoutPlanner.js: a node whose POD MEMBERSHIP genuinely changed (a
    // real recomposition, not a jump) and anyone in the NEWLY active pod
    // (deliberately reset to the fixed point, not a jump either).
    let selectionBoundaryJumpPx = 0;
    if (beforeScreen) {
      const afterScreen = screenPositions();
      const newActivePodIds = new Set(plan.unitOf.get(activeId)?.memberIds ?? [activeId]);
      for (const [id, before] of beforeScreen) {
        const after = afterScreen.get(id);
        if (!after || newActivePodIds.has(id)) continue;
        const oldMembers = prevPlanForMetrics?.unitOf?.get(id)?.memberIds?.join('|');
        const newMembers = plan.unitOf.get(id)?.memberIds?.join('|');
        if (oldMembers !== newMembers) continue;
        const d = Math.hypot(before.x - after.x, before.y - after.y);
        if (d > selectionBoundaryJumpPx) selectionBoundaryJumpPx = d;
      }
    }
    recorder.beginTransition(`select:${activeId}`, { selectionBoundaryJumpPx });

    // Reset the frame-to-frame instrumentation trackers to the state RIGHT
    // NOW — the coordinate frame just moved, so comparing against whatever
    // they held before select() would report a bogus displacement/velocity
    // change that has nothing to do with real per-frame motion.
    lastAllScreen = screenPositions();
    lastSpringVel = new Map();
    for (const [id, s] of springs.state) lastSpringVel.set(id, { vx: s.vx, vy: s.vy });
    lastPushMag = new Map();
    for (const [id, d] of displacement) lastPushMag.set(id, Math.hypot(d.x, d.y));

    return plan;
  }

  function step(dtMs) {
    const dt = Math.min(0.05, Math.max(0, dtMs / 1000)); // clamp a tab-restore spike
    elapsed += dt;

    // "Settles completely" has to mean completely. An exponential approach is
    // never numerically finished — it just gets smaller — and a camera still
    // creeping by hundredths of a pixel forever is exactly the kind of
    // never-quite-done motion V2 exists to remove. So the moment the system is
    // within the visible-motion threshold it is SNAPPED to its targets and
    // integration stops; from then on every frame is an exact no-op and the
    // only thing still alive is the bounded ambient breath.
    if (atRest) {
      const world = worldPositions();
      const cam = camera();
      const activeScreen = toScreen(cam, world.get(activeId) ?? { x: 0, y: 0 });
      const drift = lastActiveScreen
        ? Math.hypot(activeScreen.x - lastActiveScreen.x, activeScreen.y - lastActiveScreen.y) : 0;
      lastActiveScreen = activeScreen;

      // Ambient breathing keeps moving even at rest, so node displacement is
      // still worth tracking here — just never speed/acceleration/reversals
      // (springs themselves are frozen, so those are trivially zero).
      let maxNodeDisplacementPx = 0;
      const nowScreen = toScreenAll(cam, world);
      if (lastAllScreen) {
        for (const [id, pt] of nowScreen) {
          const last = lastAllScreen.get(id);
          if (!last) continue;
          const d = Math.hypot(pt.x - last.x, pt.y - last.y);
          if (d > maxNodeDisplacementPx) maxNodeDisplacementPx = d;
        }
      }
      lastAllScreen = nowScreen;

      const frame = {
        dt, peakSpeed: 0, meanSpeed: 0, activeDrift: drift, cameraSpeed: 0,
        zoom: cam.zoom, zoomVelocity: 0, unsettled: 0, maxPush: restingMaxPush,
        maxNodeDisplacementPx, maxAcceleration: 0, directionReversals: 0,
        collisionPushDelta: 0, settled: true,
      };
      recorder.frame(frame);
      return frame;
    }

    const peakSpeed = springs.step(dt);
    zoomSpring.step(dt);
    anchorX.step(dt);
    anchorY.step(dt);

    // Collision only while things are actually moving. Once settled the
    // displacement is frozen, so a resting tree costs nothing and — more
    // importantly — cannot be nudged around by collision forever.
    let macroSettled = springs.settled() && zoomSpring.settled() && anchorX.settled() && anchorY.settled();
    if (collision && !macroSettled) {
      displacement = collider.resolve(springs.positions(), activeId, plan?.unitOf);
    }
    if (macroSettled) {
      springs.snap();
      zoomSpring.jump(zoomSpring.target);
      anchorX.jump(anchorX.target);
      anchorY.jump(anchorY.target);
      if (collision) displacement = collider.resolve(springs.positions(), activeId, plan?.unitOf);
      atRest = true;
      restingMaxPush = 0;
      for (const d of displacement.values()) restingMaxPush = Math.max(restingMaxPush, Math.hypot(d.x, d.y));
    }

    let maxPush = 0;
    for (const d of displacement.values()) maxPush = Math.max(maxPush, Math.hypot(d.x, d.y));

    const world = worldPositions();
    const cam = camera();
    const activeScreen = toScreen(cam, world.get(activeId) ?? { x: 0, y: 0 });
    const activeDrift = lastActiveScreen
      ? Math.hypot(activeScreen.x - lastActiveScreen.x, activeScreen.y - lastActiveScreen.y)
      : 0;
    lastActiveScreen = activeScreen;

    let unsettled = 0;
    let speedSum = 0;
    let maxAcceleration = 0;
    let directionReversals = 0;
    for (const [id, s] of springs.state) {
      if (id === activeId) continue;
      const moving = Math.abs(s.x - s.tx) > 0.05 || Math.abs(s.y - s.ty) > 0.05;
      if (moving) unsettled++;
      const speed = Math.hypot(s.vx, s.vy);
      speedSum += speed;

      const last = lastSpringVel?.get(id);
      if (last) {
        const lastSpeed = Math.hypot(last.vx, last.vy);
        const accel = Math.abs(speed - lastSpeed) / dt;
        if (accel > maxAcceleration) maxAcceleration = accel;
        // A genuine direction reversal — velocity now pointing meaningfully
        // opposite to velocity a frame ago — should never happen for a
        // critically damped spring that never overshoots. Guarded by a small
        // speed floor so two near-zero vectors (nothing moving) don't count
        // as a "reversal" from floating-point noise alone.
        if (speed > 0.5 && lastSpeed > 0.5) {
          const dot = (s.vx * last.vx + s.vy * last.vy) / (speed * lastSpeed);
          if (dot < -0.1) directionReversals++;
        }
      }
    }
    lastSpringVel = new Map();
    for (const [id, s] of springs.state) lastSpringVel.set(id, { vx: s.vx, vy: s.vy });

    let collisionPushDelta = 0;
    for (const [id, d] of displacement) {
      const mag = Math.hypot(d.x, d.y);
      const last = lastPushMag?.get(id) ?? 0;
      const delta = Math.abs(mag - last);
      if (delta > collisionPushDelta) collisionPushDelta = delta;
    }
    lastPushMag = new Map();
    for (const [id, d] of displacement) lastPushMag.set(id, Math.hypot(d.x, d.y));

    const nowScreen = toScreenAll(cam, world);
    let maxNodeDisplacementPx = 0;
    if (lastAllScreen) {
      for (const [id, pt] of nowScreen) {
        const last = lastAllScreen.get(id);
        if (!last) continue;
        const d = Math.hypot(pt.x - last.x, pt.y - last.y);
        if (d > maxNodeDisplacementPx) maxNodeDisplacementPx = d;
      }
    }
    lastAllScreen = nowScreen;

    const frame = {
      dt,
      peakSpeed,
      meanSpeed: springs.state.size ? speedSum / springs.state.size : 0,
      activeDrift,
      cameraSpeed: Math.hypot(anchorX.velocity, anchorY.velocity),
      zoom: cam.zoom,
      zoomVelocity: zoomSpring.velocity,
      unsettled,
      maxPush,
      maxNodeDisplacementPx,
      maxAcceleration,
      directionReversals,
      collisionPushDelta,
      settled: macroSettled,
    };
    recorder.frame(frame);
    return frame;
  }

  /** Run frames until macro motion has genuinely stopped (or the budget runs out). */
  function settle({ dtMs = 16.667, maxFrames = 600 } = {}) {
    let frames = 0;
    let last = null;
    while (frames < maxFrames) {
      last = step(dtMs);
      frames++;
      if (last.settled) break;
    }
    return { frames, ...last };
  }

  return {
    select,
    step,
    settle,
    camera,
    worldPositions,
    screenPositions,
    get plan() { return plan; },
    get activeId() { return activeId; },
    get elapsedSeconds() { return elapsed; },
    isSettled: () => atRest,
    /*
     * Ease the composition back toward the middle of the screen. Deliberately
     * NOT part of select(): moving the anchor moves the selected person, so
     * this is only ever something a caller asks for once a transition has
     * finished — never something a transition does to you.
     */
    recenter() {
      if (!plan) return;
      const b = plan.bounds;
      const z = zoomSpring.target;
      anchorX.setTarget(viewport.width / 2 - ((b.minX + b.maxX) / 2) * z);
      anchorY.setTarget(viewport.height / 2 - ((b.minY + b.maxY) / 2) * z);
      atRest = false;
    },
    metrics: () => recorder,
    summary: () => recorder.summary(),
    resetMetrics: (label) => recorder.reset(label),
    /** Advance ambient time only — for verifying breathing never becomes drift. */
    breatheOnly(seconds) { elapsed += seconds; },
  };
}

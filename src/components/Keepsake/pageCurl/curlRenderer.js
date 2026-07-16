import { curlRadius, pullAxis, curlStrip, curlShade } from './curlMath.js';

/*
 * The strip-based cylindrical curl renderer — draws directly to a canvas,
 * driven by whatever corner/touch position you give it each call. There is
 * no animation loop in here: call render() with a new touch point and the
 * canvas updates immediately. Whoever drives this (the gesture controller)
 * decides what "settling" or "snapping back" looks like; this module only
 * knows how to draw one instantaneous curl state.
 *
 * Two offscreen buffers are allocated once (sized to the page's own
 * diagonal) and reused every call — recreating them per frame was the
 * single biggest cost profiled during development (~20ms/frame vs.
 * ~12ms/frame reused, in a software-rendered/no-GPU test environment;
 * real devices with hardware-accelerated canvas should do noticeably
 * better than either number).
 */
export function createCurlRenderer(canvas, width, height) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const diag = Math.ceil(Math.hypot(width, height)) + 8;
  const rotated = document.createElement('canvas');
  rotated.width = diag;
  rotated.height = diag;
  const rctx = rotated.getContext('2d');
  const curled = document.createElement('canvas');
  curled.width = diag;
  curled.height = diag;
  const cctx = curled.getContext('2d');

  let frontImg = null; // the page curling away
  let backImg = null; // the page revealed underneath
  const STRIP_W = 3;

  function setPages(front, back) {
    frontImg = front;
    backImg = back;
  }

  /*
   * Renders one frame of the curl. `cornerX/Y` and `touchX/Y` are in the
   * page's own local pixel space (0,0 top-left of the sheet). Returns the
   * fraction of the page diagonal the touch point has traveled (0–1-ish,
   * can exceed 1 slightly past the far corner) — the gesture controller
   * uses this as the turn's "progress" for its commit/cancel decision.
   */
  function render(cornerX, cornerY, touchX, touchY) {
    ctx.clearRect(0, 0, width, height);
    if (backImg) ctx.drawImage(backImg, 0, 0, width, height);

    const R = curlRadius(cornerX, cornerY, touchX, touchY);
    const axis = pullAxis(cornerX, cornerY, touchX, touchY);
    const angle = Math.atan2(axis.uy, axis.ux);
    const originX = diag / 2;
    const originY = diag / 2;

    if (frontImg) {
      rctx.setTransform(1, 0, 0, 1, 0, 0);
      rctx.clearRect(0, 0, diag, diag);
      rctx.translate(originX, originY);
      rctx.rotate(-angle);
      rctx.translate(-cornerX, -cornerY);
      rctx.drawImage(frontImg, 0, 0, width, height);

      cctx.setTransform(1, 0, 0, 1, 0, 0);
      cctx.clearRect(0, 0, diag, diag);
      const uMax = Math.min(diag, R * Math.PI + 4);
      // Far side of the roll (high theta) is drawn first — nearest to
      // the viewer (low theta, barely lifted) goes last so it correctly
      // occludes the far side wherever the sine curve folds back over
      // itself in screen space (see curlMath.js's module comment).
      for (let u = uMax; u >= 0; u -= STRIP_W) {
        const strip = curlStrip(u + STRIP_W / 2, R);
        if (strip.hidden) continue;
        const shade = curlShade(strip.theta);
        const dx = originX + strip.newU;
        if (strip.litFace) {
          const sx = originX + u;
          cctx.drawImage(rotated, sx, 0, STRIP_W + 0.5, diag, dx, 0, STRIP_W + 0.5, diag);
          if (shade < 1) {
            cctx.fillStyle = `rgba(20,14,8,${1 - shade})`;
            cctx.fillRect(dx, 0, STRIP_W + 0.5, diag);
          }
        } else {
          // A printed page's back is blank stock, not the front mirrored.
          const tone = 244 - Math.round((1 - shade) * 90);
          cctx.fillStyle = `rgb(${tone}, ${tone - 4}, ${tone - 14})`;
          cctx.fillRect(dx, 0, STRIP_W + 0.5, diag);
        }
      }

      // A soft cast shadow from the fold onto the revealed page beneath,
      // ahead of the fold line in the pull direction.
      ctx.save();
      ctx.translate(cornerX, cornerY);
      ctx.rotate(angle);
      const shadowGrad = ctx.createLinearGradient(0, 0, Math.min(R * 1.4, diag), 0);
      shadowGrad.addColorStop(0, 'rgba(20,14,8,0.32)');
      shadowGrad.addColorStop(1, 'rgba(20,14,8,0)');
      ctx.fillStyle = shadowGrad;
      ctx.fillRect(0, -diag, Math.min(R * 1.4, diag), diag * 2);
      ctx.restore();

      ctx.save();
      ctx.translate(cornerX, cornerY);
      ctx.rotate(angle);
      ctx.drawImage(curled, -originX, -originY);
      ctx.restore();
    }

    const pullDistance = Math.hypot(touchX - cornerX, touchY - cornerY);
    const pageDiagonal = Math.hypot(width, height);
    return pullDistance / pageDiagonal;
  }

  function clear() {
    ctx.clearRect(0, 0, width, height);
  }

  return { setPages, render, clear, canvas };
}

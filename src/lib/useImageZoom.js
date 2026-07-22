import { useRef, useState } from 'react';

const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 24; // px — how close two taps must land to count as one

/*
 * Pinch-to-zoom + drag-to-pan + double-tap-to-zoom for a single image,
 * shared by the photo Lightbox and the document viewer so both images and
 * scanned documents get identical zoom behaviour. Returns the current
 * transform, a ref for the stage element the gesture coordinates are
 * measured against, and the pointer handlers to spread onto the <img>.
 */
export function useImageZoom() {
  const [xf, setXf] = useState({ scale: 1, x: 0, y: 0 });
  const stageRef = useRef(null);
  const pointers = useRef(new Map()); // pointerId -> {x, y}
  const gestureRef = useRef(null);    // pinch/pan bookkeeping between move events
  const lastTapRef = useRef(null);    // { t, x, y } — for double-tap detection
  const draggedRef = useRef(false);   // did this pointer sequence move enough to be a drag/pinch?

  function reset() {
    setXf({ scale: 1, x: 0, y: 0 });
  }

  // Keep the pan offset from drifting the image completely off-stage once
  // zoomed. Approximate bound (image is centred + object-fit:contain): the
  // farthest it should be draggable is proportional to how far past 1x it's
  // zoomed, times the stage's own size.
  function clamp(next) {
    const stage = stageRef.current;
    if (!stage) return next;
    const { scale } = next;
    if (scale <= 1) return { scale: 1, x: 0, y: 0 };
    const maxX = (stage.clientWidth * (scale - 1)) / 2;
    const maxY = (stage.clientHeight * (scale - 1)) / 2;
    return {
      scale,
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }

  function zoomAt(clientX, clientY, targetScale) {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const cx = clientX - rect.left - rect.width / 2;
    const cy = clientY - rect.top - rect.height / 2;
    setXf((prev) => {
      // Keep the point under the finger/cursor fixed while the scale changes.
      const ratio = targetScale / prev.scale;
      const x = cx - (cx - prev.x) * ratio;
      const y = cy - (cy - prev.y) * ratio;
      return clamp({ scale: targetScale, x, y });
    });
  }

  // Desktop has no pinch gesture to speak of — a mouse has none at all, and
  // a trackpad's pinch arrives as a wheel event with ctrlKey set (that's the
  // browser's own translation, not something we opt into). Scroll-to-zoom
  // over the image covers both: a plain mouse wheel and a trackpad pinch
  // read identically here, zooming under the cursor exactly like the pinch
  // gesture zooms under the fingers.
  function onWheel(e) {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0018);
    const target = Math.min(MAX_ZOOM, Math.max(1, xf.scale * factor));
    zoomAt(e.clientX, e.clientY, target);
  }

  function handleTap(e) {
    const now = Date.now();
    const last = lastTapRef.current;
    if (last && now - last.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_TAP_SLOP) {
      lastTapRef.current = null;
      zoomAt(e.clientX, e.clientY, xf.scale > 1 ? 1 : DOUBLE_TAP_ZOOM);
    } else {
      lastTapRef.current = { t: now, x: e.clientX, y: e.clientY };
    }
  }

  function onPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    draggedRef.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gestureRef.current = {
        mode: 'pinch',
        startDist: Math.hypot(a.x - b.x, a.y - b.y),
        startScale: xf.scale,
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
      };
    } else if (pointers.current.size === 1 && xf.scale > 1) {
      gestureRef.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, origin: xf };
    } else {
      gestureRef.current = null;
    }
  }

  function onPointerMove(e) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gestureRef.current;
    if (!g) return;

    if (g.mode === 'pinch' && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (Math.abs(dist - g.startDist) > 4) draggedRef.current = true;
      const targetScale = Math.min(MAX_ZOOM, Math.max(1, g.startScale * (dist / g.startDist)));
      zoomAt(g.midX, g.midY, targetScale);
    } else if (g.mode === 'pan' && pointers.current.size === 1) {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) draggedRef.current = true;
      setXf(clamp({ scale: g.origin.scale, x: g.origin.x + dx, y: g.origin.y + dy }));
    }
  }

  function endPointer(e) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      // Snap fully-zoomed-out state back to an exact, clean rest position.
      setXf((prev) => (prev.scale <= 1.02 ? { scale: 1, x: 0, y: 0 } : prev));
      if (!draggedRef.current) handleTap(e);
      gestureRef.current = null;
    } else if (pointers.current.size === 1) {
      // Went from pinch to a single remaining finger — restart as a pan.
      const [p] = [...pointers.current.values()];
      gestureRef.current = { mode: 'pan', startX: p.x, startY: p.y, origin: xf };
    }
  }

  return {
    xf,
    stageRef,
    draggedRef,
    reset,
    zoomAt,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPointer,
      onPointerCancel: endPointer,
      onWheel,
    },
  };
}

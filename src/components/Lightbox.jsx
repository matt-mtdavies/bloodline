import { useEffect, useRef, useState } from 'react';
import { savePhotoToDevice } from '../lib/image.js';

const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 24; // px — how close two taps must land to count as one

/*
 * Full-screen photo viewer. Step through a person's gallery, caption a photo,
 * make it their portrait, remove it, or save it to the device. Pinch and
 * double-tap to zoom, drag to pan while zoomed. Arrow keys + on-screen
 * controls; the caption saves as you type.
 */
export default function Lightbox({ photos, startIndex = 0, onClose, onSetCaption, onDelete, onSetPortrait }) {
  const [i, setI] = useState(startIndex);
  const photo = photos[Math.min(i, photos.length - 1)];
  const [saveState, setSaveState] = useState('idle'); // idle | saving | error

  const [xf, setXf] = useState({ scale: 1, x: 0, y: 0 });
  const stageRef = useRef(null);
  const pointers = useRef(new Map()); // pointerId -> {x, y}
  const gestureRef = useRef(null);    // pinch/pan bookkeeping between move events
  const lastTapRef = useRef(null);    // { t, x, y } — for double-tap detection
  const draggedRef = useRef(false);   // did this pointer sequence move enough to be a drag/pinch?

  const go = (d) => setI((n) => (n + d + photos.length) % photos.length);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.length]);

  // If the last photo was deleted, close out.
  useEffect(() => {
    if (photos.length === 0) onClose();
    else if (i > photos.length - 1) setI(photos.length - 1);
  }, [photos.length, i, onClose]);

  // Never carry zoom/pan across photos, and drop any stale save status.
  useEffect(() => {
    setXf({ scale: 1, x: 0, y: 0 });
    setSaveState('idle');
  }, [i]);

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

  async function handleSave() {
    if (saveState === 'saving') return;
    setSaveState('saving');
    try {
      await savePhotoToDevice(photo.src, `${(photo.caption || 'photo').replace(/[^\w-]+/g, '_')}.jpg`);
      setSaveState('idle');
    } catch (e) {
      console.warn('[lightbox] save failed:', e.message);
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 2500);
    }
  }

  if (!photo) return null;

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer">
      <div className="lightbox__bar lightbox__bar--top">
        <span className="lightbox__count">
          {i + 1} / {photos.length}
        </span>
        <button className="lightbox__icon" onClick={onClose} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="lightbox__stage" ref={stageRef} onClick={(e) => { if (xf.scale === 1 && !draggedRef.current) onClose(); }}>
        <img
          className="lightbox__img"
          src={photo.src}
          alt={photo.caption || ''}
          crossOrigin="anonymous"
          draggable={false}
          style={{ transform: `translate(${xf.x}px, ${xf.y}px) scale(${xf.scale})` }}
          onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e); }}
          onPointerMove={(e) => { e.stopPropagation(); onPointerMove(e); }}
          onPointerUp={(e) => { e.stopPropagation(); endPointer(e); }}
          onPointerCancel={(e) => { e.stopPropagation(); endPointer(e); }}
          onClick={(e) => e.stopPropagation()}
        />
        {photos.length > 1 && xf.scale === 1 && (
          <>
            <button
              className="lightbox__nav lightbox__nav--prev"
              onClick={(e) => { e.stopPropagation(); go(-1); }}
              aria-label="Previous photo"
            >
              ‹
            </button>
            <button
              className="lightbox__nav lightbox__nav--next"
              onClick={(e) => { e.stopPropagation(); go(1); }}
              aria-label="Next photo"
            >
              ›
            </button>
          </>
        )}
      </div>

      <div className="lightbox__bar lightbox__bar--bottom">
        <div className="lightbox__caption">
          <input
            className="lightbox__caption-input"
            value={photo.caption || ''}
            placeholder="Add a caption…"
            onChange={(e) => onSetCaption?.(photo.id, e.target.value)}
            aria-label="Caption"
          />
          {photo.date && <span className="lightbox__date">{photo.date}</span>}
        </div>
        <div className="lightbox__actions">
          <button className="lightbox__action" onClick={handleSave} disabled={saveState === 'saving'}>
            {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? "Couldn't save" : 'Save'}
          </button>
          <button className="lightbox__action" onClick={() => onSetPortrait?.(photo.src)}>
            Set as portrait
          </button>
          <button
            className="lightbox__action lightbox__action--danger"
            onClick={() => onDelete?.(photo.id)}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

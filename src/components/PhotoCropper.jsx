import { useEffect, useRef, useState } from 'react';

/*
 * The "add photo smarts": once an image is picked, frame it inside the circle.
 * Pinch to zoom (or the slider / wheel), drag to position; the crop always
 * covers the circle. Confirms to a square JPEG data URL the bubble can use.
 *
 * Gestures are applied straight to the <img> transform (via refs) for buttery
 * motion, with the model held in a ref and mirrored to state only for the slider.
 */
const OUT = 512; // output resolution

export default function PhotoCropper({ src, onCancel, onConfirm }) {
  const stageRef = useRef(null);
  const imgRef = useRef(null);
  const m = useRef({ iw: 0, ih: 0, D: 300, min: 1, zoom: 1, ox: 0, oy: 0 });
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const apply = () => {
    const { zoom: z, min, ox, oy } = m.current;
    const s = min * z;
    if (imgRef.current) {
      imgRef.current.style.transform = `translate(-50%, -50%) translate(${ox}px, ${oy}px) scale(${s})`;
    }
  };

  const clamp = () => {
    const c = m.current;
    const s = c.min * c.zoom;
    const maxX = Math.max(0, (c.iw * s - c.D) / 2);
    const maxY = Math.max(0, (c.ih * s - c.D) / 2);
    c.ox = Math.max(-maxX, Math.min(maxX, c.ox));
    c.oy = Math.max(-maxY, Math.min(maxY, c.oy));
  };

  const onImgLoad = () => {
    const img = imgRef.current;
    const stage = stageRef.current;
    const D = Math.min(stage.clientWidth, stage.clientHeight) * 0.78;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    m.current = { iw, ih, D, min: D / Math.min(iw, ih), zoom: 1, ox: 0, oy: 0 };
    setReady(true);
    setZoom(1);
    apply();
    stage.style.setProperty('--hole', `${D}px`);
  };

  const setZoomVal = (z) => {
    m.current.zoom = Math.max(1, Math.min(6, z));
    clamp();
    apply();
    setZoom(m.current.zoom);
  };

  // ── Gestures ───────────────────────────────────────────────────────────────
  const pts = useRef(new Map());
  const pinch = useRef(null);

  const dist = () => {
    const [a, b] = [...pts.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const onDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 2) pinch.current = { d0: dist(), z0: m.current.zoom };
  };
  const onMove = (e) => {
    if (!pts.current.has(e.pointerId)) return;
    const prev = pts.current.get(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size >= 2 && pinch.current) {
      const z = pinch.current.z0 * (dist() / pinch.current.d0);
      setZoomVal(z);
    } else {
      m.current.ox += e.clientX - prev.x;
      m.current.oy += e.clientY - prev.y;
      clamp();
      apply();
    }
  };
  const onUp = (e) => {
    pts.current.delete(e.pointerId);
    if (pts.current.size < 2) pinch.current = null;
  };
  const onWheel = (e) => {
    e.preventDefault();
    setZoomVal(m.current.zoom * (e.deltaY > 0 ? 0.94 : 1.06));
  };

  const confirm = () => {
    const c = m.current;
    const img = imgRef.current;
    const s = c.min * c.zoom;
    const f = OUT / c.D;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = OUT;
    const ctx = canvas.getContext('2d');
    const dx = (c.ox - (c.iw * s) / 2 + c.D / 2) * f;
    const dy = (c.oy - (c.ih * s) / 2 + c.D / 2) * f;
    ctx.drawImage(img, dx, dy, c.iw * s * f, c.ih * s * f);
    onConfirm(canvas.toDataURL('image/jpeg', 0.9));
  };

  return (
    <div className="cropper" role="dialog" aria-modal="true" aria-label="Position photo">
      <div
        className="cropper__stage"
        ref={stageRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
      >
        <img
          ref={imgRef}
          src={src}
          alt=""
          className="cropper__img"
          draggable="false"
          onLoad={onImgLoad}
          style={{ opacity: ready ? 1 : 0 }}
        />
        <div className="cropper__hole" />
      </div>

      <div className="cropper__bar">
        <p className="cropper__hint">Drag to move · pinch or scroll to zoom</p>
        <input
          className="cropper__slider"
          type="range"
          min="1"
          max="6"
          step="0.01"
          value={zoom}
          onChange={(e) => setZoomVal(parseFloat(e.target.value))}
          aria-label="Zoom"
        />
        <div className="cropper__actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={confirm} disabled={!ready}>
            Use photo
          </button>
        </div>
      </div>
    </div>
  );
}

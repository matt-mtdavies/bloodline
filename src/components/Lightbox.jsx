import { useEffect, useState } from 'react';
import { savePhotoToDevice } from '../lib/image.js';
import { useImageZoom } from '../lib/useImageZoom.js';

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
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { xf, stageRef, draggedRef, reset, handlers } = useImageZoom();

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

  // Never carry zoom/pan across photos, and drop any stale save/delete-
  // confirm status — a "remove this?" armed on one photo must not silently
  // apply to whichever photo you swipe to next.
  useEffect(() => {
    reset();
    setSaveState('idle');
    setConfirmDelete(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

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
          onPointerDown={(e) => { e.stopPropagation(); handlers.onPointerDown(e); }}
          onPointerMove={(e) => { e.stopPropagation(); handlers.onPointerMove(e); }}
          onPointerUp={(e) => { e.stopPropagation(); handlers.onPointerUp(e); }}
          onPointerCancel={(e) => { e.stopPropagation(); handlers.onPointerCancel(e); }}
          onWheel={(e) => { e.stopPropagation(); handlers.onWheel(e); }}
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
        {confirmDelete ? (
          <div className="lightbox__confirm">
            <span>Remove this photo? This can&apos;t be undone.</span>
            <div className="lightbox__actions">
              <button
                className="lightbox__action lightbox__action--danger"
                onClick={() => { onDelete?.(photo.id); setConfirmDelete(false); }}
              >
                Remove
              </button>
              <button className="lightbox__action" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="lightbox__actions">
            <button className="lightbox__action" onClick={handleSave} disabled={saveState === 'saving'}>
              {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? "Couldn't save" : 'Save'}
            </button>
            <button className="lightbox__action" onClick={() => onSetPortrait?.(photo.src)}>
              Set as portrait
            </button>
            <button
              className="lightbox__action lightbox__action--danger"
              onClick={() => setConfirmDelete(true)}
            >
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

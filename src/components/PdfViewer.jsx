import { useEffect, useRef, useState } from 'react';
import { loadPdf, renderPageToCanvas } from '../lib/pdf.js';
import { useImageZoom } from '../lib/useImageZoom.js';

/*
 * In-app PDF viewer: pages rendered to <canvas> via pdf.js rather than
 * handed off to the browser's own PDF plugin. iOS Safari in particular will
 * often refuse to render a PDF inline inside an iframe at all (blank frame
 * or a forced download), and every browser's native viewer brings its own
 * mismatched chrome. Rendering ourselves means every platform gets the same
 * pinch/double-tap-zoom + pan the photo Lightbox already has, plus real page
 * navigation for multi-page documents.
 */
export default function PdfViewer({ src }) {
  const [doc, setDoc] = useState(null);
  const [pageIndex, setPageIndex] = useState(0); // 0-based
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const canvasRef = useRef(null);
  const { xf, stageRef, handlers, reset } = useImageZoom();

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setDoc(null);
    setPageIndex(0);
    loadPdf(src)
      .then((d) => { if (!cancelled) { setDoc(d); setStatus('ready'); } })
      .catch((e) => { console.warn('[pdf viewer] load failed:', e.message); if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [src]);

  // Never carry zoom/pan across a page turn.
  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIndex]);

  useEffect(() => {
    if (!doc || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(pageIndex + 1);
      if (cancelled || !canvasRef.current) return;
      // Rendered at ~2x device pixels so the built-in pinch zoom (up to 4x)
      // still reads crisp rather than immediately pixelating a 1x raster.
      const renderScale = Math.min(window.devicePixelRatio || 1, 2) * 2;
      await renderPageToCanvas(page, canvasRef.current, renderScale);
    })();
    return () => { cancelled = true; };
  }, [doc, pageIndex]);

  const go = (d) => setPageIndex((n) => Math.min(Math.max(n + d, 0), (doc?.numPages || 1) - 1));

  if (status === 'error') {
    return (
      <div className="pdf-viewer__fallback">
        <p>This document couldn't be previewed.</p>
        <a href={src} target="_blank" rel="noreferrer" className="pdf-viewer__open-link">
          Open in a new tab
        </a>
      </div>
    );
  }

  return (
    <div className="pdf-viewer__stage" ref={stageRef}>
      {status === 'loading' && <div className="mw__spinner" aria-label="Loading" />}
      <canvas
        ref={canvasRef}
        className="pdf-viewer__canvas"
        style={{
          transform: `translate(${xf.x}px, ${xf.y}px) scale(${xf.scale})`,
          opacity: status === 'ready' ? 1 : 0,
        }}
        onPointerDown={(e) => { e.stopPropagation(); handlers.onPointerDown(e); }}
        onPointerMove={(e) => { e.stopPropagation(); handlers.onPointerMove(e); }}
        onPointerUp={(e) => { e.stopPropagation(); handlers.onPointerUp(e); }}
        onPointerCancel={(e) => { e.stopPropagation(); handlers.onPointerCancel(e); }}
        onWheel={(e) => { e.stopPropagation(); handlers.onWheel(e); }}
        onClick={(e) => e.stopPropagation()}
      />
      {doc?.numPages > 1 && xf.scale === 1 && (
        <>
          {pageIndex > 0 && (
            <button
              className="pdf-viewer__nav pdf-viewer__nav--prev"
              onClick={(e) => { e.stopPropagation(); go(-1); }}
              aria-label="Previous page"
            >
              ‹
            </button>
          )}
          {pageIndex < doc.numPages - 1 && (
            <button
              className="pdf-viewer__nav pdf-viewer__nav--next"
              onClick={(e) => { e.stopPropagation(); go(1); }}
              aria-label="Next page"
            >
              ›
            </button>
          )}
          <span className="pdf-viewer__page-count">{pageIndex + 1} / {doc.numPages}</span>
        </>
      )}
    </div>
  );
}

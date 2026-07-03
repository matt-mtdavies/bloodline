import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// getDocument() takes an options object ({ url } or { data }), not a bare
// string — a data: URL (the offline/no-R2 fallback documents are stored as)
// is decoded to bytes and passed as `data` directly, rather than relying on
// pdf.js's own fetch of a data: URI, which not every environment allows.
function toSource(src) {
  if (typeof src === 'string' && src.startsWith('data:')) {
    const bytes = atob(src.slice(src.indexOf(',') + 1));
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return { data: arr };
  }
  return { url: src };
}

export function loadPdf(src) {
  return pdfjsLib.getDocument(toSource(src)).promise;
}

export async function renderPageToCanvas(page, canvas, scale) {
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
}

// Renders page 1 small, once at upload time, for the document row thumbnail —
// same idea as image.js#generateThumb for photos. Cached on the document
// record so the list view never has to load pdf.js just to draw a preview.
export async function generatePdfThumbnail(src, maxSize = 300) {
  try {
    const doc = await loadPdf(src);
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const scale = maxSize / Math.max(viewport.width, viewport.height);
    const canvas = document.createElement('canvas');
    await renderPageToCanvas(page, canvas, scale);
    return canvas.toDataURL('image/jpeg', 0.75);
  } catch (e) {
    console.warn('[pdf] thumbnail failed:', e.message);
    return null;
  }
}

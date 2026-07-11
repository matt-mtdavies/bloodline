/*
 * Image utilities: downscale a picked file to a JPEG data URL, convert a
 * data URL to a Blob, and upload a photo to R2 via the /api/photos endpoint.
 */

export async function fileToDataUrl(file, max = 640) {
  const url = URL.createObjectURL(file);
  try {
    return await imageSrcToDataUrl(url, max);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Same downscale as fileToDataUrl, but from an existing src (a same-origin
// /api/documents/<key> URL, or an already-data: URL) rather than a freshly
// picked File — used to re-run the AI title suggestion against a document
// that's already been uploaded (see suggestDocumentTitle in PersonSheet).
export async function imageSrcToDataUrl(src, max = 640) {
  const img = await loadImage(src);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.85);
}

export function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// Generate a small square JPEG thumbnail suitable for storing directly in D1
// (~5 KB). Used as a cross-device sync fallback when R2 is unavailable.
export function generateThumb(dataUrl, size = 128) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      const s = Math.min(img.width, img.height);
      const sx = (img.width - s) / 2;
      const sy = (img.height - s) / 2;
      ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// Upload a document data URL to R2. Returns the /api/documents/<key> URL on
// success, or the original data URL as a fallback if the upload fails.
export async function uploadDocument(dataUrl, { title = 'document', mime = 'application/octet-stream' } = {}) {
  if (!dataUrl?.startsWith('data:')) return dataUrl;
  try {
    const blob = dataUrlToBlob(dataUrl);
    const ext = mime === 'application/pdf' ? 'pdf'
      : mime.startsWith('image/') ? mime.split('/')[1]
      : 'bin';
    const form = new FormData();
    form.append('file', blob, `${title}.${ext}`);
    const res = await fetch('/api/documents', { method: 'POST', body: form });
    if (res.ok) return (await res.json()).url;
    console.warn('[docs] upload failed:', res.status);
  } catch (e) {
    console.warn('[docs] upload error:', e.message);
  }
  return dataUrl;
}

// Ask the server to read a heading/letterhead/document-type out of a preview
// image and suggest a title for it — "Certificate of Discharge" instead of
// whatever the camera app named the file. Best-effort: returns null (never
// throws) on any failure, a slow/unconfigured server, or a genuine "nothing
// to suggest" reply, so the caller can just keep its filename-derived title.
export async function suggestDocumentTitle(previewDataUrl, { timeoutMs = 10000 } = {}) {
  if (!previewDataUrl?.startsWith('data:image/')) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch('/api/documents/title', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: previewDataUrl }),
      signal: ac.signal,
    });
    if (!res.ok) return null;
    const { title } = await res.json();
    return title || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Read an existing document src (an /api/documents/<key> URL, or an already-
// data: URL) into a data URL, without the canvas downscale imageSrcToDataUrl
// does — a PDF's bytes can't round-trip through a canvas, and a summary of a
// faded scan wants the original resolution, not a lossy preview.
export async function srcToDataUrl(src) {
  if (src.startsWith('data:')) return src;
  const res = await fetch(src);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Ask the server to read and summarize a document — a faded letter, a
// military record, a certificate — into a plain-English paragraph, for
// documents that are hard to make out on-screen. Works on images and PDFs
// alike. Also returns candidate life-event `facts` (each grounded in a
// verbatim quote from the document) for the caller to offer as suggestions —
// never applied automatically. Best-effort: returns null (never throws) on
// any failure, a slow or unconfigured server, or nothing to summarize.
export async function summarizeDocument(dataUrl, { timeoutMs = 45000 } = {}) {
  if (!dataUrl?.startsWith('data:image/') && !dataUrl?.startsWith('data:application/pdf')) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch('/api/documents/summarize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: dataUrl }),
      signal: ac.signal,
    });
    if (!res.ok) return null;
    const { summary, facts } = await res.json();
    if (!summary && !facts?.length) return null;
    return { summary: summary || null, facts: facts || [] };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Upload a photo data URL to R2. Returns the /api/photos/<key> URL on success,
// or the original data URL as a fallback if the upload fails (e.g. offline).
export async function uploadPhoto(dataUrl) {
  if (!dataUrl?.startsWith('data:')) return dataUrl; // already a URL, pass through
  try {
    const blob = dataUrlToBlob(dataUrl);
    const form = new FormData();
    form.append('file', blob, 'photo.jpg');
    const res = await fetch('/api/photos', { method: 'POST', body: form });
    if (res.ok) return (await res.json()).url;
    const body = await res.text().catch(() => '');
    console.warn('[photos] upload failed:', res.status, body);
  } catch (e) {
    console.warn('[photos] upload error:', e.message);
  }
  return dataUrl;
}

// Save a photo (data: URL or same-origin /api/photos/<key> URL — either way,
// no CORS hop involved) to the user's device. Web Share's `files` variant is
// what actually gets a "Save Image"/"Save to Photos" option in the OS share
// sheet on iOS/Android; a plain <a download> only offers that on desktop, so
// it's the fallback rather than the primary path. Returns 'shared' | 'downloaded'
// | 'cancelled' (user dismissed the share sheet — not an error) so the caller
// can decide whether to surface anything.
export async function savePhotoToDevice(src, filename = 'photo.jpg') {
  const res = await fetch(src);
  const blob = await res.blob();
  const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      throw e;
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return 'downloaded';
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

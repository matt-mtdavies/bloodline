/*
 * Image utilities: downscale a picked file to a JPEG data URL, convert a
 * data URL to a Blob, and upload a photo to R2 via the /api/photos endpoint.
 */

export async function fileToDataUrl(file, max = 640) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
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

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

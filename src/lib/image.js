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
  } catch { /* network error */ }
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

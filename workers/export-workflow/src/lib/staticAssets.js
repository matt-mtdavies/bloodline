/*
 * Decodes the generated static viewer bundle (staticViewerAssets.generated.js
 * — see scripts/generateStaticAssets.mjs for why it's generated rather than
 * imported directly as text/binary modules) into ready-to-package
 * `{ path, bytes, byteLength, mimeType, compress }` entries — the same
 * shape workflowSteps.js#startMultipartStep already builds for tree.json/
 * activity-log.json/etc, so these slot straight into buildArchivePlan's
 * `fixedFiles` alongside them.
 */
import { STATIC_VIEWER_FILES } from './staticViewerAssets.generated.js';
import { decodeBase64ToBytes } from './inventory.js';

function decode(entry) {
  if (entry.encoding === 'base64') return decodeBase64ToBytes(entry.content);
  return new TextEncoder().encode(entry.content);
}

// Text assets (HTML/CSS/JS/plain-text licenses) compress well and cost
// nothing extra to deflate; fonts are already-compressed binary formats
// (woff2 is itself a compressed format) and gain nothing from a second
// compression pass — same "don't recompress already-compressed formats"
// rule the rest of packaging already follows for photos/PDFs (§2.6).
function compressFor(mimeType) {
  return mimeType === 'font/woff2' ? 'store' : 'deflate-raw';
}

export function getStaticViewerFiles() {
  return STATIC_VIEWER_FILES.map((entry) => {
    const bytes = decode(entry);
    return {
      path: entry.path,
      bytes,
      byteLength: bytes.byteLength,
      mimeType: entry.mimeType,
      compress: compressFor(entry.mimeType),
    };
  });
}

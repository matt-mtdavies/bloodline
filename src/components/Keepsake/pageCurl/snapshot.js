/*
 * Rasterizes a live DOM element to an <img> — used only for the actively-
 * curling portion of a page during a drag (see PageCurl.jsx); everything
 * else on the page stays real, live, interactive DOM the entire time.
 *
 * No html2canvas dependency. The technique: serialize the element's
 * outerHTML into an SVG <foreignObject>, load that SVG as a data: URI
 * into an <img>. This uses the browser's REAL rendering engine (unlike
 * html2canvas, which re-implements CSS layout by hand and misses things),
 * so text, gradients, box-shadows, and same-origin images all render
 * faithfully.
 *
 * The gotcha that breaks this technique if skipped: a data: URI SVG is an
 * ISOLATED document — it does not inherit the parent page's stylesheets,
 * even though the serialized HTML still carries the original class names.
 * Every loaded stylesheet's CSS text must be embedded directly inside the
 * foreignObject's content, or the snapshot renders unstyled.
 */

// Serializing every stylesheet rule is the most expensive step of a capture
// (measured: the dominant cost of the ~1s a cold capture took in a software-
// rendered test environment) and, for this SPA's bundled CSS, doesn't change
// between captures — cached by stylesheet count as a cheap invalidation
// signal (changes if a stylesheet is added/removed, e.g. Vite HMR in dev).
let cssCache = null;
let cssCacheKey = -1;

function collectStylesheetText() {
  const key = document.styleSheets.length;
  if (cssCache !== null && key === cssCacheKey) return cssCache;
  let css = '';
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) css += rule.cssText + '\n';
    } catch {
      // Cross-origin stylesheet — inaccessible, and shouldn't occur here
      // since this app's CSS is all same-origin bundled output.
    }
  }
  cssCache = css;
  cssCacheKey = key;
  return css;
}

// Inline every CSS custom property resolved on :root/html onto the clone's
// root, since the isolated SVG document has no access to the real
// document's cascade for var() lookups on inherited theme tokens.
function inlineRootCustomProperties(target) {
  const rootStyle = getComputedStyle(document.documentElement);
  const bodyStyle = getComputedStyle(document.body);
  let decl = '';
  for (const style of [rootStyle, bodyStyle]) {
    for (const prop of style) {
      if (prop.startsWith('--')) decl += `${prop}:${style.getPropertyValue(prop)};`;
    }
  }
  target.setAttribute('style', `${target.getAttribute('style') || ''};${decl}`);
}

/*
 * Captures `el` at its current rendered size. Returns a Promise<HTMLImageElement>
 * already `decode()`d — safe to drawImage() immediately with no flash.
 */
export async function captureElementToImage(el) {
  const rect = el.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  const clone = el.cloneNode(true);
  inlineRootCustomProperties(clone);
  // Strip ids to avoid duplicate-id collisions with the live original
  // (harmless for a rasterized snapshot, but keeps the serialized markup
  // from confusing anything that queries by id inside foreignObject).
  clone.removeAttribute('id');
  clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));

  const css = collectStylesheetText();
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden;">
          <style>${css}</style>
          ${clone.outerHTML}
        </div>
      </foreignObject>
    </svg>`;

  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const img = new Image();
  img.width = width;
  img.height = height;
  img.src = dataUrl;
  await img.decode();
  return img;
}

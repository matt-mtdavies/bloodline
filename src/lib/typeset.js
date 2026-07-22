/*
 * The Keepsake typesetter — turns the spread descriptors from lib/keepsake.js
 * into fixed, magazine-true pages for the page-turn reader.
 *
 * The model is a real print workflow:
 *   1. blocksOf(spreads) breaks every spread into typographic BLOCKS — a
 *      section opener, one paragraph of prose, one timeline event, a pull
 *      quote… Some blocks are whole fixed pages by design (the cover, a
 *      full-bleed album photo, the constellation chart).
 *   2. The reader renders every flow block once, offscreen, at the canvas's
 *      exact content width and measures it (the "galley proof").
 *   3. paginate() packs the measured blocks into pages of the canvas's exact
 *      content height. Nothing is ever clipped and NO PAGE EVER SCROLLS —
 *      what doesn't fit simply becomes the next page, like paper.
 *
 * Everything here is pure and DOM-free (measurement happens in the reader);
 * heights come in as a plain {blockId: px} map so this file is unit-testable.
 *
 * Two canonical canvases, chosen by the reader from the viewport:
 *   PRINT_FOLIO — a 3:4 magazine trim, used for desktop spreads and tablets.
 *   PHONE_FOLIO — a pocket-edition trim that fills a phone screen at ~1:1
 *     scale, because scaling a 3:4 page down to phone width makes 17px type
 *     an unreadable 8px. Same blocks, same rules — a smaller press.
 * Pages are typeset at the canvas's logical size and the reader scales the
 * whole sheet DOWN to fit (never up — upscaled text blurs inside 3D
 * transforms on iOS).
 */

export const PRINT_FOLIO = {
  id: 'print',
  w: 780,
  h: 1040,
  padX: 84,
  padTop: 92,
  padBottom: 84,
};

export const PHONE_FOLIO = {
  id: 'phone',
  w: 360,
  h: 640,
  padX: 32,
  padTop: 58,
  padBottom: 50,
};

export const contentWidth = (canvas) => canvas.w - canvas.padX * 2;
export const contentHeight = (canvas) => canvas.h - canvas.padTop - canvas.padBottom;

/* A paragraph too long to ever fit one page would jam the packer (blocks
   split BETWEEN each other, never inside). Split it at sentence boundaries
   into chunks safely under a page — rare (AI paragraphs run ~500 chars),
   but a hand-written life story pasted as one wall of text must not clip. */
const MAX_PROSE_CHARS = 700;
function splitLongText(text) {
  if (text.length <= MAX_PROSE_CHARS) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [text];
  const out = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && cur.length + s.length > MAX_PROSE_CHARS) { out.push(cur.trim()); cur = ''; }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.length ? out : [text];
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
export const roman = (n) => ROMAN[n - 1] || String(n);

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/*
 * The block stream. Every block: { id, kind, ... }.
 * Fixed-page blocks additionally carry fixed: true (and optionally
 * dark/bleed hints the page frame reads); flow blocks are measured + packed.
 * Blocks that open an editable narrative section carry `section`
 * ('origins' | 'legacy' | 'chapter:N' | 'epithet') for the edit pencils.
 */
export function blocksOf(spreads) {
  const blocks = [];
  let uid = 0;
  const push = (b) => blocks.push({ ...b, id: `b${uid++}` });
  const front = spreads.find((s) => s.key === 'frontispiece');

  for (const s of spreads) {
    switch (s.key) {
      case 'cover':
        push({
          kind: 'cover', fixed: true, bleed: true, spread: s,
          familyName: front?.familyName || null,
        });
        break;

      case 'frontispiece':
        push({ kind: 'front', fixed: true, spread: s });
        break;

      case 'origins': {
        push({
          kind: 'sectionOpen', section: 'origins',
          label: 'Origins', title: s.born.place || null,
          sub: s.born.date ? `Born ${s.born.date}` : null,
        });
        if (s.narrative?.length) {
          s.narrative.flatMap(splitLongText).forEach((text, i) => {
            push({ kind: 'prose', text, dropcap: i === 0 });
          });
        } else {
          push({ kind: 'pending', text: 'The story of these beginnings will be written when this edition is compiled.' });
        }
        if (s.parents?.length) push({ kind: 'parents', parents: s.parents });
        break;
      }

      case 'constellation':
        push({ kind: 'constellation', fixed: true, dark: true, spread: s });
        break;

      case 'chapters': {
        s.chapters.forEach((ch, i) => {
          push({
            kind: 'chapterOpen', section: `chapter:${i}`,
            num: i + 1, label: ch.label, title: ch.narrativeTitle || null,
          });
          if (ch.paragraphs?.length) {
            ch.paragraphs.flatMap(splitLongText).forEach((text, j) => {
              push({ kind: 'prose', text, dropcap: j === 0 });
            });
          } else {
            push({ kind: 'pending', text: 'This chapter will be written when the edition is compiled.' });
          }
          for (const e of ch.events || []) push({ kind: 'event', event: e });
        });
        if (s.bio && !s.chapters.some((c) => c.paragraphs?.length)) {
          push({ kind: 'quote', text: s.bio, cite: null });
        }
        break;
      }

      case 'service': {
        push({ kind: 'sectionOpen', label: 'In Service', title: null, sub: null });
        push({ kind: 'serviceId', profile: s.profile });
        for (const e of s.events || []) push({ kind: 'event', event: e });
        for (const q of s.quotes || []) push({ kind: 'quote', text: q.quote, cite: q.docTitle || null });
        if (s.medals?.length) push({ kind: 'medals', medals: s.medals });
        break;
      }

      case 'places': {
        push({ kind: 'sectionOpen', label: 'The Places', title: null, sub: null });
        for (const p of s.places || []) push({ kind: 'place', place: p });
        break;
      }

      case 'voices': {
        push({ kind: 'sectionOpen', label: 'Voices', title: null, sub: null });
        for (const v of s.voices || []) push({ kind: 'voice', voice: v });
        break;
      }

      case 'album': {
        const photos = s.photos || [];
        if (!photos.length) break;
        push({ kind: 'albumHero', fixed: true, bleed: true, photo: photos[0] });
        for (const group of chunk(photos.slice(1), 4)) {
          push({ kind: 'albumGrid', fixed: true, photos: group });
        }
        break;
      }

      case 'documents': {
        for (const group of chunk(s.documents || [], 4)) {
          push({ kind: 'docsGrid', fixed: true, documents: group });
        }
        break;
      }

      case 'record': {
        for (const rows of chunk(s.rows || [], 10)) {
          push({ kind: 'record', fixed: true, rows });
        }
        break;
      }

      case 'legacy': {
        push({
          kind: 'sectionOpen', section: 'legacy',
          label: 'Legacy', title: 'Who follows', sub: null, memorial: !!s.memorial,
        });
        (s.paragraphs || []).flatMap(splitLongText).forEach((text, i) => {
          push({ kind: 'prose', text, dropcap: i === 0 });
        });
        const people = [...(s.children || []), ...(s.grandchildren || [])];
        for (const group of chunk(people, 8)) push({ kind: 'legacyRow', people: group });
        push({ kind: 'legacyLine', spread: s });
        break;
      }

      case 'colophon':
        push({ kind: 'colophon', fixed: true, spread: s });
        break;

      default:
        break;
    }
  }
  return blocks;
}

const OPENERS = new Set(['sectionOpen', 'chapterOpen']);

/*
 * Pack measured flow blocks into pages; fixed blocks pass through as whole
 * pages in stream order. heights: {blockId: px}. Returns pages:
 *   { pageKey, kind: 'fixed', block }
 *   { pageKey, kind: 'flow', blocks: [...] }
 * Rules a human compositor would follow:
 *   - a page break never strands an opener at the foot of a page
 *     (keep-with-next), and
 *   - a block taller than a whole page still gets a page to itself rather
 *     than vanishing (belt-and-braces; splitLongText should prevent it).
 */
export function paginate(blocks, heights, canvas) {
  const maxH = contentHeight(canvas);
  const pages = [];
  let cur = [];
  let curH = 0;

  const flush = () => {
    if (!cur.length) return;
    // Keep-with-next: never leave openers stranded at the foot of the page.
    const carried = [];
    while (cur.length && OPENERS.has(cur[cur.length - 1].kind)) carried.unshift(cur.pop());
    if (cur.length) pages.push({ pageKey: `p${pages.length}:${cur[0].id}`, kind: 'flow', blocks: cur });
    cur = carried;
    curH = carried.reduce((s, b) => s + (heights[b.id] || 0), 0);
  };

  for (const b of blocks) {
    if (b.fixed) {
      flush();
      // An opener carried by keep-with-next re-flushes ahead of a fixed page.
      if (cur.length) { pages.push({ pageKey: `p${pages.length}:${cur[0].id}`, kind: 'flow', blocks: cur }); cur = []; curH = 0; }
      pages.push({ pageKey: `p${pages.length}:${b.id}`, kind: 'fixed', block: b });
      continue;
    }
    const h = heights[b.id] || 0;
    if (cur.length && curH + h > maxH) flush();
    cur.push(b);
    curH += h;
  }
  if (cur.length) pages.push({ pageKey: `p${pages.length}:${cur[0].id}`, kind: 'flow', blocks: cur });
  return pages;
}

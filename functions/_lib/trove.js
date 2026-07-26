/*
 * Trove (National Library of Australia) — pure, testable search/fetch logic.
 * No `env`/Cloudflare context here on purpose: everything takes an injected
 * `fetchImpl` and an explicit `apiKey`, so it can be unit tested with a
 * mocked fetch (see tests/trove.test.mjs) without a live key or network —
 * the same convention as functions/_lib/geocode.js. The thin onRequest*
 * wrappers in functions/api/trove/*.js own env/auth/HTTP framing only.
 *
 * Trove's free-text search has no notion of a "person record" the way
 * FamilySearch's Tree API does — a search here always returns CANDIDATE
 * matches to review, never a confirmed identity, so every caller of
 * searchTrove() should treat results the same way the document-fact
 * pipeline already treats an AI-extracted fact: offer it, never auto-apply.
 *
 * Response-shape note: normalizeSearchResponse() is built from Trove's
 * published API v3 docs and community guides (no live key was available
 * while writing this), and defends against the classic API quirk where a
 * single result comes back as a bare object instead of a one-item array
 * (toArray() below) — but it hasn't been proven against a real response
 * yet. Flagged clearly for a first live smoke test once a key exists;
 * normalizeSearchResponse() degrades to an empty list rather than throwing
 * if the real shape turns out to differ from what's assumed here.
 */

const TROVE_BASE = 'https://api.trove.nla.gov.au/v3';

function toArray(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

// Trove's search is a plain query string, not structured fields — this
// mirrors how a human researcher would actually type a lookup into the
// Trove search box: name plus whatever else narrows it down. Deliberately
// does NOT attempt precise year-range facets (e.g. l-decade) yet — the
// exact facet names/formats for date-narrowing weren't confirmed against a
// live response, so a wrong guess there would silently over- or
// under-filter results. Worth revisiting once a real key can confirm it.
export function buildTroveQuery({ name, place }) {
  return [name, place].filter(Boolean).join(' ').trim();
}

const DEFAULT_CATEGORIES = ['newspaper', 'gazette', 'people'];

function normalizeArticle(a, categoryCode) {
  if (!a?.id) return null;
  return {
    id: String(a.id),
    category: categoryCode, // 'newspaper' | 'gazette'
    // Trove's OWN article-type facet — 'Article' | 'Family Notices' |
    // 'Advertising' | 'Detailed lists, results, guides' | ... — distinct
    // from our `category` above (which is Trove's top-level zone).
    articleType: a.category || null,
    heading: a.heading || null,
    date: a.date || null,
    newspaper: a.title?.value || a.title || null,
    page: a.page ?? null,
    snippet: a.snippet || null,
    troveUrl: a.troveUrl || null,
    wordCount: a.wordCount ?? null,
  };
}

function normalizePerson(p) {
  if (!p?.id) return null;
  const bio = toArray(p.biography)[0];
  return {
    id: String(p.id),
    category: 'people',
    articleType: null,
    heading: p.primaryDisplayName || p.primaryName?.value || null,
    date: null,
    newspaper: null,
    page: null,
    snippet: bio?.text || bio?.biographicalNote || null,
    troveUrl: p.troveUrl || `https://trove.nla.gov.au/people/${p.id}`,
    wordCount: null,
  };
}

// Turns Trove's nested category/records response into one flat list the
// client can render as review cards, regardless of which zone each result
// came from. Any category this build doesn't understand (book, image,
// music, ...) is silently skipped rather than guessed at.
export function normalizeSearchResponse(body) {
  const out = [];
  for (const cat of toArray(body?.category)) {
    const code = cat?.code;
    if (code === 'newspaper' || code === 'gazette') {
      for (const a of toArray(cat.records?.article)) {
        const n = normalizeArticle(a, code);
        if (n) out.push(n);
      }
    } else if (code === 'people') {
      for (const p of toArray(cat.records?.people)) {
        const n = normalizePerson(p);
        if (n) out.push(n);
      }
    }
  }
  return out;
}

/*
 * Searches Trove for a person by name (+ optional place), across
 * newspapers, gazettes, and the People & Organisations category. Returns
 * `{ results }` on success or `{ error }` — never throws, so a thin
 * onRequest wrapper can pass either straight through as JSON.
 */
export async function searchTrove(fetchImpl, apiKey, { name, place, categories = DEFAULT_CATEGORIES } = {}) {
  const trimmedName = (name || '').trim();
  if (!trimmedName) return { error: 'A name is required.' };

  const q = buildTroveQuery({ name: trimmedName, place });
  const params = new URLSearchParams({ q, category: categories.join(','), encoding: 'json', n: '20' });
  const url = `${TROVE_BASE}/result?${params.toString()}`;

  let res;
  try {
    res = await fetchImpl(url, { headers: { 'X-API-KEY': apiKey } });
  } catch {
    return { error: 'Could not reach Trove.' };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { error: `Trove returned ${res.status}.`, detail: detail.slice(0, 300) };
  }
  const body = await res.json().catch(() => null);
  if (!body) return { error: 'Malformed response from Trove.' };
  return { results: normalizeSearchResponse(body) };
}

/*
 * Fetches the full OCR'd text of one newspaper/gazette article (People
 * results have no article text — callers should only call this for
 * category 'newspaper'/'gazette'). Per Trove's docs, `articleText` can come
 * back either as the text itself or as a URL to a separate .txt file — this
 * handles both. OCR text sometimes carries light markup (a stray <p> or
 * similar); stripped before returning since callers treat this as plain
 * text for the extraction pipeline.
 */
export async function fetchArticleText(fetchImpl, apiKey, { id, category }) {
  if (!id || (category !== 'newspaper' && category !== 'gazette')) {
    return { error: 'A newspaper or gazette article id is required.' };
  }
  const url = `${TROVE_BASE}/${category}/${id}?reclevel=full&include=articletext&encoding=json`;
  let res;
  try {
    res = await fetchImpl(url, { headers: { 'X-API-KEY': apiKey } });
  } catch {
    return { error: 'Could not reach Trove.' };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { error: `Trove returned ${res.status}.`, detail: detail.slice(0, 300) };
  }
  const body = await res.json().catch(() => null);
  if (!body) return { error: 'Malformed response from Trove.' };

  let text = body.articleText || null;
  if (text && /^https?:\/\//.test(text)) {
    try {
      const textRes = await fetchImpl(text, { headers: { 'X-API-KEY': apiKey } });
      text = textRes.ok ? await textRes.text().catch(() => null) : null;
    } catch {
      text = null;
    }
  }
  if (text) text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  return {
    text: text || null,
    wordCount: body.wordCount ?? null,
    pdfUrl: body.pdf || null,
    troveUrl: body.troveUrl || null,
    heading: body.heading || null,
    date: body.date || null,
    newspaper: body.title?.value || body.title || null,
    page: body.page ?? null,
  };
}

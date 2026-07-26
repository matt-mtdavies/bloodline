/*
 * Client-side wrappers for the Trove (National Library of Australia) search
 * feature — same convention as summarizeDocument() in image.js (thin
 * fetch+timeout wrapper, best-effort, returns null rather than throwing).
 * The actual search/extraction logic lives server-side
 * (functions/api/trove/search.js, .../article.js) so the API key never
 * reaches the client.
 */

// Searches Trove for newspaper/gazette notices and People & Organisations
// entries matching a name (+ optional place). Returns candidate CITATIONS
// to review — never a confirmed match.
//
// Return shape is deliberately richer than a bare array/null: the server
// returns a distinct 503 when TROVE_API_KEY hasn't been configured yet
// (see functions/api/trove/search.js) — a PERMANENT state until someone
// adds the key, not a transient failure worth telling someone to "try
// again in a moment." Callers need to tell the two apart to show the
// right message (a dead-end retry prompt vs. a live link to Trove's own
// search page) instead of treating every failure identically.
export async function searchTrove({ name, place } = {}, { timeoutMs = 15000 } = {}) {
  if (!name?.trim()) return { results: [] };
  const params = new URLSearchParams({ name: name.trim() });
  if (place?.trim()) params.set('place', place.trim());

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`/api/trove/search?${params.toString()}`, { signal: ac.signal });
    if (res.status === 503) return { notConfigured: true };
    if (!res.ok) {
      console.warn('[trove] search failed:', res.status);
      return { error: true };
    }
    const { results } = await res.json();
    return { results: results || [] };
  } catch (e) {
    console.warn('[trove] search error:', e.message);
    return { error: true };
  } finally {
    clearTimeout(timer);
  }
}

// Fetches one article's full text plus the same fact/field/medal extraction
// a scanned document upload goes through. Returns the citation even if
// extraction itself failed or wasn't configured — see
// functions/api/trove/article.js's own comment. null only on a hard
// failure (the citation itself couldn't be fetched at all).
export async function fetchTroveArticle({ id, category }, { timeoutMs = 30000 } = {}) {
  if (!id || !category) return null;
  const params = new URLSearchParams({ id, category });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`/api/trove/article?${params.toString()}`, { signal: ac.signal });
    if (!res.ok) {
      console.warn('[trove] article fetch failed:', res.status);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn('[trove] article fetch error:', e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

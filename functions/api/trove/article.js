import { json } from '../../_lib/util.js';
import { fetchArticleText } from '../../_lib/trove.js';
import { runExtraction } from '../../_lib/documentExtraction.js';

/*
 * GET /api/trove/article?id=...&category=newspaper|gazette
 *
 * Fetches one Trove newspaper/gazette article's full OCR'd text, then reads
 * it through the SAME extraction pipeline a scanned upload goes through
 * (functions/_lib/documentExtraction.js) — a birth/marriage/death notice or
 * a gazette enlistment entry is exactly the kind of document that pipeline
 * was built for, whether it arrived as a photo or as Trove's own OCR text.
 *
 * Deliberately does NOT run extraction for `category=people` (Trove's
 * People & Organisations entries have no article text to extract from —
 * the search result's own snippet/biography is already the useful part).
 *
 * If ANTHROPIC_API_KEY isn't configured, still returns the raw citation +
 * text (the client can show the article itself and let a person read/quote
 * it manually) rather than failing the whole request — extraction is a
 * bonus on top of the citation, not a requirement for it.
 */
export async function onRequestGet({ request, env, data }) {
  if (!env.TROVE_API_KEY) {
    return json({ error: 'Trove search is not configured on this server.' }, { status: 503 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const category = url.searchParams.get('category');
  if (!id || (category !== 'newspaper' && category !== 'gazette')) {
    return json({ error: 'A newspaper or gazette article id is required.' }, { status: 400 });
  }

  const article = await fetchArticleText(fetch, env.TROVE_API_KEY, { id, category });
  if (article.error) return json(article, { status: 502 });

  const citation = {
    troveUrl: article.troveUrl,
    heading: article.heading,
    date: article.date,
    newspaper: article.newspaper,
    page: article.page,
    text: article.text,
  };

  if (!article.text || !env.ANTHROPIC_API_KEY) {
    return json({ ...citation, summary: null, facts: [], profileFields: null, peopleMentioned: [], medals: [] });
  }

  const { result, errorResponse } = await runExtraction(env, {
    content: [{ type: 'text', text: article.text }],
    user: data.user,
    endpoint: 'trove-extract',
    instruction: 'This is the OCR\'d text of a Trove newspaper or gazette article. Summarize it and extract any grounded life-event facts, profile fields, medals, and family relationships.',
  });
  if (errorResponse) {
    // Extraction failing is a bonus feature failing, not the citation itself
    // — still return the raw article so the client can show it either way.
    return json({ ...citation, summary: null, facts: [], profileFields: null, peopleMentioned: [], medals: [] });
  }
  return json({ ...citation, ...result });
}

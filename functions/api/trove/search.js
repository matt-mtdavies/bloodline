import { json } from '../../_lib/util.js';
import { searchTrove } from '../../_lib/trove.js';

/*
 * GET /api/trove/search?name=...&place=...
 *
 * Searches Trove (National Library of Australia) for newspaper/gazette
 * notices and People & Organisations entries matching a name. Returns
 * lightweight CANDIDATE cards (heading, date, newspaper, snippet, a link
 * back to Trove) — never a confirmed match. Same "offer it, never auto-
 * apply" contract as an AI-extracted document fact; the client is expected
 * to show these as pending review items, exactly like EnrichSheet/DocViewer
 * already do for document-derived facts.
 *
 * Best-effort and non-fatal, same posture as /api/documents/summarize: a
 * 503 (no key configured) or an upstream error just means "no matches
 * available right now" — nothing else about the app is affected.
 */
export async function onRequestGet({ request, env }) {
  if (!env.TROVE_API_KEY) {
    return json({ error: 'Trove search is not configured on this server.' }, { status: 503 });
  }

  const url = new URL(request.url);
  const name = (url.searchParams.get('name') || '').trim();
  const place = url.searchParams.get('place') || null;
  if (!name) return json({ error: 'A name is required.' }, { status: 400 });

  const { results, error, detail } = await searchTrove(fetch, env.TROVE_API_KEY, { name, place });
  if (error) return json({ error, detail }, { status: 502 });
  return json({ results });
}

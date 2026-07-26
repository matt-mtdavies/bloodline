import { json } from '../../_lib/util.js';
import { runExtraction } from '../../_lib/documentExtraction.js';

/*
 * POST /api/documents/summarize  { file: "data:image/jpeg;base64,...." | "data:application/pdf;base64,...." }
 *
 * Reads a scanned document — a faded letter, a military record, a certificate —
 * and writes a plain-English summary of what it says, for documents that are
 * hard to read on-screen (old handwriting, small type, worn paper). Also
 * extracts, each always with a verbatim quote as provenance and never applied
 * automatically:
 *   - candidate life-event facts (a date, a place, a service record) for the
 *     person's timeline
 *   - candidate profile fields (occupation / birth place / residence / military
 *     branch, nation, service number, rank)
 *   - candidate medals or honours the document states were awarded
 *   - other people the document names in a direct family relationship to the
 *     subject (parent/spouse/child/sibling), for cross-referencing against
 *     the tree — see lib/enrich.js
 *
 * Best-effort and non-fatal by design, same contract as /api/documents/title:
 * a 503 (no API key configured) or an upstream error just means "no summary
 * available" — the document itself is unaffected either way.
 *
 * The actual schema/prompt/retry/parse logic lives in
 * ../../_lib/documentExtraction.js, shared with functions/api/trove/article.js
 * (a newspaper/gazette notice's OCR'd text is read by the identical pipeline
 * as a scanned upload — only the message content block differs: an
 * image/document source here, a plain text block there).
 */
export async function onRequestPost({ request, env, data }) {
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'AI features not configured on this server.' }, { status: 503 });
  }

  let file;
  try {
    ({ file } = await request.json());
  } catch {
    return json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const match = /^data:([^;]+);base64,(.+)$/s.exec(file || '');
  if (!match) return json({ error: 'Missing or malformed file.' }, { status: 400 });
  const [, mediaType, fileData] = match;
  const isPdf = mediaType === 'application/pdf';
  if (!isPdf && !mediaType.startsWith('image/')) {
    return json({ error: 'Only image or PDF media types are supported.' }, { status: 400 });
  }
  // A conservative backstop against a request large enough to be flaky or to
  // exceed Anthropic's own per-request ceiling — the client already
  // downscales images before it gets here, so this mainly catches an
  // oversized PDF (which can't be downscaled) and fails fast and clearly
  // instead of hanging on a slow upstream call that was never going to work.
  if (fileData.length > 20 * 1024 * 1024) {
    return json({ error: 'File is too large to summarize.' }, { status: 413 });
  }

  const sourceBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: fileData } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: fileData } };

  const { result, errorResponse } = await runExtraction(env, {
    content: [sourceBlock],
    user: data.user,
    endpoint: 'summarize',
  });
  if (errorResponse) return errorResponse;
  return json(result);
}

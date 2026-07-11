import { json } from '../../_lib/util.js';

/*
 * POST /api/documents/summarize  { file: "data:image/jpeg;base64,...." | "data:application/pdf;base64,...." }
 *
 * Reads a scanned document — a faded letter, a military record, a certificate —
 * and writes a plain-English summary of what it says, for documents that are
 * hard to read on-screen (old handwriting, small type, worn paper).
 *
 * Best-effort and non-fatal by design, same contract as /api/documents/title:
 * a 503 (no API key configured), an upstream error, or a NONE reply just means
 * "no summary available" — the document itself is unaffected either way.
 */
export async function onRequestPost({ request, env }) {
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
  const [, mediaType, data] = match;
  const isPdf = mediaType === 'application/pdf';
  if (!isPdf && !mediaType.startsWith('image/')) {
    return json({ error: 'Only image or PDF media types are supported.' }, { status: 400 });
  }

  const sourceBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data } };

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 500,
      system: [
        'You read scanned family documents for a genealogy app — old letters, certificates,',
        'military records, forms — many faded, handwritten, or partly worn away.',
        'Summarize what this document says: its type, the people named, dates, places, and any',
        'key facts it establishes (e.g. a service number, a relationship, a rank, a cause).',
        'Write 2-4 plain sentences, no headings, no bullet points, no preamble.',
        'Where handwriting or fading makes a word genuinely illegible, say so plainly rather than',
        'guessing and presenting a guess as fact.',
        'If the document is blank, entirely illegible, or not a document at all (an ordinary',
        'snapshot with no text), reply with exactly: NONE.',
      ].join(' '),
      messages: [
        {
          role: 'user',
          content: [
            sourceBlock,
            { type: 'text', text: 'Summarize this document.' },
          ],
        },
      ],
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    return json({ error: `Upstream AI error ${upstream.status}.`, detail: detail.slice(0, 300) }, { status: 502 });
  }

  const body = await upstream.json().catch(() => null);
  const raw = body?.content?.map((b) => b.text || '').join('').trim();
  const summary = raw && raw.toUpperCase() !== 'NONE' ? raw : null;

  return json({ summary });
}

import { json } from '../../_lib/util.js';

/*
 * POST /api/documents/title  { image: "data:image/jpeg;base64,...." }
 *
 * Suggests a short, specific title for a just-uploaded document or photo —
 * "Certificate of Discharge" instead of whatever the camera app named the
 * file ("IMG_0166"). Reads any heading, letterhead, or clearly stated
 * document type visible in the image itself, rather than the filename.
 *
 * Best-effort and non-fatal by design: the client already has the filename
 * as a fallback title, so a 503 (no API key configured), an upstream error,
 * or a NONE reply just means "keep the filename" — never blocks the upload.
 */
export async function onRequestPost({ request, env }) {
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'AI features not configured on this server.' }, { status: 503 });
  }

  let image;
  try {
    ({ image } = await request.json());
  } catch {
    return json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const match = /^data:([^;]+);base64,(.+)$/s.exec(image || '');
  if (!match) return json({ error: 'Missing or malformed image.' }, { status: 400 });
  const [, mediaType, data] = match;
  if (!mediaType.startsWith('image/')) {
    return json({ error: 'Only image media types are supported.' }, { status: 400 });
  }

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 30,
      system: [
        'You label scanned family documents and photos for a genealogy app.',
        'Look for a heading, letterhead, printed title, or clearly stated document type in the image',
        '(e.g. a certificate’s own heading, a letter’s letterhead, "Marriage Certificate", "Passport").',
        'Reply with ONLY that title, plain text, no quotes, no trailing punctuation, under 8 words.',
        'If nothing in the image suggests a title (an ordinary snapshot, illegible text), reply with exactly: NONE.',
      ].join(' '),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
            { type: 'text', text: 'Suggest a title for this image.' },
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
  const title = raw && raw.toUpperCase() !== 'NONE' ? raw.replace(/^["'\s]+|["'\s]+$/g, '') : null;

  return json({ title });
}

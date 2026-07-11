import { json } from '../../_lib/util.js';

// Structured-output schema: a plain-English summary plus zero or more
// candidate life-event facts, each grounded in a verbatim quote from the
// document itself — never a guess. `tag: "military"` marks facts tied to
// service (enlistment, discharge, rank, unit, campaign) so the client can
// surface them distinctly. Requires a model with structured-output support
// (claude-sonnet-5) — see functions/api/documents/summarize.js model choice.
//
// Nullable fields use `anyOf: [{type:...}, {type:'null'}]`, NOT the JSON
// Schema type-array shorthand (`type: ['string','null']`) — Claude's
// structured-output validator only documents plain types, enum/const,
// anyOf/allOf, and $ref/$def as supported keywords; the array-of-types
// shorthand isn't among them and a schema using it is rejected outright
// (every request fails the same way, regardless of the document).
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          year: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          title: { type: 'string' },
          detail: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          quote: { type: 'string' },
          tag: { enum: ['military', null] },
        },
        required: ['year', 'title', 'detail', 'quote', 'tag'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'facts'],
  additionalProperties: false,
};

/*
 * POST /api/documents/summarize  { file: "data:image/jpeg;base64,...." | "data:application/pdf;base64,...." }
 *
 * Reads a scanned document — a faded letter, a military record, a certificate —
 * and writes a plain-English summary of what it says, for documents that are
 * hard to read on-screen (old handwriting, small type, worn paper). Also
 * extracts candidate life-event facts (a date, a place, a service record)
 * that the client can offer to add to the person's timeline — always with a
 * verbatim quote as provenance, never applied automatically.
 *
 * Best-effort and non-fatal by design, same contract as /api/documents/title:
 * a 503 (no API key configured) or an upstream error just means "no summary
 * available" — the document itself is unaffected either way.
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
      // Dense documents (a form with a dozen+ fields) can yield many facts,
      // each carrying a verbatim quote — 900 was tight enough to truncate
      // mid-JSON on busy documents, which silently fails to parse below.
      max_tokens: 2048,
      output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
      system: [
        'You read scanned family documents for a genealogy app — old letters, certificates,',
        'military records, forms — many faded, handwritten, or partly worn away.',
        '',
        '`summary`: 2-4 plain sentences covering the document’s type, the people named, dates,',
        'places, and any key facts it establishes (e.g. a service number, a relationship, a rank,',
        'a cause). No headings, no bullet points, no preamble. Where handwriting or fading makes a',
        'word genuinely illegible, say so plainly rather than guessing and presenting a guess as',
        'fact. If the document is blank, entirely illegible, or not a document at all (an ordinary',
        'snapshot with no text), set summary to null.',
        '',
        '`facts`: candidate life-event entries for this person’s timeline — a birth, marriage,',
        'enlistment, discharge, arrival, death, or similar dated milestone the document plainly',
        'states. Every fact MUST be grounded in a verbatim `quote` copied from the document —',
        'never infer or estimate a year or event that isn’t actually written down. `year` is the',
        'year the event happened (a 4-digit string), or null if the document doesn’t give one.',
        '`title` is short (\"Enlisted\", \"Married\", \"Discharged\"). `detail` adds the specifics worth',
        'keeping (a regiment, a place, a service number) or null. Set `tag` to \"military\" for any',
        'fact tied to military service (enlistment, discharge, rank, unit, campaign, medal) and',
        'null otherwise. If nothing in the document supports a confident fact, return an empty array',
        '— an empty list is correct far more often than a guessed one.',
      ].join(' '),
      messages: [
        {
          role: 'user',
          content: [
            sourceBlock,
            { type: 'text', text: 'Summarize this document and extract any grounded life-event facts.' },
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
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    /* malformed structured output — fall through to the empty best-effort reply */
  }

  return json({ summary: parsed?.summary ?? null, facts: parsed?.facts ?? [] });
}

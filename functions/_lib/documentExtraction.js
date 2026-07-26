import { logAiUsage } from './aiUsage.js';

/*
 * The shared "read this document and extract grounded facts" pipeline —
 * originally built inside functions/api/documents/summarize.js for scanned
 * uploads (images/PDFs), extracted here so functions/api/trove/article.js
 * can run the IDENTICAL schema/prompt/retry logic against a newspaper or
 * gazette article's plain OCR text. Same reasoning either way: a birth,
 * marriage, or death notice is exactly the kind of document this schema
 * was built to read, whether it arrived as a scanned photo or as Trove's
 * OCR'd text.
 *
 * Callers supply the actual message `content` blocks (an image/document
 * source block for a scan, a plain text block for OCR'd text) — everything
 * else (schema, system prompt, retry-on-429/5xx, usage logging, response
 * parsing) is identical regardless of source.
 */

export const MODEL = 'claude-sonnet-5';

// Nullable fields use `anyOf: [{type:...}, {type:'null'}]`, NOT the JSON
// Schema type-array shorthand — see the original comment in summarize.js's
// git history for why (Claude's structured-output validator rejects it).
const QUOTED_FIELD = {
  anyOf: [
    { type: 'null' },
    {
      type: 'object',
      properties: { value: { type: 'string' }, quote: { type: 'string' } },
      required: ['value', 'quote'],
      additionalProperties: false,
    },
  ],
};
const BRANCH_FIELD = {
  anyOf: [
    { type: 'null' },
    {
      type: 'object',
      properties: { value: { enum: ['army', 'navy', 'air_force'] }, quote: { type: 'string' } },
      required: ['value', 'quote'],
      additionalProperties: false,
    },
  ],
};

export const RESPONSE_SCHEMA = {
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
    profile_fields: {
      type: 'object',
      properties: {
        occupation: QUOTED_FIELD,
        birth_place: QUOTED_FIELD,
        residence: QUOTED_FIELD,
        military_branch: BRANCH_FIELD,
        military_nation: QUOTED_FIELD,
        military_service_number: QUOTED_FIELD,
        military_rank: QUOTED_FIELD,
      },
      required: [
        'occupation', 'birth_place', 'residence',
        'military_branch', 'military_nation', 'military_service_number', 'military_rank',
      ],
      additionalProperties: false,
    },
    medals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          detail: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          quote: { type: 'string' },
        },
        required: ['name', 'detail', 'quote'],
        additionalProperties: false,
      },
    },
    people_mentioned: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          relation: { enum: ['parent', 'spouse', 'child', 'sibling', 'other'] },
          quote: { type: 'string' },
        },
        required: ['name', 'relation', 'quote'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'facts', 'profile_fields', 'people_mentioned', 'medals'],
  additionalProperties: false,
};

export const EXTRACTION_SYSTEM_PROMPT = [
  'You read scanned family documents for a genealogy app — old letters, certificates,',
  'military records, forms, and newspaper notices — many faded, handwritten, OCR\'d, or',
  'partly worn away.',
  '',
  '`summary`: 2-4 plain sentences covering the document’s type, the people named, dates,',
  'places, and any key facts it establishes (e.g. a service number, a relationship, a rank,',
  'a cause). No headings, no bullet points, no preamble. Where handwriting, fading, or OCR',
  'noise makes a word genuinely illegible, say so plainly rather than guessing and presenting',
  'a guess as fact. If the document is blank, entirely illegible, or not a document at all,',
  'set summary to null.',
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
  '',
  '`profile_fields`: the document’s own subject’s occupation, birth place, and/or current',
  'residence, ONLY if the document states them plainly. For each of `occupation`,',
  '`birth_place`, `residence`: null if not stated, or `{value, quote}` with `value` a short',
  'plain rendering (\"Sawmill hand\", not the full sentence) and `quote` the exact source text.',
  'These three are the only general-purpose profile fields — do not invent others, and do not',
  'use this for anything about a different person named in the document (their next-of-kin’s',
  'occupation, for instance, does not belong here).',
  '',
  '`military_branch`, `military_nation`, `military_service_number`, `military_rank`: ONLY when',
  'this document is itself a military record (enlistment paper, discharge certificate, service',
  'record) and plainly states them — null for every other document type. `military_branch` is',
  'whichever of "army", "navy", or "air_force" the force described is closest to; leave it null',
  'if the document doesn’t make the branch clear. `military_nation` is the country whose forces',
  'the person served in, in plain English (e.g. "Australia", "United Kingdom", "Canada") — null',
  'if not stated or unclear. `military_service_number` is their service or regimental number',
  'exactly as written. `military_rank` is the highest rank the document actually states (if it',
  'records a promotion, use the later rank) as a short label ("Corporal", "Acting Sergeant"),',
  'not a full sentence. Leave any of these null rather than guessing at what a partly-legible',
  'form might mean.',
  '',
  '`medals`: any medal, decoration, honour, or commendation the document plainly states this',
  'person received or was awarded — e.g. "Military Medal", "Mentioned in Despatches",',
  '"1939-45 Star". `name` is the medal or honour as written (expanding a well-known abbreviation',
  'is fine — "MM" as "Military Medal" — but leave an unfamiliar acronym as written rather than',
  'guessing what it stands for). `detail` is a short note if the document gives one (a citation,',
  'a date, the campaign it was for) or null. `quote` is the verbatim source text. An empty array',
  'is correct when nothing is stated — never infer a medal from a campaign, unit, or length of',
  'service alone.',
  '',
  '`people_mentioned`: every OTHER person the document names in a direct family relationship',
  'to its own subject — a parent, spouse, or child of the subject; also a sibling ONLY as',
  '`relation: "sibling"` (nothing is written for a sibling automatically, it just needs',
  'recognising). Set `relation` to \"other\" for anyone named who is NOT the subject’s direct',
  'family — a witness, an attesting or enlisting officer, a registrar, a doctor, an employer,',
  'a minister. A military or official form often names several such people; \"other\" is the',
  'right answer for all of them, not a fallback to avoid. `name` is exactly as written',
  '(including any \"formerly ___\" or maiden-name aside). `quote` is the verbatim source text',
  'establishing the relationship. If the document names no one but its own subject, return an',
  'empty array.',
].join(' ');

const RETRYABLE = new Set([429, 500, 502, 503, 529]);

/*
 * Runs the extraction against a set of Anthropic message content blocks.
 * Returns exactly one of `{ result }` (on success — always a fully-shaped
 * object, best-effort even on a malformed parse) or `{ errorResponse }` (a
 * ready-to-return Response for a hard failure) — callers just do
 * `if (errorResponse) return errorResponse; return json(result);`.
 */
export async function runExtraction(env, { content, user, endpoint, instruction }) {
  const requestBody = JSON.stringify({
    model: MODEL,
    max_tokens: 3072,
    output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          ...content,
          { type: 'text', text: instruction || 'Summarize this document and extract any grounded life-event facts, profile fields, medals, and family relationships.' },
        ],
      },
    ],
  });

  let upstream, lastDetail = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: requestBody,
    });
    if (upstream.ok || !RETRYABLE.has(upstream.status) || attempt === 3) break;
    lastDetail = await upstream.text().catch(() => '');
    await new Promise((resolve) => setTimeout(resolve, attempt * 800));
  }

  if (!upstream.ok) {
    const detail = lastDetail || await upstream.text().catch(() => '');
    await logAiUsage(env, { endpoint, model: MODEL, usage: null, user, ok: false });
    return {
      errorResponse: Response.json(
        { error: `Upstream AI error ${upstream.status}.`, detail: detail.slice(0, 300) },
        { status: 502 },
      ),
    };
  }

  const body = await upstream.json().catch(() => null);
  await logAiUsage(env, { endpoint, model: MODEL, usage: body?.usage, user, ok: !!body });
  const raw = body?.content?.map((b) => b.text || '').join('').trim();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    /* malformed structured output — fall through to the empty best-effort reply */
  }

  return {
    result: {
      summary: parsed?.summary ?? null,
      facts: parsed?.facts ?? [],
      profileFields: parsed?.profile_fields ?? null,
      peopleMentioned: parsed?.people_mentioned ?? [],
      medals: parsed?.medals ?? [],
    },
  };
}

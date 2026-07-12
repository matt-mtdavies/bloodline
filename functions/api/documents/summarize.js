import { json } from '../../_lib/util.js';
import { logAiUsage } from '../../_lib/aiUsage.js';

const MODEL = 'claude-sonnet-5';

// Structured-output schema: a plain-English summary, zero or more candidate
// life-event facts, zero or more candidate profile-field values, and zero or
// more people named in the document — every one of them grounded in a
// verbatim quote, never a guess. `tag: "military"` marks facts tied to
// service (enlistment, discharge, rank, unit, campaign) so the client can
// surface them distinctly. Requires a model with structured-output support
// (claude-sonnet-5) — see functions/api/documents/summarize.js model choice.
//
// `profile_fields` and `people_mentioned` are deliberately narrow — real
// Person-record fields (occupation/birth_place/residence) and a small,
// closed kinship vocabulary (parent/spouse/child/sibling/other). A military
// service record is often the densest document type we see (regiment,
// religion, next-of-kin, attesting officer, marital status...), so without
// this the extraction would skew toward whatever a busy attestation form
// happens to contain. Anything that isn't a real profile field or a direct
// family relationship (a witness, a registrar, a doctor, an employer) has
// nowhere to go in this schema and is classified 'other', which the client
// simply doesn't act on — see lib/enrich.js.
//
// Nullable fields use `anyOf: [{type:...}, {type:'null'}]`, NOT the JSON
// Schema type-array shorthand (`type: ['string','null']`) — Claude's
// structured-output validator only documents plain types, enum/const,
// anyOf/allOf, and $ref/$def as supported keywords; the array-of-types
// shorthand isn't among them and a schema using it is rejected outright
// (every request fails the same way, regardless of the document).
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
// Same shape as QUOTED_FIELD, but `value` is a closed vocabulary rather than
// free text — reliable enough to key an icon off of client-side (see
// lib/military.js), which free-text branch names ("2nd AIF", "RAAF",
// "Royal Navy") never would be without constant expansion.
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
  required: ['summary', 'facts', 'profile_fields', 'people_mentioned'],
  additionalProperties: false,
};

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
 *   - candidate profile fields (occupation / birth place / residence)
 *   - other people the document names in a direct family relationship to the
 *     subject (parent/spouse/child/sibling), for cross-referencing against
 *     the tree — see lib/enrich.js
 *
 * Best-effort and non-fatal by design, same contract as /api/documents/title:
 * a 503 (no API key configured) or an upstream error just means "no summary
 * available" — the document itself is unaffected either way.
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

  const sourceBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: fileData } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: fileData } };

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
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
      ].join(' '),
      messages: [
        {
          role: 'user',
          content: [
            sourceBlock,
            { type: 'text', text: 'Summarize this document and extract any grounded life-event facts, profile fields, and family relationships.' },
          ],
        },
      ],
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    await logAiUsage(env, { endpoint: 'summarize', model: MODEL, usage: null, user: data.user, ok: false });
    return json({ error: `Upstream AI error ${upstream.status}.`, detail: detail.slice(0, 300) }, { status: 502 });
  }

  const body = await upstream.json().catch(() => null);
  await logAiUsage(env, { endpoint: 'summarize', model: MODEL, usage: body?.usage, user: data.user, ok: !!body });
  const raw = body?.content?.map((b) => b.text || '').join('').trim();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    /* malformed structured output — fall through to the empty best-effort reply */
  }

  return json({
    summary: parsed?.summary ?? null,
    facts: parsed?.facts ?? [],
    profileFields: parsed?.profile_fields ?? null,
    peopleMentioned: parsed?.people_mentioned ?? [],
  });
}

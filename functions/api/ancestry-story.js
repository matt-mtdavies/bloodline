import { json } from '../_lib/util.js';
import { logAiUsage } from '../_lib/aiUsage.js';

/*
 * The Ancestry Story's narrative engine — same architecture as
 * functions/api/keepsake.js, a different data domain (src/lib/ancestryStory.js's
 * patrilineal/matrilineal ascending chains instead of one person's own life).
 *
 * POST /api/ancestry-story  { personId, facts }
 *   → one structured Anthropic call (JSON out, validated, one repair retry),
 *     stored in R2 as an immutable, hash-keyed edition plus latest.json:
 *       ancestry-story/{familyId}/{personId}/{factsHash}.json
 *       ancestry-story/{familyId}/{personId}/latest.json
 *     Edition numbers increment from the previous latest. Nothing is ever
 *     written to tree_json.
 *
 * GET /api/ancestry-story?personId=…
 *   → the latest edition, or null when none has been compiled yet. The
 *     client compares its own freshly-computed factsHash against the stored
 *     edition's `hash` to decide whether new tree information means it's
 *     time to offer "weave in the changes" — same staleness mechanic as the
 *     Keepsake, deliberately not duplicated server-side (the server never
 *     needs to know whether an edition is stale, only how to store one).
 *
 * Grounding contract: the model may use ONLY the fact sheet it is given
 * (assembled + privacy-filtered client-side by lib/ancestryStory.js — a
 * private ancestor already never appears in the facts at all). Invented
 * dates, feelings, or historical color are forbidden by the system prompt,
 * and the output is structural JSON so a drifting reply fails validation
 * instead of leaking into the story.
 */

const MODEL = 'claude-sonnet-4-6';

// Same djb2-style hash as lib/keepsake.js's factsHash (lib/ancestryStory.js
// re-exports the identical function) — the client compares its locally
// computed hash against the stored edition's, so the two must never drift.
function factsHash(facts) {
  const s = JSON.stringify(facts);
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return String(h);
}

const prefixFor = (familyId, personId) => `ancestry-story/${familyId}/${personId}`;

async function familyIdFor(env, userId) {
  const userRow = await env.DB.prepare(`SELECT family_id FROM user WHERE id = ?`)
    .bind(userId).first();
  const membership = userRow?.family_id
    ? await env.DB.prepare(
        'SELECT family_id FROM family_member WHERE user_id = ? AND family_id = ?',
      ).bind(userId, userRow.family_id).first()
    : await env.DB.prepare(
        'SELECT family_id FROM family_member WHERE user_id = ?',
      ).bind(userId).first();
  return membership?.family_id || null;
}

export async function onRequestGet({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });
  if (!env.DOCS) return json({ error: 'Storage not configured' }, { status: 503 });

  const personId = new URL(request.url).searchParams.get('personId');
  if (!personId) return json({ error: 'Missing personId' }, { status: 400 });

  try {
    const familyId = await familyIdFor(env, data.user.uid);
    if (!familyId) return json(null);
    const obj = await env.DOCS.get(`${prefixFor(familyId, personId)}/latest.json`);
    if (!obj) return json(null);
    const edition = await obj.json();
    return json(edition, { headers: { 'cache-control': 'private, no-store' } });
  } catch (e) {
    console.error('[ancestry-story] GET error:', e.message);
    return json({ error: 'Server error' }, { status: 500 });
  }
}

export async function onRequestPost({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });
  if (!env.DOCS) return json({ error: 'Storage not configured' }, { status: 503 });
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'AI features not configured on this server.' }, { status: 503 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { personId, facts } = body;
  if (!personId || !facts?.subject?.name) {
    return json({ error: 'Missing personId or facts' }, { status: 400 });
  }

  try {
    const familyId = await familyIdFor(env, data.user.uid);
    if (!familyId) return json({ error: 'No family' }, { status: 403 });

    const narrative = await generateNarrative(env, data.user, facts);
    if (!narrative) {
      return json({ error: "Couldn't compile this story — try again." }, { status: 502 });
    }

    const prefix = prefixFor(familyId, personId);
    let previous = null;
    try {
      const prevObj = await env.DOCS.get(`${prefix}/latest.json`);
      if (prevObj) previous = await prevObj.json();
    } catch { /* unreadable previous — start over at edition 1 */ }

    const edition = {
      personId,
      hash: factsHash(facts),
      editionNumber: (previous?.editionNumber || 0) + 1,
      compiledAt: new Date().toISOString(),
      narrative,
    };
    const bodyStr = JSON.stringify(edition);
    const opts = { httpMetadata: { contentType: 'application/json' } };
    await env.DOCS.put(`${prefix}/${edition.hash}.json`, bodyStr, opts);
    await env.DOCS.put(`${prefix}/latest.json`, bodyStr, opts);

    return json(edition);
  } catch (e) {
    console.error('[ancestry-story] POST error:', e.message);
    return json({ error: 'Server error', detail: e.message }, { status: 500 });
  }
}

// ── The single structured call ──────────────────────────────────────────────

const SYSTEM = `You are a family chronicler writing the story of where someone comes from, for a family tree app. Your register is warm, plain, dignified — a fireside telling, not a genealogical record. Third person throughout.

You are given two SIDES, each made of two ascending lines:
- fatherSide.fatherLine: the subject's father, his father, and so on back as far as recorded (oldest first)
- fatherSide.motherLine: the subject's father's mother, her mother, and so on back as far as recorded (oldest first)
- fatherSide.convergence: when on record, the marriage of the subject's paternal grandparents — where fatherLine and motherLine meet
- motherSide.motherLine: the subject's mother, her mother, and so on back as far as recorded (oldest first)
- motherSide.fatherLine: the subject's mother's father, his father, and so on back as far as recorded (oldest first)
- motherSide.convergence: when on record, the marriage of the subject's maternal grandparents — where motherLine and fatherLine meet
- convergence: when on record, the marriage of the subject's own parents — where fatherSide and motherSide meet

ABSOLUTE GROUNDING RULES:
- Use ONLY the facts provided. Every sentence must trace to a specific fact given to you.
- NEVER invent: feelings, thoughts, weather, scenery, dialogue, or "must have felt / surely / no doubt" speculation.
- NEVER add historical or era background beyond the worldEvent facts you are explicitly given.
- When a line is short or thin, write less. A short, true passage beats a padded one. An empty line should not be mentioned as an absence — simply tell what IS known.
- If a convergence fact is absent, do not invent a marriage or a meeting — just move on to what the next fact establishes.
- Within each side, weave its two lines together and note where they converge (if that fact is given) rather than treating them as two disconnected paragraphs.
- Tell it chronologically, oldest to youngest, within each line.

Respond with ONLY a JSON object (no markdown fences, no commentary):
{
  "title": "a short evocative title for this ancestry chronicle (3-8 words)",
  "fatherSide": ["1-4 paragraphs weaving together fatherSide.fatherLine and fatherSide.motherLine, oldest ancestors to the subject's father"],
  "motherSide": ["1-4 paragraphs weaving together motherSide.motherLine and motherSide.fatherLine, oldest ancestors to the subject's mother"],
  "convergence": ["1 short paragraph on how the father's side and mother's side meet and lead to the subject — omit (use []) only if there is truly nothing to connect them"]
}
Omit "fatherSide" or "motherSide" (use []) only when BOTH of that side's lines are empty.`;

async function generateNarrative(env, user, facts) {
  const userContent = [
    'Compile the ancestry chronicle for this person.',
    '',
    'FACTS (the complete record — use nothing else):',
    JSON.stringify(facts, null, 1),
  ].join('\n');

  const messages = [{ role: 'user', content: userContent }];

  for (let attempt = 0; attempt < 2; attempt++) {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2400,
        system: [{ type: 'text', text: SYSTEM }],
        messages,
      }),
    });

    if (!upstream.ok) {
      await logAiUsage(env, { endpoint: 'ancestry-story', model: MODEL, usage: null, user, ok: false });
      return null;
    }
    const result = await upstream.json();
    await logAiUsage(env, { endpoint: 'ancestry-story', model: MODEL, usage: result.usage, user, ok: true });

    const text = (result.content || []).find((c) => c.type === 'text')?.text || '';
    const parsed = parseNarrative(text);
    if (parsed) return parsed;

    // One repair pass: quote the bad reply back and demand bare JSON.
    messages.push({ role: 'assistant', content: text.slice(0, 4000) });
    messages.push({
      role: 'user',
      content: 'That was not a valid bare JSON object matching the schema. Respond again with ONLY the JSON object — no fences, no commentary.',
    });
  }
  return null;
}

// Validate hard: a malformed narrative must fail here, never leak a
// half-shaped object into stored editions the client then chokes on.
// Shared by the AI path (parseNarrative) and the human-edit path (PUT).
function validateNarrative(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const strings = (a) => Array.isArray(a) && a.every((s) => typeof s === 'string');
  if (typeof obj.title !== 'string' || !obj.title.trim()) return null;
  if (!strings(obj.fatherSide)) return null;
  if (!strings(obj.motherSide)) return null;
  if (!strings(obj.convergence)) return null;
  return {
    title: obj.title.trim(),
    fatherSide: obj.fatherSide,
    motherSide: obj.motherSide,
    convergence: obj.convergence,
  };
}

function parseNarrative(text) {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  try {
    return validateNarrative(JSON.parse(raw));
  } catch {
    return null;
  }
}

/*
 * PUT /api/ancestry-story  { personId, narrative } — a family member's
 * manual revision of the compiled prose, same trusted-over-the-machine
 * pattern as the Keepsake's own PUT: validated to exactly the same shape as
 * an AI edition, and only ever a revision OF one. editionNumber and hash
 * stay put (the underlying facts didn't change); revisedAt marks it.
 */
export async function onRequestPut({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });
  if (!env.DOCS) return json({ error: 'Storage not configured' }, { status: 503 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { personId } = body;
  const narrative = validateNarrative(body.narrative);
  if (!personId || !narrative) {
    return json({ error: 'Missing personId or malformed narrative' }, { status: 400 });
  }

  try {
    const familyId = await familyIdFor(env, data.user.uid);
    if (!familyId) return json({ error: 'No family' }, { status: 403 });

    const prefix = prefixFor(familyId, personId);
    const prevObj = await env.DOCS.get(`${prefix}/latest.json`);
    if (!prevObj) return json({ error: 'No edition to revise' }, { status: 404 });
    const previous = await prevObj.json();

    const edition = { ...previous, narrative, revisedAt: new Date().toISOString() };
    const bodyStr = JSON.stringify(edition);
    const opts = { httpMetadata: { contentType: 'application/json' } };
    await env.DOCS.put(`${prefix}/${edition.hash}.json`, bodyStr, opts);
    await env.DOCS.put(`${prefix}/latest.json`, bodyStr, opts);
    return json(edition);
  } catch (e) {
    console.error('[ancestry-story] PUT error:', e.message);
    return json({ error: 'Server error', detail: e.message }, { status: 500 });
  }
}

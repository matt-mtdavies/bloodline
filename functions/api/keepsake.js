import { json } from '../_lib/util.js';
import { logAiUsage } from '../_lib/aiUsage.js';

/*
 * The Keepsake's narrative engine (docs/KEEPSAKE.md Phase 2).
 *
 * POST /api/keepsake  { personId, facts, chapterPlan?, recordCount? }
 *   → one structured Anthropic call (JSON out, validated, one repair retry),
 *     stored in R2 as an immutable, hash-keyed edition plus latest.json:
 *       keepsake/{familyId}/{personId}/{factsHash}.json
 *       keepsake/{familyId}/{personId}/latest.json   (the full edition — one
 *       read serves the whole GET, no pointer chase)
 *     Edition numbers increment from the previous latest. Nothing is ever
 *     written to tree_json — the 1MB D1 row gains no weight from this.
 *
 * GET /api/keepsake?personId=…
 *   → the latest edition, or null when none has been compiled yet.
 *
 * Grounding contract: the model may use ONLY the fact sheet it is given
 * (assembled + privacy-filtered client-side by lib/keepsake.js). Invented
 * feelings, imagined scenes and era color are forbidden by the system
 * prompt, and the output is structural JSON so a drifting reply fails
 * validation instead of leaking into the book.
 */

const MODEL = 'claude-sonnet-4-6';

// Same djb2-style hash as lib/keepsake.js's factsHash — the client compares
// its locally-computed hash against the stored edition's to detect staleness,
// so the two implementations must never drift. (JSON.stringify of the parsed
// body preserves the client's key order, so both sides hash the same string.)
function factsHash(facts) {
  const s = JSON.stringify(facts);
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return String(h);
}

const prefixFor = (familyId, personId) => `keepsake/${familyId}/${personId}`;

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
    console.error('[keepsake] GET error:', e.message);
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
  const { personId, facts, chapterPlan = [], recordCount = null } = body;
  if (!personId || !facts?.subject?.name) {
    return json({ error: 'Missing personId or facts' }, { status: 400 });
  }

  try {
    const familyId = await familyIdFor(env, data.user.uid);
    if (!familyId) return json({ error: 'No family' }, { status: 403 });

    const narrative = await generateNarrative(env, data.user, facts, chapterPlan);
    if (!narrative) {
      return json({ error: "Couldn't compile this edition — try again." }, { status: 502 });
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
      recordCount,
      narrative,
    };
    const bodyStr = JSON.stringify(edition);
    const opts = { httpMetadata: { contentType: 'application/json' } };
    await env.DOCS.put(`${prefix}/${edition.hash}.json`, bodyStr, opts);
    await env.DOCS.put(`${prefix}/latest.json`, bodyStr, opts);

    return json(edition);
  } catch (e) {
    console.error('[keepsake] POST error:', e.message);
    return json({ error: 'Server error', detail: e.message }, { status: 500 });
  }
}

// ── The single structured call ──────────────────────────────────────────────

const SYSTEM = `You are a distinguished family biographer writing the narrative for a printed keepsake book about one person, for a family tree app. Your register is a fine magazine profile — warm, plain, dignified, specific. Third person throughout.

ABSOLUTE GROUNDING RULES:
- Use ONLY the facts provided. Every sentence must trace to a specific fact given to you.
- NEVER invent: feelings, thoughts, weather, scenery, imagined scenes, dialogue, motivations, or "must have felt / surely / no doubt" speculation.
- NEVER add historical or era background not present in the facts.
- When the record is thin, write less. A short, true chapter beats a padded one.
- Quote family memories naturally where they fit; attribute by first name if given.
- If the person is deceased, write with reverence, never mawkishness.

Respond with ONLY a JSON object (no markdown fences, no commentary):
{
  "epithet": "a 3-8 word phrase for the cover, drawn from their roles/occupation/tags",
  "origins": ["1-2 paragraphs about their beginnings: birth, place, parents"],
  "chapters": [{ "title": "a short evocative chapter title drawn from the facts", "years": "the year range you were given for this chapter", "paragraphs": ["1-3 paragraphs"] }],
  "legacy": ["1 short closing paragraph about who follows them, only from the family facts given"]
}
Write one chapter object for each chapter plan entry you are given, in order, using its exact year range in "years". Omit "origins" or "legacy" (use []) when there are no facts to write them from.`;

async function generateNarrative(env, user, facts, chapterPlan) {
  const userContent = [
    'Compile the keepsake narrative for this person.',
    '',
    `Chapter plan (one chapter per entry): ${chapterPlan.length ? chapterPlan.join(' | ') : 'a single chapter covering the whole life'}`,
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
        max_tokens: 3000,
        system: [{ type: 'text', text: SYSTEM }],
        messages,
      }),
    });

    if (!upstream.ok) {
      await logAiUsage(env, { endpoint: 'keepsake', model: MODEL, usage: null, user, ok: false });
      return null;
    }
    const result = await upstream.json();
    await logAiUsage(env, { endpoint: 'keepsake', model: MODEL, usage: result.usage, user, ok: true });

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
function parseNarrative(text) {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const strings = (a) => Array.isArray(a) && a.every((s) => typeof s === 'string');
  if (typeof obj.epithet !== 'string' || !obj.epithet.trim()) return null;
  if (!strings(obj.origins)) return null;
  if (!strings(obj.legacy)) return null;
  if (!Array.isArray(obj.chapters)) return null;
  for (const ch of obj.chapters) {
    if (!ch || typeof ch.title !== 'string' || typeof ch.years !== 'string' || !strings(ch.paragraphs)) return null;
  }
  return {
    epithet: obj.epithet.trim(),
    origins: obj.origins,
    chapters: obj.chapters.map((ch) => ({ title: ch.title.trim(), years: ch.years.trim(), paragraphs: ch.paragraphs })),
    legacy: obj.legacy,
  };
}

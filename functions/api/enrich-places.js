/*
 * POST /api/enrich-places
 *
 * The one genuinely-AI check in "Enrich this profile": normalise the free-text
 * place names a person already has recorded (birthplace, residence) into a
 * fuller canonical form — "Sydney NSW" → "Sydney, New South Wales, Australia".
 * This is real-world geographic knowledge applied to what the user already
 * wrote, never a new location invented for a place that was blank — a blank
 * field is simply skipped, not filled in.
 *
 * A micro-ask (label parsing, not prose), so this runs on Haiku per the
 * model-per-task plan in docs/BUILD-PLAN.md.
 *
 * Request:  { places: [{ key: 'birth_place'|'residence', value: string }] }
 * Response: { suggestions: [{ key, original, suggested }] } — a place is
 *           omitted entirely when the model judges it already canonical, so
 *           the client never has to filter out no-op "suggestions".
 * 503 when ANTHROPIC_API_KEY is absent, matching every other AI endpoint.
 */
import { logAiUsage } from '../_lib/aiUsage.js';

const MODEL = 'claude-haiku-4-5';

export async function onRequestPost({ request, env, data }) {
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'AI features not configured on this server.' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const places = Array.isArray(body?.places)
    ? body.places.filter((p) => p?.key && p?.value && String(p.value).trim())
    : [];
  if (!places.length) return json({ suggestions: [] });

  const list = places.map((p, i) => `${i + 1}. [${p.key}] "${p.value.trim()}"`).join('\n');

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: [
        'You standardise place names for a family tree app. For each numbered place, decide whether it is already a full, unambiguous "City, State/Province, Country" (or "City, Country" where there is no state/province level) form.',
        'If it already is, output nothing for that number.',
        'If it is abbreviated, missing its country, or missing its state/province, output its corrected full form — using your own knowledge of real-world geography. Never invent a place that was not named: only complete or correct the SAME place the user already wrote.',
        'If a place is too ambiguous to resolve confidently (a common town name with no other clue), output nothing for it rather than guess.',
        'Respond with ONLY a JSON array, no prose: [{"n": <number>, "full": "<corrected form>"}, ...]. Omit entries you have no correction for.',
      ].join(' '),
      messages: [
        { role: 'user', content: `Places:\n${list}` },
      ],
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    await logAiUsage(env, { endpoint: 'enrich-places', model: MODEL, usage: null, user: data.user, ok: false });
    return json({ error: `Upstream AI error ${upstream.status}.`, detail: detail.slice(0, 300) }, 502);
  }

  const respBody = await upstream.json().catch(() => null);
  await logAiUsage(env, { endpoint: 'enrich-places', model: MODEL, usage: respBody?.usage, user: data.user, ok: !!respBody });
  const text = respBody?.content?.map((b) => b.text || '').join('').trim() || '[]';
  let parsed;
  try {
    // The model sometimes wraps the array in a code fence despite the
    // instruction — strip it defensively rather than fail the whole request.
    parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return json({ suggestions: [] });
  }
  if (!Array.isArray(parsed)) return json({ suggestions: [] });

  const suggestions = parsed
    .map((row) => {
      const idx = Number(row?.n) - 1;
      const original = places[idx];
      const full = (row?.full || '').trim();
      if (!original || !full || full === original.value.trim()) return null;
      return { key: original.key, original: original.value, suggested: full };
    })
    .filter(Boolean);

  return json({ suggestions });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

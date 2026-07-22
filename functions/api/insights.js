/*
 * POST /api/insights
 *
 * Grounded "family story" narrative for the Tree Insights surface. The client
 * sends ONLY the aggregate facts produced locally (counts, spans, completeness,
 * a few already-public names) — never living-person detail. The model writes a
 * short warm paragraph and is explicitly forbidden from inventing anything not
 * present in the facts.
 *
 * Returns { narrative }. 503 when ANTHROPIC_API_KEY is absent so the feature
 * can hide gracefully.
 */
import { logAiUsage } from '../_lib/aiUsage.js';

const MODEL = 'claude-sonnet-4-6';

export async function onRequestPost({ request, env, data }) {
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'AI features not configured on this server.' }, 503);
  }

  let agg;
  try {
    ({ aggregates: agg } = await request.json());
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }
  if (!agg || typeof agg !== 'object') {
    return json({ error: 'Missing aggregates.' }, 400);
  }

  // Render the facts as a compact, unambiguous block for the model.
  const lines = [];
  lines.push(`Total people in the tree: ${agg.totalPeople ?? 'unknown'}`);
  if (agg.generations) lines.push(`Generations represented: ${agg.generations}`);
  if (agg.surnames?.length) {
    lines.push(`Surnames (name × count): ${agg.surnames.map((s) => `${s.name} ×${s.count}`).join(', ')}`);
  }
  if (agg.span?.min) {
    lines.push(`Year span: ${agg.span.min}–${agg.span.max}`);
    if (agg.span.earliest) lines.push(`Earliest-born known person: ${agg.span.earliest} (${agg.span.min})`);
    if (agg.span.latest) lines.push(`Most recently born: ${agg.span.latest} (${agg.span.max})`);
  }
  if (agg.viewer) {
    lines.push(`The reader is ${agg.viewer.firstName || 'a family member'}${agg.viewer.surname ? ` ${agg.viewer.surname}` : ''}, with ${agg.viewer.generationsAbove ?? 0} generation(s) of ancestors and ${agg.viewer.generationsBelow ?? 0} below them in this tree.`);
  }
  if (agg.heart) lines.push(`Most-connected person: ${agg.heart}`);
  if (agg.completeness) {
    const c = agg.completeness;
    lines.push(`Archive completeness: ${c.portraits}/${c.total} portraits, ${c.biographies}/${c.total} life stories, ${c.birthDates}/${c.total} birth dates.`);
  }
  // Highlights from the sheet's own visual modules (Tree Insights Wave 1/2) —
  // same grounding rule applies: specific, computed facts, not embellishment
  // prompts. Not every tree will have all of these.
  const h = agg.highlights;
  if (h?.handshake) {
    lines.push(`Chain of overlapping lifespans back to the earliest reachable ancestor: ${h.handshake.hops} hop(s) to ${h.handshake.earliestName}, born ${h.handshake.earliestBirth}.`);
    if (h.handshake.anchor) lines.push(`A world event near that ancestor's birth year: ${h.handshake.anchor}`);
  }
  if (h?.lifespanGain) {
    lines.push(`Average lifespan rose from ${h.lifespanGain.firstAvg} years (born ${h.lifespanGain.firstDecade}s) to ${h.lifespanGain.lastAvg} years (born ${h.lifespanGain.lastDecade}s).`);
  }
  if (h?.fullestYear) {
    lines.push(`Living relatives at once peaked at ${h.fullestYear.peakCount}${h.fullestYear.peakYear === 'now' ? ', right now' : ` in ${h.fullestYear.peakYear}`}.`);
  }
  if (h?.bridge) {
    lines.push(`${h.bridge.name} is the sole connection between two branches of the family (one side roughly ${h.bridge.sideACount} people${h.bridge.sideASurname ? `, mostly surnamed ${h.bridge.sideASurname}` : ''}; the other roughly ${h.bridge.sideBCount}${h.bridge.sideBSurname ? `, mostly surnamed ${h.bridge.sideBSurname}` : ''}).`);
  }
  if (h?.topName) {
    lines.push(`Most repeated first name: ${h.topName.name} (${h.topName.count} people, across ${h.topName.generationsPresent} generations).`);
  }
  if (h?.heartland) {
    lines.push(`Most common birthplace: ${h.heartland.place}${h.heartland.migration ? `. Birthplace has moved across generations: ${h.heartland.migration.join(' → ')}` : ''}.`);
  }
  if (h?.trades) {
    lines.push(`Occupations shifted from ${h.trades.from} in the earliest era to ${h.trades.to} in the most recent (${h.trades.distinct} distinct trades recorded).`);
  }
  if (h?.birthdayPeak) {
    lines.push(`Most common birth month: ${h.birthdayPeak.month} (${h.birthdayPeak.count} people).`);
  }
  if (h?.longestMarriage) {
    lines.push(`Longest recorded marriage: ${h.longestMarriage}`);
  }
  const factBlock = lines.join('\n');

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 320,
      system: [
        {
          type: 'text',
          text: [
            'You are a warm family archivist introducing someone to the shape of their family tree.',
            'Write ONE short paragraph (3–4 sentences), addressed to the reader in second person ("your family", "you").',
            'Voice: warm, plain, a little wondrous — never salesy, no clichés like "tapestry" or "journey".',
            'Ground every statement strictly in the facts provided. Do NOT invent names, dates, places, relationships, or numbers that are not in the facts.',
            'The facts may include several extra highlights (a chain of overlapping lifespans, a lifespan trend, a bridging relative, a repeated name, a birthplace, occupations, a marriage record). Pick ONLY the one or two most striking for this paragraph — never list them all, that reads like a report, not a story.',
            'If the archive is sparse (few life stories or birth dates), you may gently note there is more to discover — but never fabricate it.',
            'Write only the paragraph — no title, no preamble, no bullet points.',
          ].join(' '),
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        { role: 'user', content: `Here are the facts about this family tree:\n\n${factBlock}\n\nWrite the paragraph.` },
      ],
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    await logAiUsage(env, { endpoint: 'insights', model: MODEL, usage: null, user: data.user, ok: false });
    return json({ error: `Upstream AI error ${upstream.status}.`, detail: detail.slice(0, 300) }, 502);
  }

  const body = await upstream.json().catch(() => null);
  const narrative = body?.content?.map((b) => b.text || '').join('').trim();
  await logAiUsage(env, { endpoint: 'insights', model: MODEL, usage: body?.usage, user: data.user, ok: !!narrative });
  if (!narrative) return json({ error: 'Empty AI response.' }, 502);

  return json({ narrative });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

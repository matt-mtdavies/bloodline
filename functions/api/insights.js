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
export async function onRequestPost({ request, env }) {
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
      model: 'claude-sonnet-4-6',
      max_tokens: 320,
      system: [
        {
          type: 'text',
          text: [
            'You are a warm family archivist introducing someone to the shape of their family tree.',
            'Write ONE short paragraph (3–4 sentences), addressed to the reader in second person ("your family", "you").',
            'Voice: warm, plain, a little wondrous — never salesy, no clichés like "tapestry" or "journey".',
            'Ground every statement strictly in the facts provided. Do NOT invent names, dates, places, relationships, or numbers that are not in the facts.',
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
    return json({ error: `Upstream AI error ${upstream.status}.`, detail: detail.slice(0, 300) }, 502);
  }

  const data = await upstream.json().catch(() => null);
  const narrative = data?.content?.map((b) => b.text || '').join('').trim();
  if (!narrative) return json({ error: 'Empty AI response.' }, 502);

  return json({ narrative });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

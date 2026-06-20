/*
 * POST /api/biography
 *
 * Accepts { person, memories, relationships } and streams back an Anthropic SSE
 * response. The API key never leaves the server; the client only sees plain SSE.
 *
 * Gracefully returns 503 when ANTHROPIC_API_KEY is absent (local dev without
 * wrangler, or before the secret is provisioned).
 */
export async function onRequestPost({ request, env }) {
  if (!env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'AI features not configured on this server.' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { person, memories = [], relationships = [] } = body;
  if (!person?.display_name) {
    return new Response(JSON.stringify({ error: 'Missing person data.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Build a structured context string for the model.
  const lines = [];
  lines.push(`Name: ${person.display_name}`);
  if (person.gender) lines.push(`Gender: ${person.gender}`);
  if (person.birth_date) lines.push(`Born: ${person.birth_date}`);
  if (person.birth_place) lines.push(`Birth place: ${person.birth_place}`);
  if (person.death_date) lines.push(`Died: ${person.death_date}`);
  if (person.is_deceased) lines.push('Status: Deceased');
  if (person.occupation) lines.push(`Occupation: ${person.occupation}`);
  if (person.residence) lines.push(`Residence: ${person.residence}`);
  if (person.bio) lines.push(`Family note: ${person.bio}`);
  if (person.tags?.length) lines.push(`Tags: ${person.tags.join(', ')}`);

  if (person.events?.length) {
    const evs = person.events
      .slice()
      .sort((a, b) => (a.year || 0) - (b.year || 0))
      .map((e) => `  ${e.year}: ${e.title}${e.detail ? ` — ${e.detail}` : ''}`)
      .join('\n');
    lines.push(`Life events:\n${evs}`);
  }

  if (relationships.length) {
    const rels = relationships
      .slice(0, 8)
      .map((r) => `  ${r.label}: ${r.name}`)
      .join('\n');
    lines.push(`Family connections:\n${rels}`);
  }

  if (memories.length) {
    const mems = memories
      .slice(0, 6)
      .map((m) => `  — "${m.text}" (shared by ${m.author})`)
      .join('\n');
    lines.push(`Memories from the family:\n${mems}`);
  }

  const personContext = lines.join('\n');

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 700,
      stream: true,
      system: [
        {
          type: 'text',
          text: `You are a thoughtful family archivist writing intimate life story paragraphs for a family tree app. Your voice is warm, plain, and specific — like a letter from a relative who loved this person. Write in the third person. Two to three short paragraphs. No bullet points, no headers. Draw on the details given: timeline events, occupation, place, and above all the memories family members have shared. If the person is deceased, treat them with reverence. If living, write with warmth and a sense of an ongoing story. Write only the biography — nothing else.`,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Write a life story for this person:\n\n${personContext}`,
        },
      ],
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    return new Response(
      JSON.stringify({ error: `Upstream AI error ${upstream.status}.`, detail }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }

  // Pass the Anthropic SSE stream straight through to the client.
  return new Response(upstream.body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    },
  });
}

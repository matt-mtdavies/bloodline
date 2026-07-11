/*
 * POST /api/biography
 *
 * Accepts { person, memories, relationships } and streams back an Anthropic SSE
 * response. The API key never leaves the server; the client only sees plain SSE.
 *
 * Gracefully returns 503 when ANTHROPIC_API_KEY is absent (local dev without
 * wrangler, or before the secret is provisioned).
 */
import { logAiUsage } from '../_lib/aiUsage.js';

const MODEL = 'claude-sonnet-4-6';

export async function onRequestPost({ request, env, data, waitUntil }) {
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

  const { person, memories = [], relationships = [], documents = [], feedback, previousStory } = body;
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

  // Documents the family has scanned and summarized (see summarize.js) —
  // often the richest source in the whole record: a discharge form's "quiet
  // dignity" doesn't show up in a birth_date field. This is the AI summary
  // text, not the raw scan, so it's already been through one grounding pass;
  // still just background material for the story, same as a memory.
  if (documents.length) {
    const docs = documents
      .slice(0, 6)
      .map((d) => `  — "${d.title}": ${d.summary}`)
      .join('\n');
    lines.push(`Documents on file:\n${docs}`);
  }

  const personContext = lines.join('\n');

  // A family member reviewed a previous draft and flagged something wrong
  // with it — trust their correction over the source data above, since a
  // human catching an AI mistake (or knowing a fact the records don't
  // capture) is exactly the case this is for. Quote the flagged draft back
  // so the model revises it rather than starting fresh and risking the same
  // error again by coincidence.
  const revisionNote = feedback?.trim()
    ? `\n\nA previous draft was reviewed by the family and needs correcting. Treat their notes as the source of truth, even where they conflict with the details above — they know this person; the records above don't always.${
        previousStory?.trim() ? `\n\nPrevious draft:\n${previousStory.trim()}` : ''
      }\n\nFamily's corrections:\n${feedback.trim()}\n\nRewrite the biography incorporating these corrections.`
    : '';

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
      max_tokens: 700,
      stream: true,
      system: [
        {
          type: 'text',
          text: `You are a thoughtful family archivist writing intimate life story paragraphs for a family tree app. Your voice is warm, plain, and specific — like a letter from a relative who loved this person. Write in the third person. Two to three short paragraphs. No bullet points, no headers. Draw on the details given: timeline events, occupation, place, the family's own documents on file, and above all the memories family members have shared. If the person is deceased, treat them with reverence. If living, write with warmth and a sense of an ongoing story. Write only the biography — nothing else.`,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Write a life story for this person:\n\n${personContext}${revisionNote}`,
        },
      ],
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    await logAiUsage(env, { endpoint: 'biography', model: MODEL, usage: null, user: data.user, ok: false });
    return new Response(
      JSON.stringify({ error: `Upstream AI error ${upstream.status}.`, detail }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }

  // Tee the stream: one branch goes straight to the client unchanged (so the
  // live-typing UX is untouched), the other is parsed in the background
  // (waitUntil, after the response has already returned) purely to read the
  // final token counts Anthropic reports mid-stream, for the usage log.
  const [clientStream, usageStream] = upstream.body.tee();
  waitUntil(logStreamUsage(env, usageStream, data.user));

  return new Response(clientStream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    },
  });
}

// Reads the tee'd SSE branch to extract token counts, without affecting what
// the client sees. `message_start` carries input_tokens; `message_delta`
// carries the running output_tokens — same shape streamBio already parses
// client-side, just watching different fields.
async function logStreamUsage(env, stream, user) {
  let inputTokens = 0, outputTokens = 0;
  try {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const blocks = buf.split('\n\n');
      buf = blocks.pop() ?? '';
      for (const block of blocks) {
        const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        try {
          const evt = JSON.parse(dataLine.slice(6));
          if (evt.message?.usage) {
            inputTokens = evt.message.usage.input_tokens || inputTokens;
            outputTokens = evt.message.usage.output_tokens || outputTokens;
          }
          if (evt.usage?.output_tokens != null) outputTokens = evt.usage.output_tokens;
        } catch { /* malformed chunk — skip */ }
      }
    }
  } catch (e) {
    console.error('[biography] usage stream read failed:', e.message);
  }
  await logAiUsage(env, { endpoint: 'biography', model: MODEL, usage: { input_tokens: inputTokens, output_tokens: outputTokens }, user, ok: true });
}

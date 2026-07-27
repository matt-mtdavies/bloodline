import { fetchWithTimeout } from './net.js';

// A real user report ("if I go to generate a story... it freezes... only a
// refresh clears it") traced to exactly this: neither the initial connect
// nor the SSE read loop below had any timeout, so a stalled connection (or
// a Worker that hangs mid-stream, headers already sent) left this promise
// unresolved forever — the caller's own "generating…" state never had a
// chance to reach its existing error handling, which was already correct.
// CONNECT covers "never got a response at all"; STALL covers "started
// streaming, then went silent" — generously long since a real generation
// can legitimately run for a while, but no *gap between chunks* should
// ever come close to this.
const CONNECT_TIMEOUT_MS = 20_000;
const STALL_TIMEOUT_MS = 45_000;

// Races a single reader.read() against a stall timer, rejecting with a
// clearly-tagged error if no chunk arrives in time — reader.read() itself
// has no timeout of its own to lean on.
async function readWithStallTimeout(reader, timeoutMs) {
  let timer;
  const stalled = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('stream stalled'), { stalled: true })), timeoutMs);
  });
  try {
    return await Promise.race([reader.read(), stalled]);
  } finally {
    clearTimeout(timer);
  }
}

/*
 * Client-side helper for streaming AI biography generation.
 *
 * Calls POST /api/biography and parses the Anthropic SSE format.
 * Relevant events: content_block_delta (text_delta) for text chunks,
 * message_stop to signal completion.
 *
 * Pass `feedback` (and the `previousStory` it's correcting) to regenerate
 * with the family's own corrections taking priority over the source data —
 * see PersonSheet's "revise" flow.
 *
 * Pass `focus: 'military'` (with `militaryEvents`/`militaryQuotes`, see
 * lib/military.js) to get a short, tightly-grounded account of just a
 * person's service instead of the general life story — same endpoint, same
 * streaming/revision mechanics, a different prompt server-side. See
 * MilitaryService.jsx.
 *
 * Callbacks:
 *   onChunk(text)  — called for each incremental text piece
 *   onDone()       — called when the stream ends cleanly
 *   onError(err)   — called on network / server errors, or a stall/connect
 *                    timeout (null only when the CALLER's own `signal` was
 *                    the thing that aborted — a real timeout is always
 *                    reported, never silently swallowed as if intentional)
 *
 * connectTimeoutMs/stallTimeoutMs override the defaults above — exposed
 * purely so tests can exercise the timeout/stall paths without actually
 * waiting 20-45 real seconds; production callers never need to pass these.
 */
export async function streamBio(
  person,
  { memories = [], relSummary = [], documentSummaries = [], feedback, previousStory, focus, militaryEvents, militaryQuotes } = {},
  { onChunk, onDone, onError, signal, connectTimeoutMs = CONNECT_TIMEOUT_MS, stallTimeoutMs = STALL_TIMEOUT_MS } = {},
) {
  let res;
  try {
    res = await fetchWithTimeout('/api/biography', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        person, memories, relationships: relSummary, documents: documentSummaries, feedback, previousStory,
        focus, militaryEvents, militaryQuotes,
      }),
      signal,
    }, connectTimeoutMs);
  } catch (e) {
    onError?.(signal?.aborted ? null : (e.name === 'AbortError' ? new Error('Connection timed out — please try again') : e));
    return;
  }

  if (!res.ok) {
    let msg = `Server error ${res.status}`;
    try {
      const d = await res.json();
      msg = d.error || msg;
    } catch { /* ignore */ }
    onError?.(new Error(msg));
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { value, done } = await readWithStallTimeout(reader, stallTimeoutMs);
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // Anthropic SSE blocks are separated by double newlines.
      const blocks = buf.split('\n\n');
      buf = blocks.pop() ?? '';

      for (const block of blocks) {
        const lines = block.split('\n');
        let eventType = '';
        let dataStr = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) eventType = line.slice(7).trim();
          else if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
        }
        if (!dataStr) continue;

        if (eventType === 'content_block_delta') {
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.delta?.type === 'text_delta') {
              onChunk?.(parsed.delta.text);
            }
          } catch { /* malformed delta — skip */ }
        } else if (eventType === 'message_stop') {
          onDone?.();
          return;
        }
      }
    }
  } catch (e) {
    if (e.stalled) { reader.cancel().catch(() => {}); onError?.(new Error('The story stopped generating — please try again')); return; }
    if (e.name !== 'AbortError') onError?.(e);
    else if (!signal?.aborted) onError?.(new Error('Connection timed out — please try again'));
    return;
  }

  onDone?.();
}

/*
 * Client-side helper for streaming AI biography generation.
 *
 * Calls POST /api/biography and parses the Anthropic SSE format.
 * Relevant events: content_block_delta (text_delta) for text chunks,
 * message_stop to signal completion.
 *
 * Callbacks:
 *   onChunk(text)  — called for each incremental text piece
 *   onDone()       — called when the stream ends cleanly
 *   onError(err)   — called on network / server errors (null on abort)
 */
export async function streamBio(person, { memories = [], relSummary = [] } = {}, { onChunk, onDone, onError, signal } = {}) {
  let res;
  try {
    res = await fetch('/api/biography', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ person, memories, relationships: relSummary }),
      signal,
    });
  } catch (e) {
    onError?.(e.name === 'AbortError' ? null : e);
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
      const { value, done } = await reader.read();
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
    if (e.name !== 'AbortError') onError?.(e);
    return;
  }

  onDone?.();
}

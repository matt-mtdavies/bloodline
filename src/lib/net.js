/*
 * fetch() has no built-in timeout — a stalled connection (a flaky network,
 * a Worker that hangs, a dropped response with no error and no data) leaves
 * `await fetch(...)` unresolved forever. Real user report: the app
 * "freezes" during a save or while generating an AI story, unrecoverable
 * short of a hard refresh — traced to exactly this. The tree-sync loop
 * (store.js) and the AI-generation calls (lib/ai.js, KeepsakeView.jsx,
 * AncestryStory.jsx) all already have real retry/error-handling logic —
 * every one of them is just keyed off the fetch promise actually settling,
 * which a genuinely stalled connection never does on its own.
 *
 * A thin wrapper, not a redesign: races the real fetch against a timer, so
 * a stall becomes an ordinary rejected promise — exactly what every
 * existing try/catch downstream already handles. Combines any
 * caller-supplied AbortSignal with an internal one, so a manual abort (e.g.
 * a component cancelling a stale request on unmount) and a timeout produce
 * the identical outcome.
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const externalSignal = options.signal;
  if (externalSignal) {
    if (externalSignal.aborted) ac.abort();
    else externalSignal.addEventListener('abort', () => ac.abort(), { once: true });
  }
  try {
    return await fetch(url, { ...options, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

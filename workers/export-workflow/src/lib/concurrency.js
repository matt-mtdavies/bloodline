/*
 * A tiny bounded-concurrency mapper — no dependencies, Workers-safe (no
 * Node built-ins). Used by the Workflow's inventory-resolution step to
 * honor §7's "≤100 metadata operations/step, concurrency 10": each shard is
 * ≤100 references, resolved with at most `limit` R2 head()/list() calls in
 * flight at once, rather than either serializing all 100 (slow) or firing
 * all 100 simultaneously (an unbounded burst against R2).
 */
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    for (;;) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

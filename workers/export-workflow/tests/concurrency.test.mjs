import assert from 'node:assert/strict';
import { mapWithConcurrency } from '../src/lib/concurrency.js';

let passed = 0, failed = 0;
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

await atest('results preserve input order regardless of completion order', async () => {
  const items = [30, 10, 20, 5, 25];
  const results = await mapWithConcurrency(items, 3, (ms) => new Promise((r) => setTimeout(() => r(ms), ms)));
  assert.deepEqual(results, items);
});

await atest('never runs more than `limit` callbacks concurrently', async () => {
  let inFlight = 0, maxInFlight = 0;
  await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
  });
  assert.ok(maxInFlight <= 4, `max in-flight was ${maxInFlight}, expected <= 4`);
});

await atest('an empty array resolves to an empty array with no callback invocations', async () => {
  let calls = 0;
  const results = await mapWithConcurrency([], 5, () => { calls++; });
  assert.deepEqual(results, []);
  assert.equal(calls, 0);
});

await atest('a limit larger than the item count still works (one worker per item)', async () => {
  const results = await mapWithConcurrency([1, 2, 3], 100, (x) => x * 2);
  assert.deepEqual(results, [2, 4, 6]);
});

await atest('a rejection from one callback propagates out of mapWithConcurrency', async () => {
  await assert.rejects(() => mapWithConcurrency([1, 2, 3], 2, async (x) => {
    if (x === 2) throw new Error('boom');
    return x;
  }), /boom/);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

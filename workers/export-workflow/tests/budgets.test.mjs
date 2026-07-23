import assert from 'node:assert/strict';
import { BUDGETS, assertWithinByteBudget, assertWithinCountBudget, shardByBudget, BudgetExceededError } from '../src/lib/budgets.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

test('a step result well within budget does not throw', () => {
  assert.doesNotThrow(() => assertWithinByteBudget('step result', { ok: true }, BUDGETS.stepResult));
});

test('a step result exceeding the hard max throws BudgetExceededError', () => {
  const big = 'x'.repeat(BUDGETS.stepResult.maxBytes + 1);
  assert.throws(() => assertWithinByteBudget('step result', big, BUDGETS.stepResult), BudgetExceededError);
});

test('a Uint8Array is measured by its own byteLength, not re-serialized', () => {
  const buf = new Uint8Array(BUDGETS.multipartPart.defaultBytes + 1);
  assert.throws(() => assertWithinByteBudget('part', buf, { maxBytes: BUDGETS.multipartPart.defaultBytes }));
});

test('a budget with no maxBytes defined never throws (target-only budgets)', () => {
  assert.doesNotThrow(() => assertWithinByteBudget('d1 row', 'x'.repeat(100000), BUDGETS.d1JobRow));
});

test('count budget passes under the limit and throws over it', () => {
  assert.doesNotThrow(() => assertWithinCountBudget('inventory shard', 500, BUDGETS.inventoryShard));
  assert.throws(() => assertWithinCountBudget('inventory shard', 501, BUDGETS.inventoryShard), BudgetExceededError);
});

test('r2 head-ops budget enforces maxCalls', () => {
  assert.throws(() => assertWithinCountBudget('r2 head calls', 101, BUDGETS.r2HeadOpsPerStep, 'maxCalls'));
});

// ── shardByBudget ────────────────────────────────────────────────────────

test('shardByBudget splits strictly on entry count', () => {
  const items = Array.from({ length: 1250 }, (_, i) => ({ i }));
  const shards = shardByBudget(items, { maxEntries: 500, maxBytes: Infinity });
  assert.equal(shards.length, 3);
  assert.equal(shards[0].length, 500);
  assert.equal(shards[1].length, 500);
  assert.equal(shards[2].length, 250);
});

test('shardByBudget splits on byte size when entries are large', () => {
  const bigString = 'x'.repeat(1000);
  const items = Array.from({ length: 100 }, () => ({ blob: bigString }));
  const shards = shardByBudget(items, { maxEntries: 100000, maxBytes: 5000 });
  assert.ok(shards.length > 1, 'expected more than one shard when byte budget is small');
  for (const shard of shards) {
    const size = JSON.stringify(shard).length;
    assert.ok(size <= 5000 + 1100, `shard of ${shard.length} items serialized to ${size} bytes, expected roughly <= 5000`);
  }
});

test('shardByBudget never drops or duplicates an item', () => {
  const items = Array.from({ length: 733 }, (_, i) => ({ id: `item_${i}` }));
  const shards = shardByBudget(items, { maxEntries: 47, maxBytes: 10000 });
  const flat = shards.flat();
  assert.equal(flat.length, items.length);
  assert.deepEqual(flat.map((x) => x.id), items.map((x) => x.id));
});

test('a single item exceeding the byte budget on its own throws, rather than being emitted in an over-budget shard', () => {
  const huge = { blob: 'x'.repeat(20000) };
  const items = [{ id: 'a' }, huge, { id: 'b' }];
  assert.throws(() => shardByBudget(items, { maxEntries: 500, maxBytes: 5000 }), BudgetExceededError);
});

test('shardByBudget never produces a shard whose serialized size exceeds maxBytes, for any item at or under the budget', () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ id: `item_${i}`, blob: 'x'.repeat(200) }));
  const maxBytes = 3000;
  const shards = shardByBudget(items, { maxEntries: 500, maxBytes });
  for (const shard of shards) {
    assert.ok(JSON.stringify(shard).length <= maxBytes, `shard of ${shard.length} items serialized to ${JSON.stringify(shard).length} bytes, over the ${maxBytes} budget`);
  }
});

test('shardByBudget on an empty array returns no shards', () => {
  assert.deepEqual(shardByBudget([], { maxEntries: 10, maxBytes: 1000 }), []);
});

// ── budget values themselves stay internally consistent ────────────────

test('the segmented-export threshold (2.5) leaves headroom under R2\'s real multipart part-count ceiling', () => {
  assert.ok(BUDGETS.r2MultipartLimits.maxParts >= 10000);
});

test('the default multipart part size respects R2/S3\'s real minimum non-final part size', () => {
  assert.ok(BUDGETS.multipartPart.defaultBytes >= BUDGETS.r2MultipartLimits.minPartBytes);
  assert.ok(BUDGETS.multipartPart.maxBytesAfterSpike >= BUDGETS.multipartPart.defaultBytes);
});

test('the in-memory binary buffer target is bounded by one part plus writer overhead', () => {
  assert.equal(
    BUDGETS.inMemoryBinaryBuffer.targetBytes,
    BUDGETS.multipartPart.defaultBytes + BUDGETS.inMemoryBinaryBuffer.zipWriterOverheadBytes,
  );
});

test('the packaging CPU safety ceiling matches a real paid-plan Workers cpu_ms limit (300000ms)', () => {
  assert.equal(BUDGETS.packagingStepCpu.safetyCeilingMs, 300000);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

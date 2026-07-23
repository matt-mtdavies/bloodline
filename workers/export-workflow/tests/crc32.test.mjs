import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { crc32Of, createIncrementalCrc32 } from '../src/lib/crc32.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

test('crc32Of matches node:zlib.crc32 for a simple string', () => {
  const bytes = Buffer.from('hello family');
  assert.equal(crc32Of(bytes), zlib.crc32(bytes));
});

test('crc32Of of an empty buffer matches zlib (0)', () => {
  assert.equal(crc32Of(new Uint8Array(0)), zlib.crc32(Buffer.alloc(0)));
});

test('crc32Of matches zlib across binary (non-text) data', () => {
  const bytes = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 37) % 256));
  assert.equal(crc32Of(bytes), zlib.crc32(bytes));
});

test('createIncrementalCrc32 chunked matches crc32Of of the whole buffer', () => {
  const data = Buffer.from(Array.from({ length: 10007 }, (_, i) => i % 256));
  const chunked = createIncrementalCrc32();
  for (let i = 0; i < data.length; i += 61) chunked.update(data.subarray(i, i + 61));
  assert.equal(chunked.crc32(), crc32Of(data));
  assert.equal(chunked.crc32(), zlib.crc32(data));
});

test('crc32 is order-sensitive', () => {
  const a = createIncrementalCrc32(); a.update(Buffer.from('ab')); a.update(Buffer.from('cd'));
  const b = createIncrementalCrc32(); b.update(Buffer.from('cd')); b.update(Buffer.from('ab'));
  assert.notEqual(a.crc32(), b.crc32());
});

test('crc32 fits in an unsigned 32-bit range', () => {
  const v = crc32Of(Buffer.from('x'.repeat(100000)));
  assert.ok(v >= 0 && v <= 0xffffffff);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

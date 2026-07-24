/*
 * Unit tests for the independent EOCD/central-directory reader
 * (src/lib/zipVerify.js) used by verifyArchiveStep to structurally
 * validate an archive via bounded range reads — proving both the plain
 * (small-archive) EOCD path and the ZIP64 EOCD+locator path, including the
 * "the ZIP64 EOCD record itself sits outside the tail window" case, all
 * against real archives built by the actual ZipStreamWriter, never
 * hand-rolled byte fixtures that might not match what the writer really
 * produces.
 */
import assert from 'node:assert/strict';
import { ZipStreamWriter, concatBuffers } from '../src/lib/zipWriter.js';
import { parseEocdTail, parseCentralDirectory } from '../src/lib/zipVerify.js';

let passed = 0, failed = 0;
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}\n${e.stack?.split('\n').slice(1, 3).join('\n')}`); }
}

async function writeZip(entries, writerOpts = {}) {
  const chunks = [];
  const writer = new ZipStreamWriter({ onChunk: async (b) => { chunks.push(b); }, ...writerOpts });
  for (const e of entries) {
    const data = e.data instanceof Uint8Array ? e.data : new TextEncoder().encode(e.data);
    await writer.addEntry(e.path, [data], { uncompressedSizeHint: data.byteLength, compress: e.compress });
  }
  await writer.finish();
  return concatBuffers(chunks);
}

// Simulates a bounded R2 range read against an in-memory archive buffer —
// exactly the shape workflowSteps.js#verifyArchiveStep's real rangeGetBytes
// helper produces, so these tests exercise the parser the same way
// production code will call it.
function tail(archive, suffixLength) {
  const len = Math.min(suffixLength, archive.byteLength);
  return { bytes: archive.subarray(archive.byteLength - len), offset: archive.byteLength - len };
}
function range(archive, offset, length) {
  return archive.subarray(offset, offset + length);
}

// ── plain EOCD (small archive, no ZIP64) ────────────────────────────────

await atest('parseEocdTail + parseCentralDirectory reconstruct a small, non-ZIP64 archive exactly', async () => {
  const archive = await writeZip([
    { path: 'a.txt', data: 'hello' },
    { path: 'b.txt', data: 'world!!' },
  ]);
  const { bytes, offset } = tail(archive, 4096);
  const eocd = parseEocdTail(bytes, offset);
  assert.equal(eocd.entryCount, 2);
  assert.equal(eocd.needsMoreTail, undefined);

  const cdBytes = range(archive, Number(eocd.cdStart), Number(eocd.cdSize));
  const entries = parseCentralDirectory(cdBytes, eocd.entryCount);
  assert.deepEqual(entries.map((e) => e.path), ['a.txt', 'b.txt']);
  assert.equal(Number(entries[0].uncompressedSize), 5);
  assert.equal(Number(entries[1].uncompressedSize), 7);
});

await atest('parseEocdTail throws a clear error when the tail window contains no EOCD signature at all (corrupt/truncated archive)', async () => {
  const garbage = new Uint8Array(100).fill(0x41);
  assert.throws(() => parseEocdTail(garbage, 0), /EOCD signature not found/);
});

await atest('parseCentralDirectory throws when an expected entry signature does not match (corrupt/truncated central directory)', async () => {
  const archive = await writeZip([{ path: 'a.txt', data: 'hello' }]);
  const { bytes, offset } = tail(archive, 4096);
  const eocd = parseEocdTail(bytes, offset);
  const cdBytes = range(archive, Number(eocd.cdStart), Number(eocd.cdSize));
  cdBytes[0] = 0x00; // corrupt the first central directory record's signature
  assert.throws(() => parseCentralDirectory(cdBytes, eocd.entryCount), /bad signature/);
});

// ── ZIP64 EOCD + locator path ────────────────────────────────────────────

await atest('parseEocdTail + parseCentralDirectory correctly read the ZIP64 EOCD/locator path, including real ZIP64 sizes from the central directory extra field', async () => {
  // A tiny zip64Threshold forces every entry (and the EOCD itself) through
  // the ZIP64 branch — the same technique zipWriter.test.mjs's own tests
  // already use to prove ZIP64 encoding without multi-gigabyte fixtures.
  const archive = await writeZip(
    [
      { path: 'a.txt', data: 'hello world' },
      { path: 'b.txt', data: 'a much longer entry body, forced through zip64' },
    ],
    { zip64Threshold: 5 },
  );
  const { bytes, offset } = tail(archive, 4096);
  const eocd = parseEocdTail(bytes, offset);
  assert.equal(eocd.entryCount, 2);

  const cdBytes = range(archive, Number(eocd.cdStart), Number(eocd.cdSize));
  const entries = parseCentralDirectory(cdBytes, eocd.entryCount);
  assert.deepEqual(entries.map((e) => e.path), ['a.txt', 'b.txt']);
  assert.equal(Number(entries[0].uncompressedSize), 'hello world'.length);
  assert.equal(Number(entries[1].uncompressedSize), 'a much longer entry body, forced through zip64'.length);
});

await atest('parseEocdTail throws a clear, actionable error when the supplied tail window is too small to contain the ZIP64 trailer (a caller sizing bug, not a property of archive size — see MAX_TRAILER_BYTES)', async () => {
  const archive = await writeZip(
    [
      { path: 'a.txt', data: 'hello world' },
      { path: 'b.txt', data: 'a second entry, also forced through zip64' },
    ],
    { zip64Threshold: 5 },
  );
  // Deliberately request a tail window too small to contain the ZIP64 EOCD
  // record (56 bytes) + locator (20 bytes) + EOCD (22 bytes) = 98 bytes.
  const tinyWindow = 40;
  const { bytes, offset } = tail(archive, tinyWindow);
  assert.throws(() => parseEocdTail(bytes, offset), /tail window may be too small/);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

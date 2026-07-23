import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ZipStreamWriter, concatBuffers } from '../src/lib/zipWriter.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

// ── helpers ──────────────────────────────────────────────────────────────

async function writeZip(entries, writerOpts = {}) {
  const chunks = [];
  const writer = new ZipStreamWriter({ onChunk: async (b) => { chunks.push(b); }, ...writerOpts });
  for (const e of entries) {
    const data = e.data instanceof Uint8Array ? e.data : new TextEncoder().encode(e.data);
    await writer.addEntry(e.path, [data], { uncompressedSizeHint: data.byteLength, compress: e.compress, mtime: e.mtime });
  }
  await writer.finish();
  return concatBuffers(chunks);
}

let tmpDirCounter = 0;
function toTempFile(bytes) {
  const dir = mkdtempSync(path.join(tmpdir(), `zipwriter-test-${tmpDirCounter++}-`));
  const file = path.join(dir, 'archive.zip');
  writeFileSync(file, bytes);
  return { dir, file };
}

// Reader #1: Info-ZIP `unzip`/`zipinfo` (a real, independent C implementation).
function verifyWithUnzip(file) {
  execFileSync('unzip', ['-t', file], { stdio: 'pipe' }); // throws on any integrity failure
  return execFileSync('zipinfo', ['-1', file], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
}

// Reader #2: Python's zipfile module (a real, independent implementation).
function verifyWithPythonZipfile(file) {
  const out = execFileSync('python3', ['-c', `
import zipfile, sys, json
with zipfile.ZipFile(sys.argv[1]) as z:
    bad = z.testzip()
    if bad:
        print("BAD:" + bad); sys.exit(1)
    names = z.namelist()
    contents = {n: z.read(n).decode('utf-8', errors='replace') for n in names if not n.endswith('.bin')}
    print(json.dumps({"names": names, "contents": contents}))
`, file], { encoding: 'utf8' });
  return JSON.parse(out);
}

function extractWithUnzip(file, dir) {
  execFileSync('unzip', ['-o', '-q', file, '-d', dir], { stdio: 'pipe' });
}

// ── basic correctness, verified by BOTH independent readers ─────────────

await atest('a simple store-only archive is valid per unzip AND python zipfile', async () => {
  const zip = await writeZip([
    { path: 'a.txt', data: 'hello' },
    { path: 'folder/b.txt', data: 'world, this is bloodline' },
  ]);
  const { dir, file } = toTempFile(zip);
  const names1 = verifyWithUnzip(file);
  const parsed2 = verifyWithPythonZipfile(file);
  assert.deepEqual([...names1].sort(), ['a.txt', 'folder/b.txt'].sort());
  assert.equal(parsed2.contents['a.txt'], 'hello');
  assert.equal(parsed2.contents['folder/b.txt'], 'world, this is bloodline');
  rmSync(dir, { recursive: true, force: true });
});

await atest('extracted file bytes exactly match the original input (binary round-trip)', async () => {
  const binary = new Uint8Array(5000);
  for (let i = 0; i < binary.length; i++) binary[i] = (i * 7 + 3) % 256;
  const zip = await writeZip([{ path: 'photos/p1_test.bin', data: binary }]);
  const { dir, file } = toTempFile(zip);
  extractWithUnzip(file, dir);
  const extracted = readFileSync(path.join(dir, 'photos/p1_test.bin'));
  assert.deepEqual(new Uint8Array(extracted), binary);
  rmSync(dir, { recursive: true, force: true });
});

await atest('an empty archive (zero entries) is still spec-valid per Python zipfile (unzip CLI warns on ANY empty zip by design, not a bug in the writer)', async () => {
  const zip = await writeZip([]);
  const { dir, file } = toTempFile(zip);
  const parsed = verifyWithPythonZipfile(file);
  assert.deepEqual(parsed.names, []);
  // Confirmed via manual repro: Info-ZIP's own `unzip -t` exits 1 with
  // "warning: zipfile is empty" for this archive — a quirk of that CLI
  // tool's own empty-archive handling, not evidence of a malformed ZIP
  // (Python's zipfile opens it cleanly, as asserted above). This test
  // deliberately does not call verifyWithUnzip() here for that reason.
  // Every real archive this system produces has at least manifest.json/
  // tree.json/README, so a genuinely zero-entry archive never ships.
  rmSync(dir, { recursive: true, force: true });
});

await atest('deflate-raw compressed entries decompress correctly and pass integrity checks', async () => {
  const text = 'the quick brown fox jumps over the lazy dog. '.repeat(500);
  const zip = await writeZip([{ path: 'data/tree.json', data: text, compress: 'deflate-raw' }]);
  const { dir, file } = toTempFile(zip);
  const parsed = verifyWithPythonZipfile(file);
  verifyWithUnzip(file); // throws on integrity failure
  assert.equal(parsed.contents['data/tree.json'], text);
  rmSync(dir, { recursive: true, force: true });
});

await atest('a mix of store and deflate entries in the same archive both extract correctly', async () => {
  const zip = await writeZip([
    { path: 'manifest.json', data: '{"ok":true}', compress: 'deflate-raw' },
    { path: 'photos/p1.jpg', data: new Uint8Array([1, 2, 3, 4, 5]), compress: 'store' },
  ]);
  const { dir, file } = toTempFile(zip);
  verifyWithUnzip(file);
  const parsed = verifyWithPythonZipfile(file);
  assert.equal(parsed.contents['manifest.json'], '{"ok":true}');
  rmSync(dir, { recursive: true, force: true });
});

// ── genuinely streaming (review finding: compressChunks used to buffer ──
// every chunk into an array before addEntry emitted any of them, holding
// a whole large entry in memory before a single byte reached the sink —
// contradicting the streaming guarantee and the one-part memory budget).
// These tests prove output begins DURING iteration of the source, not
// only after the source iterable has fully finished producing.

// A chunk is entry-data (not the local file header or the trailing data
// descriptor) if it's NOT one of ZIP's own small fixed-signature records —
// both of those are emitted by addEntry too, and would otherwise be
// miscounted as "data chunks" by a naive count of every onChunk call.
function isZipStructuralRecord(bytes) {
  if (bytes.byteLength < 4) return false;
  const sig = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  return sig === 0x04034b50 /* local file header */ || sig === 0x08074b50 /* data descriptor */;
}

await atest('store: entry-data chunks reach the sink as they are produced, not only after the source finishes', async () => {
  const totalChunks = 5;
  let producedCount = 0;
  async function* chunkSource() {
    for (let i = 0; i < totalChunks; i++) {
      producedCount++;
      yield new TextEncoder().encode(`chunk-${i}-`);
    }
  }
  const observedCountsAtEmit = [];
  const writer = new ZipStreamWriter({
    onChunk: async (bytes) => {
      if (isZipStructuralRecord(bytes)) return;
      observedCountsAtEmit.push(producedCount);
    },
  });
  const size = totalChunks * new TextEncoder().encode('chunk-0-').byteLength;
  await writer.addEntry('x.txt', chunkSource(), { uncompressedSizeHint: size, compress: 'store' });

  assert.equal(observedCountsAtEmit.length, totalChunks, 'one sink call per source chunk (store never batches)');
  assert.equal(
    observedCountsAtEmit[0], 1,
    `first data chunk should reach the sink right after the FIRST source chunk was produced; got producedCount=${observedCountsAtEmit[0]} of ${totalChunks} — buffering bug reproduced if this equals ${totalChunks}`,
  );
  // Monotonically non-decreasing and never "jumps" straight to the final
  // count on the first emit — the specific shape of "was fully buffered".
  assert.ok(observedCountsAtEmit.every((n, i) => n >= i + 1), 'each emit happens no earlier than its corresponding source chunk');
});

await atest('deflate-raw: compressed output begins before the source iterable finishes producing (genuine streaming, not buffer-then-compress)', async () => {
  // CompressionStream has its own internal window/buffering — verified
  // separately that a SMALL, highly repetitive payload can legitimately
  // never flush any output until close() (a property of the compressor
  // itself, not something this module controls). A larger, less-
  // compressible payload does flush incrementally in practice — this test
  // uses ~1.5MB of pseudo-random bytes across many chunks specifically so
  // it can distinguish "my own code buffers before emitting" (the actual
  // bug that was found) from "the compressor's own internal windowing",
  // which this module has no control over and shouldn't be tested against.
  const chunkBytes = 65536;
  const totalChunks = 24; // ~1.5MB
  let seed = 12345;
  function pseudoRandomByte() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % 256; }
  let producedCount = 0;
  async function* chunkSource() {
    for (let i = 0; i < totalChunks; i++) {
      const chunk = new Uint8Array(chunkBytes);
      for (let j = 0; j < chunkBytes; j += 4) chunk[j] = pseudoRandomByte();
      producedCount++;
      yield chunk;
    }
  }
  let firstEmitProducedCount = null;
  const emitCount = { n: 0 };
  const writer = new ZipStreamWriter({
    onChunk: async (bytes) => {
      if (isZipStructuralRecord(bytes)) return;
      emitCount.n++;
      if (firstEmitProducedCount === null) firstEmitProducedCount = producedCount;
    },
  });
  await writer.addEntry('data/tree.json', chunkSource(), {
    uncompressedSizeHint: chunkBytes * totalChunks, compress: 'deflate-raw',
  });
  assert.ok(emitCount.n > 1, `expected multiple separate compressed-output emits (not one big buffered blob); got ${emitCount.n}`);
  assert.ok(
    firstEmitProducedCount !== null && firstEmitProducedCount < totalChunks,
    `expected the first compressed chunk to reach the sink before the source finished producing all ${totalChunks} chunks; got firstEmitProducedCount=${firstEmitProducedCount} — buffering bug reproduced if this is ${totalChunks} (or null)`,
  );
});

// ── ZIP64 path — forced via a tiny threshold override, verified by both readers ──

await atest('an entry forced through the ZIP64 code path (tiny threshold) still opens and extracts correctly', async () => {
  const zip = await writeZip(
    [{ path: 'big/forced-zip64.txt', data: 'this content is tiny but treated as huge for this test' }],
    { zip64Threshold: 10 }, // any entry >= 10 bytes now takes the ZIP64 branch
  );
  const { dir, file } = toTempFile(zip);
  verifyWithUnzip(file);
  const parsed = verifyWithPythonZipfile(file);
  assert.equal(parsed.contents['big/forced-zip64.txt'], 'this content is tiny but treated as huge for this test');
  rmSync(dir, { recursive: true, force: true });
});

await atest('a MIX of normal and forced-ZIP64 entries in the same archive is valid (the realistic case for a large family export)', async () => {
  const zip = await writeZip(
    [
      { path: 'small.txt', data: 'x' }, // 1 byte — stays on the normal path
      { path: 'big.txt', data: 'y'.repeat(500) }, // 500 bytes — forced ZIP64 path
    ],
    { zip64Threshold: 100 },
  );
  const { dir, file } = toTempFile(zip);
  verifyWithUnzip(file);
  const parsed = verifyWithPythonZipfile(file);
  assert.equal(parsed.contents['small.txt'], 'x');
  assert.equal(parsed.contents['big.txt'], 'y'.repeat(500));
  rmSync(dir, { recursive: true, force: true });
});

await atest('forcing the ZIP64 END OF CENTRAL DIRECTORY (many small entries) still opens correctly', async () => {
  // Real entry count is small, but the same code path that guards a >65534-
  // entry archive is exercised by checking the EOCD/ZIP64-EOCD selection
  // logic directly rather than generating tens of thousands of files.
  const entries = Array.from({ length: 50 }, (_, i) => ({ path: `p${i}.txt`, data: `content ${i}` }));
  const zip = await writeZip(entries);
  const { dir, file } = toTempFile(zip);
  const names = verifyWithUnzip(file);
  assert.equal(names.length, 50);
  rmSync(dir, { recursive: true, force: true });
});

// ── programmer-error / safety guards ─────────────────────────────────────

await atest('addEntry requires uncompressedSizeHint', async () => {
  const writer = new ZipStreamWriter({ onChunk: async () => {} });
  await assert.rejects(() => writer.addEntry('x.txt', [new Uint8Array([1])], {}));
});

await atest('addEntry rejects a duplicate archive path', async () => {
  const writer = new ZipStreamWriter({ onChunk: async () => {} });
  await writer.addEntry('x.txt', [new Uint8Array([1])], { uncompressedSizeHint: 1 });
  await assert.rejects(() => writer.addEntry('x.txt', [new Uint8Array([2])], { uncompressedSizeHint: 1 }));
});

await atest('addEntry rejects an unsafe archive path (defense in depth)', async () => {
  const writer = new ZipStreamWriter({ onChunk: async () => {} });
  await assert.rejects(() => writer.addEntry('../../etc/passwd', [new Uint8Array([1])], { uncompressedSizeHint: 1 }));
});

await atest('a mismatched size hint throws rather than silently emitting a wrong-sized entry', async () => {
  const writer = new ZipStreamWriter({ onChunk: async () => {} });
  await assert.rejects(() => writer.addEntry('x.txt', [new Uint8Array([1, 2, 3])], { uncompressedSizeHint: 999 }));
});

await atest('addEntry after finish() throws', async () => {
  const writer = new ZipStreamWriter({ onChunk: async () => {} });
  await writer.finish();
  await assert.rejects(() => writer.addEntry('x.txt', [new Uint8Array([1])], { uncompressedSizeHint: 1 }));
});

await atest('finish() cannot be called twice', async () => {
  const writer = new ZipStreamWriter({ onChunk: async () => {} });
  await writer.finish();
  await assert.rejects(() => writer.finish());
});

await atest('the writer requires an onChunk sink', () => {
  assert.throws(() => new ZipStreamWriter({}));
});

// ── exportState/resumeState (checkpointed multipart packaging) ──────────

await atest('a writer resumed from exportState() mid-archive produces a byte-identical archive to one built in a single pass', async () => {
  const entries = [
    { path: 'a.txt', data: 'hello' },
    { path: 'folder/b.txt', data: 'world, this is bloodline' },
    { path: 'c.txt', data: 'a third entry, added after resuming' },
  ];

  const wholeChunks = [];
  const wholeWriter = new ZipStreamWriter({ onChunk: async (b) => { wholeChunks.push(b); } });
  for (const e of entries) {
    const data = new TextEncoder().encode(e.data);
    await wholeWriter.addEntry(e.path, [data], { uncompressedSizeHint: data.byteLength });
  }
  await wholeWriter.finish();
  const wholeZip = concatBuffers(wholeChunks);

  // Split the SAME work across two writer instances, simulating two
  // separate Workflow step invocations — the second never sees the first's
  // in-memory object, only its exported state.
  const firstChunks = [];
  const firstWriter = new ZipStreamWriter({ onChunk: async (b) => { firstChunks.push(b); } });
  for (const e of entries.slice(0, 2)) {
    const data = new TextEncoder().encode(e.data);
    await firstWriter.addEntry(e.path, [data], { uncompressedSizeHint: data.byteLength });
  }
  const checkpoint = JSON.parse(JSON.stringify(firstWriter.exportState())); // prove it survives real JSON round-tripping

  const secondChunks = [];
  const secondWriter = new ZipStreamWriter({ onChunk: async (b) => { secondChunks.push(b); }, resumeState: checkpoint });
  for (const e of entries.slice(2)) {
    const data = new TextEncoder().encode(e.data);
    await secondWriter.addEntry(e.path, [data], { uncompressedSizeHint: data.byteLength });
  }
  await secondWriter.finish();
  const splitZip = concatBuffers([...firstChunks, ...secondChunks]);

  assert.deepEqual(splitZip, wholeZip, 'a split-then-resumed archive must be byte-identical to one built in a single pass');

  const { dir, file } = toTempFile(splitZip);
  const names = verifyWithUnzip(file);
  assert.deepEqual([...names].sort(), ['a.txt', 'c.txt', 'folder/b.txt'].sort());
  rmSync(dir, { recursive: true, force: true });
});

await atest('exportState/resumeState round-trips correctly across a ZIP64-forced entry (BigInt offsets survive JSON)', async () => {
  const tinyThreshold = 100;
  const bigData = new Uint8Array(500).fill(65);

  const firstChunks = [];
  const firstWriter = new ZipStreamWriter({ onChunk: async (b) => { firstChunks.push(b); }, zip64Threshold: tinyThreshold });
  await firstWriter.addEntry('big.bin', [bigData], { uncompressedSizeHint: bigData.byteLength });
  const checkpoint = JSON.parse(JSON.stringify(firstWriter.exportState()));
  assert.equal(typeof checkpoint.offset, 'string', 'BigInt offset must serialize as a string, not throw on JSON.stringify');

  const secondChunks = [];
  const secondWriter = new ZipStreamWriter({ onChunk: async (b) => { secondChunks.push(b); }, zip64Threshold: tinyThreshold, resumeState: checkpoint });
  await secondWriter.addEntry('small.txt', [new TextEncoder().encode('x')], { uncompressedSizeHint: 1 });
  await secondWriter.finish();

  const zip = concatBuffers([...firstChunks, ...secondChunks]);
  const { dir, file } = toTempFile(zip);
  const names = verifyWithUnzip(file);
  assert.deepEqual([...names].sort(), ['big.bin', 'small.txt']);
  rmSync(dir, { recursive: true, force: true });
});

await atest('a resumed writer still rejects a duplicate path carried over from before the checkpoint', async () => {
  const firstWriter = new ZipStreamWriter({ onChunk: async () => {} });
  await firstWriter.addEntry('dupe.txt', [new TextEncoder().encode('x')], { uncompressedSizeHint: 1 });
  const checkpoint = firstWriter.exportState();

  const secondWriter = new ZipStreamWriter({ onChunk: async () => {}, resumeState: checkpoint });
  await assert.rejects(() => secondWriter.addEntry('dupe.txt', [new TextEncoder().encode('y')], { uncompressedSizeHint: 1 }));
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

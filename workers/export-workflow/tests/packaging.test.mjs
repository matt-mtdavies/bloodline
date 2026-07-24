import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  buildArchivePlan, projectArchiveBytes, assertNotOverSegmentedExportBoundary,
  PartAccumulator, runPackagingStep,
} from '../src/lib/packaging.js';
import { BUDGETS } from '../src/lib/budgets.js';

function sha256Of(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

let passed = 0, failed = 0;
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}\n${e.stack?.split('\n').slice(1, 3).join('\n')}`); }
}
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

function toTempFile(bytes) {
  const dir = mkdtempSync(path.join(tmpdir(), 'packaging-test-'));
  const file = path.join(dir, 'archive.zip');
  writeFileSync(file, bytes);
  return { dir, file };
}
function verifyWithUnzip(file) {
  execFileSync('unzip', ['-t', file], { stdio: 'pipe' });
  return execFileSync('zipinfo', ['-1', file], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
}

// ── buildArchivePlan ─────────────────────────────────────────────────────

test('buildArchivePlan sorts fixed + media + keepsake entries into one lexical list', () => {
  const plan = buildArchivePlan({
    fixedFiles: [{ path: 'manifest.json', byteLength: 100 }, { path: 'tree.json', byteLength: 50 }],
    mediaEntries: [{ path: 'photos/aaa.jpg', id: 'p1', status: 'included', byteLength: 10 }],
    keepsakeEntries: [{ path: 'keepsakes/p1/abc.json', id: 'p1:abc', status: 'included', byteLength: 20 }],
  });
  assert.deepEqual(plan.map((p) => p.path), ['keepsakes/p1/abc.json', 'manifest.json', 'photos/aaa.jpg', 'tree.json']);
});

test('buildArchivePlan appends manifestFile LAST, regardless of where its path would otherwise sort lexically — the PR #9 re-review finding that manifest.json needs the full ledger before it can be finalized', () => {
  const plan = buildArchivePlan({
    fixedFiles: [{ path: 'tree.json', byteLength: 50 }],
    mediaEntries: [{ path: 'photos/aaa.jpg', id: 'p1', status: 'included', byteLength: 10 }],
    keepsakeEntries: [{ path: 'keepsakes/p1/abc.json', id: 'p1:abc', status: 'included', byteLength: 20 }],
    manifestFile: { path: 'manifest.json', byteLength: 100, compress: 'deflate-raw' },
  });
  // 'manifest.json' would normally sort BEFORE 'photos/...' and 'tree.json'
  // alphabetically — it must instead be forced to the very end.
  assert.deepEqual(plan.map((p) => p.path), ['keepsakes/p1/abc.json', 'photos/aaa.jpg', 'tree.json', 'manifest.json']);
  assert.equal(plan[plan.length - 1].kind, 'manifest');
});

test('buildArchivePlan drops non-included media/keepsake entries entirely (they still appear in the manifest, just not as archive bytes)', () => {
  const plan = buildArchivePlan({
    mediaEntries: [
      { path: 'photos/a.jpg', id: 'a', status: 'included', byteLength: 10 },
      { path: 'photos/b.jpg', id: 'b', status: 'missing' },
      { path: 'photos/c.jpg', id: 'c', status: 'unreadable' },
    ],
  });
  assert.deepEqual(plan.map((p) => p.id), ['a']);
});

// ── projected size / segmented-export guard ─────────────────────────────

test('projectArchiveBytes grows with entry count and byte size', () => {
  const small = buildArchivePlan({ mediaEntries: [{ path: 'a.jpg', id: 'a', status: 'included', byteLength: 100 }] });
  const big = buildArchivePlan({ mediaEntries: [{ path: 'a.jpg', id: 'a', status: 'included', byteLength: 100_000_000 }] });
  assert.ok(projectArchiveBytes(big) > projectArchiveBytes(small));
});

test('assertNotOverSegmentedExportBoundary passes for a normal-sized archive', () => {
  const plan = buildArchivePlan({ mediaEntries: [{ path: 'a.jpg', id: 'a', status: 'included', byteLength: 5_000_000 }] });
  assert.doesNotThrow(() => assertNotOverSegmentedExportBoundary(plan));
});

test('assertNotOverSegmentedExportBoundary throws requires_segmented_export once projected parts cross the threshold', () => {
  // 9,500 parts * 16 MiB default part size ~= 152,000 MiB of entries.
  const plan = buildArchivePlan({
    mediaEntries: Array.from({ length: 20 }, (_, i) => ({ path: `photos/${i}.jpg`, id: `p${i}`, status: 'included', byteLength: 10 * 1024 * 1024 * 1024 })),
  });
  assert.throws(() => assertNotOverSegmentedExportBoundary(plan), (e) => e.code === 'requires_segmented_export');
});

test('assertNotOverSegmentedExportBoundary also throws on the byte ceiling even if part count alone would not trigger (a hypothetical much-larger part size)', () => {
  const plan = buildArchivePlan({ mediaEntries: [{ path: 'huge.bin', id: 'h', status: 'included', byteLength: BUDGETS.segmentedExport.maxProjectedBytes + 1 }] });
  assert.throws(() => assertNotOverSegmentedExportBoundary(plan, { partBytes: BUDGETS.segmentedExport.maxProjectedBytes }), (e) => e.code === 'requires_segmented_export');
});

// ── PartAccumulator ──────────────────────────────────────────────────────

await atest('PartAccumulator flushes a part exactly once the target size is reached, never before', async () => {
  const uploads = [];
  const acc = new PartAccumulator({ uploadPart: async (n, bytes) => { uploads.push({ n, size: bytes.byteLength }); return { etag: `"etag-${n}"` }; }, targetPartBytes: 100 });
  await acc.onChunk(new Uint8Array(60));
  assert.equal(uploads.length, 0, 'must not flush before reaching the target');
  await acc.onChunk(new Uint8Array(50));
  assert.equal(uploads.length, 1, 'must flush once the target is crossed');
  assert.equal(uploads[0].size, 110);
  assert.equal(acc.partNumber, 2);
});

await atest('PartAccumulator.flushFinal uploads a trailing under-sized buffer (the real last-part rule)', async () => {
  const uploads = [];
  const acc = new PartAccumulator({ uploadPart: async (n, bytes) => { uploads.push(bytes.byteLength); return { etag: `"e${n}"` }; }, targetPartBytes: 1000 });
  await acc.onChunk(new Uint8Array(10));
  await acc.flushFinal();
  assert.deepEqual(uploads, [10]);
});

await atest('PartAccumulator.flushFinal is a no-op if there is nothing buffered', async () => {
  let calls = 0;
  const acc = new PartAccumulator({ uploadPart: async () => { calls++; return { etag: '"x"' }; }, targetPartBytes: 1000 });
  await acc.flushFinal();
  assert.equal(calls, 0);
});

// ── runPackagingStep: end-to-end against a fake uploader/byte source ────

function fakeUploader() {
  const parts = new Map();
  return {
    parts,
    uploadPart: async (n, bytes) => { parts.set(n, bytes); return { etag: `"etag-${n}"` }; },
  };
}
function getEntryBytesFromMap(byteMap) {
  return async (entry) => [byteMap.get(entry.path)];
}

await atest('runPackagingStep processes a small plan to completion in one call and produces a valid ZIP', async () => {
  const treeBytes = new TextEncoder().encode('{"people":[1,2,3]}');
  const plan = buildArchivePlan({
    fixedFiles: [{ path: 'tree.json', byteLength: treeBytes.byteLength }],
    mediaEntries: [{ path: 'photos/p1.jpg', id: 'p1', status: 'included', byteLength: 4 }],
  });
  const byteMap = new Map([
    ['tree.json', treeBytes],
    ['photos/p1.jpg', new Uint8Array([1, 2, 3, 4])],
  ]);
  const { uploadPart, parts } = fakeUploader();
  const result = await runPackagingStep({
    plan, startIndex: 0, resumeState: null, uploadPart, getEntryBytes: getEntryBytesFromMap(byteMap),
    targetPartBytes: 1_000_000,
  });
  assert.equal(result.done, true);
  assert.equal(result.nextIndex, 2);
  assert.equal(result.uploadedParts.length, 1, 'a tiny archive fits in exactly one final part');

  const zipBytes = parts.get(1);
  const { dir, file } = toTempFile(zipBytes);
  const names = verifyWithUnzip(file);
  assert.deepEqual([...names].sort(), ['photos/p1.jpg', 'tree.json']);
  rmSync(dir, { recursive: true, force: true });
});

await atest('runPackagingStep checkpoints after maxEntriesPerStep and resumes correctly across two calls, producing a byte-identical archive to one pass', async () => {
  const plan = buildArchivePlan({
    mediaEntries: [
      { path: 'a.txt', id: 'a', status: 'included', byteLength: 1 },
      { path: 'b.txt', id: 'b', status: 'included', byteLength: 1 },
      { path: 'c.txt', id: 'c', status: 'included', byteLength: 1 },
    ],
  });
  const byteMap = new Map([['a.txt', new Uint8Array([97])], ['b.txt', new Uint8Array([98])], ['c.txt', new Uint8Array([99])]]);
  const getEntryBytes = getEntryBytesFromMap(byteMap);

  const { uploadPart, parts } = fakeUploader();
  const first = await runPackagingStep({
    plan, startIndex: 0, resumeState: null, uploadPart, getEntryBytes,
    maxEntriesPerStep: 2, targetPartBytes: 1_000_000,
  });
  assert.equal(first.done, false);
  assert.equal(first.nextIndex, 2);
  assert.equal(first.uploadedParts.length, 0, 'no part flushed yet — well under the target size');
  assert.ok(first.pendingBytes && first.pendingBytes.byteLength > 0, 'the two entries already written must travel forward as pending bytes, not be lost');

  const second = await runPackagingStep({
    plan, startIndex: first.nextIndex, resumeState: first.writerState, uploadPart, getEntryBytes,
    maxEntriesPerStep: 2, targetPartBytes: 1_000_000, startPartNumber: first.nextPartNumber,
    initialPendingBytes: first.pendingBytes,
  });
  assert.equal(second.done, true);
  assert.equal(second.uploadedParts.length, 1);

  const zipBytes = parts.get(second.uploadedParts[0].partNumber);
  const { dir, file } = toTempFile(zipBytes);
  const names = verifyWithUnzip(file);
  assert.deepEqual([...names].sort(), ['a.txt', 'b.txt', 'c.txt']);
  rmSync(dir, { recursive: true, force: true });
});

await atest('runPackagingStep builds a real per-entry SHA-256 packaging ledger, correct and threaded across checkpoints — the PR #9 review finding that createIncrementalSha256 existed but was never wired in', async () => {
  const plan = buildArchivePlan({
    mediaEntries: [
      { path: 'a.txt', id: 'a', status: 'included', byteLength: 1 },
      { path: 'b.txt', id: 'b', status: 'included', byteLength: 1 },
      { path: 'c.txt', id: 'c', status: 'included', byteLength: 1 },
    ],
  });
  const byteMap = new Map([['a.txt', new Uint8Array([97])], ['b.txt', new Uint8Array([98])], ['c.txt', new Uint8Array([99])]]);
  const getEntryBytes = getEntryBytesFromMap(byteMap);
  const { uploadPart } = fakeUploader();

  // Checkpoint after 2 entries, exactly like the resume test above — the
  // ledger for a.txt/b.txt must survive into the second call and come back
  // out WITH c.txt appended, not be dropped or restarted.
  const first = await runPackagingStep({
    plan, startIndex: 0, resumeState: null, uploadPart, getEntryBytes,
    maxEntriesPerStep: 2, targetPartBytes: 1_000_000,
  });
  assert.equal(first.ledger.length, 2);
  assert.deepEqual(first.ledger.map((r) => r.path), ['a.txt', 'b.txt']);
  assert.equal(first.ledger[0].byteLength, 1);
  assert.equal(first.ledger[0].sha256, sha256Of(new Uint8Array([97])), 'the ledger sha256 must be the real hash of the actual bytes streamed');

  const second = await runPackagingStep({
    plan, startIndex: first.nextIndex, resumeState: first.writerState, uploadPart, getEntryBytes,
    maxEntriesPerStep: 2, targetPartBytes: 1_000_000, startPartNumber: first.nextPartNumber,
    initialPendingBytes: first.pendingBytes, resumeLedger: first.ledger,
  });
  assert.equal(second.done, true);
  assert.equal(second.ledger.length, 3, 'the ledger must carry forward across the checkpoint, not restart');
  assert.deepEqual(second.ledger.map((r) => r.path), ['a.txt', 'b.txt', 'c.txt']);
  assert.equal(second.ledger[2].sha256, sha256Of(new Uint8Array([99])));
});

await atest('runPackagingStep flushes a real part mid-archive once the accumulated bytes cross the target, then stops adding more entries that same call', async () => {
  const plan = buildArchivePlan({
    mediaEntries: [
      { path: 'a.bin', id: 'a', status: 'included', byteLength: 60 },
      { path: 'b.bin', id: 'b', status: 'included', byteLength: 60 },
      { path: 'c.bin', id: 'c', status: 'included', byteLength: 1 },
    ],
  });
  const byteMap = new Map([
    ['a.bin', new Uint8Array(60).fill(1)],
    ['b.bin', new Uint8Array(60).fill(2)],
    ['c.bin', new Uint8Array([3])],
  ]);
  const { uploadPart, parts } = fakeUploader();
  const result = await runPackagingStep({
    plan, startIndex: 0, resumeState: null, uploadPart, getEntryBytes: getEntryBytesFromMap(byteMap),
    maxEntriesPerStep: 100, targetPartBytes: 100, // crosses 100 bytes partway through entry b
  });
  assert.equal(result.done, false, 'must stop once a part has flushed, not race ahead to the last entry');
  // a.bin alone (local header + 60 bytes + data descriptor) already crosses
  // the 100-byte target on its own, so the flush happens after JUST a.bin —
  // b.bin is never even started this call.
  assert.equal(result.nextIndex, 1, 'only a.bin was added before its own overhead crossed the target');
  assert.equal(result.uploadedParts.length, 1);
  assert.ok(parts.get(1).byteLength >= 100);
  assert.equal(result.pendingBytes, null, 'nothing left over — the flush already happened this call');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

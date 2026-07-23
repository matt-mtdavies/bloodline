import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  sha256Hex, createIncrementalSha256, canonicalJSONStringify, buildManifest, computeManifestChecksum,
} from '../src/lib/manifest.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

// ── sha256Hex / incremental hashing ─────────────────────────────────────

test('sha256Hex matches node:crypto\'s own one-shot digest (sanity/oracle check)', () => {
  const expected = createHash('sha256').update('hello family').digest('hex');
  assert.equal(sha256Hex('hello family'), expected);
});

test('sha256Hex hashes a Uint8Array without re-encoding it as text', () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 250, 251]);
  const expected = createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha256Hex(bytes), expected);
});

test('createIncrementalSha256 chunked equals sha256Hex of the whole value', () => {
  const whole = 'x'.repeat(50000) + 'y'.repeat(50000);
  const hasher = createIncrementalSha256();
  hasher.update(Buffer.from('x'.repeat(50000)));
  hasher.update(Buffer.from('y'.repeat(50000)));
  assert.equal(hasher.digestHex(), sha256Hex(whole));
});

test('createIncrementalSha256 is order-sensitive (chunk order matters)', () => {
  const h1 = createIncrementalSha256();
  h1.update(Buffer.from('ab'));
  h1.update(Buffer.from('cd'));
  const h2 = createIncrementalSha256();
  h2.update(Buffer.from('cd'));
  h2.update(Buffer.from('ab'));
  assert.notEqual(h1.digestHex(), h2.digestHex());
});

test('createIncrementalSha256 with many small chunks equals one big chunk', () => {
  const data = Buffer.from(Array.from({ length: 10000 }, (_, i) => i % 256));
  const oneShot = createIncrementalSha256();
  oneShot.update(data);
  const chunked = createIncrementalSha256();
  for (let i = 0; i < data.length; i += 37) chunked.update(data.subarray(i, i + 37));
  assert.equal(chunked.digestHex(), oneShot.digestHex());
});

// ── canonicalJSONStringify ───────────────────────────────────────────────

test('canonical stringify is independent of object key insertion order', () => {
  const a = { b: 1, a: 2, c: { z: 1, y: 2 } };
  const b = { a: 2, c: { y: 2, z: 1 }, b: 1 };
  assert.equal(canonicalJSONStringify(a), canonicalJSONStringify(b));
});

test('canonical stringify preserves array element order (order is meaningful)', () => {
  const a = { files: [{ path: 'b' }, { path: 'a' }] };
  const out = canonicalJSONStringify(a);
  assert.ok(out.indexOf('"b"') < out.indexOf('"a"'), 'array order must not be reordered');
});

// ── buildManifest ─────────────────────────────────────────────────────────

function baseArgs(overrides = {}) {
  return {
    jobId: 'exp_abc123',
    family: { id: 'fam_1', name: 'Example Family' },
    createdAt: '2026-07-23T00:00:00.000Z',
    source: { treeUpdatedAt: 1234567890, storageMode: 'split', extraVersion: 4 },
    requestedAs: 'owner',
    status: 'complete',
    counts: { people: 10 },
    totalBytes: 12345,
    files: [
      { path: 'photos/ph_b_beta.jpg', id: 'ph_b', status: 'included' },
      { path: 'photos/ph_a_alpha.jpg', id: 'ph_a', status: 'included' },
    ],
    warnings: [],
    ...overrides,
  };
}

test('buildManifest fills required top-level fields per §3.9', () => {
  const m = buildManifest(baseArgs());
  assert.equal(m.archiveFormat, 'bloodline-full-archive');
  assert.equal(m.archiveVersion, 1);
  assert.equal(m.viewerVersion, 1);
  assert.equal(m.jobId, 'exp_abc123');
  assert.equal(m.family.id, 'fam_1');
  assert.equal(m.requestedAs, 'owner');
  assert.equal(m.status, 'complete');
});

test('buildManifest sorts files into lexical path order regardless of input order', () => {
  const m = buildManifest(baseArgs());
  assert.deepEqual(m.files.map((f) => f.path), ['photos/ph_a_alpha.jpg', 'photos/ph_b_beta.jpg']);
});

test('buildManifest throws on missing required fields rather than silently omitting them', () => {
  assert.throws(() => buildManifest({ ...baseArgs(), jobId: undefined }));
  assert.throws(() => buildManifest({ ...baseArgs(), family: undefined }));
  assert.throws(() => buildManifest({ ...baseArgs(), status: undefined }));
});

test('buildManifest defaults source.storageMode to legacy when omitted', () => {
  const m = buildManifest({ ...baseArgs(), source: undefined });
  assert.equal(m.source.storageMode, 'legacy');
});

test('buildManifest accepts requestedAs of owner, coadmin, or site_admin', () => {
  for (const requestedAs of ['owner', 'coadmin', 'site_admin']) {
    const m = buildManifest({ ...baseArgs(), requestedAs });
    assert.equal(m.requestedAs, requestedAs);
  }
});

// ── computeManifestChecksum / determinism (§12.5 acceptance #8) ─────────

test('computeManifestChecksum is deterministic for logically identical manifests built in different key order', () => {
  const m1 = buildManifest(baseArgs());
  const m2 = buildManifest(baseArgs({
    files: [
      { id: 'ph_a', path: 'photos/ph_a_alpha.jpg', status: 'included' },
      { status: 'included', id: 'ph_b', path: 'photos/ph_b_beta.jpg' },
    ],
  }));
  assert.equal(computeManifestChecksum(m1), computeManifestChecksum(m2));
});

test('computeManifestChecksum differs when actual content differs', () => {
  const m1 = buildManifest(baseArgs());
  const m2 = buildManifest(baseArgs({ totalBytes: 99999 }));
  assert.notEqual(computeManifestChecksum(m1), computeManifestChecksum(m2));
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

import assert from 'node:assert/strict';
import { buildFamilyRecord } from '../src/lib/familyRecord.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

test('buildFamilyRecord requires familyId/generatedAt/requestedAs', () => {
  assert.throws(() => buildFamilyRecord({ generatedAt: 'x', requestedAs: 'owner' }));
  assert.throws(() => buildFamilyRecord({ familyId: 'f', requestedAs: 'owner' }));
  assert.throws(() => buildFamilyRecord({ familyId: 'f', generatedAt: 'x' }));
});

test('buildFamilyRecord fills in every §3.4 field, with sensible defaults for missing optional data', () => {
  const rec = buildFamilyRecord({
    familyId: 'fam_1', familyName: 'The Mercers', familyCreatedAt: 1000,
    source: { treeUpdatedAt: 2000, storageMode: 'split', extraVersion: 3 },
    generatedAt: '2026-01-01T00:00:00.000Z', requestedAs: 'owner',
  });
  assert.deepEqual(rec, {
    familyId: 'fam_1',
    familyName: 'The Mercers',
    familyCreatedAt: 1000,
    source: { treeUpdatedAt: 2000, storageMode: 'split', extraVersion: 3 },
    generatedAt: '2026-01-01T00:00:00.000Z',
    requestedAs: 'owner',
    archiveFormat: 'bloodline-full-archive',
    archiveVersion: 1,
  });
});

test('buildFamilyRecord defaults familyName to empty string and source fields to legacy/null when omitted', () => {
  const rec = buildFamilyRecord({ familyId: 'fam_1', generatedAt: 'x', requestedAs: 'coadmin' });
  assert.equal(rec.familyName, '');
  assert.equal(rec.familyCreatedAt, null);
  assert.deepEqual(rec.source, { treeUpdatedAt: null, storageMode: 'legacy', extraVersion: null });
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

/**
 * Unit tests for functions/_lib/invite.js's processInvite — shared by the
 * OTP verify flow and the direct accept endpoint. Rewritten in docs/TREE-
 * STORAGE.md Phase 1 to read/write family_tree through treeStore.js instead
 * of its own inline SQL — this suite exists specifically to prove the
 * merge-wizard gate and the member_joined activity-append still behave
 * exactly as before through the shared module.
 * Run with: node tests/invite-process.test.mjs
 */
import assert from 'node:assert/strict';
import { processInvite } from '../functions/_lib/invite.js';
import { writeExtraToR2 } from '../functions/_lib/treeStore.js';

let passed = 0, failed = 0;
async function test(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}\n${e.stack?.split('\n').slice(1, 3).join('\n')}`); }
}

function fakeR2({ getShouldThrow = false } = {}) {
  const store = new Map();
  return {
    store,
    async get(key) {
      if (getShouldThrow) throw new Error('simulated R2 outage');
      if (!store.has(key)) return null;
      const val = store.get(key);
      return { json: async () => JSON.parse(val), text: async () => val };
    },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list({ prefix }) {
      return { objects: [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
}

function makeFakeDB({ inviteRow, otherFamilyId = null, existingMember = false, familyTrees = {}, joinerRow = { email: 'j@example.com', display_name: 'Jo' }, updateThrows = false }) {
  const calls = [];
  function stmt(sql) {
    let args = [];
    const s = {
      bind(...a) { args = a; return s; },
      async first() {
        calls.push({ type: 'first', sql, args });
        if (/FROM invite WHERE token/.test(sql)) return inviteRow;
        if (/fm\.family_id\s+FROM family_member fm\s+WHERE fm\.user_id = \? AND fm\.family_id != \?/.test(sql)) {
          return otherFamilyId ? { family_id: otherFamilyId } : null;
        }
        if (/FROM family_tree WHERE family_id/.test(sql)) {
          const fam = args[0];
          return familyTrees[fam] ? { tree_json: familyTrees[fam], updated_at: 1000 } : null;
        }
        if (/SELECT user_id FROM family_member WHERE family_id = \? AND user_id/.test(sql)) {
          return existingMember ? { user_id: args[1] } : null;
        }
        if (/FROM user WHERE id/.test(sql)) return joinerRow;
        return null;
      },
      async run() {
        calls.push({ type: 'run', sql, args });
        if (updateThrows && /^\s*UPDATE family_tree SET tree_json/i.test(sql)) {
          throw new Error('simulated D1 write failure');
        }
        return { success: true, meta: { changes: 1 } };
      },
    };
    return s;
  }
  return { calls, prepare: (sql) => stmt(sql) };
}

const now = Math.floor(Date.now() / 1000);
const PENDING = { id: 'inv1', family_id: 'fam1', from_user: 'owner1', role: 'editor', status: 'pending', expires_at: now + 3600, person_id: 'p_target' };

await test('an invalid/expired/missing invite returns null with no writes', async () => {
  for (const bad of [null, { ...PENDING, status: 'accepted' }, { ...PENDING, expires_at: now - 1 }]) {
    const db = makeFakeDB({ inviteRow: bad });
    const result = await processInvite({ DB: db }, 'tok', 'u1', now);
    assert.equal(result, null);
    assert.ok(!db.calls.some((c) => c.type === 'run'), 'no writes should happen for an invalid invite');
  }
});

await test('an invitee with a DIFFERENT family that has real tree data needs the merge wizard', async () => {
  const db = makeFakeDB({
    inviteRow: PENDING,
    otherFamilyId: 'fam_other',
    familyTrees: { fam_other: JSON.stringify({ people: [{ id: 'x' }] }) },
  });
  const result = await processInvite({ DB: db }, 'tok', 'u1', now);
  assert.deepEqual(result, { needsMerge: true, token: 'tok' });
  assert.ok(!db.calls.some((c) => c.type === 'run'), 'nothing should be written while deferring to the merge wizard');
});

await test('an invitee whose OTHER family tree is empty (or corrupt) proceeds to a normal join, not the merge wizard', async () => {
  const db = makeFakeDB({
    inviteRow: PENDING,
    otherFamilyId: 'fam_other',
    familyTrees: { fam_other: JSON.stringify({ people: [] }) }, // empty — no real data to protect
  });
  const result = await processInvite({ DB: db }, 'tok', 'u1', now);
  assert.notEqual(result?.needsMerge, true);
  assert.deepEqual(result, { personId: 'p_target' });
});

await test('a normal join inserts family_member, appends a member_joined activity event via treeStore, and accepts the invite', async () => {
  const db = makeFakeDB({
    inviteRow: PENDING,
    familyTrees: { fam1: JSON.stringify({ people: [], activity: [{ id: 'old1' }] }) },
  });
  const result = await processInvite({ DB: db }, 'tok', 'u1', now);
  assert.deepEqual(result, { personId: 'p_target' });

  assert.ok(db.calls.some((c) => c.type === 'run' && /INSERT INTO family_member/.test(c.sql)));
  const treeUpdate = db.calls.find((c) => c.type === 'run' && /UPDATE family_tree SET tree_json/.test(c.sql));
  assert.ok(treeUpdate, 'the member_joined event should be written through treeStore\'s updateTree');
  const written = JSON.parse(treeUpdate.args[0]);
  assert.equal(written.activity[0].type, 'member_joined');
  assert.equal(written.activity[0].authorName, 'Jo');
  assert.equal(written.activity[0].detail, 'editor');
  assert.deepEqual(written.activity.slice(1), [{ id: 'old1' }], 'prior activity is preserved, new event prepended');

  assert.ok(db.calls.some((c) => c.type === 'run' && /UPDATE user SET family_id/.test(c.sql)));
  assert.ok(db.calls.some((c) => c.type === 'run' && /UPDATE invite SET status = 'accepted'/.test(c.sql)));
});

await test('an already-existing member gets their role updated, and no activity event is appended (matches the original branch structure)', async () => {
  const db = makeFakeDB({ inviteRow: PENDING, existingMember: true, familyTrees: { fam1: JSON.stringify({ people: [] }) } });
  const result = await processInvite({ DB: db }, 'tok', 'u1', now);
  assert.deepEqual(result, { personId: 'p_target' });
  assert.ok(db.calls.some((c) => c.type === 'run' && /UPDATE family_member SET role/.test(c.sql)));
  assert.ok(!db.calls.some((c) => c.type === 'run' && /INSERT INTO family_member/.test(c.sql)));
  assert.ok(!db.calls.some((c) => c.type === 'run' && /UPDATE family_tree SET tree_json/.test(c.sql)),
    'no activity event should be appended when the user was already a member');
});

await test('the join still succeeds even if there is no family_tree row yet for the target family', async () => {
  const db = makeFakeDB({ inviteRow: PENDING, familyTrees: {} }); // no row for fam1
  const result = await processInvite({ DB: db }, 'tok', 'u1', now);
  assert.deepEqual(result, { personId: 'p_target' });
  assert.ok(db.calls.some((c) => c.type === 'run' && /UPDATE invite SET status = 'accepted'/.test(c.sql)));
});

await test('a failure writing the activity event is non-fatal — the join still succeeds', async () => {
  const db = makeFakeDB({
    inviteRow: PENDING,
    familyTrees: { fam1: JSON.stringify({ people: [] }) },
    updateThrows: true,
  });
  const result = await processInvite({ DB: db }, 'tok', 'u1', now);
  assert.deepEqual(result, { personId: 'p_target' });
  assert.ok(db.calls.some((c) => c.type === 'run' && /UPDATE invite SET status = 'accepted'/.test(c.sql)),
    'the join must complete even though the activity event failed to write');
});

// ── Migrated-family join (docs/TREE-STORAGE.md Phase 2 — the member_joined
// activity-append must not silently orphan a migrated family's R2 extra) ──

await test('joining a migrated family re-splits and writes R2 before D1, preserving the extra-owned activity history', async () => {
  const r2 = fakeR2();
  const migratedCoreJson = await writeExtraToR2({ DOCS: r2 }, 'fam1', {
    people: [{ id: 'p1', bio: 'Existing bio.' }], relationships: [],
    activity: [{ id: 'old1' }], memories: [{ id: 'm1' }],
  }, 42);
  const db = makeFakeDB({ inviteRow: PENDING, familyTrees: { fam1: migratedCoreJson } });

  const result = await processInvite({ DB: db, DOCS: r2 }, 'tok', 'u1', now);
  assert.deepEqual(result, { personId: 'p_target' });

  const treeUpdate = db.calls.find((c) => c.type === 'run' && /UPDATE family_tree SET tree_json/.test(c.sql));
  assert.ok(treeUpdate, 'the migrated family\'s core row should still be updated');
  const storedCore = JSON.parse(treeUpdate.args[0]);
  assert.ok(!('bio' in (storedCore.people?.[0] || {})), 'core must not carry rich person detail');
  assert.ok(!('memories' in storedCore), 'core must not carry extra-owned collections');
  assert.ok(storedCore._extraVersion, 'a migrated family must stay migrated after this write');

  const newExtraObj = await r2.get(`tree-extra/fam1/${storedCore._extraVersion}.json`);
  const newExtra = await newExtraObj.json();
  assert.equal(newExtra.peopleDetail.p1.bio, 'Existing bio.', 'existing rich detail must survive the round trip, not be dropped');
  assert.equal(newExtra.activity[0].type, 'member_joined');
  assert.deepEqual(newExtra.activity.slice(1), [{ id: 'old1' }], 'prior activity is preserved, new event prepended');
  assert.deepEqual(newExtra.memories, [{ id: 'm1' }], 'other extra-owned collections must survive untouched');
});

await test('a migrated family whose extra is unreadable skips the activity event, but the join still succeeds (non-fatal, same as any other activity-write failure)', async () => {
  const r2 = fakeR2();
  const migratedCoreJson = await writeExtraToR2({ DOCS: r2 }, 'fam1', { people: [], relationships: [] }, 99);
  r2.store.delete('tree-extra/fam1/99.json'); // simulate the object having vanished
  const db = makeFakeDB({ inviteRow: PENDING, familyTrees: { fam1: migratedCoreJson } });

  const result = await processInvite({ DB: db, DOCS: r2 }, 'tok', 'u1', now);
  assert.deepEqual(result, { personId: 'p_target' }, 'the join itself must still succeed');
  assert.ok(!db.calls.some((c) => c.type === 'run' && /UPDATE family_tree SET tree_json/.test(c.sql)),
    'must not write a core-only blob missing _extraVersion over a migrated family\'s row when its extra can\'t be verified complete');
  assert.ok(db.calls.some((c) => c.type === 'run' && /UPDATE invite SET status = 'accepted'/.test(c.sql)));
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

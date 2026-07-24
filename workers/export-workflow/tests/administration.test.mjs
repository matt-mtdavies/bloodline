import assert from 'node:assert/strict';
import { buildMembersRecord, buildInvitationsRecord } from '../src/lib/administration.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

test('buildMembersRecord shapes member identity, role, and joined timestamp per §3.4', () => {
  const rows = [{ user_id: 'u1', email: 'a@test.example', role: 'owner', invited_by: null, joined_at: 1000 }];
  assert.deepEqual(buildMembersRecord(rows), [{ userId: 'u1', email: 'a@test.example', role: 'owner', invitedBy: null, joinedAt: 1000 }]);
});

test('buildMembersRecord handles an empty/undefined list', () => {
  assert.deepEqual(buildMembersRecord([]), []);
  assert.deepEqual(buildMembersRecord(undefined), []);
});

test('buildInvitationsRecord strips the token/from_user/target_person_id — only address, role, status, timestamps survive', () => {
  const rows = [{
    id: 'inv1', from_user: 'u1', target_person_id: 'p9', email: 'b@test.example',
    token: 'super-secret-token', role: 'viewer', status: 'pending', expires_at: 5000, created_at: 4000,
  }];
  const shaped = buildInvitationsRecord(rows);
  assert.deepEqual(shaped, [{ id: 'inv1', email: 'b@test.example', role: 'viewer', status: 'pending', expiresAt: 5000, createdAt: 4000 }]);
  assert.ok(!('token' in shaped[0]), 'the raw invite token must never appear in an exported archive');
  assert.ok(!('from_user' in shaped[0]) && !('target_person_id' in shaped[0]));
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

/**
 * Authorization regression tests for /api/family/members. Member-management
 * controls are a convenience only; this route is the authority boundary.
 * Run with: node tests/family-members-auth.test.mjs
 */
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/family/members.js';

let passed = 0;
async function test(label, fn) {
  await fn();
  passed++;
  console.log(`PASS  ${label}`);
}

function request(body) {
  return { json: async () => body };
}

function fakeDb({ callerRole, targetRole }) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      let args = [];
      const statement = {
        bind(...values) { args = values; return statement; },
        async first() {
          calls.push({ type: 'first', sql, args });
          if (/WHERE user_id = \?$/.test(sql)) return { family_id: 'family-1', role: callerRole };
          if (/WHERE family_id = \? AND user_id = \?/.test(sql)) return targetRole ? { role: targetRole } : null;
          return null;
        },
        async run() {
          calls.push({ type: 'run', sql, args });
          return { success: true, meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };
}

await test('a co-admin cannot demote a fellow co-admin', async () => {
  const db = fakeDb({ callerRole: 'coadmin', targetRole: 'coadmin' });
  const res = await onRequestPost({
    request: request({ action: 'update-role', userId: 'peer', role: 'editor' }),
    env: { DB: db }, data: { user: { uid: 'caller' } },
  });
  assert.equal(res.status, 403);
  assert.ok(!db.calls.some((call) => call.type === 'run'), 'forbidden request must not write');
});

await test('only the owner can change a co-admin role', async () => {
  const db = fakeDb({ callerRole: 'owner', targetRole: 'coadmin' });
  const res = await onRequestPost({
    request: request({ action: 'update-role', userId: 'coadmin', role: 'editor' }),
    env: { DB: db }, data: { user: { uid: 'owner' } },
  });
  assert.equal(res.status, 200);
  assert.ok(db.calls.some((call) => call.type === 'run' && /UPDATE family_member SET role/.test(call.sql)));
});

await test('the owner role cannot be changed through this endpoint', async () => {
  const db = fakeDb({ callerRole: 'owner', targetRole: 'owner' });
  const res = await onRequestPost({
    request: request({ action: 'update-role', userId: 'owner', role: 'coadmin' }),
    env: { DB: db }, data: { user: { uid: 'owner' } },
  });
  assert.equal(res.status, 403);
  assert.ok(!db.calls.some((call) => call.type === 'run'), 'owner membership must remain unchanged');
});

console.log(`\n${passed} family-member authorization tests passed`);

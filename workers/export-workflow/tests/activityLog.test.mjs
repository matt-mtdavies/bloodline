import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  buildActivityLogPageQuery, captureUpperBound, extractActivityLog, ActivityLogUnavailableError,
} from '../src/lib/activityLog.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

// Real SQLite (node:sqlite), schema matching migrations/0008_activity_log.sql
// exactly — these tests run the ACTUAL generated SQL, not a hand-rolled
// mirror of it, so a real syntax or logic bug in the query itself would
// surface here rather than being invisibly agreed-with by a fake twin.
function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE activity_log (
      id           TEXT PRIMARY KEY,
      family_id    TEXT NOT NULL,
      author_name  TEXT,
      author_email TEXT,
      type         TEXT NOT NULL,
      person_id    TEXT,
      person_name  TEXT,
      detail       TEXT,
      created_at   TEXT NOT NULL
    );
  `);
  return db;
}

function queryFnFor(db) {
  return async (sql, params) => {
    const stmt = db.prepare(sql);
    return stmt.all(...params);
  };
}

function insertRow(db, { id, familyId = 'fam_1', createdAt, type = 'person_added' }) {
  db.prepare(
    `INSERT INTO activity_log (id, family_id, author_name, author_email, type, person_id, person_name, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, familyId, 'Test User', 'test@example.test', type, null, null, null, createdAt);
}

// ── buildActivityLogPageQuery (pure query shape) ────────────────────────

test('the first page (no lower cursor) has no lower-bound clause', () => {
  const { sql, params } = buildActivityLogPageQuery({
    familyId: 'fam_1', lowerCursor: null, upperBound: { createdAt: '2026-01-01T00:00:00.000Z', id: 'act_z' }, limit: 500,
  });
  assert.ok(!sql.includes('created_at > ?'), 'first page must not filter on a lower cursor');
  assert.ok(sql.includes('created_at < ? OR'), 'first page must still respect the captured upper bound');
  assert.deepEqual(params, ['fam_1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'act_z', 500]);
});

test('a subsequent page includes both the lower and upper cursor clauses', () => {
  const { sql, params } = buildActivityLogPageQuery({
    familyId: 'fam_1',
    lowerCursor: { createdAt: '2026-01-01T00:00:00.000Z', id: 'act_a' },
    upperBound: { createdAt: '2026-01-02T00:00:00.000Z', id: 'act_z' },
    limit: 500,
  });
  assert.ok(sql.includes('created_at > ?'));
  assert.ok(sql.includes('created_at < ? OR'));
  assert.deepEqual(params, [
    'fam_1',
    '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'act_a',
    '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 'act_z',
    500,
  ]);
});

test('requesting a page size above the budget throws rather than silently clamping', () => {
  assert.throws(() => buildActivityLogPageQuery({ familyId: 'fam_1', lowerCursor: null, upperBound: null, limit: 501 }));
});

// ── against a real in-memory SQLite database ────────────────────────────

await atest('captureUpperBound returns null for a family with zero activity', async () => {
  const db = makeDb();
  const result = await captureUpperBound('fam_empty', queryFnFor(db));
  assert.equal(result, null);
});

await atest('extractActivityLog on zero activity returns an empty array without error', async () => {
  const db = makeDb();
  const rows = await extractActivityLog('fam_empty', queryFnFor(db));
  assert.deepEqual(rows, []);
});

await atest('extractActivityLog returns every row exactly once, in ascending order, across multiple pages', async () => {
  const db = makeDb();
  for (let i = 0; i < 1250; i++) {
    insertRow(db, { id: `act_${String(i).padStart(5, '0')}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() });
  }
  const rows = await extractActivityLog('fam_1', queryFnFor(db), { limit: 500 });
  assert.equal(rows.length, 1250);
  const ids = rows.map((r) => r.id);
  assert.equal(new Set(ids).size, 1250, 'no duplicates across page boundaries');
  const sortedIds = [...ids].sort();
  assert.deepEqual(ids, sortedIds, 'rows arrive in ascending order');
});

await atest('rows with duplicate created_at timestamps are still each returned exactly once (id tiebreak)', async () => {
  const db = makeDb();
  const sameTimestamp = '2026-03-01T12:00:00.000Z';
  for (let i = 0; i < 600; i++) insertRow(db, { id: `act_${String(i).padStart(4, '0')}`, createdAt: sameTimestamp });
  const rows = await extractActivityLog('fam_1', queryFnFor(db), { limit: 500 });
  assert.equal(rows.length, 600);
  assert.equal(new Set(rows.map((r) => r.id)).size, 600);
});

await atest('a row inserted AFTER the upper bound is captured is excluded (a snapshot must not grow mid-export)', async () => {
  const db = makeDb();
  insertRow(db, { id: 'act_1', createdAt: '2026-01-01T00:00:00.000Z' });
  insertRow(db, { id: 'act_2', createdAt: '2026-01-02T00:00:00.000Z' });
  const upperBound = await captureUpperBound('fam_1', queryFnFor(db));

  // Simulate concurrent activity arriving mid-export, after the bound was captured.
  insertRow(db, { id: 'act_3_late', createdAt: '2026-01-03T00:00:00.000Z' });

  const rows = [];
  let lowerCursor = null;
  for (;;) {
    const { sql, params } = buildActivityLogPageQuery({ familyId: 'fam_1', lowerCursor, upperBound, limit: 500 });
    const page = await queryFnFor(db)(sql, params);
    rows.push(...page);
    if (page.length < 500) break;
    const last = page[page.length - 1];
    lowerCursor = { createdAt: last.created_at, id: last.id };
  }
  assert.equal(rows.length, 2, 'the late row must not appear — the bound was fixed before it existed');
  assert.ok(!rows.some((r) => r.id === 'act_3_late'));
});

await atest('extractActivityLog only ever reads the requested family (family scoping)', async () => {
  const db = makeDb();
  insertRow(db, { id: 'act_a', familyId: 'fam_a', createdAt: '2026-01-01T00:00:00.000Z' });
  insertRow(db, { id: 'act_b', familyId: 'fam_b', createdAt: '2026-01-01T00:00:00.000Z' });
  const rows = await extractActivityLog('fam_a', queryFnFor(db));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'act_a');
});

await atest('a missing activity_log table (unmigrated environment) raises ActivityLogUnavailableError, not a silent empty result', async () => {
  const db = new DatabaseSync(':memory:'); // no CREATE TABLE at all
  await assert.rejects(
    () => extractActivityLog('fam_1', queryFnFor(db)),
    ActivityLogUnavailableError,
  );
});

await atest('an unrelated query error is NOT swallowed into ActivityLogUnavailableError', async () => {
  const db = makeDb();
  const throwingQueryFn = async () => { throw new Error('R2-style unrelated failure'); };
  await assert.rejects(
    () => extractActivityLog('fam_1', throwingQueryFn),
    (e) => e.message === 'R2-style unrelated failure' && !(e instanceof ActivityLogUnavailableError),
  );
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

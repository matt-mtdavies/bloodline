/**
 * Unit tests for functions/api/keepsake.js — the Keepsake's narrative engine
 * (docs/KEEPSAKE.md Phase 2). Fakes D1 (membership lookup), R2 (edition
 * storage) and the upstream Anthropic fetch, verifying: editions are stored
 * hash-keyed + as latest.json, edition numbers increment, GET serves the
 * latest, malformed AI output gets exactly one repair retry, and every
 * unconfigured/unauthed path fails clean. Also pins the server's factsHash
 * to the client's (lib/keepsake.js) so staleness detection can never drift.
 * Run with: node tests/keepsake-api.test.mjs
 */
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost, onRequestPut } from '../functions/api/keepsake.js';
import { factsHash as clientFactsHash } from '../src/lib/keepsake.js';

let passed = 0, failed = 0;
async function test(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

// ── Fakes ───────────────────────────────────────────────────────────────────

function fakeDB() {
  return {
    prepare: (sql) => ({
      bind: () => ({
        async first() {
          if (/FROM user WHERE id/.test(sql)) return { family_id: 'fam1' };
          if (/FROM family_member/.test(sql)) return { family_id: 'fam1' };
          return null;
        },
        async run() { return { success: true }; }, // ai_usage_log insert
      }),
    }),
  };
}

function fakeR2() {
  const store = new Map();
  return {
    store,
    async get(key) {
      if (!store.has(key)) return null;
      const val = store.get(key);
      return { json: async () => JSON.parse(val), text: async () => val };
    },
    async put(key, value) { store.set(key, value); },
  };
}

const NARRATIVE = {
  epithet: 'Railwayman and quiet keeper of timetables',
  origins: ['Percy was born in Melbourne in 1923.'],
  chapters: [
    { title: 'Royal Park', years: '1923–1942', paragraphs: ['He grew up near the yards.'] },
    { title: 'The Long Run', years: '1943–1998', paragraphs: ['He enlisted in 1943.', 'He married Verna in 1950.'] },
  ],
  legacy: ['Two children and a grandson carry the line.'],
};

// Queue of fetch responses; each POST attempt consumes one.
let fetchQueue = [];
let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls++;
  const next = fetchQueue.shift() || { ok: true, text: JSON.stringify(NARRATIVE) };
  return {
    ok: next.ok,
    status: next.ok ? 200 : 500,
    json: async () => ({ content: [{ type: 'text', text: next.text }], usage: { input_tokens: 10, output_tokens: 20 } }),
    text: async () => next.text,
  };
};

const FACTS = { subject: { name: 'Percy' }, events: [], family: { children: ['Ken'] } };
const user = { uid: 'u1' };

function postReq(body) {
  return { json: async () => body };
}
function getReq(personId) {
  return { url: `https://x.example/api/keepsake?personId=${personId}` };
}

function env(docs, extra = {}) {
  return { DB: fakeDB(), DOCS: docs, ANTHROPIC_API_KEY: 'k', ...extra };
}

// ── Tests ───────────────────────────────────────────────────────────────────

await test('POST compiles and stores the edition hash-keyed plus latest.json, edition 1', async () => {
  const docs = fakeR2();
  fetchQueue = [{ ok: true, text: JSON.stringify(NARRATIVE) }];
  const res = await onRequestPost({
    request: postReq({ personId: 'percy', facts: FACTS, chapterPlan: ['1923–1942', '1943–1998'], recordCount: 42 }),
    env: env(docs),
    data: { user },
  });
  assert.equal(res.status, 200);
  const body = JSON.parse(await res.text());
  assert.equal(body.editionNumber, 1);
  assert.equal(body.recordCount, 42);
  assert.equal(body.narrative.epithet, NARRATIVE.epithet);
  const hash = body.hash;
  assert.ok(docs.store.has(`keepsake/fam1/percy/${hash}.json`), 'hash-keyed edition stored');
  assert.ok(docs.store.has('keepsake/fam1/percy/latest.json'), 'latest.json stored');
  assert.equal(docs.store.get(`keepsake/fam1/percy/${hash}.json`), docs.store.get('keepsake/fam1/percy/latest.json'));
});

await test('the server hash matches the client factsHash exactly', async () => {
  const docs = fakeR2();
  fetchQueue = [{ ok: true, text: JSON.stringify(NARRATIVE) }];
  const res = await onRequestPost({
    request: postReq({ personId: 'percy', facts: FACTS }),
    env: env(docs),
    data: { user },
  });
  const body = JSON.parse(await res.text());
  assert.equal(body.hash, clientFactsHash(FACTS));
});

await test('a second compile increments the edition number', async () => {
  const docs = fakeR2();
  fetchQueue = [{ ok: true, text: JSON.stringify(NARRATIVE) }, { ok: true, text: JSON.stringify(NARRATIVE) }];
  await onRequestPost({ request: postReq({ personId: 'p', facts: FACTS }), env: env(docs), data: { user } });
  const res2 = await onRequestPost({ request: postReq({ personId: 'p', facts: FACTS }), env: env(docs), data: { user } });
  assert.equal(JSON.parse(await res2.text()).editionNumber, 2);
});

await test('GET returns the latest edition; null when nothing compiled yet', async () => {
  const docs = fakeR2();
  const none = await onRequestGet({ request: getReq('p'), env: env(docs), data: { user } });
  assert.equal(await none.text(), 'null');
  fetchQueue = [{ ok: true, text: JSON.stringify(NARRATIVE) }];
  await onRequestPost({ request: postReq({ personId: 'p', facts: FACTS }), env: env(docs), data: { user } });
  const res = await onRequestGet({ request: getReq('p'), env: env(docs), data: { user } });
  const body = JSON.parse(await res.text());
  assert.equal(body.editionNumber, 1);
  assert.equal(body.narrative.chapters.length, 2);
});

await test('malformed AI output gets exactly one repair retry, then succeeds', async () => {
  const docs = fakeR2();
  fetchQueue = [
    { ok: true, text: 'Here is your JSON: not really' },
    { ok: true, text: '```json\n' + JSON.stringify(NARRATIVE) + '\n```' }, // fenced is fine too
  ];
  fetchCalls = 0;
  const res = await onRequestPost({ request: postReq({ personId: 'p', facts: FACTS }), env: env(docs), data: { user } });
  assert.equal(res.status, 200);
  assert.equal(fetchCalls, 2);
});

await test('persistently malformed output → 502 and nothing stored', async () => {
  const docs = fakeR2();
  fetchQueue = [
    { ok: true, text: 'nope' },
    { ok: true, text: '{"epithet": 42}' }, // parses but fails shape validation
  ];
  const res = await onRequestPost({ request: postReq({ personId: 'p', facts: FACTS }), env: env(docs), data: { user } });
  assert.equal(res.status, 502);
  assert.equal(docs.store.size, 0);
});

await test('a half-shaped narrative (bad chapter) is rejected by validation', async () => {
  const docs = fakeR2();
  const bad = { ...NARRATIVE, chapters: [{ title: 'X' }] }; // no years/paragraphs
  fetchQueue = [{ ok: true, text: JSON.stringify(bad) }, { ok: true, text: JSON.stringify(bad) }];
  const res = await onRequestPost({ request: postReq({ personId: 'p', facts: FACTS }), env: env(docs), data: { user } });
  assert.equal(res.status, 502);
});

await test('unauthed → 401; no DOCS → 503; no API key → 503; bad body → 400', async () => {
  const docs = fakeR2();
  assert.equal((await onRequestPost({ request: postReq({}), env: env(docs), data: {} })).status, 401);
  assert.equal((await onRequestGet({ request: getReq('p'), env: env(docs), data: {} })).status, 401);
  assert.equal((await onRequestPost({ request: postReq({ personId: 'p', facts: FACTS }), env: { DB: fakeDB(), ANTHROPIC_API_KEY: 'k' }, data: { user } })).status, 503);
  assert.equal((await onRequestPost({ request: postReq({ personId: 'p', facts: FACTS }), env: { DB: fakeDB(), DOCS: docs }, data: { user } })).status, 503);
  assert.equal((await onRequestPost({ request: postReq({ facts: FACTS }), env: env(docs), data: { user } })).status, 400);
});

await test('PUT revises the narrative in place: same edition number + hash, revisedAt set, both keys rewritten', async () => {
  const docs = fakeR2();
  fetchQueue = [{ ok: true, text: JSON.stringify(NARRATIVE) }];
  await onRequestPost({ request: postReq({ personId: 'p', facts: FACTS }), env: env(docs), data: { user } });
  const revised = { ...NARRATIVE, epithet: 'The one who kept the trains on time' };
  const res = await onRequestPut({
    request: postReq({ personId: 'p', narrative: revised }),
    env: env(docs),
    data: { user },
  });
  assert.equal(res.status, 200);
  const body = JSON.parse(await res.text());
  assert.equal(body.editionNumber, 1, 'edition number unchanged — the facts did not change');
  assert.equal(body.hash, clientFactsHash(FACTS), 'hash unchanged');
  assert.equal(body.narrative.epithet, revised.epithet);
  assert.ok(body.revisedAt, 'revisedAt stamped');
  const latest = JSON.parse(docs.store.get('keepsake/fam1/p/latest.json'));
  assert.equal(latest.narrative.epithet, revised.epithet, 'latest.json rewritten');
  const hashKeyed = JSON.parse(docs.store.get(`keepsake/fam1/p/${body.hash}.json`));
  assert.equal(hashKeyed.narrative.epithet, revised.epithet, 'hash-keyed edition rewritten');
});

await test('PUT with no compiled edition → 404, nothing stored', async () => {
  const docs = fakeR2();
  const res = await onRequestPut({
    request: postReq({ personId: 'p', narrative: NARRATIVE }),
    env: env(docs),
    data: { user },
  });
  assert.equal(res.status, 404);
  assert.equal(docs.store.size, 0);
});

await test('PUT validates the narrative shape exactly like an AI edition', async () => {
  const docs = fakeR2();
  fetchQueue = [{ ok: true, text: JSON.stringify(NARRATIVE) }];
  await onRequestPost({ request: postReq({ personId: 'p', facts: FACTS }), env: env(docs), data: { user } });
  const cases = [
    { personId: 'p', narrative: { ...NARRATIVE, epithet: '' } },              // empty epithet
    { personId: 'p', narrative: { ...NARRATIVE, origins: 'not an array' } },  // wrong type
    { personId: 'p', narrative: { ...NARRATIVE, chapters: [{ title: 'X' }] } }, // half chapter
    { narrative: NARRATIVE },                                                  // no personId
    { personId: 'p' },                                                         // no narrative
  ];
  for (const body of cases) {
    const res = await onRequestPut({ request: postReq(body), env: env(docs), data: { user } });
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body).slice(0, 60)}`);
  }
});

await test('PUT unauthed → 401; no DOCS → 503', async () => {
  const docs = fakeR2();
  assert.equal((await onRequestPut({ request: postReq({ personId: 'p', narrative: NARRATIVE }), env: env(docs), data: {} })).status, 401);
  assert.equal((await onRequestPut({ request: postReq({ personId: 'p', narrative: NARRATIVE }), env: { DB: fakeDB() }, data: { user } })).status, 503);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

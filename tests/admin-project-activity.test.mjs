import assert from 'node:assert/strict';
import { onRequestGet, _test } from '../functions/api/admin/project-activity.js';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`PASS  ${name}`); }
  catch (error) { failed++; console.error(`FAIL  ${name}\n      ${error.stack || error.message}`); }
}

const admin = { email: 'admin@example.test' };

await test('requires an authenticated site administrator', async () => {
  const unauthorized = await onRequestGet({ env: { ADMIN_EMAILS: admin.email }, data: { user: null } });
  assert.equal(unauthorized.status, 401);
  const forbidden = await onRequestGet({ env: { ADMIN_EMAILS: admin.email }, data: { user: { email: 'member@example.test' } } });
  assert.equal(forbidden.status, 403);
});

await test('classifies human-readable type and area, with structured labels taking priority', () => {
  assert.deepEqual(_test.classify([], 'Fix jitter in the Atlas tree layout'), { type: 'Fix', area: 'Tree experience', risk: null });
  assert.deepEqual(
    _test.classify([{ name: 'type: polish' }, { name: 'area: profiles' }, { name: 'risk: r1' }], 'Fix tree bug'),
    { type: 'Polish', area: 'Profiles', risk: 'r1' },
  );
});

await test('maps only the Cloudflare Pages check run to deployment truth', () => {
  // Cloudflare Pages reports via a CHECK RUN (the Checks API), never the
  // legacy combined-status API — a real call against this repo's own merged
  // PRs confirmed /commits/{sha}/status returns `{ statuses: [] }` for a
  // commit whose Checks API entry showed a real "Cloudflare Pages" run, so
  // these fixtures deliberately mirror the check-runs shape, not statuses.
  assert.equal(_test.deploymentFromCheckRuns({ check_runs: [{ name: 'tests', status: 'completed', conclusion: 'success' }] }).state, 'unverified');
  assert.deepEqual(
    _test.deploymentFromCheckRuns({ check_runs: [{ name: 'Cloudflare Pages', status: 'completed', conclusion: 'success', html_url: 'https://preview.example.test' }] }),
    { state: 'deployed', label: 'Deployed', url: 'https://preview.example.test' },
  );
  assert.equal(_test.deploymentFromCheckRuns({ check_runs: [{ name: 'Cloudflare Pages', status: 'completed', conclusion: 'failure' }] }).state, 'failed');
  assert.equal(_test.deploymentFromCheckRuns({ check_runs: [{ name: 'Cloudflare Pages', status: 'in_progress', conclusion: null }] }).state, 'pending');
});

await test('returns a small safe projection of merged PRs and never exposes PR bodies or patches', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/pulls?')) return new Response(JSON.stringify([
      {
        number: 42,
        title: 'Polish the family archive',
        html_url: 'https://github.com/example/repo/pull/42',
        merged_at: '2026-09-04T12:00:00Z',
        merge_commit_sha: 'abc123',
        body: 'PRIVATE DETAILS MUST NOT LEAK',
        patch_url: 'https://example.test/private.patch',
        user: { login: 'jason', html_url: 'https://github.com/jason' },
        merged_by: { login: 'matt' },
        labels: [{ name: 'type: polish', color: 'C2603A' }],
      },
      { number: 41, title: 'Closed but not merged', merged_at: null },
    ]), { status: 200 });
    if (String(url).includes('/commits/abc123/check-runs')) return new Response(JSON.stringify({ check_runs: [{ name: 'Cloudflare Pages', status: 'completed', conclusion: 'success' }] }), { status: 200 });
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const payload = await _test.loadActivity({ GITHUB_REPOSITORY: 'example/repo', GITHUB_READ_TOKEN: 'server-secret' });
    assert.equal(payload.entries.length, 1);
    assert.equal(payload.entries[0].number, 42);
    assert.equal(payload.entries[0].deployment.state, 'deployed');
    assert.equal(payload.entries[0].type, 'Polish');
    assert.ok(!JSON.stringify(payload).includes('PRIVATE DETAILS'));
    assert.ok(!JSON.stringify(payload).includes('private.patch'));
    assert.ok(calls.every((call) => call.options.headers.authorization === 'Bearer server-secret'));
  } finally { globalThis.fetch = originalFetch; }
});

await test('does not spend unauthenticated rate limit on per-commit deployment calls', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify([{ number: 9, title: 'Add a feature', html_url: 'https://github.com/example/repo/pull/9', merged_at: '2026-09-01T12:00:00Z', merge_commit_sha: 'sha9', user: { login: 'matt' }, labels: [] }]), { status: 200 });
  };
  try {
    const payload = await _test.loadActivity({ GITHUB_REPOSITORY: 'example/repo' });
    assert.equal(calls.length, 1);
    assert.equal(payload.deployment_verification.configured, false);
    assert.equal(payload.entries[0].deployment.state, 'unverified');
  } finally { globalThis.fetch = originalFetch; }
});

await test('keeps the knowledge centre available when GitHub is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 403 });
  try {
    const payload = await _test.loadActivity({ GITHUB_REPOSITORY: 'example/repo' });
    assert.equal(payload.source.available, false);
    assert.match(payload.source.error, /rate limit|access/i);
    assert.deepEqual(payload.entries, []);
  } finally { globalThis.fetch = originalFetch; }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

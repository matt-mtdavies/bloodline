/**
 * Guards public/admin.html's hand-copied design tokens against silently
 * drifting from src/styles/theme.css — the standalone admin page is served
 * outside the Vite bundle, so it can't `import` the real theme and instead
 * keeps a byte-for-byte copy in its own <style> block (see the admin.html
 * comment right above its :root block).
 *
 * Deliberately excludes --gold (a pre-existing, intentional split — see
 * CLAUDE.md's icon-refresh note: admin.html's mark and gold accents keep the
 * newer #c4913f the brand mark itself uses, independent of theme.css's own
 * --gold token) and --danger/--danger-soft (no equivalent in theme.css at
 * all — the main app deliberately avoids a red token, but this operations
 * page needs one for real failure states).
 *
 * A simple regex extraction, not a CSS parser — brittle in the sense that a
 * hand-formatted value (extra whitespace, a trailing comment) could dodge
 * the match, but exactly the "focused assertion, not a brittle source-text
 * comparison" the brief's maintainability section asked for: it compares
 * VALUES, not surrounding formatting.
 *
 * Run with: node tests/admin-theme-tokens.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const themeCss = readFileSync(path.join(__dirname, '../src/styles/theme.css'), 'utf8');
const adminHtml = readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

// Extract `--token: value;` from the FIRST :root block only (theme.css has
// one; admin.html's <style> also has exactly one :root block at the top).
function extractTokens(css, names) {
  const out = {};
  for (const name of names) {
    const re = new RegExp(`--${name}:\\s*([^;]+);`);
    const m = css.match(re);
    out[name] = m ? m[1].trim() : undefined;
  }
  return out;
}

const SHARED_TOKENS = [
  'paper', 'paper-deep', 'ink', 'ink-soft', 'ink-faint', 'hairline',
  'accent', 'accent-deep', 'accent-soft', 'sage', 'sage-soft',
  'display', 'body', 'radius', 'radius-lg', 'shadow-soft', 'shadow-lift',
];

test('every shared design token has a value copied into admin.html', () => {
  const adminTokens = extractTokens(adminHtml, SHARED_TOKENS);
  for (const name of SHARED_TOKENS) {
    assert.ok(adminTokens[name], `admin.html is missing --${name}`);
  }
});

test('shared design tokens are byte-identical between theme.css and admin.html', () => {
  const themeTokens = extractTokens(themeCss, SHARED_TOKENS);
  const adminTokens = extractTokens(adminHtml, SHARED_TOKENS);
  for (const name of SHARED_TOKENS) {
    assert.equal(adminTokens[name], themeTokens[name], `--${name} has drifted: theme.css has "${themeTokens[name]}", admin.html has "${adminTokens[name]}"`);
  }
});

test('admin.html documents why --gold is deliberately NOT synced with theme.css', () => {
  assert.match(adminHtml, /gold.*deliberately|deliberate.*gold/is, 'the divergence should stay documented so it reads as intentional, not drift');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

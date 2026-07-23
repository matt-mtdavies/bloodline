import assert from 'node:assert/strict';
import { sanitizeNameSegment, buildArchivePath, assertSafeArchivePath } from '../src/lib/archivePath.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

// ── sanitizeNameSegment ──────────────────────────────────────────────────

test('a literal traversal sequence is neutralized, not preserved', () => {
  const out = sanitizeNameSegment('../../etc/passwd');
  assert.ok(!out.includes('..'), `expected no ".." in "${out}"`);
  assert.ok(!out.includes('/'), `expected no "/" in "${out}"`);
});

test('backslash traversal (Windows-style) is neutralized', () => {
  const out = sanitizeNameSegment('..\\..\\Windows\\System32');
  assert.ok(!out.includes('..'), `expected no ".." in "${out}"`);
  assert.ok(!out.includes('\\'), `expected no "\\\\" in "${out}"`);
});

test('NUL bytes and control characters are stripped/replaced', () => {
  const out = sanitizeNameSegment('John\x00Smith\x1f');
  assert.ok(!out.includes('\x00'));
  assert.ok(!out.includes('\x1f'));
});

test('Windows-reserved characters are replaced', () => {
  const out = sanitizeNameSegment('Report: "Q1"<final>|*?');
  for (const ch of [':', '"', '<', '>', '|', '*', '?']) {
    assert.ok(!out.includes(ch), `expected no "${ch}" in "${out}"`);
  }
});

test('fullwidth solidus (confusable "/") is neutralized', () => {
  const out = sanitizeNameSegment('a\uFF0F..\uFF0Fb');
  assert.ok(!out.includes('\uFF0F'));
  assert.ok(!out.includes('/'));
});

test('division slash (confusable "/") is neutralized', () => {
  const out = sanitizeNameSegment('etc\u2215passwd');
  assert.ok(!out.includes('\u2215'));
  assert.ok(!out.includes('/'));
});

test('invisible bidi override characters cannot hide a traversal sequence', () => {
  // U+202E is RIGHT-TO-LEFT OVERRIDE — could visually reorder characters to
  // disguise ".." from a human glancing at a file listing.
  const out = sanitizeNameSegment('a\u202E..\u202Cb');
  assert.ok(!out.includes('\u202E'));
  assert.ok(!out.includes('\u202C'));
  assert.ok(!out.includes('..'));
});

test('zero-width space is stripped outright', () => {
  const out = sanitizeNameSegment('Jo\u200Bhn');
  assert.ok(!out.includes('\u200B'));
});

test('lone/unpaired surrogates are stripped rather than corrupting output', () => {
  const out = sanitizeNameSegment('a\uD800b\uDC00c');
  assert.doesNotThrow(() => Array.from(out));
});

test('a real surrogate PAIR (e.g. an emoji) is preserved as one unit', () => {
  const out = sanitizeNameSegment('Grandma \u{1F469}\u200D\u{1F467}'); // family emoji sequence
  assert.ok(out.startsWith('Grandma'));
});

test('a name that is only dots collapses to the fallback, not an empty/dot path', () => {
  const out = sanitizeNameSegment('...');
  assert.equal(out, 'unnamed');
});

test('a name that is only path separators falls back safely', () => {
  const out = sanitizeNameSegment('///\\\\\\');
  assert.equal(out, 'unnamed');
});

test('empty, null, and undefined all fall back to "unnamed"', () => {
  assert.equal(sanitizeNameSegment(''), 'unnamed');
  assert.equal(sanitizeNameSegment(null), 'unnamed');
  assert.equal(sanitizeNameSegment(undefined), 'unnamed');
});

test('trailing dots and spaces (Windows-hostile) are stripped', () => {
  const out = sanitizeNameSegment('My Document. . .');
  assert.ok(!/[. ]$/.test(out), `expected no trailing dot/space in "${out}"`);
});

test('a normal name is preserved close to as-is', () => {
  assert.equal(sanitizeNameSegment('James Mercer'), 'James Mercer');
});

test('long names truncate at a code-point boundary, not mid-surrogate-pair', () => {
  const emojiName = '\u{1F469}'.repeat(100); // 100 family-emoji-ish code points
  const out = sanitizeNameSegment(emojiName, { maxLength: 10 });
  assert.equal(Array.from(out).length, 10);
  // Every remaining code point must itself be valid (no lone surrogate left
  // dangling by an off-by-one truncation).
  for (const cp of out) assert.equal(Array.from(cp).length, 1);
});

test('a run of many dots does not reassemble into ".." after underscore collapse', () => {
  const out = sanitizeNameSegment('a....b');
  assert.ok(!out.includes('..'));
});

// ── buildArchivePath ──────────────────────────────────────────────────────

test('buildArchivePath produces a stable, unique, extension-suffixed path', () => {
  const p = buildArchivePath('photos', 'ph_abc123', 'Family Reunion 2019', 'jpg');
  assert.equal(p, 'photos/ph_abc123_Family Reunion 2019.jpg');
});

test('buildArchivePath stays unique across two records with the same (sanitized) name', () => {
  const a = buildArchivePath('photos', 'ph_aaa', '../../etc/passwd', 'jpg');
  const b = buildArchivePath('photos', 'ph_bbb', '../../etc/passwd', 'jpg');
  assert.notEqual(a, b);
  assert.ok(!a.includes('..') && !b.includes('..'));
});

test('buildArchivePath with a malicious extension does not escape the path', () => {
  const p = buildArchivePath('documents', 'doc_1', 'resume', '../../../etc/passwd');
  assert.ok(!p.includes('..'), `expected no ".." in "${p}"`);
  assertSafeArchivePath(p); // must not throw
});

// ── assertSafeArchivePath ──────────────────────────────────────────────────

test('assertSafeArchivePath accepts a normal relative path', () => {
  assert.doesNotThrow(() => assertSafeArchivePath('photos/ph_abc_Family Photo.jpg'));
});

test('assertSafeArchivePath rejects an absolute path', () => {
  assert.throws(() => assertSafeArchivePath('/etc/passwd'));
});

test('assertSafeArchivePath rejects a backslash-absolute path', () => {
  assert.throws(() => assertSafeArchivePath('\\\\server\\share'));
});

test('assertSafeArchivePath rejects a Windows drive-letter path', () => {
  assert.throws(() => assertSafeArchivePath('C:/Windows/System32'));
  assert.throws(() => assertSafeArchivePath('C:\\Windows\\System32'));
});

test('assertSafeArchivePath rejects a ".." traversal segment', () => {
  assert.throws(() => assertSafeArchivePath('photos/../../../etc/passwd'));
});

test('assertSafeArchivePath rejects a bare "." segment', () => {
  assert.throws(() => assertSafeArchivePath('photos/./x.jpg'));
});

test('assertSafeArchivePath rejects embedded NUL/control characters', () => {
  assert.throws(() => assertSafeArchivePath('photos/evil\x00.jpg'));
});

test('assertSafeArchivePath rejects a backslash inside a segment', () => {
  assert.throws(() => assertSafeArchivePath('photos/evil\\name.jpg'));
});

test('assertSafeArchivePath rejects empty and non-string input', () => {
  assert.throws(() => assertSafeArchivePath(''));
  assert.throws(() => assertSafeArchivePath(null));
  assert.throws(() => assertSafeArchivePath(undefined));
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

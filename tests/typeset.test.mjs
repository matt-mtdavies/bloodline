/**
 * Unit tests for lib/typeset.js — the Keepsake's measurement-driven
 * typesetter. Heights are faked (no DOM here); what's under test is the
 * block extraction and the packing rules: nothing clipped, nothing
 * scrolling, openers never stranded at the foot of a page.
 * Run with: node tests/typeset.test.mjs
 */
import assert from 'node:assert/strict';
import {
  blocksOf, paginate, contentWidth, contentHeight,
  PRINT_FOLIO, PHONE_FOLIO, roman,
} from '../src/lib/typeset.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const spreads = [
  { key: 'cover', name: 'James Mercer', lifespan: 'b. 1985', epithet: 'Architect', photo: null },
  { key: 'frontispiece', roles: ['father', 'husband'], familyName: 'The Mercers', recordCount: 39 },
  {
    key: 'origins',
    born: { place: 'Cardiff, Wales', date: '12 April 1985' },
    narrative: ['A first paragraph about beginnings.', 'A second paragraph.'],
    parents: [{ id: 'p1', name: 'Robert Mercer', photo: null }],
  },
  { key: 'constellation', nodes: [{ id: 'n1', x: 0, y: 0, band: 'subject', name: 'James' }], links: [] },
  {
    key: 'chapters',
    bio: 'A short bio.',
    chapters: [
      { label: '1985–2003', narrativeTitle: 'The early years', paragraphs: ['One.', 'Two.'], events: [{ year: 1985, title: 'Born' }] },
      { label: '2003–2010', narrativeTitle: null, paragraphs: null, events: [{ year: 2004, title: 'University' }, { year: 2008, title: 'First job' }] },
    ],
  },
  { key: 'places', places: [{ place: 'Cardiff', role: 'Born here', year: 1985 }, { place: 'Bristol', role: 'Lives here', year: null }] },
  { key: 'voices', voices: [{ text: 'A memory.', author: 'Rachel' }, { text: 'Another memory.', author: 'Noah' }] },
  { key: 'album', photos: [{ src: 'a.jpg' }, { src: 'b.jpg' }, { src: 'c.jpg' }, { src: 'd.jpg' }, { src: 'e.jpg' }, { src: 'f.jpg' }] },
  { key: 'record', rows: Array.from({ length: 23 }, (_, i) => ({ label: `Row ${i}`, value: String(i) })) },
  { key: 'legacy', paragraphs: null, children: [{ id: 'c1', name: 'Noah Mercer' }], grandchildren: [], youngestYear: null },
  { key: 'colophon', recordCount: 39, familyName: 'The Mercers', contributors: [], sparse: false },
];

const blocks = blocksOf(spreads);
const flowHeights = Object.fromEntries(blocks.filter((b) => !b.fixed).map((b) => [b.id, 120]));

test('canvases: content area is positive and phone folio is genuinely smaller', () => {
  assert.ok(contentWidth(PRINT_FOLIO) > 0 && contentHeight(PRINT_FOLIO) > 0);
  assert.ok(contentWidth(PHONE_FOLIO) < contentWidth(PRINT_FOLIO));
  assert.ok(contentHeight(PHONE_FOLIO) < contentHeight(PRINT_FOLIO));
});

test('blocksOf: cover first, fixed, full-bleed, and carries the family name', () => {
  assert.equal(blocks[0].kind, 'cover');
  assert.ok(blocks[0].fixed && blocks[0].bleed);
  assert.equal(blocks[0].familyName, 'The Mercers');
});

test('blocksOf: chapter openers carry their absolute edit-slot index', () => {
  const opens = blocks.filter((b) => b.kind === 'chapterOpen');
  assert.equal(opens.length, 2);
  assert.equal(opens[0].section, 'chapter:0');
  assert.equal(opens[1].section, 'chapter:1');
  assert.equal(opens[0].num, 1);
});

test('blocksOf: a chapter without prose gets a pending block, not silence', () => {
  const i = blocks.findIndex((b) => b.section === 'chapter:1');
  assert.equal(blocks[i + 1].kind, 'pending');
});

test('blocksOf: album = one full-bleed hero page + grids of four', () => {
  const hero = blocks.filter((b) => b.kind === 'albumHero');
  const grids = blocks.filter((b) => b.kind === 'albumGrid');
  assert.equal(hero.length, 1);
  assert.ok(hero[0].bleed);
  assert.equal(grids.length, 2); // 5 remaining photos -> 4 + 1
  assert.equal(grids[0].photos.length, 4);
  assert.equal(grids[1].photos.length, 1);
});

test('blocksOf: record rows chunk into fixed pages of 10', () => {
  const rec = blocks.filter((b) => b.kind === 'record');
  assert.equal(rec.length, 3); // 23 rows -> 10 + 10 + 3
  assert.equal(rec[2].rows.length, 3);
});

test('blocksOf: an over-long pasted paragraph splits at sentence boundaries', () => {
  const wall = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} of a very long story.`).join(' ');
  const b = blocksOf([{ key: 'origins', born: {}, narrative: [wall], parents: [] }]);
  const prose = b.filter((x) => x.kind === 'prose');
  assert.ok(prose.length > 1, 'must split');
  assert.ok(prose.every((p) => p.text.length <= 700));
  assert.ok(prose[0].dropcap && !prose[1].dropcap);
  assert.equal(prose.map((p) => p.text).join(' ').replace(/\s+/g, ' '), wall.replace(/\s+/g, ' '));
});

test('paginate: no flow page exceeds the content height', () => {
  const pages = paginate(blocks, flowHeights, PRINT_FOLIO);
  for (const p of pages.filter((x) => x.kind === 'flow')) {
    const h = p.blocks.reduce((s, b) => s + flowHeights[b.id], 0);
    assert.ok(h <= contentHeight(PRINT_FOLIO), `page ${p.pageKey} is ${h}px`);
  }
});

test('paginate: every block lands on exactly one page (nothing lost, nothing doubled)', () => {
  const pages = paginate(blocks, flowHeights, PHONE_FOLIO);
  const seen = pages.flatMap((p) => (p.kind === 'fixed' ? [p.block.id] : p.blocks.map((b) => b.id)));
  assert.deepEqual([...seen].sort(), blocks.map((b) => b.id).sort());
  assert.equal(new Set(seen).size, seen.length);
});

test('paginate: fixed blocks are always whole pages, in stream order', () => {
  const pages = paginate(blocks, flowHeights, PRINT_FOLIO);
  const fixedKinds = pages.filter((p) => p.kind === 'fixed').map((p) => p.block.kind);
  assert.deepEqual(
    fixedKinds,
    ['cover', 'front', 'constellation', 'albumHero', 'albumGrid', 'albumGrid', 'record', 'record', 'record', 'colophon'],
  );
});

test('paginate: an opener is never the last block on a page (keep-with-next)', () => {
  // Force heights so an opener would land exactly at a page foot.
  const b = blocksOf(spreads).filter((x) => !x.fixed);
  const h = {};
  const maxH = contentHeight(PRINT_FOLIO);
  // Everything huge: each block would fill most of a page, so every opener
  // is pushed to the foot without keep-with-next.
  for (const x of b) h[x.id] = x.kind === 'sectionOpen' || x.kind === 'chapterOpen' ? maxH * 0.4 : maxH * 0.7;
  const pages = paginate(blocksOf(spreads), h, PRINT_FOLIO);
  for (const p of pages.filter((x) => x.kind === 'flow')) {
    const last = p.blocks[p.blocks.length - 1];
    if (p.blocks.length > 1) {
      assert.ok(last.kind !== 'sectionOpen' && last.kind !== 'chapterOpen', `opener stranded on ${p.pageKey}`);
    }
  }
});

test('paginate: phone folio produces at least as many pages as print folio', () => {
  const print = paginate(blocks, flowHeights, PRINT_FOLIO).length;
  const phone = paginate(blocks, flowHeights, PHONE_FOLIO).length;
  assert.ok(phone >= print, `${phone} phone vs ${print} print`);
});

test('roman numerals for chapter openers', () => {
  assert.equal(roman(1), 'I');
  assert.equal(roman(4), 'IV');
  assert.equal(roman(12), 'XII');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// Assembles a real, on-disk directory mirroring the archive layout
// (docs/FULL-ARCHIVE-EXPORT.md §3.2) from the static viewer template plus
// a synthetic tree, so the viewer can be opened via a genuine file://
// URL — not a dev server — exactly how a user would open it after
// extracting the ZIP. Exported so both the automated test and any manual
// spot-check can reuse the same fixture-building logic.
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContentIndex, toContentIndexJSON, toTreeDataJs } from '../../src/lib/contentIndex.js';
import { buildMediaInventory, buildKeepsakeInventory, classifyReference } from '../../src/lib/inventory.js';

export const FIXTURE_FAMILY_ID = 'fam_fixture';

export const FIXTURE_KEEPSAKE_EDITION = {
  personId: 'p1',
  hash: 'facts-hash-current',
  editionNumber: 2,
  compiledAt: '2026-06-01T00:00:00.000Z',
  recordCount: 12,
  narrative: {
    epithet: 'The Storyteller of Cardiff',
    origins: ['James was born to a family of teachers and dockworkers in Cardiff, Wales.'],
    chapters: [
      { title: 'A Studious Childhood', years: '1985–2003', paragraphs: ['James grew up chasing books more than footballs.', 'His grandmother Florence often said he read faster than she could keep him in library cards.'] },
      { title: 'Cardiff University and Beyond', years: '2003–2016', paragraphs: ['He graduated in 2010 and never really left the city he loved.'] },
    ],
    legacy: ['He is remembered, above all, for the stories he told at Christmas.'],
  },
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(__dirname, '../../src');

export const FIXTURE_TREE = {
  people: [
    {
      id: 'p1', display_name: 'James Mercer', birth_date: '1985-03-01', occupation: 'Teacher',
      birth_place: 'Cardiff, Wales', is_living: true,
      photo: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gATQ3JlYXRlZCB3aXRoIEdJTVD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD5/9k=',
      events: [{ year: 2010, title: 'Graduated university', detail: 'Cardiff University' }, { year: 2016, title: 'Married Megan' }],
    },
    { id: 'p2', display_name: 'Megan Mercer', birth_date: '1987-06-15', occupation: 'Nurse' },
    { id: 'p3', display_name: 'Oliver Mercer', birth_date: '2012-01-10' },
    {
      id: 'p4', display_name: 'Robert Mercer', birth_date: '1955-02-02', death_date: '2020-11-01',
      photo: '/api/photos/gone.jpg', // deliberately unresolvable — proves the "missing" warning path
    },
    { id: 'p5', display_name: 'Florence Mercer', birth_date: '1930-05-20', death_date: '2015-08-01' },
  ],
  relationships: [
    { id: 'r1', from_person: 'p1', to_person: 'p3', type: 'parent' },
    { id: 'r2', from_person: 'p2', to_person: 'p3', type: 'parent' },
    { id: 'r3', from_person: 'p1', to_person: 'p2', type: 'partner' },
    { id: 'r4', from_person: 'p4', to_person: 'p1', type: 'parent' },
  ],
  memories: [
    { id: 'mem1', person_id: 'p1', text: 'James told the best stories at Christmas.' },
  ],
  documents: [
    { id: 'doc1', title: 'Birth Certificate', person_id: 'p1', mime: 'application/pdf', src: '/api/documents/missing-doc.pdf' },
    { id: 'doc2', title: 'Cardiff University Diploma', person_id: 'p1', mime: 'application/pdf', src: 'data:application/pdf;base64,JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmoKPDwvTGVuZ3RoIDMgMCBSPj4Kc3RyZWFtCkJUCi9GMSAyNCBUZgooRml4dHVyZSBkaXBsb21hKSBUagpFVAplbmRzdHJlYW0KZW5kb2JqCnRyYWlsZXIKPDwvUm9vdCAxIDAgUj4+CiUlRU9G' },
  ],
  photos: [],
};

export async function buildFixtureArchive() {
  const root = mkdtempSync(path.join(tmpdir(), 'archive-fixture-'));

  const mediaEntries = await buildMediaInventory(FIXTURE_TREE, {
    resolveR2Head: async () => ({ found: false }), // every /api/ reference in this fixture is deliberately unresolvable
  });

  // James (p1) has a real, embedded Keepsake edition (proving the readable-
  // narrative viewer path); Robert (p4) has none at all (proving the "no
  // Keepsake" case renders nothing, not an error).
  const fixtureBody = JSON.stringify(FIXTURE_KEEPSAKE_EDITION);
  const fixtureHashedKey = `keepsake/${FIXTURE_FAMILY_ID}/p1/${FIXTURE_KEEPSAKE_EDITION.hash}.json`;
  const { entries: keepsakeEntries } = await buildKeepsakeInventory(FIXTURE_TREE, FIXTURE_FAMILY_ID, {
    listPrefix: async (prefix) => {
      if (prefix !== `keepsake/${FIXTURE_FAMILY_ID}/p1/`) return [];
      // Real Keepsake writes always produce BOTH the hashed edition AND
      // latest.json in the same put (functions/api/keepsake.js) — sharing
      // an ETag, since they're byte-identical. Only supplying the hashed
      // copy (no latest.json) means buildKeepsakeInventory never finds a
      // "current" edition to flag, which is what a real archive never
      // actually produces — this fixture should match real behavior.
      return [
        { key: fixtureHashedKey, byteLength: fixtureBody.length, etag: '"fixture-etag"' },
        { key: `${prefix}latest.json`, byteLength: fixtureBody.length, etag: '"fixture-etag"' },
      ];
    },
    // Called by buildKeepsakeInventory at most once, for whichever key it
    // determines to be the current edition — here, always the hashed key
    // (it shares latest.json's etag above, so it's the alias target).
    getBody: async (key) => (key === fixtureHashedKey ? fixtureBody : null),
  });
  const allMediaEntries = [...mediaEntries, ...keepsakeEntries];

  const index = buildContentIndex(FIXTURE_TREE, allMediaEntries, {
    sourceChecksum: 'fixture-checksum-123',
    family: { id: FIXTURE_FAMILY_ID, name: 'The Mercer Family' },
    generatedAt: new Date().toISOString(),
    warnings: [],
  });

  // Florence (p5) gets a keepsake with a structurally malformed narrative
  // injected DIRECTLY onto the built index — deliberately bypassing
  // buildKeepsakeInventory's own isValidNarrative check entirely, so this
  // proves the VIEWER'S OWN Array.isArray guards (app.js) are genuine
  // defense-in-depth, not merely re-testing the inventory-level fix a
  // second time via a different door.
  index.people.p5.keepsake = {
    personId: 'p5', hash: 'corrupt', editionNumber: 1,
    narrative: { epithet: 'Corrupted', origins: 'not an array', chapters: 'also not an array', legacy: null },
  };

  // Static viewer template, copied verbatim — exactly what Phase B's real
  // packaging step will do, just to a temp dir instead of into the ZIP.
  cpSync(path.join(SRC_DIR, 'START-HERE.html'), path.join(root, 'START-HERE.html'));
  cpSync(path.join(SRC_DIR, 'viewer'), path.join(root, 'viewer'), { recursive: true });

  // Materialize the actual archived bytes for every 'included' data:-URL
  // entry, mirroring what Phase B's real packaging stage writes into the
  // ZIP — a data: URL's bytes are already fully in hand (see inventory.js
  // header comment: no separate R2 read is needed for these), so the
  // fixture should genuinely contain the file the viewer will try to
  // load, the same way a real extracted archive would.
  for (const rawRefSource of [
    ...FIXTURE_TREE.people.map((p) => ({ id: p.id, rawRef: p.photo })),
    ...FIXTURE_TREE.people.map((p) => ({ id: p.id, rawRef: p.photo_thumb })),
    ...(FIXTURE_TREE.photos || []).map((ph) => ({ id: ph.id, rawRef: ph.src })),
    ...(FIXTURE_TREE.documents || []).map((d) => ({ id: d.id, rawRef: d.src })),
    ...(FIXTURE_TREE.documents || []).map((d) => ({ id: d.id, rawRef: d.thumb })),
  ]) {
    if (!rawRefSource.rawRef) continue;
    const ref = classifyReference(rawRefSource.rawRef);
    if (ref.kind !== 'data_url') continue;
    const entry = mediaEntries.find((e) => e.id === rawRefSource.id && e.status === 'included' && e.originalReference?.kind === 'data_url');
    if (!entry) continue;
    const bytes = Buffer.from(ref.base64, 'base64');
    mkdirSync(path.join(root, path.dirname(entry.path)), { recursive: true });
    writeFileSync(path.join(root, entry.path), bytes);
  }

  // Materialize the Keepsake edition file(s) too — 'included' status means
  // a real extracted archive would contain this file, embedded narrative
  // or not (the embedded copy in tree-data.js is a convenience for the
  // viewer; the archived file itself is still the authoritative artifact).
  for (const entry of keepsakeEntries) {
    mkdirSync(path.join(root, path.dirname(entry.path)), { recursive: true });
    writeFileSync(path.join(root, entry.path), JSON.stringify(entry.edition ?? {}));
  }

  mkdirSync(path.join(root, 'data'), { recursive: true });
  writeFileSync(path.join(root, 'data', 'tree.json'), JSON.stringify(FIXTURE_TREE, null, 2));
  writeFileSync(path.join(root, 'data', 'tree-data.js'), toTreeDataJs(index));
  writeFileSync(path.join(root, 'data', 'content-index.json'), toContentIndexJSON(index));

  return { root, index, mediaEntries: allMediaEntries };
}

// Allow running standalone for a manual spot-check: `node tests/_buildFixtureArchive.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  const { root } = await buildFixtureArchive();
  console.log('Fixture archive built at:', root);
  console.log('Open with: file://' + path.join(root, 'START-HERE.html'));
}

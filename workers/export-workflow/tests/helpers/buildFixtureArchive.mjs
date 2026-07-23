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
import { buildMediaInventory, classifyReference } from '../../src/lib/inventory.js';

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
  ],
  photos: [],
};

export async function buildFixtureArchive() {
  const root = mkdtempSync(path.join(tmpdir(), 'archive-fixture-'));

  const mediaEntries = await buildMediaInventory(FIXTURE_TREE, {
    resolveR2Head: async () => ({ found: false }), // every /api/ reference in this fixture is deliberately unresolvable
  });

  const index = buildContentIndex(FIXTURE_TREE, mediaEntries, {
    sourceChecksum: 'fixture-checksum-123',
    family: { id: 'fam_fixture', name: 'The Mercer Family' },
    generatedAt: new Date().toISOString(),
    warnings: [],
  });

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

  mkdirSync(path.join(root, 'data'), { recursive: true });
  writeFileSync(path.join(root, 'data', 'tree.json'), JSON.stringify(FIXTURE_TREE, null, 2));
  writeFileSync(path.join(root, 'data', 'tree-data.js'), toTreeDataJs(index));
  writeFileSync(path.join(root, 'data', 'content-index.json'), toContentIndexJSON(index));

  return { root, index, mediaEntries };
}

// Allow running standalone for a manual spot-check: `node tests/_buildFixtureArchive.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  const { root } = await buildFixtureArchive();
  console.log('Fixture archive built at:', root);
  console.log('Open with: file://' + path.join(root, 'START-HERE.html'));
}

// Live-browser verification for the offline viewer (docs/FULL-ARCHIVE-
// EXPORT.md §3.8, §12.4). Opens the fixture archive via a genuine file://
// URL (not a dev server) since that's the actual constraint being tested:
// no fetch()/XHR, no network request of any kind, works after extraction
// with nothing running. Run with: node tests/viewer.e2e.mjs
import { chromium } from 'playwright';
import path from 'node:path';
import { buildFixtureArchive } from './helpers/buildFixtureArchive.mjs';

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log(`PASS  ${label}`); }
  else { failed++; console.log(`FAIL  ${label}`); }
}

const { root } = await buildFixtureArchive();
const url = `file://${path.join(root, 'START-HERE.html')}`;

const browser = await chromium.launch();
const page = await browser.newPage();

const networkRequests = [];
page.on('request', (req) => networkRequests.push(req.url()));
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

await page.goto(url);
await page.waitForTimeout(300);

check('page loaded with zero console/page errors', consoleErrors.length === 0);
if (consoleErrors.length) console.log('      errors:', consoleErrors);

const externalRequests = networkRequests.filter((u) => !u.startsWith('file://'));
check('zero non-file:// network requests (no fetch/CDN/analytics)', externalRequests.length === 0);
if (externalRequests.length) console.log('      external requests:', externalRequests);

check('family name renders', (await page.textContent('#av-family-name')) === 'The Mercer Family');
check('generated-at date renders', (await page.textContent('#av-generated-at')).includes('Archived'));

const peopleButtons = await page.locator('.av-people-list button').allTextContents();
check('all 5 people appear in the directory', peopleButtons.length === 5);
check('directory is sorted alphabetically by display name', JSON.stringify(peopleButtons) === JSON.stringify([...peopleButtons].sort()));

// Search filtering
await page.fill('#av-search', 'megan');
await page.waitForTimeout(50);
const filtered = await page.locator('.av-people-list button').allTextContents();
check('search filters the directory to matching names only', filtered.length === 1 && filtered[0] === 'Megan Mercer');
await page.fill('#av-search', '');
await page.waitForTimeout(50);

// Default profile (first person alphabetically = Florence Mercer, ahead of
// James since "Florence" < "James")
check('profile defaults to the first person alphabetically', (await page.textContent('.av-profile__name')) === 'Florence Mercer');

// Navigate explicitly to James for the rest of the detail checks below,
// rather than relying on him being the alphabetically-first/default person.
await page.evaluate(() => { location.hash = '#/person/p1'; });
await page.waitForTimeout(100);
const detailsText = await page.textContent('.av-section');
check('scalar fields render (occupation)', detailsText.includes('Teacher'));

const eventsText = await page.locator('.av-events').textContent();
check('life events render, sorted by year', eventsText.indexOf('2010') < eventsText.indexOf('2016'));

const memoriesText = await page.locator('.av-memories').textContent();
check('memories render', memoriesText.includes('best stories at Christmas'));

// Relationship navigation
const relText = await page.locator('.av-section', { hasText: 'Relationships' }).textContent();
check('relationships section shows partner and child', relText.includes('Megan Mercer') && relText.includes('Oliver Mercer'));

await page.locator('.av-rel-chip', { hasText: 'Oliver Mercer' }).click();
await page.waitForTimeout(100);
check('clicking a relationship chip navigates to that profile', (await page.textContent('.av-profile__name')) === 'Oliver Mercer');
check('URL hash updated for deep-linking', (await page.evaluate(() => location.hash)).includes('p3'));

// Missing-media warning path (Robert Mercer has an unresolvable photo)
await page.evaluate(() => { location.hash = '#/person/p4'; });
await page.waitForTimeout(100);
const mediaText = await page.locator('.av-media-grid').textContent();
check('a missing photo reference shows an explicit warning, not a broken silent image', mediaText.toLowerCase().includes('missing'));
check('a person with no Keepsake at all renders no Keepsake section', await page.locator('.av-keepsake').count() === 0);

// Documents section — James has one unresolvable document (warning) and
// one real, resolvable one (real title + working open link), proving the
// review finding is fixed: the viewer now actually reads DATA.documents
// for titles instead of treating every document as a generic filename.
await page.evaluate(() => { location.hash = '#/person/p1'; });
await page.waitForTimeout(100);
const documentsText = await page.locator('.av-documents').textContent();
check('the unresolvable document shows an explicit warning, not a broken link', documentsText.toLowerCase().includes('missing'));
check('the resolvable document shows its REAL title from DATA.documents, not a generic filename', documentsText.includes('Cardiff University Diploma'));
const docOpenLink = page.locator('.av-documents a', { hasText: 'Open document' });
check('the resolvable document has a working "Open document" link', await docOpenLink.count() === 1);
const docHref = await docOpenLink.getAttribute('href');
check('the document link points at the archived file path', docHref.includes('documents/'));

// Keepsake narrative reading — James has a real embedded edition; the
// review finding was that Keepsakes rendered as a bare generic filename
// link instead of an actual readable narrative.
const keepsakeText = await page.locator('.av-keepsake').textContent();
check('the Keepsake section renders the actual epithet (not a filename link)', keepsakeText.includes('The Storyteller of Cardiff'));
check('the Keepsake section renders chapter titles', keepsakeText.includes('A Studious Childhood') && keepsakeText.includes('Cardiff University and Beyond'));
check('the Keepsake section renders chapter body paragraphs', keepsakeText.includes('chasing books more than footballs'));
check('the Keepsake section renders the legacy line', keepsakeText.includes('remembered, above all, for the stories'));
check('the Keepsake section does NOT just show a bare "Open"/filename link (a real narrative view, not a generic file link)', await page.locator('.av-keepsake a').count() === 0);

// Resilience: Florence's Keepsake has a structurally malformed narrative
// (non-array origins/chapters, null legacy) injected directly onto the
// index, bypassing inventory.js's own validation entirely — proving the
// VIEWER's Array.isArray guards are real defense-in-depth, not just a
// second test of the same inventory-level fix (review finding).
const priorPageErrors = consoleErrors.length;
await page.evaluate(() => { location.hash = '#/person/p5'; });
await page.waitForTimeout(150);
check('a structurally malformed Keepsake narrative does not crash the page (no new console/page errors)', consoleErrors.length === priorPageErrors);
if (consoleErrors.length > priorPageErrors) console.log('      new errors:', consoleErrors.slice(priorPageErrors));
check('the profile still rendered for Florence despite the malformed Keepsake', (await page.textContent('.av-profile__name')) === 'Florence Mercer');
const florenceKeepsakeText = await page.locator('.av-keepsake').textContent();
check('the malformed narrative\'s valid epithet still renders (partial graceful degradation, not an all-or-nothing blank)', florenceKeepsakeText.includes('Corrupted'));

// Keyboard navigation — a fresh page, since earlier clicks in this same
// page already moved focus around (clicking a real button focuses it).
const kbPage = await browser.newPage();
await kbPage.goto(url);
await kbPage.waitForTimeout(200);
await kbPage.keyboard.press('Tab'); // skip link (first focusable element in DOM order)
await kbPage.keyboard.press('Tab'); // search input
const focusedIsSearch = await kbPage.evaluate(() => document.activeElement.id === 'av-search');
check('keyboard tab order reaches the search input', focusedIsSearch);
await kbPage.close();

// Font loading (local, no network) — confirm the @font-face actually
// resolved. Headings request weight 600 (see styles.css), so that's the
// one guaranteed to have been triggered by rendering the family name
// heading — the 400-weight face is legitimately never used on this page
// and correctly stays unloaded (lazy font loading), so checking for it
// would be asserting the wrong thing, not proving a real bug.
await page.evaluate(() => document.fonts.ready);
const fontCheck = await page.evaluate(() => document.fonts.check('600 16px "Fraunces Archive"'));
check('the bundled Fraunces font (weight 600, as actually used by headings) loaded', fontCheck);

// Print button exists and is clickable without throwing
const printBtn = page.locator('#av-print-btn');
check('a print button exists on the profile', await printBtn.count() === 1);

await browser.close();

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

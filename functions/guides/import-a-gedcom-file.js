/*
 * GET /guides/import-a-gedcom-file
 * Theme: "Can I bring my genealogy work with me?" — the genealogist-
 * migrating persona (docs/PRODUCTIZATION-BRIEF.md §3.D). Deeper and more
 * procedural than the /import product page: what to check BEFORE you
 * commit to an import, not just what the feature does.
 */
import { publicPage, breadcrumbStructuredData, articleStructuredData } from '../_lib/publicShell.js';
import { Icons } from '../_lib/publicIcons.js';

const PUBLISHED = '2026-08-01';
const MODIFIED = '2026-08-01';

export async function onRequestGet({ env }) {
  const home = env.APP_URL || 'https://myfamilybloodline.com';
  const path = '/guides/import-a-gedcom-file';
  const title = 'How to import a GEDCOM file — and what to review first';
  const description = 'A practical checklist for bringing an existing genealogy file into Bloodline: what GEDCOM actually carries, merge vs. replace, how duplicates are handled, and how to undo an import that doesn’t look right.';

  const structuredData = [
    breadcrumbStructuredData(home, [{ name: 'Home', href: '/' }, { name: 'Guides', href: '/guides' }, { name: 'Import a GEDCOM file' }]),
    articleStructuredData(home, { path, title, description, datePublished: PUBLISHED, dateModified: MODIFIED }),
  ];

  const content = `
  <section class="pub-hero" style="padding-bottom:8px;">
    <div class="pub-wrap pub-wrap--narrow">
      <p class="pub-breadcrumb"><a href="/">Bloodline</a> &rsaquo; <a href="/guides">Guides</a> &rsaquo; Import a GEDCOM file</p>
      <p class="pub-eyebrow">Importing</p>
      <h1 class="pub-hero__title" style="font-size:clamp(28px,4.6vw,42px);">${title}</h1>
    </div>
  </section>

  <section class="pub-section pub-section--tight">
    <div class="pub-wrap pub-wrap--narrow">
      <div class="pub-guide-meta"><span>Reviewed 1 August 2026</span><span>&middot;</span><span>5 min read</span></div>

      <div class="pub-article">
        <p>GEDCOM is the file format almost every genealogy tool &mdash; Ancestry, FamilySearch, MyHeritage, and most desktop software &mdash; can export. If you've already put years into research elsewhere, you can bring that work into Bloodline rather than starting over. Here's what actually happens when you do, and what to check before you commit.</p>

        <h2>What comes across, and what doesn't</h2>
        <p>A GEDCOM file carries the structured facts of a tree well: people, sex, birth and death dates and places, parent-child relationships (including adoptive and step relationships), marriages and divorces, occupation, residence, education, and burial or resting place. What it generally does <em>not</em> carry is media &mdash; GEDCOM only references photographs and documents by a URL pointing back at your old tool, not the files themselves &mdash; and anything specific to how Bloodline tells a story, like memories, the life-event timeline's free-form entries, or an illustrated Keepsake biography. Expect a faithful import of the facts and relationships, and plan to re-add photos separately.</p>

        <h2>Choose merge or replace &mdash; deliberately</h2>
        <p>An import into an existing tree offers two modes, and they are not interchangeable:</p>
        <ol>
          <li><strong>Merge</strong> adds new people and fills in updates to existing profiles, without removing anything already in the tree. This is the right choice almost every time, and it's the one selected by default.</li>
          <li><strong>Replace</strong> discards the current tree entirely and substitutes the imported file. This is only appropriate when the imported file is genuinely the authoritative, complete version of the family &mdash; and because of how destructive it is, Bloodline requires you to type the family's own name back before it will proceed, on top of the review screen every import shows.</li>
        </ol>
        <div class="pub-callout">
          <p><strong>If you're a co-admin or owner working with a family others already contribute to</strong>, treat Replace as a last resort. A relative may have added a memory, a photo, or a correction since your last export that a Replace would discard along with everything else. Merge preserves it; Replace does not.</p>
        </div>

        <h2>Review before anything is saved</h2>
        <p>Before an import commits, you see a screen listing exactly what would change: which people are entirely new, which existing profiles would be updated and with what, and which relationships would be added. Nothing writes to your tree until you confirm it &mdash; you can uncheck individual people or changes you don't want, rather than accepting the whole file as-is.</p>

        <h2>Duplicates are flagged, not auto-merged</h2>
        <p>Re-importing the same file, or importing a file that overlaps with people already in the tree, is a common way trees end up doubled. Bloodline handles this two ways: a small number of unambiguous re-adds &mdash; the same name, the same birth year, no conflicting date &mdash; are automatically collapsed into the existing person rather than added a second time; anything less certain is left for you to review afterward in a dedicated duplicates list, never merged silently. You're never left guessing whether "Robert Mercer" appearing twice is the same person imported twice or two different relatives who happen to share a name.</p>

        <h3>A short pre-import checklist</h3>
        <ul>
          <li>Confirm the export is recent &mdash; an old export can't include anything your tool added since.</li>
          <li>Decide merge or replace before you start, not while looking at the review screen under time pressure.</li>
          <li>If you're not the only person who edits this family's tree, default to Merge unless you're certain nobody else has added anything since your last export.</li>
          <li>Expect to re-add photographs and documents separately afterward &mdash; the import won't silently lose them, but it also won't bring them across on its own.</li>
        </ul>

        <h2>If something doesn't look right afterward</h2>
        <p>Bloodline keeps automatic backups of a family's tree. If an import doesn't look the way you expected &mdash; more people than you meant to add, a relationship that landed wrong &mdash; an owner can restore an earlier backup from Family Settings. No import is a one-way door.</p>
      </div>
    </div>
  </section>

  <section class="pub-section pub-section--ground">
    <div class="pub-wrap">
      <div class="pub-grid pub-grid--3">
        <div class="pub-card">
          <div class="pub-card__icon">${Icons.list(22)}</div>
          <h3 class="pub-card__title">See the full field list</h3>
          <p class="pub-card__desc">The complete, current breakdown of what a GEDCOM import brings in and what it doesn't.</p>
          <a class="pub-card__link" href="/import">Import a GEDCOM &rarr;</a>
        </div>
        <div class="pub-card">
          <div class="pub-card__icon">${Icons.people(22)}</div>
          <h3 class="pub-card__title">Blended and chosen families</h3>
          <p class="pub-card__desc">How step, adoptive, foster, and chosen relationships come across &mdash; and how to record them if your source file didn't capture them accurately.</p>
          <a class="pub-card__link" href="/guides/family-tree-for-blended-and-chosen-families">Read the guide &rarr;</a>
        </div>
        <div class="pub-card">
          <div class="pub-card__icon">${Icons.spark(22)}</div>
          <h3 class="pub-card__title">Starting from nothing instead</h3>
          <p class="pub-card__desc">No file to import? Here's the honest first step if you're beginning from names and memories alone.</p>
          <a class="pub-card__link" href="/guides/how-to-start-a-family-tree">Read the guide &rarr;</a>
        </div>
      </div>
    </div>
  </section>

  <section class="pub-cta-band">
    <div class="pub-wrap pub-wrap--narrow">
      <h2 class="pub-cta-band__title">Bring your existing tree in, on your terms.</h2>
      <div class="pub-cta-band__row">
        <a class="pub-btn pub-btn--primary pub-btn--lg" href="/sign-in?start=import">Import a GEDCOM</a>
        <a class="pub-btn pub-btn--secondary pub-btn--lg" href="/guides">More guides</a>
      </div>
    </div>
  </section>`;

  const html = publicPage({
    home,
    path,
    title: `${title} | Bloodline`,
    description,
    activeKey: null,
    structuredData,
    content,
  });
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

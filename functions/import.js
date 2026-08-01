/*
 * GET /import
 * Dedicated migration page for GEDCOM users. Audience: someone who has
 * years of genealogy work elsewhere. Never implies a lossless migration
 * until media/archive export is production-ready.
 * See docs/PRODUCTIZATION-BRIEF.md §7 ("Import a GEDCOM").
 */
import { publicPage, breadcrumbStructuredData } from './_lib/publicShell.js';
import { Icons } from './_lib/publicIcons.js';

export async function onRequestGet({ env }) {
  const home = env.APP_URL || 'https://myfamilybloodline.com';
  const structuredData = [
    breadcrumbStructuredData(home, [{ name: 'Home', href: '/' }, { name: 'Import a GEDCOM' }]),
  ];

  const supported = [
    'People, with names, sex, birth and death dates and places',
    'Parent-child relationships, including adoptive and step relationships',
    'Marriages and divorces, with dates and places where recorded',
    'Occupation, residence, education, and burial/resting place',
    'Notes and biographical text attached to a person',
  ];
  const notImported = [
    'Photographs and scanned documents — GEDCOM only references media by URL; the files themselves usually live in your old tool, not the file',
    'Memories, the life-event timeline’s free-form entries, and the Keepsake illustrated biography — these are Bloodline-specific and have no GEDCOM equivalent to import from',
  ];

  const content = `
  <section class="pub-hero" style="padding-bottom:8px;">
    <div class="pub-wrap pub-wrap--narrow">
      <p class="pub-breadcrumb"><a href="/">Bloodline</a> &rsaquo; Import a GEDCOM</p>
      <p class="pub-eyebrow">For years of genealogy work already done elsewhere</p>
      <h1 class="pub-hero__title" style="font-size:clamp(30px,5vw,44px);">Bring your history with you.</h1>
      <p class="pub-hero__sub">GEDCOM is the standard file format almost every genealogy tool can export. Bloodline reads it, shows you exactly what it found, and lets you decide what to keep.</p>
      <div class="pub-hero__ctas"><a class="pub-btn pub-btn--primary pub-btn--lg" href="/start#import">Import a GEDCOM</a></div>
    </div>
  </section>

  <section class="pub-section pub-section--tight">
    <div class="pub-wrap">
      <div class="pub-grid pub-grid--2">
        <div class="pub-card">
          <h3 class="pub-card__title">What a GEDCOM import brings in</h3>
          <ul style="margin-top:10px; padding-left:20px; color:var(--ink-soft); font-size:14.5px; line-height:1.7;">
            ${supported.map((s) => `<li>${s}</li>`).join('')}
          </ul>
        </div>
        <div class="pub-card">
          <h3 class="pub-card__title">What doesn’t come across</h3>
          <ul style="margin-top:10px; padding-left:20px; color:var(--ink-soft); font-size:14.5px; line-height:1.7;">
            ${notImported.map((s) => `<li>${s}</li>`).join('')}
          </ul>
          <p class="pub-card__limit">A complete archive export/import, including photos and documents, is in progress and not yet generally available.</p>
        </div>
      </div>
    </div>
  </section>

  <section class="pub-section pub-section--ground">
    <div class="pub-wrap">
      <p class="pub-eyebrow">How the import itself works</p>
      <h2 class="pub-h2">Reviewed before anything applies.</h2>
      <div class="pub-grid pub-grid--3" style="margin-top:28px;">
        <div class="pub-card">
          <div class="pub-card__icon">${Icons.list(22)}</div>
          <h3 class="pub-card__title">Merge or replace</h3>
          <p class="pub-card__desc">Merge new people and updates into an existing tree, or replace it entirely — you choose which, and replacing a tree still keeps a backup (below) in case you change your mind.</p>
        </div>
        <div class="pub-card">
          <div class="pub-card__icon">${Icons.check(22)}</div>
          <h3 class="pub-card__title">Review before it applies</h3>
          <p class="pub-card__desc">Before anything is saved, you see exactly which people are new, which existing profiles would be updated, and can uncheck anything you don’t want.</p>
        </div>
        <div class="pub-card">
          <div class="pub-card__icon">${Icons.people(22)}</div>
          <h3 class="pub-card__title">Duplicate safeguards</h3>
          <p class="pub-card__desc">Likely duplicate people are flagged for review rather than merged automatically, both during import and any time afterward — an existing tree is never silently doubled up.</p>
        </div>
      </div>
    </div>
  </section>

  <section class="pub-section">
    <div class="pub-wrap pub-wrap--narrow" style="text-align:center;">
      <p class="pub-eyebrow">If something doesn’t look right</p>
      <h2 class="pub-h2">You can always go back.</h2>
      <p class="pub-lede" style="margin:0 auto 22px;">Bloodline keeps automatic backups of your tree. If an import doesn’t look the way you expected, a family owner can restore an earlier backup from Family Settings — no import is a one-way door.</p>
    </div>
  </section>

  <section class="pub-cta-band pub-section--ground">
    <div class="pub-wrap pub-wrap--narrow">
      <h2 class="pub-cta-band__title">Bring your existing tree in, on your terms.</h2>
      <div class="pub-cta-band__row">
        <a class="pub-btn pub-btn--primary pub-btn--lg" href="/start#import">Import a GEDCOM</a>
        <a class="pub-btn pub-btn--secondary pub-btn--lg" href="/help">Read the import FAQ</a>
      </div>
      <p style="margin-top:22px; font-size:14px; color:var(--ink-soft);">Want a full pre-import checklist first? Read <a href="/guides/import-a-gedcom-file" style="color:var(--accent-deep); font-weight:600;">our GEDCOM import guide</a>.</p>
    </div>
  </section>`;

  const html = publicPage({
    home,
    path: '/import',
    title: 'Import a GEDCOM file into Bloodline',
    description: 'What GEDCOM import brings across, what doesn’t come with it yet, and how merge vs. replace, review-before-apply, duplicate safeguards, and backups keep your existing family tree safe.',
    activeKey: null,
    structuredData,
    content,
  });
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

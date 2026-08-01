/*
 * GET /guides/how-to-start-a-family-tree
 * Theme: "I do not know where to begin." Top-of-funnel guide for the
 * visitor with no genealogy background at all — see
 * docs/PRODUCTIZATION-BRIEF.md §16.4's roadmap table.
 */
import { publicPage, breadcrumbStructuredData, articleStructuredData } from '../_lib/publicShell.js';

const PUBLISHED = '2026-08-01';
const MODIFIED = '2026-08-01';

export async function onRequestGet({ env }) {
  const home = env.APP_URL || 'https://myfamilybloodline.com';
  const path = '/guides/how-to-start-a-family-tree';
  const title = 'How to start a family tree when all you have are names and stories';
  const description = 'You don’t need dates, records, or a finished pedigree to begin. A practical, honest walkthrough of the first hour of building a family tree — starting with one person, not a blank form.';

  const structuredData = [
    breadcrumbStructuredData(home, [{ name: 'Home', href: '/' }, { name: 'Guides', href: '/guides' }, { name: 'How to start a family tree' }]),
    articleStructuredData(home, { path, title, description, datePublished: PUBLISHED, dateModified: MODIFIED }),
  ];

  const content = `
  <section class="pub-hero" style="padding-bottom:8px;">
    <div class="pub-wrap pub-wrap--narrow">
      <p class="pub-breadcrumb"><a href="/">Bloodline</a> &rsaquo; <a href="/guides">Guides</a> &rsaquo; How to start a family tree</p>
      <p class="pub-eyebrow">Starting a tree</p>
      <h1 class="pub-hero__title" style="font-size:clamp(28px,4.6vw,42px);">${title}</h1>
    </div>
  </section>

  <section class="pub-section pub-section--tight">
    <div class="pub-wrap pub-wrap--narrow">
      <div class="pub-guide-meta"><span>Reviewed 1 August 2026</span><span>&middot;</span><span>4 min read</span></div>

      <div class="pub-article">
        <p>Most people who want to start a family tree stall before they add a single person, because they picture a research project: certificates to track down, a pedigree chart to fill in correctly, dates they don't have. You don't need any of that to begin. You need one name — usually your own, or someone you love — and about two minutes.</p>

        <h2>Start with one person, not a form</h2>
        <p>The honest first step is smaller than it sounds: enter one name. Not a birth date, not a place, not a spelling you're unsure of &mdash; just a name. Everything else, including that name's own details, can be filled in later or left blank indefinitely. A family tree that's 70% complete and growing is more useful than a blank form nobody ever finishes.</p>

        <h2>Add the people you already carry in your head</h2>
        <p>After the first person, add whoever comes to mind next &mdash; usually parents, a partner, siblings, or children. There's no required order and no required completeness. Common situations that trip people up, and how to handle each:</p>
        <ul>
          <li><strong>You don't know an exact date.</strong> Leave it blank, or use just a year if that's all you have. A partial date is still useful and can be corrected later.</li>
          <li><strong>A relationship isn't a simple "parent and child."</strong> Real families include step-parents, adoptive parents, foster placements, and chosen family who raised someone without a biological or legal tie. Record the relationship as it actually happened, not as it "should" look on a chart &mdash; see our <a href="/guides/family-tree-for-blended-and-chosen-families">guide to blended, adoptive, and chosen families</a> for exactly how.</li>
          <li><strong>You're not sure if two records are the same person.</strong> Add them separately for now. A tree with an occasional accidental duplicate is easy to fix later; a tree that's stalled because you're afraid of getting it wrong isn't a tree at all yet.</li>
        </ul>

        <h2>Attach one memory or photo before you stop</h2>
        <p>The moment a tree starts to feel real &mdash; worth returning to &mdash; is usually the first time it holds something more than names: a photo, a short memory, a detail about where someone lived or what they did for a living. You don't need this on day one, but it's worth doing before you close the tab the first time, because it's the difference between "a list of names" and "the start of a family archive."</p>

        <div class="pub-callout">
          <p><strong>A common mistake:</strong> waiting to start until you've gathered "enough" &mdash; old letters, a relative's memory, a box of photographs. Add what you have now, in whatever order it comes to you. A tree you keep adding to over months will always be more complete than a perfect one you never started.</p>
        </div>

        <h2>Invite the people who should be part of it</h2>
        <p>Once a tree exists, even a small one, you can invite relatives to see it and add to it &mdash; a sibling who remembers a story you don't, a parent who has the dates you're missing. Each person you invite gets a role (viewer, contributor, editor, or co-admin) that controls exactly what they can see and change, so inviting someone doesn't mean handing over the whole archive.</p>

        <h2>If you already have research done elsewhere</h2>
        <p>If you've already built a tree in another tool, you don't need to start from a blank page &mdash; see our <a href="/guides/import-a-gedcom-file">guide to importing a GEDCOM file</a> for how to bring that work across safely, with a chance to review every change before anything is saved.</p>
      </div>
    </div>
  </section>

  <section class="pub-cta-band pub-section--ground">
    <div class="pub-wrap pub-wrap--narrow">
      <h2 class="pub-cta-band__title">Start with one name. See where it leads.</h2>
      <div class="pub-cta-band__row">
        <a class="pub-btn pub-btn--primary pub-btn--lg" href="/sign-in?start=fresh">Start fresh</a>
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

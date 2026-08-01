/*
 * GET /guides
 * Index of Bloodline's editorial guide library — see
 * docs/PRODUCTIZATION-BRIEF.md §16.3/§16.4. Deliberately small: each entry
 * here is a real, maintained guide, not a placeholder. Grow this list only
 * as new guides are written and reviewed, per §16.8's warning against
 * mass-producing unreviewed content.
 */
import { publicPage, breadcrumbStructuredData } from '../_lib/publicShell.js';
import { Icons } from '../_lib/publicIcons.js';

const GUIDES = [
  {
    href: '/guides/how-to-start-a-family-tree',
    topic: 'Starting a tree',
    icon: 'spark',
    title: 'How to start a family tree when all you have are names and stories',
    desc: 'You don’t need dates, records, or a finished pedigree to begin. The honest first hour, starting with one person.',
  },
  {
    href: '/guides/import-a-gedcom-file',
    topic: 'Importing',
    icon: 'doc',
    title: 'How to import a GEDCOM file — and what to review first',
    desc: 'What GEDCOM actually carries, merge vs. replace, how duplicates are handled, and how to undo an import that doesn’t look right.',
  },
  {
    href: '/guides/family-tree-for-blended-and-chosen-families',
    topic: 'Family structures',
    icon: 'people',
    title: 'Building a family tree that includes adoptive, step, blended, and chosen family',
    desc: 'Most family-tree tools assume one tidy line down. Here’s how to record step, adoptive, blended, and chosen relationships as they actually happened.',
  },
];

export async function onRequestGet({ env }) {
  const home = env.APP_URL || 'https://myfamilybloodline.com';
  const structuredData = [
    breadcrumbStructuredData(home, [{ name: 'Home', href: '/' }, { name: 'Guides' }]),
  ];

  const cardsHtml = GUIDES.map((g) => `
        <a class="pub-card" href="${g.href}" style="display:block; text-decoration:none; color:inherit;">
          <div class="pub-card__icon">${Icons[g.icon](22)}</div>
          <span class="pub-guide-card__topic">${g.topic}</span>
          <h3 class="pub-card__title">${g.title}</h3>
          <p class="pub-card__desc">${g.desc}</p>
          <span class="pub-card__link">Read the guide &rarr;</span>
        </a>`).join('');

  const content = `
  <section class="pub-hero" style="padding-bottom:8px;">
    <div class="pub-wrap pub-wrap--narrow">
      <p class="pub-breadcrumb"><a href="/">Bloodline</a> &rsaquo; Guides</p>
      <p class="pub-eyebrow">Guides</p>
      <h1 class="pub-hero__title" style="font-size:clamp(28px,4.6vw,42px);">Practical help for building and keeping a family history.</h1>
      <p class="pub-hero__sub">Written for real families, not research jargon. Short, specific, and honest about what to expect.</p>
    </div>
  </section>

  <section class="pub-section pub-section--tight">
    <div class="pub-wrap">
      <div class="pub-grid pub-grid--3">${cardsHtml}</div>
    </div>
  </section>

  <section class="pub-cta-band pub-section--ground">
    <div class="pub-wrap pub-wrap--narrow">
      <h2 class="pub-cta-band__title">Ready to start your own?</h2>
      <div class="pub-cta-band__row">
        <a class="pub-btn pub-btn--primary pub-btn--lg" href="/sign-in?start=fresh">Start your family tree</a>
        <a class="pub-btn pub-btn--secondary pub-btn--lg" href="/help">Get help</a>
      </div>
    </div>
  </section>`;

  const html = publicPage({
    home,
    path: '/guides',
    title: 'Guides — practical family-history help | Bloodline',
    description: 'Short, specific guides for starting a family tree, importing existing research, and building a tree that fits blended, adoptive, and chosen families.',
    activeKey: null,
    structuredData,
    content,
  });
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

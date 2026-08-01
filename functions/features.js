/*
 * GET /features
 * Feature sections use product evidence (what it is / why it matters / what
 * you control / limitations), not generic benefit cards.
 * See docs/PRODUCTIZATION-BRIEF.md §7 ("Features").
 */
import { publicPage, breadcrumbStructuredData } from './_lib/publicShell.js';
import { Icons } from './_lib/publicIcons.js';

function factRow(facts) {
  return `<div class="pub-feature-row__body">${facts.map((f) => `
        <div class="pub-fact"><div class="pub-fact__label">${f.label}</div><div class="pub-fact__body">${f.body}</div></div>`).join('')}</div>`;
}

function featureSection({ id, icon, title, sub, facts }) {
  return `
      <div class="pub-feature-row" id="${id}">
        <div class="pub-feature-row__head">
          <div class="pub-card__icon" style="margin-bottom:10px;">${icon}</div>
          <h3>${title}</h3>
          <p>${sub}</p>
        </div>
        ${factRow(facts)}
      </div>`;
}

export async function onRequestGet({ env }) {
  const home = env.APP_URL || 'https://myfamilybloodline.com';
  const structuredData = [
    breadcrumbStructuredData(home, [{ name: 'Home', href: '/' }, { name: 'Features' }]),
  ];

  const sections = [
    featureSection({
      id: 'tree', icon: Icons.tree(24), title: 'Family tree and views',
      sub: 'The tree is how you navigate; the profile is where the story lives.',
      facts: [
        { label: 'What it is', body: 'An interactive tree with three ways to look at the same family: an immersive, animated view; a traditional pedigree chart; and a plain, accessible list.' },
        { label: 'Why it matters', body: 'Different people read a family differently — some want to feel the shape of it, others just want to find a name quickly.' },
        { label: 'You control', body: 'Which view you use, and — with Family Perimeter, below — how much of a large tree you see at once.' },
        { label: 'Limitation', body: 'The immersive tree view is built for browsing and discovery, not for dense, print-style pedigree charts of very large trees; the list view covers that case instead.' },
      ],
    }),
    featureSection({
      id: 'profile', icon: Icons.people(24), title: 'People and life stories',
      sub: 'Every person has a real profile, not just a name and two dates.',
      facts: [
        { label: 'What it is', body: 'A profile page for each person: relationships, key life events, places lived, education, occupation, and — where recorded — military service.' },
        { label: 'Why it matters', body: 'A family tree is more meaningful when it holds a life, not just a lineage.' },
        { label: 'You control', body: 'What goes on each profile, and who can edit it, based on the role you give each family member.' },
        { label: 'Limitation', body: 'Bloodline doesn’t verify facts against outside genealogy records — what a profile says is what your family has recorded.' },
      ],
    }),
    featureSection({
      id: 'memories', icon: Icons.heart(24), title: 'Photos, documents, memories, and the Keepsake',
      sub: 'The material that makes a person feel like themselves.',
      facts: [
        { label: 'What it is', body: 'A photo gallery, a document archive (letters, certificates, records), short memories anyone can contribute, and the Keepsake — an AI-assisted illustrated biography woven from what your family has recorded.' },
        { label: 'Why it matters', body: 'Names and dates don’t carry a person’s voice. Photos, memories, and documents do.' },
        { label: 'You control', body: 'What gets uploaded, who can contribute a memory, and what a Keepsake edition includes — every section can be reviewed and edited by hand.' },
        { label: 'Limitation', body: 'A Keepsake narrative is AI-assisted writing based on your family’s own records, not an independently verified historical account — it should be read that way, and edited where it’s wrong.' },
      ],
    }),
    featureSection({
      id: 'timeline', icon: Icons.timeline(24), title: 'Timeline and insights',
      sub: 'The family, seen across time rather than one profile at a time.',
      facts: [
        { label: 'What it is', body: 'A family timeline of life events, plus a set of insight cards — records the family holds, generations alive together, places the family has lived, and more.' },
        { label: 'Why it matters', body: 'Patterns and milestones that aren’t obvious from a single profile often are once you can see the whole family across time.' },
        { label: 'You control', body: 'Insights are computed from what’s already in your tree — nothing extra to set up, and nothing sent outside your family’s own data.' },
        { label: 'Limitation', body: 'Insight cards need enough recorded dates and details to say something meaningful; a sparsely-filled tree will show fewer of them.' },
      ],
    }),
    featureSection({
      id: 'collaboration', icon: Icons.mail(24), title: 'Collaboration, invitations, and roles',
      sub: 'A family archive is more complete when more of the family helps build it.',
      facts: [
        { label: 'What it is', body: 'Email invitations with five roles — owner, co-admin, editor, contributor, and viewer — plus an activity feed showing what changed and who changed it.' },
        { label: 'Why it matters', body: 'Different relatives should be able to do different things: some should be able to restructure the tree, others should just be able to add a memory.' },
        { label: 'You control', body: 'Who gets invited, what role they receive, and — for anything a document adds automatically — the ability to review, correct, or remove it.' },
        { label: 'Limitation', body: 'Invitations go out by email only; there’s no public sign-up or way to join a family without being invited.' },
      ],
    }),
    featureSection({
      id: 'perimeter', icon: Icons.perimeter(24), title: 'Family Perimeter for large shared trees',
      sub: 'A personal lens on a tree that’s bigger than any one person needs to see at once.',
      facts: [
        { label: 'What it is', body: 'A per-viewer setting that scopes your default view to the relatives closest to you — direct lineage, siblings, a bounded circle of cousins — with a clear, reviewable boundary.' },
        { label: 'Why it matters', body: 'A tree with hundreds of people can be overwhelming to browse; a Perimeter keeps the everyday view focused without deleting or hiding anyone from the underlying archive.' },
        { label: 'You control', body: 'Your own Perimeter setting, and you can always step outside it to see the wider tree — it never restricts what actually exists, only what’s shown by default.' },
        { label: 'Limitation', body: 'It’s a personal display preference, not a privacy or access control — roles and invitations are what actually govern who can see and edit what.' },
      ],
    }),
    featureSection({
      id: 'import', icon: Icons.download(24), title: 'Import, deduplication, and export',
      sub: 'Bring an existing tree in, or take yours elsewhere — on your terms.',
      facts: [
        { label: 'What it is', body: 'GEDCOM import (the standard genealogy file format) with a review-before-apply screen, duplicate-person detection on both import and afterward, and GEDCOM export of your tree.' },
        { label: 'Why it matters', body: 'Years of prior genealogy work shouldn’t be trapped in one tool, and a family archive shouldn’t become a mess of duplicate records the moment it grows.' },
        { label: 'You control', body: 'Every import is reviewed before anything is applied — you choose which new people and updates to accept, and duplicate matches are flagged, never merged automatically.' },
        { label: 'Limitation', body: 'GEDCOM export currently covers people, relationships, dates, and places — not photos, documents, memories, or the Keepsake. A complete archive export (including media) is in progress and not yet generally available.' },
      ],
    }),
  ];

  const content = `
  <section class="pub-hero" style="padding-bottom:8px;">
    <div class="pub-wrap pub-wrap--narrow">
      <p class="pub-breadcrumb"><a href="/">Bloodline</a> &rsaquo; Features</p>
      <p class="pub-eyebrow">The product, evidenced</p>
      <h1 class="pub-hero__title" style="font-size:clamp(30px,5vw,44px);">See your family differently.</h1>
      <p class="pub-hero__sub">Seven pillars, each with what it is, why it matters, what you control, and any real limitation.</p>
      <div class="pub-hero__ctas"><a class="pub-btn pub-btn--primary pub-btn--lg" href="/start#fresh">See your family differently</a></div>
    </div>
  </section>

  <section class="pub-section pub-section--tight">
    <div class="pub-wrap">${sections.join('')}</div>
  </section>

  <section class="pub-cta-band pub-section--ground">
    <div class="pub-wrap pub-wrap--narrow">
      <h2 class="pub-cta-band__title">Bring your family in, at whatever pace fits.</h2>
      <div class="pub-cta-band__row">
        <a class="pub-btn pub-btn--primary pub-btn--lg" href="/start#fresh">Start your family tree</a>
        <a class="pub-btn pub-btn--secondary pub-btn--lg" href="/import">Import a GEDCOM</a>
      </div>
    </div>
  </section>`;

  const html = publicPage({
    home,
    path: '/features',
    title: 'Bloodline features: tree views, profiles, Keepsake, and more',
    description: 'A tour of what Bloodline actually does — family tree views, life-story profiles, photos and the Keepsake, collaboration and roles, Family Perimeter, and GEDCOM import/export — with real product boundaries, not generic claims.',
    activeKey: 'features',
    structuredData,
    content,
  });
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

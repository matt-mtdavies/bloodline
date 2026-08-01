/*
 * GET /privacy
 * A designed trust page, not the legal policy duplicated with different
 * type. Four answer-first modules, an explicit contact route, and links to
 * the actual legal documents (/privacy.html, /terms.html).
 * See docs/PRODUCTIZATION-BRIEF.md §7 ("Privacy & ownership").
 */
import { publicPage, breadcrumbStructuredData } from './_lib/publicShell.js';
import { Icons } from './_lib/publicIcons.js';

export async function onRequestGet({ env }) {
  const home = env.APP_URL || 'https://myfamilybloodline.com';
  const structuredData = [
    breadcrumbStructuredData(home, [{ name: 'Home', href: '/' }, { name: 'Privacy & ownership' }]),
  ];

  const modules = [
    {
      icon: Icons.people(24),
      title: 'Your family chooses who belongs',
      body: 'Nobody can see your tree without an invitation. Whoever starts a family tree becomes its first owner, and every other member joins by email invitation, with a role — owner, co-admin, editor, contributor, or viewer — that the inviter chooses for them. There is no public sign-up and no way to browse into a family from outside it.',
    },
    {
      icon: Icons.shield(24),
      title: 'Living people are protected',
      body: 'Bloodline is built around the idea that living relatives deserve real privacy, not just deceased ones. Profiles are visible only to the family members who’ve been invited in — never to search engines, never to the public web.',
    },
    {
      icon: Icons.noAd(24),
      title: 'Your family data is not advertising inventory',
      body: 'Bloodline does not sell family data, and does not use family content — names, relationships, photos, memories, documents, or activity — to target advertising. There are no third-party ad trackers in the product. Some optional AI features (like the Keepsake) process your family’s own content to help write a narrative; that processing is not used for advertising.',
    },
    {
      icon: Icons.download(24),
      title: 'You can export, correct, or remove your data',
      body: 'You can export your tree as a standard GEDCOM file at any time — see <a href="/import">what import and export currently cover</a>. Every person’s profile can be corrected directly by anyone with edit access, and an owner can remove a person, a document, or an entire family. If you need help with a data request beyond what’s available in the product, contact us below.',
    },
  ];

  const modulesHtml = modules.map((m) => `
        <div class="pub-privacy__item" style="grid-column: span 1;">
          <div class="pub-card__icon" style="margin-bottom:12px;">${m.icon}</div>
          <div class="pub-privacy__q">${m.title}</div>
          <div class="pub-privacy__a">${m.body}</div>
        </div>`).join('');

  const content = `
  <section class="pub-hero" style="padding-bottom:8px;">
    <div class="pub-wrap pub-wrap--narrow">
      <p class="pub-breadcrumb"><a href="/">Bloodline</a> &rsaquo; Privacy &amp; ownership</p>
      <p class="pub-eyebrow">Privacy &amp; ownership</p>
      <h1 class="pub-hero__title" style="font-size:clamp(30px,5vw,44px);">A family archive, not a data product.</h1>
      <p class="pub-hero__sub">Plain language first. The full legal policy is linked below for when you need it.</p>
    </div>
  </section>

  <section class="pub-section pub-section--tight">
    <div class="pub-wrap">
      <div class="pub-privacy">${modulesHtml}</div>
    </div>
  </section>

  <section class="pub-section pub-section--ground" id="contact">
    <div class="pub-wrap pub-wrap--narrow" style="text-align:center;">
      <p class="pub-eyebrow">Have a question, or a request?</p>
      <h2 class="pub-h2">Talk to a person, not a form.</h2>
      <p class="pub-lede" style="margin:0 auto 22px;">For privacy questions, data requests, or anything about how your family’s information is handled, reach us directly.</p>
      <a class="pub-btn pub-btn--primary pub-btn--lg" href="/help#contact">Contact support</a>
    </div>
  </section>

  <section class="pub-section">
    <div class="pub-wrap pub-wrap--narrow" style="text-align:center;">
      <p class="pub-lede" style="margin:0 auto 18px;">This page explains our approach in plain language. The legal documents below govern the relationship formally.</p>
      <div class="pub-cta-band__row">
        <a class="pub-btn pub-btn--secondary" href="/privacy.html">Read our Privacy Policy</a>
        <a class="pub-btn pub-btn--secondary" href="/terms.html">Read our Terms</a>
      </div>
    </div>
  </section>`;

  const html = publicPage({
    home,
    path: '/privacy',
    title: 'Privacy & ownership — how Bloodline protects your family’s data',
    description: 'Who can see living people, what family roles mean, whether your data trains AI or feeds advertising, and how export, correction, and deletion work — explained in plain language.',
    activeKey: 'privacy',
    structuredData,
    content,
  });
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/*
 * GET /how-it-works
 * Goal: eliminate fear for newcomers without becoming a help manual.
 * See docs/PRODUCTIZATION-BRIEF.md §7 ("How it works").
 */
import { publicPage, breadcrumbStructuredData } from './_lib/publicShell.js';
import { Icons } from './_lib/publicIcons.js';

export async function onRequestGet({ env }) {
  const home = env.APP_URL || 'https://myfamilybloodline.com';
  const structuredData = [
    breadcrumbStructuredData(home, [{ name: 'Home', href: '/' }, { name: 'How it works' }]),
  ];

  const steps = [
    {
      icon: Icons.spark(24),
      title: 'Start with what you know',
      desc: 'One name is enough to begin. You don’t need dates, records, or a completed pedigree — just someone you love.',
    },
    {
      icon: Icons.people(24),
      title: 'Add people and memories at your own pace',
      desc: 'Add parents, siblings, partners, and children as you think of them. Attach a photo, a memory, or a life detail whenever you have one — nothing has to be finished today.',
    },
    {
      icon: Icons.mail(24),
      title: 'Invite the relatives who should be part of it',
      desc: 'Send an invitation by email. Choose what each person can do — view, contribute, edit, or help administer — so the archive grows safely as more people join in.',
    },
    {
      icon: Icons.tree(24),
      title: 'Keep the archive understandable as it grows',
      desc: 'A Family Perimeter keeps your own view focused on the relatives closest to you, even in a tree with hundreds of people. Switch between an immersive tree, a traditional chart, or a simple list — whichever reads clearest to you.',
    },
  ];

  const stepsHtml = steps.map((s, i) => `
      <div class="pub-feature-row" style="${i === 0 ? 'border-top:none;' : ''}">
        <div class="pub-feature-row__head">
          <div class="pub-card__icon" style="margin-bottom:10px;">${s.icon}</div>
          <h3>${s.title}</h3>
        </div>
        <div class="pub-feature-row__body">
          <p class="pub-lede" style="max-width:none;">${s.desc}</p>
        </div>
      </div>`).join('');

  const content = `
  <section class="pub-hero" style="padding-bottom:8px;">
    <div class="pub-wrap pub-wrap--narrow">
      <p class="pub-breadcrumb"><a href="/">Bloodline</a> &rsaquo; How it works</p>
      <p class="pub-eyebrow">How Bloodline helps families preserve their stories</p>
      <h1 class="pub-hero__title" style="font-size:clamp(30px,5vw,44px);">From one name to a shared family legacy.</h1>
      <p class="pub-hero__sub">No genealogy expertise required. Here’s the whole journey, honestly described.</p>
      <div class="pub-hero__ctas"><a class="pub-btn pub-btn--primary pub-btn--lg" href="/start#fresh">Begin with your family</a></div>
    </div>
  </section>

  <section class="pub-section pub-section--tight">
    <div class="pub-wrap">
      ${stepsHtml}
    </div>
  </section>

  <section class="pub-section pub-section--ground">
    <div class="pub-wrap pub-wrap--narrow">
      <p class="pub-eyebrow">What Bloodline does &mdash; and doesn’t</p>
      <h2 class="pub-h2">An honest boundary</h2>
      <div class="pub-check-list" style="margin-top:20px;">
        <div class="pub-check pub-check--yes">${Icons.check(18)}<span>It preserves and organises the family history your family already knows and records — people, relationships, photos, documents, memories, and a life timeline.</span></div>
        <div class="pub-check pub-check--yes">${Icons.check(18)}<span>It gives you a private, invitation-only place to build that history together, with roles that control who can see and change what.</span></div>
        <div class="pub-check pub-check--no">${Icons.cross(18)}<span>It does not automatically prove historical facts, verify records, or research your ancestry for you — what goes into the tree is what your family adds.</span></div>
        <div class="pub-check pub-check--no">${Icons.cross(18)}<span>It does not expose a public tree or searchable profiles. Nothing your family builds becomes public by using Bloodline.</span></div>
      </div>
    </div>
  </section>

  <section class="pub-cta-band">
    <div class="pub-wrap pub-wrap--narrow">
      <h2 class="pub-cta-band__title">Ready to begin?</h2>
      <div class="pub-cta-band__row">
        <a class="pub-btn pub-btn--primary pub-btn--lg" href="/start#fresh">Start fresh</a>
        <a class="pub-btn pub-btn--secondary pub-btn--lg" href="/start#import">Import a GEDCOM instead</a>
      </div>
    </div>
  </section>`;

  const html = publicPage({
    home,
    path: '/how-it-works',
    title: 'How Bloodline helps families preserve their stories',
    description: 'From one name to a shared family legacy: how adding people, memories, and invitations actually works in Bloodline — and what the product does and doesn’t do.',
    activeKey: 'how-it-works',
    structuredData,
    content,
  });
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

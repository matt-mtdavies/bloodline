/*
 * GET /guides/family-tree-for-blended-and-chosen-families
 * Theme: "Will this represent my family accurately?" — Bloodline's
 * strongest differentiator per docs/PRODUCTIZATION-BRIEF.md §4 (competitive
 * posture) and product principle #6 ("every family counts"). Grounded only
 * in real, shipped relationship modeling: biological/step/adoptive
 * qualifiers, derived full/half/step siblings, and custom kin terms — see
 * src/components/AddRelativeSheet.jsx and src/data/graph.js.
 */
import { publicPage, breadcrumbStructuredData, articleStructuredData } from '../_lib/publicShell.js';
import { Icons } from '../_lib/publicIcons.js';

const PUBLISHED = '2026-08-01';
const MODIFIED = '2026-08-01';

export async function onRequestGet({ env }) {
  const home = env.APP_URL || 'https://myfamilybloodline.com';
  const path = '/guides/family-tree-for-blended-and-chosen-families';
  const title = 'Building a family tree that includes adoptive, step, blended, and chosen family';
  const description = 'Most family-tree tools assume one mother, one father, one clean line down. Real families are rarely that tidy. Here’s how to record step, adoptive, blended, and chosen relationships as they actually happened.';

  const structuredData = [
    breadcrumbStructuredData(home, [{ name: 'Home', href: '/' }, { name: 'Guides', href: '/guides' }, { name: 'Family trees for blended and chosen families' }]),
    articleStructuredData(home, { path, title, description, datePublished: PUBLISHED, dateModified: MODIFIED }),
  ];

  const content = `
  <section class="pub-hero" style="padding-bottom:8px;">
    <div class="pub-wrap pub-wrap--narrow">
      <p class="pub-breadcrumb"><a href="/">Bloodline</a> &rsaquo; <a href="/guides">Guides</a> &rsaquo; Blended and chosen families</p>
      <p class="pub-eyebrow">Family structures</p>
      <h1 class="pub-hero__title" style="font-size:clamp(28px,4.6vw,42px);">${title}</h1>
    </div>
  </section>

  <section class="pub-section pub-section--tight">
    <div class="pub-wrap pub-wrap--narrow">
      <div class="pub-guide-meta"><span>Reviewed 1 August 2026</span><span>&middot;</span><span>5 min read</span></div>

      <div class="pub-article">
        <p>A lot of family-tree software quietly assumes every child has exactly one mother and one father, and that every relationship is permanent from birth. Real families include divorce and remarriage, adoption, step-parents who raised someone from age two, and people who were family in every sense except a biological or legal one. None of that is an edge case &mdash; it's most families, at some point. Here's how to record it accurately.</p>

        <h2>Biological, step, and adoptive &mdash; as three real options, not workarounds</h2>
        <p>When you add a parent-child relationship, you choose whether it's biological, step, or adoptive. This isn't a label bolted on after the fact: it changes how the relationship is described everywhere in the tree. A child can have more than one father or mother recorded this way &mdash; a biological parent and a step-parent who raised them, for instance &mdash; and the tree understands the difference between them rather than forcing you to pick one.</p>

        <h2>Siblings sort themselves out correctly</h2>
        <p>You never have to tell Bloodline that two children are half-siblings or step-siblings &mdash; it works that out from the parents already recorded. Two children who share exactly one biological parent show as half-siblings; two children brought together by a parent's remarriage, with no shared biological parent, show as step-siblings. The same logic reaches further out automatically: a step-sibling's own children show correctly as step-nieces and -nephews, not as blood relatives they aren't.</p>

        <h3>A remarriage, worked through</h3>
        <p>Say a mother remarries after a divorce, and her new partner already has a child from a previous relationship. In Bloodline: the mother's ex-partner stays recorded as a former partner (not deleted &mdash; the children's biological father is still their biological father); her new partner is added as a current partner; and if her new partner's existing child comes to live with them, that child can be added as a step-child of the mother. Her own children and her new partner's child then automatically show as step-siblings of each other, with no manual sibling-labelling step at all.</p>

        <h2>Recognizing family that isn't biological or legally adoptive</h2>
        <p>Not every relationship that matters fits "biological" or "adoptive" &mdash; a grandparent who raised a grandchild, a family friend who was genuinely a parent in every way but paperwork, a godparent who filled a real role. Bloodline doesn't force a false biological or legal label onto a relationship like this. Record the practical shape of it &mdash; most often as a step-style relationship, since that's the closest structural match to "raised by, not born to" &mdash; and use that person's biography to say, in your own words, who they actually were to the family. The tree's structure and the written story work together; neither has to carry the whole truth alone.</p>

        <div class="pub-callout">
          <p><strong>Every family member's own words matter here.</strong> A biography field, a life-event timeline, and short contributed memories all exist specifically so the relationship a chart can't fully capture &mdash; "she was the one who actually raised me" &mdash; still has somewhere to live, attached directly to that person's profile.</p>
        </div>

        <h2>Even the words can be your family's own</h2>
        <p>Not every family calls a grandmother "Grandma." Bloodline lets each person set their own preferred terms &mdash; Nonna and Nonno, Oma and Opa, or a custom pair you type yourself &mdash; and it applies per side, so a paternal-Italian and maternal-German family can use both correctly on the same tree at once. It's a small detail, but it's often the first thing that makes a family tree feel like it was actually built for your family rather than translated for it.</p>

        <h2>Privacy for the family members it matters most for</h2>
        <p>Blended and chosen families often include people &mdash; especially children, and especially children of a remarriage or an ongoing custody situation &mdash; where privacy matters more than usual. Bloodline is invitation-only by default: nothing is public, and every family member's visibility is controlled by the roles you grant, not by default exposure. See <a href="/privacy">Privacy &amp; ownership</a> for the full picture.</p>
      </div>
    </div>
  </section>

  <section class="pub-section pub-section--ground">
    <div class="pub-wrap">
      <div class="pub-grid pub-grid--3">
        <div class="pub-card">
          <div class="pub-card__icon">${Icons.spark(22)}</div>
          <h3 class="pub-card__title">Never built a tree before?</h3>
          <p class="pub-card__desc">Start with one name — no dates or research required, and every relationship shape above is available from the very first person you add.</p>
          <a class="pub-card__link" href="/guides/how-to-start-a-family-tree">Read the guide &rarr;</a>
        </div>
        <div class="pub-card">
          <div class="pub-card__icon">${Icons.doc(22)}</div>
          <h3 class="pub-card__title">Migrating existing research?</h3>
          <p class="pub-card__desc">GEDCOM files carry adoptive and step relationships already — here's what to check when you bring one in.</p>
          <a class="pub-card__link" href="/guides/import-a-gedcom-file">Read the guide &rarr;</a>
        </div>
        <div class="pub-card">
          <div class="pub-card__icon">${Icons.shield(22)}</div>
          <h3 class="pub-card__title">Living people and children</h3>
          <p class="pub-card__desc">How roles, invitations, and access actually work for the people in your family who need the most protection.</p>
          <a class="pub-card__link" href="/privacy">Privacy &amp; ownership &rarr;</a>
        </div>
      </div>
    </div>
  </section>

  <section class="pub-cta-band">
    <div class="pub-wrap pub-wrap--narrow">
      <h2 class="pub-cta-band__title">Build a tree that looks like your actual family.</h2>
      <div class="pub-cta-band__row">
        <a class="pub-btn pub-btn--primary pub-btn--lg" href="/sign-in?start=fresh">Start your family tree</a>
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

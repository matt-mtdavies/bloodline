/*
 * GET /start
 * The first-time start-path chooser: a focused route chooser shown before
 * requiring any effortful onboarding. Three paths, each handing off to
 * /sign-in with a ?start= context so a brand-new account lands in the right
 * place after authentication (see src/App.jsx's _initialStartIntent and
 * functions/sign-in.js). See docs/PRODUCTIZATION-BRIEF.md §8.
 */
import { publicPage, breadcrumbStructuredData } from './_lib/publicShell.js';
import { Icons } from './_lib/publicIcons.js';

export async function onRequestGet({ env }) {
  const home = env.APP_URL || 'https://myfamilybloodline.com';
  const structuredData = [
    breadcrumbStructuredData(home, [{ name: 'Home', href: '/' }, { name: 'Start your family tree' }]),
  ];

  const content = `
  <section class="pub-section" style="padding-bottom:24px;">
    <div class="pub-wrap pub-wrap--narrow" style="text-align:center;">
      <p class="pub-breadcrumb" style="text-align:left;"><a href="/">Bloodline</a> &rsaquo; Start your family tree</p>
      <p class="pub-eyebrow">However you're starting</p>
      <h1 class="pub-hero__title" style="font-size:clamp(28px,4.6vw,40px); margin-bottom:12px;">How would you like to begin?</h1>
      <p class="pub-lede" style="margin:0 auto;">Pick whichever fits — you're never locked into it, and every path leads to the same private family tree.</p>
    </div>
  </section>

  <section class="pub-section pub-section--tight">
    <div class="pub-wrap">
      <div class="pub-paths">
        <div class="pub-path pub-path--fresh" id="fresh">
          <div class="pub-path__icon">${Icons.spark(22)}</div>
          <div class="pub-path__title">Start fresh</div>
          <div class="pub-path__desc">Begin gently with the people you know. About two minutes, and you can skip anything for later — a guided first step, not a form full of genealogy jargon.</div>
          <a class="pub-btn pub-btn--primary pub-btn--block" href="/sign-in?start=fresh">Start fresh</a>
        </div>
        <div class="pub-path pub-path--import" id="import">
          <div class="pub-path__icon">${Icons.download(22)}</div>
          <div class="pub-path__title">Import my GEDCOM</div>
          <div class="pub-path__desc">Already have a tree in another tool? Sign in, then bring it in through a guided, review-before-apply import. <a href="/import" style="color:var(--sage); font-weight:700;">See what's included</a>.</div>
          <a class="pub-btn pub-btn--primary pub-btn--block" href="/sign-in?start=import">Import my GEDCOM</a>
        </div>
        <div class="pub-path pub-path--invite" id="invite">
          <div class="pub-path__icon">${Icons.mail(22)}</div>
          <div class="pub-path__title">I have an invitation</div>
          <div class="pub-path__desc">Already invited to a family? Sign in with the same email address the invitation was sent to, and you'll land right in that family's tree.</div>
          <a class="pub-btn pub-btn--primary pub-btn--block" href="/sign-in?start=invite">Sign in</a>
        </div>
      </div>
    </div>
  </section>

  <section class="pub-section pub-section--ground">
    <div class="pub-wrap pub-wrap--narrow" style="text-align:center;">
      <p class="pub-eyebrow">Not sure yet?</p>
      <h2 class="pub-h2" style="font-size:24px;">See how it works first.</h2>
      <p class="pub-lede" style="margin:0 auto 20px;">Take a look at the journey from one name to a shared family legacy before you sign in.</p>
      <a class="pub-btn pub-btn--secondary" href="/how-it-works">How it works</a>
    </div>
  </section>`;

  const html = publicPage({
    home,
    path: '/start',
    title: 'Start your family tree — Bloodline',
    description: 'Start a new family tree, import an existing GEDCOM file, or sign in to an invitation — choose how you want to begin with Bloodline.',
    activeKey: null,
    structuredData,
    content,
  });
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/*
 * GET /help
 * Launch with compact, excellent answers — not a placeholder knowledge base.
 * Search can wait until there are enough articles to justify it.
 * See docs/PRODUCTIZATION-BRIEF.md §7 ("Help").
 */
import { publicPage, breadcrumbStructuredData } from './_lib/publicShell.js';

const FAQ = [
  {
    q: 'I was invited to a family — what do I do?',
    a: 'Open the invitation email and follow its link. You’ll see which family invited you, who sent it, and what role you’ve been offered, before you sign in. Enter your email to get a one-time sign-in code — no password to create or remember.',
  },
  {
    q: 'How do I start a new family tree?',
    a: '<a href="/start#fresh">Choose "Start fresh"</a>, sign in with your email, and begin with your own name. Add the people closest to you first — parents, siblings, partner, children — and add photos, memories, or other details whenever you have them. It takes about two minutes to get a first tree on screen; everything else can wait.',
  },
  {
    q: 'How do I import a GEDCOM file?',
    a: '<a href="/start#import">Choose "Import a GEDCOM"</a> after signing in, then upload the file exported from your previous genealogy tool. You’ll see a review screen showing exactly what’s new and what would change before anything is saved — see the <a href="/import">full import page</a> for what does and doesn’t come across.',
  },
  {
    q: 'How do I add or correct a person’s details?',
    a: 'Open their profile and use Edit (visible if your role allows editing). You can update names, dates, places, occupation, education, and relationships directly. If a document upload added something incorrect, you can remove that document and the facts it added are cleaned up with it.',
  },
  {
    q: 'How do I invite a relative, and what do the roles mean?',
    a: 'From Family Settings, send an invitation by email and choose a role: <strong>Viewer</strong> can look but not change anything; <strong>Contributor</strong> can add memories and photos; <strong>Editor</strong> can add and update people and relationships; <strong>Co-admin</strong> can also manage invitations and settings; <strong>Owner</strong> has full control, including deleting the family tree. You can change anyone’s role later.',
  },
  {
    q: 'How does Bloodline protect living people and children?',
    a: 'Only invited family members can see a tree at all — nothing is public. Within a family, every profile (living or deceased) is visible to the roles you’ve granted; there’s no separate public-facing mode. See <a href="/privacy">Privacy &amp; ownership</a> for the full picture.',
  },
  {
    q: 'How do export, deletion, and data requests work?',
    a: 'You can export your tree as a standard GEDCOM file at any time from Family Settings — see <a href="/import">what’s currently included</a>. An owner can delete a person, a document, or the whole family tree from the same place. For anything beyond that — like a full personal-data request — <a href="/help#contact">contact us</a> directly.',
  },
  {
    q: 'What if I have a problem GEDCOM import can’t explain?',
    a: 'Reach out with your question and, if it’s about an import, roughly how many people and which genealogy tool exported the file — that’s usually enough for us to help quickly. See <a href="/help#contact">Contact support</a> below.',
  },
];

function faqHtml() {
  return FAQ.map((f, i) => `
      <details${i === 0 ? ' open' : ''}>
        <summary>${f.q}<span class="pub-faq__chev"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span></summary>
        <div class="pub-faq__body"><p>${f.a}</p></div>
      </details>`).join('');
}

export async function onRequestGet({ env }) {
  const home = env.APP_URL || 'https://myfamilybloodline.com';
  const structuredData = [
    breadcrumbStructuredData(home, [{ name: 'Home', href: '/' }, { name: 'Help' }]),
  ];

  const content = `
  <section class="pub-hero" style="padding-bottom:8px;">
    <div class="pub-wrap pub-wrap--narrow">
      <p class="pub-breadcrumb"><a href="/">Bloodline</a> &rsaquo; Help</p>
      <p class="pub-eyebrow">Help</p>
      <h1 class="pub-hero__title" style="font-size:clamp(30px,5vw,44px);">Answers to the questions that come up first.</h1>
      <p class="pub-hero__sub">Compact and specific, not a sprawling knowledge base. If your question isn’t here, just ask us.</p>
    </div>
  </section>

  <section class="pub-section pub-section--tight">
    <div class="pub-wrap pub-wrap--narrow">
      <div class="pub-faq">${faqHtml()}</div>
    </div>
  </section>

  <section class="pub-section pub-section--ground" id="contact">
    <div class="pub-wrap pub-wrap--narrow" style="text-align:center;">
      <p class="pub-eyebrow">Still stuck?</p>
      <h2 class="pub-h2">Contact support</h2>
      <p class="pub-lede" style="margin:0 auto 22px;">Email <a href="mailto:support@myfamilybloodline.com" style="color:var(--accent-deep); font-weight:700;">support@myfamilybloodline.com</a> and a real person will reply. This address is monitored during business hours; response times aren’t yet formally guaranteed.</p>
    </div>
  </section>

  <section class="pub-section" id="accessibility">
    <div class="pub-wrap pub-wrap--narrow">
      <p class="pub-eyebrow">Accessibility statement</p>
      <h2 class="pub-h2" style="font-size:22px;">Built to work with a keyboard, a screen reader, and a small screen.</h2>
      <p class="pub-lede" style="max-width:none;">Bloodline’s public pages are designed for keyboard navigation, visible focus states, and screen readers, and every interactive control targets at least 44&times;44px on touch devices. The in-app tree canvas is a richer, visual experience; a plain accessible list view of the same family is always available as an alternative. If something isn’t working with your assistive technology, please <a href="/help#contact">tell us</a> — we want to know.</p>
    </div>
  </section>`;

  const html = publicPage({
    home,
    path: '/help',
    title: 'Help — getting started, invitations, privacy, and import',
    description: 'Compact answers to the questions people ask first: joining an invitation, starting a tree, importing a GEDCOM, roles and privacy, and how to export or delete your data.',
    activeKey: null,
    structuredData,
    content,
  });
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

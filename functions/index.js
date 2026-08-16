/*
 * GET /
 *
 * Signed-out visitors get a fast, server-rendered marketing homepage (this
 * file). Everyone else — an authenticated session, or a request carrying any
 * of the query-param signals the in-app flows already rely on (?demo, ?new,
 * ?invite, ?pending_invite, ?person, ?auth, ?auth_email, ?start, ?lab) —
 * falls straight through to the existing untouched SPA via env.ASSETS.fetch().
 *
 * This is deliberately the ONLY behavior change at "/": every existing
 * entry point (magic-link redirect, invite handoff, demo mode, calendar deep
 * links, onboarding) still resolves to exactly the same SPA response it did
 * before this file existed. See docs/PRODUCTIZATION-BRIEF.md §6, §16.
 */
import { publicPage, organizationStructuredData } from './_lib/publicShell.js';
import { Icons } from './_lib/publicIcons.js';

// Every query-param signal a currently-shipping in-app flow reads at the
// SPA root. Any one of these present means "this is a live product flow,
// not a fresh marketing visit" — fall through unchanged.
const FLOW_PARAMS = ['demo', 'new', 'invite', 'pending_invite', 'person', 'auth', 'auth_email', 'start', 'otp', 'lab'];

export async function onRequestGet({ request, env, data }) {
  const url = new URL(request.url);
  const hasFlowParam = FLOW_PARAMS.some((p) => url.searchParams.has(p));
  const isAuthed = !!data?.user;

  if (isAuthed || hasFlowParam) {
    const res = await env.ASSETS.fetch(request);
    // The authenticated app / in-flight auth handoffs must never be indexed —
    // robots.txt keeps crawlers off query-string URLs, but a defensive header
    // here means the rule holds even if something links to one directly.
    const headers = new Headers(res.headers);
    headers.set('X-Robots-Tag', 'noindex, nofollow');
    return new Response(res.body, { status: res.status, headers });
  }

  const home = env.APP_URL || 'https://myfamilybloodline.com';
  return new Response(homeHtml(home), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function homeHtml(home) {
  const structuredData = [
    ...organizationStructuredData(home),
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Bloodline',
      applicationCategory: 'LifestyleApplication',
      operatingSystem: 'Web',
      url: home + '/',
      // Deliberately no `offers` block — asserting a $0 price in indexable
      // structured data (a literal Google "Free" badge) would go stale the
      // moment any paid tier ships, and the business model isn't decided
      // yet (design review, marketing-site-review). Add it back only once
      // there's a real price to declare, whatever that turns out to be.
      description: 'A private family tree, photo, and story archive that families build and keep together.',
    },
  ];

  const content = `
${heroSection()}
${trustSection()}
${storySection()}
${featureProofSection()}
${startingPathsSection()}
${privacySection()}
${closingCtaSection()}
`;

  return publicPage({
    home,
    path: '/',
    title: 'Bloodline — a private home for family history',
    description: 'Bring the people, memories, photographs, and stories that make your family yours, then share them with the people who belong in it. Free to begin, private by default.',
    activeKey: null,
    structuredData,
    content,
  });
}

function heroSection() {
  return `
  <section class="pub-hero">
    <div class="pub-wrap">
      <div class="pub-hero__grid">
        <div>
          <p class="pub-eyebrow">A private home for family history</p>
          <h1 class="pub-hero__title">Your family is more than names and dates.</h1>
          <p class="pub-hero__sub">Bring the people, memories, photographs, and stories that make your family yours&nbsp;&mdash; then share them with the people who belong in it.</p>
          <div class="pub-hero__ctas">
            <a class="pub-btn pub-btn--primary pub-btn--lg" href="/start">Start your family tree</a>
            <a class="pub-btn pub-btn--secondary pub-btn--lg" href="/how-it-works">See how it works</a>
          </div>
          <p class="pub-hero__reassurance">
            <span>${Icons.check(16)} Free to begin</span>
            <span>${Icons.lock(16)} No password</span>
            <span>${Icons.shield(16)} Private by default</span>
          </p>
        </div>
        <div>
          <div class="pub-hero__art">${heroArt()}</div>
          <p class="pub-hero__caption">An illustrative example family &mdash; not real people.</p>
        </div>
      </div>
    </div>
  </section>`;
}

// A composed, static "family taking shape" scene: no live canvas, no photos —
// just circles, connecting lines, and two small story fragments, in the same
// warm palette as the product itself. Fast (inline SVG, no image requests),
// understandable at a glance, and legible at any viewport width.
function heroArt() {
  return `<svg viewBox="0 0 560 460" role="img" aria-labelledby="heroArtTitle">
    <title id="heroArtTitle">A small illustrative family tree with photo and story fragments attached to two people</title>
    <rect width="560" height="460" fill="#faf6ee"/>
    <g stroke="#c2603a" stroke-width="2" opacity="0.35">
      <line x1="200" y1="120" x2="150" y2="230"/>
      <line x1="200" y1="120" x2="260" y2="230"/>
    </g>
    <g stroke="#3f5e4e" stroke-width="2" opacity="0.35">
      <line x1="360" y1="150" x2="260" y2="230"/>
      <line x1="360" y1="150" x2="410" y2="260"/>
    </g>
    <g stroke="#b08642" stroke-width="2" opacity="0.35">
      <line x1="150" y1="230" x2="150" y2="340"/>
      <line x1="260" y1="230" x2="230" y2="345"/>
      <line x1="260" y1="230" x2="300" y2="345"/>
    </g>
    <circle cx="200" cy="120" r="34" fill="#c2603a"/>
    <circle cx="360" cy="150" r="30" fill="#3f5e4e"/>
    <circle cx="150" cy="230" r="26" fill="#e0a184"/>
    <circle cx="260" cy="230" r="30" fill="#c2603a"/>
    <circle cx="410" cy="260" r="24" fill="#8fa895"/>
    <circle cx="150" cy="340" r="20" fill="#b08642"/>
    <circle cx="230" cy="345" r="20" fill="#d8b378"/>
    <circle cx="300" cy="345" r="20" fill="#d8b378"/>
    <g font-family="Fraunces, Georgia, serif" font-weight="700" fill="#fff" text-anchor="middle">
      <text x="200" y="127" font-size="24">E</text>
      <text x="360" y="157" font-size="22">M</text>
      <text x="260" y="237" font-size="22">J</text>
    </g>
    <g transform="translate(330,60)">
      <rect width="150" height="56" rx="14" fill="#fff" stroke="#e8e2d6"/>
      <rect x="14" y="14" width="28" height="28" rx="6" fill="#f0d9cd"/>
      <text x="52" y="28" font-family="Hanken Grotesk, sans-serif" font-size="11.5" font-weight="700" fill="#1c1d21">Married, 1962</text>
      <text x="52" y="42" font-family="Hanken Grotesk, sans-serif" font-size="10.5" fill="#6b6f76">Cardiff, Wales</text>
    </g>
    <g transform="translate(60,380)">
      <rect width="168" height="56" rx="14" fill="#fff" stroke="#e8e2d6"/>
      <rect x="14" y="14" width="28" height="28" rx="6" fill="#d8e0d6"/>
      <text x="52" y="28" font-family="Hanken Grotesk, sans-serif" font-size="11.5" font-weight="700" fill="#1c1d21">&ldquo;She taught us to bake&rdquo;</text>
      <text x="52" y="42" font-family="Hanken Grotesk, sans-serif" font-size="10.5" fill="#6b6f76">A memory, added by a grandchild</text>
    </g>
  </svg>`;
}

function trustSection() {
  return `
  <section class="pub-section pub-section--tight">
    <div class="pub-wrap">
      <div class="pub-trust">
        <div class="pub-trust__item">
          <div class="pub-trust__icon">${Icons.lock(18)}</div>
          <div>
            <div class="pub-trust__title">Private by default</div>
            <div class="pub-trust__desc">Access belongs to the family you invite. Nothing is public unless your family chooses to share it. <a href="/privacy">How privacy works &rarr;</a></div>
          </div>
        </div>
        <div class="pub-trust__item">
          <div class="pub-trust__icon">${Icons.noAd(18)}</div>
          <div>
            <div class="pub-trust__title">No ads in your family story</div>
            <div class="pub-trust__desc">We don't use your family's data to target advertising &mdash; no third-party ad trackers, no exceptions. <a href="/privacy">Read our approach &rarr;</a></div>
          </div>
        </div>
        <div class="pub-trust__item">
          <div class="pub-trust__icon">${Icons.download(18)}</div>
          <div>
            <div class="pub-trust__title">Yours to keep</div>
            <div class="pub-trust__desc">Export your tree as a standard GEDCOM file any time &mdash; the same open format other genealogy tools use. <a href="/import">What import and export cover &rarr;</a></div>
          </div>
        </div>
      </div>
    </div>
  </section>`;
}

// Real product screenshots (illustrative demo family, not real people —
// see the caption under the beats below) replace what used to be four
// abstract SVG mockups, so a visitor sees the actual app rather than a
// stand-in for it. Each is a genuine screenshot, not a raw capture of the
// interface mid-use — a book cover, a compiled tree, a profile page, and
// the family constellation — chosen to read as a composed scene at this
// size, per the same "art-directed, not a live canvas" standard the hero
// image above already follows.
function beatArt(kind) {
  const img = (src, alt) => `<img src="${src}" alt="${alt}" loading="lazy" width="400" height="240" />`;
  if (kind === 'one-name') {
    return img('/images/story-begin.webp', 'The cover of a Bloodline Keepsake, showing one person’s name and portrait');
  }
  if (kind === 'take-shape') {
    return img('/images/story-shape.png', 'A family tree taking shape, with several people connected across two generations');
  }
  if (kind === 'keep') {
    return img('/images/story-keep.png', 'A person’s profile page, showing their birthplace, birth date, and parents');
  }
  return img('/images/story-share.webp', 'A family constellation diagram connecting several generations of one family');
}

function storySection() {
  const beats = [
    { num: '01', title: 'Start with someone you love.', desc: 'Enter one name, not a form full of genealogy jargon.', art: beatArt('one-name') },
    { num: '02', title: 'Let the family take shape.', desc: 'Add relationships in the way your family actually understands them &mdash; biological, step, adoptive, or chosen.', art: beatArt('take-shape') },
    { num: '03', title: 'Keep what only your family knows.', desc: 'Attach a photo, document, memory, or life detail to the right person.', art: beatArt('keep') },
    { num: '04', title: 'Share a living legacy.', desc: 'Invite relatives to view, contribute, and carry it forward.', art: beatArt('share') },
  ];
  const beatsHtml = beats.map((b, i) => `
      <div class="pub-beat${i % 2 ? ' pub-beat--reverse' : ''}">
        <div class="pub-beat__art">${b.art}</div>
        <div>
          <div class="pub-beat__num">${b.num}</div>
          <h3 class="pub-beat__title">${b.title}</h3>
          <p class="pub-beat__desc">${b.desc}</p>
        </div>
      </div>`).join('');
  return `
  <section class="pub-section pub-section--ground">
    <div class="pub-wrap pub-wrap--narrow">
      <p class="pub-eyebrow">How a tree grows here</p>
      <h2 class="pub-h2">One name, then the whole story.</h2>
    </div>
    <div class="pub-wrap" style="margin-top:36px;">
      <div class="pub-story">${beatsHtml}</div>
      <p class="pub-story__caption">Screens shown are an illustrative example family &mdash; not real people.</p>
    </div>
  </section>`;
}

function featureProofSection() {
  const cards = [
    { icon: Icons.tree(22), title: 'See the connections', desc: 'An immersive tree, a traditional chart, an accessible list, and your own Family Perimeter &mdash; the view that matters to you.', href: '/features#tree' },
    { icon: Icons.heart(22), title: 'Remember the person', desc: 'Profiles, memories, photographs, documents, a life timeline, and the Keepsake &mdash; an illustrated biography woven from what your family records.', href: '/features#profile' },
    { icon: Icons.people(22), title: 'Build it together', desc: 'Invitations, roles, an activity feed, and small contributions that add up &mdash; without handing over the whole archive.', href: '/features#collaboration' },
    { icon: Icons.download(22), title: 'Bring your history with you', desc: 'Import a GEDCOM, review every change before it applies, and keep duplicate safeguards on by default.', href: '/features#import' },
  ];
  const cardsHtml = cards.map((c) => `
      <div class="pub-card">
        <div class="pub-card__icon">${c.icon}</div>
        <h3 class="pub-card__title">${c.title}</h3>
        <p class="pub-card__desc">${c.desc}</p>
        <a class="pub-card__link" href="${c.href}">See how &rarr;</a>
      </div>`).join('');
  return `
  <section class="pub-section">
    <div class="pub-wrap">
      <p class="pub-eyebrow">What's inside</p>
      <h2 class="pub-h2">Built around the person, not the record.</h2>
      <div class="pub-grid pub-grid--4" style="margin-top:32px;">${cardsHtml}</div>
    </div>
  </section>`;
}

function startingPathsSection() {
  return `
  <section class="pub-section pub-section--ground">
    <div class="pub-wrap">
      <p class="pub-eyebrow">Wherever you're starting from</p>
      <h2 class="pub-h2">Bloodline is for you, however you begin.</h2>
      <div class="pub-paths" style="margin-top:32px;">
        <div class="pub-path pub-path--fresh">
          <div class="pub-path__icon">${Icons.spark(22)}</div>
          <div class="pub-path__title">Start a new family story</div>
          <div class="pub-path__desc">Begin gently with the people you know. About two minutes, and you can skip anything for later.</div>
          <a class="pub-btn pub-btn--secondary" href="/start#fresh">Start fresh</a>
        </div>
        <div class="pub-path pub-path--import">
          <div class="pub-path__icon">${Icons.download(22)}</div>
          <div class="pub-path__title">Bring an existing tree</div>
          <div class="pub-path__desc">Import a GEDCOM file and review every change before it applies to your tree.</div>
          <a class="pub-btn pub-btn--secondary" href="/start#import">Import a GEDCOM</a>
        </div>
        <div class="pub-path pub-path--invite">
          <div class="pub-path__icon">${Icons.mail(22)}</div>
          <div class="pub-path__title">Join a family</div>
          <div class="pub-path__desc">Already invited? Sign in with the same email address the invitation was sent to.</div>
          <a class="pub-btn pub-btn--secondary" href="/start#invite">Join your family</a>
        </div>
      </div>
    </div>
  </section>`;
}

function privacySection() {
  const items = [
    { q: 'Who can see living people?', a: 'Only the family members you invite. Living people’s details are visible to your family, never to the public web or search engines.' },
    { q: 'What do family roles mean?', a: 'Owners and co-admins manage the tree and invitations; editors and contributors can add and update people, memories, and photos; viewers can look but not change anything. You choose each relative’s role when you invite them.' },
    { q: 'Is any of this public or indexed?', a: 'No. Person profiles, photos, documents, memories, and your tree itself are never public and are never indexed by search engines &mdash; only the pages you’re reading right now (like this one) are.' },
    { q: 'Does family data train AI or get used for ads?', a: 'No. Bloodline never sells family data or uses it to target ads. Some optional features (like the Keepsake illustrated biography) use AI to help write a narrative from what your family has recorded &mdash; that processing stays scoped to your family’s own content.' },
  ];
  const itemsHtml = items.map((i) => `
        <div class="pub-privacy__item">
          <div class="pub-privacy__q">${i.q}</div>
          <div class="pub-privacy__a">${i.a}</div>
        </div>`).join('');
  return `
  <section class="pub-section">
    <div class="pub-wrap">
      <p class="pub-eyebrow">Privacy and ownership</p>
      <h2 class="pub-h2">A family archive, not a data product.</h2>
      <div class="pub-privacy" style="margin-top:28px;">${itemsHtml}</div>
      <p style="margin-top:24px;"><a class="pub-btn pub-btn--secondary" href="/privacy">Read our privacy policy &rarr;</a></p>
    </div>
  </section>`;
}

function closingCtaSection() {
  return `
  <section class="pub-section--ink pub-cta-band">
    <div class="pub-wrap pub-wrap--narrow">
      <h2 class="pub-cta-band__title">Start with one name. Keep a whole history.</h2>
      <div class="pub-cta-band__row">
        <a class="pub-btn pub-btn--primary pub-btn--lg" href="/start#fresh">Start your family tree</a>
        <a class="pub-btn pub-btn--secondary pub-btn--lg" href="/start#import">Bring a GEDCOM instead</a>
      </div>
    </div>
  </section>`;
}

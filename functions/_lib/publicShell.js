/*
 * Shared shell for Bloodline's public, signed-out pages: head metadata
 * (title/description/canonical/OG/Twitter/JSON-LD), header nav, and footer.
 * Plain server-rendered HTML — no React, no build step — so these pages are
 * fast, small, and fully readable by a crawler on the first response.
 * See docs/PRODUCTIZATION-BRIEF.md §5 (IA) and §16.5-16.7 (on-page/SEO).
 *
 * Every function here is pure string templating: safe to call from any
 * functions/*.js Pages Function. Styling lives in /public/public-site.css
 * (a static, cacheable file) rather than being inlined per response.
 */

const SITE_NAME = 'Bloodline';

export const NAV_LINKS = [
  { key: 'how-it-works', href: '/how-it-works', label: 'How it works' },
  { key: 'features', href: '/features', label: 'Features' },
  { key: 'privacy', href: '/privacy', label: 'Privacy & ownership' },
];

const FOOTER_COLUMNS = [
  {
    title: 'Product',
    links: [
      { href: '/how-it-works', label: 'How it works' },
      { href: '/features', label: 'Features' },
      { href: '/import', label: 'Import a GEDCOM' },
      { href: '/guides', label: 'Guides' },
    ],
  },
  {
    title: 'Support',
    links: [
      { href: '/help', label: 'Help' },
      { href: '/help#contact', label: 'Contact' },
    ],
  },
  {
    title: 'Trust',
    links: [
      { href: '/privacy', label: 'Privacy & ownership' },
      { href: '/privacy.html', label: 'Privacy Policy' },
      { href: '/terms.html', label: 'Terms' },
      { href: '/help#accessibility', label: 'Accessibility statement' },
    ],
  },
  {
    title: 'Account',
    links: [
      { href: '/sign-in', label: 'Sign in' },
      { href: '/start', label: 'Start your family tree' },
    ],
  },
];

export function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** The three-circle Bloodline mark, static (no CSS animation) for public pages. */
export function brandMark(size = 26) {
  const h = Math.round((size * 40) / 42);
  return `<svg width="${size}" height="${h}" viewBox="0 0 42 40" fill="none" aria-hidden="true">
    <circle cx="13.9" cy="16.5" r="11.8" fill="#c2603a" stroke="#fff" stroke-width="2.4"/>
    <circle cx="28.1" cy="16.5" r="11.8" fill="#3f5e4e" stroke="#fff" stroke-width="2.4"/>
    <circle cx="21" cy="30.6" r="7.8" fill="#b08642" stroke="#fff" stroke-width="2.4"/>
  </svg>`;
}

function headerHtml({ home, activeKey, ctaHref = '/start', ctaLabel = 'Start your family tree' }) {
  const navLinks = NAV_LINKS.map((l) => `<a href="${l.href}"${l.key === activeKey ? ' aria-current="page"' : ''}>${esc(l.label)}</a>`).join('');
  const menuLinks = [...NAV_LINKS, { href: '/import', label: 'Import a GEDCOM' }, { href: '/guides', label: 'Guides' }, { href: '/help', label: 'Help' }]
    .map((l) => `<a href="${l.href}"${l.key && l.key === activeKey ? ' aria-current="page"' : ''}>${esc(l.label)}</a>`).join('');
  return `
  <header class="pub-header">
    <div class="pub-header__inner">
      <a class="pub-brand" href="${home}/">${brandMark(26)}<span>${SITE_NAME}</span></a>
      <nav class="pub-nav" aria-label="Primary">${navLinks}</nav>
      <div class="pub-header__actions">
        <a class="pub-signin-link" href="/sign-in">Sign in</a>
        <a class="pub-btn pub-btn--primary pub-btn--cta" href="${ctaHref}"><span class="pub-btn--cta__full">${esc(ctaLabel)}</span><span class="pub-btn--cta__short">Start</span></a>
        <details class="pub-menu">
          <summary aria-label="Menu">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </summary>
          <div class="pub-menu__panel">
            ${menuLinks}
            <div class="pub-menu__divider"></div>
            <a href="/sign-in">Sign in</a>
          </div>
        </details>
      </div>
    </div>
  </header>`;
}

function footerHtml() {
  const cols = FOOTER_COLUMNS.map((col) => `
      <div class="pub-footer__col">
        <h4>${esc(col.title)}</h4>
        <ul>${col.links.map((l) => `<li><a href="${l.href}">${esc(l.label)}</a></li>`).join('')}</ul>
      </div>`).join('');
  const year = new Date().getFullYear();
  return `
  <footer class="pub-footer">
    <div class="pub-wrap">
      <div class="pub-footer__grid">
        <div>
          <a class="pub-footer__brand" href="/">${brandMark(24)}<span>${SITE_NAME}</span></a>
          <p class="pub-footer__tagline">A private home for family history — the people, memories, photographs, and stories that make your family yours.</p>
        </div>
        ${cols}
      </div>
      <div class="pub-footer__bottom">
        <span>&copy; ${year} Bloodline. Made for families, not advertisers.</span>
        <span>Private by default. Living people stay protected.</span>
      </div>
    </div>
  </footer>`;
}

/**
 * Renders a complete public HTML document.
 *
 * @param {object} opts
 * @param {string} opts.home - env.APP_URL, e.g. "https://myfamilybloodline.com"
 * @param {string} opts.path - the canonical path, e.g. "/features"
 * @param {string} opts.title - full <title> text (page-specific, no generic template)
 * @param {string} opts.description - meta description, human-written per page
 * @param {string} [opts.activeKey] - NAV_LINKS key to mark aria-current
 * @param {string} [opts.ogImage] - absolute or root-relative share image path
 * @param {Array<object>} [opts.structuredData] - JSON-LD objects to embed
 * @param {boolean} [opts.noindex] - true for pages that must never be indexed
 * @param {string} opts.content - the page body content HTML (inside <main>)
 * @param {string} [opts.ctaHref] - override the header's primary CTA target
 * @param {string} [opts.ctaLabel] - override the header's primary CTA label
 */
export function publicPage({
  home,
  path,
  title,
  description,
  activeKey = null,
  ogImage = '/og-image.png',
  structuredData = [],
  noindex = false,
  content,
  ctaHref,
  ctaLabel,
}) {
  const canonical = `${home}${path}`;
  const ogImageUrl = ogImage.startsWith('http') ? ogImage : `${home}${ogImage}`;
  const robots = noindex
    ? '<meta name="robots" content="noindex, nofollow">'
    : '<meta name="robots" content="index, follow">';
  const ldJson = structuredData.map((obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
${robots}
<meta name="theme-color" content="#c2603a">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">

<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${ogImageUrl}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${ogImageUrl}">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/public-site.css">
${ldJson}
</head>
<body class="pub">
<a class="pub-skip" href="#pub-main">Skip to content</a>
${headerHtml({ home, activeKey, ctaHref, ctaLabel })}
<main id="pub-main" class="pub-main">
${content}
</main>
${footerHtml()}
</body>
</html>`;
}

/** Organization + WebSite JSON-LD, meant for the homepage only (site root). */
export function organizationStructuredData(home) {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: SITE_NAME,
      url: home + '/',
      logo: `${home}/icon-512.png`,
      description: 'Bloodline is a private family tree, photo, and story archive for families to build and keep together.',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      url: home + '/',
    },
  ];
}

export function breadcrumbStructuredData(home, items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.href ? `${home}${item.href}` : undefined,
    })),
  };
}

/**
 * Article JSON-LD for a maintained guide (docs/PRODUCTIZATION-BRIEF.md §16.7).
 * `datePublished`/`dateModified` are plain 'YYYY-MM-DD' strings the guide
 * itself owns and bumps by hand on a real edit — never auto-generated at
 * request time, or every response would claim "modified today".
 */
export function articleStructuredData(home, { path, title, description, datePublished, dateModified }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    url: `${home}${path}`,
    author: { '@type': 'Organization', name: SITE_NAME },
    publisher: { '@type': 'Organization', name: SITE_NAME },
    datePublished,
    dateModified: dateModified || datePublished,
  };
}

export { SITE_NAME };

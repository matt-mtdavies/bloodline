/*
 * GET /robots.txt
 * Permits the public marketing/help site; blocks private application paths.
 * This is a hint, not the protection mechanism — sensitive responses also
 * carry X-Robots-Tag: noindex (see functions/index.js, functions/invite/
 * [token].js) and are gated by real server-side auth regardless of crawling.
 * See docs/PRODUCTIZATION-BRIEF.md §16.6.
 */
export async function onRequestGet({ env }) {
  const home = env.APP_URL || 'https://myfamilybloodline.com';
  const body = `User-agent: *
Disallow: /api/
Disallow: /admin.html
Disallow: /invite/
Disallow: /*?

Sitemap: ${home}/sitemap.xml
`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

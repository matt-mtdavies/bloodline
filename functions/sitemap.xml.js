/*
 * GET /sitemap.xml
 * Only real, canonical, indexable public routes — no authenticated or
 * user-generated URL is ever listed. See docs/PRODUCTIZATION-BRIEF.md §16.6.
 */
const ROUTES = [
  { path: '/', priority: '1.0', changefreq: 'weekly' },
  { path: '/how-it-works', priority: '0.8', changefreq: 'monthly' },
  { path: '/features', priority: '0.8', changefreq: 'monthly' },
  { path: '/privacy', priority: '0.6', changefreq: 'monthly' },
  { path: '/import', priority: '0.7', changefreq: 'monthly' },
  { path: '/help', priority: '0.6', changefreq: 'monthly' },
  { path: '/guides', priority: '0.6', changefreq: 'monthly' },
  { path: '/guides/how-to-start-a-family-tree', priority: '0.6', changefreq: 'monthly' },
  { path: '/guides/import-a-gedcom-file', priority: '0.6', changefreq: 'monthly' },
  { path: '/guides/family-tree-for-blended-and-chosen-families', priority: '0.6', changefreq: 'monthly' },
  { path: '/start', priority: '0.7', changefreq: 'monthly' },
  { path: '/sign-in', priority: '0.3', changefreq: 'yearly' },
  { path: '/privacy.html', priority: '0.3', changefreq: 'yearly' },
  { path: '/terms.html', priority: '0.3', changefreq: 'yearly' },
];

// The build date doubles as <lastmod> until individual pages track their own
// real edit dates — a deliberate simplification for the first launch PR.
const LASTMOD = new Date().toISOString().slice(0, 10);

export async function onRequestGet({ env }) {
  const home = env.APP_URL || 'https://myfamilybloodline.com';
  const urls = ROUTES.map((r) => `  <url>
    <loc>${home}${r.path}</loc>
    <lastmod>${LASTMOD}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
}

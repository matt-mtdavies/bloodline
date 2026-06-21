/*
 * GET /faces/:g/:n  — same-origin portrait proxy.
 *
 * The bubble tree renders portraits as WebGL textures, which a browser will
 * only accept from a CORS-clean source. The demo faces come from randomuser.me,
 * which doesn't send the cross-origin header, so loading them directly leaves
 * every bubble as a monogram. Streaming them through our own domain makes them
 * same-origin (and adds permissive CORS for good measure), so the wall of faces
 * actually appears. Responses are cached hard at the edge.
 *
 * This is also the right long-term shape: real uploaded photos will be served
 * same-origin from R2 the same way.
 */
export async function onRequestGet({ params }) {
  const g = params.g;
  const n = params.n;
  if (!/^(men|women)$/.test(g) || !/^\d{1,3}\.jpg$/.test(n)) {
    return new Response('Not found', { status: 404 });
  }

  const upstream = `https://randomuser.me/api/portraits/${g}/${n}`;
  const res = await fetch(upstream, {
    cf: { cacheTtl: 86400, cacheEverything: true },
  });
  if (!res.ok) return new Response('Upstream error', { status: 502 });

  return new Response(res.body, {
    headers: {
      'content-type': res.headers.get('content-type') || 'image/jpeg',
      'cache-control': 'public, max-age=604800, immutable',
      'access-control-allow-origin': '*',
    },
  });
}

/*
 * GET /api/photos/health
 * Quick check: is the R2 bucket bound and reachable?
 * Returns { r2: true } or { r2: false, reason: '...' }
 * No auth required — used for deployment verification only.
 */
export async function onRequestGet({ env }) {
  if (!env.DOCS) {
    return new Response(JSON.stringify({ r2: false, reason: 'DOCS binding not available' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }
  try {
    // List 1 object just to confirm the bucket is reachable.
    await env.DOCS.list({ limit: 1 });
    return new Response(JSON.stringify({ r2: true }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ r2: false, reason: e.message }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }
}

import { json } from '../../_lib/util.js';

/*
 * GET  /api/photos/:key  — serve a photo from R2 (no auth — UUID key is secret-by-obscurity)
 * DELETE /api/photos/:key  — delete a photo from R2 (auth required)
 *
 * Photos are UUID-keyed and immutable (new upload = new key), so GET can be
 * served with a long public cache and indexed by the service worker.
 */

export async function onRequestGet({ params, env }) {
  if (!env.DOCS) return json({ error: 'Storage not configured' }, { status: 503 });

  const obj = await env.DOCS.get(params.key);
  if (!obj) return json({ error: 'Not found' }, { status: 404 });

  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType || 'image/jpeg',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}

export async function onRequestDelete({ params, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DOCS) return json({ error: 'Storage not configured' }, { status: 503 });

  await env.DOCS.delete(params.key);
  return json({ ok: true });
}

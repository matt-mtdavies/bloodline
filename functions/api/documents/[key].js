import { json } from '../../_lib/util.js';

/*
 * GET  /api/documents/:key  — serve a file from R2
 * DELETE /api/documents/:key  — delete a file from R2
 *
 * Both are auth-gated. GET streams the file with appropriate content-type.
 * DELETE is fire-and-forget from the client; a 404 is treated as success.
 */

export async function onRequestGet({ params, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DOCS) return json({ error: 'Storage not configured' }, { status: 503 });

  const key = params.key;
  const obj = await env.DOCS.get(key);
  if (!obj) return json({ error: 'Not found' }, { status: 404 });

  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'cache-control': 'private, max-age=3600',
      'content-disposition': `inline; filename="${key}"`,
    },
  });
}

export async function onRequestDelete({ params, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DOCS) return json({ error: 'Storage not configured' }, { status: 503 });

  await env.DOCS.delete(params.key);
  return json({ ok: true });
}

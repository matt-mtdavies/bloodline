import { json, uid } from '../_lib/util.js';

/*
 * POST /api/documents  — upload a file to R2, return { key, url }
 *
 * Accepts multipart/form-data with a single "file" field.
 * Stores under a flat UUID-keyed path so URLs have no slashes in the key.
 * Auth-gated: requires a valid session cookie.
 */
export async function onRequestPost({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DOCS) return json({ error: 'Storage not configured' }, { status: 503 });

  let file;
  try {
    const form = await request.formData();
    file = form.get('file');
  } catch {
    return json({ error: 'Invalid form data' }, { status: 400 });
  }

  if (!file || typeof file === 'string') {
    return json({ error: 'No file in request' }, { status: 400 });
  }

  if (file.size > 20 * 1024 * 1024) {
    return json({ error: 'File too large (max 20 MB)' }, { status: 413 });
  }

  const rawName = file.name || 'file';
  const dotIdx = rawName.lastIndexOf('.');
  const ext = dotIdx !== -1 ? rawName.slice(dotIdx + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : 'bin';
  const key = `${uid('doc_')}.${ext}`;

  await env.DOCS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });

  return json({ key, url: `/api/documents/${key}` });
}

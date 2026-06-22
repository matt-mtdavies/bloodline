import { json, uid } from '../_lib/util.js';

/*
 * POST /api/photos  — upload a photo to R2, return { key, url }
 *
 * Accepts multipart/form-data with a single "file" field.
 * Stores under a flat UUID-keyed path; keys are unguessable so GET is public.
 * Auth-gated on write to prevent anonymous storage abuse.
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

  if (!file || typeof file === 'string' || !file.type?.startsWith('image/')) {
    return json({ error: 'Image file required' }, { status: 400 });
  }

  if (file.size > 10 * 1024 * 1024) {
    return json({ error: 'File too large (max 10 MB)' }, { status: 413 });
  }

  const ext = file.type === 'image/png' ? 'png' : 'jpg';
  const key = `${uid('ph_')}.${ext}`;

  await env.DOCS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });

  return json({ key, url: `/api/photos/${key}` });
}

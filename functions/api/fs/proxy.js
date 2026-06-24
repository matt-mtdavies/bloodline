/*
 * GET /api/fs/proxy?path=/platform/tree/...&qs=generations%3D4
 * Proxy for FamilySearch Tree API calls. Routes traffic through a Worker so
 * the browser avoids cross-origin restrictions on api.familysearch.org.
 *
 * The client sends its access token via Authorization: Bearer <token>.
 * The Worker forwards it to FamilySearch and returns the GEDCOM-X JSON.
 *
 * path  — required: must start with /platform/tree/
 * qs    — optional: pre-encoded query string (without the leading ?)
 */
export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const fsPath = url.searchParams.get('path');
  const fsQs = url.searchParams.get('qs') || '';

  if (!fsPath || !fsPath.startsWith('/platform/tree/')) {
    return Response.json({ error: 'Invalid path' }, { status: 400 });
  }

  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return Response.json({ error: 'Missing access token' }, { status: 401 });
  }

  const fsUrl = `https://api.familysearch.org${fsPath}${fsQs ? '?' + fsQs : ''}`;

  const res = await fetch(fsUrl, {
    headers: {
      Authorization: auth,
      Accept: 'application/x-fs-v1+json',
    },
  });

  // Pass through whatever FamilySearch returns.
  const data = await res.json();
  return Response.json(data, { status: res.status });
}

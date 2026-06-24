/*
 * POST /api/fs/token
 * Exchange a FamilySearch OAuth authorization code for an access token.
 * Done server-side so the client_id is held in an env var (FAMILYSEARCH_CLIENT_ID)
 * and the token endpoint is reached without CORS restrictions.
 *
 * Body (JSON): { code, code_verifier, redirect_uri }
 * Response: { access_token } | { error }
 */
export async function onRequestPost({ request, env }) {
  const clientId = env.FAMILYSEARCH_CLIENT_ID;
  if (!clientId) {
    return Response.json(
      { error: 'FamilySearch integration not configured. Set FAMILYSEARCH_CLIENT_ID.' },
      { status: 503 },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { code, code_verifier, redirect_uri } = body;
  if (!code || !code_verifier || !redirect_uri) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const tokenRes = await fetch(
    'https://ident.familysearch.org/cis-web/oauth2/v3/token',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        redirect_uri,
        code_verifier,
      }),
    },
  );

  const data = await tokenRes.json();
  if (!tokenRes.ok) {
    return Response.json(
      { error: data.error_description || data.error || 'Token exchange failed' },
      { status: 400 },
    );
  }

  // Return only the access token — don't expose refresh tokens or user info.
  return Response.json({ access_token: data.access_token });
}

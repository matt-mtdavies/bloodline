import { json, clearSessionCookie } from '../../_lib/util.js';

/*
 * POST /api/auth/logout
 * Clears the session cookie. The token stays in D1 (already used=consumed),
 * so there is nothing else to invalidate server-side.
 */
export async function onRequestPost() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'content-type': 'application/json',
      'set-cookie': clearSessionCookie(),
    },
  });
}

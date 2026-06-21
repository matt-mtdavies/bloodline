import { verifySession, verifySessionValue } from './_lib/util.js';

// Verifies session from either the httpOnly cookie (desktop) or the
// X-Bl-Session header (mobile — localStorage avoids iOS Safari cookie issues).
export async function onRequest(context) {
  const secret = context.env.SESSION_SECRET || 'dev';
  const cookie = context.request.headers.get('cookie') || '';
  const headerToken = context.request.headers.get('x-bl-session') || '';

  context.data.user = await (
    headerToken
      ? verifySessionValue(headerToken, secret)
      : verifySession(cookie, secret)
  ).catch(() => null);

  return context.next();
}

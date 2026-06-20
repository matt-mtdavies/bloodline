import { verifySession } from './_lib/util.js';

// Runs before every Pages Function. Verifies the session cookie and attaches
// the decoded payload to context.data.user (null if not authenticated).
export async function onRequest(context) {
  const cookie = context.request.headers.get('cookie') || '';
  context.data.user = await verifySession(
    cookie,
    context.env.SESSION_SECRET || 'dev',
  ).catch(() => null);
  return context.next();
}

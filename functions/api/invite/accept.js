import { json } from '../../_lib/util.js';
import { processInvite } from '../../_lib/invite.js';

/*
 * POST /api/invite/accept  { token }
 * Accept a family invite on behalf of an already-authenticated user.
 * Used when the user has a valid session and visits /?invite=TOKEN — they
 * don't need to re-verify via OTP; we just link them to the family directly.
 */
export async function onRequestPost({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  let token;
  try { ({ token } = await request.json()); }
  catch { return json({ error: 'Bad request' }, { status: 400 }); }
  if (!token) return json({ error: 'Token required' }, { status: 400 });

  const now = Math.floor(Date.now() / 1000);
  const result = await processInvite(env.DB, token, data.user.uid, now);

  if (result?.needsMerge) {
    return json({ needsMerge: true, pendingInvite: result.token });
  }
  return json({ ok: true });
}

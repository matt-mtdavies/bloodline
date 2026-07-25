import { json } from '../_lib/util.js';
import { recordMomentEngagement } from '../_lib/momentEngagement.js';

/*
 * POST /api/moment-engagement — record that the caller's Family Moments
 * banner (see FamilyMomentBanner.jsx) was shown, or that they tapped into
 * it. Body: { momentKey: string, event: 'shown' | 'tapped' }. Fire-and-
 * forget from the client's point of view: this always returns { ok: true }
 * once the shape validates, even if the write itself is silently skipped
 * (e.g. no resolvable family membership) — instrumentation must never be
 * allowed to surface an error to the user or block anything they're doing.
 */
export async function onRequestPost({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'not_configured' }, { status: 503 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request', message: 'Malformed JSON body.' }, { status: 400 });
  }
  const momentKey = typeof body?.momentKey === 'string' ? body.momentKey.trim() : '';
  const event = body?.event;
  if (!momentKey || (event !== 'shown' && event !== 'tapped')) {
    return json({ error: 'bad_request', message: 'momentKey and a valid event are required.' }, { status: 400 });
  }

  await recordMomentEngagement(env, { viewerUserId: data.user.uid, momentKey, event });
  return json({ ok: true });
}

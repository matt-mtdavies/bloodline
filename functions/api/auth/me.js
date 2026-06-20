import { json } from '../../_lib/util.js';

/*
 * GET /api/auth/me
 * Returns the current session user, or 401 if not authenticated.
 */
export async function onRequestGet({ data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  return json({ uid: data.user.uid, email: data.user.email });
}

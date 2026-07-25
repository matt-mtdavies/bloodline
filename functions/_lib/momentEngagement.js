/*
 * Family Moments slice 6 — silent engagement instrumentation. Records that
 * a moment (by its scoring-engine `key`, e.g. "birthdayToday" or
 * "closestCousinsByAge") was shown to a viewer, or that they tapped into
 * it. Write-only from the app's own perspective: nothing here reads this
 * data back for ranking or display — see migrations/0017_moment_engagement
 * .sql's own header for why. This file's only job is to get the events
 * onto disk correctly; deciding what to do with them is a future slice.
 */
import { resolveCanonicalFamily } from './exportService.js';

const VALID_EVENTS = new Set(['shown', 'tapped']);

export async function recordMomentEngagement(env, { viewerUserId, momentKey, event, now = Date.now() }) {
  if (!VALID_EVENTS.has(event)) return;
  const membership = await resolveCanonicalFamily(env, viewerUserId);
  if (!membership) return; // no family membership resolved — nothing to scope this event to
  await env.DB.prepare(
    `INSERT INTO family_moment_engagement (viewer_user_id, family_id, moment_key, event, occurred_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(viewerUserId, membership.family_id, momentKey, event, Math.floor(now / 1000)).run();
}

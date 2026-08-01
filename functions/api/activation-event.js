import { json, uid } from '../_lib/util.js';

/*
 * POST /api/activation-event  { event, path? }
 *
 * Write-only sink for the aggregate activation-funnel telemetry required by
 * docs/PRODUCTIZATION-BRIEF.md §11.7 / §12 Phase B. Deliberately minimal:
 * no auth (fires from both signed-out public pages and the authenticated
 * app), no session/user/family identifier accepted or stored, and `event`
 * is checked against a fixed allowlist rather than accepted as free text —
 * this endpoint cannot be used to log anything beyond "one of these six
 * things happened, at this time, optionally on this named path."
 *
 * Never awaited by its callers (see src/lib/activation.js) — a slow or
 * failed write here must never be visible to, or block, a real user action.
 */
const ALLOWED_EVENTS = new Set([
  'cta_click',
  'path_chosen',
  'onboarding_completed',
  'tree_created',
  'import_completed',
  'invite_accepted',
  'first_contribution',
]);

// Every value the FRESH/import/invite start-path chooser can produce (see
// functions/start.js, src/App.jsx's _initialStartIntent) — the only values
// `path` is ever meaningful for today. Rejecting anything else keeps this
// column from silently becoming a free-text field over time.
const ALLOWED_PATHS = new Set(['fresh', 'import', 'invite']);

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: true }); // telemetry is best-effort; never a hard dependency

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Bad request' }, { status: 400 });
  }

  const event = typeof body?.event === 'string' ? body.event : '';
  if (!ALLOWED_EVENTS.has(event)) return json({ error: 'Unknown event' }, { status: 400 });

  const path = typeof body?.path === 'string' && ALLOWED_PATHS.has(body.path) ? body.path : null;

  try {
    await env.DB.prepare(
      `INSERT INTO activation_event (id, event, path) VALUES (?, ?, ?)`,
    ).bind(uid('ae_'), event, path).run();
  } catch (e) {
    // Missing table (not yet migrated) or any other write failure — swallow
    // it. This is a nice-to-have measurement, never something a real user
    // action should be allowed to fail because of.
    console.error('[activation-event] write failed:', e.message);
  }

  return json({ ok: true });
}

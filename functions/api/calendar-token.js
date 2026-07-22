import { json, token } from '../_lib/util.js';
import { loadTree } from '../_lib/treeStore.js';

/*
 * GET   /api/calendar-token  — this family's birthday-feed subscribe URL
 *                               (generating a token on first request), the
 *                               list of eligible people to choose from, and
 *                               which of them are currently selected.
 * POST  /api/calendar-token  — regenerate the token (invalidates the old
 *                               link — use if it leaked, or the family just
 *                               wants a fresh one) and/or save a new
 *                               selection: { regenerate?: true, personIds?: [] }
 *
 * Owner/coadmin only, same bar as the other tree-management surfaces — this
 * hands out a URL that bypasses normal session auth entirely (see
 * functions/api/calendar/[token].js), so who gets to mint/see it, and who
 * gets included in it, matters.
 *
 * Selection is opt-in, not "everyone with a birthday": a family with 200
 * people would otherwise dump 200 recurring reminders on the subscriber the
 * moment they add the feed. calendar_person_ids is NULL until the owner/
 * coadmin explicitly saves a list (an empty array is a valid, deliberate
 * "no one yet"), so the settings UI can present a curated checklist instead
 * of silently including the whole tree.
 */
export async function onRequestGet({ env, data }) {
  return handle({ env, data, forceNew: false });
}

export async function onRequestPost({ env, data, request }) {
  let body = {};
  try { body = await request.json(); } catch { /* no body is fine — token-only regenerate */ }
  return handle({ env, data, forceNew: !!body.regenerate, personIds: body.personIds });
}

async function handle({ env, data, forceNew, personIds }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'Database not configured' }, { status: 503 });

  try {
    const userRow = await env.DB.prepare(`SELECT family_id FROM user WHERE id = ?`)
      .bind(data.user.uid).first();
    if (!userRow?.family_id) return json({ error: 'Forbidden' }, { status: 403 });

    const membership = await env.DB.prepare(
      `SELECT role FROM family_member WHERE user_id = ? AND family_id = ?`,
    ).bind(data.user.uid, userRow.family_id).first();
    if (!membership || !['owner', 'coadmin'].includes(membership.role)) {
      return json({ error: 'Forbidden' }, { status: 403 });
    }

    const family = await env.DB.prepare(
      `SELECT calendar_token, calendar_person_ids FROM family WHERE id = ?`,
    ).bind(userRow.family_id).first();

    let calendarToken = family?.calendar_token;
    if (forceNew || !calendarToken) {
      calendarToken = token();
      await env.DB.prepare(`UPDATE family SET calendar_token = ? WHERE id = ?`)
        .bind(calendarToken, userRow.family_id).run();
    }

    let selectedIds = family?.calendar_person_ids ? JSON.parse(family.calendar_person_ids) : null;
    if (Array.isArray(personIds)) {
      selectedIds = personIds.filter((id) => typeof id === 'string').slice(0, 2000);
      await env.DB.prepare(`UPDATE family SET calendar_person_ids = ? WHERE id = ?`)
        .bind(JSON.stringify(selectedIds), userRow.family_id).run();
    }

    const treeRow = await loadTree(env, userRow.family_id);
    const allPeople = treeRow ? (JSON.parse(treeRow.raw).people || []) : [];
    const people = allPeople
      .filter((p) => p.birth_date && p.birth_date.length === 10 && p.visibility !== 'private'
        && !(p.is_minor && !p.is_deceased))
      .map((p) => ({
        id: p.id,
        name: p.display_name,
        birth_date: p.birth_date,
        is_deceased: !!p.is_deceased,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return json({ url: `/api/calendar/${calendarToken}.ics`, people, selectedIds });
  } catch (e) {
    console.error('[calendar-token] error:', e.message);
    return json({ error: 'Server error' }, { status: 500 });
  }
}

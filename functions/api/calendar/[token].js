/*
 * GET /api/calendar/:token.ics — public birthday subscription feed.
 *
 * Fetched directly by external calendar apps (Apple Calendar, Google
 * Calendar) on their own schedule, with no session cookie available — the
 * unguessable token in the URL (see functions/api/calendar-token.js) IS the
 * auth. Anyone with the link can read birth dates + names for the family, so
 * this must respect the same privacy rules the app itself enforces: skip
 * anyone marked 'private', and skip a living minor entirely (a 'summary'
 * person still gets a line — dates are visible at that level in-app too).
 */
import { loadTree } from '../../_lib/treeStore.js';

export async function onRequestGet({ env, params }) {
  const token = String(params.token || '').replace(/\.ics$/i, '');
  if (!token || !env.DB) return new Response('Not found', { status: 404 });

  try {
    const family = await env.DB.prepare(
      `SELECT id, name, calendar_person_ids FROM family WHERE calendar_token = ?`,
    ).bind(token).first();
    if (!family) return new Response('Not found', { status: 404 });

    // No selection saved yet (or an explicitly empty one) means no events —
    // never fall back to "everyone", see the migration/settings comments for why.
    const selectedIds = family.calendar_person_ids ? new Set(JSON.parse(family.calendar_person_ids)) : new Set();

    const row = await loadTree(env, family.id);
    const people = row ? (JSON.parse(row.raw).people || []) : [];

    const events = people
      .filter((p) => {
        if (!selectedIds.has(p.id)) return false;
        if (!p.birth_date || p.birth_date.length !== 10) return false; // need month+day
        if (p.visibility === 'private') return false;
        if (p.is_minor && !p.is_deceased) return false;
        return true;
      })
      .map((p) => icsEvent(p));

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Bloodline//Birthday Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${escapeText((family.name || 'Family') + ' Birthdays')}`,
      'X-WR-TIMEZONE:UTC',
      'REFRESH-INTERVAL;VALUE=DURATION:P1D',
      'X-PUBLISHED-TTL:P1D',
      ...events,
      'END:VCALENDAR',
    ].join('\r\n');

    return new Response(ics, {
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': 'inline; filename="birthdays.ics"',
        'cache-control': 'private, max-age=3600',
      },
    });
  } catch (e) {
    console.error('[calendar] error:', e.message);
    return new Response('Server error', { status: 500 });
  }
}

function icsEvent(p) {
  const [y, m, d] = p.birth_date.split('-');
  const dtstart = `${y}${m}${d}`;
  const name = p.display_name || 'Unknown';
  const summary = p.is_deceased ? `In memory of ${name}` : `${name}'s Birthday`;
  const url = `https://myfamilybloodline.com/?person=${encodeURIComponent(p.id)}`;
  return [
    'BEGIN:VEVENT',
    `UID:${p.id}-birthday@myfamilybloodline.com`,
    `DTSTAMP:${stampNow()}`,
    `DTSTART;VALUE=DATE:${dtstart}`,
    'RRULE:FREQ=YEARLY',
    `SUMMARY:${escapeText((p.is_deceased ? '\u{1F54A}\u{FE0F} ' : '\u{1F382} ') + summary)}`,
    `URL:${url}`,
    'END:VEVENT',
  ].join('\r\n');
}

function stampNow() {
  return new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function escapeText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

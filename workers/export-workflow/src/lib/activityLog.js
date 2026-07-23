/*
 * Durable activity_log extraction (docs/FULL-ARCHIVE-EXPORT.md §3.4, §4.2
 * stage 3): a bounded, keyset-paginated read of one family's complete
 * activity_log history, producing `activity-log.json`. This is a NEW read
 * path — `functions/_lib/treeStore.js#loadFullTree()` never touches
 * activity_log at all (it only resolves family_tree + its R2 extra), and
 * the only existing reader (`functions/api/activity.js`) is scoped to the
 * request-caller and capped at 200 rows/page for the live UI, not shaped
 * for a complete internal export.
 *
 * Distinct from `tree.json`'s own embedded `activity` array (see
 * lib/manifest.js's caller / docs/FULL-ARCHIVE-EXPORT.md §3.3-3.4): that
 * field is the client's capped, mergeable fast-path cache, captured
 * exactly as `loadFullTree()` returns it — this module's output is the
 * complete, separate, authoritative D1 record.
 *
 * Dual-cursor design: the upper bound is captured ONCE, at job start,
 * before pagination begins, so activity written by other users WHILE the
 * export runs never gets included (a snapshot must not grow mid-export)
 * and never causes a page to be skipped or duplicated (the lower cursor
 * only ever moves forward from confirmed-read rows). Both cursors are the
 * composite `(created_at, id)` — `id` breaks ties when multiple rows share
 * the same `created_at`, which `activity_log`'s TEXT ISO-8601 timestamps
 * (see migrations/0008_activity_log.sql, and functions/api/tree.js's own
 * `new Date().toISOString()` fallback) do not otherwise guarantee against.
 */
import { BUDGETS } from './budgets.js';

export class ActivityLogUnavailableError extends Error {
  constructor(cause) {
    super('activity_log_unavailable');
    this.name = 'ActivityLogUnavailableError';
    this.cause = cause;
  }
}

const COLUMNS = 'id, family_id, author_name, author_email, type, person_id, person_name, detail, created_at';

/*
 * Builds the exact SQL + bind params for one page, per §3.4. `lowerCursor`
 * is null for the very first page. `upperBound` is always required — it's
 * captured once by captureUpperBound() before any page is read.
 */
export function buildActivityLogPageQuery({ familyId, lowerCursor, upperBound, limit = BUDGETS.activityQueryPage.maxRows }) {
  if (limit > BUDGETS.activityQueryPage.maxRows) {
    throw new Error(`page size ${limit} exceeds the activity_log page budget (${BUDGETS.activityQueryPage.maxRows})`);
  }
  const conditions = ['family_id = ?'];
  const params = [familyId];

  if (lowerCursor) {
    conditions.push('(created_at > ? OR (created_at = ? AND id > ?))');
    params.push(lowerCursor.createdAt, lowerCursor.createdAt, lowerCursor.id);
  }
  if (upperBound) {
    conditions.push('(created_at < ? OR (created_at = ? AND id <= ?))');
    params.push(upperBound.createdAt, upperBound.createdAt, upperBound.id);
  }

  const sql = `SELECT ${COLUMNS} FROM activity_log WHERE ${conditions.join(' AND ')} ORDER BY created_at ASC, id ASC LIMIT ?`;
  return { sql, params: [...params, limit] };
}

/*
 * The one-row query that fixes the upper bound before pagination starts.
 * `queryFn(sql, params)` is the only injected I/O — expected to resolve to
 * an array of plain row objects (already unwrapped from D1's own
 * `.all().results` shape by the caller's adapter).
 */
export async function captureUpperBound(familyId, queryFn) {
  const rows = await runQuery(
    queryFn,
    `SELECT ${COLUMNS} FROM activity_log WHERE family_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    [familyId],
  );
  if (!rows.length) return null; // a family with zero activity is valid, not an error
  return { createdAt: rows[0].created_at, id: rows[0].id };
}

async function runQuery(queryFn, sql, params) {
  try {
    return await queryFn(sql, params);
  } catch (e) {
    if (/no such table:\s*activity_log/i.test(e.message || '')) throw new ActivityLogUnavailableError(e);
    throw e;
  }
}

/*
 * Reads the complete, stable activity_log history for one family as of the
 * moment this function is called, in ascending (created_at, id) order,
 * paginated at the budgeted page size. Returns a flat array of rows —
 * callers needing shards for R2 staging use budgets.js#shardByBudget on
 * the result, same as any other collection this package produces.
 *
 * Because both cursors are part of every page's WHERE clause, a row
 * inserted by a concurrent save after `captureUpperBound()` runs can never
 * appear in any page, and a row already read can never be re-read even if
 * many rows share an identical `created_at` — the `id` tiebreaker and the
 * strict `>`/`<=` comparisons make each page a disjoint, gap-free
 * continuation of the last.
 */
export async function extractActivityLog(familyId, queryFn, { limit = BUDGETS.activityQueryPage.maxRows } = {}) {
  const upperBound = await captureUpperBound(familyId, queryFn);
  if (!upperBound) return [];

  const rows = [];
  let lowerCursor = null;
  for (;;) {
    const { sql, params } = buildActivityLogPageQuery({ familyId, lowerCursor, upperBound, limit });
    const page = await runQuery(queryFn, sql, params);
    rows.push(...page);
    if (page.length < limit) break;
    const last = page[page.length - 1];
    lowerCursor = { createdAt: last.created_at, id: last.id };
  }
  return rows;
}

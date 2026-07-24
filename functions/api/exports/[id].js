import { json } from '../../_lib/util.js';
import { getFamilyExport, exportErrorResponse } from '../../_lib/exportService.js';

// GET /api/exports/:id — status/progress for one of the caller's own
// family's export jobs.
export async function onRequestGet({ params, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const job = await getFamilyExport(env, { userId: data.user.uid, jobId: params.id });
    return json(job);
  } catch (e) {
    return exportErrorResponse(json, e);
  }
}

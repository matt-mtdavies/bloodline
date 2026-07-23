import { json } from '../../../_lib/util.js';
import { cancelFamilyExport, exportErrorResponse } from '../../../_lib/exportService.js';

// POST /api/exports/:id/cancel — owner/coadmin only, idempotent.
export async function onRequestPost({ params, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const job = await cancelFamilyExport(env, { userId: data.user.uid, jobId: params.id });
    return json(job);
  } catch (e) {
    return exportErrorResponse(json, e);
  }
}

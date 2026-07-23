import { json } from '../../../../_lib/util.js';
import { cancelAdminExport, exportErrorResponse } from '../../../../_lib/exportService.js';

// POST /api/admin/exports/:id/cancel — idempotent, EXPORT_ADMIN_EMAILS only.
export async function onRequestPost({ params, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const job = await cancelAdminExport(env, { actorEmail: data.user.email, jobId: params.id });
    return json(job);
  } catch (e) {
    return exportErrorResponse(json, e);
  }
}

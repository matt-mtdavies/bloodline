import { json } from '../../../_lib/util.js';
import { getAdminExport, exportErrorResponse } from '../../../_lib/exportService.js';

// GET /api/admin/exports/:id — status/progress + audit-visible fields for
// any export job, gated on EXPORT_ADMIN_EMAILS (independent of family
// membership).
export async function onRequestGet({ params, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const job = await getAdminExport(env, { actorEmail: data.user.email, jobId: params.id });
    return json(job);
  } catch (e) {
    return exportErrorResponse(json, e);
  }
}

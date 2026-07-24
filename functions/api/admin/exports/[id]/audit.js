import { json } from '../../../../_lib/util.js';
import { getAdminExportAudit, exportErrorResponse } from '../../../../_lib/exportService.js';

// GET /api/admin/exports/:id/audit — the immutable audit trail for one
// export job (§11 step 8), EXPORT_ADMIN_EMAILS only.
export async function onRequestGet({ params, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const events = await getAdminExportAudit(env, { actorEmail: data.user.email, jobId: params.id });
    return json({ events });
  } catch (e) {
    return exportErrorResponse(json, e);
  }
}

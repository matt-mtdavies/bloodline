import { json } from '../../../../_lib/util.js';
import { downloadAdminExport, exportErrorResponse } from '../../../../_lib/exportService.js';

// GET /api/admin/exports/:id/download — same streaming/header contract as
// the family download endpoint, gated on EXPORT_ADMIN_EMAILS instead of
// family membership.
export async function onRequestGet({ params, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const object = await downloadAdminExport(env, { actorUserId: data.user.uid, actorEmail: data.user.email, jobId: params.id });
    return new Response(object.body, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="bloodline-full-archive.zip"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (e) {
    return exportErrorResponse(json, e);
  }
}

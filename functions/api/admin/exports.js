import { json } from '../../_lib/util.js';
import { createAdminExport, listAdminExports, exportErrorResponse } from '../../_lib/exportService.js';

/*
 * POST /api/admin/exports — { familyId, reason, confirmFamilyName } —
 * separately-allowlisted site-admin export of an exact selected family.
 * GET  /api/admin/exports — every site-admin export job (optionally add
 * ?familyId= to scope, e.g. from the admin picker's own history view).
 */
export async function onRequestPost({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, { status: 400 });
  }
  try {
    const { jobId } = await createAdminExport(env, {
      actorUserId: data.user.uid,
      actorEmail: data.user.email,
      familyId: body?.familyId,
      reason: body?.reason,
      confirmFamilyName: body?.confirmFamilyName,
    });
    return json({ id: jobId }, { status: 201 });
  } catch (e) {
    return exportErrorResponse(json, e);
  }
}

export async function onRequestGet({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const familyId = new URL(request.url).searchParams.get('familyId') || undefined;
    const exportsList = await listAdminExports(env, { actorEmail: data.user.email, familyId });
    return json({ exports: exportsList });
  } catch (e) {
    return exportErrorResponse(json, e);
  }
}

import { json } from '../../_lib/util.js';
import { searchExportFamilies, exportErrorResponse } from '../../_lib/exportService.js';

// GET /api/admin/export-families?query=... — bounded family search for the
// site-admin export picker. Returns selection metadata only (§6): id/name/
// member count/latest export status, never tree or person content.
export async function onRequestGet({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const query = new URL(request.url).searchParams.get('query') || '';
    const families = await searchExportFamilies(env, { actorEmail: data.user.email, query });
    return json({ families });
  } catch (e) {
    return exportErrorResponse(json, e);
  }
}

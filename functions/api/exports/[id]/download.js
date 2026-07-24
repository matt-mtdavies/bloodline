import { json } from '../../../_lib/util.js';
import { downloadFamilyExport, exportErrorResponse } from '../../../_lib/exportService.js';

/*
 * GET /api/exports/:id/download — streams the private final R2 object
 * straight through, without buffering (§6 Download: "stream private R2
 * object without buffering"). Headers per §6: application/zip, a safe
 * Content-Disposition (no path separators, no user-controlled text),
 * private/no-store, nosniff.
 */
export async function onRequestGet({ params, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const object = await downloadFamilyExport(env, { userId: data.user.uid, jobId: params.id });
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

import { json } from '../_lib/util.js';
import { createFamilyExport, listFamilyExports, exportErrorResponse } from '../_lib/exportService.js';

/*
 * POST /api/exports — prepare a complete Bloodline archive for the caller's
 * own family (owner/coadmin only).
 * GET  /api/exports — the caller's own family's export history (newest 20).
 * Route file is deliberately thin — all authority/rate-limit/serialization
 * logic lives in functions/_lib/exportService.js (docs/FULL-ARCHIVE-EXPORT-
 * COMPLETION-PHASE.md §6).
 */
export async function onRequestPost({ env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { jobId } = await createFamilyExport(env, { userId: data.user.uid, userEmail: data.user.email });
    return json({ id: jobId }, { status: 201 });
  } catch (e) {
    return exportErrorResponse(json, e);
  }
}

export async function onRequestGet({ env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const exportsList = await listFamilyExports(env, { userId: data.user.uid });
    return json({ exports: exportsList });
  } catch (e) {
    return exportErrorResponse(json, e);
  }
}

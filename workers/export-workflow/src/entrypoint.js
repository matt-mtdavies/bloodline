/*
 * RPC entrypoint Pages reaches through the EXPORT_WORKFLOW_SERVICE service
 * binding (docs/FULL-ARCHIVE-EXPORT-COMPLETION-PHASE.md §6, §7). A thin
 * WorkerEntrypoint exposing only the narrow methods the design calls for —
 * createExport/getExportInstance/requestCancellation — never a general
 * fetch() surface a Pages Function could smuggle arbitrary calls through.
 *
 * Both `main`-resolved classes MUST be exported from this exact file (the
 * completion-phase brief §7's colocation requirement, closing the PR #8
 * review finding): `ExportWorkflowEntrypoint` for the RPC service binding,
 * `FamilyArchiveExportWorkflow` for `[[workflows]].class_name` in
 * wrangler.toml. `FamilyArchiveExportWorkflow` itself lives in workflow.js —
 * only re-exported here — since it's a large orchestration class and
 * entrypoint.js should stay a thin front door, but the export from THIS
 * module is what actually matters to Wrangler's bundler/binding resolution.
 *
 * PHASE A's version of this file was a bare class with no base class at
 * all, which is NOT a valid RPC service-binding target — Cloudflare's RPC
 * mechanism only exposes methods on a class extending WorkerEntrypoint.
 * Fixed here; see tests/entrypoint.test.mjs for a test that would fail
 * without it.
 */
import { WorkerEntrypoint } from 'cloudflare:workers';

export { FamilyArchiveExportWorkflow } from './workflow.js';

export class ExportWorkflowEntrypoint extends WorkerEntrypoint {
  /*
   * Starts (or resumes) the Workflow instance for an already-created D1 job
   * row. Idempotent: §6's "ambiguous/repeated RPC calls return the existing
   * legitimate instance" — Cloudflare Workflows' own create() already
   * treats a duplicate `id` as "return the existing instance" rather than
   * erroring, since the Workflow instance ID always equals the job ID
   * (never a separately generated value), so no extra bookkeeping is
   * needed here to get that guarantee.
   */
  async createExport(jobId) {
    assertValidJobId(jobId);
    try {
      const instance = await this.env.EXPORT_WORKFLOW.get(jobId);
      if (instance) return { instanceId: jobId, created: false };
    } catch { /* no existing instance — fall through to create */ }
    await this.env.EXPORT_WORKFLOW.create({ id: jobId, params: { jobId, schemaVersion: 1 } });
    return { instanceId: jobId, created: true };
  }

  async getExportInstance(jobId) {
    assertValidJobId(jobId);
    const instance = await this.env.EXPORT_WORKFLOW.get(jobId);
    const status = await instance.status();
    return { instanceId: jobId, status: status.status, output: status.output ?? null, error: status.error ?? null };
  }

  /*
   * §6 Cancel: "notify Worker best-effort... Workflow stops only at safe
   * entry/part boundaries." This does NOT terminate the Workflow instance
   * itself (Workflows has no safe mid-step abort) — it only records the
   * cancellation request; the running Workflow's own steps check D1's
   * cancellation state between shards/parts (§7 Cancellation/failure) and
   * stop themselves at the next safe boundary. If the instance can't be
   * found at all (already finished, or a stale/garbage-collected id), this
   * is a no-op success — the job's own D1 status is the source of truth for
   * whether cancellation is meaningful, not the Workflow instance's mere
   * existence.
   */
  async requestCancellation(jobId) {
    assertValidJobId(jobId);
    try {
      const instance = await this.env.EXPORT_WORKFLOW.get(jobId);
      await instance.sendEvent?.({ type: 'cancel' });
    } catch { /* instance already gone — nothing to notify */ }
    return { acknowledged: true };
  }
}

// jobId grammar (§7: "validate job grammar") — matches uid('exp_') from
// functions/_lib/exportJob.js: the prefix plus 20 lowercase-hex-ish
// characters. Never trusts an arbitrary caller-supplied string as an
// R2/Workflow instance id without shape-checking it first.
const JOB_ID_RE = /^exp_[0-9a-f]{20}$/;
function assertValidJobId(jobId) {
  if (typeof jobId !== 'string' || !JOB_ID_RE.test(jobId)) {
    throw new Error(`invalid export job id: ${String(jobId).slice(0, 40)}`);
  }
}

export default {
  async fetch() {
    return new Response('bloodline-export-workflow: RPC-only, see WorkerEntrypoint export', { status: 404 });
  },
};

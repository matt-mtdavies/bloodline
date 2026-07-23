/*
 * RPC entrypoint Pages reaches through the EXPORT_WORKFLOW_SERVICE service
 * binding (docs/FULL-ARCHIVE-EXPORT.md §6.3, §10.1). Deliberately a thin
 * WorkerEntrypoint exposing only the narrow methods the design calls for —
 * createExport/getExportInstance/requestCancellation — never a general
 * fetch() surface a Pages Function could smuggle arbitrary calls through.
 *
 * PHASE A SCOPE NOTE: this file is a stub. Wiring it to a real Workflow
 * instance (env.EXPORT_WORKFLOW.create/get) and to D1 job-row validation is
 * Phase B (§12) — it needs the live infrastructure spike this sandbox can't
 * run (see ../../docs/FULL-ARCHIVE-EXPORT-PHASE-A-RUNBOOK.md). Phase A's
 * actual deliverable is the pure library code under src/lib/, proven with
 * the tests in tests/ — this stub exists only so the package has a valid
 * `main` and the wrangler.toml above is a complete, reviewable template.
 */
export class ExportWorkflowEntrypoint {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  // eslint-disable-next-line no-unused-vars
  async createExport(jobId) {
    throw new Error('not implemented in Phase A — see docs/FULL-ARCHIVE-EXPORT.md §12 Phase B');
  }

  // eslint-disable-next-line no-unused-vars
  async getExportInstance(jobId) {
    throw new Error('not implemented in Phase A — see docs/FULL-ARCHIVE-EXPORT.md §12 Phase B');
  }

  // eslint-disable-next-line no-unused-vars
  async requestCancellation(jobId) {
    throw new Error('not implemented in Phase A — see docs/FULL-ARCHIVE-EXPORT.md §12 Phase B');
  }
}

export default {
  async fetch() {
    return new Response('bloodline-export-workflow: RPC-only, see WorkerEntrypoint export', { status: 404 });
  },
};

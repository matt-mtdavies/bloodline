import { WorkflowEntrypoint } from 'cloudflare:workers';
import { runExportWorkflowSteps } from './workflowSteps.js';

// Re-exported so callers of workflow.js (entrypoint.js, tests that DO run
// under a Workers-shaped environment) have one place to reach everything —
// the actual logic and its own tests live in workflowSteps.js, which
// deliberately imports nothing from `cloudflare:workers` so it can be
// exercised directly under plain Node (see tests/workflowSteps.test.mjs).
export * from './workflowSteps.js';

// The ENTIRE step-13 orchestration (including top-level failure handling —
// see runExportWorkflowSteps' own header comment) lives in workflowSteps.js,
// not here, for exactly the same reason every individual step function does:
// this file's only job is touching the real `cloudflare:workers` SDK
// (extending WorkflowEntrypoint), so the orchestration logic itself can be
// exercised directly under plain Node against fakes, without needing a real
// Workflow runtime to prove it — see tests/workflowSteps.test.mjs's
// "runExportWorkflowSteps" coverage, including the exact failure-recording
// path a PR #9 review found completely untested and unhandled before.
export class FamilyArchiveExportWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    return runExportWorkflowSteps(this.env, step, event.payload.jobId);
  }
}

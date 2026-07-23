import { WorkflowEntrypoint } from 'cloudflare:workers';
import {
  authorizeJobStep, captureSourceStep, captureActivityBoundStep, captureActivityPageStep,
  buildInventoryStep, resolveInventoryShardStep, resolveKeepsakesStep,
} from './workflowSteps.js';

// Re-exported so callers of workflow.js (entrypoint.js, tests that DO run
// under a Workers-shaped environment) have one place to reach everything —
// the actual logic and its own tests live in workflowSteps.js, which
// deliberately imports nothing from `cloudflare:workers` so it can be
// exercised directly under plain Node (see tests/workflowSteps.test.mjs).
export * from './workflowSteps.js';

export class FamilyArchiveExportWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const { jobId } = event.payload;

    const authorized = await step.do('v1-authorize-job', () => authorizeJobStep(this.env, { jobId }));
    if (authorized.alreadyStarted) return { skipped: true, status: authorized.status };
    const familyId = authorized.familyId;

    await step.do('v1-capture-source', () => captureSourceStep(this.env, { jobId, familyId }));

    const bound = await step.do('v1-capture-activity-bound', () => captureActivityBoundStep(this.env, { jobId, familyId }));
    let cursor = null;
    let pageIndex = 0;
    if (!bound.done) {
      for (;;) {
        const page = await step.do(`v1-capture-activity-${pageIndex}`, () => captureActivityPageStep(this.env, { jobId, familyId, pageIndex, lowerCursor: cursor }));
        if (page.done) break;
        cursor = page.nextCursor;
        pageIndex += 1;
      }
    }

    const inventoryPlan = await step.do('v1-build-inventory', () => buildInventoryStep(this.env, { jobId, familyId }));
    for (let i = 0; i < inventoryPlan.shardCount; i++) {
      await step.do(`v1-resolve-inventory-${i}`, () => resolveInventoryShardStep(this.env, { jobId, familyId, shardIndex: i }));
    }
    await step.do('v1-resolve-inventory-keepsakes', () => resolveKeepsakesStep(this.env, { jobId, familyId }));

    // Steps 7-13 (packaging/verification/finalize/email/cleanup) continue
    // this same run() in a later slice.
    return { jobId, familyId, inventoryShards: inventoryPlan.shardCount };
  }
}

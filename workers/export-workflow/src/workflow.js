import { WorkflowEntrypoint } from 'cloudflare:workers';
import {
  authorizeJobStep, captureSourceStep, captureActivityBoundStep, captureActivityPageStep,
  buildInventoryStep, resolveInventoryShardStep, resolveKeepsakesStep,
  startMultipartStep, packageStep, completeMultipartStep, verifyArchiveStep,
  finalizeJobStep, sendCompletionEmailStep, cleanStagingStep,
  isCancellationRequested, handleCancellation,
} from './workflowSteps.js';

// Re-exported so callers of workflow.js (entrypoint.js, tests that DO run
// under a Workers-shaped environment) have one place to reach everything —
// the actual logic and its own tests live in workflowSteps.js, which
// deliberately imports nothing from `cloudflare:workers` so it can be
// exercised directly under plain Node (see tests/workflowSteps.test.mjs).
export * from './workflowSteps.js';

// Checked between shards/parts during every repeated-step loop (§7
// Cancellation/failure). Returning true here means the caller's loop must
// stop and hand control to handleCancellation — never silently continue.
async function bail(env, jobId, familyId) {
  if (await isCancellationRequested(env, jobId)) {
    await handleCancellation(env, { jobId, familyId });
    return true;
  }
  return false;
}

export class FamilyArchiveExportWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const { jobId } = event.payload;

    const authorized = await step.do('v1-authorize-job', () => authorizeJobStep(this.env, { jobId }));
    if (authorized.alreadyStarted) return { skipped: true, status: authorized.status };
    const { familyId, family, requestedAs, requesterEmail } = authorized;

    await step.do('v1-capture-source', () => captureSourceStep(this.env, { jobId, familyId }));
    if (await step.do('v1-check-cancel-after-capture', () => bail(this.env, jobId, familyId))) return { cancelled: true };

    const bound = await step.do('v1-capture-activity-bound', () => captureActivityBoundStep(this.env, { jobId, familyId }));
    let cursor = null;
    let pageIndex = 0;
    if (!bound.done) {
      for (;;) {
        const page = await step.do(`v1-capture-activity-${pageIndex}`, () => captureActivityPageStep(this.env, { jobId, familyId, pageIndex, lowerCursor: cursor }));
        if (page.done) break;
        cursor = page.nextCursor;
        pageIndex += 1;
        if (await step.do(`v1-check-cancel-activity-${pageIndex}`, () => bail(this.env, jobId, familyId))) return { cancelled: true };
      }
    }

    const inventoryPlan = await step.do('v1-build-inventory', () => buildInventoryStep(this.env, { jobId, familyId }));
    for (let i = 0; i < inventoryPlan.shardCount; i++) {
      await step.do(`v1-resolve-inventory-${i}`, () => resolveInventoryShardStep(this.env, { jobId, familyId, shardIndex: i }));
      if (await step.do(`v1-check-cancel-inventory-${i}`, () => bail(this.env, jobId, familyId))) return { cancelled: true };
    }
    await step.do('v1-resolve-inventory-keepsakes', () => resolveKeepsakesStep(this.env, { jobId, familyId }));

    await step.do('v1-start-multipart', () => startMultipartStep(this.env, { jobId, familyId, family, requestedAs }));

    let packagingDone = false;
    let checkpointIndex = 0;
    while (!packagingDone) {
      const result = await step.do(`v1-package-${checkpointIndex}`, () => packageStep(this.env, { jobId }));
      packagingDone = result.done;
      checkpointIndex += 1;
      if (!packagingDone && await step.do(`v1-check-cancel-package-${checkpointIndex}`, () => bail(this.env, jobId, familyId))) return { cancelled: true };
    }

    await step.do('v1-complete-multipart', () => completeMultipartStep(this.env, { jobId, familyId }));
    const verified = await step.do('v1-verify-archive', () => verifyArchiveStep(this.env, { jobId }));
    const finalized = await step.do('v1-finalize-job', () => finalizeJobStep(this.env, { jobId, familyId, warningCount: verified.warningCount }));

    await step.do('v1-send-completion-email', () => sendCompletionEmailStep(this.env, {
      jobId, toEmail: requesterEmail, requestedAs, appUrl: this.env.APP_URL || 'https://myfamilybloodline.com',
    }));
    await step.do('v1-clean-staging', () => cleanStagingStep(this.env, { jobId }));

    return { jobId, familyId, status: finalized.status, archiveBytes: verified.archiveBytes, warningCount: verified.warningCount };
  }
}

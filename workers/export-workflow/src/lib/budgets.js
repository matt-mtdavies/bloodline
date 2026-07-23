/*
 * Workflow and packaging budgets (docs/FULL-ARCHIVE-EXPORT.md §2.6). These
 * are the numbers that keep every Workflow step inside Cloudflare's actual
 * platform limits (verified live against current Workflows docs during
 * design review: step.do() non-stream returns and event/creation payloads
 * both cap at 1 MiB platform-wide) with real safety margin, not numbers
 * pulled from nowhere. Every other module in this package that produces a
 * step result, a shard, or a buffer imports its ceiling from here rather
 * than hard-coding it a second time — one place these can ever be wrong.
 *
 * "target" is what a healthy implementation should stay under in normal
 * operation; "max" is the hard ceiling enforcement throws on. A target
 * violation is a signal to shard/checkpoint sooner, not a bug by itself —
 * assertWithinBudget only ever enforces the "max" figures.
 */
export const BUDGETS = Object.freeze({
  workflowCreationPayload: Object.freeze({ targetBytes: 1024, maxBytes: 8 * 1024 }),
  stepResult: Object.freeze({ targetBytes: 64 * 1024, maxBytes: 512 * 1024 }),
  d1JobRow: Object.freeze({ targetBytes: 16 * 1024 }),
  inventoryShard: Object.freeze({ maxEntries: 500, maxBytes: 512 * 1024 }),
  activityQueryPage: Object.freeze({ maxRows: 500 }),
  r2HeadOpsPerStep: Object.freeze({ maxCalls: 100, maxConcurrency: 10 }),
  multipartPart: Object.freeze({ defaultBytes: 16 * 1024 * 1024, maxBytesAfterSpike: 32 * 1024 * 1024, minBytes: 5 * 1024 * 1024 }),
  packagingCheckpoint: Object.freeze({ maxEntriesBetweenCheckpoints: 100 }),
  inMemoryBinaryBuffer: Object.freeze({
    zipWriterOverheadBytes: 4 * 1024 * 1024,
    // Never more than one multipart part plus writer overhead — with the
    // default 16 MiB part this targets ~24 MiB resident at any one time.
    targetBytes: 16 * 1024 * 1024 + 4 * 1024 * 1024,
  }),
  centralDirectoryShard: Object.freeze({ maxBytes: 512 * 1024 }),
  packagingStepCpu: Object.freeze({ targetMs: 20 * 1000, safetyCeilingMs: 5 * 60 * 1000 }),
  heartbeat: Object.freeze({ minIntervalMs: 10 * 1000 }),
  // R2/S3-compatible multipart upload constraints (platform boundary, not a
  // product choice) — every non-final part must be at least 5 MiB, and a
  // single upload tops out around 10,000 parts. §2.5's own
  // `requires_segmented_export` threshold (9,500 parts) leaves headroom
  // under this ceiling rather than running right up against it.
  r2MultipartLimits: Object.freeze({ minPartBytes: 5 * 1024 * 1024, maxParts: 10000 }),
});

class BudgetExceededError extends Error {
  constructor(label, actual, max, unit) {
    super(`${label} exceeded budget: ${actual}${unit} > ${max}${unit} max`);
    this.name = 'BudgetExceededError';
    this.label = label;
    this.actual = actual;
    this.max = max;
  }
}

function byteLengthOf(value) {
  if (value instanceof Uint8Array) return value.byteLength;
  if (typeof value === 'string') return new TextEncoder().encode(value).byteLength;
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/*
 * Throws BudgetExceededError if `value`'s serialized/byte size exceeds
 * `budget.maxBytes`. Used at every point a step is about to return a
 * result, write a D1 row, or emit a shard — so a regression that would
 * violate a Workflow platform limit fails a test immediately instead of
 * surfacing as a mysterious production 500 from Cloudflare's own runtime.
 */
export function assertWithinByteBudget(label, value, budget) {
  if (budget.maxBytes == null) return value; // no hard ceiling defined for this budget
  const actual = byteLengthOf(value);
  if (actual > budget.maxBytes) throw new BudgetExceededError(label, actual, budget.maxBytes, ' bytes');
  return value;
}

export function assertWithinCountBudget(label, count, budget, field = 'maxEntries') {
  const max = budget[field];
  if (max == null) return count;
  if (count > max) throw new BudgetExceededError(label, count, max, ` ${field}`);
  return count;
}

/*
 * Splits an array into shards, each respecting both a max-entry-count and a
 * max-serialized-byte-size budget — used for inventory/activity/central-
 * directory sharding alike (docs/FULL-ARCHIVE-EXPORT.md §2.6's "start a new
 * shard when either limit is reached"). A single oversized entry (bigger
 * than the whole byte budget on its own) still gets its own shard rather
 * than throwing — the byte budget bounds normal growth, it does not reject
 * a single legitimately large record.
 */
export function shardByBudget(items, { maxEntries, maxBytes }) {
  const shards = [];
  let current = [];
  let currentBytes = 2; // '[]'
  for (const item of items) {
    const itemBytes = byteLengthOf(item) + (current.length ? 1 : 0); // +1 for the joining comma
    const wouldExceedEntries = maxEntries != null && current.length >= maxEntries;
    const wouldExceedBytes = maxBytes != null && current.length > 0 && currentBytes + itemBytes > maxBytes;
    if (wouldExceedEntries || wouldExceedBytes) {
      shards.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(item);
    currentBytes += itemBytes;
  }
  if (current.length) shards.push(current);
  return shards;
}

export { BudgetExceededError };

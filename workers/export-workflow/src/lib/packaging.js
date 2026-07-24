/*
 * Multipart packaging orchestration (docs/FULL-ARCHIVE-EXPORT-COMPLETION-PHASE.md
 * §7 Package). Pure-ish: the only injected I/O is `uploadPart(partNumber,
 * bytes) -> { etag }` and `getEntryBytes(planEntry) -> AsyncIterable<Uint8Array>`
 * — no direct R2/D1 calls in this file, so the whole accumulation/
 * checkpointing arithmetic is provable against a fake uploader (see
 * tests/packaging.test.mjs), the same split every other module in this
 * package already uses.
 */
import { ZipStreamWriter } from './zipWriter.js';
import { BUDGETS } from './budgets.js';
import { createIncrementalSha256 } from './manifest.js';

/*
 * Builds the deterministic, lexically-ordered archive plan from already-
 * resolved inventory. Each plan entry is a small DESCRIPTOR, never the
 * bytes themselves — real bytes are fetched lazily per-entry via the
 * caller-supplied `getEntryBytes`, so this plan is cheap to persist to R2
 * as the packaging checkpoint's fixed reference list.
 *
 * `fixedFiles`: [{ path, byteLength, compress }] — tree.json, activity-
 * log.json, content-index.json, tree-data.js, viewer assets (deliberately
 * NEVER manifest.json — see `manifestFile` below); `mediaEntries` /
 * `keepsakeEntries`: resolved inventory entries (only `status ===
 * 'included'` ones become real archive files — everything else is still
 * reported in the manifest, just never written as archive bytes).
 *
 * `manifestFile` (optional): `{ path, byteLength, compress }` for
 * manifest.json specifically, appended as the LAST plan entry — AFTER the
 * lexical sort, unconditionally, regardless of what its path would
 * otherwise sort to. manifest.json's own per-entry SHA-256 checksums can
 * only be finalized once every OTHER entry has actually been streamed and
 * hashed (the packaging ledger — see workflowSteps.js#packageStep's own
 * finalizeManifestBytes), so it must be the very last thing packaged, not
 * wherever "manifest.json" would normally land alphabetically. Omitting
 * this param entirely preserves the exact prior behavior (manifest.json,
 * if present in `fixedFiles`, sorts normally) — used by this module's own
 * unit tests, which don't need the ledger-finalization behavior at all.
 */
export function buildArchivePlan({ fixedFiles = [], mediaEntries = [], keepsakeEntries = [], manifestFile = null }) {
  const plan = [];
  for (const f of fixedFiles) {
    plan.push({ kind: 'fixed', path: f.path, byteLength: f.byteLength, compress: f.compress || 'store' });
  }
  for (const e of [...mediaEntries, ...keepsakeEntries]) {
    if (e.status !== 'included') continue;
    // Photos/PDFs/office documents/Keepsake JSON are all already-compressed
    // or small enough that re-deflating wastes CPU for negligible size gain
    // (§7: "store compressed media/PDF/office formats; bounded DEFLATE for
    // text") — media/keepsake entries always store; only the fixed JSON/
    // text files above (tree.json, activity-log.json, content-index.json,
    // manifest.json, tree-data.js) opt into deflate via their own
    // caller-supplied `compress` field.
    plan.push({ kind: 'media', path: e.path, id: e.id, byteLength: e.byteLength ?? 0, compress: 'store' });
  }
  plan.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (manifestFile) {
    plan.push({ kind: 'manifest', path: manifestFile.path, byteLength: manifestFile.byteLength, compress: manifestFile.compress || 'store' });
  }
  return plan;
}

/*
 * A crude but adequate projection of the final archive's total size, used
 * ONLY to decide requires_segmented_export before any multipart upload
 * begins (§7 Package). Deliberately conservative (over-, not under-,
 * estimates) — a per-entry local-header + data-descriptor + central-
 * directory-record overhead reserve, since under-estimating risks starting
 * a multipart upload that later must abort mid-flight when the real
 * boundary is hit.
 */
const PER_ENTRY_OVERHEAD_BYTES = 30 + 46 + 24; // local header + central dir record + zip64 data descriptor, excluding path bytes
const pathByteLength = (path) => new TextEncoder().encode(path).length;
export function projectArchiveBytes(plan) {
  let total = 22; // EOCD
  for (const entry of plan) {
    total += entry.byteLength + PER_ENTRY_OVERHEAD_BYTES + pathByteLength(entry.path) * 2;
  }
  return total;
}

export function assertNotOverSegmentedExportBoundary(plan, { partBytes = BUDGETS.multipartPart.defaultBytes } = {}) {
  const projectedBytes = projectArchiveBytes(plan);
  const projectedParts = Math.ceil(projectedBytes / partBytes) || 1;
  const overBudget = projectedBytes >= BUDGETS.segmentedExport.maxProjectedBytes
    || projectedParts >= BUDGETS.segmentedExport.maxProjectedParts;
  if (overBudget) {
    const err = new Error(`projected archive (${projectedBytes} bytes, ~${projectedParts} parts) exceeds the single-archive platform boundary`);
    err.code = 'requires_segmented_export';
    throw err;
  }
  return { projectedBytes, projectedParts };
}

/*
 * Accumulates ZipStreamWriter's emitted bytes into R2-multipart-sized
 * parts, uploading each full part via the injected `uploadPart` the moment
 * it's ready — never holding more than one part's worth (plus a small
 * writer overhead) in memory at once (§2.6's in-memory buffer budget). The
 * LAST part (after finish()) is uploaded regardless of size — R2/S3
 * multipart has no minimum size for the final part.
 */
export class PartAccumulator {
  /*
   * `initialBytes` (optional) seeds the buffer with whatever was left over,
   * NOT yet uploaded, from a PRIOR Workflow step invocation — R2/S3
   * multipart forbids a non-final part under 5 MiB, so a step that
   * checkpoints (returns) before reaching the target part size must not
   * eagerly flush its partial buffer; that buffer has to travel to the
   * NEXT step instead. This accumulator only ever hands the caller that
   * leftover via currentBuffer() — persisting it durably across steps
   * (e.g. to a dedicated R2 staging object, never inline in a Workflow
   * step's own return value) is the caller's job, not this class's.
   */
  constructor({ uploadPart, targetPartBytes = BUDGETS.multipartPart.defaultBytes, startPartNumber = 1, initialBytes = null }) {
    if (typeof uploadPart !== 'function') throw new Error('PartAccumulator requires an uploadPart(partNumber, bytes) callback');
    this._uploadPart = uploadPart;
    this._targetPartBytes = targetPartBytes;
    this._partNumber = startPartNumber;
    this._buffered = initialBytes && initialBytes.byteLength ? [initialBytes] : [];
    this._bufferedBytes = initialBytes ? initialBytes.byteLength : 0;
    this._uploadedParts = [];
  }

  get partNumber() { return this._partNumber; }
  get uploadedParts() { return this._uploadedParts; }

  async onChunk(bytes) {
    this._buffered.push(bytes);
    this._bufferedBytes += bytes.byteLength;
    if (this._bufferedBytes >= this._targetPartBytes) await this._flush();
  }

  // The current not-yet-uploaded buffer, merged into one Uint8Array — call
  // this when a step is about to end WITHOUT having flushed a part, so the
  // caller can persist it for the next step to resume from.
  currentBuffer() {
    return concatChunks(this._buffered, this._bufferedBytes);
  }

  async _flush() {
    if (this._bufferedBytes === 0) return;
    const merged = concatChunks(this._buffered, this._bufferedBytes);
    const { etag } = await this._uploadPart(this._partNumber, merged);
    this._uploadedParts.push({ partNumber: this._partNumber, etag });
    this._partNumber += 1;
    this._buffered = [];
    this._bufferedBytes = 0;
  }

  // Uploads whatever's left, even under the target size — call exactly
  // once, after writer.finish() has emitted the central directory/EOCD.
  async flushFinal() {
    await this._flush();
    return this._uploadedParts;
  }
}

function concatChunks(chunks, totalBytes) {
  const out = new Uint8Array(totalBytes);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out;
}

/*
 * Runs one bounded packaging step: resumes a ZipStreamWriter from
 * `resumeState` (null for the very first call), adds plan entries starting
 * at `startIndex`, and stops — checkpointing — once EITHER `maxEntries`
 * entries have been added in this call OR the accumulator has flushed at
 * least one part, whichever comes first (§7: "checkpoint... after every
 * part or 100 entries"). If `startIndex` reaches the end of the plan, also
 * calls writer.finish() and flushes the final (possibly under-sized) part.
 *
 * `getEntryBytes(planEntry) -> AsyncIterable<Uint8Array>` is the only
 * injected byte source — the caller resolves a 'fixed' entry from its own
 * staged copy and a 'media' entry from R2/an embedded data URL.
 *
 * `initialPendingBytes` (optional) is whatever the PREVIOUS call returned
 * as `pendingBytes` — bytes already written into the ZIP stream (the
 * writer's `resumeState.offset` already accounts for them) but not yet
 * uploaded as a real R2 part, because R2/S3 forbids a non-final part under
 * 5 MiB. This call's own `pendingBytes` is non-null ONLY when it stops
 * without ever flushing a part (hit `maxEntriesPerStep`, or the plan itself
 * produced less than one part's worth of bytes) — the caller must persist
 * it (e.g. to a dedicated R2 staging key, never inline in the Workflow
 * step's own return value) and pass it back in on the next call. Losing
 * this buffer between steps would silently corrupt the archive: the
 * writer's offset already "counts" those bytes as emitted, but they'd
 * never actually reach R2.
 *
 * `resumeLedger` (optional, defaults to []) carries forward the per-entry
 * packaging ledger from a PRIOR call — one `{ path, byteLength, sha256 }`
 * record per entry actually streamed into the archive so far, computed
 * incrementally as each entry's real bytes pass through (§4.2 Package:
 * "compute SHA-256 while streaming each entry"; `createIncrementalSha256`
 * already existed in manifest.js for exactly this purpose but had never
 * been wired in anywhere — confirmed and fixed after a PR #9 review). This
 * is always safe to finalize entry-by-entry within a single call: the loop
 * above only ever advances `index` (and can only checkpoint) once
 * `writer.addEntry` has fully consumed one entry's bytes, so no entry's
 * hash is ever left partially computed across a step boundary — only
 * whole, already-finished ledger records need to travel between calls.
 * The returned `ledger` is the FULL ledger (resumeLedger plus whatever was
 * added this call) — the caller (workflowSteps.js's packageStep) persists
 * it to the checkpoint the same way it already persists `uploadedParts`,
 * and the verify step later cross-checks it against the archive plan/
 * manifest (the "packaging ledger" §4.2 Verify's own "validate manifest/
 * file counts and checksums from the packaging ledger" refers to).
 *
 * `getEntryBytes(entry, ledgerSoFar) -> AsyncIterable<Uint8Array>` now
 * takes a SECOND argument: the ledger as it stands immediately before this
 * entry (every entry already processed, whether resumed from a prior call
 * or from earlier iterations of THIS SAME loop) — needed so a caller can
 * build the manifest.json entry's real content (which embeds every OTHER
 * entry's final sha256) at the exact moment it's actually about to be
 * packaged. Since `kind: 'manifest'` entries are always forced to be the
 * plan's LAST entry (see buildArchivePlan's own `manifestFile` param),
 * `ledgerSoFar` at that point is genuinely complete. A manifest entry's
 * exact final byte length can only be known once its real content is
 * built this way — its plan-time `byteLength` is necessarily just a
 * placeholder — so its `getEntryBytes` call is fully materialized
 * (awaited to a single concrete Uint8Array) BEFORE `writer.addEntry` is
 * called, and that real length is used as the size hint instead of the
 * plan's own placeholder (ZipStreamWriter requires the hint to match the
 * true streamed length exactly).
 */
export async function runPackagingStep({
  plan, startIndex, resumeState, uploadPart, getEntryBytes,
  maxEntriesPerStep = BUDGETS.packagingCheckpoint.maxEntriesBetweenCheckpoints,
  targetPartBytes = BUDGETS.multipartPart.defaultBytes,
  startPartNumber = 1,
  initialPendingBytes = null,
  resumeLedger = [],
}) {
  const accumulator = new PartAccumulator({ uploadPart, targetPartBytes, startPartNumber, initialBytes: initialPendingBytes });
  const writer = new ZipStreamWriter({ onChunk: (b) => accumulator.onChunk(b), resumeState });
  const ledger = [...resumeLedger];

  let index = startIndex;
  let entriesAddedThisStep = 0;
  while (index < plan.length && entriesAddedThisStep < maxEntriesPerStep && accumulator.uploadedParts.length === 0) {
    const entry = plan[index];
    let rawChunks = await getEntryBytes(entry, ledger);
    let sizeHint = entry.byteLength;
    if (entry.kind === 'manifest') {
      const materialized = [];
      let total = 0;
      for await (const chunk of rawChunks) { materialized.push(chunk); total += chunk.byteLength; }
      rawChunks = materialized;
      sizeHint = total;
    }
    const hasher = createIncrementalSha256();
    let byteLength = 0;
    async function* hashedChunks() {
      for await (const chunk of rawChunks) {
        hasher.update(chunk);
        byteLength += chunk.byteLength;
        yield chunk;
      }
    }
    await writer.addEntry(entry.path, hashedChunks(), { uncompressedSizeHint: sizeHint, compress: entry.compress });
    ledger.push({ path: entry.path, byteLength, sha256: hasher.digestHex() });
    index += 1;
    entriesAddedThisStep += 1;
  }

  const done = index >= plan.length;
  if (done) {
    await writer.finish();
    await accumulator.flushFinal();
  }
  // Only non-empty when this call stopped WITHOUT flushing a part — once a
  // flush happens (mid-loop or via flushFinal), the loop stops adding more
  // entries that same call, so the accumulator's buffer is provably empty.
  const pendingBytes = accumulator.uploadedParts.length === 0 ? accumulator.currentBuffer() : null;

  return {
    done,
    nextIndex: index,
    pendingBytes: pendingBytes && pendingBytes.byteLength ? pendingBytes : null,
    writerState: writer.exportState(),
    uploadedParts: accumulator.uploadedParts,
    nextPartNumber: accumulator.partNumber,
    ledger,
  };
}

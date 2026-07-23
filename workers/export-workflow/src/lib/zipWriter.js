/*
 * Streaming ZIP64 writer (docs/FULL-ARCHIVE-EXPORT.md §2.5, §4.2 stage 4,
 * §13.5). Entries are written as their bytes become available — nothing
 * is buffered beyond one entry's compression stream — and the archive is
 * built entirely forward-only: no seeking back into already-emitted bytes
 * to patch a header, which is what makes this genuinely streamable to an
 * R2 multipart upload one part at a time.
 *
 * Design choices made deliberately, to eliminate a whole class of subtle
 * interop bugs rather than trying to out-clever them (this is exactly the
 * risk area flagged during design review — "entry/part packing... produces
 * off-by-one corruption bugs in a hand-rolled streaming ZIP64 writer"):
 *
 * 1. EVERY entry defers CRC-32 and both sizes to a trailing data
 *    descriptor (general-purpose bit 3), uniformly — never a per-entry
 *    decision between "sizes known up front" and "deferred". CRC is
 *    fundamentally only known after the last byte is processed, so a
 *    uniform rule avoids a second, inconsistent code path.
 * 2. Whether THIS entry needs the ZIP64 (8-byte) variant of the local
 *    header's extra field, the data descriptor, and the central directory
 *    record is decided from a caller-supplied `uncompressedSizeHint`
 *    BEFORE any bytes are written — real callers always know this ahead
 *    of time here (an R2 head() call's byteLength, a decoded data: URL's
 *    length, or an in-memory JSON string's length). The actual measured
 *    sizes are checked against that decision at entry-finalization time;
 *    a violated hint throws rather than silently emitting a corrupt
 *    archive with mismatched field widths.
 * 3. When a ZIP64 local-header extra field is written, ITS size fields are
 *    placeholders (the real values are still unknown) — this is what
 *    signals to a data-descriptor-aware reader that an 8-byte, not 4-byte,
 *    descriptor follows the entry, resolving what is otherwise a genuine
 *    ambiguity in the ZIP64 + data-descriptor combination.
 * 4. The central directory (plus the ZIP64 EOCD record/locator/EOCD) is
 *    the authoritative source every mainstream unzip tool (Explorer,
 *    Archive Utility, most CLI tools) actually reads from — they seek to
 *    the end of the file and work backwards, rather than trusting local
 *    headers/data descriptors at all. That's where correctness matters
 *    most, and where this implementation is most heavily tested.
 */
import { createIncrementalCrc32 } from './crc32.js';
import { assertSafeArchivePath } from './archivePath.js';

const SIG_LOCAL_FILE_HEADER = 0x04034b50;
const SIG_DATA_DESCRIPTOR = 0x08074b50;
const SIG_CENTRAL_FILE_HEADER = 0x02014b50;
const SIG_ZIP64_EOCD_RECORD = 0x06064b50;
const SIG_ZIP64_EOCD_LOCATOR = 0x07064b50;
const SIG_EOCD = 0x06054b50;
const ZIP64_EXTRA_ID = 0x0001;
const GPBIT_DATA_DESCRIPTOR = 0x0008;
const GPBIT_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const VERSION_NEEDED_DEFAULT = 20;
const VERSION_NEEDED_ZIP64 = 45;

// One below the true 0xFFFFFFFF sentinel — kept as a named export so tests
// can override it to a tiny value and force every entry through the ZIP64
// code path with small fixtures, proving the encoding is correct without
// needing multi-gigabyte test files.
export const DEFAULT_ZIP64_THRESHOLD = 0xfffffffe;
const ZIP32_ENTRY_COUNT_THRESHOLD = 0xfffe; // leave 0xffff as the sentinel

function toDosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
  return { dosTime, dosDate };
}

function concatBuffers(buffers) {
  const total = buffers.reduce((n, b) => n + b.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of buffers) { out.set(b, offset); offset += b.byteLength; }
  return out;
}

/*
 * Streams `chunks` through to `emit(chunk)` as each one becomes available
 * — NEVER collected into an array first. An earlier version of this
 * function buffered every (source or compressed) chunk into a `out[]`
 * array and returned it for the caller to emit afterward, which held an
 * entire large entry (a big document, a video) fully in memory before a
 * single byte reached the sink — directly contradicting the streaming
 * guarantee and the one-part memory budget (§2.6). Fixed by emitting each
 * chunk the moment it's produced; see the "genuinely streams" tests in
 * zipWriter.test.mjs, which prove output begins before the source
 * iterable finishes rather than just checking the end result is correct.
 */
async function streamCompressed(chunks, method, emit) {
  if (method === METHOD_STORE) {
    let compressedSize = 0n;
    for await (const chunk of chunks) {
      await emit(chunk);
      compressedSize += BigInt(chunk.byteLength);
    }
    return { compressedSize };
  }
  if (method === METHOD_DEFLATE) {
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();
    let compressedSize = 0n;

    const pump = (async () => {
      for await (const chunk of chunks) await writer.write(chunk);
      await writer.close();
    })();
    const drain = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await emit(value);
        compressedSize += BigInt(value.byteLength);
      }
    })();
    await Promise.all([pump, drain]);
    return { compressedSize };
  }
  throw new Error(`unsupported compression method: ${method}`);
}

export class ZipStreamWriter {
  /*
   * `onChunk(Uint8Array)` receives every byte this writer produces, in
   * order — the only sink; callers pipe this straight into an R2
   * multipart upload part accumulator, or into an in-memory buffer for
   * tests. `zip64Threshold` is exposed for tests only (see the exported
   * default above); real usage should never override it.
   */
  constructor({ onChunk, zip64Threshold = DEFAULT_ZIP64_THRESHOLD } = {}) {
    if (typeof onChunk !== 'function') throw new Error('ZipStreamWriter requires an onChunk(bytes) sink');
    this._onChunk = onChunk;
    this._zip64Threshold = BigInt(zip64Threshold);
    this._offset = 0n;
    this._centralRecords = [];
    this._finished = false;
    this._seenPaths = new Set();
  }

  async _emit(bytes) {
    if (bytes.byteLength === 0) return;
    await this._onChunk(bytes);
    this._offset += BigInt(bytes.byteLength);
  }

  /*
   * Writes one archive entry. `chunks` is any (async or sync) iterable of
   * Uint8Array carrying the entry's RAW (uncompressed) bytes — the caller
   * never needs to hold the whole entry in memory, only whatever chunk
   * size it chooses to iterate with. `uncompressedSizeHint` (required) is
   * the entry's exact uncompressed byte length, known ahead of time by
   * every real caller in this system (an R2 head() result, a decoded
   * data: URL, or an in-memory string) — used only to decide the ZIP64
   * question before any header is written; the real measured size is
   * checked against it once streaming finishes.
   */
  async addEntry(path, chunks, { uncompressedSizeHint, compress = 'store', mtime = new Date() } = {}) {
    if (this._finished) throw new Error('cannot add an entry after finish() has been called');
    if (uncompressedSizeHint == null) throw new Error(`addEntry("${path}") requires uncompressedSizeHint`);
    assertSafeArchivePath(path);
    if (this._seenPaths.has(path)) throw new Error(`duplicate archive path: "${path}"`);
    this._seenPaths.add(path);

    const method = compress === 'deflate-raw' ? METHOD_DEFLATE : METHOD_STORE;
    const sizeHint = BigInt(uncompressedSizeHint);
    const needsZip64 = sizeHint >= this._zip64Threshold;
    const localHeaderOffset = this._offset;
    const nameBytes = new TextEncoder().encode(path);
    const { dosTime, dosDate } = toDosDateTime(mtime);

    // ── local file header ──────────────────────────────────────────────
    const versionNeeded = needsZip64 ? VERSION_NEEDED_ZIP64 : VERSION_NEEDED_DEFAULT;
    const zip64LocalExtra = needsZip64 ? buildZip64LocalExtra() : new Uint8Array(0);
    const lfh = new Uint8Array(30 + nameBytes.length + zip64LocalExtra.length);
    const lfhView = new DataView(lfh.buffer);
    lfhView.setUint32(0, SIG_LOCAL_FILE_HEADER, true);
    lfhView.setUint16(4, versionNeeded, true);
    lfhView.setUint16(6, GPBIT_DATA_DESCRIPTOR | GPBIT_UTF8, true);
    lfhView.setUint16(8, method, true);
    lfhView.setUint16(10, dosTime, true);
    lfhView.setUint16(12, dosDate, true);
    lfhView.setUint32(14, 0, true); // crc-32 — deferred to data descriptor
    lfhView.setUint32(18, 0, true); // compressed size — deferred
    lfhView.setUint32(22, 0, true); // uncompressed size — deferred
    lfhView.setUint16(26, nameBytes.length, true);
    lfhView.setUint16(28, zip64LocalExtra.length, true);
    lfh.set(nameBytes, 30);
    lfh.set(zip64LocalExtra, 30 + nameBytes.length);
    await this._emit(lfh);

    // ── entry data (streamed, CRC + sizes tracked as it goes) ──────────
    const crcHasher = createIncrementalCrc32();
    let uncompressedSize = 0n;
    const trackedChunks = trackingIterable(chunks, (chunk) => {
      crcHasher.update(chunk);
      uncompressedSize += BigInt(chunk.byteLength);
    });
    const { compressedSize } = await streamCompressed(trackedChunks, method, (chunk) => this._emit(chunk));

    if (uncompressedSize !== sizeHint) {
      throw new Error(
        `addEntry("${path}"): actual uncompressed size ${uncompressedSize} did not match the supplied hint ${sizeHint}`,
      );
    }
    const finalNeedsZip64 = needsZip64 || compressedSize >= this._zip64Threshold || localHeaderOffset >= this._zip64Threshold;
    if (finalNeedsZip64 && !needsZip64) {
      // The hint said this entry wouldn't need ZIP64, but the actual
      // compressed size (or, in a huge archive, the offset itself) does —
      // the local header we already emitted is now wrong (no ZIP64 extra
      // field), and we can't seek back to fix it in a true streaming
      // writer. Fail loudly rather than silently emit a corrupt archive.
      throw new Error(
        `addEntry("${path}"): compressed size ${compressedSize} or offset ${localHeaderOffset} needs ZIP64 but the local header was written without it — increase the size hint's safety margin or accept the archive-size boundary`,
      );
    }

    const crc32 = crcHasher.crc32();

    // ── data descriptor ─────────────────────────────────────────────────
    const dd = needsZip64 ? new Uint8Array(24) : new Uint8Array(16);
    const ddView = new DataView(dd.buffer);
    ddView.setUint32(0, SIG_DATA_DESCRIPTOR, true);
    ddView.setUint32(4, crc32, true);
    if (needsZip64) {
      ddView.setBigUint64(8, compressedSize, true);
      ddView.setBigUint64(16, uncompressedSize, true);
    } else {
      ddView.setUint32(8, Number(compressedSize), true);
      ddView.setUint32(12, Number(uncompressedSize), true);
    }
    await this._emit(dd);

    this._centralRecords.push({
      path, nameBytes, method, dosTime, dosDate, crc32,
      compressedSize, uncompressedSize, localHeaderOffset, needsZip64,
    });
  }

  /*
   * Writes the central directory, the ZIP64 EOCD record + locator when
   * needed, and the standard EOCD. After this, the archive is complete
   * and no further entries may be added.
   */
  async finish() {
    if (this._finished) throw new Error('finish() already called');
    this._finished = true;

    const cdStart = this._offset;
    for (const rec of this._centralRecords) await this._emit(buildCentralDirectoryRecord(rec, this._zip64Threshold));
    const cdEnd = this._offset;
    const cdSize = cdEnd - cdStart;

    const entryCount = this._centralRecords.length;
    const needsZip64Eocd = entryCount > ZIP32_ENTRY_COUNT_THRESHOLD || cdSize >= this._zip64Threshold || cdStart >= this._zip64Threshold;

    if (needsZip64Eocd) {
      const zip64EocdOffset = this._offset;
      await this._emit(buildZip64EocdRecord({ entryCount, cdSize, cdStart }));
      await this._emit(buildZip64EocdLocator(zip64EocdOffset));
    }
    await this._emit(buildEocd({ entryCount, cdSize, cdStart, needsZip64Eocd }));
  }
}

// Wraps an iterable so a side-effect callback observes every chunk as it
// passes through, without buffering — used to compute CRC/size on the RAW
// bytes regardless of whether they're then compressed or stored as-is.
function trackingIterable(source, onChunk) {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const chunk of source) { onChunk(chunk); yield chunk; }
    },
  };
}

function buildZip64LocalExtra() {
  // Placeholder sizes (real values still unknown at this point) — the
  // field's mere PRESENCE, with this well-known tag/size, is what a
  // data-descriptor-aware reader uses to know an 8-byte descriptor
  // follows, per this module's own design note above.
  const extra = new Uint8Array(20);
  const view = new DataView(extra.buffer);
  view.setUint16(0, ZIP64_EXTRA_ID, true);
  view.setUint16(2, 16, true); // size of the extra field's data (2x uint64)
  view.setBigUint64(4, 0n, true); // uncompressed size placeholder
  view.setBigUint64(12, 0n, true); // compressed size placeholder
  return extra;
}

function buildCentralDirectoryRecord(rec, zip64Threshold) {
  const needsZip64 = rec.needsZip64 || rec.compressedSize >= zip64Threshold || rec.uncompressedSize >= zip64Threshold || rec.localHeaderOffset >= zip64Threshold;
  const zip64Extra = needsZip64 ? buildZip64CentralExtra(rec) : new Uint8Array(0);
  const versionNeeded = needsZip64 ? VERSION_NEEDED_ZIP64 : VERSION_NEEDED_DEFAULT;

  const record = new Uint8Array(46 + rec.nameBytes.length + zip64Extra.length);
  const view = new DataView(record.buffer);
  view.setUint32(0, SIG_CENTRAL_FILE_HEADER, true);
  view.setUint16(4, versionNeeded, true); // version made by
  view.setUint16(6, versionNeeded, true); // version needed to extract
  view.setUint16(8, GPBIT_DATA_DESCRIPTOR | GPBIT_UTF8, true);
  view.setUint16(10, rec.method, true);
  view.setUint16(12, rec.dosTime, true);
  view.setUint16(14, rec.dosDate, true);
  view.setUint32(16, rec.crc32, true);
  view.setUint32(20, needsZip64 ? 0xffffffff : Number(rec.compressedSize), true);
  view.setUint32(24, needsZip64 ? 0xffffffff : Number(rec.uncompressedSize), true);
  view.setUint16(28, rec.nameBytes.length, true);
  view.setUint16(30, zip64Extra.length, true);
  view.setUint16(32, 0, true); // file comment length
  view.setUint16(34, 0, true); // disk number start
  view.setUint16(36, 0, true); // internal file attributes
  view.setUint32(38, 0, true); // external file attributes
  view.setUint32(42, needsZip64 ? 0xffffffff : Number(rec.localHeaderOffset), true);
  record.set(rec.nameBytes, 46);
  record.set(zip64Extra, 46 + rec.nameBytes.length);
  return record;
}

function buildZip64CentralExtra(rec) {
  const extra = new Uint8Array(28);
  const view = new DataView(extra.buffer);
  view.setUint16(0, ZIP64_EXTRA_ID, true);
  view.setUint16(2, 24, true); // 3x uint64
  view.setBigUint64(4, rec.uncompressedSize, true);
  view.setBigUint64(12, rec.compressedSize, true);
  view.setBigUint64(20, rec.localHeaderOffset, true);
  return extra;
}

function buildZip64EocdRecord({ entryCount, cdSize, cdStart }) {
  const record = new Uint8Array(56);
  const view = new DataView(record.buffer);
  view.setUint32(0, SIG_ZIP64_EOCD_RECORD, true);
  view.setBigUint64(4, 44n, true); // size of this record, excluding the first 12 bytes
  view.setUint16(12, VERSION_NEEDED_ZIP64, true); // version made by
  view.setUint16(14, VERSION_NEEDED_ZIP64, true); // version needed to extract
  view.setUint32(16, 0, true); // number of this disk
  view.setUint32(20, 0, true); // disk with start of CD
  view.setBigUint64(24, BigInt(entryCount), true); // entries on this disk
  view.setBigUint64(32, BigInt(entryCount), true); // total entries
  view.setBigUint64(40, cdSize, true);
  view.setBigUint64(48, cdStart, true);
  return record;
}

function buildZip64EocdLocator(zip64EocdOffset) {
  const record = new Uint8Array(20);
  const view = new DataView(record.buffer);
  view.setUint32(0, SIG_ZIP64_EOCD_LOCATOR, true);
  view.setUint32(4, 0, true); // disk with the zip64 EOCD record
  view.setBigUint64(8, zip64EocdOffset, true);
  view.setUint32(16, 1, true); // total number of disks
  return record;
}

function buildEocd({ entryCount, cdSize, cdStart, needsZip64Eocd }) {
  const record = new Uint8Array(22);
  const view = new DataView(record.buffer);
  view.setUint32(0, SIG_EOCD, true);
  view.setUint16(4, 0, true); // disk number
  view.setUint16(6, 0, true); // disk with CD start
  view.setUint16(8, needsZip64Eocd ? 0xffff : entryCount, true);
  view.setUint16(10, needsZip64Eocd ? 0xffff : entryCount, true);
  view.setUint32(12, needsZip64Eocd ? 0xffffffff : Number(cdSize), true);
  view.setUint32(16, needsZip64Eocd ? 0xffffffff : Number(cdStart), true);
  view.setUint16(20, 0, true); // comment length
  return record;
}

export { concatBuffers };

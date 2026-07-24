/*
 * Independent ZIP EOCD/central-directory reader for verifyArchiveStep
 * (docs/FULL-ARCHIVE-EXPORT.md §4.2 Verify: "read and validate the ZIP
 * central directory/range footer" + "validate manifest/file counts and
 * checksums from the packaging ledger"). Deliberately narrow — this reads
 * exactly what zipWriter.js itself ever writes (never an archive/entry
 * comment, always a data-descriptor per entry, ZIP64 fields exactly as
 * buildZip64EocdRecord/buildZip64EocdLocator/buildEocd there emit them) —
 * it is not a general-purpose ZIP parser, and pairs with that module as
 * the "second, independent reader" the design's own review emphasized
 * (the writer's own unit tests already use `unzip`/`zipinfo` as one
 * independent reader; this is a second, in-process one used specifically
 * so verifyArchiveStep never has to buffer a whole — potentially many-GB —
 * archive into memory just to confirm its structure, matching §2.6's "never
 * hold the full ZIP... in memory" the same way packaging itself does).
 *
 * Every function here is pure: it operates on bytes the caller already
 * fetched (via bounded R2 range reads — see workflowSteps.js#verifyArchiveStep),
 * never doing I/O itself, so it's provable against hand-built byte fixtures
 * with no R2/D1 involved at all (tests/zipVerify.test.mjs).
 */

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD_RECORD = 0x06064b50;
const SIG_CENTRAL_FILE_HEADER = 0x02014b50;
const ZIP64_EXTRA_ID = 0x0001;

const EOCD_SIZE = 22;
const ZIP64_LOCATOR_SIZE = 20;
const ZIP64_EOCD_RECORD_SIZE = 56;

// The absolute largest this format's own fixed-size trailer can ever be
// (zip64 EOCD record + locator + EOCD) — zipWriter.js never writes an
// archive/entry comment (see buildEocd/buildCentralDirectoryRecord, both
// always 0), so unlike a general-purpose ZIP reader this module never
// needs to search for a variable-length comment: the trailer's maximum
// size is this fixed constant, independent of the central directory's own
// size (which sits BEFORE the trailer, not inside it). A production caller
// (workflowSteps.js#verifyArchiveStep) picks its tail window with a
// generous margin over this so a single bounded range read always
// contains the whole trailer in one shot.
export const MAX_TRAILER_BYTES = ZIP64_EOCD_RECORD_SIZE + ZIP64_LOCATOR_SIZE + EOCD_SIZE;

/*
 * Parses the EOCD (and, when present, the ZIP64 EOCD record + locator that
 * precede it) out of a TAIL window of archive bytes. `tailOffset` is the
 * absolute file offset the first byte of `tailBytes` corresponds to, so
 * `cdStart` in the return value is always an absolute file position, never
 * a position relative to the tail window itself. Throws a clear error if
 * the supplied window is too small to contain the whole trailer — see
 * MAX_TRAILER_BYTES above for why that's always a caller sizing bug (or a
 * corrupt archive), never a property of how large the archive itself is.
 */
export function parseEocdTail(tailBytes, tailOffset) {
  const view = new DataView(tailBytes.buffer, tailBytes.byteOffset, tailBytes.byteLength);

  let eocdPos = -1;
  for (let i = tailBytes.byteLength - EOCD_SIZE; i >= 0; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) { eocdPos = i; break; }
  }
  if (eocdPos === -1) throw new Error('EOCD signature not found in the supplied archive tail window');

  const eocdEntryCount = view.getUint16(eocdPos + 10, true);
  const eocdCdSize = view.getUint32(eocdPos + 12, true);
  const eocdCdStart = view.getUint32(eocdPos + 16, true);
  const needsZip64 = eocdEntryCount === 0xffff || eocdCdSize === 0xffffffff || eocdCdStart === 0xffffffff;

  if (!needsZip64) {
    return { entryCount: eocdEntryCount, cdSize: BigInt(eocdCdSize), cdStart: BigInt(eocdCdStart) };
  }

  const locatorPos = eocdPos - ZIP64_LOCATOR_SIZE;
  if (locatorPos < 0 || view.getUint32(locatorPos, true) !== SIG_ZIP64_EOCD_LOCATOR) {
    throw new Error('EOCD indicates ZIP64 but no ZIP64 EOCD locator was found immediately before it — the tail window may be too small (see MAX_TRAILER_BYTES) or the archive is corrupt');
  }
  const zip64EocdOffsetAbs = view.getBigUint64(locatorPos + 8, true);
  const zip64EocdPosInTail = Number(zip64EocdOffsetAbs) - tailOffset;

  if (zip64EocdPosInTail < 0 || view.getUint32(zip64EocdPosInTail, true) !== SIG_ZIP64_EOCD_RECORD) {
    throw new Error('ZIP64 EOCD locator points to a location that is not a ZIP64 EOCD record — the tail window may be too small (see MAX_TRAILER_BYTES) or the archive is corrupt');
  }
  const entryCount = view.getBigUint64(zip64EocdPosInTail + 32, true);
  const cdSize = view.getBigUint64(zip64EocdPosInTail + 40, true);
  const cdStart = view.getBigUint64(zip64EocdPosInTail + 48, true);
  return { entryCount: Number(entryCount), cdSize, cdStart };
}

/*
 * Parses exactly `entryCount` central directory file header records out of
 * `cdBytes` (a range read covering exactly `[cdStart, cdStart + cdSize)`,
 * the precise bounds parseEocdTail already gave the caller — never a scan
 * or a guess). Returns one `{ path, uncompressedSize, compressedSize,
 * localHeaderOffset }` per entry, in on-disk order, reading the real ZIP64
 * extra field when the 32-bit fields carry the 0xFFFFFFFF sentinel.
 */
export function parseCentralDirectory(cdBytes, entryCount) {
  const view = new DataView(cdBytes.buffer, cdBytes.byteOffset, cdBytes.byteLength);
  const decoder = new TextDecoder();
  const entries = [];
  let pos = 0;

  for (let i = 0; i < entryCount; i++) {
    if (pos + 46 > cdBytes.byteLength || view.getUint32(pos, true) !== SIG_CENTRAL_FILE_HEADER) {
      throw new Error(`central directory record ${i} has a bad signature at offset ${pos} (archive truncated or corrupt)`);
    }
    let compressedSize = BigInt(view.getUint32(pos + 20, true) >>> 0);
    let uncompressedSize = BigInt(view.getUint32(pos + 24, true) >>> 0);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    let localHeaderOffset = BigInt(view.getUint32(pos + 42, true) >>> 0);

    const path = decoder.decode(cdBytes.subarray(pos + 46, pos + 46 + nameLen));

    const needsZip64 = compressedSize === 0xffffffffn || uncompressedSize === 0xffffffffn || localHeaderOffset === 0xffffffffn;
    if (needsZip64) {
      let extraPos = pos + 46 + nameLen;
      const extraEnd = extraPos + extraLen;
      while (extraPos + 4 <= extraEnd) {
        const tag = view.getUint16(extraPos, true);
        const size = view.getUint16(extraPos + 2, true);
        if (tag === ZIP64_EXTRA_ID) {
          let off = extraPos + 4;
          if (uncompressedSize === 0xffffffffn) { uncompressedSize = view.getBigUint64(off, true); off += 8; }
          if (compressedSize === 0xffffffffn) { compressedSize = view.getBigUint64(off, true); off += 8; }
          if (localHeaderOffset === 0xffffffffn) { localHeaderOffset = view.getBigUint64(off, true); off += 8; }
        }
        extraPos += 4 + size;
      }
    }

    entries.push({ path, uncompressedSize, compressedSize, localHeaderOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

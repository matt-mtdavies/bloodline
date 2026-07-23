/*
 * A standard, table-based CRC-32 (the IEEE 802.3 polynomial ZIP itself
 * uses) — hand-rolled rather than reached for a dependency because the
 * algorithm is small, completely standard, and unambiguous (unlike a hash
 * function, there's no cryptographic subtlety to get wrong), and this way
 * it's pure JS with zero dependencies, portable to both Node (these tests)
 * and the Workflow Worker runtime. Verified in tests against Node's own
 * `zlib.crc32()` as a correctness oracle.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

/*
 * Incremental CRC-32, mirroring lib/manifest.js's createIncrementalSha256
 * shape — update(chunk) as bytes stream through, crc32() once at the end.
 */
export function createIncrementalCrc32() {
  let crc = 0xffffffff;
  return {
    update(chunk) {
      for (let i = 0; i < chunk.length; i++) {
        crc = CRC_TABLE[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
      }
      return this;
    },
    crc32() {
      return (crc ^ 0xffffffff) >>> 0;
    },
  };
}

export function crc32Of(bytes) {
  return createIncrementalCrc32().update(bytes).crc32();
}

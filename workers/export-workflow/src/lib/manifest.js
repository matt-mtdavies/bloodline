/*
 * Manifest v1 builder (docs/FULL-ARCHIVE-EXPORT.md §3.9) plus the SHA-256
 * helpers every archived binary and the manifest itself need.
 *
 * Uses `node:crypto`'s `createHash` rather than Web Crypto's
 * `crypto.subtle.digest` — Web Crypto's digest is one-shot only (no
 * incremental update/final), which can't hash a large entry while
 * streaming it without buffering the whole thing in memory first, directly
 * contradicting §2.6's "compute SHA-256 while streaming each entry... never
 * hold the full ZIP or all media bodies in memory". `node:crypto`'s Hash
 * IS incremental (`.update()` repeatedly, `.digest()` once at the end) and
 * is fully supported inside Cloudflare Workers under the `nodejs_compat`
 * compatibility flag (already set in wrangler.toml) — confirmed against
 * Cloudflare's current docs during design review, not assumed. This is the
 * one crypto primitive this whole package uses, so Node (these tests) and
 * the real Workflow Worker runtime behave identically.
 */
import { createHash } from 'node:crypto';

const ARCHIVE_FORMAT = 'bloodline-full-archive';
const ARCHIVE_VERSION = 1;
const VIEWER_VERSION = 1;

/*
 * SHA-256 of a string or Uint8Array, returned as lowercase hex — a one-shot
 * convenience for small values (the manifest's own checksum, small
 * metadata files) that don't need incremental hashing. Large binaries
 * should use createIncrementalSha256() below instead.
 */
export function sha256Hex(input) {
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input));
  return createHash('sha256').update(bytes).digest('hex');
}

/*
 * An incremental SHA-256 hasher: call `update(chunk)` once per chunk as it
 * streams through (e.g. while writing a ZIP entry part by part), then
 * `digestHex()` once at the end — the entry's bytes are never buffered in
 * full just to compute its checksum.
 */
export function createIncrementalSha256() {
  const hash = createHash('sha256');
  return {
    update(chunk) { hash.update(chunk); return this; },
    digestHex() { return hash.digest('hex'); },
  };
}

/*
 * Recursively sorts object keys (never array element order — array order
 * is meaningful, e.g. `files` in lexical path order) so two logically
 * identical objects always serialize byte-identically regardless of the
 * order they were constructed in. This is what makes the manifest checksum
 * (and the acceptance test "a second identical source snapshot produces
 * the same checksums") actually reliable.
 */
export function canonicalJSONStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

/*
 * Builds the manifest.json object per §3.9. `files` is sorted into lexical
 * path order here (matching the ZIP entries themselves, per §4.2 stage 4)
 * so the manifest's own file listing and the archive's physical entry
 * order always agree, and so two runs against an identical source produce
 * an identical `files` array regardless of the order inventory entries
 * happened to be discovered in.
 */
export function buildManifest({
  jobId,
  family,
  createdAt,
  source,
  requestedAs,
  status,
  counts = {},
  totalBytes = 0,
  files = [],
  warnings = [],
}) {
  if (!jobId) throw new Error('buildManifest requires jobId');
  if (!family?.id) throw new Error('buildManifest requires family.id');
  if (!createdAt) throw new Error('buildManifest requires createdAt');
  if (!requestedAs) throw new Error('buildManifest requires requestedAs');
  if (!status) throw new Error('buildManifest requires status');

  const sortedFiles = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return {
    archiveFormat: ARCHIVE_FORMAT,
    archiveVersion: ARCHIVE_VERSION,
    viewerVersion: VIEWER_VERSION,
    jobId,
    family: { id: family.id, name: family.name ?? '' },
    createdAt,
    source: {
      treeUpdatedAt: source?.treeUpdatedAt ?? null,
      storageMode: source?.storageMode ?? 'legacy',
      extraVersion: source?.extraVersion ?? null,
    },
    requestedAs,
    status,
    counts,
    totalBytes,
    files: sortedFiles,
    warnings,
  };
}

/*
 * The manifest's own detached checksum — recorded in D1 and R2 custom
 * metadata per §3.9, independent of the checksum of any individual file
 * the manifest itself lists.
 */
export function computeManifestChecksum(manifest) {
  return sha256Hex(canonicalJSONStringify(manifest));
}

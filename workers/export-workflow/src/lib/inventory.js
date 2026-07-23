/*
 * Inventory builder (docs/FULL-ARCHIVE-EXPORT.md §3.5, §3.6, §4.2 stage 3):
 * walks a captured logical tree and extracts every media reference it
 * contains, classifying each one and producing the manifest-shaped entry
 * for it. Deliberately does no I/O of its own — every place a real R2 read
 * would happen is an injected async callback, so the exact same logic is
 * proven here against fake in-memory resolvers (Phase A) and reused
 * unchanged against real R2 bindings in the Workflow Worker (Phase B). This
 * mirrors functions/_lib/treeStore.js's own splitTree/reassembleTree
 * pattern: pure orchestration proven correct before any storage plumbing.
 *
 * Security note (§8.6/§8.7): the captured tree is the ONLY source of
 * truth for which R2 objects this job will ever touch — there is no
 * bucket-listing path here for photos/documents (only Keepsakes are
 * listed, and only under a prefix scoped to a family+person ID already
 * present in the captured tree). An external URL is recorded as a
 * reference and never fetched.
 */
import { buildArchivePath } from './archivePath.js';
import { sha256Hex } from './manifest.js';

const DATA_URL_RE = /^data:([^;,]+)?(;base64)?,(.*)$/s;
const API_PHOTO_RE = /^\/api\/photos\/([^/?#]+)$/;
const API_DOCUMENT_RE = /^\/api\/documents\/([^/?#]+)$/;

const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

export function extForMime(mime) {
  return MIME_TO_EXT[String(mime || '').toLowerCase()] || 'bin';
}

// decodeURIComponent throws URIError on malformed percent-encoding (e.g. a
// lone "%" or "%zz") — classifyReference documents itself as never
// throwing, so a legacy/hand-edited reference with a broken escape must
// become an explicit 'unsupported' classification instead of crashing the
// whole inventory walk over one bad field.
function safeDecodeURIComponent(s) {
  try { return decodeURIComponent(s); } catch { return null; }
}

/*
 * Classifies a raw reference string (a person.photo, photos[].src,
 * documents[].src/thumb value) into one of the shapes §3.5 recognizes.
 * Never throws — an unrecognized shape classifies as 'unsupported' rather
 * than halting the whole inventory over one bad field.
 */
export function classifyReference(rawRef) {
  if (typeof rawRef !== 'string' || !rawRef) return { kind: 'unsupported', raw: rawRef };

  const dataMatch = rawRef.match(DATA_URL_RE);
  if (dataMatch) {
    const [, mimeType, isBase64, payload] = dataMatch;
    if (!isBase64) return { kind: 'unsupported', raw: rawRef.slice(0, 40), reason: 'non-base64 data URL' };
    return { kind: 'data_url', mimeType: mimeType || 'application/octet-stream', base64: payload };
  }

  const photoMatch = rawRef.match(API_PHOTO_RE);
  if (photoMatch) {
    const key = safeDecodeURIComponent(photoMatch[1]);
    if (key == null) return { kind: 'unsupported', raw: rawRef.slice(0, 200), reason: 'malformed percent-encoding in photo key' };
    return { kind: 'r2', route: 'photos', key };
  }

  const docMatch = rawRef.match(API_DOCUMENT_RE);
  if (docMatch) {
    const key = safeDecodeURIComponent(docMatch[1]);
    if (key == null) return { kind: 'unsupported', raw: rawRef.slice(0, 200), reason: 'malformed percent-encoding in document key' };
    return { kind: 'r2', route: 'documents', key };
  }

  if (/^https?:\/\//i.test(rawRef)) return { kind: 'external', url: rawRef };

  return { kind: 'unsupported', raw: rawRef.slice(0, 200) };
}

function decodeBase64ToBytes(base64) {
  // atob/Buffer both exist in Node; Workers has atob globally too. Using
  // Buffer here (Node-only) would break Workers portability, so this uses
  // the Web-standard atob + manual byte conversion instead.
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/*
 * Resolves one classified reference into a manifest-shaped inventory entry.
 * `resolveR2Head(route, key)` is the only injected I/O — expected to return
 * `{ found: true, byteLength, mimeType, etag }` or `{ found: false }` for a
 * real R2 head() call (or a thrown error for a transient read failure,
 * treated as 'unreadable' rather than 'missing' — see §9's failure table).
 * No SHA-256 is computed here for r2-backed references: a head() alone
 * can't produce one without reading the whole body, and that read happens
 * once, during packaging (§4.2 stage 4), not twice.
 */
export async function resolveEntry({ archivePath, recordId, recordType, rawRef, ownerId }, resolveR2Head) {
  const ref = classifyReference(rawRef);
  const base = { path: archivePath, id: recordId, recordType, ownerId: ownerId ?? recordId, originalReference: describeReference(ref) };

  if (ref.kind === 'data_url') {
    try {
      const bytes = decodeBase64ToBytes(ref.base64);
      return { ...base, status: 'included', mimeType: ref.mimeType, byteLength: bytes.byteLength, sha256: sha256Hex(bytes) };
    } catch (e) {
      return { ...base, status: 'unsupported', warning: `could not decode embedded data URL: ${e.message}` };
    }
  }

  if (ref.kind === 'external') {
    return { ...base, status: 'external_reference' };
  }

  if (ref.kind === 'unsupported') {
    return { ...base, status: 'unsupported', warning: ref.reason || 'unrecognized reference format' };
  }

  // ref.kind === 'r2'
  if (typeof resolveR2Head !== 'function') {
    throw new Error('resolveEntry: an r2 reference requires a resolveR2Head(route, key) callback');
  }
  try {
    const head = await resolveR2Head(ref.route, ref.key);
    if (!head || head.found === false) return { ...base, status: 'missing' };
    return {
      ...base,
      status: 'included',
      mimeType: head.mimeType ?? null,
      byteLength: head.byteLength ?? null,
      etag: head.etag ?? null,
      r2Key: ref.key,
    };
  } catch (e) {
    return { ...base, status: 'unreadable', warning: e.message || 'R2 read failed' };
  }
}

// A short, bounded descriptor of the original reference for the manifest —
// deliberately NOT the raw data: payload (which can be many MB and would
// bloat manifest.json for every embedded photo); the archived file itself
// is the actual content, this is just provenance.
function describeReference(ref) {
  if (ref.kind === 'data_url') return { kind: 'data_url', mimeType: ref.mimeType };
  if (ref.kind === 'r2') return { kind: 'r2', route: ref.route, key: ref.key };
  if (ref.kind === 'external') return { kind: 'external', url: ref.url };
  return { kind: 'unsupported' };
}

/*
 * The pure half of media inventory: walks the captured tree's person
 * portraits, gallery photos, and document files/thumbnails and returns the
 * flat list of UNRESOLVED references (§7's "derive photo/document keys only
 * from captured tree") — no resolver, no I/O, so this can run in full over
 * an entire family in one cheap in-memory pass. The Workflow's inventory
 * step (workers/export-workflow/src/workflow.js) shards this list into
 * ≤100-entry batches and resolves each shard in its own checkpointed step;
 * buildMediaInventory below (Phase A's original, still used by tests and
 * any caller that wants the whole thing resolved in one call) is now a
 * thin wrapper over this plus resolveEntry, unchanged in behavior.
 */
export function deriveMediaReferences(tree) {
  const refs = [];

  for (const person of tree.people || []) {
    if (person.photo) {
      refs.push({
        archivePath: buildArchivePath('photos', person.id, person.display_name, extForMime(classifyReference(person.photo).mimeType)),
        recordId: person.id,
        recordType: 'person_photo',
        rawRef: person.photo,
      });
    }
    if (person.photo_thumb) {
      refs.push({
        archivePath: buildArchivePath('thumbnails', person.id, `${person.display_name || ''}-portrait-thumb`, extForMime(classifyReference(person.photo_thumb).mimeType)),
        recordId: person.id,
        recordType: 'person_photo_thumb',
        rawRef: person.photo_thumb,
      });
    }
  }

  for (const photo of tree.photos || []) {
    if (!photo.src) continue;
    refs.push({
      archivePath: buildArchivePath('photos', photo.id, photo.caption || photo.id, extForMime(classifyReference(photo.src).mimeType)),
      recordId: photo.id,
      recordType: 'photo',
      rawRef: photo.src,
      ownerId: photo.person_id,
    });
  }

  for (const doc of tree.documents || []) {
    if (doc.src) {
      refs.push({
        archivePath: buildArchivePath('documents', doc.id, doc.title || doc.id, extForMime(doc.mime || classifyReference(doc.src).mimeType)),
        recordId: doc.id,
        recordType: 'document',
        rawRef: doc.src,
        ownerId: doc.person_id,
      });
    }
    if (doc.thumb) {
      refs.push({
        archivePath: buildArchivePath('thumbnails', doc.id, `${doc.title || doc.id}-thumb`, extForMime(classifyReference(doc.thumb).mimeType)),
        recordId: doc.id,
        recordType: 'document_thumb',
        rawRef: doc.thumb,
        ownerId: doc.person_id,
      });
    }
  }

  return refs;
}

/*
 * Walks the captured tree's person portraits, gallery photos, and document
 * files/thumbnails, resolving each one via the injected resolver. Returns
 * a flat array of inventory entries in tree order (callers needing lexical
 * archive-path order, e.g. the manifest/ZIP writer, sort separately —
 * buildManifest already does this).
 */
export async function buildMediaInventory(tree, { resolveR2Head } = {}) {
  const entries = [];
  for (const ref of deriveMediaReferences(tree)) {
    entries.push(await resolveEntry(ref, resolveR2Head));
  }
  return entries;
}

// A Keepsake edition body is small JSON (docs/KEEPSAKE.md;
// functions/api/keepsake.js's own `edition` object: { personId, hash,
// editionNumber, compiledAt, recordCount, narrative: { epithet, origins,
// chapters, legacy } }) — cheap enough that Phase B's real packaging stage
// will have the full body in memory anyway once it streams the entry into
// the ZIP (unlike a multi-MB photo, there's no separate "avoid holding
// it" concern here). `listPrefix`'s result MAY optionally include that
// already-read `body` (string or pre-parsed object) per listed object; if
// present, this parses it defensively — a malformed/corrupt body degrades
// to no narrative rather than throwing and aborting the whole inventory.
// Mirrors functions/api/keepsake.js's own `validateNarrative` exactly — a
// Keepsake edition's `narrative` field is either this shape or it isn't
// safe to hand to the viewer's renderer, which calls `.map()` on
// origins/chapters/legacy/paragraphs directly. A corrupt or legacy-shaped
// object (or a future format change) must degrade to "no narrative"
// rather than let a malformed array-typed field crash the whole person
// view — validating here, at the one place every edition passes through,
// is more robust than trusting every future renderer to guard itself.
function isValidNarrative(n) {
  if (!n || typeof n !== 'object') return false;
  const strings = (a) => Array.isArray(a) && a.every((s) => typeof s === 'string');
  if (typeof n.epithet !== 'string' || !n.epithet.trim()) return false;
  if (!strings(n.origins)) return false;
  if (!strings(n.legacy)) return false;
  if (!Array.isArray(n.chapters)) return false;
  for (const ch of n.chapters) {
    if (!ch || typeof ch.title !== 'string' || typeof ch.years !== 'string' || !strings(ch.paragraphs)) return false;
  }
  return true;
}

function parseKeepsakeBody(body) {
  if (body == null) return null;
  let parsed = body;
  if (typeof body !== 'object') {
    try { parsed = JSON.parse(body); } catch { return null; }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  // The edition's OTHER fields (personId, hash, editionNumber, compiledAt,
  // recordCount) are untyped passthrough data the viewer only ever
  // displays as-is or ignores — only `narrative` drives `.map()` calls, so
  // only it needs schema validation. An edition with a malformed
  // narrative still keeps its other fields; the viewer's own `keepsake`
  // check (`person.keepsake.narrative || {}`) already treats a missing/
  // invalid narrative as "nothing to render", so this doesn't need a
  // separate malformed-flag — a null narrative here already downgrades
  // cleanly to the same UI path as "no Keepsake content available".
  return { ...parsed, narrative: isValidNarrative(parsed.narrative) ? parsed.narrative : null };
}

/*
 * Keepsake inventory (§3.6): for every person in the captured tree, lists
 * the exact prefix `keepsake/{familyId}/{personId}/` — never the whole
 * bucket — and de-duplicates `latest.json` against a hashed edition when
 * they carry the same R2 ETag (a single-part R2 `put()` sets ETag from the
 * body's MD5, so two byte-identical uploads always share one — this needs
 * no body read to detect, just the list() result already in hand).
 * Whichever entry represents the family's CURRENT edition (the alias
 * target, or a standalone `latest.json` with no matching hashed copy) is
 * flagged `isLatestEdition: true` — content-index.js uses this to pick
 * which edition to surface in the offline viewer when a person has
 * several historical ones.
 *
 * `listPrefix(prefix)` is the only injected I/O — expected to resolve to
 * an array of `{ key, byteLength, etag, body? }` for objects under that
 * prefix (an empty array for a person with no Keepsake at all, which is
 * NOT a warning per §3.6's own rule).
 */
export async function buildKeepsakeInventory(tree, familyId, { listPrefix } = {}) {
  if (typeof listPrefix !== 'function') {
    throw new Error('buildKeepsakeInventory requires a listPrefix(prefix) callback');
  }
  const entries = [];
  const aliases = [];

  for (const person of tree.people || []) {
    const prefix = `keepsake/${familyId}/${person.id}/`;
    const objects = await listPrefix(prefix);
    if (!objects || !objects.length) continue;

    const latest = objects.find((o) => o.key.endsWith('/latest.json'));
    const hashed = objects.filter((o) => o !== latest);
    let latestEntry = null;

    for (const obj of hashed) {
      const editionHash = obj.key.slice(prefix.length).replace(/\.json$/, '');
      const entry = {
        path: buildArchivePath('keepsakes', person.id, editionHash, 'json'),
        id: `${person.id}:${editionHash}`,
        recordType: 'keepsake_edition',
        ownerId: person.id,
        status: 'included',
        mimeType: 'application/json',
        byteLength: obj.byteLength ?? null,
        etag: obj.etag ?? null,
        r2Key: obj.key,
        edition: parseKeepsakeBody(obj.body),
      };
      entries.push(entry);
      if (latest?.etag && obj.etag && obj.etag === latest.etag) latestEntry = entry;
    }

    if (latest) {
      if (latestEntry) {
        const editionHash = latestEntry.id.split(':')[1];
        aliases.push({ personId: person.id, latestKey: latest.key, aliasOfPath: buildArchivePath('keepsakes', person.id, editionHash, 'json') });
      } else {
        // latest.json isn't byte-identical to any hashed edition currently
        // listed (e.g. a hashed copy was pruned, or writes are mid-flight)
        // — archive it as its own distinct file rather than silently
        // dropping the only copy of the family's current edition.
        latestEntry = {
          path: buildArchivePath('keepsakes', person.id, 'latest', 'json'),
          id: `${person.id}:latest`,
          recordType: 'keepsake_edition',
          ownerId: person.id,
          status: 'included',
          mimeType: 'application/json',
          byteLength: latest.byteLength ?? null,
          etag: latest.etag ?? null,
          r2Key: latest.key,
          edition: parseKeepsakeBody(latest.body),
        };
        entries.push(latestEntry);
      }
    }

    if (latestEntry) latestEntry.isLatestEdition = true;
  }

  return { entries, aliases };
}

/*
 * content-index.json + tree-data.js generator (docs/FULL-ARCHIVE-EXPORT.md
 * §3.2, §3.5, §3.8). Deliberately carries NO field that isn't already
 * present somewhere in tree.json, activity-log.json, or the manifest —
 * this is a derived lookup, never a second SOURCE of truth, and must
 * never be treated as restore input (§3.5's own words) — but it DOES
 * duplicate the relevant tree.json fields it needs, because of a genuine
 * ambiguity surfaced while building the viewer, documented here rather
 * than silently resolved one way or the other:
 *
 * §3.2's directory layout lists `tree.json` and `tree-data.js` adjacently,
 * which reads as "tree-data.js is tree.json's own JS-wrapped twin" — but
 * §3.5's prose instead ties `tree-data.js` to THIS module's own narrower
 * "viewer index" (originally just id/name/searchKey lookups). Taken
 * literally, that narrower shape cannot satisfy §3.8's viewer
 * requirements ("person profile with all scalar fields... life events,
 * memories, photos and documents") — file:// blocks fetch()/XHR entirely
 * (§3.8), so if `tree-data.js` only carries the narrow lookup, there is no
 * OTHER way for the viewer to ever read a person's actual profile data at
 * all. Resolved for Phase A by extending this module's index to carry
 * full per-person profile fields, life events (already embedded on each
 * person, see src/data/store.js's `person.events[]`), and memories
 * (`tree.memories[]`, joined by `person_id`) — so the ONE `tree-data.js`
 * file the layout actually shows is sufficient to build the whole viewer,
 * and tree.json itself can stay exactly what §3.8 says it is: "the raw
 * tree.json remains authoritative... an additional convenience, not the
 * only way to read the archive" — i.e. present for programmatic/expert
 * use, never parsed by the viewer itself. Flagged for Codex to confirm or
 * correct in the next brief revision; nothing here blocks Phase A's own
 * proof, since both output forms are still generated from one object and
 * proven identical by test either way.
 *
 * Both output forms — the plain JSON file and the `tree-data.js` global-
 * assignment wrapper (needed because file:// blocks fetch()/XHR) — are
 * generated from the exact same in-memory object, so they can never drift
 * from each other; the equivalence is also proven by a test that decodes
 * both and diffs them.
 */
const VIEWER_INDEX_VERSION = 1;
const TREE_DATA_GLOBAL = '__BLOODLINE_ARCHIVE__';

// Collapses whitespace/case for a simple substring search — deliberately
// not a full search index (stemming, tokenization); the viewer's own
// search box does a plain substring match against this key, mirroring how
// small this viewer needs to be per §3.8 ("does not need to reproduce...
// a simple relationship browser is more durable").
function normalizeSearchKey(text) {
  return String(text || '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();
}

// Fields intentionally NOT carried into the viewer index even though
// they're on the person object: none, currently — every scalar field is
// something §3.8 asks the viewer to show ("all scalar fields"), and this
// archive is lossless by design (§2.2). If a future person field is ever
// meant to stay server-only, exclude it here explicitly rather than by
// omission, so the exclusion is visible in one place and covered by a
// test the same way DOC_TRACKABLE_FIELDS-style allowlists are elsewhere
// in this codebase.
function buildPeopleIndex(tree) {
  const memoriesByPerson = {};
  for (const m of tree.memories || []) {
    if (!m?.person_id) continue;
    (memoriesByPerson[m.person_id] ||= []).push(m);
  }

  const people = {};
  for (const p of tree.people || []) {
    people[p.id] = {
      ...p,
      searchKey: normalizeSearchKey(p.display_name),
      memories: memoriesByPerson[p.id] || [],
    };
  }
  return people;
}

function buildDocumentsIndex(tree) {
  const documents = {};
  for (const d of tree.documents || []) {
    documents[d.id] = { ...d, searchKey: normalizeSearchKey(d.title) };
  }
  return documents;
}

/*
 * Lightweight adjacency by person ID — parents/children/partners only, not
 * the live app's full relationLabel/kin-term machinery (graph.js). Built
 * from tree.relationships' `type` field: 'parent' (from_person is the
 * parent of to_person) and 'partner'/'ex_partner' (symmetric).
 */
function buildRelationshipAdjacency(tree) {
  const adjacency = {};
  const ensure = (id) => {
    if (!adjacency[id]) adjacency[id] = { parents: [], children: [], partners: [] };
    return adjacency[id];
  };
  for (const r of tree.relationships || []) {
    if (!r?.from_person || !r?.to_person) continue;
    if (r.type === 'parent') {
      ensure(r.to_person).parents.push(r.from_person);
      ensure(r.from_person).children.push(r.to_person);
    } else if (r.type === 'partner' || r.type === 'ex_partner') {
      ensure(r.from_person).partners.push(r.to_person);
      ensure(r.to_person).partners.push(r.from_person);
    }
  }
  return adjacency;
}

function buildMediaIndex(mediaEntries) {
  return mediaEntries.map((e) => ({
    path: e.path,
    fileId: e.id,
    ownerId: e.ownerId ?? null,
    recordType: e.recordType,
    status: e.status,
    warning: (e.status === 'missing' || e.status === 'external_reference' || e.status === 'unreadable' || e.status === 'unsupported') ? e.status : null,
  }));
}

/*
 * Builds the one in-memory viewer index both output files are generated
 * from. `sourceChecksum` ties this index to the exact tree/manifest
 * snapshot it was derived from — §3.5 requires both output forms to carry
 * the same viewerIndexVersion, counts, and source checksum.
 */
export function buildContentIndex(tree, mediaEntries, { sourceChecksum, family, generatedAt, warnings = [] } = {}) {
  if (!sourceChecksum) throw new Error('buildContentIndex requires sourceChecksum');
  const people = buildPeopleIndex(tree);
  const documents = buildDocumentsIndex(tree);
  const media = buildMediaIndex(mediaEntries);
  return {
    viewerIndexVersion: VIEWER_INDEX_VERSION,
    sourceChecksum,
    family: family || null,
    generatedAt: generatedAt || null,
    warnings,
    counts: {
      people: Object.keys(people).length,
      documents: Object.keys(documents).length,
      media: media.length,
    },
    people,
    documents,
    relationshipAdjacency: buildRelationshipAdjacency(tree),
    media,
  };
}

export function toContentIndexJSON(index) {
  return JSON.stringify(index, null, 2);
}

/*
 * A `<script>`-loadable form of the exact same index, so START-HERE.html
 * can read it under file:// without ever calling fetch()/XHR (§3.8).
 */
export function toTreeDataJs(index, globalName = TREE_DATA_GLOBAL) {
  return `window.${globalName} = ${JSON.stringify(index)};\n`;
}

export const TREE_DATA_GLOBAL_NAME = TREE_DATA_GLOBAL;

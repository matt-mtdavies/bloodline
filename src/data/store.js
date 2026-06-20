/*
 * The family store. Holds the people + relationships, persists every change to
 * localStorage, and notifies React via a tiny pub/sub (useSyncExternalStore).
 *
 * It starts from the seeded demo family; once the user edits anything, their
 * version is what loads next time. This is deliberately the same {people,
 * relationships} shape the API serves, so swapping localStorage for D1 later is
 * a drop-in.
 */
import {
  people as seedPeople,
  relationships as seedRels,
  memories as seedMemories,
  photos as seedPhotos,
} from './seed.js';

const KEY = 'bloodline:v1';

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore corrupt storage */
  }
  return null;
}

let state = load() || {
  people: structuredClone(seedPeople),
  relationships: structuredClone(seedRels),
  memories: structuredClone(seedMemories),
  photos: structuredClone(seedPhotos),
  documents: [],
};

// Migrate older saves that predate a collection: seed the demo data, but only
// for people who still exist, so we never clobber the user's own edits.
if (state.memories === undefined || state.photos === undefined || state.documents === undefined) {
  const ids = new Set(state.people.map((p) => p.id));
  if (state.memories === undefined)
    state.memories = structuredClone(seedMemories).filter((x) => ids.has(x.person_id));
  if (state.photos === undefined)
    state.photos = structuredClone(seedPhotos).filter((x) => ids.has(x.person_id));
  if (state.documents === undefined)
    state.documents = [];
}

// Upgrade the first round of low-res demo gallery photos (served via the
// /faces proxy) to the current high-res seed set. Real uploads are data: URLs,
// so they're left untouched. Idempotent — once swapped there's nothing to match.
if (state.photos.some((p) => typeof p.src === 'string' && p.src.startsWith('/faces/'))) {
  const ids = new Set(state.people.map((p) => p.id));
  const kept = state.photos.filter((p) => !(typeof p.src === 'string' && p.src.startsWith('/faces/')));
  const reseed = structuredClone(seedPhotos).filter((p) => ids.has(p.person_id));
  state.photos = [...kept, ...reseed];
}

const listeners = new Set();

function commit(next) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* quota — keep working in-memory */
  }
  listeners.forEach((l) => l());
}

export const store = {
  subscribe(l) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  getState() {
    return state;
  },
  reset() {
    commit({ people: structuredClone(seedPeople), relationships: structuredClone(seedRels) });
  },
};

const uid = () => 'p_' + Math.random().toString(36).slice(2, 9);
const rid = () => 'r_' + Math.random().toString(36).slice(2, 9);
const mid = () => 'm_' + Math.random().toString(36).slice(2, 9);
const phid = () => 'ph_' + Math.random().toString(36).slice(2, 9);
const docid = () => 'doc_' + Math.random().toString(36).slice(2, 9);

// How each warm relationship label maps to stored edges + a gender default.
export const RELATIONSHIPS = [
  { key: 'mother', label: 'Mother', gender: 'female' },
  { key: 'father', label: 'Father', gender: 'male' },
  { key: 'partner', label: 'Partner', gender: null },
  { key: 'daughter', label: 'Daughter', gender: 'female' },
  { key: 'son', label: 'Son', gender: 'male' },
  { key: 'sister', label: 'Sister', gender: 'female' },
  { key: 'brother', label: 'Brother', gender: 'male' },
];

function parentEdge(from, to, qualifier = 'biological') {
  return { id: rid(), from_person: from, to_person: to, type: 'parent', qualifier, partner_status: null };
}
function partnerEdge(a, b, status = 'current') {
  return { id: rid(), from_person: a, to_person: b, type: 'partner', qualifier: 'biological', partner_status: status };
}

// Build the edges that connect a new person to the person they were added from.
function edgesFor(relKey, anchorId, newId, current) {
  const parentsOf = (id) =>
    current.relationships.filter((r) => r.type === 'parent' && r.to_person === id).map((r) => r.from_person);
  const partnersOf = (id) =>
    current.relationships
      .filter((r) => r.type === 'partner' && (r.from_person === id || r.to_person === id))
      .map((r) => (r.from_person === id ? r.to_person : r.from_person));

  switch (relKey) {
    case 'mother':
    case 'father':
      return [parentEdge(newId, anchorId)]; // new is a parent of the anchor
    case 'partner':
      return [partnerEdge(anchorId, newId)];
    case 'son':
    case 'daughter': {
      // The anchor is a parent; co-parent the anchor's current partner too.
      const edges = [parentEdge(anchorId, newId)];
      for (const p of partnersOf(anchorId)) edges.push(parentEdge(p, newId));
      return edges;
    }
    case 'brother':
    case 'sister': {
      // Share the anchor's parents (siblings are derived from shared parents).
      const ps = parentsOf(anchorId);
      return ps.map((p) => parentEdge(p, newId));
    }
    default:
      return [];
  }
}

export function addRelative({ anchorId, relKey, name, gender, birth_date, is_deceased, death_date }) {
  const id = uid();
  const meta = RELATIONSHIPS.find((r) => r.key === relKey);
  const person = {
    id,
    display_name: name.trim(),
    given_names: name.trim().split(/\s+/).slice(0, -1).join(' ') || null,
    family_name: name.trim().split(/\s+/).slice(-1)[0] || null,
    gender: gender || meta?.gender || null,
    birth_date: birth_date || null,
    death_date: is_deceased ? death_date || null : null,
    is_living: !is_deceased,
    is_deceased: !!is_deceased,
    is_minor: false,
    birth_place: null,
    residence: null,
    occupation: null,
    tags: [],
    events: [],
    bio: null,
    photo: null,
    confidence: 'confirmed',
    created_by: 'me',
  };
  commit({
    people: [...state.people, person],
    relationships: [...state.relationships, ...edgesFor(relKey, anchorId, id, state)],
  });
  return id;
}

export function updatePerson(id, fields) {
  commit({
    ...state,
    people: state.people.map((p) => (p.id === id ? { ...p, ...fields } : p)),
  });
}

export function setPhoto(id, dataUrl) {
  updatePerson(id, { photo: dataUrl });
}

// ── Memories ────────────────────────────────────────────────────────────────
export function addMemory(personId, { text, author }) {
  const memory = {
    id: mid(),
    person_id: personId,
    text: text.trim(),
    author: (author || '').trim() || 'You',
    created_at: new Date().toISOString().slice(0, 10),
    votes: 0,
    youVoted: false,
  };
  commit({ ...state, memories: [...state.memories, memory] });
  return memory.id;
}

// Single-device demo: a vote is just the local viewer's toggle.
export function toggleMemoryVote(id) {
  commit({
    ...state,
    memories: state.memories.map((mem) =>
      mem.id === id
        ? { ...mem, youVoted: !mem.youVoted, votes: mem.votes + (mem.youVoted ? -1 : 1) }
        : mem,
    ),
  });
}

export function removeMemory(id) {
  commit({ ...state, memories: state.memories.filter((mem) => mem.id !== id) });
}

// ── Photos (gallery) ──────────────────────────────────────────────────────────
export function addPhoto(personId, { src, caption, date }) {
  const photo = {
    id: phid(),
    person_id: personId,
    src,
    caption: caption || '',
    date: date || '',
  };
  commit({ ...state, photos: [...state.photos, photo] });
  return photo.id;
}

export function setPhotoCaption(id, caption) {
  commit({
    ...state,
    photos: state.photos.map((p) => (p.id === id ? { ...p, caption } : p)),
  });
}

export function removePhoto(id) {
  commit({ ...state, photos: state.photos.filter((p) => p.id !== id) });
}

// ── Documents ─────────────────────────────────────────────────────────────────
// Stored as base64 data URLs for the stub phase; will move to R2 URLs later.
// Shape: { id, person_id, title, mime, src, created_at }
export function addDocument(personId, { title, mime, src }) {
  const doc = {
    id: docid(),
    person_id: personId,
    title: title.trim(),
    mime,
    src,
    created_at: new Date().toISOString().slice(0, 10),
  };
  commit({ ...state, documents: [...state.documents, doc] });
  return doc.id;
}

export function removeDocument(id) {
  commit({ ...state, documents: state.documents.filter((d) => d.id !== id) });
}

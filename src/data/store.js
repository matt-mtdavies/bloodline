/*
 * The family store. Holds the people + relationships, persists every change to
 * localStorage, and notifies React via a tiny pub/sub (useSyncExternalStore).
 *
 * New users start with an empty tree and go through onboarding. Existing users
 * (loaded from localStorage) are migrated forward. The shape deliberately
 * mirrors the D1 API schema so swapping backends is a drop-in.
 *
 * ?demo in the URL loads the Davies seed family (for smoke tests / demos).
 */
import {
  people as seedPeople,
  relationships as seedRels,
  memories as seedMemories,
  photos as seedPhotos,
  FAMILY_NAME as SEED_FAMILY_NAME,
  DEFAULT_FOCUS,
} from './seed.js';

const KEY = 'bloodline:v1';

const EMPTY = {
  people: [],
  relationships: [],
  memories: [],
  photos: [],
  documents: [],
  hasCompletedOnboarding: false,
  familyName: '',
  myPersonId: null,
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore corrupt storage */
  }
  return null;
}

// ?demo in the URL seeds the Davies family, bypassing onboarding.
// Used by smoke tests and the live demo link.
const isDemoUrl =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo');

let state = isDemoUrl
  ? {
      people: structuredClone(seedPeople),
      relationships: structuredClone(seedRels),
      memories: structuredClone(seedMemories),
      photos: structuredClone(seedPhotos),
      documents: [],
      hasCompletedOnboarding: true,
      familyName: SEED_FAMILY_NAME,
      myPersonId: DEFAULT_FOCUS,
    }
  : load() || { ...EMPTY };

// ── Migrations (additive, never destructive) ─────────────────────────────────

// Pre-onboarding saves: people exist but no onboarding flag → treat as complete.
if (state.people?.length > 0 && state.hasCompletedOnboarding === undefined) {
  state.hasCompletedOnboarding = true;
  if (!state.familyName) state.familyName = SEED_FAMILY_NAME;
  if (!state.myPersonId) state.myPersonId = DEFAULT_FOCUS;
}

// Ensure all collection fields exist.
if (!state.memories) state.memories = [];
if (!state.photos) state.photos = [];
if (!state.documents) state.documents = [];

// Upgrade low-res demo gallery photos to current seed set.
if (state.photos.some((p) => typeof p.src === 'string' && p.src.startsWith('/faces/'))) {
  const ids = new Set(state.people.map((p) => p.id));
  const kept = state.photos.filter((p) => !(typeof p.src === 'string' && p.src.startsWith('/faces/')));
  const reseed = structuredClone(seedPhotos).filter((p) => ids.has(p.person_id));
  state.photos = [...kept, ...reseed];
}

// Back-fill memories for seed people that existed before memories were added.
if (state.people?.length > 0 && state.memories.length === 0 && state.people.some((p) => p.id === DEFAULT_FOCUS)) {
  const ids = new Set(state.people.map((p) => p.id));
  state.memories = structuredClone(seedMemories).filter((x) => ids.has(x.person_id));
}

const listeners = new Set();

// Server sync — enabled after a successful /api/auth/me check.
let _serverSyncEnabled = false;
let _saveTimer = null;

export function enableServerSync() {
  _serverSyncEnabled = true;
}

function scheduleServerSave(s) {
  if (!_serverSyncEnabled) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    fetch('/api/tree', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(s),
    })
      .then((r) => { if (!r.ok) console.warn('[store] server sync HTTP error:', r.status); })
      .catch((e) => console.warn('[store] server sync failed:', e.message));
  }, 1500);
}

function commit(next) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage full — changes live in-memory but won't survive a reload.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bloodline:storage-full'));
    }
  }
  scheduleServerSave(state);
  listeners.forEach((l) => l());
}

// Force an immediate server save (used after login when no D1 record exists yet).
export function saveToServer() {
  return fetch('/api/tree', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(state),
  }).catch((e) => console.warn('[store] initial server save failed:', e.message));
}

// Load the user's tree from the server and overwrite local state.
// Returns true if data was found, false if the user is new (no tree yet).
export async function loadFromServer() {
  try {
    const res = await fetch('/api/tree');
    if (!res.ok) return false;
    const data = await res.json();
    if (!data) return false;
    // Portrait photos (person.photo) are large blobs; if the last server PUT
    // failed silently (HTTP error) the server state won't have them. Preserve
    // any local portraits that aren't in the server response so they survive
    // across reloads even if the sync is behind.
    const localPortraits = new Map(
      (state.people || []).filter((p) => p.photo).map((p) => [p.id, p.photo]),
    );
    const mergedPeople =
      localPortraits.size > 0 && Array.isArray(data.people)
        ? data.people.map((p) =>
            !p.photo && localPortraits.has(p.id)
              ? { ...p, photo: localPortraits.get(p.id) }
              : p,
          )
        : data.people;
    commit({ ...EMPTY, ...data, ...(mergedPeople ? { people: mergedPeople } : {}) });
    return true;
  } catch {
    return false;
  }
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
    commit({
      ...EMPTY,
      people: structuredClone(seedPeople),
      relationships: structuredClone(seedRels),
      memories: structuredClone(seedMemories),
      photos: structuredClone(seedPhotos),
      hasCompletedOnboarding: true,
      familyName: SEED_FAMILY_NAME,
      myPersonId: DEFAULT_FOCUS,
    });
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
  { key: 'ex_partner', label: 'Ex-Partner', gender: null },
  { key: 'daughter', label: 'Daughter', gender: 'female' },
  { key: 'son', label: 'Son', gender: 'male' },
  { key: 'sister', label: 'Sister', gender: 'female' },
  { key: 'brother', label: 'Brother', gender: 'male' },
];

// Relationship keys that support a biological/step/adoptive qualifier
export const QUALIFIER_KEYS = new Set(['mother', 'father', 'son', 'daughter']);

function parentEdge(from, to, qualifier = 'biological') {
  return { id: rid(), from_person: from, to_person: to, type: 'parent', qualifier, partner_status: null };
}
function partnerEdge(a, b, status = 'current') {
  return { id: rid(), from_person: a, to_person: b, type: 'partner', qualifier: 'biological', partner_status: status };
}

// Build the edges that connect a new person to the person they were added from.
function edgesFor(relKey, anchorId, newId, current, qualifier = 'biological') {
  const parentsOf = (id) =>
    current.relationships.filter((r) => r.type === 'parent' && r.to_person === id).map((r) => r.from_person);
  const partnersOf = (id) =>
    current.relationships
      .filter((r) => r.type === 'partner' && (r.from_person === id || r.to_person === id))
      .map((r) => (r.from_person === id ? r.to_person : r.from_person));

  switch (relKey) {
    case 'mother':
    case 'father':
      return [parentEdge(newId, anchorId, qualifier)]; // new is a parent of the anchor
    case 'partner':
      return [partnerEdge(anchorId, newId, 'current')];
    case 'ex_partner':
      return [partnerEdge(anchorId, newId, 'former')];
    case 'son':
    case 'daughter': {
      const edges = [parentEdge(anchorId, newId, qualifier)];
      // Only co-parent with current partner for biological children
      if (qualifier === 'biological') {
        for (const p of partnersOf(anchorId)) edges.push(parentEdge(p, newId));
      }
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

// Return which bio-parent genders are already filled for a given person id.
export function bioParentGendersFilled(personId) {
  const bioPids = state.relationships
    .filter((r) => r.type === 'parent' && r.qualifier === 'biological' && r.to_person === personId)
    .map((r) => r.from_person);
  const genders = new Set(
    bioPids.map((pid) => state.people.find((p) => p.id === pid)?.gender).filter(Boolean),
  );
  return genders; // Set of 'male'|'female' already occupied
}

export function addRelative({ anchorId, relKey, name, gender, birth_date, is_deceased, death_date, qualifier = 'biological' }) {
  const id = uid();
  const meta = RELATIONSHIPS.find((r) => r.key === relKey);

  // Hard biological-parent constraint: at most one bio parent per gender role.
  if (qualifier === 'biological' && (relKey === 'mother' || relKey === 'father')) {
    const targetGender = relKey === 'mother' ? 'female' : 'male';
    if (bioParentGendersFilled(anchorId).has(targetGender)) return null;
  }
  // Smart privacy defaults: children stay private by default; living adults are
  // summary (name + dates visible); deceased people are fully open.
  const childKeys = new Set(['son', 'daughter']);
  const defaultVisibility = is_deceased ? 'full' : childKeys.has(relKey) ? 'private' : 'summary';
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
    visibility: defaultVisibility,
  };
  commit({
    ...state,
    people: [...state.people, person],
    relationships: [...state.relationships, ...edgesFor(relKey, anchorId, id, state, qualifier)],
  });
  return id;
}

// Link two existing people with a partner or parent relationship.
// fromId is the parent when type is 'parent'; for partner types, order is arbitrary.
// Guards: partner links are symmetric; duplicate edges are silently skipped;
// bio-parent gender constraint is enforced for type 'parent' (biological qualifier).
export function addRelationship(fromId, toId, type, qualifier = 'biological') {
  const edgeType = type === 'ex_partner' ? 'partner' : type;
  const already = state.relationships.some(
    (r) =>
      r.type === edgeType &&
      ((r.from_person === fromId && r.to_person === toId) ||
        (r.from_person === toId && r.to_person === fromId)),
  );
  if (already) return;

  if (type === 'parent' && qualifier === 'biological') {
    const parentPerson = state.people.find((p) => p.id === fromId);
    const parentGender = parentPerson?.gender;
    if (parentGender && bioParentGendersFilled(toId).has(parentGender)) return;
  }

  let edge;
  if (type === 'partner') edge = partnerEdge(fromId, toId, 'current');
  else if (type === 'ex_partner') edge = partnerEdge(fromId, toId, 'former');
  else if (type === 'parent') edge = parentEdge(fromId, toId, qualifier);
  else return;
  commit({ ...state, relationships: [...state.relationships, edge] });
}

export function setupTree({ me, partner, parents, children, memoryPersonIdx, memoryText, familyName }) {
  const mkId = () => uid();
  const mkPerson = (name, birthYear, extra = {}) => ({
    id: mkId(),
    display_name: name.trim(),
    given_names: null,
    family_name: null,
    gender: null,
    birth_date: birthYear?.trim() || null,
    death_date: null,
    is_living: true,
    is_deceased: false,
    is_minor: false,
    birth_place: null,
    residence: null,
    occupation: null,
    tags: [],
    events: [],
    bio: null,
    photo: null,
    story: null,
    confidence: 'confirmed',
    visibility: 'full',
    ...extra,
  });

  const people = [];
  const relationships = [];
  const memories = [];
  const orderedIds = []; // parallel to [me, partner?, ...parents, ...children]

  // Me
  const meP = mkPerson(me.name, me.birthYear);
  people.push(meP);
  orderedIds.push(meP.id);

  // Partner
  let partnerP = null;
  if (partner?.name?.trim()) {
    partnerP = mkPerson(partner.name, null);
    people.push(partnerP);
    orderedIds.push(partnerP.id);
    relationships.push({ id: rid(), from_person: meP.id, to_person: partnerP.id, type: 'partner', qualifier: 'biological', partner_status: 'current' });
  }

  // Parents
  const parentPs = [];
  for (const p of (parents || []).filter((p) => p.name?.trim())) {
    const pP = mkPerson(p.name, p.birthYear);
    people.push(pP);
    orderedIds.push(pP.id);
    parentPs.push(pP);
    relationships.push({ id: rid(), from_person: pP.id, to_person: meP.id, type: 'parent', qualifier: 'biological', partner_status: null });
  }
  if (parentPs.length === 2) {
    relationships.push({ id: rid(), from_person: parentPs[0].id, to_person: parentPs[1].id, type: 'partner', qualifier: 'biological', partner_status: 'current' });
  }

  // Children
  for (const c of (children || []).filter((c) => c.name?.trim())) {
    const cP = mkPerson(c.name, c.birthYear, { visibility: 'private' });
    people.push(cP);
    orderedIds.push(cP.id);
    relationships.push({ id: rid(), from_person: meP.id, to_person: cP.id, type: 'parent', qualifier: 'biological', partner_status: null });
    if (partnerP) {
      relationships.push({ id: rid(), from_person: partnerP.id, to_person: cP.id, type: 'parent', qualifier: 'biological', partner_status: null });
    }
  }

  // Memory
  if (memoryPersonIdx != null && memoryText?.trim() && orderedIds[memoryPersonIdx]) {
    memories.push({
      id: mid(),
      person_id: orderedIds[memoryPersonIdx],
      text: memoryText.trim(),
      author: 'You',
      created_at: new Date().toISOString().slice(0, 10),
      votes: 0,
      youVoted: false,
    });
  }

  commit({
    people,
    relationships,
    memories,
    photos: [],
    documents: [],
    hasCompletedOnboarding: true,
    familyName: familyName?.trim() || 'My Family',
    myPersonId: meP.id,
  });

  return meP.id;
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

export function updateFamilyName(name) {
  commit({ ...state, familyName: name.trim() || state.familyName });
}

export function resetTree() {
  commit({ ...EMPTY });
}

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
  seedActivity,
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
  activity: [],
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
      activity: structuredClone(seedActivity),
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

// Retire the old single-family seed name — the tree spans many families.
if (state.familyName === 'The Davies Family') state.familyName = SEED_FAMILY_NAME;

// Ensure all collection fields exist.
if (!state.memories) state.memories = [];
if (!state.photos) state.photos = [];
if (!state.documents) state.documents = [];
if (!state.activity) state.activity = [];
// Back-fill demo activity for existing demo sessions that pre-date activity tracking.
if (isDemoUrl && state.activity.length === 0) {
  state.activity = structuredClone(seedActivity);
}

// Ensure every person has a conditions array.
if (state.people) {
  state.people = state.people.map((p) => (p.conditions ? p : { ...p, conditions: [] }));
}

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

// Sync status observable — consumed by TopBar.
// Values: 'idle' | 'saving' | 'saved' | 'error' | 'error-auth'
let _syncStatus = 'idle';
const _syncListeners = new Set();
function setSyncStatus(s) { _syncStatus = s; _syncListeners.forEach((l) => l()); }
export const syncStore = {
  subscribe(l) { _syncListeners.add(l); return () => _syncListeners.delete(l); },
  getState() { return _syncStatus; },
};

export function enableServerSync() {
  _serverSyncEnabled = true;
}

let _savedTimer = null;
function afterSave(ok, statusCode) {
  if (ok) {
    setSyncStatus('saved');
    clearTimeout(_savedTimer);
    _savedTimer = setTimeout(() => setSyncStatus('idle'), 2500);
  } else if (statusCode === 401 || statusCode === 403) {
    setSyncStatus('error-auth');
    console.warn('[store] server sync: auth error', statusCode);
  } else {
    setSyncStatus('error');
    console.warn('[store] server sync failed:', statusCode || 'network error');
  }
}

// Strip base64 data: URLs before writing to D1 — portraits, gallery photos, and
// documents can be several MB total, exceeding D1's per-row limit. They remain
// intact in localStorage; loadFromServer() restores them after a server load.
function stripForServer(s) {
  return {
    ...s,
    people: s.people?.map((p) =>
      p.photo?.startsWith('data:') ? { ...p, photo: null } : p,
    ),
    photos: s.photos?.map((ph) =>
      ph.src?.startsWith('data:') ? { ...ph, src: null } : ph,
    ).filter((ph) => ph.src),
    documents: (s.documents || []).filter((d) => !d.src?.startsWith('data:')),
  };
}

const RETRY_DELAYS = [2000, 4000, 8000];

async function putTree(s, attempt = 0) {
  try {
    const r = await fetch('/api/tree', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(stripForServer(s)),
    });
    if (r.ok) { afterSave(true); return; }
    // Log actual error body to aid debugging.
    r.clone().json().then((body) => {
      console.error('[store] PUT /api/tree', r.status, body?.detail || body?.error || '');
    }).catch(() => {});
    // Auth errors are permanent — no retry.
    if (r.status === 401 || r.status === 403) { afterSave(false, r.status); return; }
    if (attempt < RETRY_DELAYS.length) {
      setTimeout(() => putTree(s, attempt + 1), RETRY_DELAYS[attempt]);
    } else {
      afterSave(false, r.status);
    }
  } catch (e) {
    console.error('[store] PUT /api/tree network error:', e.message);
    if (attempt < RETRY_DELAYS.length) {
      setTimeout(() => putTree(s, attempt + 1), RETRY_DELAYS[attempt]);
    } else {
      afterSave(false);
    }
  }
}

function scheduleServerSave(s) {
  if (!_serverSyncEnabled) return;
  clearTimeout(_saveTimer);
  setSyncStatus('saving');
  _saveTimer = setTimeout(() => putTree(s), 1500);
}

// fromServer=true: loading from D1 — don't increment _seq or schedule a save.
function commit(next, { fromServer = false } = {}) {
  state = fromServer ? next : { ...next, _seq: (next._seq || 0) + 1 };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage full — changes live in-memory but won't survive a reload.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bloodline:storage-full'));
    }
  }
  if (!fromServer) scheduleServerSave(state);
  listeners.forEach((l) => l());
}

// Force an immediate server save (used after login or when local is ahead of server).
export function saveToServer() {
  setSyncStatus('saving');
  return putTree(state);
}

// Load the user's tree from the server.
// If local state (_seq) is ahead of the server, local wins and we push it up.
// Otherwise server wins and we apply it. Returns true if a tree was found.
// forceServerWins: always apply the server data regardless of _seq — used when
// joining a new family via invite so local data never overwrites the family tree.
export async function loadFromServer({ forceServerWins = false } = {}) {
  try {
    const res = await fetch('/api/tree');
    if (!res.ok) return false;
    const data = await res.json();
    if (!data) return false;

    const localSeq = state._seq || 0;
    const serverSeq = data._seq || 0;

    // Local is ahead — unsaved changes exist. Push them up; don't overwrite.
    // Skip this when forceServerWins (e.g. joining via invite): we must never
    // let a guest's stale local tree overwrite the family they just joined.
    if (!forceServerWins && localSeq > serverSeq && state.people?.length > 0) {
      saveToServer();
      return true;
    }

    // Server is same or ahead — apply it. Data: URLs are stripped from the D1
    // payload to stay under the row size limit; restore them from localStorage.
    // photo_thumb is a small (~5 KB) thumbnail stored in D1 as a cross-device
    // sync fallback when R2 is unavailable.
    const localPortraits = new Map(
      (state.people || []).filter((p) => p.photo?.startsWith('data:')).map((p) => [p.id, p.photo]),
    );
    const mergedPeople = Array.isArray(data.people)
      ? data.people.map((p) => {
          if (!p.photo) {
            if (localPortraits.has(p.id)) return { ...p, photo: localPortraits.get(p.id) };
            if (p.photo_thumb) return { ...p, photo: p.photo_thumb };
          }
          return p;
        })
      : data.people;

    // Restore local gallery photos that have data: URLs (not in D1 payload).
    const serverPhotoIds = new Set((data.photos || []).map((ph) => ph.id));
    const localDataPhotos = (state.photos || []).filter(
      (ph) => ph.src?.startsWith('data:') && !serverPhotoIds.has(ph.id),
    );
    const mergedPhotos = [...(data.photos || []), ...localDataPhotos];

    // Restore local documents that have data: URLs (stripped from D1 payload).
    const serverDocIds = new Set((data.documents || []).map((d) => d.id));
    const localDataDocs = (state.documents || []).filter(
      (d) => d.src?.startsWith('data:') && !serverDocIds.has(d.id),
    );
    const mergedDocs = [...(data.documents || []), ...localDataDocs];

    commit(
      {
        ...EMPTY,
        ...data,
        ...(mergedPeople ? { people: mergedPeople } : {}),
        photos: mergedPhotos,
        documents: mergedDocs,
      },
      { fromServer: true },
    );
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
const cid = () => 'c_' + Math.random().toString(36).slice(2, 9);
const acid = () => 'act_' + Math.random().toString(36).slice(2, 9);

// Prepend an activity event to the next state object, capped at 100 entries.
function withActivity(next, partial) {
  const event = { id: acid(), authorName: 'You', detail: null, ...partial, created_at: new Date().toISOString() };
  return { ...next, activity: [event, ...(next.activity ?? [])].slice(0, 100) };
}

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
  const defaultVisibility = 'full';
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
  const edges = edgesFor(relKey, anchorId, id, state, qualifier);

  // When adding a sibling to someone with no parents in the tree, the new person
  // would have zero link-force connections and float free in d3. Fix: auto-create
  // an "uncertain" placeholder parent that connects both people.
  const extraPeople = [];
  const extraEdges = [];
  if ((relKey === 'brother' || relKey === 'sister') && edges.length === 0) {
    const anchor = state.people.find((p) => p.id === anchorId);
    const familyName = anchor?.family_name || anchor?.display_name?.split(/\s+/).slice(-1)[0] || '';
    const placeholderName = familyName ? `${familyName} Parent` : 'Unknown Parent';
    const pid = uid();
    extraPeople.push({
      id: pid,
      display_name: placeholderName,
      given_names: null,
      family_name: familyName || null,
      gender: null,
      birth_date: null,
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
      confidence: 'uncertain',
      created_by: 'me',
      visibility: 'full',
    });
    extraEdges.push(parentEdge(pid, anchorId), parentEdge(pid, id));
  }

  commit(withActivity({
    ...state,
    people: [...state.people, ...extraPeople, person],
    relationships: [...state.relationships, ...edges, ...extraEdges],
  }, { type: 'person_added', personId: id, personName: name.trim() }));
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
  const fromPerson = state.people.find((p) => p.id === fromId);
  const toPerson = state.people.find((p) => p.id === toId);
  commit(withActivity({ ...state, relationships: [...state.relationships, edge] }, {
    type: 'relationship_added',
    personId: fromId,
    personName: fromPerson?.display_name ?? '',
    detail: toPerson?.display_name ?? '',
  }));
}

// Change the qualifier on a parent→child edge (biological / step / adoptive).
export function updateRelationshipQualifier(fromId, toId, qualifier) {
  commit({
    ...state,
    relationships: state.relationships.map((r) =>
      r.type === 'parent' && r.from_person === fromId && r.to_person === toId
        ? { ...r, qualifier }
        : r,
    ),
  });
}

// Remove a specific relationship edge between two people.
// For 'parent': fromId is the parent, toId is the child.
// For 'partner': direction doesn't matter — both orderings are checked.
export function removeRelationship(fromId, toId, type) {
  commit({
    ...state,
    relationships: state.relationships.filter((r) => {
      if (r.type !== type) return true;
      if (type === 'parent') return !(r.from_person === fromId && r.to_person === toId);
      return !(
        (r.from_person === fromId && r.to_person === toId) ||
        (r.from_person === toId && r.to_person === fromId)
      );
    }),
  });
}

// Remove a person and all traces of them from the tree.
export function removePerson(id) {
  commit({
    ...state,
    people: state.people.filter((p) => p.id !== id),
    relationships: state.relationships.filter(
      (r) => r.from_person !== id && r.to_person !== id,
    ),
    memories: (state.memories || []).filter((m) => m.person_id !== id),
    photos: (state.photos || []).filter((ph) => ph.person_id !== id),
    documents: (state.documents || []).filter((d) => d.person_id !== id),
  });
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
    const cP = mkPerson(c.name, c.birthYear, { visibility: 'full' });
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

export function setPhoto(id, dataUrl, { recordActivity = false } = {}) {
  const next = { ...state, people: state.people.map((p) => (p.id === id ? { ...p, photo: dataUrl } : p)) };
  if (recordActivity) {
    const person = state.people.find((p) => p.id === id);
    commit(withActivity(next, { type: 'portrait_updated', personId: id, personName: person?.display_name ?? '' }));
  } else {
    commit(next);
  }
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
  const person = state.people.find((p) => p.id === personId);
  commit(withActivity({ ...state, memories: [...state.memories, memory] }, {
    type: 'memory_added',
    personId,
    personName: person?.display_name ?? '',
    authorName: memory.author,
    detail: text.trim().slice(0, 140),
  }));
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
  const person = state.people.find((p) => p.id === personId);
  commit(withActivity({ ...state, photos: [...state.photos, photo] }, {
    type: 'photo_added',
    personId,
    personName: person?.display_name ?? '',
  }));
  return photo.id;
}

export function setPhotoCaption(id, caption) {
  commit({
    ...state,
    photos: state.photos.map((p) => (p.id === id ? { ...p, caption } : p)),
  });
}

export function updatePhotoSrc(id, src) {
  commit({
    ...state,
    photos: state.photos.map((p) => (p.id === id ? { ...p, src } : p)),
  });
}

export function removePhoto(id) {
  commit({ ...state, photos: state.photos.filter((p) => p.id !== id) });
}

// Upload any data: URL portraits/gallery photos to R2 and replace them with
// permanent URLs. Called once after login; uploadFn is image.js#uploadPhoto.
// Returns { total, uploaded, failed } so the caller can surface feedback.
export async function migratePhotosToR2(uploadFn) {
  const portraits = (state.people || []).filter((p) => p.photo?.startsWith('data:'));
  const gallery = (state.photos || []).filter((ph) => ph.src?.startsWith('data:'));
  const total = portraits.length + gallery.length;
  if (!total) return { total: 0, uploaded: 0, failed: 0 };

  let uploaded = 0;
  let failed = 0;

  await Promise.allSettled([
    ...portraits.map(async (p) => {
      const url = await uploadFn(p.photo);
      if (url !== p.photo) { updatePerson(p.id, { photo: url, photo_thumb: null }); uploaded++; }
      else failed++;
    }),
    ...gallery.map(async (ph) => {
      const url = await uploadFn(ph.src);
      if (url !== ph.src) { updatePhotoSrc(ph.id, url); uploaded++; }
      else failed++;
    }),
  ]);

  return { total, uploaded, failed };
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
  const person = state.people.find((p) => p.id === personId);
  commit(withActivity({ ...state, documents: [...state.documents, doc] }, {
    type: 'document_added',
    personId,
    personName: person?.display_name ?? '',
    detail: title.trim(),
  }));
  return doc.id;
}

export function removeDocument(id) {
  commit({ ...state, documents: state.documents.filter((d) => d.id !== id) });
}

export function updateDocSrc(id, src) {
  commit({
    ...state,
    documents: state.documents.map((d) => (d.id === id ? { ...d, src } : d)),
  });
}

export function updateDocument(id, patch) {
  commit({
    ...state,
    documents: state.documents.map((d) => (d.id === id ? { ...d, ...patch } : d)),
  });
}

// Upload any data: URL documents to R2 and replace them with permanent URLs.
// Called once after login; uploadFn is image.js#uploadDocument.
export async function migrateDocsToR2(uploadFn) {
  const docs = (state.documents || []).filter((d) => d.src?.startsWith('data:'));
  if (!docs.length) return { total: 0, uploaded: 0, failed: 0 };
  let uploaded = 0, failed = 0;
  await Promise.allSettled(
    docs.map(async (doc) => {
      const url = await uploadFn(doc.src, { title: doc.title, mime: doc.mime });
      if (url !== doc.src) { updateDocSrc(doc.id, url); uploaded++; }
      else failed++;
    }),
  );
  return { total: docs.length, uploaded, failed };
}

export function updateFamilyName(name) {
  commit({ ...state, familyName: name.trim() || state.familyName });
}

export function resetTree() {
  commit({ ...EMPTY });
}

// ── Health conditions ──────────────────────────────────────────────────────────
export function addCondition(personId, { name, category, status = 'active', onset_year = null }) {
  commit({
    ...state,
    people: state.people.map((p) =>
      p.id === personId
        ? { ...p, conditions: [...(p.conditions || []), { id: cid(), name, category, status, onset_year }] }
        : p,
    ),
  });
}

export function removeCondition(personId, conditionId) {
  commit({
    ...state,
    people: state.people.map((p) =>
      p.id === personId
        ? { ...p, conditions: (p.conditions || []).filter((c) => c.id !== conditionId) }
        : p,
    ),
  });
}

export function updateCondition(personId, conditionId, fields) {
  commit({
    ...state,
    people: state.people.map((p) =>
      p.id === personId
        ? { ...p, conditions: (p.conditions || []).map((c) => (c.id === conditionId ? { ...c, ...fields } : c)) }
        : p,
    ),
  });
}

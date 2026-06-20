/*
 * The family store. Holds the people + relationships, persists every change to
 * localStorage, and notifies React via a tiny pub/sub (useSyncExternalStore).
 *
 * It starts from the seeded demo family; once the user edits anything, their
 * version is what loads next time. This is deliberately the same {people,
 * relationships} shape the API serves, so swapping localStorage for D1 later is
 * a drop-in.
 */
import { people as seedPeople, relationships as seedRels } from './seed.js';

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
};

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

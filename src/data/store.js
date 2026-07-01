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
// The account (user uid) this device's cached tree belongs to. Used to keep
// multiple people who share one browser/device from inheriting or overwriting
// each other's tree — see bindIdentity() / clearLocalData().
const OWNER_KEY = 'bloodline:owner';

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
  // Tombstones: ids the user has deleted, kept so a sync merge can't resurrect
  // them from the server. Shape: { people: {id: ts}, relationships: {...}, ... }.
  _deleted: {},
};

// Record deleted ids onto a state object's tombstones so the next sync merge
// won't re-add them. Returns a new state.
function withTombstones(next, kind, ids) {
  if (!ids || !ids.length) return next;
  const ts = Date.now();
  const cur = next._deleted || {};
  const bucket = { ...(cur[kind] || {}) };
  for (const id of ids) if (id != null) bucket[id] = ts;
  return { ...next, _deleted: { ...cur, [kind]: bucket } };
}

// Merge two tombstone maps (union, newest ts wins) — used when reconciling with
// the server so deletions made on any device are honoured everywhere.
function mergeTombstones(a = {}, b = {}) {
  const out = {};
  for (const kind of new Set([...Object.keys(a), ...Object.keys(b)])) {
    out[kind] = { ...(a[kind] || {}), ...(b[kind] || {}) };
  }
  return out;
}

// Strip out any items whose id has been tombstoned for the given collection.
function dropTombstoned(items, deleted, kind) {
  const graves = deleted?.[kind];
  if (!graves || !items) return items || [];
  return items.filter((x) => !(x && x.id in graves));
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore corrupt storage */
  }
  return null;
}

// ?demo in the URL seeds the Mercer demo family, bypassing onboarding.
// Used by smoke tests and the live demo link.
const isDemoUrl =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo');

// ?new starts a fresh anonymous trial: onboarding runs, no login required.
// If the visitor already has a completed tree in localStorage we leave it alone.
export const isNewUrl =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('new');

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
  : isNewUrl
  ? (() => {
      const ex = load();
      // Protect returning visitors: if they already have a tree, keep it.
      return (ex?.hasCompletedOnboarding && ex?.people?.length > 0)
        ? ex
        : { ...EMPTY };
    })()
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

// Clean any duplicate / contradictory relationships left in cached data before
// the first render (the initial state bypasses commit's normalisation), and
// honour any tombstoned deletions still lingering in the cache.
if (!state._deleted) state._deleted = {};
if (Array.isArray(state.people)) {
  state.people = dropTombstoned(state.people, state._deleted, 'people');
  const ids = new Set(state.people.map((p) => p.id));
  if (Array.isArray(state.relationships)) {
    state.relationships = dropTombstoned(state.relationships, state._deleted, 'relationships')
      .filter((r) => ids.has(r.from_person) && ids.has(r.to_person));
  }
  state.memories = dropTombstoned(state.memories, state._deleted, 'memories');
  state.photos = dropTombstoned(state.photos, state._deleted, 'photos');
  state.documents = dropTombstoned(state.documents, state._deleted, 'documents');
}
if (Array.isArray(state.relationships)) {
  state.relationships = normalizeRelationships(state.relationships);
}

const listeners = new Set();

// Server sync — enabled after a successful /api/auth/me check.
let _serverSyncEnabled = false;
let _saveTimer = null;
let _pollTimer = null;
let _serverEtag = null; // ETag from last successful GET or PUT

// Sync status observable — consumed by TopBar.
// Values: 'idle' | 'saving' | 'saved' | 'error' | 'error-auth'
let _syncStatus = 'idle';
const _syncListeners = new Set();
function setSyncStatus(s) { _syncStatus = s; _syncListeners.forEach((l) => l()); }

export function enableServerSync() {
  _serverSyncEnabled = true;
  // Poll every 60 s for changes made by other editors.
  if (!_pollTimer) {
    _pollTimer = setInterval(() => {
      if (_syncStatus !== 'saving') _pollServer();
    }, 60_000);
  }
}

let _savedTimer = null;
let _retryTimer = null;
let _lastSyncError = null; // { code, message } — readable by TopBar via syncStore

export const syncStore = {
  subscribe(l) { _syncListeners.add(l); return () => _syncListeners.delete(l); },
  getState() { return _syncStatus; },
  getLastError() { return _lastSyncError; },
};

function afterSave(ok, statusCode) {
  if (ok) {
    setSyncStatus('saved');
    clearTimeout(_savedTimer);
    clearTimeout(_retryTimer);
    _lastSyncError = null;
    _savedTimer = setTimeout(() => setSyncStatus('idle'), 2500);
  } else if (statusCode === 401 || statusCode === 403) {
    setSyncStatus('error-auth');
    console.warn('[store] server sync: auth error', statusCode);
  } else {
    _lastSyncError = { code: statusCode || 0, message: statusCode === 409 ? 'Conflict' : statusCode ? `HTTP ${statusCode}` : 'Network error' };
    setSyncStatus('error');
    console.warn('[store] server sync failed:', _lastSyncError.message);
    // Retry every 30 s: first refresh the ETag via GET so a stale If-Match
    // header isn't the reason we keep failing, then attempt the save again.
    clearTimeout(_retryTimer);
    _retryTimer = setTimeout(async () => {
      if (_syncStatus !== 'error') return;
      // Refresh ETag via a GET before retrying. If the ETag header is missing
      // or the GET fails, use '*' so the conflict check is skipped entirely —
      // the local state is the ground truth for a single-editor tree.
      try {
        const res = await fetch('/api/tree');
        _serverEtag = (res.ok && res.headers.get('ETag')) || '*';
      } catch {
        _serverEtag = '*';
      }
      if (_syncStatus === 'error') saveToServer();
    }, 30_000);
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
    const headers = { 'content-type': 'application/json' };
    if (_serverEtag) headers['If-Match'] = _serverEtag;

    const r = await fetch('/api/tree', {
      method: 'PUT',
      headers,
      body: JSON.stringify(stripForServer(s)),
    });

    if (r.ok) {
      _serverEtag = r.headers.get('ETag') || _serverEtag;
      afterSave(true);
      return;
    }

    // Another editor saved first — fetch their version, merge, and retry.
    if (r.status === 409) {
      if (attempt === 0) {
        // First conflict: fetch latest, merge local additions, retry with fresh ETag.
        const merged = await _fetchAndMerge(s);
        if (merged) { putTree(merged, 1); return; }
      } else if (attempt === 1) {
        // Second conflict: another writer saved again between our merge-GET and PUT
        // (e.g. two tabs open). Merge one more time then force-save with If-Match: *
        // so we break the deadlock without losing any local changes.
        const remerged = await _fetchAndMerge(s);
        if (remerged) { _serverEtag = '*'; putTree(remerged, 2); return; }
      }
      // attempt >= 2 with If-Match: * still failing → fall through to error path
    }

    // Read the error body synchronously before updating status so TopBar
    // receives the full message in the same render cycle.
    const errorBody = await r.json().catch(() => ({}));
    const bodyMsg = errorBody?.detail || errorBody?.error || '';
    console.error('[store] PUT /api/tree', r.status, bodyMsg);
    _lastSyncError = {
      code: r.status,
      message: r.status === 409
        ? 'Conflict (retried)'
        : errorBody?.detail
        ? `HTTP ${r.status}: ${errorBody.detail}`
        : `HTTP ${r.status}`,
    };

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

// Fetch the latest server state, merge our local additions on top, update
// local state, and return the merged snapshot ready for re-save.
// Merge two arrays of objects with .id fields — union, local entry wins on conflict.
function _mergeById(serverArr, localArr) {
  const out = [...(serverArr || [])];
  const idx = new Map(out.map((x, i) => [x.id, i]));
  for (const item of (localArr || [])) {
    if (idx.has(item.id)) {
      out[idx.get(item.id)] = { ...out[idx.get(item.id)], ...item };
    } else {
      out.push(item);
    }
  }
  return out;
}

// Union two string arrays (e.g. tag lists, photo ID lists), deduplicated.
function _unionStrings(a, b) {
  return [...new Set([...(a || []), ...(b || [])])];
}

async function _fetchAndMerge(local) {
  try {
    const res = await fetch('/api/tree');
    if (!res.ok) return null;
    const server = await res.json();
    _serverEtag = res.headers.get('ETag') || _serverEtag;

    // Build lookup maps.
    const serverPersonMap = new Map((server.people || []).map((p) => [p.id, p]));
    const localPersonMap  = new Map((local.people  || []).map((p) => [p.id, p]));

    // Merge strategy: LOCAL wins for anything that exists locally (preserves
    // deletions — e.g. a removed health condition). Server-only items (added
    // by another editor on a different device) are appended so they aren't lost.
    // We never re-introduce server items that local has already removed.
    const mergedPeople = [
      // For each server person: use local version if one exists (local wins entirely,
      // preserving any deletions the user made to conditions/events/tags/photos).
      // If the person only exists on the server, keep the server version.
      ...(server.people || []).map((sp) => localPersonMap.get(sp.id) ?? sp),
      // People added locally that the server doesn't have yet.
      ...(local.people || []).filter((p) => !serverPersonMap.has(p.id)),
    ];

    // Same pattern for top-level arrays: start from local (user's edits/deletions
    // are authoritative), then append server items that local hasn't seen yet.
    const lRelIds   = new Set((local.relationships || []).map((r) => r.id));
    const lMemIds   = new Set((local.memories      || []).map((m) => m.id));
    const lPhotoIds = new Set((local.photos        || []).map((ph) => ph.id));

    // Resolve viewer's own person (claimed link first, then email), same logic
    // as loadFromServer, so the merge never reverts to the owner's perspective.
    const mergeViewerId = resolveViewerPersonId(mergedPeople, local.myPersonId ?? server.myPersonId);

    // Union deletions from both sides, then drop anything tombstoned so neither
    // side can resurrect what the other deleted; finally drop dangling edges.
    const deleted = mergeTombstones(local._deleted, server._deleted);
    const people = dropTombstoned(mergedPeople, deleted, 'people');
    const peopleIds = new Set(people.map((p) => p.id));
    const merged = {
      ...server,
      ...local, // local top-level scalars win (familyName, myPersonId, etc.)
      people,
      relationships: dropTombstoned(
        [...(local.relationships || []), ...(server.relationships || []).filter((r) => !lRelIds.has(r.id))],
        deleted, 'relationships',
      ).filter((r) => peopleIds.has(r.from_person) && peopleIds.has(r.to_person)),
      memories: dropTombstoned(
        [...(local.memories || []), ...(server.memories || []).filter((m) => !lMemIds.has(m.id))],
        deleted, 'memories',
      ),
      photos: dropTombstoned(
        [...(local.photos || []), ...(server.photos || []).filter((ph) => !lPhotoIds.has(ph.id))],
        deleted, 'photos',
      ),
      _deleted: deleted,
      ...(mergeViewerId ? { myPersonId: mergeViewerId } : {}),
    };

    commit(merged, { fromServer: true });
    window.dispatchEvent(new CustomEvent('bloodline:tree-conflict-merged'));
    return merged;
  } catch {
    return null;
  }
}

// Background poll — apply server changes if another editor saved since our last load.
async function _pollServer() {
  try {
    const res = await fetch('/api/tree');
    if (!res.ok) return;
    const freshEtag = res.headers.get('ETag');
    // Nothing changed since our last known version.
    if (freshEtag && freshEtag === _serverEtag) return;

    const server = await res.json();
    if (!server) return;
    _serverEtag = freshEtag || _serverEtag;

    const serverSeq = server._seq || 0;
    const localSeq  = state._seq  || 0;
    // Only apply if server is genuinely ahead (another editor saved).
    if (serverSeq <= localSeq) return;

    // Merge rather than overwrite — local edits that haven't finished saving
    // yet would be silently wiped by a raw commit(server).
    await _fetchAndMerge(state);
    window.dispatchEvent(new CustomEvent('bloodline:tree-polled'));
  } catch { /* silent — try next interval */ }
}

function scheduleServerSave(s) {
  if (!_serverSyncEnabled) return;
  clearTimeout(_saveTimer);
  setSyncStatus('saving');
  _saveTimer = setTimeout(() => putTree(s), 1500);
}

// Canonicalise the relationship list so duplicates and contradictions can never
// accumulate (they otherwise pile up when concurrent edits get sync-merged):
//   • drop self-edges,
//   • collapse duplicate edges of the same kind for the same pair, and
//   • enforce that a pair is partner OR parent, never both (partner wins).
// Idempotent, so running it on every commit converges all devices to a clean
// state on load, save, and after any merge.
function normalizeRelationships(rels) {
  if (!Array.isArray(rels)) return rels || [];
  const pk = (a, b) => [a, b].sort().join('~');
  const partnerPairs = new Set();
  for (const r of rels) {
    if (r?.type === 'partner' && r.from_person !== r.to_person) partnerPairs.add(pk(r.from_person, r.to_person));
  }
  const seen = new Set();
  const out = [];
  for (const r of rels) {
    if (!r || r.from_person === r.to_person) continue;
    if (r.type === 'partner') {
      const k = 'P|' + pk(r.from_person, r.to_person);
      if (seen.has(k)) continue;
      seen.add(k); out.push(r);
    } else if (r.type === 'parent') {
      if (partnerPairs.has(pk(r.from_person, r.to_person))) continue; // contradiction → partner wins
      const k = 'C|' + r.from_person + '>' + r.to_person;
      if (seen.has(k)) continue;
      seen.add(k); out.push(r);
    } else {
      out.push(r);
    }
  }
  return out;
}

// fromServer=true: loading from D1 — don't increment _seq or schedule a save.
function commit(next, { fromServer = false } = {}) {
  const cleanRels = normalizeRelationships(next.relationships);
  const cleaned = cleanRels.length !== (next.relationships?.length ?? 0);
  next = cleaned ? { ...next, relationships: cleanRels } : next;
  state = fromServer ? next : { ...next, _seq: (next._seq || 0) + 1 };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage full — changes live in-memory but won't survive a reload.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bloodline:storage-full'));
    }
  }
  // Persist whenever we made a local change, OR when normalisation cleaned up a
  // mess that arrived from the server — so the fix propagates instead of being
  // re-merged back next time.
  if (!fromServer || cleaned) scheduleServerSave(state);
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

    _serverEtag = res.headers.get('ETag') || _serverEtag;

    const localSeq = state._seq || 0;
    const serverSeq = data._seq || 0;

    // Local is ahead — unsaved changes exist. Push them up; don't overwrite.
    // Skip this when forceServerWins (e.g. joining via invite): we must never
    // let a guest's stale local tree overwrite the family they just joined.
    if (!forceServerWins && localSeq > serverSeq && state.people?.length > 0) {
      // Still reconcile the viewer's seat from their claim/email so a stale
      // cached myPersonId (e.g. inherited from the tree owner) self-heals
      // instead of being skipped on this fast path.
      const seatId = resolveViewerPersonId(state.people, state.myPersonId);
      if (seatId && seatId !== state.myPersonId) {
        commit({ ...state, myPersonId: seatId });
      } else {
        saveToServer();
      }
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

    // Honour deletions: union local + server tombstones, then drop anything the
    // user deleted (so the server copy can't resurrect it) and any edge left
    // dangling to a removed person.
    const deleted = mergeTombstones(state._deleted, data._deleted);
    const people = dropTombstoned(mergedPeople, deleted, 'people');
    const peopleIds = new Set((people || []).map((p) => p.id));
    const relationships = dropTombstoned(data.relationships, deleted, 'relationships')
      .filter((r) => peopleIds.has(r.from_person) && peopleIds.has(r.to_person));
    const memories = dropTombstoned(data.memories, deleted, 'memories');
    const photos = dropTombstoned(mergedPhotos, deleted, 'photos');
    const documents = dropTombstoned(mergedDocs, deleted, 'documents');

    // Resolve the viewer's own person (their claimed link first, then email)
    // so each family member sees relationship labels from their own seat — not
    // the owner's, which is what the shared myPersonId defaults to.
    const resolvedMyPersonId = resolveViewerPersonId(people, data.myPersonId);

    commit(
      {
        ...EMPTY,
        ...data,
        people,
        relationships,
        memories,
        photos,
        documents,
        _deleted: deleted,
        ...(resolvedMyPersonId ? { myPersonId: resolvedMyPersonId } : {}),
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

let _currentUser = null;
export function setCurrentUser(user) { _currentUser = user; }

// Resolve which person in the tree represents the logged-in viewer, so every
// family member sees relationship labels from their OWN seat. myPersonId is a
// single field stored on the shared tree (it defaults to the owner), so we must
// override it per-viewer on load. Priority:
//   1. The person the user has explicitly claimed (user.person_id) — the
//      authoritative server-side link; always wins when that person exists.
//   2. A person whose email / invited_email matches the login email.
//   3. The tree's stored myPersonId (owner fallback).
function resolveViewerPersonId(people, fallbackId) {
  const list = people || [];
  const claimedId = _currentUser?.person_id;
  if (claimedId && list.some((p) => p.id === claimedId)) return claimedId;
  const email = _currentUser?.email?.toLowerCase();
  if (email) {
    const match = list.find(
      (p) => p.email?.toLowerCase() === email || p.invited_email?.toLowerCase() === email,
    );
    if (match) return match.id;
  }
  return fallbackId;
}

// Bind the in-memory + cached tree to a logged-in account. If this device's
// cache belongs to a DIFFERENT user (the previous person never logged out, or
// a family is shared on one device), drop the previous tree entirely before we
// load this user's from the server — so people on a shared device never see or
// accidentally overwrite each other's data.
//
// Returns true if the cache already belonged to this user (so a local tree
// that's ahead of the server can be trusted as their unsaved work). When there
// is no stored owner yet (a returning solo user from before this change, or a
// fresh onboarding/anonymous tree) we keep the local tree and adopt it for this
// user — the common, safe case.
export function bindIdentity(uid) {
  if (!uid) return true;
  let owner = null;
  try { owner = localStorage.getItem(OWNER_KEY); } catch { /* ignore */ }
  const sameUser = owner === uid;
  if (owner && !sameUser) {
    // A different person is signing in on this device — forget their tree.
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    state = { ...EMPTY };
    _serverEtag = null;
  }
  try { localStorage.setItem(OWNER_KEY, uid); } catch { /* ignore */ }
  return sameUser;
}

// Wipe everything this device cached about the family tree (the tree itself and
// the owner stamp). Called on logout so the next person to use this browser
// starts from a clean slate and loads only their own tree from the server.
export function clearLocalData() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(OWNER_KEY);
  } catch { /* ignore */ }
  state = { ...EMPTY };
  _serverEtag = null;
  _currentUser = null;
  listeners.forEach((l) => l());
}

function nameFromEmail(email) {
  if (!email) return 'Someone';
  const first = email.split('@')[0].split(/[._\-0-9]/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

// Prepend an activity event to the next state object, capped at 100 entries.
function withActivity(next, partial) {
  const authorEmail = _currentUser?.email ?? null;
  // Prefer the author's real name: their claimed person, then their account
  // display name, falling back to a guess from the email only as a last resort.
  const claimed = _currentUser?.person_id
    && (next.people || state.people || []).find((p) => p.id === _currentUser.person_id);
  const authorName = claimed?.display_name || _currentUser?.display_name || nameFromEmail(authorEmail);
  const event = { id: acid(), authorName, authorEmail, detail: null, ...partial, created_at: new Date().toISOString() };
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

export function addRelative({ anchorId, relKey, name, given, middle, family, gender, birth_date, is_deceased, death_date, qualifier = 'biological' }) {
  const id = uid();
  const meta = RELATIONSHIPS.find((r) => r.key === relKey);

  // Hard biological-parent constraint: at most one bio parent per gender role.
  if (qualifier === 'biological' && (relKey === 'mother' || relKey === 'father')) {
    const targetGender = relKey === 'mother' ? 'female' : 'male';
    if (bioParentGendersFilled(anchorId).has(targetGender)) return null;
  }
  // Names: prefer structured given/middle/family; fall back to splitting a single
  // `name` string (older callers). display_name is the everyday name (given +
  // family); the middle name is stored separately and woven in by fullName().
  const g = (given || '').trim();
  const m = (middle || '').trim();
  const fam = (family || '').trim();
  const structured = g || fam || m;
  const displayName = structured
    ? [g, fam].filter(Boolean).join(' ') || (name || '').trim()
    : (name || '').trim();
  const givenNames = structured ? (g || null) : ((name || '').trim().split(/\s+/).slice(0, -1).join(' ') || null);
  const familyName = structured ? (fam || null) : ((name || '').trim().split(/\s+/).slice(-1)[0] || null);
  const defaultVisibility = 'full';
  const person = {
    id,
    display_name: displayName,
    given_names: givenNames,
    middle_name: m || null,
    family_name: familyName,
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
  // placeholder parents that connect both people. We create BOTH a mother and a
  // father (partnered) so the two siblings share *two* parents and read as full
  // siblings — a single placeholder made them only half-siblings, which confused
  // people who didn't know how it worked. The placeholders are 'uncertain' so
  // they clearly read as stand-ins to be filled in or merged later.
  const extraPeople = [];
  const extraEdges = [];
  if ((relKey === 'brother' || relKey === 'sister') && edges.length === 0) {
    const anchor = state.people.find((p) => p.id === anchorId);
    const fam = anchor?.family_name || anchor?.display_name?.split(/\s+/).slice(-1)[0] || '';
    const mkParent = (genderRole, roleWord) => ({
      id: uid(),
      display_name: fam ? `${fam} ${roleWord}` : `Unknown ${roleWord}`,
      given_names: null,
      family_name: fam || null,
      gender: genderRole,
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
    const mother = mkParent('female', 'Mother');
    const father = mkParent('male', 'Father');
    extraPeople.push(mother, father);
    extraEdges.push(
      partnerEdge(father.id, mother.id, 'current'),
      parentEdge(mother.id, anchorId), parentEdge(father.id, anchorId),
      parentEdge(mother.id, id), parentEdge(father.id, id),
    );
  }

  commit(withActivity({
    ...state,
    people: [...state.people, ...extraPeople, person],
    relationships: [...state.relationships, ...edges, ...extraEdges],
  }, { type: 'person_added', personId: id, personName: displayName }));
  return id;
}

// Is `ancestorId` an ancestor of `personId` along parent edges? Used to stop a
// parent link from creating a cycle (someone becoming their own ancestor).
function isAncestorOf(ancestorId, personId, rels = state.relationships) {
  const parentsOf = (id) => rels.filter((r) => r.type === 'parent' && r.to_person === id).map((r) => r.from_person);
  const stack = [...parentsOf(personId)];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (cur === ancestorId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...parentsOf(cur));
  }
  return false;
}

// Link two existing people with a partner or parent relationship.
// fromId is the parent when type is 'parent'; for partner types, order is arbitrary.
// Returns { ok: true } or { ok: false, reason } so callers can explain failures:
//   'duplicate' — already linked that way · 'bio-parent-full' — gender slot taken
//   'cycle' — would make someone their own ancestor · 'self' — same person.
export function addRelationship(fromId, toId, type, qualifier = 'biological') {
  if (!fromId || !toId || fromId === toId) return { ok: false, reason: 'self' };
  const edgeType = type === 'ex_partner' ? 'partner' : type;
  const isPair = (r) =>
    (r.from_person === fromId && r.to_person === toId) ||
    (r.from_person === toId && r.to_person === fromId);

  const already = state.relationships.some((r) => r.type === edgeType && isPair(r));

  if (!already && type === 'parent') {
    // Cycle guard: fromId would be a parent of toId, so toId must not already be
    // an ancestor of fromId.
    if (isAncestorOf(toId, fromId)) return { ok: false, reason: 'cycle' };
    if (qualifier === 'biological') {
      const parentGender = state.people.find((p) => p.id === fromId)?.gender;
      if (parentGender && bioParentGendersFilled(toId).has(parentGender)) {
        return { ok: false, reason: 'bio-parent-full' };
      }
    }
  }

  // A pair can hold ONE direct relationship — partner OR parent, never both.
  // Drop the contradictory other-kind edge(s) between them before adding, so a
  // mis-added child can't linger as a parent after becoming a partner (and so
  // such a stale edge self-heals the next time the right relationship is set).
  const conflictType = edgeType === 'partner' ? 'parent' : 'partner';
  const base = state.relationships.filter((r) => !(r.type === conflictType && isPair(r)));
  const hadConflict = base.length !== state.relationships.length;

  if (already && !hadConflict) return { ok: false, reason: 'duplicate' };

  let nextRels = base;
  if (!already) {
    let edge;
    if (type === 'partner') edge = partnerEdge(fromId, toId, 'current');
    else if (type === 'ex_partner') edge = partnerEdge(fromId, toId, 'former');
    else if (type === 'parent') edge = parentEdge(fromId, toId, qualifier);
    else return { ok: false, reason: 'unknown-type' };
    nextRels = [...base, edge];
  }

  const fromPerson = state.people.find((p) => p.id === fromId);
  const toPerson = state.people.find((p) => p.id === toId);
  commit(withActivity({ ...state, relationships: nextRels }, {
    type: 'relationship_added',
    personId: fromId,
    personName: fromPerson?.display_name ?? '',
    detail: toPerson?.display_name ?? '',
  }));
  return { ok: true };
}

// Set the direct relationship between two existing people to a specific kind,
// clearing any current direct edge first. kind:
//   'partner' | 'ex_partner' | 'parent_of' (a is parent of b) | 'child_of' (b is parent of a)
// Returns the same result shape as addRelationship.
export function setRelationshipKind(aId, bId, kind, qualifier = 'biological') {
  if (!aId || !bId || aId === bId) return { ok: false, reason: 'self' };
  // Clear existing direct edges between the pair so we can re-set cleanly.
  const isPair = (r) =>
    (r.from_person === aId && r.to_person === bId) || (r.from_person === bId && r.to_person === aId);
  const cleared = state.relationships.filter((r) => !((r.type === 'partner' || r.type === 'parent') && isPair(r)));
  // Validate the new edge against the cleared set (e.g. cycle check).
  if (kind === 'parent_of' && isAncestorOf(bId, aId, cleared)) return { ok: false, reason: 'cycle' };
  if (kind === 'child_of' && isAncestorOf(aId, bId, cleared)) return { ok: false, reason: 'cycle' };

  let edge;
  if (kind === 'partner') edge = partnerEdge(aId, bId, 'current');
  else if (kind === 'ex_partner') edge = partnerEdge(aId, bId, 'former');
  else if (kind === 'parent_of') edge = parentEdge(aId, bId, qualifier);
  else if (kind === 'child_of') edge = parentEdge(bId, aId, qualifier);
  else return { ok: false, reason: 'unknown-type' };

  commit({ ...state, relationships: [...cleared, edge] });
  return { ok: true };
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
  const isMatch = (r) => {
    if (r.type !== type) return false;
    if (type === 'parent') return r.from_person === fromId && r.to_person === toId;
    return (r.from_person === fromId && r.to_person === toId) ||
      (r.from_person === toId && r.to_person === fromId);
  };
  const removedIds = state.relationships.filter(isMatch).map((r) => r.id);
  commit(withTombstones({
    ...state,
    relationships: state.relationships.filter((r) => !isMatch(r)),
  }, 'relationships', removedIds));
}

// Merge a duplicate person (dropId) into the one to keep (keepId): repoint every
// relationship and piece of content, fill the kept person's blank fields from the
// duplicate, then delete the duplicate. Edges are de-duplicated and the
// partner/parent exclusivity is enforced on the result.
export function mergePeople(keepId, dropId) {
  if (!keepId || !dropId || keepId === dropId) return;
  const keep = state.people.find((p) => p.id === keepId);
  const drop = state.people.find((p) => p.id === dropId);
  if (!keep || !drop) return;

  // Field merge: keep wins; fall back to the duplicate for anything blank.
  const merged = { ...keep };
  const fillable = [
    'photo', 'photo_thumb', 'birth_date', 'death_date', 'birth_place', 'residence',
    'occupation', 'bio', 'gender', 'given_names', 'middle_name', 'family_name',
    'birth_name', 'email', 'phone', 'story',
  ];
  for (const f of fillable) {
    if (merged[f] == null || merged[f] === '') merged[f] = drop[f] ?? merged[f] ?? null;
  }
  merged.tags = [...new Set([...(keep.tags || []), ...(drop.tags || [])])];
  merged.events = [...(keep.events || []), ...(drop.events || [])];
  merged.conditions = [...(keep.conditions || []), ...(drop.conditions || [])];
  if (drop.is_deceased && !keep.is_deceased) {
    merged.is_deceased = true;
    merged.is_living = false;
    if (!merged.death_date) merged.death_date = drop.death_date || null;
  }

  // Repoint edges from the duplicate to the kept person, drop self-edges, then
  // de-duplicate and enforce that a pair is partner OR parent, never both.
  const pk = (a, b) => [a, b].sort().join('~');
  const repointed = state.relationships
    .map((r) => ({
      ...r,
      from_person: r.from_person === dropId ? keepId : r.from_person,
      to_person: r.to_person === dropId ? keepId : r.to_person,
    }))
    .filter((r) => r.from_person !== r.to_person);

  const partnerPairs = new Set(
    repointed.filter((r) => r.type === 'partner').map((r) => pk(r.from_person, r.to_person)),
  );
  const seen = new Set();
  const relationships = [];
  for (const r of repointed) {
    if (r.type === 'parent') {
      // Partner wins over a contradictory parent edge for the same pair.
      if (partnerPairs.has(pk(r.from_person, r.to_person))) continue;
      const k = 'parent|' + r.from_person + '>' + r.to_person;
      if (seen.has(k)) continue;
      seen.add(k); relationships.push(r);
    } else if (r.type === 'partner') {
      const k = 'partner|' + pk(r.from_person, r.to_person);
      if (seen.has(k)) continue;
      seen.add(k); relationships.push(r);
    } else {
      relationships.push(r);
    }
  }

  const reassign = (arr) => (arr || []).map((x) => (x.person_id === dropId ? { ...x, person_id: keepId } : x));
  const people = state.people.filter((p) => p.id !== dropId).map((p) => (p.id === keepId ? merged : p));

  // Tombstone the dropped person so a sync merge can't resurrect the duplicate.
  const next = withTombstones({
    ...state,
    people,
    relationships,
    memories: reassign(state.memories),
    photos: reassign(state.photos),
    documents: reassign(state.documents),
    myPersonId: state.myPersonId === dropId ? keepId : state.myPersonId,
  }, 'people', [dropId]);

  commit(withActivity(next, {
    type: 'people_merged',
    personId: keepId,
    personName: merged.display_name,
    detail: drop.display_name,
  }));
}

// Remove a person and all traces of them from the tree. Tombstones the person,
// their edges, and their content so a sync merge can't bring any of it back.
export function removePerson(id) {
  const relIds = state.relationships.filter((r) => r.from_person === id || r.to_person === id).map((r) => r.id);
  const memIds = (state.memories || []).filter((m) => m.person_id === id).map((m) => m.id);
  const phIds = (state.photos || []).filter((ph) => ph.person_id === id).map((ph) => ph.id);
  const docIds = (state.documents || []).filter((d) => d.person_id === id).map((d) => d.id);

  let next = {
    ...state,
    people: state.people.filter((p) => p.id !== id),
    relationships: state.relationships.filter((r) => r.from_person !== id && r.to_person !== id),
    memories: (state.memories || []).filter((m) => m.person_id !== id),
    photos: (state.photos || []).filter((ph) => ph.person_id !== id),
    documents: (state.documents || []).filter((d) => d.person_id !== id),
  };
  next = withTombstones(next, 'people', [id]);
  next = withTombstones(next, 'relationships', relIds);
  next = withTombstones(next, 'memories', memIds);
  next = withTombstones(next, 'photos', phIds);
  next = withTombstones(next, 'documents', docIds);
  commit(next);
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

export function updatePerson(id, fields, activityEvent = null) {
  const next = { ...state, people: state.people.map((p) => (p.id === id ? { ...p, ...fields } : p)) };
  commit(activityEvent ? withActivity(next, activityEvent) : next);
}

// Claim which person in the tree represents the logged-in viewer. Drives the
// focus + perspective (relationship labels, insights) from their seat.
export function setMyPerson(personId) {
  commit({ ...state, myPersonId: personId });
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
  commit(withTombstones({ ...state, memories: state.memories.filter((mem) => mem.id !== id) }, 'memories', [id]));
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

export function removePhoto(id) {
  commit(withTombstones({ ...state, photos: state.photos.filter((p) => p.id !== id) }, 'photos', [id]));
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
  // Collect results and apply them in one commit at the end, rather than one
  // commit per upload as each promise resolves — with several photos pending
  // (a fresh login on a tree that's never been migrated), that used to fire
  // a separate save + tree re-render for each one, in a visible burst.
  const personUpdates = new Map();
  const photoUpdates = new Map();

  await Promise.allSettled([
    ...portraits.map(async (p) => {
      const url = await uploadFn(p.photo);
      if (url !== p.photo) { personUpdates.set(p.id, url); uploaded++; }
      else failed++;
    }),
    ...gallery.map(async (ph) => {
      const url = await uploadFn(ph.src);
      if (url !== ph.src) { photoUpdates.set(ph.id, url); uploaded++; }
      else failed++;
    }),
  ]);

  if (personUpdates.size || photoUpdates.size) {
    commit({
      ...state,
      people: state.people.map((p) =>
        personUpdates.has(p.id) ? { ...p, photo: personUpdates.get(p.id), photo_thumb: null } : p,
      ),
      photos: state.photos.map((ph) =>
        photoUpdates.has(ph.id) ? { ...ph, src: photoUpdates.get(ph.id) } : ph,
      ),
    });
  }

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
  commit(withTombstones({ ...state, documents: state.documents.filter((d) => d.id !== id) }, 'documents', [id]));
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
  // Same batching as migratePhotosToR2 — one commit at the end, not one per
  // upload as each resolves.
  const docUpdates = new Map();
  await Promise.allSettled(
    docs.map(async (doc) => {
      const url = await uploadFn(doc.src, { title: doc.title, mime: doc.mime });
      if (url !== doc.src) { docUpdates.set(doc.id, url); uploaded++; }
      else failed++;
    }),
  );
  if (docUpdates.size) {
    commit({
      ...state,
      documents: state.documents.map((d) => (docUpdates.has(d.id) ? { ...d, src: docUpdates.get(d.id) } : d)),
    });
  }
  return { total: docs.length, uploaded, failed };
}

export function updateFamilyName(name) {
  commit({ ...state, familyName: name.trim() || state.familyName });
}

export function resetTree() {
  commit({ ...EMPTY });
}

// Replace or merge the tree with people + relationships from a GEDCOM import.
// merge=false: wipes everything and starts fresh with the imported data.
// merge=true: appends to the existing tree (duplicates possible).
export function importFromGedcom(newPeople, newRelationships, { merge = false } = {}) {
  const next = merge
    ? {
        ...state,
        people: [...state.people, ...newPeople],
        relationships: [...state.relationships, ...newRelationships],
      }
    : {
        ...EMPTY,
        people: newPeople,
        relationships: newRelationships,
        hasCompletedOnboarding: true,
        familyName: state.familyName || 'My Family',
        myPersonId: newPeople[0]?.id ?? null,
        activity: state.activity ?? [],
      };
  commit(next);
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

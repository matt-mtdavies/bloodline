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
// Device-scoped read markers, kept outside the synced state blob (`state`)
// so a server merge can never clobber or reset them. See getActivityReadAt()/
// setActivityReadAt() and takeRecapCutoff() below.
const ACTIVITY_READ_KEY = 'bloodline:activityReadAt';
const RECAP_CUTOFF_KEY = 'bloodline:recapCutoffAt';

// localStorage quota is unspecified but consistently ~5MB per origin across
// major browsers (desktop and mobile Safari/PWA included) — there's no
// synchronous API to ask "how much is actually left", so this is a
// conservative fixed heuristic, not a measured limit. Warning at 80% gives
// real headroom to act (remove some photos) before an edit silently fails
// to persist, rather than only ever finding out after the fact.
const STORAGE_WARN_BYTES = 4 * 1024 * 1024;
const STORAGE_WARN_COOLDOWN_MS = 5 * 60 * 1000;
let lastStorageWarnAt = 0;

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
// Values: 'idle' | 'saving' | 'saved' | 'error' | 'error-auth' | 'error-forbidden'
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
  } else if (statusCode === 401) {
    setSyncStatus('error-auth');
    console.warn('[store] server sync: auth error', statusCode);
  } else if (statusCode === 403) {
    // Distinct from 401: the session is fine, the action just isn't allowed
    // for this role (e.g. an editor tried to remove a person or erase the
    // tree) — _lastSyncError.message already carries the server's specific
    // reason from putTree, so TopBar can show that instead of a generic
    // "session expired" message that would be actively misleading here.
    setSyncStatus('error-forbidden');
    console.warn('[store] server sync: forbidden', statusCode);
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
        // 403s here always carry a clear, human-readable reason (a
        // permission boundary, not a raw server fault) — show it as-is.
        : r.status === 403 && errorBody?.detail
        ? errorBody.detail
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

// Merge two arrays of {id, updated_at?} records: whichever side was edited
// more recently wins for ids present on both; ids unique to either side are
// kept as-is. Ties (including both sides missing updated_at, e.g. records
// from before this field existed) prefer local, matching the old behaviour.
// This is what stops a stale device — one that cached a record before some
// newer edit reached it — from silently reverting that edit just because it
// happens to save something else afterward.
function _mergeByRecency(serverArr, localArr) {
  const serverMap = new Map((serverArr || []).map((x) => [x.id, x]));
  const localMap = new Map((localArr || []).map((x) => [x.id, x]));
  const ids = new Set([...serverMap.keys(), ...localMap.keys()]);
  const out = [];
  for (const id of ids) {
    const s = serverMap.get(id);
    const l = localMap.get(id);
    if (s && l) out.push((l.updated_at || 0) >= (s.updated_at || 0) ? l : s);
    else out.push(l || s);
  }
  return out;
}

// Activity events are append-only (created once, never edited in place), so
// there's no "newer version" to pick per id — just union both sides so
// neither device's events are lost, newest first, capped like withActivity().
function _mergeActivity(serverArr, localArr) {
  const byId = new Map();
  for (const e of (serverArr || [])) if (e?.id) byId.set(e.id, e);
  for (const e of (localArr || [])) if (e?.id) byId.set(e.id, e);
  return [...byId.values()]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 100);
}

async function _fetchAndMerge(local) {
  try {
    const res = await fetch('/api/tree');
    if (!res.ok) return null;
    const server = await res.json();
    _serverEtag = res.headers.get('ETag') || _serverEtag;

    // Re-bind to the freshest local state, not the snapshot the caller passed
    // in. fetch() above is the one real await in this function — anywhere
    // from tens of ms to a couple of seconds where the user can keep editing.
    // Every edit goes through commit(), which replaces the module-level
    // `state` wholesale; if this function kept using the stale `local`
    // snapshot from before the fetch, the commit(merged) below would replace
    // `state` with something that never saw whatever was edited during that
    // window — silently reverting it locally AND dropping it from the next
    // save, since the save timer reads `state` at fire time, not a snapshot.
    // `state` is always a superset of what `local` knew (commits only move
    // forward), so swapping in the latest can only preserve more real work,
    // never lose any — including the case where local IS already state.
    local = state;

    const mergedPeople = _mergeByRecency(server.people, local.people);

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
        _mergeByRecency(server.relationships, local.relationships),
        deleted, 'relationships',
      ).filter((r) => peopleIds.has(r.from_person) && peopleIds.has(r.to_person)),
      memories: dropTombstoned(_mergeByRecency(server.memories, local.memories), deleted, 'memories'),
      photos: dropTombstoned(_mergeByRecency(server.photos, local.photos), deleted, 'photos'),
      documents: dropTombstoned(_mergeByRecency(server.documents, local.documents), deleted, 'documents'),
      activity: _mergeActivity(server.activity, local.activity),
      _deleted: deleted,
      // See the matching comments in loadFromServer() — neither is a plain
      // "local wins" scalar: an empty/false local default (fresh device)
      // must not clobber a real server value. hasCompletedOnboarding is a
      // one-way ratchet; familyName falls back to the server's name when
      // local hasn't genuinely been set to anything.
      hasCompletedOnboarding: !!(local.hasCompletedOnboarding || server.hasCompletedOnboarding),
      familyName: local.familyName || server.familyName || '',
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

    // NOT gated on _seq. _seq counts commits on a device, not "has the
    // newer copy of every record" — a device that made several of its own
    // unrelated edits can have a higher local _seq than the server while
    // still holding a stale copy of some record a different family member
    // updated elsewhere. Skipping the merge on that basis meant this
    // device's _serverEtag still silently advanced to match the server
    // (above), so a LATER save from here would carry a valid If-Match and
    // sail through with no 409 to trigger a merge — overwriting the
    // server's newer record with this device's stale one, with no conflict
    // ever detected. The ETag check above already established the content
    // genuinely differs; that's the only signal that matters for whether to
    // merge, so always do it once we know a merge is possible.
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

// If the tab is backgrounded (phone locked, app-switched away from) before
// the 1.5s debounce above fires, iOS suspends this page's JS and that timer
// simply never runs — the edit sits safely in localStorage forever (so the
// device that made it keeps showing it indefinitely) but never reaches the
// server, and nothing ever surfaces an error because the request never even
// started. This is extremely easy to hit in practice: edit a profile, then
// immediately lock the phone or switch apps, which is completely normal
// mobile behaviour. visibilitychange (fires as the tab goes hidden, before
// suspension) and pagehide (actual navigation/close) both flush any pending
// save immediately instead of waiting out the debounce, so the fetch is at
// least in flight before the tab can be frozen — browsers give an
// already-started request a real chance to complete through that
// transition in a way a not-yet-started one never gets.
function flushPendingSave() {
  if (!_saveTimer) return;
  clearTimeout(_saveTimer);
  _saveTimer = null;
  putTree(state);
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingSave();
  });
  window.addEventListener('pagehide', flushPendingSave);
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

// Stamps updated_at on any record that's new or whose reference changed since
// the previous commit (every mutator builds new arrays via .map()/.filter(),
// which only produces a fresh object reference for the record actually
// touched — untouched records keep their old reference). This is what lets a
// sync merge tell "which side was edited more recently" instead of just
// picking one side wholesale — see _mergeByRecency.
function stampUpdatedAt(nextArr, prevArr) {
  if (!Array.isArray(nextArr)) return nextArr;
  const prevById = new Map((prevArr || []).map((x) => [x.id, x]));
  const now = Date.now();
  let changed = false;
  const mapped = nextArr.map((item) => {
    if (prevById.get(item.id) === item) return item;
    changed = true;
    return { ...item, updated_at: now };
  });
  // .map() always allocates a new array, even when every item passed through
  // unchanged — commit() below calls this on EVERY local commit, including
  // ones that only touch memories/photos/activity, so without this early
  // return, data.people/data.relationships got a fresh array reference on
  // every single action. Anything downstream keyed on that reference (the
  // graph memo in App.jsx, BubbleTree's sync effect) recomputed constantly —
  // the real source of the tree jiggling on unrelated changes.
  return changed ? mapped : nextArr;
}

// fromServer=true: loading from D1 — don't increment _seq or schedule a save.
function commit(next, { fromServer = false } = {}) {
  if (!fromServer) {
    next = {
      ...next,
      people: stampUpdatedAt(next.people, state.people),
      relationships: stampUpdatedAt(next.relationships, state.relationships),
      memories: stampUpdatedAt(next.memories, state.memories),
      photos: stampUpdatedAt(next.photos, state.photos),
      documents: stampUpdatedAt(next.documents, state.documents),
    };
  }
  const cleanRels = normalizeRelationships(next.relationships);
  const cleaned = cleanRels.length !== (next.relationships?.length ?? 0);
  next = cleaned ? { ...next, relationships: cleanRels } : next;
  state = fromServer ? next : { ...next, _seq: (next._seq || 0) + 1 };
  const serialized = JSON.stringify(state);
  try {
    localStorage.setItem(KEY, serialized);
  } catch {
    // Storage full — changes live in-memory but won't survive a reload.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bloodline:storage-full'));
    }
  }
  // .length is UTF-16 code units, not bytes — close enough for a threshold
  // check (this data is overwhelmingly ASCII field values; the gap only
  // matters for a precise byte count, not for "getting close or not").
  if (
    typeof window !== 'undefined' &&
    serialized.length > STORAGE_WARN_BYTES &&
    Date.now() - lastStorageWarnAt > STORAGE_WARN_COOLDOWN_MS
  ) {
    lastStorageWarnAt = Date.now();
    window.dispatchEvent(new CustomEvent('bloodline:storage-near-limit'));
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

    // Joining a new family via invite — a guest's local tree must never leak
    // into (or overwrite) the family they're joining, so take the server's
    // tree exactly as given, no merge.
    if (forceServerWins) {
      commit({ ...EMPTY, ...data }, { fromServer: true });
      return true;
    }

    // Reconcile per-record by recency (updated_at) rather than picking one
    // whole side based on a coarse _seq comparison. _seq counts commits on
    // THIS device — it says nothing about whether this device's copy of any
    // given record is stale. A device that made several of its own
    // unrelated edits can have a higher local _seq than the server while
    // still holding a stale copy of a record a different family member
    // updated elsewhere; the old code took that as "local wins, push it,"
    // which silently overwrote the server's newer record with this
    // device's stale one on the very next boot. This is exactly what
    // happened to a family member's newly-added profile photo.
    const localPortraits = new Map(
      (state.people || []).filter((p) => p.photo?.startsWith('data:')).map((p) => [p.id, p.photo]),
    );
    // Data: URLs are stripped from the D1 payload to stay under the row size
    // limit; restore them from localStorage before the recency merge so a
    // server record that's otherwise older doesn't lose its local photo
    // just because the transport dropped it. photo_thumb is a small
    // (~5 KB) thumbnail stored in D1 as a cross-device sync fallback when
    // R2 is unavailable.
    const serverPeopleWithPhotos = Array.isArray(data.people)
      ? data.people.map((p) => {
          if (!p.photo) {
            if (localPortraits.has(p.id)) return { ...p, photo: localPortraits.get(p.id) };
            if (p.photo_thumb) return { ...p, photo: p.photo_thumb };
          }
          return p;
        })
      : data.people;
    const mergedPeople = _mergeByRecency(serverPeopleWithPhotos, state.people);

    const serverPhotoIds = new Set((data.photos || []).map((ph) => ph.id));
    const localDataPhotos = (state.photos || []).filter(
      (ph) => ph.src?.startsWith('data:') && !serverPhotoIds.has(ph.id),
    );
    const mergedPhotos = _mergeByRecency([...(data.photos || []), ...localDataPhotos], state.photos);

    const serverDocIds = new Set((data.documents || []).map((d) => d.id));
    const localDataDocs = (state.documents || []).filter(
      (d) => d.src?.startsWith('data:') && !serverDocIds.has(d.id),
    );
    const mergedDocuments = _mergeByRecency([...(data.documents || []), ...localDataDocs], state.documents);

    const mergedRelationships = _mergeByRecency(data.relationships, state.relationships);
    const mergedMemories = _mergeByRecency(data.memories, state.memories);

    // Honour deletions: union local + server tombstones, then drop anything the
    // user deleted (so the server copy can't resurrect it) and any edge left
    // dangling to a removed person.
    const deleted = mergeTombstones(state._deleted, data._deleted);
    const people = dropTombstoned(mergedPeople, deleted, 'people');
    const peopleIds = new Set((people || []).map((p) => p.id));
    const relationships = dropTombstoned(mergedRelationships, deleted, 'relationships')
      .filter((r) => peopleIds.has(r.from_person) && peopleIds.has(r.to_person));
    const memories = dropTombstoned(mergedMemories, deleted, 'memories');
    const photos = dropTombstoned(mergedPhotos, deleted, 'photos');
    const documents = dropTombstoned(mergedDocuments, deleted, 'documents');

    // Resolve the viewer's own person (their claimed link first, then email)
    // so each family member sees relationship labels from their own seat — not
    // the owner's, which is what the shared myPersonId defaults to.
    const resolvedMyPersonId = resolveViewerPersonId(people, state.myPersonId ?? data.myPersonId);

    const merged = {
      ...EMPTY,
      ...data,
      ...state, // local scalars win, matching _fetchAndMerge's convention — EXCEPT the ones overridden below
      people,
      relationships,
      memories,
      photos,
      documents,
      // Dropped by the "local scalars win" spread above on a fresh device: a
      // brand-new local activity log starts as [], which would otherwise wipe
      // out everything the server already knows. _fetchAndMerge (the
      // background-poll path) merges this properly; this was the one path
      // that didn't, so a fresh sign-in briefly showed an empty activity feed.
      activity: _mergeActivity(data.activity, state.activity),
      _deleted: deleted,
      _seq: Math.max(state._seq || 0, data._seq || 0),
      // NOT a plain "local wins" scalar like the others above: a fresh device
      // (private tab, cleared storage, new browser) starts with the EMPTY
      // default of false, which would otherwise clobber a server tree that
      // already finished onboarding — dropping a returning user straight
      // into the "brand new user" intro/setup flow, which can go on to
      // overwrite their real tree via setupTree(). It's a one-way ratchet:
      // true on either side means onboarding is genuinely done.
      hasCompletedOnboarding: !!(state.hasCompletedOnboarding || data.hasCompletedOnboarding),
      // Also not a plain "local wins" scalar: an empty string is the fresh-
      // device default, not a real local edit — falling back to it clobbered
      // the server's actual family name (reported live: a private-tab
      // sign-in showed "James", the default-focus person's name used as a
      // last-resort label, instead of the real family name). A genuinely-set
      // local name (renamed on this device before it last synced) still wins.
      familyName: state.familyName || data.familyName || '',
      ...(resolvedMyPersonId ? { myPersonId: resolvedMyPersonId } : {}),
    };

    commit(merged, { fromServer: true });

    // If this device had any local content, the merge above may include
    // genuinely-unsaved local edits (or a newer photo the server's stripped
    // payload didn't carry) that the server doesn't have yet — push the
    // reconciled result back up rather than assuming a fetch alone caught
    // it up. This is the only place that used to push raw, unmerged local
    // state; now it always pushes the merged (safe) result instead.
    if (state.people?.length > 0) scheduleServerSave(merged);

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
    // A different person is signing in on this device — forget their tree
    // and their read markers, so the new person gets their own "since last
    // here" baseline instead of inheriting the previous user's.
    try {
      localStorage.removeItem(KEY);
      localStorage.removeItem(ACTIVITY_READ_KEY);
      localStorage.removeItem(RECAP_CUTOFF_KEY);
    } catch { /* ignore */ }
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
    localStorage.removeItem(ACTIVITY_READ_KEY);
    localStorage.removeItem(RECAP_CUTOFF_KEY);
  } catch { /* ignore */ }
  state = { ...EMPTY };
  _serverEtag = null;
  _currentUser = null;
  listeners.forEach((l) => l());
}

// The activity bell badge's "seen up to" marker — persisted so a reload
// doesn't forget you've already looked and re-flash everything as unread.
export function getActivityReadAt() {
  try {
    const raw = localStorage.getItem(ACTIVITY_READ_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}
export function setActivityReadAt(ts) {
  try { localStorage.setItem(ACTIVITY_READ_KEY, String(ts)); } catch { /* ignore */ }
}

// "Since you were last here" for the recap tour — distinct from the activity
// badge's marker above, which resets the moment you open the activity panel
// (before you've necessarily played the recap). A plain read, deliberately
// NOT consume-on-read: merely booting the app (and the nudge/hero flashing
// on screen as a result) must not advance this, or ignoring it — not
// watching the tour, not dismissing the nudge — would silently lose it the
// next time the tree is opened. This used to persist a fresh cutoff on
// every single call, which is exactly that bug: ignore the "N updates"
// nudge, close the app, reopen it, and the updates were gone with no way
// to see them, because the previous boot had already quietly marked them
// seen. It only moves forward via setRecapCutoff() below, called when the
// recap is actually watched or the nudge is explicitly dismissed (see
// App.jsx's markRecapSeen and its wiring to the nudge's own dismiss). The
// one exception is a person's very first-ever visit, where a baseline has
// to be established somehow — otherwise a brand-new device would surface
// the entire historical activity log as "N updates" the first time it
// loads. Returns null that one time — callers should treat that as
// "nothing to recap yet," not "recap everything ever".
export function takeRecapCutoff() {
  try {
    const raw = localStorage.getItem(RECAP_CUTOFF_KEY);
    if (raw != null) return Number(raw);
    localStorage.setItem(RECAP_CUTOFF_KEY, String(Date.now()));
  } catch { /* ignore */ }
  return null;
}

// Advances the persisted cutoff mid-session — call this the moment the
// recap is opened (nudge or the activity panel's hero), so it reads as
// "seen" immediately rather than only updating on the next full page load.
// Without this, reopening the activity panel later in the same session (or
// on a later visit) would show the exact same "N updates" again, since
// takeRecapCutoff() only ever runs once per boot.
export function setRecapCutoff(ts) {
  try { localStorage.setItem(RECAP_CUTOFF_KEY, String(ts)); } catch { /* ignore */ }
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
function edgesFor(relKey, anchorId, newId, current, qualifier = 'biological', childCoParentId = null) {
  const parentsOf = (id) =>
    current.relationships.filter((r) => r.type === 'parent' && r.to_person === id).map((r) => r.from_person);

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
      // The other biological parent is an explicit choice made in the sheet
      // (a chip picker when the anchor has multiple partners on record,
      // silent when there's exactly one) — never every partner the anchor
      // has ever had. Looping every partner used to hand a child two
      // "biological" fathers/mothers the moment an ex was still on record.
      if (qualifier === 'biological' && childCoParentId) {
        edges.push(parentEdge(childCoParentId, newId));
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

export function addRelative({ anchorId, relKey, name, given, middle, family, birth_name, gender, birth_date, birth_place, residence, is_deceased, death_date, qualifier = 'biological', childCoParentId = null }) {
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
    birth_name: (birth_name || '').trim() || null,
    gender: gender || meta?.gender || null,
    birth_date: birth_date || null,
    death_date: is_deceased ? death_date || null : null,
    is_living: !is_deceased,
    is_deceased: !!is_deceased,
    is_minor: false,
    birth_place: (birth_place || '').trim() || null,
    residence: (residence || '').trim() || null,
    occupation: null,
    tags: [],
    events: [],
    bio: null,
    photo: null,
    confidence: 'confirmed',
    created_by: 'me',
    visibility: defaultVisibility,
  };
  const edges = edgesFor(relKey, anchorId, id, state, qualifier, childCoParentId);

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

// Record (or clear) marriage details on the partner edge between two people —
// additive metadata the pedigree chart's marriage strip renders; absent
// fields never block anything. Accepts partial dates ('1979' or
// '1979-06-14'), same as birth/death dates everywhere else.
export function updatePartnerMeta(aId, bId, { is_married, marriage_date, marriage_place } = {}) {
  const isPair = (r) =>
    (r.from_person === aId && r.to_person === bId) || (r.from_person === bId && r.to_person === aId);
  const idx = state.relationships.findIndex((r) => r.type === 'partner' && isPair(r));
  if (idx < 0) return { ok: false, reason: 'no-partner-edge' };
  const next = state.relationships.slice();
  next[idx] = {
    ...next[idx],
    // A recorded date/place is itself evidence of a marriage.
    is_married: !!is_married || !!marriage_date || !!marriage_place,
    marriage_date: marriage_date || null,
    marriage_place: marriage_place || null,
  };
  const aPerson = state.people.find((p) => p.id === aId);
  commit(withActivity({ ...state, relationships: next }, {
    type: 'relationship_changed',
    personId: aId,
    personName: aPerson?.display_name ?? '',
    detail: 'marriage details',
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
  const isClearable = (r) => (r.type === 'partner' || r.type === 'parent') && isPair(r);
  // The ids being replaced must be tombstoned, not just filtered out of this
  // array — otherwise a sync merge that lands before this write reaches the
  // server (background poll, or a 409-conflict retry) sees the old edge only
  // on the server side, resurrects it via _mergeByRecency's id union, and
  // normalizeRelationships' first-seen-wins dedup then keeps that resurrected
  // edge over the new one — e.g. an "ex-partner" edit silently reverting back
  // to "partner" a few seconds later (see removeRelationship, which already
  // tombstones for exactly this reason).
  const removedIds = state.relationships.filter(isClearable).map((r) => r.id);
  const cleared = state.relationships.filter((r) => !isClearable(r));
  // Validate the new edge against the cleared set (e.g. cycle check).
  if (kind === 'parent_of' && isAncestorOf(bId, aId, cleared)) return { ok: false, reason: 'cycle' };
  if (kind === 'child_of' && isAncestorOf(aId, bId, cleared)) return { ok: false, reason: 'cycle' };

  let edge;
  if (kind === 'partner') edge = partnerEdge(aId, bId, 'current');
  else if (kind === 'ex_partner') edge = partnerEdge(aId, bId, 'former');
  else if (kind === 'parent_of') edge = parentEdge(aId, bId, qualifier);
  else if (kind === 'child_of') edge = parentEdge(bId, aId, qualifier);
  else return { ok: false, reason: 'unknown-type' };

  const aPerson = state.people.find((p) => p.id === aId);
  const bPerson = state.people.find((p) => p.id === bId);
  const kindLabel = { partner: 'Partner', ex_partner: 'Ex-partner', parent_of: 'Parent', child_of: 'Child' }[kind];
  commit(withActivity(withTombstones({ ...state, relationships: [...cleared, edge] }, 'relationships', removedIds), {
    type: 'relationship_changed',
    personId: aId,
    personName: aPerson?.display_name ?? '',
    detail: `${kindLabel} of ${bPerson?.display_name ?? ''}`,
  }));
  return { ok: true };
}

// Change the qualifier on a parent→child edge (biological / step / adoptive).
export function updateRelationshipQualifier(fromId, toId, qualifier) {
  const parent = state.people.find((p) => p.id === fromId);
  const child = state.people.find((p) => p.id === toId);
  const qualifierLabel = qualifier.charAt(0).toUpperCase() + qualifier.slice(1);
  commit(withActivity({
    ...state,
    relationships: state.relationships.map((r) =>
      r.type === 'parent' && r.from_person === fromId && r.to_person === toId
        ? { ...r, qualifier }
        : r,
    ),
  }, {
    type: 'relationship_changed',
    personId: fromId,
    personName: parent?.display_name ?? '',
    detail: `${qualifierLabel} parent of ${child?.display_name ?? ''}`,
  }));
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
  const fromPerson = state.people.find((p) => p.id === fromId);
  const toPerson = state.people.find((p) => p.id === toId);
  commit(withActivity(withTombstones({
    ...state,
    relationships: state.relationships.filter((r) => !isMatch(r)),
  }, 'relationships', removedIds), {
    type: 'relationship_removed',
    personId: fromId,
    personName: fromPerson?.display_name ?? '',
    detail: toPerson?.display_name ?? '',
  }));
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
    'photo', 'photo_thumb', 'birth_date', 'death_date', 'cause_of_death', 'birth_place', 'residence',
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
  const removedPerson = state.people.find((p) => p.id === id);
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
  // personId here no longer resolves to anyone (they're gone) — the activity
  // feed already falls back to the captured personName for exactly this case
  // (see member_joined), and groupRecapUpdates excludes this type since
  // there's no bubble left to fly to.
  commit(withActivity(next, {
    type: 'person_removed',
    personId: id,
    personName: removedPerson?.display_name ?? '',
  }));
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
// authorId is the real resolved viewer (state.myPersonId — never client-typed
// free text), so editing/removing can later be restricted to "the person who
// actually wrote this, or an admin" (see PersonSheet). `anonymous` only hides
// the identity from the *display* — the author still keeps their own
// edit/remove rights, they just read as "Anonymous" to everyone else.
// Legacy memories (from before this field existed) keep their old free-text
// `author` string for display, but have no authorId — only an admin can
// manage those, since there's no reliable way to attribute them.
export function addMemory(personId, { text, anonymous = false }) {
  const authorId = state.myPersonId || null;
  const memory = {
    id: mid(),
    person_id: personId,
    text: text.trim(),
    authorId,
    anonymous: !!anonymous,
    created_at: new Date().toISOString().slice(0, 10),
    votes: 0,
    youVoted: false,
  };
  const person = state.people.find((p) => p.id === personId);
  commit(withActivity({ ...state, memories: [...state.memories, memory] }, {
    type: 'memory_added',
    personId,
    personName: person?.display_name ?? '',
    ...(anonymous ? { authorName: 'Anonymous' } : {}),
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

export function updateMemory(id, patch) {
  commit({
    ...state,
    memories: state.memories.map((mem) => (mem.id === id ? { ...mem, ...patch } : mem)),
  });
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
// Shape: { id, person_id, title, mime, src, thumb, created_at }
// `thumb` is an optional small JPEG data URL (page-1 preview) generated once
// at upload time for PDFs, so the document row can show a real preview
// without loading pdf.js just to render the list — see PersonSheet's onDocPick.
export function addDocument(personId, { title, mime, src, thumb = null }) {
  const doc = {
    id: docid(),
    person_id: personId,
    title: title.trim(),
    mime,
    src,
    thumb,
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
// Activity/recap detail is deliberately generic ("Health information updated")
// rather than naming the condition — same "which field, not the actual data"
// principle as person_updated, just more warranted here since this is
// sensitive medical information, not an occupation or a tag.
export function addCondition(personId, { name, category, status = 'active', onset_year = null }) {
  const person = state.people.find((p) => p.id === personId);
  commit(withActivity({
    ...state,
    people: state.people.map((p) =>
      p.id === personId
        ? { ...p, conditions: [...(p.conditions || []), { id: cid(), name, category, status, onset_year }] }
        : p,
    ),
  }, { type: 'health_updated', personId, personName: person?.display_name ?? '' }));
}

// Append one AI-suggested life event (from a document extraction) onto a
// person's existing events, non-destructively — the accept side of the
// document-fact review in Enrich. `tag` (e.g. 'military') carries through so
// the timeline can render it distinctly; omitted when the fact isn't tagged.
export function addLifeEvent(personId, { year, title, detail, tag } = {}) {
  const person = state.people.find((p) => p.id === personId);
  const event = { year, title };
  if (detail) event.detail = detail;
  if (tag) event.tag = tag;
  commit(withActivity({
    ...state,
    people: state.people.map((p) =>
      p.id === personId ? { ...p, events: [...(p.events || []), event] } : p,
    ),
  }, { type: 'person_updated', personId, personName: person?.display_name ?? '', detail: 'life events' }));
}

// Append one AI-suggested medal/honour (from a document extraction) onto a
// person's existing military_medals, non-destructively — same shape as
// addLifeEvent, the accept side of the medal review in Enrich.
export function addMedal(personId, { name, detail } = {}) {
  const person = state.people.find((p) => p.id === personId);
  const medal = { name };
  if (detail) medal.detail = detail;
  commit(withActivity({
    ...state,
    people: state.people.map((p) =>
      p.id === personId ? { ...p, military_medals: [...(p.military_medals || []), medal] } : p,
    ),
  }, { type: 'person_updated', personId, personName: person?.display_name ?? '', detail: 'medals' }));
}

// Dismiss one relationship-derived timeline suggestion (Married, Widowed, a
// child's or grandchild's birth — see lib/enrich.js) so Enrich stops
// re-offering it. There's nothing to delete: unlike a document fact, this
// candidate isn't stored anywhere of its own — it's recomputed fresh each
// time from the marriage/birth/death dates already on record — so dismissal
// is just a per-person "don't ask again" key, not silent like a no-op.
export function dismissRelationshipFact(personId, key) {
  const person = state.people.find((p) => p.id === personId);
  if (!person || (person.dismissed_relationship_facts || []).includes(key)) return;
  commit({
    ...state,
    people: state.people.map((p) =>
      p.id === personId
        ? { ...p, dismissed_relationship_facts: [...(p.dismissed_relationship_facts || []), key] }
        : p,
    ),
  });
}

export function removeCondition(personId, conditionId) {
  const person = state.people.find((p) => p.id === personId);
  commit(withActivity({
    ...state,
    people: state.people.map((p) =>
      p.id === personId
        ? { ...p, conditions: (p.conditions || []).filter((c) => c.id !== conditionId) }
        : p,
    ),
  }, { type: 'health_updated', personId, personName: person?.display_name ?? '' }));
}

export function updateCondition(personId, conditionId, fields) {
  const person = state.people.find((p) => p.id === personId);
  commit(withActivity({
    ...state,
    people: state.people.map((p) =>
      p.id === personId
        ? { ...p, conditions: (p.conditions || []).map((c) => (c.id === conditionId ? { ...c, ...fields } : c)) }
        : p,
    ),
  }, { type: 'health_updated', personId, personName: person?.display_name ?? '' }));
}

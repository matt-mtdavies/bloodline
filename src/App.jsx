import { useMemo, useState, useCallback, useRef, useEffect, useSyncExternalStore } from 'react';
import './styles/components.css';
import { DEFAULT_FOCUS } from './data/seed.js';
import Logo from './components/Logo.jsx';
import {
  store,
  syncStore,
  addRelative,
  addRelationship,
  removeRelationship,
  setRelationshipKind,
  mergePeople,
  removePerson,
  updateRelationshipQualifier,
  updatePerson,
  setupTree,
  setPhoto,
  addMemory,
  toggleMemoryVote,
  removeMemory,
  addPhoto,
  setPhotoCaption,
  removePhoto,
  addDocument,
  removeDocument,
  updateDocument,
  addCondition,
  removeCondition,
  updateCondition,
  loadFromServer,
  saveToServer,
  enableServerSync,
  updateFamilyName,
  resetTree,
  importFromGedcom,
  migratePhotosToR2,
  migrateDocsToR2,
  setCurrentUser,
  setMyPerson,
  bindIdentity,
  clearLocalData,
  isNewUrl,
} from './data/store.js';
import { uploadPhoto, generateThumb, uploadDocument } from './lib/image.js';
import { buildGraph, pathBetween, pathBetweenOrdered } from './data/graph.js';
import { findDuplicatePairs } from './lib/duplicates.js';
import { canManageTree } from './lib/visibility.js';
import { useReducedMotion } from './hooks/useReducedMotion.js';
import BubbleTree from './viz/BubbleTree.jsx';
import TopBar from './components/TopBar.jsx';
import FocusNameplate from './components/FocusNameplate.jsx';
import HoverCard from './components/HoverCard.jsx';
import PersonSheet from './components/PersonSheet.jsx';
import AddRelativeSheet from './components/AddRelativeSheet.jsx';
import EditPersonSheet from './components/EditPersonSheet.jsx';
import TimelineEditor from './components/TimelineEditor.jsx';
import MemorySheet from './components/MemorySheet.jsx';
import Lightbox from './components/Lightbox.jsx';
import PhotoCropper from './components/PhotoCropper.jsx';
import AccessibleTree from './components/AccessibleTree.jsx';
import Legend from './components/Legend.jsx';
import IntroHint from './components/IntroHint.jsx';
import Intro from './components/Intro.jsx';
import Onboarding from './components/Onboarding.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import FamilySettings from './components/FamilySettings.jsx';
import UserProfile from './components/UserProfile.jsx';
import MergeWizard from './components/MergeWizard.jsx';
import InviteSheet from './components/InviteSheet.jsx';
import TreeInsights from './components/TreeInsights.jsx';
import DuplicatesSheet from './components/DuplicatesSheet.jsx';
import LineageBanner from './components/LineageBanner.jsx';
import FlightCaption from './components/FlightCaption.jsx';
import TimelineView from './components/TimelineView.jsx';
import ClaimSpot from './components/ClaimSpot.jsx';
import InstallPrompt from './components/InstallPrompt.jsx';
import ActivityFeed from './components/ActivityFeed.jsx';
import GedcomImport from './components/GedcomImport.jsx';
import FamilySearchImport from './components/FamilySearchImport.jsx';
import SaveNudge from './components/SaveNudge.jsx';
import SearchOverlay from './components/SearchOverlay.jsx';

const isDemo = typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('demo');

// Read ?pending_invite and ?invite once at module scope — StrictMode
// double-invokes lazy useState initialisers which would see an empty URL.
const _initialPendingInvite = (() => {
  if (typeof window === 'undefined') return null;
  const token = new URLSearchParams(window.location.search).get('pending_invite');
  if (token) window.history.replaceState({}, '', window.location.pathname);
  return token;
})();

// Capture the invite token from the URL without clearing it — LoginScreen
// also needs it to pre-populate the OTP step for non-logged-in users.
const _initialInviteToken = (() => {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('invite');
})();

// ?person=<id> deep link (from the birthday calendar feed's per-event URL —
// see functions/api/calendar/[token].js). Left in place until the tree has
// actually loaded and we can act on it, unlike the invite/pending_invite
// tokens above which strip immediately — the target person may not exist in
// `data.people` on the very first render.
const _initialPersonParam = (() => {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('person');
})();

export default function App() {
  const data = useSyncExternalStore(store.subscribe, store.getState);
  const syncStatus = useSyncExternalStore(syncStore.subscribe, syncStore.getState);
  const syncError  = useSyncExternalStore(syncStore.subscribe, syncStore.getLastError);
  // Deps are exactly what buildGraph reads — NOT [data]. useSyncExternalStore
  // hands back a brand-new top-level `data` object on every single commit,
  // including ones that only touch activity/_seq/sync-status-adjacent fields
  // (e.g. the 60s background poll, or another editor's memory/photo save).
  // Depending on the whole object rebuilt `graph` — and hence re-ran
  // BubbleTree's `sync(graph)` effect below — on every one of those, which is
  // the actual source of the repeated "saving…/saved" jiggle: even when the
  // structural-change checks inside sync() correctly skip a physics reheat,
  // the bubble-rebuild pass and generation/relCache recompute still run for
  // no reason. Keying on the two arrays buildGraph actually reads means
  // `graph` — and that whole pipeline — only reruns when people or
  // relationships genuinely change reference.
  const graph = useMemo(() => buildGraph(data.people, data.relationships), [data.people, data.relationships]);
  const reducedMotion = useReducedMotion();

  // Possible duplicate people (same name + corroborating evidence) to offer for
  // merging. The cleanup entry point is gated to editors (see canEditTree below).
  const duplicatePairs = useMemo(
    () => findDuplicatePairs(data.people, data.relationships),
    [data.people, data.relationships],
  );

  // 'loading' → 'open' (no auth / bypass) | 'login' (needs sign-in) | 'authed'
  const [authState, setAuthState] = useState((isDemo || isNewUrl) ? 'open' : 'loading');
  // Track whether this session started as an anonymous ?new trial (stays true even
  // after URL is stripped, so the SaveNudge remains visible until they log in).
  const [isAnonymousTrial] = useState(() => isNewUrl);
  const [user, setUser] = useState(null);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  // Whether the signed-in member can edit the tree (drives merge/cleanup tools).
  const canEditTree = !user || ['owner', 'coadmin', 'editor'].includes(data._meta?.role || 'owner');
  // Contributors may add memories & photos but not change structure.
  const canContributeTree = !user || ['owner', 'coadmin', 'editor', 'contributor'].includes(data._meta?.role || 'owner');
  // Hard-to-undo, whole-tree actions (erase, replace-import, merge duplicates,
  // remove a person) are reserved for co-admins/owners — see canManageTree.
  const canManageTreeStructure = !user || canManageTree(data._meta?.role || 'owner');
  const [promptClaim, setPromptClaim] = useState(false); // welcome a member to claim their spot
  const [installEvent, setInstallEvent] = useState(null); // captured beforeinstallprompt
  const [showInstall, setShowInstall] = useState(false);
  // Set when a user with existing tree data accepts an invite — gates the app
  // on the merge wizard until they complete or skip the merge.
  const [pendingInvite, setPendingInvite] = useState(_initialPendingInvite);
  // Pending invites from /api/auth/me for users who already have a non-empty tree.
  // Shown as a dismissable banner so they can manually choose to switch families.
  const [pendingFamilyInvites, setPendingFamilyInvites] = useState([]);

  async function applySession(loginExtras) {
    // OTP login can return pendingInvite when the user already has a tree.
    if (loginExtras?.pendingInvite) {
      setPendingInvite(loginExtras.pendingInvite);
    }
    const r = await fetch('/api/auth/me');
    const u = r.ok ? await r.json() : null;
    if (!u) { setAuthState('login'); return; }
    if (u.bypass) { setAuthState('open'); return; }
    setUser(u);
    setCurrentUser(u);
    // Make sure this device's cached tree belongs to THIS account. If someone
    // else was signed in here before, their tree is dropped now so it can't be
    // shown to — or overwritten by — the person signing in.
    bindIdentity(u.uid);
    enableServerSync();

    // Two invite paths:
    // A) Not logged in → OTP flow → LoginScreen passes joinedViaInvite: true
    // B) Already logged in → ?invite param in URL, OTP never shown → accept here
    const inviteToken = _initialInviteToken;
    const joiningFamily = !!loginExtras?.joinedViaInvite || !!inviteToken;

    if (inviteToken && !loginExtras?.joinedViaInvite) {
      // Logged-in path: process the invite server-side before loading the tree.
      try {
        const ar = await fetch('/api/invite/accept', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: inviteToken }),
        });
        if (ar.ok) {
          const ab = await ar.json().catch(() => ({}));
          if (ab.needsMerge) setPendingInvite(ab.pendingInvite);
        }
      } catch { /* non-fatal — load whatever tree the server has */ }
    }

    const hadTree = await loadFromServer({ forceServerWins: joiningFamily });

    // Path C: auto-detect pending invites from the server even without an invite
    // link in the URL (covers users who received an invite but opened the app
    // directly — e.g. Diane or Amie stuck in a blank tree).
    if (!joiningFamily && !loginExtras?.pendingInvite) {
      const serverPendingInvites = u.pendingInvites || [];
      if (serverPendingInvites.length > 0) {
        const currentPeople = store.getState().people || [];
        if (currentPeople.length === 0) {
          // Empty tree — silently accept the first pending invite and load the family.
          try {
            const firstInvite = serverPendingInvites[0];
            const ar = await fetch('/api/invite/accept', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ token: firstInvite.token }),
            });
            if (ar.ok) {
              const ab = await ar.json().catch(() => ({}));
              if (ab.needsMerge) {
                setPendingInvite(ab.pendingInvite);
              } else {
                await loadFromServer({ forceServerWins: true });
                try {
                  const seen = localStorage.getItem(`bl_claim_seen_${u.uid}`);
                  if (!u.person_id && !seen) setPromptClaim(true);
                } catch { if (!u.person_id) setPromptClaim(true); }
              }
            }
          } catch { /* non-fatal — fall through to whatever tree loaded */ }
        } else {
          // Non-empty tree — surface the invite(s) as a dismissable banner.
          setPendingFamilyInvites(serverPendingInvites);
        }
      }
    }

    // Only seed the server from local when this user genuinely has a local tree
    // to push (e.g. just finished onboarding). Never push an empty tree — that
    // would wipe their cloud data after an identity reset or a failed load.
    if (!hadTree && !joiningFamily && store.getState().people?.length > 0) await saveToServer();
    Promise.all([
      migratePhotosToR2(uploadPhoto).catch(() => ({ total: 0, uploaded: 0, failed: 0 })),
      migrateDocsToR2(uploadDocument).catch(() => ({ total: 0, uploaded: 0, failed: 0 })),
    ]).then(([photos, docs]) => {
      const total = (photos.uploaded || 0) + (docs.uploaded || 0);
      if (!total) return;
      const parts = [];
      if (photos.uploaded) parts.push(`${photos.uploaded} photo${photos.uploaded !== 1 ? 's' : ''}`);
      if (docs.uploaded) parts.push(`${docs.uploaded} document${docs.uploaded !== 1 ? 's' : ''}`);
      setSyncToast(`${parts.join(' and ')} synced to cloud`);
      setTimeout(() => setSyncToast(null), 5000);
    });
    setAuthState('authed');

    // Welcome a member who just joined a family but hasn't yet linked themselves
    // to a person in the tree — prompt them to claim their spot. Gated to the
    // join flow (not onboarding owners) and to a one-time dismissal per user.
    try {
      const seen = localStorage.getItem(`bl_claim_seen_${u.uid}`);
      if (joiningFamily && !u.person_id && !seen) setPromptClaim(true);
    } catch { if (joiningFamily && !u.person_id) setPromptClaim(true); }
  }

  const markClaimSeen = useCallback(() => {
    setPromptClaim(false);
    try { if (user?.uid) localStorage.setItem(`bl_claim_seen_${user.uid}`, '1'); } catch { /* ignore */ }
  }, [user]);

  const handleAcceptFamilyInvite = useCallback(async (invite) => {
    try {
      const ar = await fetch('/api/invite/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: invite.token }),
      });
      if (ar.ok) {
        const ab = await ar.json().catch(() => ({}));
        setPendingFamilyInvites([]);
        if (ab.needsMerge) {
          setPendingInvite(ab.pendingInvite || invite.token);
        } else {
          await loadFromServer({ forceServerWins: true });
        }
      }
    } catch { /* non-fatal */ }
  }, []);

  const handleClaimSpot = useCallback(async (personId, personName) => {
    try {
      await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ person_id: personId, person_name: personName }),
      });
    } catch { /* non-fatal — claim still applies locally */ }
    setUser((u) => ({ ...u, person_id: personId }));
    setCurrentUser({ ...user, person_id: personId });
    setMyPerson(personId); // store → focuses the tree + perspective on them
    // Claiming a spot IS accepting the invite — clear the pending "Invited"
    // banner for everyone else viewing this profile.
    const person = data.people.find((p) => p.id === personId);
    if (person?.invited_at) updatePerson(personId, { joined_at: Date.now() });
    markClaimSeen();
    setTimeout(() => viewApi.current?.refocus(0.6), 120);
  }, [user, markClaimSeen, data.people]);

  // Manual escape hatch for invites accepted before joined_at tracking
  // existed (or accepted on a device this tree never synced with).
  const handleMarkJoined = useCallback((personId) => {
    updatePerson(personId, { joined_at: Date.now() });
  }, []);

  // ── Install as a web app ───────────────────────────────────────────────────
  // Capture the install event (Chrome/Android/desktop) so we can fire the real
  // prompt from our own UI; clear it once installed.
  useEffect(() => {
    const onBIP = (e) => { e.preventDefault(); setInstallEvent(e); };
    const onInstalled = () => { setInstallEvent(null); setShowInstall(false); };
    window.addEventListener('beforeinstallprompt', onBIP);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBIP);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismissInstall = useCallback(() => {
    setShowInstall(false);
    try { localStorage.setItem('bl_install_dismissed', '1'); } catch { /* ignore */ }
  }, []);

  // Offer the install nudge shortly after sign-in — once the claim prompt (if
  // any) has been dealt with, when not already installed and not dismissed.
  useEffect(() => {
    if (authState !== 'authed' || promptClaim) return;
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches
      || window.navigator.standalone;
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent || '');
    let dismissed = false;
    try { dismissed = !!localStorage.getItem('bl_install_dismissed'); } catch { /* ignore */ }
    if (standalone || dismissed || (!installEvent && !isIOS)) return;
    const t = setTimeout(() => setShowInstall(true), 1600);
    return () => clearTimeout(t);
  }, [authState, promptClaim, installEvent]);

  useEffect(() => {
    if (isDemo || isNewUrl) return;
    // 12-second timeout: if the auth Worker cold-starts slowly on mobile the
    // fetch can hang indefinitely.  Fall back to 'open' so the user sees the app.
    const timer = setTimeout(() => setAuthState('open'), 12000);
    applySession()
      .catch(() => setAuthState('open'))
      .finally(() => clearTimeout(timer));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for background sync events from the store.
  useEffect(() => {
    const showToast = (msg) => { setSyncToast(msg); setTimeout(() => setSyncToast(null), 5000); };
    const onMerge = () => showToast('Tree updated by another editor — changes merged');
    const onPoll  = () => showToast('Tree refreshed with new changes');
    window.addEventListener('bloodline:tree-conflict-merged', onMerge);
    window.addEventListener('bloodline:tree-polled', onPoll);
    return () => {
      window.removeEventListener('bloodline:tree-conflict-merged', onMerge);
      window.removeEventListener('bloodline:tree-polled', onPoll);
    };
  }, []);

  // Onboarding gate: new users see intro → questionnaire before the tree.
  const [introSeen, setIntroSeen] = useState(false);

  const focusDefault = data.myPersonId || DEFAULT_FOCUS;
  const [activeId, setActiveId] = useState(focusDefault);
  const [expanded, setExpanded] = useState(() => new Set([focusDefault]));

  // Sync active person after onboarding completes (myPersonId appears in store).
  useEffect(() => {
    if (data.myPersonId && data.myPersonId !== activeId) {
      setActiveId(data.myPersonId);
      setExpanded(new Set([data.myPersonId]));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.myPersonId]);
  const [openId, setOpenId] = useState(null); // person card
  const [addAnchorId, setAddAnchorId] = useState(null); // add-relative sheet
  const [editId, setEditId] = useState(null); // edit sheet
  const [timelineId, setTimelineId] = useState(null); // timeline editor
  const [memoryId, setMemoryId] = useState(null); // add-memory sheet
  const [lightbox, setLightbox] = useState(null); // { personId, index }
  const [crop, setCrop] = useState(null); // { id, url } photo cropper
  const [view, setView] = useState('bubbles');
  const [legendOpen, setLegendOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mergeParents, setMergeParents] = useState(true);
  const [bloodlineOnly, setBloodlineOnly] = useState(false);
  const [lineageMode, setLineageMode] = useState(false);
  const [lineagePath, setLineagePath] = useState(null); // Set<id> | null
  const [lineageOrder, setLineageOrder] = useState(null); // ordered [fromId,…,toId] | null
  const [cameraFree, setCameraFree] = useState(false); // user has panned/zoomed away
  const [storageWarning, setStorageWarning] = useState(false);
  const [syncToast, setSyncToast] = useState(null);
  const [layout, setLayout] = useState('organic'); // 'organic' | 'weighted' | 'hybrid'
  const [timeMode, setTimeMode] = useState(false);
  const [timeYear, setTimeYear] = useState(new Date().getFullYear());
  const [timePlaying, setTimePlaying] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [browse, setBrowse] = useState(false); // deselected free-look mode
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [lifeJourneyId, setLifeJourneyId] = useState(null);
  const playRef = useRef(null);
  const [docViewer, setDocViewer] = useState(null); // { title, src, mime }
  const [invitePersonId, setInvitePersonId] = useState(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [lastReadAt, setLastReadAt] = useState(null); // null = never opened = all unread
  const [gedcomOpen, setGedcomOpen] = useState(false);
  const [fsImportOpen, setFsImportOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Search's flyover caption — { order: [fromId,…,toId], upTo: number } while a
  // flight is in progress, else null. upTo advances via the flight's onSegment
  // callback so the relationship chain fills in hop by hop as the camera flies.
  const [flightCaption, setFlightCaption] = useState(null);
  // Desktop hover preview — id of the bubble the pointer is resting over
  // (BubbleTree debounces this itself; see onHover).
  const [hoveredId, setHoveredId] = useState(null);
  const viewApi = useRef(null);

  // Notify the user if a commit couldn't persist (localStorage full).
  useEffect(() => {
    const handler = () => {
      setStorageWarning(true);
      setTimeout(() => setStorageWarning(false), 6000);
    };
    window.addEventListener('bloodline:storage-full', handler);
    return () => window.removeEventListener('bloodline:storage-full', handler);
  }, []);

  // Family stats for the header: people count, top surnames, year span, photos, memories.
  const familyStats = useMemo(() => {
    const freq = new Map();
    let yearMin = Infinity, yearMax = -Infinity;
    let oldestPerson = null, youngestPerson = null;
    let withPhoto = 0, withBio = 0, withBirthDate = 0;
    for (const p of graph.people) {
      const surname = p.display_name?.trim().split(/\s+/).slice(-1)[0];
      if (surname) freq.set(surname, (freq.get(surname) ?? 0) + 1);
      const by = p.birth_date ? parseInt(p.birth_date) : null;
      if (by && by > 1000) {
        withBirthDate++;
        if (by < yearMin) { yearMin = by; oldestPerson = p; }
        if (by > yearMax) { yearMax = by; youngestPerson = p; }
      }
      if (p.photo) withPhoto++;
      if (p.bio && p.bio.trim()) withBio++;
    }
    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
    const topTwo = sorted.slice(0, 2).map(([s]) => s);
    const extraCount = Math.max(0, sorted.length - 2);
    const surnames = topTwo.join(', ') + (extraCount > 0 ? ` +${extraCount}` : '');
    const yearSpan = isFinite(yearMin)
      ? yearMin === yearMax ? `${yearMin}` : `${yearMin}–${yearMax}`
      : null;
    return {
      people: graph.people.length,
      surnames,
      yearSpan,
      photos: data.photos.length,
      memories: data.memories.length,
      // Detail fields for the stats popover
      surnameList: sorted.map(([name, count]) => ({ name, count })),
      yearMin: isFinite(yearMin) ? yearMin : null,
      yearMax: isFinite(yearMax) ? yearMax : null,
      oldestName: oldestPerson?.display_name ?? null,
      youngestName: youngestPerson?.display_name ?? null,
      withPhoto,
      withBio,
      withBirthDate,
    };
  }, [graph, data.photos.length, data.memories.length]);

  // Unread activity count — null lastReadAt means never opened, so all events are "new".
  const unreadCount = useMemo(() => {
    const acts = data.activity ?? [];
    if (!acts.length) return 0;
    if (lastReadAt === null) return acts.length;
    return acts.filter((a) => new Date(a.created_at).getTime() > lastReadAt).length;
  }, [data.activity, lastReadAt]);

  // Set of people alive at the selected year (null = show all).
  const aliveAtYear = useMemo(() => {
    if (!timeMode) return null;
    const alive = new Set();
    for (const p of data.people) {
      const born = p.birth_date ? parseInt(p.birth_date) : null;
      const died = p.death_date ? parseInt(p.death_date) : null;
      if ((born == null || born <= timeYear) && (died == null || died >= timeYear)) {
        alive.add(p.id);
      }
    }
    return alive;
  }, [data.people, timeMode, timeYear]);

  // Focus Family: active person's nuclear family + siblings + grandchildren.
  const focusFamilyIds = useMemo(() => {
    if (!focusMode) return null;
    const ids = new Set([activeId]);
    for (const p of graph.parents(activeId)) ids.add(p.id);
    for (const p of graph.partners(activeId)) ids.add(p.id);
    for (const s of graph.siblings(activeId)) ids.add(s.id);
    for (const c of graph.children(activeId)) {
      ids.add(c.id);
      for (const gc of graph.children(c.id)) ids.add(gc.id);
    }
    return ids;
  }, [focusMode, activeId, graph]);

  // Same neighbour-expansion as visibleIds below, but deliberately NOT
  // filtered by aliveAtYear/timeYear — this scopes the time slider's own
  // range (below), and if it depended on the live time filter the slider's
  // bounds would shift under the user's thumb while they're scrubbing it.
  // expanded only changes via explicit taps, so this — and the year range
  // built from it — stays stable through an entire play/scrub session.
  const structuralVisibleIds = useMemo(() => {
    const vis = new Set();
    for (const id of expanded) {
      vis.add(id);
      for (const x of graph.parents(id)) {
        if (bloodlineOnly && x.qualifier === 'step') continue;
        vis.add(x.id);
      }
      for (const x of graph.children(id)) {
        if (bloodlineOnly && x.qualifier === 'step') continue;
        vis.add(x.id);
      }
      if (!bloodlineOnly) {
        for (const x of graph.partners(id)) vis.add(x.id);
      }
      for (const x of graph.siblings(id)) {
        if (bloodlineOnly && x.kind === 'step') continue;
        vis.add(x.id);
      }
    }
    if (focusFamilyIds) {
      for (const id of [...vis]) {
        if (!focusFamilyIds.has(id)) vis.delete(id);
      }
    }
    return vis;
  }, [graph, expanded, focusFamilyIds, bloodlineOnly]);

  // Time slider: scoped to whoever's actually on screen right now (5 years
  // before the earliest birth among them), not the whole tree — with 160-odd
  // years of family history, starting the range at the tree's overall
  // earliest birth meant playback (or just the slider itself) dragged
  // through decades before anyone in the current view even existed. Falls
  // back to the whole tree only if nothing currently visible has a known
  // birth date yet (e.g. before anything's been expanded).
  const yearRange = useMemo(() => {
    const thisYear = new Date().getFullYear();
    let min = thisYear;
    let sawBirth = false;
    for (const id of structuralVisibleIds) {
      const by = graph.byId.get(id)?.birth_date ? parseInt(graph.byId.get(id).birth_date) : null;
      if (by && by < min) { min = by; sawBirth = true; }
    }
    if (!sawBirth) {
      for (const p of data.people) {
        const by = p.birth_date ? parseInt(p.birth_date) : null;
        if (by && by < min) { min = by; sawBirth = true; }
      }
    }
    return { min: min - 5, max: thisYear };
  }, [structuralVisibleIds, graph, data.people]);

  const visibleIds = useMemo(() => {
    const alive = (id) => !aliveAtYear || aliveAtYear.has(id);
    const vis = new Set();
    for (const id of expanded) {
      if (!alive(id)) continue;
      vis.add(id);
      for (const x of graph.parents(id)) {
        if (bloodlineOnly && x.qualifier === 'step') continue;
        if (alive(x.id)) vis.add(x.id);
      }
      for (const x of graph.children(id)) {
        if (bloodlineOnly && x.qualifier === 'step') continue;
        if (alive(x.id)) vis.add(x.id);
      }
      if (!bloodlineOnly) {
        for (const x of graph.partners(id)) { if (alive(x.id)) vis.add(x.id); }
      }
      for (const x of graph.siblings(id)) {
        if (bloodlineOnly && x.kind === 'step') continue;
        if (alive(x.id)) vis.add(x.id);
      }
    }
    // Focus mode: collapse everyone outside the nuclear family
    if (focusFamilyIds) {
      for (const id of [...vis]) {
        if (!focusFamilyIds.has(id)) vis.delete(id);
      }
    }
    return vis;
  }, [graph, expanded, aliveAtYear, focusFamilyIds, bloodlineOnly]);

  // Play animation: life journey = 350 ms/step (cinematic), time mode = 600 ms/step
  // — slowed so each birth's light-arrival animation gets room to land and be felt.
  useEffect(() => {
    clearInterval(playRef.current);
    if (!timePlaying) return;
    const interval = lifeJourneyId ? 350 : 600;
    playRef.current = setInterval(() => {
      setTimeYear((y) => {
        if (y >= yearRange.max) { setTimePlaying(false); return y; }
        return y + 1;
      });
    }, interval);
    return () => clearInterval(playRef.current);
  }, [timePlaying, yearRange.max, lifeJourneyId]);

  const allExpanded = expanded.size >= graph.people.length && graph.people.length > 0;
  // Show the collapse button whenever MORE than one person is expanded (not just all-or-nothing).
  const canCollapse = expanded.size > 1;
  const toggleExpandAll = useCallback(() => {
    if (canCollapse) {
      setExpanded(new Set([activeId]));
    } else {
      setExpanded(new Set(graph.people.map((p) => p.id)));
    }
  }, [canCollapse, activeId, graph]);

  const activateNormal = useCallback((id) => {
    setActiveId(id);
    setExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    setLineagePath(null);
    setLineageOrder(null);
    // Focus mode stays on across navigation — focusFamilyIds is derived from
    // activeId, so selecting someone else re-centres the nuclear-family view
    // on them instead of dropping back to the whole tree.
    setLifeJourneyId(null);
  }, []);

  // All direct neighbours of a person id (using the graph's relation methods).
  const graphNeighbourIds = useCallback((id) => [
    ...graph.parents(id).map((x) => x.id),
    ...graph.children(id).map((x) => x.id),
    ...graph.partners(id).map((x) => x.id),
    ...graph.siblings(id).map((x) => x.id),
  ], [graph]);

  // Collapse a branch: remove collapseId from expanded, then cascade-remove any
  // expanded node that is no longer reachable from activeId without passing through
  // collapseId (so orphaned sub-branches vanish automatically).
  const collapseNode = useCallback((collapseId) => {
    if (collapseId === activeId) return;
    setExpanded((prev) => {
      // Build the full visible neighbourhood of the current expanded set.
      const currentVisible = new Set(prev);
      for (const id of prev) {
        for (const nid of graphNeighbourIds(id)) currentVisible.add(nid);
      }
      // BFS from activeId through currentVisible, treating collapseId as a wall.
      const reachable = new Set([activeId]);
      const queue = [activeId];
      while (queue.length > 0) {
        const cur = queue.shift();
        if (cur === collapseId) continue;
        for (const nid of graphNeighbourIds(cur)) {
          if (!reachable.has(nid) && currentVisible.has(nid) && nid !== collapseId) {
            reachable.add(nid);
            queue.push(nid);
          }
        }
      }
      // Keep only expanded nodes still reachable (and always keep activeId).
      const next = new Set([activeId]);
      for (const id of prev) {
        if (id !== collapseId && reachable.has(id)) next.add(id);
      }
      return next;
    });
  }, [activeId, graphNeighbourIds]);

  const lifeJourneyPerson = lifeJourneyId ? graph.byId.get(lifeJourneyId) : null;

  const startLifeJourney = useCallback((id) => {
    const p = graph.byId.get(id);
    const birthYear = p?.birth_date ? parseInt(p.birth_date) : yearRange.min;
    const startYear = Math.max(birthYear, yearRange.min);
    setLifeJourneyId(id);
    setActiveId(id);
    setExpanded((prev) => new Set(prev).add(id));
    setTimeMode(true);
    setFocusMode(true);
    setTimeYear(startYear);
    setTimePlaying(true);
    setOpenId(null);
    // Re-enter follow mode and warm the sim so the focus family spreads to fill screen.
    setTimeout(() => viewApi.current?.refocus(0.5), 100);
  }, [graph, yearRange.min]);

  const activate = useCallback(
    (id) => {
      setBrowse(false); // selecting anyone always leaves browse mode
      if (lineageMode) {
        if (id === activeId) {
          setLineagePath(null);
          setLineageOrder(null);
        } else {
          const ordered = pathBetweenOrdered(graph, activeId, id);
          setLineagePath(ordered ? new Set(ordered) : null);
          setLineageOrder(ordered);
        }
      } else {
        activateNormal(id);
      }
    },
    [lineageMode, activeId, graph, activateNormal],
  );

  // Browse mode: tap empty canvas to deselect — every bubble returns to full
  // brightness so you can pan through and study the whole tree. Any selection,
  // recentre, or mode switch exits it.
  const deselect = useCallback(() => {
    setBrowse(true);
    viewApi.current?.enterFree();
  }, []);
  useEffect(() => { setBrowse(false); }, [layout, focusMode, lineageMode, timeMode]);

  const toggleLineage = useCallback(() => {
    setLineageMode((on) => {
      if (on) { setLineagePath(null); setLineageOrder(null); }
      return !on;
    });
  }, []);

  const openPerson = useCallback((id) => {
    viewApi.current?.unpin();
    viewApi.current?.pin(id);
    viewApi.current?.enterFollow(); // if they'd roamed, re-frame so the card has room
    setOpenId(id);
  }, []);

  // Resolve the ?person= deep link once the tree has actually loaded — a
  // birthday calendar notification should drop the tapper straight onto
  // that person's profile instead of the default focus person.
  const personDeepLinkHandled = useRef(false);
  useEffect(() => {
    if (personDeepLinkHandled.current || !_initialPersonParam) return;
    if (!data.people?.length) return;
    personDeepLinkHandled.current = true;
    if (data.people.some((p) => p.id === _initialPersonParam)) {
      setActiveId(_initialPersonParam);
      setExpanded((prev) => new Set(prev).add(_initialPersonParam));
      openPerson(_initialPersonParam);
    }
    window.history.replaceState({}, '', window.location.pathname);
  }, [data.people, openPerson]);

  // Search's flyover: instead of jump-cutting to the result, reveal every hop
  // on the path from the VIEWER'S OWN seat (not wherever the camera happens to
  // be) and fly the camera along it (see BubbleTree's flyAlong), with the
  // route lighting up as it passes and a caption filling in the relationship
  // chain. Falls back to the old instant jump when there's no path, the hop
  // is trivial, or motion is reduced.
  const flyToSearchResult = useCallback((targetId) => {
    setSearchOpen(false);
    const originId = data.myPersonId || DEFAULT_FOCUS;
    const ordered = pathBetweenOrdered(graph, originId, targetId);
    const hops = ordered ? ordered.length - 1 : 0;
    if (!ordered || reducedMotion || hops <= 1) {
      activateNormal(targetId);
      return;
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of ordered) next.add(id);
      return next;
    });
    setLineageMode(false);
    setLineagePath(null);
    setLineageOrder(null);
    setFocusMode(false);
    setLifeJourneyId(null);
    setBrowse(false);
    setFlightCaption({ order: ordered, upTo: 0 });
    viewApi.current?.flyAlong(ordered, {
      onSegment: (id) => {
        const idx = ordered.indexOf(id);
        setFlightCaption((c) => (c ? { ...c, upTo: idx } : c));
      },
      onLand: () => {
        setActiveId(targetId);
        // Let the fully-resolved chain sit on screen for a beat — it's the
        // payoff of the whole flight — instead of wiping it the instant the
        // camera settles.
        setTimeout(() => setFlightCaption(null), 2200);
      },
    });
  }, [graph, data.myPersonId, reducedMotion, activateNormal]);

  const closePerson = useCallback(() => {
    viewApi.current?.unpin();
    setOpenId(null);
    deselect(); // returning to the tree from a profile lands in browse mode
  }, [deselect]);

  // Add a relative, then fly to the new person so they greet you on the tree.
  const handleAdd = useCallback(
    (fields) => {
      const newId = addRelative({ anchorId: addAnchorId, ...fields });
      if (!newId) {
        // Blocked by a constraint — tell the user why instead of silently failing.
        const anchor = graph.byId.get(addAnchorId);
        const first = anchor?.display_name?.split(/\s+/)[0] || 'They';
        const role = fields.relKey === 'mother' ? 'mother' : fields.relKey === 'father' ? 'father' : 'parent';
        setSyncToast(`${first} already has a biological ${role}. Add them as a step or adoptive ${role} instead, or remove the existing one first.`);
        setTimeout(() => setSyncToast(null), 6000);
        return;
      }
      setAddAnchorId(null);
      viewApi.current?.unpin();
      setOpenId(null);
      setExpanded((prev) => new Set(prev).add(addAnchorId).add(newId));
      setActiveId(newId);
    },
    [addAnchorId, graph],
  );

  // Link two existing people without creating a new person.
  // relKey is from AddRelativeSheet; qualifier is 'biological'|'step'|'adoptive'.
  // Human-readable feedback when a relationship change is blocked.
  const notifyRelFail = useCallback((reason) => {
    const messages = {
      'bio-parent-full': 'They already have a biological parent of that gender. Use a step or adoptive link, or remove the existing one first.',
      cycle: "That would make someone their own ancestor — relationships can't loop back on themselves.",
      duplicate: 'They’re already linked that way.',
      self: "A person can't be related to themselves.",
    };
    setSyncToast(messages[reason] || "That relationship change isn't possible.");
    setTimeout(() => setSyncToast(null), 6000);
  }, []);

  const handleLinkExisting = useCallback(
    (existingId, relKey, qualifier = 'biological') => {
      // setRelationshipKind reassigns atomically (clears any existing direct edge
      // first, then validates + sets the new one) so a wrong link can be fixed in
      // one step without leaving a contradiction.
      let res = { ok: true };
      if (relKey === 'partner') res = setRelationshipKind(addAnchorId, existingId, 'partner');
      else if (relKey === 'ex_partner') res = setRelationshipKind(addAnchorId, existingId, 'ex_partner');
      else if (relKey === 'mother' || relKey === 'father') res = setRelationshipKind(addAnchorId, existingId, 'child_of', qualifier);
      else if (relKey === 'son' || relKey === 'daughter') res = setRelationshipKind(addAnchorId, existingId, 'parent_of', qualifier);
      else if (relKey === 'brother' || relKey === 'sister') {
        // Give the existing person the same parents as the anchor.
        const anchorParents = data.relationships
          .filter((r) => r.type === 'parent' && r.to_person === addAnchorId)
          .map((r) => r.from_person);
        for (const parentId of anchorParents) {
          const r = addRelationship(parentId, existingId, 'parent');
          if (!r.ok) res = r;
        }
      }
      if (!res.ok) { notifyRelFail(res.reason); return; }
      setAddAnchorId(null);
      viewApi.current?.unpin();
      setExpanded((prev) => new Set(prev).add(addAnchorId).add(existingId));
      setActiveId(existingId);
    },
    [addAnchorId, data.relationships, notifyRelFail],
  );

  // Change the relationship between the focused person and one of their relatives
  // (from the profile's relationship menu). kind: partner|ex_partner|parent_of|child_of.
  const handleChangeRelType = useCallback((personId, otherId, kind) => {
    const res = setRelationshipKind(personId, otherId, kind);
    if (!res.ok) notifyRelFail(res.reason);
  }, [notifyRelFail]);

  const handleSave = useCallback(
    (fields) => {
      const person = graph.byId.get(editId);
      const parts = [];
      if ('birth_date' in fields && fields.birth_date !== person?.birth_date) parts.push('birthdate');
      if ('birth_place' in fields && fields.birth_place !== person?.birth_place) parts.push('birthplace');
      if ('death_date' in fields && fields.death_date !== person?.death_date) parts.push('death date');
      if ('bio' in fields && fields.bio !== person?.bio) parts.push('biography');
      if ('occupation' in fields && fields.occupation !== person?.occupation) parts.push('occupation');
      if ('residence' in fields && fields.residence !== person?.residence) parts.push('location');
      if ('display_name' in fields && fields.display_name !== person?.display_name) parts.push('name');
      if ('tags' in fields) parts.push('tags');
      const detail = parts.length ? parts.join(' and ') : null;
      const actEvent = detail
        ? { type: 'person_updated', personId: editId, personName: person?.display_name ?? '', detail }
        : null;
      updatePerson(editId, fields, actEvent);
      setEditId(null);
    },
    [editId, graph],
  );

  const handleRemovePerson = useCallback(() => {
    const id = editId;
    setEditId(null);
    setOpenId(null);
    removePerson(id);
    if (activeId === id) {
      const next = data.myPersonId || data.people.find((p) => p.id !== id)?.id || DEFAULT_FOCUS;
      setActiveId(next);
      setExpanded(new Set([next]));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, activeId, data.myPersonId, data.people]);

  const handleSaveTimeline = useCallback(
    (events) => {
      const person = graph.byId.get(timelineId);
      updatePerson(timelineId, { events }, {
        type: 'person_updated',
        personId: timelineId,
        personName: person?.display_name ?? '',
        detail: 'life events',
      });
      setTimelineId(null);
    },
    [timelineId, graph],
  );

  const handleAddMemory = useCallback(
    (fields) => {
      addMemory(memoryId, fields);
      setMemoryId(null);
    },
    [memoryId],
  );

  // Picking a photo opens the cropper; confirming there saves the framed crop.
  const handlePhoto = useCallback((id, file) => {
    setCrop({ id, url: URL.createObjectURL(file) });
  }, []);

  const closeCrop = useCallback(() => {
    setCrop((c) => {
      if (c) URL.revokeObjectURL(c.url);
      return null;
    });
  }, []);

  // notify=true emails the invite; notify=false just mints a share link (email
  // optional). Returns { inviteUrl, emailSent, emailError } for the sheet.
  const handleSendInvite = useCallback(async (personId, { email = '', role, notify = true } = {}) => {
    const res = await fetch('/api/invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, role, notify }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Invite failed');
    }
    const body = await res.json().catch(() => ({}));
    // Record invited_email so we can match them to their account on login
    // (perspective labels). Only when we actually have an email and can edit.
    const canEdit = ['owner', 'coadmin', 'editor'].includes(data._meta?.role || 'owner');
    if (canEdit && email.trim()) {
      updatePerson(personId, { invited_email: email.trim().toLowerCase(), invited_at: Date.now() });
    }
    return body;
  }, [data._meta?.role]);

  const activePerson = graph.byId.get(activeId);

  // Whether ANY sheet/modal/overlay is currently on screen — used to hide the
  // canvas-anchored overlays (hover card, focus nameplate, recentre button)
  // that would otherwise float on top of whatever just opened. Kept as one
  // flag rather than repeating an ad-hoc subset of these checks at each call
  // site: that's exactly how the hover card ended up missing settingsOpen
  // (and a dozen others) — every new sheet added over time needs to be
  // remembered at every gate, and it only takes missing one.
  const anyOverlayOpen = !!(
    openId || addAnchorId || editId || timelineId || memoryId || lightbox || crop ||
    legendOpen || settingsOpen || insightsOpen || timelineOpen || docViewer ||
    invitePersonId || activityOpen || gedcomOpen || fsImportOpen || profileOpen ||
    searchOpen || duplicatesOpen || promptClaim || showInstall
  );

  // Photo of the person the logged-in user has claimed as their own bubble.
  const userPhoto = useMemo(() => {
    if (!user?.person_id) return null;
    const p = data.people.find((x) => x.id === user.person_id);
    return p?.photo || null;
  }, [data.people, user?.person_id]);

  // Auth gate. 'open' = no auth configured or ?demo — go straight to app.
  if (authState === 'loading') return <AppLoadingScreen />;
  if (authState === 'login') {
    return (
      <LoginScreen
        onAuthSuccess={(extras) => applySession(extras).catch(() => setAuthState('open'))}
      />
    );
  }

  // Merge gate: user is authenticated but needs to reconcile their tree before
  // the app loads. Once complete, reload from the server and clear the gate.
  if (pendingInvite && authState === 'authed') {
    return (
      <MergeWizard
        inviteToken={pendingInvite}
        myTree={data}
        onComplete={async () => {
          setPendingInvite(null);
          await loadFromServer();
        }}
      />
    );
  }

  // Show onboarding for brand-new users (no completed onboarding in store).
  if (!data.hasCompletedOnboarding) {
    if (!introSeen) {
      return <Intro onBegin={() => setIntroSeen(true)} />;
    }
    return (
      <Onboarding
        onComplete={(fields) => {
          setupTree(fields);
          // Strip ?new from URL so refreshing loads their tree normally from localStorage.
          if (isNewUrl) window.history.replaceState(null, '', '/');
        }}
      />
    );
  }

  return (
    <div className="app">
      <TopBar
        familyName={data.familyName || DEFAULT_FOCUS}
        stats={familyStats}
        view={view}
        syncStatus={syncStatus}
        syncError={syncError}
        onRetrySync={() => saveToServer()}
        onToggleView={() => setView((v) => (v === 'bubbles' ? 'list' : 'bubbles'))}
        onOpenLegend={() => setLegendOpen(true)}
        legendActive={bloodlineOnly}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenActivity={() => { setActivityOpen(true); setLastReadAt(Date.now()); }}
        activityCount={unreadCount}
        user={user}
        userPhoto={userPhoto}
        onOpenProfile={user ? () => setProfileOpen(true) : null}
        onSearch={() => setSearchOpen(true)}
        onOpenInsights={() => setInsightsOpen(true)}
        onOpenTimeline={() => setTimelineOpen(true)}
        duplicateCount={canManageTreeStructure ? duplicatePairs.length : 0}
        onOpenDuplicates={canManageTreeStructure && duplicatePairs.length ? () => setDuplicatesOpen(true) : null}
        storageWarning={storageWarning}
        syncToast={syncToast}
        onDismissSyncToast={() => setSyncToast(null)}
      />

      {view === 'bubbles' ? (
        <>
          <BubbleTree
            graph={graph}
            activeId={activeId}
            visibleIds={visibleIds}
            expandedIds={expanded}
            onActivate={activate}
            onCollapse={collapseNode}
            onOpenPerson={lineageMode ? null : openPerson}
            reducedMotion={reducedMotion}
            layout={layout}
            mergeParents={mergeParents}
            lineagePath={lineagePath}
            lineageEndId={lineageOrder ? lineageOrder[lineageOrder.length - 1] : null}
            timeMode={timeMode}
            timeYear={timeYear}
            focusMode={focusMode}
            browse={browse}
            onDeselect={deselect}
            onCameraMode={setCameraFree}
            onHover={setHoveredId}
            apiRef={viewApi}
          />
          <FocusNameplate
            person={activePerson}
            getPos={() => viewApi.current?.getScreenPos(activeId)}
            hidden={anyOverlayOpen || browse || layout === 'chart'}
          />
          <HoverCard
            graph={graph}
            personId={!anyOverlayOpen && layout !== 'chart' ? hoveredId : null}
            viewerId={data.myPersonId || DEFAULT_FOCUS}
            getPos={() => viewApi.current?.getScreenPos(hoveredId)}
          />
          {/* Bottom bar: single floating dock */}
          <div className="bottom-bar">
            <div className="bottom-dock">
              {/* Browse — the "get me unstuck" control, moved down from its old
                  floating spot. recenter() clears stuck iOS multi-touch/gesture
                  state (phantom pointers left when iOS skips pointerup for a
                  finger) — the actual fix behind "the crosshair breaks focus
                  mode" — so it must always run first, unconditionally, no
                  matter which mode the tree is currently in. */}
              <button
                className={`dock-btn browse-btn${browse ? ' browse-btn--on' : ''}`}
                onClick={() => {
                  viewApi.current?.recenter();
                  setFocusMode(false);
                  setLineageMode(false);
                  setLineagePath(null);
                  setLineageOrder(null);
                  setTimeMode(false);
                  setTimePlaying(false);
                  setLifeJourneyId(null);
                  // Deferred so it lands after the effect that clears `browse`
                  // whenever focus/lineage/time mode changes has settled,
                  // instead of racing it back off in the same tick.
                  setTimeout(() => deselect(), 60);
                }}
                aria-pressed={browse}
                aria-label="Browse — deselect and reset the view"
              >
                <BrowseIcon />
                <span className="dock-btn__label">Browse</span>
              </button>
              <span className="dock-divider" aria-hidden="true" />
              {/* Focus Family */}
              <button
                className={`dock-btn focus-btn${focusMode ? ' focus-btn--on' : ''}`}
                onClick={() => {
                  const next = !focusMode;
                  setFocusMode(next);
                  if (next) setTimeout(() => viewApi.current?.refocus(0.5), 100);
                }}
                aria-pressed={focusMode}
                aria-label={focusMode ? 'Exit focus family view' : 'Focus on this family'}
              >
                <FocusIcon />
                <span className="dock-btn__label">{focusMode ? 'Exit Focus' : 'Focus'}</span>
              </button>
              <span className="dock-divider" aria-hidden="true" />
              {/* Time — wrapper is position:relative so slider/card float above */}
              <div className={`time-bar${timeMode ? ' time-bar--on' : ''}`}>
                {timeMode && lifeJourneyPerson && (() => {
                  const ev = lifeJourneyPerson.events?.find(
                    (e) => Math.abs(parseInt(e.year) - timeYear) <= 1,
                  );
                  return (
                    <div className={`life-event-card${ev ? ' life-event-card--visible' : ''}`}>
                      <div className="life-event-card__meta">
                        <span className="life-event-card__who">{lifeJourneyPerson.display_name.split(' ')[0]}</span>
                        <span className="life-event-card__year">{timeYear}</span>
                      </div>
                      <p className="life-event-card__title">{ev?.title ?? '\u00a0'}</p>
                    </div>
                  );
                })()}
                {timeMode && (
                  <div className="time-slider-wrap">
                    <button
                      className={`time-play${timePlaying ? ' time-play--on' : ''}`}
                      onClick={() => {
                        if (!timePlaying && timeYear >= yearRange.max) {
                          setTimeYear(lifeJourneyPerson?.birth_date ? parseInt(lifeJourneyPerson.birth_date) : yearRange.min);
                        }
                        setTimePlaying((p) => !p);
                      }}
                      aria-label={timePlaying ? 'Pause' : 'Play family history'}
                    >
                      {timePlaying ? <PauseIcon /> : <PlayIcon />}
                    </button>
                    <span className="time-slider__label">{yearRange.min}</span>
                    {lifeJourneyPerson?.events?.length > 0 && (
                      <datalist id="life-events-ticks">
                        {lifeJourneyPerson.events.map((ev) => (
                          <option key={ev.year} value={parseInt(ev.year)} />
                        ))}
                      </datalist>
                    )}
                    <input
                      type="range"
                      className="time-slider"
                      list={lifeJourneyPerson?.events?.length ? 'life-events-ticks' : undefined}
                      min={yearRange.min}
                      max={yearRange.max}
                      value={timeYear}
                      onChange={(e) => { setTimePlaying(false); setTimeYear(Number(e.target.value)); }}
                      aria-label="Select year"
                    />
                    <span className="time-slider__label">{yearRange.max}</span>
                  </div>
                )}
                <button
                  className={`dock-btn time-toggle${timeMode ? ' time-toggle--on' : ''}`}
                  onClick={() => {
                    if (!timeMode) { setTimeYear(new Date().getFullYear()); setTimePlaying(false); }
                    else { setTimePlaying(false); setLifeJourneyId(null); }
                    setTimeMode((m) => !m);
                  }}
                  aria-pressed={timeMode}
                  aria-label={timeMode ? `Time view: ${timeYear}` : 'View family over time'}
                >
                  <ClockIcon />
                  <span className="dock-btn__label">
                    {timeMode ? (
                      lifeJourneyPerson ? (
                        <>{lifeJourneyPerson.display_name.split(' ')[0]} · {timeYear}</>
                      ) : (
                        timeYear
                      )
                    ) : 'Time'}
                  </span>
                </button>
              </div>
              <span className="dock-divider" aria-hidden="true" />
              {/* Lineage */}
              <button
                className={`dock-btn lineage-btn${lineageMode ? ' lineage-btn--on' : ''}`}
                onClick={toggleLineage}
                aria-pressed={lineageMode}
                aria-label={lineageMode ? 'Exit lineage mode' : 'Trace a family line'}
              >
                <LineageIcon />
                <span className="dock-btn__label">
                  {lineageMode
                    ? lineagePath
                      ? `${[...lineagePath].length} links`
                      : 'Tap…'
                    : 'Lineage'}
                </span>
              </button>
              <span className="dock-divider" aria-hidden="true" />
              {/* Show All / Collapse */}
              <button
                className={`dock-btn expand-btn${canCollapse ? ' expand-btn--on' : ''}`}
                onClick={toggleExpandAll}
                aria-pressed={canCollapse}
                aria-label={canCollapse ? 'Collapse to active person' : 'Show all people in the tree'}
              >
                {canCollapse ? <CollapseIcon /> : <ExpandAllIcon />}
                <span className="dock-btn__label">{canCollapse ? 'Collapse' : 'All'}</span>
              </button>
            </div>
          </div>
          {!lineageMode && !flightCaption && <IntroHint />}
          {lineageMode && (
            <LineageBanner
              graph={graph}
              anchorId={activeId}
              order={lineageOrder}
              onClear={() => { setLineagePath(null); setLineageOrder(null); }}
              onExit={toggleLineage}
            />
          )}
          {flightCaption && (
            <FlightCaption graph={graph} order={flightCaption.order} upTo={flightCaption.upTo} />
          )}
        </>
      ) : (
        <AccessibleTree
          graph={graph}
          focusId={activeId}
          onFocus={activate}
          onOpenPerson={openPerson}
        />
      )}

      <PersonSheet
        graph={graph}
        personId={openId}
        viewerId={data.myPersonId || DEFAULT_FOCUS}
        memories={data.memories}
        photos={data.photos}
        documents={data.documents}
        canEdit={canEditTree}
        canContribute={canContributeTree}
        lockEscape={!!(addAnchorId || editId || timelineId || memoryId || lightbox || crop || invitePersonId)}
        onClose={closePerson}
        onFocus={(id) => {
          closePerson();
          activate(id);
        }}
        onOpenPerson={openPerson}
        onAddRelative={setAddAnchorId}
        onEdit={setEditId}
        onEditTimeline={setTimelineId}
        onAddMemory={setMemoryId}
        onVoteMemory={toggleMemoryVote}
        onRemoveMemory={removeMemory}
        onAddPhoto={(id, src) => addPhoto(id, { src })}
        onOpenLightbox={(personId, index) => setLightbox({ personId, index })}
        onAddDocument={(personId, fields) => addDocument(personId, fields)}
        onOpenDocument={(doc) => setDocViewer({ title: doc.title, src: doc.src, mime: doc.mime })}
        onRemoveDocument={(id) => {
          const doc = data.documents?.find((d) => d.id === id);
          if (doc?.src?.startsWith('/api/documents/')) {
            fetch(doc.src, { method: 'DELETE' }).catch(() => {});
          }
          removeDocument(id);
        }}
        onUpdateDocument={(id, patch) => updateDocument(id, patch)}
        onRemoveRelationship={removeRelationship}
        onUpdateRelationshipQualifier={updateRelationshipQualifier}
        onChangeRelationship={handleChangeRelType}
        onUpdateStory={(id, story) => {
          const person = graph.byId.get(id);
          updatePerson(id, { story }, { type: 'person_updated', personId: id, personName: person?.display_name ?? '', detail: 'life story' });
        }}
        onAddCondition={addCondition}
        onRemoveCondition={removeCondition}
        onUpdateCondition={updateCondition}
        onUpdateHealthNotes={(id, text) => {
          const person = graph.byId.get(id);
          updatePerson(id, { health_notes: text || null }, { type: 'person_updated', personId: id, personName: person?.display_name ?? '', detail: 'health notes' });
        }}
        onPhoto={handlePhoto}
        onInvite={(id) => setInvitePersonId(id)}
        onLifeJourney={startLifeJourney}
        onMarkJoined={handleMarkJoined}
      />

      {searchOpen && (
        <SearchOverlay
          people={data.people}
          onSelect={flyToSearchResult}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {invitePersonId && graph.byId.get(invitePersonId) && (
        <InviteSheet
          person={graph.byId.get(invitePersonId)}
          myRole={user ? (data._meta?.role || 'owner') : 'owner'}
          onSend={handleSendInvite}
          onClose={() => setInvitePersonId(null)}
        />
      )}

      {insightsOpen && (
        <TreeInsights
          graph={graph}
          viewerId={data.myPersonId || activeId}
          onNavigate={(id) => { setInsightsOpen(false); activate(id); openPerson(id); }}
          onClose={() => setInsightsOpen(false)}
        />
      )}

      {duplicatesOpen && (
        <DuplicatesSheet
          pairs={duplicatePairs}
          graph={graph}
          onMerge={(keepId, dropId) => { mergePeople(keepId, dropId); if (activeId === dropId) activate(keepId); }}
          onClose={() => setDuplicatesOpen(false)}
        />
      )}

      {timelineOpen && (
        <TimelineView
          graph={graph}
          photos={data.photos}
          onNavigate={(id) => { setTimelineOpen(false); activate(id); openPerson(id); }}
          onClose={() => setTimelineOpen(false)}
        />
      )}

      {promptClaim && graph.people.length > 1 && (
        <ClaimSpot
          graph={graph}
          familyName={data.familyName}
          viewerEmail={user?.email}
          onClaim={handleClaimSpot}
          onSkip={markClaimSeen}
        />
      )}

      {showInstall && (
        <InstallPrompt installEvent={installEvent} onClose={dismissInstall} />
      )}

      {addAnchorId && graph.byId.get(addAnchorId) && (
        <AddRelativeSheet
          anchor={graph.byId.get(addAnchorId)}
          people={data.people.filter((p) => p.id !== addAnchorId)}
          relationships={data.relationships}
          onClose={() => setAddAnchorId(null)}
          onAdd={handleAdd}
          onLinkExisting={handleLinkExisting}
        />
      )}

      {pendingFamilyInvites.length > 0 && (
        <div className="invite-banner" role="alert">
          {pendingFamilyInvites.map((inv) => (
            <div key={inv.token} className="invite-banner__item">
              <span className="invite-banner__text">
                <strong>{inv.from_email || 'Someone'}</strong> invited you to join{' '}
                <strong>{inv.family_name || 'a family tree'}</strong>
              </span>
              <div className="invite-banner__actions">
                <button
                  className="invite-banner__join"
                  onClick={() => handleAcceptFamilyInvite(inv)}
                >
                  Join
                </button>
                <button
                  className="invite-banner__dismiss"
                  aria-label="Dismiss invitation"
                  onClick={() => setPendingFamilyInvites((prev) => prev.filter((i) => i.token !== inv.token))}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editId && graph.byId.get(editId) && (
        <EditPersonSheet
          person={graph.byId.get(editId)}
          onClose={() => setEditId(null)}
          onSave={handleSave}
          onRemove={canManageTreeStructure ? handleRemovePerson : null}
        />
      )}

      {timelineId && graph.byId.get(timelineId) && (
        <TimelineEditor
          person={graph.byId.get(timelineId)}
          onClose={() => setTimelineId(null)}
          onSave={handleSaveTimeline}
        />
      )}

      {memoryId && graph.byId.get(memoryId) && (
        <MemorySheet
          person={graph.byId.get(memoryId)}
          onClose={() => setMemoryId(null)}
          onAdd={handleAddMemory}
        />
      )}

      {lightbox && (
        <Lightbox
          photos={data.photos.filter((p) => p.person_id === lightbox.personId)}
          startIndex={lightbox.index}
          onClose={() => setLightbox(null)}
          onSetCaption={setPhotoCaption}
          onDelete={(id) => {
            const ph = data.photos.find((p) => p.id === id);
            if (ph?.src?.startsWith('/api/photos/')) {
              fetch(ph.src, { method: 'DELETE' }).catch(() => {});
            }
            removePhoto(id);
          }}
          onSetPortrait={(src) => {
            setPhoto(lightbox.personId, src);
            setLightbox(null);
            if (src.startsWith('data:')) {
              generateThumb(src).then((thumb) => {
                if (thumb) updatePerson(lightbox.personId, { photo_thumb: thumb });
              });
            }
          }}
        />
      )}

      {docViewer && (
        <DocViewer doc={docViewer} onClose={() => setDocViewer(null)} />
      )}

      {crop && (
        <PhotoCropper
          src={crop.url}
          onCancel={closeCrop}
          onConfirm={(dataUrl) => {
            setPhoto(crop.id, dataUrl, { recordActivity: true }); // instant visual feedback + activity
            closeCrop();
            generateThumb(dataUrl).then((thumb) => {
              if (thumb) updatePerson(crop.id, { photo_thumb: thumb });
            });
            uploadPhoto(dataUrl).then((url) => {
              if (url !== dataUrl) {
                setPhoto(crop.id, url); // upgrade to R2 URL
                updatePerson(crop.id, { photo_thumb: null }); // R2 URL handles cross-device sync
              }
            });
          }}
        />
      )}

      <Legend
        open={legendOpen}
        onClose={() => setLegendOpen(false)}
        mergeParents={mergeParents}
        onToggleMerge={() => setMergeParents((v) => !v)}
        bloodlineOnly={bloodlineOnly}
        onToggleBloodlineOnly={() => setBloodlineOnly((v) => !v)}
        layout={layout}
        onSetLayout={(mode) => {
          setLayout(mode);
          // Chart mode works best with Focus Family limiting the visible set.
          if (mode === 'chart' && !focusMode) setFocusMode(true);
        }}
      />

      {activityOpen && (
        <ActivityFeed
          activity={data.activity ?? []}
          people={data.people}
          userEmail={user?.email}
          onClose={() => setActivityOpen(false)}
          onSelectPerson={(id) => {
            setActivityOpen(false);
            const person = graph.byId.get(id);
            if (person) openPerson(id);
          }}
        />
      )}

      {settingsOpen && (
        <FamilySettings
          myRole={user ? (data._meta?.role || 'owner') : 'owner'}
          familyName={data.familyName || 'My Family'}
          onUpdateFamilyName={updateFamilyName}
          onReset={resetTree}
          onLogout={user ? async () => {
            await fetch('/api/auth/logout', { method: 'POST' });
            clearLocalData(); // don't leave this user's tree for the next person
            window.location.reload();
          } : null}
          onClose={() => setSettingsOpen(false)}
          onImportGedcom={() => setGedcomOpen(true)}
          onImportFamilySearch={() => setFsImportOpen(true)}
          people={data.people}
          userEmail={user?.email}
          onSelectPerson={(id) => {
            setSettingsOpen(false);
            const person = graph.byId.get(id);
            if (person) openPerson(id);
          }}
        />
      )}

      {profileOpen && user && (
        <UserProfile
          user={user}
          people={data.people}
          onClose={() => setProfileOpen(false)}
          onLogout={async () => {
            await fetch('/api/auth/logout', { method: 'POST' });
            clearLocalData(); // don't leave this user's tree for the next person
            window.location.reload();
          }}
          onSaved={(updated) => {
            setUser((u) => ({ ...u, ...updated }));
            setCurrentUser({ ...user, ...updated });
          }}
          onPhoto={handlePhoto}
        />
      )}

      {fsImportOpen && (
        <FamilySearchImport
          onImport={(people, relationships, opts) => {
            importFromGedcom(people, relationships, opts);
          }}
          onClose={(firstPersonId) => {
            if (firstPersonId) {
              setActiveId(firstPersonId);
              setExpanded(new Set([firstPersonId]));
            }
            setFsImportOpen(false);
          }}
          canReplace={canManageTreeStructure}
        />
      )}

      {gedcomOpen && (
        <GedcomImport
          onImport={(people, relationships, opts) => {
            importFromGedcom(people, relationships, opts);
          }}
          onClose={(firstPersonId) => {
            // After the wizard's "done" screen, navigate to the first imported person.
            if (firstPersonId) {
              setActiveId(firstPersonId);
              setExpanded(new Set([firstPersonId]));
            }
            setGedcomOpen(false);
          }}
          canReplace={canManageTreeStructure}
        />
      )}

      {/* Anonymous ?new trial: nudge to create an account once onboarding is done. */}
      {isAnonymousTrial && data.hasCompletedOnboarding && user === null && (
        <SaveNudge
          onSaveComplete={() => applySession().catch(() => setAuthState('open'))}
        />
      )}
    </div>
  );
}

// ── Document viewer ───────────────────────────────────────────────────────────
// Renders in-app so the session cookie is sent with the fetch — iOS PWA has a
// separate cookie store from Safari, so window.open() loses auth entirely.
function DocViewer({ doc, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isImage = doc.mime?.startsWith('image/');

  return (
    <div className="doc-viewer-scrim" onClick={onClose}>
      <div className="doc-viewer" onClick={(e) => e.stopPropagation()}>
        <div className="doc-viewer__bar">
          <span className="doc-viewer__title">{doc.title}</span>
          <button className="doc-viewer__close" onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {isImage ? (
          <div className="doc-viewer__img-wrap">
            <img className="doc-viewer__img" src={doc.src} alt={doc.title} />
          </div>
        ) : (
          <iframe
            className="doc-viewer__frame"
            src={doc.src}
            title={doc.title}
            sandbox="allow-same-origin allow-scripts allow-popups"
          />
        )}
      </div>
    </div>
  );
}

function LineageIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="4" r="2.5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="4" cy="20" r="2.5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="20" cy="20" r="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 6.5v4M12 10.5l-5.5 7M12 10.5l5.5 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ExpandAllIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="5"  cy="5"  r="2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="19" cy="5"  r="2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="5"  cy="19" r="2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="19" cy="19" r="2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M7 5h5M12 5h5M5 7v5M5 12v5M19 7v5M19 12v5M7 19h5M12 19h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.45" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// A loose, uneven scatter of dots with no centre and no connecting lines —
// deliberately the visual opposite of FocusIcon's symmetric hub-and-spoke,
// since the two used to be a near-identical crosshair/node silhouette at
// dock size. Reads as "everyone, equally, nobody singled out".
function BrowseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="2.3" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17" cy="6" r="1.9" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="13" r="2.5" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="6" cy="17" r="1.9" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="18" cy="17" r="2.1" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.14v14l11-7-11-7z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  );
}
function FocusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="5" r="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="19" r="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="5" cy="12" r="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="19" cy="12" r="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7v2M12 15v2M7 12h2M15 12h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function AppLoadingScreen() {
  return (
    <div className="app-loading">
      <Logo size={42} />
    </div>
  );
}

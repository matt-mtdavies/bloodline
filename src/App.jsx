import { useMemo, useState, useCallback, useRef, useEffect, useSyncExternalStore, lazy, Suspense } from 'react';
import { flushSync } from 'react-dom';
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
  updatePartnerMeta,
  mergePeople,
  removePerson,
  updateRelationshipQualifier,
  updatePerson,
  setupTree,
  setPhoto,
  addMemory,
  toggleMemoryVote,
  removeMemory,
  updateMemory,
  addPhoto,
  setPhotoCaption,
  removePhoto,
  addDocument,
  removeDocument,
  updateDocument,
  addCondition,
  removeCondition,
  updateCondition,
  addLifeEvent,
  addMedal,
  removeMedal,
  retractDocumentContributions,
  dismissRelationshipFact,
  logActivity,
  loadFromServer,
  saveToServer,
  enableServerSync,
  updateFamilyName,
  resetTree,
  importFromGedcom,
  migratePhotosToR2,
  migrateDocsToR2,
  migrateDocThumbsToR2,
  setCurrentUser,
  setMyPerson,
  bindIdentity,
  clearLocalData,
  isNewUrl,
  getActivityReadAt,
  setActivityReadAt,
  takeRecapCutoff,
  setRecapCutoff,
} from './data/store.js';
import { groupRecapUpdates, captionForRecapGroup } from './lib/recap.js';
import { uploadPhoto, generateThumb, uploadDocument, savePhotoToDevice, srcToDataUrl, summarizeDocument } from './lib/image.js';
import { useImageZoom } from './lib/useImageZoom.js';
import { buildGraph, pathBetween, pathBetweenOrdered, bloodRelativesOf } from './data/graph.js';
import { detectRegion, nearestWorldEvent } from './lib/worldEvents.js';
import { findDuplicatePairs, pairKey, loadDismissedDuplicates, saveDismissedDuplicates } from './lib/duplicates.js';
import { canManageTree } from './lib/visibility.js';
import { profileCompleteness, isDuplicateLifeEvent } from './lib/profile.js';
import { computeInsightModules, personHighlight, highlightCandidates } from './lib/insightModules.js';
import { useReducedMotion } from './hooks/useReducedMotion.js';
import BubbleTree from './viz/BubbleTree.jsx';
import ChartTree from './viz/ChartTree.jsx';
import TopBar from './components/TopBar.jsx';
import FocusNameplate from './components/FocusNameplate.jsx';
import HoverCard from './components/HoverCard.jsx';
import HomeToMe from './components/HomeToMe.jsx';
import ReturnToTreePill from './components/ReturnToTreePill.jsx';
import PersonSheet from './components/PersonSheet.jsx';
import AddRelativeSheet from './components/AddRelativeSheet.jsx';
import EditPersonSheet from './components/EditPersonSheet.jsx';
import TimelineEditor from './components/TimelineEditor.jsx';
import MemorySheet from './components/MemorySheet.jsx';
import Lightbox from './components/Lightbox.jsx';
// pdf.js is a ~450KB dependency only a fraction of visitors ever need (only
// once someone actually opens a PDF document) — code-split so everyone else
// never pays for it in the initial load.
const PdfViewer = lazy(() => import('./components/PdfViewer.jsx'));
import PhotoCropper from './components/PhotoCropper.jsx';
import AccessibleTree from './components/AccessibleTree.jsx';
import Legend from './components/Legend.jsx';
import IntroHint from './components/IntroHint.jsx';
import IdleFactHint from './components/IdleFactHint.jsx';
import Intro from './components/Intro.jsx';
import Onboarding from './components/Onboarding.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import FamilySettings from './components/FamilySettings.jsx';
import UserProfile from './components/UserProfile.jsx';
import Home from './components/Home.jsx';
import HowItWorks from './components/HowItWorks.jsx';
import FamilyTrees from './components/FamilyTrees.jsx';
import MergeWizard from './components/MergeWizard.jsx';
import InviteSheet from './components/InviteSheet.jsx';
import TreeInsights from './components/TreeInsights.jsx';
import KeepsakeView from './components/Keepsake/KeepsakeView.jsx';
import { buildKeepsakeFacts, factsHash } from './lib/keepsake.js';
import DuplicatesSheet from './components/DuplicatesSheet.jsx';
import LineageBanner from './components/LineageBanner.jsx';
import FlightCaption from './components/FlightCaption.jsx';
import TimelineView from './components/TimelineView.jsx';
import ClaimSpot from './components/ClaimSpot.jsx';
import InstallPrompt from './components/InstallPrompt.jsx';
import ActivityFeed from './components/ActivityFeed.jsx';
import RecapTour from './components/RecapTour.jsx';
import GedcomImport from './components/GedcomImport.jsx';
import FamilySearchImport from './components/FamilySearchImport.jsx';
import SaveNudge from './components/SaveNudge.jsx';
import HomeNudge from './components/HomeNudge.jsx';
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

// The recap tour's "since you were last here" cutoff — captured once at
// module scope, same reasoning as _initialPendingInvite above: this reads
// AND bumps a localStorage timestamp, so it must run exactly once per real
// page load. A hook-based guard (useState/useRef initializer) isn't enough —
// StrictMode's dev-only mount → unmount → remount would reset any
// component-local guard and re-run the side effect, silently erasing the
// real cutoff the second time through.
const _initialRecapCutoff = typeof window === 'undefined' ? null : takeRecapCutoff();

const DOC_FIELD_LABEL = { occupation: 'Occupation', birth_place: 'Birth place', residence: 'Residence' };

// Shapes a raw summarizeDocument() result into the doc.extracted record the
// store persists — every candidate (a fact, a profile field, a mentioned
// person) starts 'pending' so Enrich and DocViewer both know it hasn't been
// reviewed yet. Shared by the manual Summarize button and the background
// auto-summarize-on-upload path so the two can never drift apart.
const PROFILE_FIELD_KEYS = [
  'occupation', 'birth_place', 'residence',
  'military_branch', 'military_nation', 'military_service_number', 'military_rank',
];

// Every scalar profile field a document can ever write (see PROFILE_FIELD_KEYS
// above, plus cause_of_death — filled opportunistically by applyDocumentFact,
// never offered as its own Enrich candidate). Used two ways: tagging
// person.field_sources[field] with the accepting document's id when a
// document writes one, and clearing that tag the moment handleSave sees a
// human change the same field through the ordinary edit form — so a document
// deleted later can only ever retract what it actually still owns, never a
// real correction typed in by hand afterward.
const DOC_TRACKABLE_FIELDS = [...PROFILE_FIELD_KEYS, 'cause_of_death'];

function buildExtracted(result) {
  const pf = result.profileFields;
  const profileFields = {};
  if (pf) {
    for (const key of PROFILE_FIELD_KEYS) {
      profileFields[key] = pf[key] ? { ...pf[key], status: 'pending' } : null;
    }
  }
  return {
    facts: result.facts.map((f) => ({ ...f, status: 'pending' })),
    profileFields: pf ? profileFields : null,
    peopleMentioned: (result.peopleMentioned || []).map((p) => ({ ...p, status: 'pending' })),
    medals: (result.medals || []).map((m) => ({ ...m, status: 'pending' })),
  };
}

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
  // Dismissed pairs live in one shared place (lib/duplicates.js, localStorage-
  // backed) rather than inside DuplicatesSheet's own state — the topbar's count
  // pill and the review sheet's list used to each track "what's left" separately,
  // so a dismiss in the sheet never reached the pill (stuck showing a stale,
  // too-high count) and a pair dismissed in an earlier session was still counted
  // here even though the sheet correctly hid it (pill said N, sheet said "tidy").
  const [dismissedDuplicates, setDismissedDuplicates] = useState(loadDismissedDuplicates);
  const dismissDuplicatePair = (key) => {
    setDismissedDuplicates((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev); next.add(key);
      saveDismissedDuplicates(next);
      return next;
    });
  };
  const duplicatePairs = useMemo(
    () => findDuplicatePairs(data.people, data.relationships)
      .filter((p) => !dismissedDuplicates.has(pairKey(p.aId, p.bId))),
    [data.people, data.relationships, dismissedDuplicates],
  );

  // 'loading' → 'open' (no auth / bypass) | 'login' (needs sign-in) | 'authed'
  const [authState, setAuthState] = useState((isDemo || isNewUrl) ? 'open' : 'loading');
  // Track whether this session started as an anonymous ?new trial (stays true even
  // after URL is stripped, so the SaveNudge remains visible until they log in).
  const [isAnonymousTrial] = useState(() => isNewUrl);
  const [user, setUser] = useState(null);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  // When opened from a person's "Enrich this profile" sheet, filters the
  // duplicates list down to just that person's own possible matches.
  const [duplicatesFocusId, setDuplicatesFocusId] = useState(null);
  const openDuplicatesFor = (personId) => { setDuplicatesFocusId(personId); setDuplicatesOpen(true); };
  // Whether the signed-in member can edit the tree (drives merge/cleanup tools).
  const canEditTree = !user || ['owner', 'coadmin', 'editor'].includes(data._meta?.role || 'owner');
  // Contributors may add memories & photos but not change structure.
  const canContributeTree = !user || ['owner', 'coadmin', 'editor', 'contributor'].includes(data._meta?.role || 'owner');
  // Hard-to-undo, whole-tree actions (erase, replace-import, merge duplicates,
  // remove a person) are reserved for co-admins/owners — see canManageTree.
  const canManageTreeStructure = !user || canManageTree(data._meta?.role || 'owner');
  const [promptClaim, setPromptClaim] = useState(false); // welcome a member to claim their spot
  // The person the invite that brought them here was actually for (if any) —
  // a stronger, deterministic signal than ClaimSpot's own invited_email
  // guess. Null whenever that invite predates this field or never had one;
  // ClaimSpot falls back to its existing email match in that case.
  const [suggestedClaimPersonId, setSuggestedClaimPersonId] = useState(null);
  const [installEvent, setInstallEvent] = useState(null); // captured beforeinstallprompt
  const [showInstall, setShowInstall] = useState(false);
  const [showHomeNudge, setShowHomeNudge] = useState(false);
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
    // Whoever the invite that brought this session in was actually for, if
    // any — threaded from whichever of paths A/B/C below actually fires, and
    // handed to ClaimSpot at the bottom of this function.
    let claimSuggestPersonId = loginExtras?.personId || null;

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
          else if (ab.personId) claimSuggestPersonId = ab.personId;
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
                if (ab.personId) claimSuggestPersonId = ab.personId;
                await loadFromServer({ forceServerWins: true });
                try {
                  const seen = localStorage.getItem(`bl_claim_seen_${u.uid}`);
                  if (!u.person_id && !seen) { setPromptClaim(true); setSuggestedClaimPersonId(claimSuggestPersonId); }
                } catch { if (!u.person_id) { setPromptClaim(true); setSuggestedClaimPersonId(claimSuggestPersonId); } }
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
      // Thumbnails are an invisible storage optimization, not user content —
      // run it alongside the other two migrations, but never mention it in
      // the sync toast below (nothing the user did or would recognize).
      migrateDocThumbsToR2(uploadDocument).catch(() => ({ total: 0, uploaded: 0, failed: 0 })),
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
      if (joiningFamily && !u.person_id && !seen) { setPromptClaim(true); setSuggestedClaimPersonId(claimSuggestPersonId); }
    } catch { if (joiningFamily && !u.person_id) { setPromptClaim(true); setSuggestedClaimPersonId(claimSuggestPersonId); } }
  }

  const markClaimSeen = useCallback(() => {
    setPromptClaim(false);
    setSuggestedClaimPersonId(null);
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

    // A freshly-claimed profile is usually thin (just a name). Send them
    // straight into editing it — rather than dropping them into the tree
    // with a bare bubble — so the profile they're now "the destination" for
    // actually has something on it before they wander off.
    const memoryCount = data.memories.filter((m) => m.person_id === personId).length;
    if (person && profileCompleteness(person, graph, memoryCount).score < 100) {
      setTimeout(() => setEditId(personId), 150);
    }
  }, [user, markClaimSeen, data.people, data.memories, graph]);

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

  const dismissHomeNudge = useCallback(() => {
    setShowHomeNudge(false);
    try { localStorage.setItem('bl_home_nudge_seen', '1'); } catch { /* ignore */ }
  }, []);

  // A one-time coach-mark on the logo — the only way anyone on touch (no
  // hover, so no hover-tip) would learn tapping it opens the home hub.
  // Timed a beat after the install nudge (a different corner, so they'd
  // never actually overlap, but no reason to compete for a first glance)
  // and gated on the tree having actually rendered, not just any authState.
  useEffect(() => {
    if (authState === 'loading' || authState === 'login') return;
    let seen = false;
    try { seen = !!localStorage.getItem('bl_home_nudge_seen'); } catch { /* ignore */ }
    if (seen) return;
    const t = setTimeout(() => setShowHomeNudge(true), 2600);
    return () => clearTimeout(t);
  }, [authState]);

  useEffect(() => {
    if (!showHomeNudge) return;
    const t = setTimeout(dismissHomeNudge, 8000);
    return () => clearTimeout(t);
  }, [showHomeNudge, dismissHomeNudge]);

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
    const onPoll = () => showToast('Tree refreshed with new changes');
    window.addEventListener('bloodline:tree-polled', onPoll);
    return () => window.removeEventListener('bloodline:tree-polled', onPoll);
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
  // Set when a profile is opened from the home hub (e.g. tapping an activity
  // row on Home) — closing that profile should land back on the hub, not the
  // bare tree, since that's where the person actually navigated from.
  const [returnToHome, setReturnToHome] = useState(false);
  const [addAnchorId, setAddAnchorId] = useState(null); // add-relative sheet
  const [editId, setEditId] = useState(null); // edit sheet
  const [editStartInEdit, setEditStartInEdit] = useState(false); // skip the view mode (see handleAdd's "Add & edit details")
  const [timelineId, setTimelineId] = useState(null); // timeline editor
  const [memoryId, setMemoryId] = useState(null); // add-memory sheet
  const [lightbox, setLightbox] = useState(null); // { personId, index }
  const [crop, setCrop] = useState(null); // { id, url } photo cropper
  const [view, setView] = useState('bubbles');
  const [legendOpen, setLegendOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bloodlineOnly, setBloodlineOnly] = useState(false);
  const [lineageMode, setLineageMode] = useState(false);
  const [lineagePath, setLineagePath] = useState(null); // Set<id> | null
  const [lineageOrder, setLineageOrder] = useState(null); // ordered [fromId,…,toId] | null
  const [cameraFree, setCameraFree] = useState(false); // user has panned/zoomed away
  const [storageWarning, setStorageWarning] = useState(false);
  const [storageNearLimit, setStorageNearLimit] = useState(false);
  const [treeSizeWarning, setTreeSizeWarning] = useState(null); // { bytes, limitBytes } | null
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
  const [keepsakeId, setKeepsakeId] = useState(null); // personId whose Keepsake is open
  // The home hub's Keepsake nudge — 'create' (no edition yet), 'stale' (tree
  // grew since the last one), or 'open' (current). null while signed out,
  // while the check is in flight, or when the viewer has no claimed person.
  const [keepsakeNudge, setKeepsakeNudge] = useState(null);
  const [invitePersonId, setInvitePersonId] = useState(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [lastReadAt, setLastReadAt] = useState(() => getActivityReadAt()); // null = never opened = all unread
  // "Since you were last here" — seeded once per real page load (see
  // _initialRecapCutoff above), deliberately independent of lastReadAt below:
  // opening the activity panel shouldn't shrink the recap queue out from
  // under a tour that's using it. Real state (not the plain constant it used
  // to be) so opening the recap can advance it — see markRecapSeen below —
  // otherwise reopening Activity later in the same session (or on a later
  // visit) would show the exact same "N updates" again forever.
  const [recapCutoff, setRecapCutoffState] = useState(_initialRecapCutoff);
  const [recapOpen, setRecapOpen] = useState(false);
  const [recapQueue, setRecapQueue] = useState([]);
  const [recapAllDone, setRecapAllDone] = useState(false);
  const [recapNudge, setRecapNudge] = useState(false);
  const recapNudgeShownRef = useRef(false);
  const [gedcomOpen, setGedcomOpen] = useState(false);
  const [fsImportOpen, setFsImportOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [homeOpen, setHomeOpen] = useState(false);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [familyTreesOpen, setFamilyTreesOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Seeds SearchOverlay's query on the one frame it mounts from a keystroke
  // (see the type-to-search effect below) — null for every other open path
  // (the search icon, the lineage banner), which start blank as always.
  const [searchInitialQuery, setSearchInitialQuery] = useState(null);
  // Search's flyover caption — { order: [fromId,…,toId], upTo: number } while a
  // flight is in progress, else null. upTo advances via the flight's onSegment
  // callback so the relationship chain fills in hop by hop as the camera flies.
  const [flightCaption, setFlightCaption] = useState(null);
  // Desktop hover preview — id of the bubble the pointer is resting over
  // (BubbleTree debounces this itself; see onHover).
  const [hoveredId, setHoveredId] = useState(null);
  const viewApi = useRef(null);
  // Tracks which pair, if any, is currently wearing the duplicate-compare
  // gold ring (see showDuplicatePairInTree below) so a later call for a
  // different pair can clear the previous one instead of leaving it lit.
  const compareGlowIdsRef = useRef(null);
  // Same pair, but as real state (not just a ref) — needed to render a
  // SECOND FocusNameplate for the non-active duplicate candidate (see the
  // extra <FocusNameplate> below): only one person can ever be the literal
  // ego-camera `active` id and get the ordinary nameplate, but "Show both in
  // tree" needs both candidates to carry the full name+dates plate, not just
  // the bare in-canvas label (real follow-up feedback: "we need it to force
  // both the name plates on"). Persists until a later "Show both in tree"
  // replaces it, same lifecycle as the ring/dim treatment above.
  const [comparePairIds, setComparePairIds] = useState(null);

  // Notify the user if a commit couldn't persist (localStorage full).
  useEffect(() => {
    const handler = () => {
      setStorageWarning(true);
      setTimeout(() => setStorageWarning(false), 6000);
    };
    window.addEventListener('bloodline:storage-full', handler);
    return () => window.removeEventListener('bloodline:storage-full', handler);
  }, []);

  // Proactive counterpart to the above: warns while there's still room to
  // act (remove some photos) rather than only after an edit has already
  // failed to save. See store.js's STORAGE_WARN_BYTES threshold.
  useEffect(() => {
    const handler = () => {
      setStorageNearLimit(true);
      setTimeout(() => setStorageNearLimit(false), 8000);
    };
    window.addEventListener('bloodline:storage-near-limit', handler);
    return () => window.removeEventListener('bloodline:storage-near-limit', handler);
  }, []);

  // The engagement loop made visible (docs/KEEPSAKE.md Phase 5): when the
  // hub opens, quietly check whether the viewer's own Keepsake exists and
  // whether the tree has grown past it. Best-effort — any failure (signed
  // out, demo, offline) just means no card.
  useEffect(() => {
    if (!homeOpen || !data.myPersonId) { setKeepsakeNudge(null); return; }
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/keepsake?personId=${encodeURIComponent(data.myPersonId)}`);
        if (!r.ok) { if (alive) setKeepsakeNudge(null); return; }
        const edition = await r.json().catch(() => null);
        const facts = buildKeepsakeFacts(graph, data.myPersonId, {
          memories: data.memories, documents: data.documents,
        });
        if (!facts) { if (alive) setKeepsakeNudge(null); return; }
        const nudge = !edition ? 'create' : edition.hash !== factsHash(facts) ? 'stale' : 'open';
        if (alive) setKeepsakeNudge(nudge);
      } catch {
        if (alive) setKeepsakeNudge(null);
      }
    })();
    return () => { alive = false; };
  }, [homeOpen, data.myPersonId, graph, data.memories, data.documents]);

  // Server-side counterpart: the whole tree lives in one D1 row, capped at
  // 1 MiB. tree.js sends this alongside an otherwise-successful save once
  // the payload crosses its soft warning threshold, well before the hard
  // limit that would start rejecting saves outright.
  useEffect(() => {
    const handler = (e) => {
      setTreeSizeWarning(e.detail || null);
      setTimeout(() => setTreeSizeWarning(null), 10000);
    };
    window.addEventListener('bloodline:tree-size-warning', handler);
    return () => window.removeEventListener('bloodline:tree-size-warning', handler);
  }, []);

  // Family stats for the header: people count, top surnames, year span, photos, memories.
  // Scoped to blood relatives only when "Bloodline only" is on — otherwise the
  // pill reads "Bloodline only · 268 people" while still describing the whole
  // tree, flatly contradicting the filter it's supposed to be summarizing.
  const familyStats = useMemo(() => {
    const scopeIds = bloodlineOnly ? bloodRelativesOf(graph, data.myPersonId || DEFAULT_FOCUS) : null;
    const people = scopeIds ? graph.people.filter((p) => scopeIds.has(p.id)) : graph.people;
    const photos = scopeIds ? data.photos.filter((ph) => scopeIds.has(ph.person_id)) : data.photos;
    const memories = scopeIds ? data.memories.filter((m) => scopeIds.has(m.person_id)) : data.memories;
    const relationships = scopeIds
      ? data.relationships.filter((r) => scopeIds.has(r.from_person) && scopeIds.has(r.to_person))
      : data.relationships;
    const freq = new Map();
    let yearMin = Infinity, yearMax = -Infinity;
    let oldestPerson = null, youngestPerson = null;
    let withPhoto = 0, withBio = 0, withBirthDate = 0;
    for (const p of people) {
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
      people: people.length,
      surnames,
      yearSpan,
      photos: photos.length,
      memories: memories.length,
      connections: relationships.length,
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
  }, [graph, data.photos, data.memories, data.relationships, data.myPersonId, bloodlineOnly]);

  // Unread activity count — null lastReadAt means never opened, so all events are "new".
  const unreadCount = useMemo(() => {
    const acts = data.activity ?? [];
    if (!acts.length) return 0;
    if (lastReadAt === null) return acts.length;
    return acts.filter((a) => new Date(a.created_at).getTime() > lastReadAt).length;
  }, [data.activity, lastReadAt]);

  // The recap tour's queue — one stop per OTHER person's change since
  // recapCutoff (your own edits are excluded — see groupRecapUpdates),
  // capped to a real "highlights reel". null cutoff (first-ever visit,
  // nothing to diff against) always yields an empty queue.
  const recapGroups = useMemo(
    () => (recapCutoff ? groupRecapUpdates(data.activity ?? [], recapCutoff, { viewerEmail: user?.email }) : []),
    [data.activity, recapCutoff, user?.email],
  );

  // Advances the "seen" cutoff on genuine intent only: watching the recap
  // (from the nudge or the activity panel's hero, both via openRecap) or
  // explicitly dismissing the nudge with its X — never merely by the app
  // booting or the nudge flashing on screen unread (see takeRecapCutoff in
  // store.js). Leaving it untouched otherwise is what lets an ignored "N
  // updates" nudge keep showing up as a standing option in the activity
  // panel across later visits, instead of silently vanishing.
  const markRecapSeen = useCallback(() => {
    const now = Date.now();
    setRecapCutoffState(now);
    setRecapCutoff(now);
  }, []);

  // Proactive nudge: the activity page's "Show me" only pays off for people
  // who already habitually open it, so surface it once, right after a real
  // session is established, if there's anything to recap. One-time per app
  // boot — recapNudgeShownRef guards against re-firing as data settles in.
  useEffect(() => {
    if (recapNudgeShownRef.current) return;
    if (!user || !recapGroups.length) return;
    recapNudgeShownRef.current = true;
    setRecapNudge(true);
  }, [user, recapGroups.length]);

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

  // Who counts as "blood" when Bloodline-only is on — anchored to the signed-in
  // VIEWER's own person (same convention as the search flyover's origin, the
  // hover card's viewerId, etc.), never the currently-tapped/active bubble.
  // Whoever you're looking at shouldn't redefine what "blood" means for the
  // rest of the session; it should mean the same thing every time you turn
  // the filter on, and — since it's keyed to myPersonId — genuinely differ
  // per family member: your mother-in-law is blood from your spouse's seat
  // in the tree and an in-law from yours, on the same shared tree data.
  // The neighbour-widening filters below (skipping step/partner hops) only
  // stop a NON-blood person from being newly revealed as someone's neighbour;
  // they don't do anything for someone already in `expanded` directly (a
  // search result, a direct tap, or — critically — "Show all", which dumps
  // every single person in at once). This closes that gap as a final filter pass.
  const bloodIds = useMemo(
    () => (bloodlineOnly ? bloodRelativesOf(graph, data.myPersonId || DEFAULT_FOCUS) : null),
    [graph, data.myPersonId, bloodlineOnly],
  );

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
    if (bloodIds) {
      for (const id of [...vis]) {
        if (!bloodIds.has(id)) vis.delete(id);
      }
    }
    if (focusFamilyIds) {
      for (const id of [...vis]) {
        if (!focusFamilyIds.has(id)) vis.delete(id);
      }
    }
    return vis;
  }, [graph, expanded, focusFamilyIds, bloodlineOnly, bloodIds]);

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
      // Gate ONLY this anchor's own bubble on its own aliveness — never skip
      // the neighbour traversal below just because the anchor itself hasn't
      // been born yet. Each neighbour has its own alive() check right where
      // it's added, so a parent who was born decades before an unborn child
      // is still introduced (with the time-view birth animation) at the
      // parent's own birth year. The old `continue` here suppressed that
      // whole branch until the anchor became alive, which is why relatives
      // of whoever you'd focused on used to all pop in at once, silently,
      // the moment the anchor was born — instead of each being greeted at
      // their own birth like everyone else.
      if (alive(id)) vis.add(id);
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
    // Bloodline-only: strip anyone not blood/adopted-reachable from the
    // active person, however they got into `expanded` — including "Show
    // all", which (by design) adds every single person at once and would
    // otherwise bypass the per-neighbour step/partner filtering above entirely.
    if (bloodIds) {
      for (const id of [...vis]) {
        if (!bloodIds.has(id)) vis.delete(id);
      }
    }
    // Focus mode: collapse everyone outside the nuclear family
    if (focusFamilyIds) {
      for (const id of [...vis]) {
        if (!focusFamilyIds.has(id)) vis.delete(id);
      }
    }
    return vis;
  }, [graph, expanded, aliveAtYear, focusFamilyIds, bloodlineOnly, bloodIds]);

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

  // World-history context for Time Mode's year-scrubber — same curated dataset
  // and region-bias as the Family Timeline, so scrubbing years alone (with no
  // life-journey person picked) still surfaces "what was happening" context.
  const timeRegion = useMemo(() => detectRegion(graph), [graph]);
  const worldEvent = useMemo(
    () => (timeMode ? nearestWorldEvent(timeYear, timeRegion) : null),
    [timeMode, timeYear, timeRegion],
  );

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
    setReturnToHome(false); // jumping into Time Mode, not just closing the profile
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

  // Shared exit for Time mode — the dock's own time-toggle button (tapped a
  // second time) and the ReturnToTreePill below both need to leave Time mode
  // exactly the same way, so there's one place that does it.
  const exitTimeMode = useCallback(() => {
    setTimePlaying(false);
    setLifeJourneyId(null);
    setTimeMode(false);
  }, []);

  // Shared by the top bar's search pill and the lineage banner's own search
  // button — both need the exact same iOS-keyboard timing fix (see below),
  // so it's one place instead of two copies quietly drifting apart.
  const openSearch = useCallback(() => {
    // iOS Safari only auto-shows the keyboard when focus() runs synchronously
    // inside the tap's own call stack. A plain setState here mounts
    // SearchOverlay (and its input) on a later React commit, which is why
    // the sheet would open but no keyboard ever appeared. flushSync forces
    // that mount to finish before this handler returns, so the focus() right
    // after still lands inside the same user-gesture stack.
    flushSync(() => setSearchOpen(true));
    document.querySelector('.search-input')?.focus();
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
    // Chart layout has no canvas to fly — the flight API belongs to
    // BubbleTree, which isn't even MOUNTED in chart mode, so flyAlong would
    // silently no-op and activeId (only ever set in the flight's onLand
    // callback) would never change: picking a search result would do
    // nothing at all. Activate directly instead; ChartTree recomputes its
    // pod tree around the new focal person and centres on them itself.
    if (layout === 'chart') {
      activateNormal(targetId);
      return;
    }
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
        // Switch the caption from crumb-trail to the landed two-photo card —
        // FlightCaption now owns its own dismiss timing from here (15s
        // untouched, or persists once the chain is expanded), so this just
        // flips the flag rather than scheduling a fixed hide.
        setFlightCaption((c) => (c ? { ...c, landed: true } : c));
      },
      // The user took the camera back mid-flight (a real drag/pinch, or the
      // ticker's own error-recovery abandoning it) — the journey was never
      // finished, so there's no "landed" state to show. Clear the caption
      // rather than leaving it stuck displaying an in-progress crumb-trail
      // with no Done button and no way to dismiss it short of searching again.
      onAbort: () => setFlightCaption(null),
    });
  }, [graph, data.myPersonId, reducedMotion, activateNormal, layout]);

  // Search, while tracing a lineage, needs to feed the SAME "tap another
  // relative" logic activate() uses in that mode — not flyToSearchResult,
  // which unconditionally cancels lineage mode and jumps the camera instead.
  // The path is computed from the trace's own anchor (activeId), not the
  // viewer's default person, and its nodes are expanded into view first since
  // (unlike tapping a bubble) a search result may not be on screen yet.
  const selectFromSearch = useCallback((targetId) => {
    setSearchOpen(false);
    if (!lineageMode) { flyToSearchResult(targetId); return; }
    if (targetId === activeId) {
      setLineagePath(null);
      setLineageOrder(null);
      return;
    }
    const ordered = pathBetweenOrdered(graph, activeId, targetId);
    if (ordered) {
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const id of ordered) next.add(id);
        return next;
      });
    }
    setLineagePath(ordered ? new Set(ordered) : null);
    setLineageOrder(ordered);
    // A search result may not be anywhere near wherever the camera was
    // last looking (unlike tapping a bubble, which by definition is already
    // on screen) — recenter() hands the camera back to follow mode, which
    // continuously frames the bounding box of whatever's now visible every
    // frame on its own (see BubbleTree's ticker). refocus() would only have
    // forced the newly-revealed nodes into a tidy radial cluster around the
    // trace's anchor, fighting the normal generational layout for no reason
    // — the camera catching up to wherever they actually are is all that
    // was ever needed.
    viewApi.current?.recenter();
  }, [lineageMode, activeId, graph, flyToSearchResult]);

  // Same flight as flyToSearchResult, but callable from anywhere — the
  // profile page's "Show in tree" and the list view's per-row action, not
  // just a search result. Switches back to the bubble canvas first if
  // needed, since the flight animates it and it isn't even mounted while
  // browsing the list view. Also forces layout back to 'organic': every
  // caller of this means "fly to them in the organic tree" (it's the literal
  // TreeIcon action, paired with the list view's separate "view in chart"
  // circle) — without this, a layout left on 'chart' from an earlier switch
  // (topbar Chart mode, or the list view's own chart circle) silently
  // stranded the flight, since BubbleTree never mounts under chart layout
  // and viewApi.current would just never populate.
  const flyToPersonFromAnywhere = useCallback((targetId) => {
    if (view !== 'bubbles' || layout === 'chart') {
      setView('bubbles');
      setLayout('organic');
      // BubbleTree mounts fresh here (a real PIXI/WebGL setup, not just a
      // re-render) and only populates viewApi once that effect has run —
      // poll a few frames rather than guessing a fixed delay that could be
      // too short on a slow device or needlessly long on a fast one.
      let tries = 0;
      const tryFly = () => {
        if (viewApi.current) { flyToSearchResult(targetId); return; }
        if (tries++ > 90) return; // ~1.5s at 60fps — give up quietly, never throws
        requestAnimationFrame(tryFly);
      };
      requestAnimationFrame(tryFly);
    } else {
      flyToSearchResult(targetId);
    }
  }, [view, layout, flyToSearchResult]);

  // The list view's per-row "view in chart" action, paired with the tree
  // circle above. Chart re-roots itself off activeId (see ChartTree's own
  // re-root effect keyed on that prop), so — unlike flyToPersonFromAnywhere —
  // there's no canvas mount to poll for: just switch to the chart layout and
  // activate the target person. bloodlineOnly follows the topbar's own
  // Tree/Chart/List switcher default (chart is a pedigree; bloodline-only is
  // its natural reading).
  const showPersonInChart = useCallback((targetId) => {
    setView('bubbles');
    setLayout('chart');
    setBloodlineOnly(true);
    activateNormal(targetId);
  }, [activateNormal]);

  // The duplicate-review sheet's "Show both in tree" — reveal both
  // candidate bubbles (plus their neighbours) and let the camera's own
  // bounding-box framing (refocus, already used by Focus Family/Life
  // Journey) pull them into view together, so whose kids belong to whom is
  // visible before deciding to merge (real report: "I couldn't tell whose
  // kids belonged to who easily" after a bad merge). Same view-switch-and-
  // poll as flyToPersonFromAnywhere, since BubbleTree isn't mounted (and
  // viewApi isn't populated) while browsing another view.
  const showDuplicatePairInTree = useCallback((aId, bId) => {
    setDuplicatesOpen(false);
    setDuplicatesFocusId(null);
    setOpenId(null);
    setExpanded((prev) => {
      if (prev.has(aId) && prev.has(bId)) return prev;
      const next = new Set(prev);
      next.add(aId);
      next.add(bId);
      return next;
    });
    activateNormal(aId);
    // Only ONE bubble can be the ego-camera's "active" node (bId just rode
    // along above so both get revealed and pulled into frame) — but the
    // recap tour's lingering gold ring is a separate, non-exclusive
    // primitive, so it can mark BOTH candidates at once. The ring alone
    // still left the second candidate visibly faded/small next to the
    // genuinely active one (real follow-up report, with screenshot: "you
    // can see its immediate family [for the active one]... both of the
    // duplicates should be shown this way... all the other bubbles faded"),
    // so setCompareFocus additionally folds bId into the per-frame distance
    // used for fade/scale, exactly matching what being "active" already does
    // for aId. Always kept in lockstep with the ring (set/cleared together)
    // so there's never a lit-but-dim or dim-but-unlit mismatch. Clears
    // whichever pair was lit by a previous "Show both in tree" first, so old
    // rings/focus don't pile up across repeated uses on different pairs.
    if (compareGlowIdsRef.current) {
      viewApi.current?.spotlightClearGlow(compareGlowIdsRef.current);
      viewApi.current?.clearCompareFocus();
    }
    compareGlowIdsRef.current = [aId, bId];
    setComparePairIds([aId, bId]);
    const doRefocus = () => {
      viewApi.current?.refocus(0.6);
      viewApi.current?.spotlightSetGlow([aId, bId]);
      viewApi.current?.setCompareFocus([aId, bId]);
    };
    if (view !== 'bubbles') {
      setView('bubbles');
      let tries = 0;
      const tryRefocus = () => {
        if (viewApi.current) { doRefocus(); return; }
        if (tries++ > 90) return;
        requestAnimationFrame(tryRefocus);
      };
      requestAnimationFrame(tryRefocus);
    } else {
      setTimeout(doRefocus, 100);
    }
  }, [view, activateNormal]);

  // The activity recap's cinematic tour — see BubbleTree's spotlightTour and
  // RecapTour.jsx. Builds the queue from recapGroups, reveals every stop
  // (they may be scattered anywhere in the tree, not connected by a path —
  // see groupRecapUpdates), and lets the camera visit them one at a time.
  const openRecap = useCallback(() => {
    if (!recapGroups.length) return;
    setActivityOpen(false);
    // The tour's whole promise is "the target bubble is always screen-
    // centred" (see RecapTour.jsx) — but a card left pinned open (e.g. the
    // user opened Activity from a profile without closing it first) biases
    // the camera left the entire time to make room for it, so every stop
    // lands off-centre. Same reason to drop any open profile sheet: it's a
    // full-screen camera experience, nothing should be floating over it.
    viewApi.current?.unpin();
    setOpenId(null);
    markRecapSeen();
    const ids = recapGroups.map((g) => g.personId);
    setRecapQueue(
      recapGroups.map((g) => {
        // "by whom, when" for the caption's meta line — distinct authors
        // (usually one), and the most recent of the group's events.
        const authors = [...new Set(g.events.map((e) => e.authorName).filter(Boolean))];
        const latest = g.events.reduce((max, e) => {
          const t = new Date(e.created_at).getTime();
          return t > max ? t : max;
        }, 0);
        return {
          personId: g.personId,
          personName: g.personName,
          caption: captionForRecapGroup(g),
          authorName: authors.length > 1 ? `${authors[0]} & ${authors.length - 1} more` : (authors[0] || null),
          at: latest ? new Date(latest).toISOString() : null,
          status: 'pending',
        };
      }),
    );
    setRecapAllDone(false);
    setRecapOpen(true);
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    setLineageMode(false);
    setLineagePath(null);
    setLineageOrder(null);
    setFocusMode(false);
    setLifeJourneyId(null);
    setBrowse(false);

    const onArrive = (id) => {
      setRecapQueue((q) =>
        q.map((item) => {
          if (item.personId === id) return { ...item, status: 'active' };
          if (item.status === 'active') return { ...item, status: 'done' };
          return item;
        }),
      );
    };
    const onDone = (lastId) => {
      setRecapQueue((q) => q.map((item) => ({ ...item, status: 'done' })));
      setRecapAllDone(true);
      // Land the tree's own focus on whoever the tour finished on, rather
      // than leaving it pointed at whoever was active before it started —
      // BubbleTree already updated its own internal notion of "active" (see
      // spotlightTour/spotlightEnd), this is the other half so React's
      // activeId (the nameplate, "Add relative", etc. all read this) agrees.
      if (lastId) setActiveId(lastId);
    };

    const startTour = () => {
      if (!viewApi.current) { requestAnimationFrame(startTour); return; }
      viewApi.current.spotlightTour(ids, { onArrive, onDone });
    };
    if (view !== 'bubbles') {
      setView('bubbles');
      requestAnimationFrame(startTour);
    } else {
      requestAnimationFrame(startTour);
    }
  }, [recapGroups, view, markRecapSeen]);

  const closeRecapAll = useCallback(() => {
    viewApi.current?.spotlightEnd();
    setRecapOpen(false);
    // Clear the queue itself, not just the overlay — onDone (above) only ever
    // flips every item's status to 'done', it never empties the array, and
    // HomeToMe's "back to you" pill (below) is gated on recapQueue.length===0
    // to stay hidden while the tour overlay is up. Left unset, that length
    // check never returns true again for the rest of the session once a
    // single recap tour has run, permanently hiding the pill even though the
    // tour landed you away from your own profile — exactly the case it
    // exists for.
    setRecapQueue([]);
    // The lit constellation lingers a moment after the panel closes — the
    // payoff of the whole tour — rather than vanishing the instant you tap
    // away.
    setTimeout(() => viewApi.current?.spotlightClearGlow(), 2600);
  }, []);

  const closePerson = useCallback(() => {
    viewApi.current?.unpin();
    setOpenId(null);
    if (returnToHome) {
      setReturnToHome(false);
      setHomeOpen(true);
    } else {
      deselect(); // returning to the tree from a profile lands in browse mode
    }
  }, [deselect, returnToHome]);

  // "Centre the tree here" / "Show in tree" are an explicit request to land
  // on the tree, focused on this person — never back to Home, even if that's
  // where the sheet was opened from (returnToHome would otherwise still be
  // set, and closePerson() would honour it, silently bouncing back to Home
  // right as activate()/flyTo() moved the camera underneath it — the tree
  // WAS updated, just never shown, until the next manual visit revealed it).
  const closePersonForTreeAction = useCallback(() => {
    viewApi.current?.unpin();
    setOpenId(null);
    setReturnToHome(false);
  }, []);

  // Add a relative, then fly to the new person so they greet you on the tree.
  const handleAdd = useCallback(
    (fields) => {
      // A biological child's other parent: either an existing partner picked
      // in the sheet (childCoParentId, already set), or a brand-new person
      // named "someone not in the tree" — create THEM first, as a partner of
      // the anchor, so the child's parentEdge below has a real id to target.
      let childCoParentId = fields.childCoParentId || null;
      if (fields.childCoParentMode === 'new' && fields.childCoParentNew?.given) {
        childCoParentId = addRelative({
          anchorId: addAnchorId,
          relKey: 'partner',
          given: fields.childCoParentNew.given,
          family: fields.childCoParentNew.family,
        });
      }
      const newId = addRelative({ anchorId: addAnchorId, ...fields, childCoParentId });
      if (!newId) {
        // Blocked by a constraint — tell the user why instead of silently failing.
        const anchor = graph.byId.get(addAnchorId);
        const first = anchor?.display_name?.split(/\s+/)[0] || 'They';
        const role = fields.relKey === 'mother' ? 'mother' : fields.relKey === 'father' ? 'father' : 'parent';
        setSyncToast(`${first} already has a biological ${role}. Add them as a step or adoptive ${role} instead, or remove the existing one first.`);
        setTimeout(() => setSyncToast(null), 6000);
        return;
      }
      // A mother/father added alongside an already-linked other parent never
      // gets connected to them by addRelative() itself — the sheet asks how
      // the two relate up front (see AddRelativeSheet's coParent prompt) so
      // the couple pod (links.js) renders instead of two disconnected stems.
      if (fields.coParentId && fields.coParentStatus) {
        addRelationship(newId, fields.coParentId, fields.coParentStatus);
      }
      setAddAnchorId(null);
      viewApi.current?.unpin();
      setOpenId(null);
      setReturnToHome(false); // adding a relative lands on the tree, not the hub
      setExpanded((prev) => new Set(prev).add(addAnchorId).add(newId));
      setActiveId(newId);
      // "Add & edit details" — skip the birth-year-only mini form the quick
      // add used to have and go straight to the real profile editor, already
      // in edit mode rather than the read-only view of an almost-blank profile.
      if (fields.openDetails) {
        setTimeout(() => { setEditId(newId); setEditStartInEdit(true); }, 150);
      }
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
    (existingId, relKey, qualifier = 'biological', coParentId = null, coParentStatus = null) => {
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
      // Same co-parent link as the new-person path (see handleAdd) — linking
      // an existing person in as mother/father doesn't otherwise connect them
      // to the other parent already on the tree.
      if (coParentId && coParentStatus) addRelationship(existingId, coParentId, coParentStatus);
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
      // EditPersonSheet always submits the whole form (every field, touched
      // or not), so "the key is present" was never a real signal — only an
      // actual value comparison is. This previously covered barely half of
      // what's editable (nothing for name/gender/colours/contact/deceased/
      // privacy), and unconditionally flagged "tags" on every single save
      // regardless of whether tags changed. Field NAMES only, never values —
      // this is what shows up in the activity feed and the recap tour.
      const changed = (key) => key in fields && fields[key] !== (person?.[key] ?? null);
      const sameTags = (a, b) => {
        const x = a || [], y = b || [];
        return x.length === y.length && x.every((t, i) => t === y[i]);
      };
      const parts = [];
      if (changed('display_name')) parts.push('name');
      if (changed('middle_name')) parts.push('middle name');
      if (changed('birth_name')) parts.push('birth name');
      if (changed('gender')) parts.push('gender');
      if (changed('birth_date')) parts.push('birthdate');
      if (changed('birth_place')) parts.push('birthplace');
      if (changed('residence')) parts.push('location');
      if (changed('occupation')) parts.push('occupation');
      if (changed('military_branch') || changed('military_nation') ||
          changed('military_rank') || changed('military_service_number')) parts.push('military details');
      if (changed('eye_color')) parts.push('eye colour');
      if (changed('hair_color')) parts.push('hair colour');
      if (('email' in fields && fields.email !== (person?.email ?? null)) ||
          ('phone' in fields && fields.phone !== (person?.phone ?? null))) parts.push('contact info');
      if ('tags' in fields && !sameTags(fields.tags, person?.tags)) parts.push('tags');
      if (changed('bio')) parts.push('biography');
      if (changed('is_deceased')) parts.push('deceased status');
      if (changed('death_date')) parts.push('death date');
      if (('visibility' in fields && fields.visibility !== (person?.visibility ?? 'full')) ||
          ('sectionVisibility' in fields && JSON.stringify(fields.sectionVisibility || {}) !== JSON.stringify(person?.sectionVisibility || {}))) {
        parts.push('privacy settings');
      }
      // "a, b and c" rather than "a and b and c" once there's more than two.
      const detail = parts.length === 0 ? null
        : parts.length <= 2 ? parts.join(' and ')
        : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
      const actEvent = detail
        ? { type: 'person_updated', personId: editId, personName: person?.display_name ?? '', detail }
        : null;
      // A human just retyped this field through the ordinary edit form — it's
      // no longer attributable to whichever document (if any) filled it in
      // originally, so a later document deletion must never touch it. See
      // retractDocumentContributions in store.js.
      if (person?.field_sources) {
        let sourcesChanged = false;
        const nextSources = { ...person.field_sources };
        for (const key of DOC_TRACKABLE_FIELDS) {
          if (changed(key) && nextSources[key]) { delete nextSources[key]; sourcesChanged = true; }
        }
        if (sourcesChanged) fields = { ...fields, field_sources: nextSources };
      }
      updatePerson(editId, fields, actEvent);
      setEditId(null);
    },
    [editId, graph],
  );

  const handleRemovePerson = useCallback(() => {
    const id = editId;
    setEditId(null);
    setOpenId(null);
    setReturnToHome(false); // the profile they were viewing is gone — land on the tree
    removePerson(id);
    if (activeId === id) {
      const next = data.myPersonId || data.people.find((p) => p.id !== id)?.id || DEFAULT_FOCUS;
      setActiveId(next);
      setExpanded(new Set([next]));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, activeId, data.myPersonId, data.people]);

  const handleSaveTimeline = useCallback(
    (events, corePatch = {}) => {
      const person = graph.byId.get(timelineId);
      updatePerson(timelineId, { events, ...corePatch }, {
        type: 'person_updated',
        personId: timelineId,
        personName: person?.display_name ?? '',
        detail: 'life events',
      });
      setTimelineId(null);
    },
    [timelineId, graph],
  );

  // Enrich's document-fact review — accept writes a real life event (via the
  // same additive addLifeEvent as everywhere else) and marks the fact
  // consumed; dismiss just marks it, so a re-summarize never re-offers it.
  // A backstop against Enrich's own duplicate filter: if this exact fact is
  // already an obvious duplicate (the Enrich list should have hidden it, but
  // DocViewer's own inline list is filtered separately — see DocViewer's
  // pendingFacts — and either can be stale on an older device), skip writing
  // a second copy of the event and instead opportunistically fill the real
  // profile field it's about (birth place, cause of death) if that field is
  // still empty. Never overwrites something already recorded.
  const applyDocumentFact = useCallback(
    (docId, factIndex) => {
      const doc = data.documents?.find((d) => d.id === docId);
      const fact = doc?.extracted?.facts?.[factIndex];
      if (!doc || !fact) return;
      const person = graph.byId.get(doc.person_id);
      if (person && isDuplicateLifeEvent(person, fact)) {
        const titleLower = (fact.title || '').toLowerCase();
        if (titleLower.includes('born') && !person.birth_place && fact.detail) {
          updatePerson(doc.person_id, { birth_place: fact.detail, field_sources: { ...person.field_sources, birth_place: docId } });
        } else if ((titleLower.includes('died') || titleLower.includes('passed')) && !person.cause_of_death && fact.detail) {
          updatePerson(doc.person_id, { cause_of_death: fact.detail, field_sources: { ...person.field_sources, cause_of_death: docId } });
        }
      } else {
        addLifeEvent(doc.person_id, { year: fact.year, title: fact.title, detail: fact.detail, tag: fact.tag, sourceDocId: docId });
      }
      const facts = doc.extracted.facts.map((f, i) => (i === factIndex ? { ...f, status: 'accepted' } : f));
      updateDocument(docId, { extracted: { ...doc.extracted, facts } });
    },
    [data.documents, graph],
  );
  const dismissDocumentFact = useCallback(
    (docId, factIndex) => {
      const doc = data.documents?.find((d) => d.id === docId);
      if (!doc?.extracted?.facts) return;
      const facts = doc.extracted.facts.map((f, i) => (i === factIndex ? { ...f, status: 'dismissed' } : f));
      updateDocument(docId, { extracted: { ...doc.extracted, facts } });
    },
    [data.documents],
  );

  // Same accept/dismiss contract as document facts, for medals/honours a
  // document summary extracted — accept appends to military_medals via the
  // same additive addMedal used everywhere else, and marks the candidate
  // consumed so a re-summarize never re-offers it.
  const applyDocumentMedal = useCallback(
    (docId, medalIndex) => {
      const doc = data.documents?.find((d) => d.id === docId);
      const medal = doc?.extracted?.medals?.[medalIndex];
      if (!doc || !medal) return;
      addMedal(doc.person_id, { name: medal.name, detail: medal.detail, sourceDocId: docId });
      const medals = doc.extracted.medals.map((m, i) => (i === medalIndex ? { ...m, status: 'accepted' } : m));
      updateDocument(docId, { extracted: { ...doc.extracted, medals } });
    },
    [data.documents],
  );
  const dismissDocumentMedal = useCallback(
    (docId, medalIndex) => {
      const doc = data.documents?.find((d) => d.id === docId);
      if (!doc?.extracted?.medals) return;
      const medals = doc.extracted.medals.map((m, i) => (i === medalIndex ? { ...m, status: 'dismissed' } : m));
      updateDocument(docId, { extracted: { ...doc.extracted, medals } });
    },
    [data.documents],
  );
  // Removing a medal already ON the profile — distinct from dismissing an
  // unaccepted candidate above. There's no live link back to whichever
  // document (if any) produced it, so this is a plain, permanent removal by
  // its position in the list; MilitaryService gates it behind its own
  // "remove this medal?" confirm the same way it does for quotes.
  const handleRemoveMedal = useCallback((personId, index) => {
    removeMedal(personId, index);
  }, []);

  // Relationship-derived findings (Married, Widowed, Became a parent/
  // grandparent — see lib/enrich.js) carry their own complete { key, year,
  // title, detail } right on the action, computed live from the tree each
  // time — no docId/factIndex indirection needed. Accepting just writes the
  // event; dismissing has to be remembered on the person since the
  // underlying marriage/birth/death date never goes away on its own.
  const applyRelationshipFact = useCallback((personId, fact) => {
    addLifeEvent(personId, { year: fact.year, title: fact.title, detail: fact.detail });
  }, []);

  // Same accept/dismiss contract as document facts, for the profile-field
  // candidates (occupation/birth_place/residence) a document summary
  // extracted — accept writes the real field via the same updatePerson every
  // manual edit uses, and marks the candidate consumed so it can't be
  // re-offered by a later re-summarize.
  const applyDocumentField = useCallback(
    (docId, field) => {
      const doc = data.documents?.find((d) => d.id === docId);
      const candidate = doc?.extracted?.profileFields?.[field];
      if (!doc || !candidate) return;
      const person = graph.byId.get(doc.person_id);
      updatePerson(doc.person_id, {
        [field]: candidate.value,
        field_sources: { ...person?.field_sources, [field]: docId },
      }, {
        type: 'person_updated', personId: doc.person_id, personName: person?.display_name ?? '', detail: field.replace(/_/g, ' '),
      });
      const profileFields = { ...doc.extracted.profileFields, [field]: { ...candidate, status: 'accepted' } };
      updateDocument(docId, { extracted: { ...doc.extracted, profileFields } });
    },
    [data.documents, graph],
  );
  const dismissDocumentField = useCallback(
    (docId, field) => {
      const doc = data.documents?.find((d) => d.id === docId);
      const candidate = doc?.extracted?.profileFields?.[field];
      if (!doc || !candidate) return;
      const profileFields = { ...doc.extracted.profileFields, [field]: { ...candidate, status: 'dismissed' } };
      updateDocument(docId, { extracted: { ...doc.extracted, profileFields } });
    },
    [data.documents],
  );

  // Same pattern again for people a document names in a direct family
  // relationship to its subject. The name-match against the tree lives in
  // computeEnrichment (see lib/enrich.js), which is the only place with both
  // the document data and the graph — matchedId comes from its finding, not
  // from the stored document, so it's passed in rather than looked up here.
  // Accept just writes the ordinary addRelationship edge the relation implies.
  const applyDocumentPerson = useCallback(
    (docId, personIndex, matchedId, relation) => {
      const doc = data.documents?.find((d) => d.id === docId);
      const pm = doc?.extracted?.peopleMentioned?.[personIndex];
      if (!doc || !pm) return;
      const subjectId = doc.person_id;
      if (relation === 'parent') addRelationship(matchedId, subjectId, 'parent');
      else if (relation === 'child') addRelationship(subjectId, matchedId, 'parent');
      else if (relation === 'spouse') addRelationship(subjectId, matchedId, 'partner');
      const peopleMentioned = doc.extracted.peopleMentioned.map((p, i) => (i === personIndex ? { ...p, status: 'accepted' } : p));
      updateDocument(docId, { extracted: { ...doc.extracted, peopleMentioned } });
    },
    [data.documents],
  );
  const dismissDocumentPerson = useCallback(
    (docId, personIndex) => {
      const doc = data.documents?.find((d) => d.id === docId);
      if (!doc?.extracted?.peopleMentioned) return;
      const peopleMentioned = doc.extracted.peopleMentioned.map((p, i) => (i === personIndex ? { ...p, status: 'dismissed' } : p));
      updateDocument(docId, { extracted: { ...doc.extracted, peopleMentioned } });
    },
    [data.documents],
  );

  // Fire-and-forget: summarize a freshly uploaded document in the background,
  // so Enrich has facts to harvest without waiting on someone to open the
  // document and press Summarize with AI. summarizeDocument never throws and
  // is best-effort by design; DocViewer's manual button (which only shows
  // while a document has no summary/facts yet) covers the case where this
  // silently fails or the document is closed and reopened before it finishes.
  const autoSummarizeDocument = useCallback(async (docId, src) => {
    try {
      const dataUrl = await srcToDataUrl(src);
      const result = await summarizeDocument(dataUrl);
      if (!result) return;
      updateDocument(docId, { summary: result.summary, extracted: buildExtracted(result) });
    } catch {
      /* background best-effort — manual Summarize with AI button is the fallback */
    }
  }, []);

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

  const handleLogout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    clearLocalData(); // don't leave this user's tree for the next person
    window.location.reload();
  }, []);

  // notify=true emails the invite; notify=false just mints a share link (email
  // optional). Returns { inviteUrl, emailSent, emailError } for the sheet.
  const handleSendInvite = useCallback(async (personId, { email = '', role, notify = true } = {}) => {
    // Personalizes the invite email/landing page and, on acceptance, lets
    // ClaimSpot suggest this exact person instead of only guessing from a
    // later email match — see /api/invite for the (fully optional) fields.
    const personName = data.people.find((p) => p.id === personId)?.display_name || '';
    const res = await fetch('/api/invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, role, notify, person_id: personId, person_name: personName }),
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
  }, [data._meta?.role, data.people]);

  const activePerson = graph.byId.get(activeId);

  // "Back to you" — the map-style recenter control. mePerson is the viewer's
  // own bubble (null in demo / before a user claims a person, in which case
  // the pill simply never renders). goHome reuses the same flight search's
  // "show on map" uses; from me-to-me it's a single-node path, so it lands
  // as a clean activate + camera settle, no flight caption.
  const mePerson = data.myPersonId ? graph.byId.get(data.myPersonId) : null;
  const goHome = useCallback(() => {
    if (data.myPersonId) flyToPersonFromAnywhere(data.myPersonId);
  }, [data.myPersonId, flyToPersonFromAnywhere]);

  // Tree-screen insight surfacing (nav brief: "surface one real insight from
  // the tree screen itself, not just Home"). Computed once per graph change;
  // the per-focus lookup off it is cheap. Deliberately silent far more often
  // than not — see personHighlight.
  const insightModules = useMemo(
    () => computeInsightModules(graph, data.myPersonId || DEFAULT_FOCUS),
    [graph, data.myPersonId],
  );
  const activeFact = useMemo(
    () => personHighlight(graph, data.myPersonId || DEFAULT_FOCUS, activeId, insightModules),
    [graph, data.myPersonId, activeId, insightModules],
  );
  // The tree screen's ambient hint cycles through several facts per browsing
  // session (see IdleFactHint) rather than the home hub's single fixed daily
  // pick, so it needs the whole pool, not pickDailyHighlight's one string.
  const highlightPool = useMemo(() => highlightCandidates(insightModules), [insightModules]);

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
    homeOpen || howItWorksOpen || familyTreesOpen || searchOpen || duplicatesOpen || promptClaim || showInstall ||
    keepsakeId
  );

  // Desktop "just start typing" search (feature request: a keyboard-first
  // shortcut like Gmail/Linear/Notion's — press a letter with nothing else
  // going on and the search sheet opens already carrying what you typed,
  // rather than requiring a click on the search icon first). Deliberately
  // narrow: only a bare printable key (no Ctrl/Cmd/Alt, so every browser and
  // OS shortcut still works untouched), only while nothing else is already
  // open (anyOverlayOpen, above — the same consolidated flag every other "is
  // something already showing" check in this file uses) and only while
  // nothing already has focus (typing into a bio text field, a name input
  // inside some other sheet, etc. must never be hijacked — activeElement is
  // the canvas or plain body whenever the tree itself has "focus"). Mobile
  // has no physical keyboard to fire this from, so it's inherently
  // desktop-only without needing its own device check.
  useEffect(() => {
    function onGlobalKeydown(e) {
      if (anyOverlayOpen) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1 || e.key === ' ') return;
      const el = document.activeElement;
      if (el && el !== document.body && el.tagName !== 'CANVAS') return;
      // Without this, the same keydown's native default action (inserting a
      // character) fires a second time into the search input once it's
      // synchronously focused below — doubling the very first letter typed.
      e.preventDefault();
      flushSync(() => { setSearchInitialQuery(e.key); setSearchOpen(true); });
      const input = document.querySelector('.search-input');
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }
    window.addEventListener('keydown', onGlobalKeydown);
    return () => window.removeEventListener('keydown', onGlobalKeydown);
  }, [anyOverlayOpen]);

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
        layout={layout}
        syncStatus={syncStatus}
        syncError={syncError}
        onRetrySync={() => saveToServer()}
        onSetViewMode={(mode) => {
          if (mode === 'list') { setView('list'); return; }
          setView('bubbles');
          setLayout(mode === 'chart' ? 'chart' : 'organic');
          // Chart is a pedigree — bloodline-only is its natural default.
          // Tree's is everyone. Each switch between the two resets to that
          // view's own default; List is untouched (mode === 'list' already
          // returned above), and the manual toggle still works freely
          // within whichever view you're in.
          setBloodlineOnly(mode === 'chart');
        }}
        onOpenLegend={() => setLegendOpen(true)}
        bloodlineOnly={bloodlineOnly}
        onToggleBloodlineOnly={() => setBloodlineOnly((v) => !v)}
        onOpenActivity={() => {
          setActivityOpen(true);
          const now = Date.now();
          setLastReadAt(now);
          setActivityReadAt(now);
        }}
        activityCount={unreadCount}
        user={user}
        userPhoto={userPhoto}
        onOpenProfile={user ? () => setProfileOpen(true) : null}
        onOpenHome={() => { setHomeOpen(true); if (showHomeNudge) dismissHomeNudge(); }}
        onSearch={openSearch}
        onOpenInsights={() => setInsightsOpen(true)}
        onOpenTimeline={() => setTimelineOpen(true)}
        duplicateCount={canManageTreeStructure ? duplicatePairs.length : 0}
        onOpenDuplicates={canManageTreeStructure && duplicatePairs.length ? () => setDuplicatesOpen(true) : null}
        storageWarning={storageWarning}
        storageNearLimit={storageNearLimit}
        treeSizeWarning={treeSizeWarning}
        syncToast={syncToast}
        onDismissSyncToast={() => setSyncToast(null)}
        recapNudgeCount={recapNudge ? recapGroups.length : 0}
        onShowRecap={() => { setRecapNudge(false); openRecap(); }}
        onDismissRecapNudge={() => { setRecapNudge(false); markRecapSeen(); }}
      />

      {view === 'bubbles' ? (
        layout === 'chart' ? (
          <ChartTree
            graph={graph}
            activeId={activeId}
            viewerId={data.myPersonId || DEFAULT_FOCUS}
            bloodlineOnly={bloodlineOnly}
            onOpenPerson={openPerson}
            onAddRelative={setAddAnchorId}
            onActivate={activateNormal}
          />
        ) : (
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
            fact={activeFact}
            getPos={() => viewApi.current?.getScreenPos(activeId)}
            // Also hidden while the active person is themselves being hovered —
            // HoverCard takes over then, showing the same richer view everyone
            // else gets on hover instead of the plain name+dates nameplate.
            hidden={anyOverlayOpen || browse || layout === 'chart' || hoveredId === activeId}
          />
          {/* Second nameplate for "Show both in tree" — comparePairIds[0] is
              always activeId itself (already covered above), so this one is
              strictly the OTHER candidate, who can never be the literal
              ego-camera active id and so would otherwise never get a plate at
              all. Hidden the moment activeId drifts away from the pair this
              was triggered for (the user's moved on to browsing something
              else), so a stale plate can't linger over an unrelated bubble. */}
          {comparePairIds && (
            <FocusNameplate
              person={graph.byId.get(comparePairIds[1])}
              fact={null}
              getPos={() => viewApi.current?.getScreenPos(comparePairIds[1])}
              hidden={
                anyOverlayOpen || browse || layout === 'chart'
                || hoveredId === comparePairIds[1]
                || activeId !== comparePairIds[0]
              }
            />
          )}
          <HoverCard
            graph={graph}
            personId={!anyOverlayOpen && layout !== 'chart' ? hoveredId : null}
            viewerId={data.myPersonId || DEFAULT_FOCUS}
            getPos={() => viewApi.current?.getScreenPos(hoveredId)}
            photos={data.photos}
            documents={data.documents}
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
                {timeMode && (lifeJourneyPerson || worldEvent) && (() => {
                  const ev = lifeJourneyPerson?.events?.find(
                    (e) => Math.abs(parseInt(e.year) - timeYear) <= 1,
                  );
                  const visible = !!ev || (!lifeJourneyPerson && !!worldEvent);
                  return (
                    <div className={`life-event-card${visible ? ' life-event-card--visible' : ''}`}>
                      <div className="life-event-card__meta">
                        {lifeJourneyPerson && (
                          <span className="life-event-card__who">{lifeJourneyPerson.display_name.split(' ')[0]}</span>
                        )}
                        <span className="life-event-card__year">{timeYear}</span>
                      </div>
                      <p className="life-event-card__title">
                        {lifeJourneyPerson ? (ev?.title ?? '\u00a0') : (worldEvent?.title ?? '\u00a0')}
                      </p>
                      {lifeJourneyPerson && worldEvent && (
                        <p className="life-event-card__world"><GlobeIcon /> {worldEvent.title}</p>
                      )}
                    </div>
                  );
                })()}
                {timeMode && (
                  <div className="time-slider-wrap">
                    <button
                      className={`time-play${timePlaying ? ' time-play--on' : ''}`}
                      onClick={() => {
                        const starting = !timePlaying;
                        if (starting && timeYear >= yearRange.max) {
                          setTimeYear(lifeJourneyPerson?.birth_date ? parseInt(lifeJourneyPerson.birth_date) : yearRange.min);
                        }
                        // Starting general playback (not a life journey, which
                        // is deliberately about one person's card staying up)
                        // drops any active selection first — otherwise
                        // whoever was last focused keeps dimming everyone
                        // else for the whole time-lapse, and their nameplate
                        // keeps floating on screen for no reason once you've
                        // hit play to watch the WHOLE family unfold.
                        if (starting && !lifeJourneyId) deselect();
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
                    if (timeMode) { exitTimeMode(); return; }
                    setTimeYear(new Date().getFullYear());
                    setTimePlaying(false);
                    setTimeMode(true);
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
                    ? lineageOrder
                      // Edges, not people — matches the banner's own connector
                      // count (order.length would double-count as "3 links"
                      // for a 2-hop, 3-person line like a grandparent trace).
                      ? `${lineageOrder.length - 1} links`
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
          {/* "Back to you" — contextual, only when the tree isn't already
              framed on the viewer and no full-screen mode is running. */}
          <HomeToMe
            person={mePerson}
            visible={
              !!mePerson &&
              activeId !== data.myPersonId &&
              !lineageMode && !timeMode && !flightCaption &&
              !anyOverlayOpen && recapQueue.length === 0
            }
            onGoHome={goHome}
          />
          {/* Time mode's own contextual exit — Lineage mode already has one
              on its banner ("Done"); Time mode had only the dock icon. */}
          <ReturnToTreePill
            visible={timeMode && !anyOverlayOpen}
            onReturn={exitTimeMode}
          />
          {!lineageMode && !flightCaption && <IntroHint />}
          {!lineageMode && !flightCaption && (
            <IdleFactHint facts={highlightPool} active={browse && !anyOverlayOpen} />
          )}
          {lineageMode && (
            <LineageBanner
              graph={graph}
              anchorId={activeId}
              order={lineageOrder}
              onClear={() => { setLineagePath(null); setLineageOrder(null); }}
              onExit={toggleLineage}
              onPeek={(id) => viewApi.current?.pulseBubble(id)}
              onSearch={openSearch}
            />
          )}
          {flightCaption && (
            <FlightCaption
              graph={graph}
              order={flightCaption.order}
              upTo={flightCaption.upTo}
              landed={!!flightCaption.landed}
              onDone={() => setFlightCaption(null)}
              onPeek={(id) => viewApi.current?.pulseBubble(id)}
            />
          )}
        </>
        )
      ) : (
        <AccessibleTree
          graph={graph}
          focusId={activeId}
          onFocus={activate}
          onOpenPerson={openPerson}
          onShowOnMap={flyToPersonFromAnywhere}
          onShowInChart={showPersonInChart}
        />
      )}

      <PersonSheet
        graph={graph}
        personId={openId}
        viewerId={data.myPersonId || DEFAULT_FOCUS}
        memories={data.memories}
        photos={data.photos}
        documents={data.documents}
        activity={data.activity}
        canEdit={canEditTree}
        canContribute={canContributeTree}
        isAdmin={canManageTreeStructure}
        lockEscape={!!(addAnchorId || editId || timelineId || memoryId || lightbox || crop || invitePersonId || duplicatesOpen || keepsakeId)}
        onClose={closePerson}
        onFocus={(id) => {
          closePersonForTreeAction();
          activate(id);
        }}
        onShowOnMap={(id) => {
          closePersonForTreeAction();
          flyToPersonFromAnywhere(id);
        }}
        onOpenPerson={openPerson}
        onAddRelative={setAddAnchorId}
        onEdit={setEditId}
        onEditTimeline={setTimelineId}
        onAddMemory={setMemoryId}
        onVoteMemory={toggleMemoryVote}
        onRemoveMemory={removeMemory}
        onUpdateMemory={updateMemory}
        onAddPhoto={(id, src) => addPhoto(id, { src })}
        onOpenLightbox={(personId, index) => setLightbox({ personId, index })}
        onAddDocument={(personId, fields) => {
          const docId = addDocument(personId, fields);
          autoSummarizeDocument(docId, fields.src);
          return docId;
        }}
        onOpenDocument={(doc) => setDocViewer({ id: doc.id, personId: doc.person_id, title: doc.title, src: doc.src, mime: doc.mime, summary: doc.summary, extracted: doc.extracted })}
        onRemoveDocument={(id) => {
          const doc = data.documents?.find((d) => d.id === id);
          if (doc?.src?.startsWith('/api/documents/')) {
            fetch(doc.src, { method: 'DELETE' }).catch(() => {});
          }
          // Undo whatever this document actually wrote before removing it —
          // the root-cause fix for a document accepted onto the wrong
          // person: deleting it now retracts its own events/medals/fields
          // instead of leaving them behind forever. See
          // retractDocumentContributions in store.js for what it does and
          // deliberately does NOT touch (relationships).
          if (doc) retractDocumentContributions(doc.person_id, id);
          removeDocument(id);
        }}
        onUpdateDocument={(id, patch) => updateDocument(id, patch)}
        onRemoveRelationship={removeRelationship}
        onUpdateRelationshipQualifier={updateRelationshipQualifier}
        onChangeRelationship={handleChangeRelType}
        onUpdatePartnerMeta={(aId, bId, meta) => updatePartnerMeta(aId, bId, meta)}
        onUpdateStory={(id, story) => {
          const person = graph.byId.get(id);
          updatePerson(id, { story }, { type: 'person_updated', personId: id, personName: person?.display_name ?? '', detail: 'life story' });
        }}
        onOpenKeepsake={(id) => setKeepsakeId(id)}
        onUpdateMilitaryStory={(id, military_story) => {
          const person = graph.byId.get(id);
          updatePerson(id, { military_story }, { type: 'person_updated', personId: id, personName: person?.display_name ?? '', detail: 'military service story' });
        }}
        onUpdateMilitaryContext={(id, military_context) => {
          const person = graph.byId.get(id);
          updatePerson(id, { military_context }, { type: 'person_updated', personId: id, personName: person?.display_name ?? '', detail: 'military historical context' });
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
        onReviewDuplicate={openDuplicatesFor}
        onApplyEnrichedPlace={(id, key, value) => {
          const person = graph.byId.get(id);
          const label = key === 'birth_place' ? 'birthplace' : 'residence';
          updatePerson(id, { [key]: value }, { type: 'person_updated', personId: id, personName: person?.display_name ?? '', detail: label });
        }}
        onApplyDocumentFact={applyDocumentFact}
        onDismissDocumentFact={dismissDocumentFact}
        onApplyDocumentMedal={applyDocumentMedal}
        onDismissDocumentMedal={dismissDocumentMedal}
        onRemoveMedal={handleRemoveMedal}
        onApplyDocumentField={applyDocumentField}
        onDismissDocumentField={dismissDocumentField}
        onApplyDocumentPerson={applyDocumentPerson}
        onDismissDocumentPerson={dismissDocumentPerson}
        onApplyRelationshipFact={applyRelationshipFact}
        onDismissRelationshipFact={dismissRelationshipFact}
      />

      {searchOpen && (
        <SearchOverlay
          people={data.people}
          graph={graph}
          viewerId={data.myPersonId || DEFAULT_FOCUS}
          onSelect={selectFromSearch}
          onClose={() => { setSearchOpen(false); setSearchInitialQuery(null); }}
          hint={lineageMode ? `Tracing from ${(activePerson?.display_name || 'this person').split(' ')[0]} — pick who to connect to` : null}
          initialQuery={searchInitialQuery}
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

      {keepsakeId && (
        <KeepsakeView
          graph={graph}
          personId={keepsakeId}
          memories={data.memories}
          photos={data.photos}
          documents={data.documents}
          activity={data.activity}
          familyName={data.familyName}
          canEdit={canEditTree}
          onClose={() => setKeepsakeId(null)}
          onCompiled={(edition) => {
            const person = graph.byId.get(keepsakeId);
            const n = edition.editionNumber;
            const ord = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'][n - 1] || `${n}th`;
            logActivity({
              type: 'keepsake_generated',
              personId: keepsakeId,
              personName: person?.display_name ?? '',
              detail: `${ord} edition`,
            });
          }}
        />
      )}

      {duplicatesOpen && (
        <DuplicatesSheet
          pairs={duplicatesFocusId
            ? duplicatePairs.filter((p) => p.aId === duplicatesFocusId || p.bId === duplicatesFocusId)
            : duplicatePairs}
          graph={graph}
          onMerge={(keepId, dropId) => { mergePeople(keepId, dropId); if (activeId === dropId) activate(keepId); }}
          onDismiss={dismissDuplicatePair}
          onShowInTree={showDuplicatePairInTree}
          onClose={() => { setDuplicatesOpen(false); setDuplicatesFocusId(null); }}
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
          suggestedPersonId={suggestedClaimPersonId}
          onClaim={handleClaimSpot}
          onSkip={markClaimSeen}
        />
      )}

      {showInstall && (
        <InstallPrompt installEvent={installEvent} onClose={dismissInstall} />
      )}

      {showHomeNudge && !anyOverlayOpen && (
        <HomeNudge onDismiss={dismissHomeNudge} />
      )}

      {addAnchorId && graph.byId.get(addAnchorId) && (
        <AddRelativeSheet
          anchor={graph.byId.get(addAnchorId)}
          people={data.people.filter((p) => p.id !== addAnchorId)}
          relationships={data.relationships}
          graph={graph}
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
          startInEdit={editStartInEdit}
          onClose={() => { setEditId(null); setEditStartInEdit(false); }}
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
          viewerName={graph.byId.get(data.myPersonId || DEFAULT_FOCUS)?.display_name}
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
        <DocViewer
          doc={docViewer}
          person={graph.byId.get(docViewer.personId)}
          onClose={() => setDocViewer(null)}
          onSummarized={(result) => {
            const extracted = buildExtracted(result);
            setDocViewer((d) => (d ? { ...d, summary: result.summary, extracted } : d));
            if (docViewer.id) updateDocument(docViewer.id, { summary: result.summary, extracted });
          }}
          onApplyDocumentFact={applyDocumentFact}
          onDismissDocumentFact={dismissDocumentFact}
          onApplyDocumentField={applyDocumentField}
          onDismissDocumentField={dismissDocumentField}
        />
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
          recapCount={recapGroups.length}
          onShowRecap={openRecap}
        />
      )}

      {recapOpen && (
        <RecapTour
          queue={recapQueue}
          reducedMotion={reducedMotion}
          allDone={recapAllDone}
          onCloseAll={closeRecapAll}
          onClose={closeRecapAll}
        />
      )}

      {settingsOpen && (
        <FamilySettings
          myRole={user ? (data._meta?.role || 'owner') : 'owner'}
          familyName={data.familyName || 'My Family'}
          onUpdateFamilyName={updateFamilyName}
          onReset={resetTree}
          onLogout={user ? handleLogout : null}
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
          onLogout={handleLogout}
          onSaved={(updated) => {
            setUser((u) => ({ ...u, ...updated }));
            setCurrentUser({ ...user, ...updated });
          }}
          onPhoto={handlePhoto}
        />
      )}

      {homeOpen && (
        <Home
          user={user}
          familyName={data.familyName}
          stats={familyStats}
          activity={data.activity ?? []}
          people={data.people}
          graph={graph}
          userEmail={user?.email}
          onClose={() => setHomeOpen(false)}
          onOpenAccount={() => { setHomeOpen(false); setProfileOpen(true); }}
          onLogout={user ? handleLogout : null}
          onOpenInstall={() => { setHomeOpen(false); setShowInstall(true); }}
          onOpenHowItWorks={() => { setHomeOpen(false); setHowItWorksOpen(true); }}
          onOpenFamilyTrees={() => { setHomeOpen(false); setFamilyTreesOpen(true); }}
          onOpenFamilySettings={() => { setHomeOpen(false); setSettingsOpen(true); }}
          onOpenInsights={() => { setHomeOpen(false); setInsightsOpen(true); }}
          keepsakeNudge={keepsakeNudge}
          onOpenKeepsake={data.myPersonId ? () => { setHomeOpen(false); setKeepsakeId(data.myPersonId); } : null}
          onOpenActivity={() => {
            setHomeOpen(false);
            setActivityOpen(true);
            const now = Date.now();
            setLastReadAt(now);
            setActivityReadAt(now);
          }}
          onSelectPerson={(id) => {
            setHomeOpen(false);
            const person = graph.byId.get(id);
            if (person) { setReturnToHome(true); openPerson(id); }
          }}
        />
      )}

      {/* Both subpages are reached only from the hub, so their back button
          always returns there — not the bare tree. */}
      {howItWorksOpen && (
        <HowItWorks onClose={() => { setHowItWorksOpen(false); setHomeOpen(true); }} />
      )}

      {familyTreesOpen && (
        <FamilyTrees
          user={user}
          onClose={() => { setFamilyTreesOpen(false); setHomeOpen(true); }}
          onGoToTree={() => setFamilyTreesOpen(false)}
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
          existingPeople={data.people}
          existingRelationships={data.relationships}
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
          existingPeople={data.people}
          existingRelationships={data.relationships}
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
function DocViewer({
  doc, person, onClose, onSummarized,
  onApplyDocumentFact, onDismissDocumentFact,
  onApplyDocumentField, onDismissDocumentField,
}) {
  const isImage = doc.mime?.startsWith('image/');
  const isPdf = doc.mime === 'application/pdf';
  const { xf, stageRef, handlers } = useImageZoom();
  // A second, independent zoom instance for the fullscreen view below — once
  // the AI summary and facts are showing, the inline preview above them is
  // squeezed down to make room, so this is the "still crisp, still zoomable"
  // escape hatch back to a full-viewport view of the original scan.
  const full = useImageZoom();
  const [fullscreen, setFullscreen] = useState(false);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | error
  const [summaryState, setSummaryState] = useState('idle'); // idle | working | error
  const [summary, setSummary] = useState(doc.summary || null);
  // Dismissing a fact/field marks it consumed on the document (never
  // re-offered), the same one-way step as accepting — so it gets the same
  // "are you sure" confirm every other dismiss surface in the app uses.
  // Keyed by 'fact:<index>' / 'field:<name>' so only the one row being
  // confirmed shows it.
  const [confirmDismiss, setConfirmDismiss] = useState(null);
  const [facts, setFacts] = useState(doc.extracted?.facts || []);
  const [profileFields, setProfileFields] = useState(doc.extracted?.profileFields || null);
  // Never offer a fact that's already an obvious duplicate of something on
  // the profile (the derived Born/Passed-away entry, or a stored event) —
  // same check Enrich uses, so the two surfaces never disagree about what's
  // still worth reviewing.
  const pendingFacts = facts.filter((f) => f.status === 'pending' && f.year && !(person && isDuplicateLifeEvent(person, f)));
  const pendingFields = ['occupation', 'birth_place', 'residence']
    .filter((field) => profileFields?.[field]?.status === 'pending');

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (fullscreen) setFullscreen(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, fullscreen]);

  // Never carry over zoom/pan from a previous fullscreen visit.
  useEffect(() => {
    if (fullscreen) full.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen]);

  async function handleSave() {
    if (saveState === 'saving') return;
    setSaveState('saving');
    try {
      const ext = isPdf ? 'pdf' : doc.mime?.split('/')[1] || 'jpg';
      await savePhotoToDevice(doc.src, `${(doc.title || 'document').replace(/[^\w-]+/g, '_')}.${ext}`);
      setSaveState('idle');
    } catch (e) {
      console.warn('[doc viewer] save failed:', e.message);
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 2500);
    }
  }

  async function handleSummarize() {
    if (summaryState === 'working') return;
    setSummaryState('working');
    try {
      const dataUrl = await srcToDataUrl(doc.src);
      const result = await summarizeDocument(dataUrl);
      if (result) {
        const extracted = buildExtracted(result);
        setSummary(result.summary);
        setFacts(extracted.facts);
        setProfileFields(extracted.profileFields);
        onSummarized?.(result);
        setSummaryState('idle');
      } else {
        setSummaryState('error');
      }
    } catch (e) {
      console.warn('[doc viewer] summarize failed:', e.message);
      setSummaryState('error');
    }
  }

  function resolveFact(index, status) {
    setFacts((fs) => fs.map((f, i) => (i === index ? { ...f, status } : f)));
    if (status === 'accepted') onApplyDocumentFact?.(doc.id, index);
    else onDismissDocumentFact?.(doc.id, index);
  }

  function resolveField(field, status) {
    setProfileFields((pf) => (pf ? { ...pf, [field]: { ...pf[field], status } } : pf));
    if (status === 'accepted') onApplyDocumentField?.(doc.id, field);
    else onDismissDocumentField?.(doc.id, field);
  }

  return (
    <>
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
          <div className="doc-viewer__img-wrap" ref={stageRef}>
            <img
              className="doc-viewer__img"
              src={doc.src}
              alt={doc.title}
              crossOrigin="anonymous"
              draggable={false}
              style={{ transform: `translate(${xf.x}px, ${xf.y}px) scale(${xf.scale})` }}
              onPointerDown={(e) => { e.stopPropagation(); handlers.onPointerDown(e); }}
              onPointerMove={(e) => { e.stopPropagation(); handlers.onPointerMove(e); }}
              onPointerUp={(e) => { e.stopPropagation(); handlers.onPointerUp(e); }}
              onPointerCancel={(e) => { e.stopPropagation(); handlers.onPointerCancel(e); }}
              onWheel={(e) => { e.stopPropagation(); handlers.onWheel(e); }}
              onClick={(e) => e.stopPropagation()}
            />
            <button
              className="doc-viewer__expand"
              onClick={(e) => { e.stopPropagation(); setFullscreen(true); }}
              aria-label="View full size"
              title="View full size"
            >
              <ExpandIcon />
            </button>
          </div>
        ) : isPdf ? (
          <Suspense fallback={<div className="pdf-viewer__stage"><div className="mw__spinner" aria-label="Loading" /></div>}>
            <PdfViewer src={doc.src} />
          </Suspense>
        ) : (
          <div className="pdf-viewer__fallback">
            <p>This file type can't be previewed here.</p>
            <a href={doc.src} target="_blank" rel="noreferrer" className="pdf-viewer__open-link">
              Open in a new tab
            </a>
          </div>
        )}
        {summary && (
          <div className="doc-viewer__summary">
            <span className="doc-viewer__summary-label">AI summary</span>
            <p>{summary}</p>
          </div>
        )}
        {pendingFacts.length > 0 && (
          <div className="doc-viewer__facts">
            <span className="doc-viewer__summary-label">Life events found in this document</span>
            {facts.map((f, i) => {
              if (f.status !== 'pending' || !f.year) return null;
              const key = `fact:${i}`;
              const confirming = confirmDismiss === key;
              return (
                <div className="doc-fact" key={i}>
                  <div className="doc-fact__body">
                    {f.tag === 'military' && (
                      <span className="timeline__ribbon" title="Military service" aria-label="Military service">
                        <RibbonIconSmall />
                      </span>
                    )}
                    <span className="doc-fact__title">{f.title} — {f.year}</span>
                    {f.detail && <span className="doc-fact__detail">{f.detail}</span>}
                  </div>
                  {confirming ? (
                    <div className="doc-fact__confirm">
                      <span>Dismiss this suggestion?</span>
                      <div className="doc-fact__confirm-btns">
                        <button className="doc-card__confirm-remove" onClick={() => { resolveFact(i, 'dismissed'); setConfirmDismiss(null); }}>Dismiss</button>
                        <button className="doc-card__confirm-cancel" onClick={() => setConfirmDismiss(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="doc-fact__actions">
                      <button className="enrich__row-action" onClick={() => resolveFact(i, 'accepted')}>Add</button>
                      <button className="enrich__row-dismiss" onClick={() => setConfirmDismiss(key)}>Dismiss</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {pendingFields.length > 0 && (
          <div className="doc-viewer__facts">
            <span className="doc-viewer__summary-label">Profile details found in this document</span>
            {pendingFields.map((field) => {
              const key = `field:${field}`;
              const confirming = confirmDismiss === key;
              return (
                <div className="doc-fact" key={field}>
                  <div className="doc-fact__body">
                    <span className="doc-fact__title">{DOC_FIELD_LABEL[field]}</span>
                    <span className="doc-fact__detail">{profileFields[field].value}</span>
                  </div>
                  {confirming ? (
                    <div className="doc-fact__confirm">
                      <span>Dismiss this suggestion?</span>
                      <div className="doc-fact__confirm-btns">
                        <button className="doc-card__confirm-remove" onClick={() => { resolveField(field, 'dismissed'); setConfirmDismiss(null); }}>Dismiss</button>
                        <button className="doc-card__confirm-cancel" onClick={() => setConfirmDismiss(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="doc-fact__actions">
                      <button className="enrich__row-action" onClick={() => resolveField(field, 'accepted')}>Add</button>
                      <button className="enrich__row-dismiss" onClick={() => setConfirmDismiss(key)}>Dismiss</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {(isImage || isPdf) && (
          <div className="doc-viewer__bar doc-viewer__bar--bottom">
            <button className="doc-viewer__save" onClick={handleSave} disabled={saveState === 'saving'}>
              {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? "Couldn't save" : 'Save'}
            </button>
            <button className="doc-viewer__save" onClick={handleSummarize} disabled={summaryState === 'working'}>
              {summaryState === 'working' ? 'Reading…'
                : summaryState === 'error' ? "Couldn't summarize"
                : summary || facts.length ? 'Re-summarize'
                : 'Summarize with AI'}
            </button>
          </div>
        )}
      </div>
    </div>
    {fullscreen && isImage && (
      <div className="doc-fullscreen" onClick={() => setFullscreen(false)}>
        <button
          className="doc-fullscreen__close"
          onClick={(e) => { e.stopPropagation(); setFullscreen(false); }}
          aria-label="Close full size view"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <div className="doc-fullscreen__stage" ref={full.stageRef}>
          <img
            className="doc-fullscreen__img"
            src={doc.src}
            alt={doc.title}
            crossOrigin="anonymous"
            draggable={false}
            style={{ transform: `translate(${full.xf.x}px, ${full.xf.y}px) scale(${full.xf.scale})` }}
            onPointerDown={(e) => { e.stopPropagation(); full.handlers.onPointerDown(e); }}
            onPointerMove={(e) => { e.stopPropagation(); full.handlers.onPointerMove(e); }}
            onPointerUp={(e) => { e.stopPropagation(); full.handlers.onPointerUp(e); }}
            onPointerCancel={(e) => { e.stopPropagation(); full.handlers.onPointerCancel(e); }}
            onWheel={(e) => { e.stopPropagation(); full.handlers.onWheel(e); }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>
    )}
    </>
  );
}

function ExpandIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 3H3v6M15 21h6v-6M21 3l-7 7M3 21l7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RibbonIconSmall() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 13l-2 8 5.5-3 5.5 3-2-8" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
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
function GlobeIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" stroke="currentColor" strokeWidth="1.5" />
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
      <Logo size={42} animate={false} loading />
    </div>
  );
}

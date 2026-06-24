import { useMemo, useState, useCallback, useRef, useEffect, useSyncExternalStore } from 'react';
import './styles/components.css';
import { DEFAULT_FOCUS } from './data/seed.js';
import {
  store,
  syncStore,
  addRelative,
  addRelationship,
  removeRelationship,
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
  loadFromServer,
  saveToServer,
  enableServerSync,
  updateFamilyName,
  resetTree,
  migratePhotosToR2,
  migrateDocsToR2,
} from './data/store.js';
import { uploadPhoto, generateThumb, uploadDocument } from './lib/image.js';
import { buildGraph, pathBetween } from './data/graph.js';
import { useReducedMotion } from './hooks/useReducedMotion.js';
import BubbleTree from './viz/BubbleTree.jsx';
import TopBar from './components/TopBar.jsx';
import FocusNameplate from './components/FocusNameplate.jsx';
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
import MergeWizard from './components/MergeWizard.jsx';
import InviteSheet from './components/InviteSheet.jsx';

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

export default function App() {
  const data = useSyncExternalStore(store.subscribe, store.getState);
  const syncStatus = useSyncExternalStore(syncStore.subscribe, syncStore.getState);
  const graph = useMemo(() => buildGraph(data.people, data.relationships), [data]);
  const reducedMotion = useReducedMotion();

  // 'loading' → 'open' (no auth / bypass) | 'login' (needs sign-in) | 'authed'
  const [authState, setAuthState] = useState(isDemo ? 'open' : 'loading');
  const [user, setUser] = useState(null);
  // Set when a user with existing tree data accepts an invite — gates the app
  // on the merge wizard until they complete or skip the merge.
  const [pendingInvite, setPendingInvite] = useState(_initialPendingInvite);

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
    if (!hadTree && !joiningFamily) await saveToServer();
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
  }

  useEffect(() => {
    if (isDemo) return;
    applySession().catch(() => setAuthState('open'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const [lineageMode, setLineageMode] = useState(false);
  const [lineagePath, setLineagePath] = useState(null); // Set<id> | null
  const [cameraFree, setCameraFree] = useState(false); // user has panned/zoomed away
  const [storageWarning, setStorageWarning] = useState(false);
  const [syncToast, setSyncToast] = useState(null);
  const [layout, setLayout] = useState('organic'); // 'organic' | 'weighted' | 'hybrid'
  const [timeMode, setTimeMode] = useState(false);
  const [timeYear, setTimeYear] = useState(new Date().getFullYear());
  const [timePlaying, setTimePlaying] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [lifeJourneyId, setLifeJourneyId] = useState(null);
  const playRef = useRef(null);
  const [docViewer, setDocViewer] = useState(null); // { title, src, mime }
  const [invitePersonId, setInvitePersonId] = useState(null);
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

  const invitedIds = useMemo(
    () => new Set(data.people.filter((p) => p.invited_at).map((p) => p.id)),
    [data.people],
  );

  // Family stats for the header: people, generation depth, photos, memories.
  const familyStats = useMemo(() => {
    const visited = new Map();
    const compute = (id, guard) => {
      if (visited.has(id)) return visited.get(id);
      if (guard.has(id)) return 0;
      guard.add(id);
      const parents = graph.parents(id);
      let g = 0;
      for (const p of parents) g = Math.max(g, compute(p.id, guard) + 1);
      guard.delete(id);
      visited.set(id, g);
      return g;
    };
    for (const p of graph.people) compute(p.id, new Set());
    const generations = visited.size > 0 ? Math.max(...visited.values()) + 1 : 1;
    return { people: graph.people.length, generations, photos: data.photos.length, memories: data.memories.length };
  }, [graph, data.photos.length, data.memories.length]);

  // Time slider: the range of known birth years across all people.
  const yearRange = useMemo(() => {
    let min = new Date().getFullYear(), max = min;
    for (const p of data.people) {
      const by = p.birth_date ? parseInt(p.birth_date) : null;
      if (by && by < min) min = by;
      if (by && by > max) max = by;
    }
    return { min: min - 5, max: new Date().getFullYear() };
  }, [data.people]);

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

  // Focus Family: active person's nuclear family + grandchildren.
  const focusFamilyIds = useMemo(() => {
    if (!focusMode) return null;
    const ids = new Set([activeId]);
    for (const p of graph.parents(activeId)) ids.add(p.id);
    for (const p of graph.partners(activeId)) ids.add(p.id);
    for (const c of graph.children(activeId)) {
      ids.add(c.id);
      for (const gc of graph.children(c.id)) ids.add(gc.id);
    }
    return ids;
  }, [focusMode, activeId, graph]);

  const visibleIds = useMemo(() => {
    const vis = new Set();
    for (const id of expanded) {
      if (aliveAtYear && !aliveAtYear.has(id)) continue;
      vis.add(id);
      for (const x of graph.parents(id)) { if (!aliveAtYear || aliveAtYear.has(x.id)) vis.add(x.id); }
      for (const x of graph.children(id)) { if (!aliveAtYear || aliveAtYear.has(x.id)) vis.add(x.id); }
      for (const x of graph.partners(id)) { if (!aliveAtYear || aliveAtYear.has(x.id)) vis.add(x.id); }
      for (const x of graph.siblings(id)) { if (!aliveAtYear || aliveAtYear.has(x.id)) vis.add(x.id); }
    }
    // Focus mode: collapse everyone outside the nuclear family
    if (focusFamilyIds) {
      for (const id of [...vis]) {
        if (!focusFamilyIds.has(id)) vis.delete(id);
      }
    }
    return vis;
  }, [graph, expanded, aliveAtYear, focusFamilyIds]);

  // Play animation: life journey = 350 ms/step (cinematic), time mode = 200 ms/step.
  useEffect(() => {
    clearInterval(playRef.current);
    if (!timePlaying) return;
    const interval = lifeJourneyId ? 350 : 200;
    playRef.current = setInterval(() => {
      setTimeYear((y) => {
        if (y >= yearRange.max) { setTimePlaying(false); return y; }
        return y + 1;
      });
    }, interval);
    return () => clearInterval(playRef.current);
  }, [timePlaying, yearRange.max, lifeJourneyId]);

  const activateNormal = useCallback((id) => {
    setActiveId(id);
    setExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    setLineagePath(null);
    setFocusMode(false); // navigating exits focus mode
    setLifeJourneyId(null);
  }, []);

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
      if (lineageMode) {
        if (id === activeId) {
          setLineagePath(null);
        } else {
          setLineagePath(pathBetween(graph, activeId, id));
        }
      } else {
        activateNormal(id);
      }
    },
    [lineageMode, activeId, graph, activateNormal],
  );

  const toggleLineage = useCallback(() => {
    setLineageMode((on) => {
      if (on) setLineagePath(null);
      return !on;
    });
  }, []);

  const openPerson = useCallback((id) => {
    viewApi.current?.unpin();
    viewApi.current?.pin(id);
    viewApi.current?.enterFollow(); // if they'd roamed, re-frame so the card has room
    setOpenId(id);
  }, []);

  const closePerson = useCallback(() => {
    viewApi.current?.unpin();
    setOpenId(null);
  }, []);

  // Add a relative, then fly to the new person so they greet you on the tree.
  const handleAdd = useCallback(
    (fields) => {
      const newId = addRelative({ anchorId: addAnchorId, ...fields });
      if (!newId) return; // blocked by constraint (e.g. duplicate bio parent)
      setAddAnchorId(null);
      viewApi.current?.unpin();
      setOpenId(null);
      setExpanded((prev) => new Set(prev).add(addAnchorId).add(newId));
      setActiveId(newId);
    },
    [addAnchorId],
  );

  // Link two existing people without creating a new person.
  // relKey is from AddRelativeSheet (e.g. 'partner', 'mother', 'son').
  const handleLinkExisting = useCallback(
    (existingId, relKey) => {
      if (relKey === 'partner' || relKey === 'ex_partner') {
        addRelationship(addAnchorId, existingId, relKey);
      } else if (relKey === 'mother' || relKey === 'father') {
        // existing person IS the parent of the anchor
        addRelationship(existingId, addAnchorId, 'parent');
      } else if (relKey === 'son' || relKey === 'daughter') {
        // anchor IS the parent of the existing person
        addRelationship(addAnchorId, existingId, 'parent');
      } else if (relKey === 'brother' || relKey === 'sister') {
        // Give the existing person the same parents as the anchor (like addRelative does).
        const anchorParents = data.relationships
          .filter((r) => r.type === 'parent' && r.to_person === addAnchorId)
          .map((r) => r.from_person);
        for (const parentId of anchorParents) {
          addRelationship(parentId, existingId, 'parent');
        }
      }
      setAddAnchorId(null);
      viewApi.current?.unpin();
      setExpanded((prev) => new Set(prev).add(addAnchorId).add(existingId));
      setActiveId(existingId);
    },
    [addAnchorId, data.relationships],
  );

  const handleSave = useCallback(
    (fields) => {
      updatePerson(editId, fields);
      setEditId(null);
    },
    [editId],
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
      updatePerson(timelineId, { events });
      setTimelineId(null);
    },
    [timelineId],
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

  const handleSendInvite = useCallback(async (personId, email, role) => {
    updatePerson(personId, { invited_email: email, invited_at: new Date().toISOString() });
    try {
      const res = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });
      if (!res.ok) throw new Error('invite failed');
    } catch {
      // Graceful: local invited state persists; API unavailable in demo mode
    }
    setInvitePersonId(null);
  }, []);

  const activePerson = graph.byId.get(activeId);

  // Auth gate. 'open' = no auth configured or ?demo — go straight to app.
  if (authState === 'loading') return null;
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
    return <Onboarding onComplete={(fields) => setupTree(fields)} />;
  }

  return (
    <div className="app">
      <TopBar
        familyName={data.familyName || DEFAULT_FOCUS}
        stats={familyStats}
        view={view}
        syncStatus={syncStatus}
        onToggleView={() => setView((v) => (v === 'bubbles' ? 'list' : 'bubbles'))}
        onOpenLegend={() => setLegendOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        user={user}
      />

      {view === 'bubbles' ? (
        <>
          <BubbleTree
            graph={graph}
            activeId={activeId}
            visibleIds={visibleIds}
            onActivate={activate}
            onOpenPerson={lineageMode ? null : openPerson}
            reducedMotion={reducedMotion}
            layout={layout}
            mergeParents={mergeParents}
            lineagePath={lineagePath}
            invitedIds={invitedIds}
            onCameraMode={setCameraFree}
            apiRef={viewApi}
          />
          <FocusNameplate
            person={activePerson}
            getPos={() => viewApi.current?.getScreenPos(activeId)}
            hidden={!!openId || !!addAnchorId || !!editId}
          />
          <button
            className={`lineage-btn${lineageMode ? ' lineage-btn--on' : ''}`}
            onClick={toggleLineage}
            aria-pressed={lineageMode}
            aria-label={lineageMode ? 'Exit lineage mode' : 'Trace a family line'}
          >
            <LineageIcon />
            {lineageMode
              ? lineagePath
                ? `Lineage · ${[...lineagePath].length} people`
                : 'Tap an ancestor…'
              : 'Lineage'}
          </button>
          <button
            className={`recenter-btn${cameraFree && !openId ? ' recenter-btn--on' : ''}`}
            onClick={() => viewApi.current?.recenter()}
            aria-label="Recentre on the family"
            tabIndex={cameraFree && !openId ? 0 : -1}
          >
            <RecenterIcon />
          </button>
          {/* Focus Family mode */}
          <button
            className={`focus-btn${focusMode ? ' focus-btn--on' : ''}`}
            onClick={() => {
              const next = !focusMode;
              setFocusMode(next);
              if (next) setTimeout(() => viewApi.current?.refocus(0.5), 100);
            }}
            aria-pressed={focusMode}
            aria-label={focusMode ? 'Exit focus family view' : 'Focus on this family'}
          >
            <FocusIcon />
            {focusMode ? 'Exit Focus' : 'Focus Family'}
          </button>
          {/* Time slider */}
          <div className={`time-bar${timeMode ? ' time-bar--on' : ''}`}>
            {/* Life event card — floats above the slider during life journey */}
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
            {/* Slider above the toggle so the toggle stays pinned at bottom: 28px */}
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
            {/* Toggle last — always the bottom item, stays at bottom: 28px */}
            <button
              className={`time-toggle${timeMode ? ' time-toggle--on' : ''}`}
              onClick={() => {
                if (!timeMode) { setTimeYear(new Date().getFullYear()); setTimePlaying(false); }
                else { setTimePlaying(false); setLifeJourneyId(null); }
                setTimeMode((m) => !m);
              }}
              aria-pressed={timeMode}
              aria-label={timeMode ? `Time view: ${timeYear}` : 'View family over time'}
            >
              <ClockIcon />
              {timeMode ? (
                lifeJourneyPerson ? (
                  <>{lifeJourneyPerson.display_name.split(' ')[0]} · {timeYear}</>
                ) : (
                  <>{aliveAtYear ? aliveAtYear.size : graph.people.length} · {timeYear}</>
                )
              ) : 'Time'}
            </button>
          </div>
          {!lineageMode && <IntroHint />}
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
        lockEscape={!!(addAnchorId || editId || timelineId || memoryId || lightbox || crop)}
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
        onUpdateStory={(id, story) => updatePerson(id, { story })}
        onPhoto={handlePhoto}
        onInvite={(id) => setInvitePersonId(id)}
        onLifeJourney={startLifeJourney}
      />

      {invitePersonId && graph.byId.get(invitePersonId) && (
        <InviteSheet
          person={graph.byId.get(invitePersonId)}
          onSend={handleSendInvite}
          onClose={() => setInvitePersonId(null)}
        />
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

      {storageWarning && (
        <div className="storage-toast" role="alert">
          Storage full — this change won&apos;t survive a reload. Try removing some photos.
        </div>
      )}

      {syncToast && (
        <div className="storage-toast" role="status" onClick={() => setSyncToast(null)}>
          {syncToast}
        </div>
      )}

      {editId && graph.byId.get(editId) && (
        <EditPersonSheet
          person={graph.byId.get(editId)}
          onClose={() => setEditId(null)}
          onSave={handleSave}
          onRemove={handleRemovePerson}
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
            setPhoto(crop.id, dataUrl); // instant visual feedback
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
        layout={layout}
        onSetLayout={setLayout}
      />

      {settingsOpen && (
        <FamilySettings
          myRole={user ? (data._meta?.role || 'owner') : 'owner'}
          familyName={data.familyName || 'My Family'}
          onUpdateFamilyName={updateFamilyName}
          onReset={resetTree}
          onLogout={user ? async () => {
            await fetch('/api/auth/logout', { method: 'POST' });
            window.location.reload();
          } : null}
          onClose={() => setSettingsOpen(false)}
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

// Crosshair / locate — return the camera to the framed family.
function RecenterIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <path d="M12 2.5v3.5M12 18v3.5M2.5 12h3.5M18 12h3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
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

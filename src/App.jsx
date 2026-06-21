import { useMemo, useState, useCallback, useRef, useEffect, useSyncExternalStore } from 'react';
import './styles/components.css';
import { DEFAULT_FOCUS } from './data/seed.js';
import { apiFetch } from './lib/api.js';
import {
  store,
  addRelative,
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
  loadFromServer,
  enableServerSync,
  deletePerson,
  linkRelative,
  resetTree,
} from './data/store.js';
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
import InstallPrompt from './components/InstallPrompt.jsx';

const isDemo = typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('demo');

export default function App() {
  const data = useSyncExternalStore(store.subscribe, store.getState);
  const graph = useMemo(() => buildGraph(data.people, data.relationships), [data]);
  const reducedMotion = useReducedMotion();

  // 'loading' → 'open' (no auth / bypass) | 'login' (needs sign-in) | 'authed'
  const [authState, setAuthState] = useState(isDemo ? 'open' : 'loading');
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (isDemo) return;
    apiFetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then(async (u) => {
        // Network error or explicit 401 with auth configured → show login.
        if (!u) { setAuthState('login'); return; }
        // BREVO_API_KEY not set → bypass auth, fall through to localStorage mode.
        if (u.bypass) { setAuthState('open'); return; }
        setUser(u);
        enableServerSync();
        await loadFromServer();
        setAuthState('authed');
      })
      .catch(() => setAuthState('open')); // network failure → open (don't block)
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
  const viewApi = useRef(null);

  const visibleIds = useMemo(() => {
    const vis = new Set();
    for (const id of expanded) {
      vis.add(id);
      for (const x of graph.parents(id)) vis.add(x.id);
      for (const x of graph.children(id)) vis.add(x.id);
      for (const x of graph.partners(id)) vis.add(x.id);
      for (const x of graph.siblings(id)) vis.add(x.id);
    }
    return vis;
  }, [graph, expanded]);

  const activateNormal = useCallback((id) => {
    setActiveId(id);
    setExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    setLineagePath(null);
  }, []);

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
    setOpenId(id);
  }, []);

  const closePerson = useCallback(() => {
    viewApi.current?.unpin();
    setOpenId(null);
  }, []);

  // Add a relative — either new (creates person) or existing (links only).
  const handleAdd = useCallback(
    (fields) => {
      let newId;
      if (fields.existingId) {
        linkRelative({ anchorId: addAnchorId, ...fields });
        newId = fields.existingId;
      } else {
        newId = addRelative({ anchorId: addAnchorId, ...fields });
      }
      setAddAnchorId(null);
      viewApi.current?.unpin();
      setOpenId(null);
      setExpanded((prev) => new Set(prev).add(addAnchorId).add(newId));
      setActiveId(newId);
    },
    [addAnchorId],
  );

  const handleDelete = useCallback(
    (id) => {
      deletePerson(id);
      setEditId(null);
      setOpenId(null);
      if (activeId === id) {
        const fallback = data.myPersonId && data.myPersonId !== id
          ? data.myPersonId
          : data.people.find((p) => p.id !== id)?.id;
        if (fallback) { setActiveId(fallback); setExpanded(new Set([fallback])); }
      }
    },
    [activeId, data.myPersonId, data.people],
  );

  const handleSave = useCallback(
    (fields) => {
      updatePerson(editId, fields);
      setEditId(null);
    },
    [editId],
  );

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

  const activePerson = graph.byId.get(activeId);

  // Auth gate. 'open' = no auth configured or ?demo — go straight to app.
  if (authState === 'loading') return null;
  if (authState === 'login') return <LoginScreen />;

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
        view={view}
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
            mergeParents={mergeParents}
            lineagePath={lineagePath}
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
          {!lineageMode && <IntroHint />}
          {!lineageMode && <InstallPrompt />}
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
        onRemoveDocument={removeDocument}
        onUpdateStory={(id, story) => updatePerson(id, { story })}
        onPhoto={handlePhoto}
      />

      {addAnchorId && graph.byId.get(addAnchorId) && (
        <AddRelativeSheet
          anchor={graph.byId.get(addAnchorId)}
          people={data.people.filter((p) => p.id !== addAnchorId)}
          onClose={() => setAddAnchorId(null)}
          onAdd={handleAdd}
        />
      )}

      {editId && graph.byId.get(editId) && (
        <EditPersonSheet
          person={graph.byId.get(editId)}
          onClose={() => setEditId(null)}
          onSave={handleSave}
          onDelete={handleDelete}
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
          onDelete={removePhoto}
          onSetPortrait={(src) => {
            setPhoto(lightbox.personId, src);
            setLightbox(null);
          }}
        />
      )}

      {crop && (
        <PhotoCropper
          src={crop.url}
          onCancel={closeCrop}
          onConfirm={(dataUrl) => {
            setPhoto(crop.id, dataUrl);
            closeCrop();
          }}
        />
      )}

      <Legend
        open={legendOpen}
        onClose={() => setLegendOpen(false)}
        mergeParents={mergeParents}
        onToggleMerge={() => setMergeParents((v) => !v)}
      />

      {settingsOpen && (
        <FamilySettings
          myRole={user ? (data._meta?.role || 'owner') : 'owner'}
          familyName={data.familyName || 'My Family'}
          onClose={() => setSettingsOpen(false)}
          onReset={() => { resetTree(); setActiveId(null); setExpanded(new Set()); setOpenId(null); }}
        />
      )}
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

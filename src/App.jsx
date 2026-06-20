import { useMemo, useState, useCallback, useRef, useSyncExternalStore } from 'react';
import './styles/components.css';
import { FAMILY_NAME, DEFAULT_FOCUS } from './data/seed.js';
import {
  store,
  addRelative,
  updatePerson,
  setPhoto,
  addMemory,
  toggleMemoryVote,
  removeMemory,
  addPhoto,
  setPhotoCaption,
  removePhoto,
} from './data/store.js';
import { buildGraph } from './data/graph.js';
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
import Splash from './components/Splash.jsx';

export default function App() {
  const data = useSyncExternalStore(store.subscribe, store.getState);
  const graph = useMemo(() => buildGraph(data.people, data.relationships), [data]);
  const reducedMotion = useReducedMotion();

  const [activeId, setActiveId] = useState(DEFAULT_FOCUS);
  const [expanded, setExpanded] = useState(() => new Set([DEFAULT_FOCUS]));
  const [openId, setOpenId] = useState(null); // person card
  const [addAnchorId, setAddAnchorId] = useState(null); // add-relative sheet
  const [editId, setEditId] = useState(null); // edit sheet
  const [timelineId, setTimelineId] = useState(null); // timeline editor
  const [memoryId, setMemoryId] = useState(null); // add-memory sheet
  const [lightbox, setLightbox] = useState(null); // { personId, index }
  const [crop, setCrop] = useState(null); // { id, url } photo cropper
  const [view, setView] = useState('bubbles');
  const [legendOpen, setLegendOpen] = useState(false);
  const [mergeParents, setMergeParents] = useState(true);
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

  const activate = useCallback((id) => {
    setActiveId(id);
    setExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
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

  // Add a relative, then fly to the new person so they greet you on the tree.
  const handleAdd = useCallback(
    (fields) => {
      const newId = addRelative({ anchorId: addAnchorId, ...fields });
      setAddAnchorId(null);
      viewApi.current?.unpin();
      setOpenId(null);
      setExpanded((prev) => new Set(prev).add(addAnchorId).add(newId));
      setActiveId(newId);
    },
    [addAnchorId],
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

  return (
    <div className="app">
      <TopBar
        familyName={FAMILY_NAME}
        view={view}
        onToggleView={() => setView((v) => (v === 'bubbles' ? 'list' : 'bubbles'))}
        onOpenLegend={() => setLegendOpen(true)}
      />

      {view === 'bubbles' ? (
        <>
          <BubbleTree
            graph={graph}
            activeId={activeId}
            visibleIds={visibleIds}
            onActivate={activate}
            onOpenPerson={openPerson}
            reducedMotion={reducedMotion}
            mergeParents={mergeParents}
            apiRef={viewApi}
          />
          <FocusNameplate
            person={activePerson}
            getPos={() => viewApi.current?.getScreenPos(activeId)}
            hidden={!!openId || !!addAnchorId || !!editId}
          />
          <IntroHint />
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
        viewerId={DEFAULT_FOCUS}
        memories={data.memories}
        photos={data.photos}
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
        onPhoto={handlePhoto}
      />

      {addAnchorId && graph.byId.get(addAnchorId) && (
        <AddRelativeSheet
          anchor={graph.byId.get(addAnchorId)}
          onClose={() => setAddAnchorId(null)}
          onAdd={handleAdd}
        />
      )}

      {editId && graph.byId.get(editId) && (
        <EditPersonSheet
          person={graph.byId.get(editId)}
          onClose={() => setEditId(null)}
          onSave={handleSave}
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
      <Splash />
    </div>
  );
}

import { useMemo, useState, useCallback, useRef } from 'react';
import './styles/components.css';
import { people, relationships, FAMILY_NAME, DEFAULT_FOCUS } from './data/seed.js';
import { buildGraph } from './data/graph.js';
import { useReducedMotion } from './hooks/useReducedMotion.js';
import BubbleTree from './viz/BubbleTree.jsx';
import TopBar from './components/TopBar.jsx';
import FocusNameplate from './components/FocusNameplate.jsx';
import PersonSheet from './components/PersonSheet.jsx';
import AccessibleTree from './components/AccessibleTree.jsx';
import Legend from './components/Legend.jsx';
import IntroHint from './components/IntroHint.jsx';

export default function App() {
  const graph = useMemo(() => buildGraph(people, relationships), []);
  const reducedMotion = useReducedMotion();

  const [activeId, setActiveId] = useState(DEFAULT_FOCUS);
  // People whose connections have been revealed. The tree shows these plus
  // their immediate neighbours; tapping a face expands it without hiding the
  // rest, so the tree grows as you explore.
  const [expanded, setExpanded] = useState(() => new Set([DEFAULT_FOCUS]));
  const [openId, setOpenId] = useState(null); // person card
  const [cardOrigin, setCardOrigin] = useState(null);
  const [view, setView] = useState('bubbles'); // 'bubbles' | 'list'
  const [legendOpen, setLegendOpen] = useState(false);
  const viewApi = useRef(null); // imperative handle into the canvas

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

  // Make a person active and reveal their connections (additive — never hides).
  const activate = useCallback((id) => {
    setActiveId(id);
    setExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const openPerson = useCallback((id) => {
    viewApi.current?.unpin();
    setCardOrigin(viewApi.current?.getScreenPos(id) || null);
    viewApi.current?.pin(id);
    setOpenId(id);
  }, []);

  const closePerson = useCallback(() => {
    viewApi.current?.unpin();
    setOpenId(null);
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
            apiRef={viewApi}
          />
          <FocusNameplate
            person={activePerson}
            getPos={() => viewApi.current?.getScreenPos(activeId)}
            hidden={!!openId}
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
        origin={cardOrigin}
        onClose={closePerson}
        onFocus={(id) => {
          closePerson();
          activate(id);
        }}
        onOpenPerson={openPerson}
      />

      <Legend open={legendOpen} onClose={() => setLegendOpen(false)} />
    </div>
  );
}

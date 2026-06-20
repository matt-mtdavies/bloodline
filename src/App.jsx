import { useMemo, useState, useCallback } from 'react';
import './styles/components.css';
import { people, relationships, FAMILY_NAME, DEFAULT_FOCUS } from './data/seed.js';
import { buildGraph } from './data/graph.js';
import { useReducedMotion } from './hooks/useReducedMotion.js';
import BubbleTree from './viz/BubbleTree.jsx';
import TopBar from './components/TopBar.jsx';
import PersonSheet from './components/PersonSheet.jsx';
import AccessibleTree from './components/AccessibleTree.jsx';
import Legend from './components/Legend.jsx';
import IntroHint from './components/IntroHint.jsx';

export default function App() {
  const graph = useMemo(() => buildGraph(people, relationships), []);
  const reducedMotion = useReducedMotion();

  const [focusId, setFocusId] = useState(DEFAULT_FOCUS);
  const [openId, setOpenId] = useState(null); // person sheet
  const [view, setView] = useState('bubbles'); // 'bubbles' | 'list'
  const [legendOpen, setLegendOpen] = useState(false);

  const focus = useCallback((id) => {
    setFocusId(id);
  }, []);

  const focusPerson = graph.byId.get(focusId);

  return (
    <div className="app">
      <TopBar
        familyName={FAMILY_NAME}
        focusName={focusPerson?.display_name}
        view={view}
        onToggleView={() => setView((v) => (v === 'bubbles' ? 'list' : 'bubbles'))}
        onOpenLegend={() => setLegendOpen(true)}
      />

      {view === 'bubbles' ? (
        <>
          <BubbleTree
            graph={graph}
            focusId={focusId}
            onFocus={focus}
            onOpenPerson={setOpenId}
            reducedMotion={reducedMotion}
          />
          <IntroHint />
        </>
      ) : (
        <AccessibleTree
          graph={graph}
          focusId={focusId}
          onFocus={focus}
          onOpenPerson={setOpenId}
        />
      )}

      <PersonSheet
        graph={graph}
        personId={openId}
        onClose={() => setOpenId(null)}
        onFocus={(id) => {
          setOpenId(null);
          focus(id);
        }}
        onOpenPerson={setOpenId}
      />

      <Legend open={legendOpen} onClose={() => setLegendOpen(false)} />
    </div>
  );
}

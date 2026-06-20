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

  const [focusId, setFocusId] = useState(DEFAULT_FOCUS);
  const [openId, setOpenId] = useState(null); // person card
  const [cardOrigin, setCardOrigin] = useState(null); // bubble screen pos the card grows from
  const [view, setView] = useState('bubbles'); // 'bubbles' | 'list'
  const [legendOpen, setLegendOpen] = useState(false);
  const viewApi = useRef(null); // imperative handle into the canvas

  const focus = useCallback((id) => {
    setFocusId(id);
  }, []);

  // Open a person's card so it appears to grow out of their bubble, and pin that
  // bubble so the tether stays anchored while the card is up.
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

  const focusPerson = graph.byId.get(focusId);

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
            focusId={focusId}
            onFocus={focus}
            onOpenPerson={openPerson}
            reducedMotion={reducedMotion}
            apiRef={viewApi}
          />
          <FocusNameplate
            person={focusPerson}
            getPos={() => viewApi.current?.getScreenPos(focusId)}
            hidden={!!openId}
          />
          <IntroHint />
        </>
      ) : (
        <AccessibleTree
          graph={graph}
          focusId={focusId}
          onFocus={focus}
          onOpenPerson={openPerson}
        />
      )}

      <PersonSheet
        graph={graph}
        personId={openId}
        origin={cardOrigin}
        getPos={() => viewApi.current?.getScreenPos(openId)}
        onClose={closePerson}
        onFocus={(id) => {
          closePerson();
          focus(id);
        }}
        onOpenPerson={openPerson}
      />

      <Legend open={legendOpen} onClose={() => setLegendOpen(false)} />
    </div>
  );
}

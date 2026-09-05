/*
 * Atlas — the view, as the app mounts it.
 *
 * The lab (AtlasLab.jsx) exists to try the map against real data with its
 * own scaffolding — source switcher, stats readout, a search box of its own.
 * None of that belongs in the app, where the top bar already owns search,
 * the person sheet owns the profile, and the family name already sits in the
 * header. So this wrapper is deliberately thin: the stage, the edge markers
 * that point at the selected person's off-screen relatives, and one control
 * for going back to the whole family.
 *
 * Selection follows the app's own contract, the same one CanopyTree honours:
 * a first tap ACTIVATES (the camera flies, the bloodline lights) and a
 * second tap on the person already in focus OPENS their profile — so a
 * single tap never throws a sheet over the map before you've seen where you
 * landed.
 */

import { useCallback, useRef, useState } from 'react';
import AtlasStage from './AtlasStage.jsx';
import './atlas.css';

export default function AtlasTree({
  graph,
  focusId,
  onActivate,
  onOpenPerson,
  reducedMotion = false,
  // Optional: lets the app reach the stage's camera from outside (the
  // desktop zoom controls, ZoomControls.jsx, need zoomStep/recenter the
  // same way they already reach BubbleTree's). Falls back to a purely
  // internal ref — used only by this component's own "Whole family" button
  // below — for every caller that doesn't need that, the lab included.
  apiRef,
}) {
  const localApi = useRef(null);
  const api = apiRef || localApi;
  const [edges, setEdges] = useState([]);

  const select = useCallback((id) => onActivate?.(id), [onActivate]);
  const open = useCallback((id) => onOpenPerson?.(id), [onOpenPerson]);

  return (
    <div className="atlas-view">
      <AtlasStage
        graph={graph}
        focusId={focusId}
        onSelect={select}
        onOpen={open}
        onEdge={setEdges}
        apiRef={api}
        reducedMotion={reducedMotion}
        /* Clear of the app's real top bar, and of this view's own "Whole
           family" pill at the foot. Same convention as CanopyTree's insets. */
        topInset={112}
        bottomInset={84}
      />

      {/* Off-screen relatives of the person in focus, pinned to the edge of
          the view in their true direction — a map marks the next town off
          the page rather than drawing the whole road to it. */}
      {edges.map((c) => (
        <button
          key={c.key}
          type="button"
          className="atlas-edge"
          style={{ left: c.x, top: c.y }}
          onClick={() => select(c.ids[0])}
          aria-label={`Go to ${c.label}`}
        >
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" style={{ transform: `rotate(${c.angle}rad)` }}>
            <path d="M2 6h7M6 2.5L9.5 6 6 9.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{c.label}</span>
        </button>
      ))}

      {/* One control, and only once you've travelled somewhere: the way back
          out to the whole family. Everything else — search, the profile, the
          legend — the app already owns. */}
      {!!focusId && (
        <button type="button" className="atlas-wide" onClick={() => api.current?.fitAll()}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
            <path d="M9 4H5a1 1 0 00-1 1v4M15 4h4a1 1 0 011 1v4M9 20H5a1 1 0 01-1-1v-4M15 20h4a1 1 0 001-1v-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          Whole family
        </button>
      )}
    </div>
  );
}

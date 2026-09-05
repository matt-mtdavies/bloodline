/*
 * Atlas — the view, as the app mounts it.
 *
 * The lab (AtlasLab.jsx) exists to try the map against real data with its
 * own scaffolding — source switcher, stats readout, a search box of its own.
 * None of that belongs in the app, where the top bar already owns search,
 * the person sheet owns the profile, and the family name already sits in the
 * header. So this wrapper is deliberately thin: the stage, the edge markers
 * that point at the selected person's off-screen relatives, one control for
 * going back to the whole family, and Time mode's own control.
 *
 * Selection follows the app's own contract, the same one CanopyTree honours:
 * a first tap ACTIVATES (the camera flies, the bloodline lights) and a
 * second tap on the person already in focus OPENS their profile — so a
 * single tap never throws a sheet over the map before you've seen where you
 * landed.
 *
 * Time mode is state the app already owns for the organic tree (timeMode/
 * timeYear/timePlaying/yearRange/worldEvent) — reused as-is here rather than
 * duplicated, since scrubbing through years means the same thing regardless
 * of which view is looking at the family. What's deliberately NOT brought
 * across is "life journey" (walking one person's own life story day by day)
 * — that mode leans on the organic camera's own focus-family mechanics
 * (viewApi.refocus, the nuclear-family reveal), which has no equivalent
 * here; Atlas gets the general "watch the whole family through time" half,
 * which is the part that means the same thing on a map. The dimming itself
 * is AtlasStage's own presence() rule (already built for the lab's own time
 * slider) — this wrapper only ever hands it a year.
 */

import { useCallback, useRef, useState } from 'react';
import AtlasStage from './AtlasStage.jsx';
import './atlas.css';

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
function GlobeIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

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
  // Time mode, all state and callbacks owned by the app (see header comment).
  timeMode = false,
  timeYear = null,
  timePlaying = false,
  yearRange = null,
  worldEvent = null,
  onToggleTimeMode,
  onScrubYear,
  onTogglePlay,
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
        year={timeMode ? timeYear : null}
        /* Clear of the app's real top bar, and of this view's own controls
           at the foot. Same convention as CanopyTree's insets. */
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

      {/* Bottom controls: the way back out to the whole family (only once
          you've travelled somewhere), and Time mode's own toggle (always
          available — scrubbing works family-wide regardless of who, if
          anyone, is selected). Everything else — search, the profile, the
          legend — the app already owns. */}
      {!timeMode && (
        <div className="atlas-bottom-row">
          {!!focusId && (
            <button type="button" className="atlas-wide" onClick={() => api.current?.fitAll()}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
                <path d="M9 4H5a1 1 0 00-1 1v4M15 4h4a1 1 0 011 1v4M9 20H5a1 1 0 01-1-1v-4M15 20h4a1 1 0 001-1v-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              Whole family
            </button>
          )}
          <button
            type="button"
            className="atlas-wide"
            onClick={onToggleTimeMode}
            aria-pressed={timeMode}
            disabled={!yearRange}
            title={yearRange ? undefined : 'No usable birth years in this family'}
          >
            <ClockIcon />
            Time
          </button>
        </div>
      )}

      {/* Time mode's own bar: a world-event caption when the scrubbed year
          lands near one (the same nearestWorldEvent the organic tree already
          computes), the slider itself, and Done. Everyone not yet born or
          already gone fades — AtlasStage's own presence() rule, fed by the
          `year` prop above; this bar only ever asks for a year. */}
      {timeMode && yearRange && (
        <div className="atlas-time">
          {worldEvent && (
            <p className="atlas-time__event"><GlobeIcon /> {worldEvent.title}</p>
          )}
          <div className="atlas-time__row">
            <button
              type="button"
              className="atlas-time__play"
              onClick={onTogglePlay}
              aria-label={timePlaying ? 'Pause' : 'Play family history'}
            >
              {timePlaying ? <PauseIcon /> : <PlayIcon />}
            </button>
            <span className="atlas-time__bound">{yearRange.min}</span>
            <input
              type="range"
              className="atlas-time__slider"
              min={yearRange.min}
              max={yearRange.max}
              value={timeYear ?? yearRange.min}
              onChange={(e) => onScrubYear?.(Number(e.target.value))}
              aria-label="Select year"
            />
            <span className="atlas-time__bound">{yearRange.max}</span>
          </div>
          <button type="button" className="atlas-time__year" onClick={onToggleTimeMode}>
            {timeYear} · Done
          </button>
        </div>
      )}
    </div>
  );
}

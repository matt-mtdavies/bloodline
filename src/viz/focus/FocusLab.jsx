/*
 * The Focus Layer lab.
 *
 * A place to answer one question honestly before any of this is wired into the
 * real tree: does being lifted from the whole tree into one family FEEL right?
 * Transitions are the deliverable here, so the lab exists to be driven, not
 * screenshotted — tap anybody in the context layer to be lifted into their
 * family, tap a relative to travel to theirs, tap the backdrop to descend.
 *
 * Fixture-first, exactly like the Tree Motion Lab: the demo family loads on
 * mount and your real tree is loaded only by an explicit button press, through
 * the same read-only GET that lab already uses.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { buildGraph } from '../../data/graph.js';
import { people as seedPeople, relationships as seedRels, DEFAULT_FOCUS } from '../../data/seed.js';
import { fetchRealFamily } from '../v2/realFamily.js';
import FocusStage from './FocusStage.jsx';
import { planFocusView } from './focusLayout.js';
import '../../styles/theme.css';
import './focus.css';
import './focusLab.css';

export default function FocusLab() {
  const [source, setSource] = useState({
    label: 'Demo family',
    people: seedPeople,
    relationships: seedRels,
    focus: DEFAULT_FOCUS,
  });
  const [personId, setPersonId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const graph = useMemo(
    () => buildGraph(source.people, source.relationships),
    [source],
  );

  // Selecting somebody who isn't in the newly-loaded tree would strand the
  // stage on an empty plan, so a source change always resets the selection.
  useEffect(() => { setPersonId(null); }, [source]);

  const loadReal = async () => {
    setLoading(true);
    setError('');
    try {
      const real = await fetchRealFamily();
      setSource({ label: 'Your family', ...real });
    } catch (e) {
      setError(e.message || 'Could not load your family.');
    } finally {
      setLoading(false);
    }
  };

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return source.people
      .filter((p) => (p.display_name || '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, source]);

  const readout = useMemo(() => {
    if (!personId || !graph.byId.has(personId)) return null;
    const plan = planFocusView({
      graph,
      personId,
      viewport: {
        width: typeof window !== 'undefined' ? window.innerWidth : 1200,
        height: typeof window !== 'undefined' ? window.innerHeight - 60 : 800,
      },
    });
    return {
      people: plan.nodes.length,
      smallest: Math.round(plan.smallestDiameter),
      trimmed: plan.trimmed,
      pannable: plan.pannable,
    };
  }, [graph, personId]);

  const active = personId ? graph.byId.get(personId) : null;

  return (
    <div className="fxlab">
      <header className="fxlab__bar">
        <span className="fxlab__title">Focus Layer</span>
        <span className="fxlab__src">{source.label} · {source.people.length} people</span>

        <div className="fxlab__search">
          <input
            className="fxlab__input"
            value={query}
            placeholder="Find someone…"
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Find someone to focus on"
          />
          {!!results.length && (
            <ul className="fxlab__results">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => { setPersonId(p.id); setQuery(''); }}
                  >
                    {p.display_name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button className="fxlab__btn" type="button" onClick={loadReal} disabled={loading}>
          {loading ? 'Loading…' : 'Load your real family'}
        </button>
      </header>

      {!!error && <p className="fxlab__error">{error}</p>}

      <FocusStage
        graph={graph}
        personId={personId}
        onSelect={setPersonId}
        onExit={() => setPersonId(null)}
        insetTop={0}
      />

      {!personId && (
        <p className="fxlab__hint">
          This is the context layer — the whole family as texture.
          <strong> Tap anyone</strong> to be lifted into their family.
        </p>
      )}

      {!!active && (
        <div className="fxlab__foot">
          <button className="fxlab__back" type="button" onClick={() => setPersonId(null)}>
            ‹ Back to the tree
          </button>
          {!!readout && (
            <span className="fxlab__stats">
              {readout.people} in focus · smallest bubble {readout.smallest}px
              {readout.trimmed ? ' · outer ring shed' : ''}
              {readout.pannable ? ' · pannable' : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

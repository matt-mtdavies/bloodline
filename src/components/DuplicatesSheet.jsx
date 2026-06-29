import { useState, useMemo, useEffect } from 'react';
import Avatar from './Avatar.jsx';
import { pairKey } from '../lib/duplicates.js';

const DISMISS_KEY = 'bl_dup_dismissed';

function loadDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveDismissed(set) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

// A rough "how complete is this record" score, to default the keep choice to the
// richer entry (so a merge loses as little as possible).
function richness(p) {
  if (!p) return -1;
  let n = 0;
  if (p.photo) n += 3;
  if (p.bio) n += 2;
  if (p.birth_date) n += 1;
  if (p.death_date) n += 1;
  if (p.birth_place) n += 1;
  if (p.occupation) n += 1;
  n += (p.events || []).length;
  n += (p.tags || []).length;
  return n;
}

/*
 * Review possible duplicate people and merge them. Each card pair lets you pick
 * which record to keep (the fuller one is preselected) and merges the other into
 * it, or dismiss the suggestion if they're actually different people.
 */
export default function DuplicatesSheet({ pairs, graph, onMerge, onClose }) {
  const [dismissed, setDismissed] = useState(loadDismissed);
  const [keepChoice, setKeepChoice] = useState({}); // pairKey → chosen keepId

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const visible = useMemo(
    () => pairs
      .map((p) => ({ ...p, key: pairKey(p.aId, p.bId), a: graph.byId.get(p.aId), b: graph.byId.get(p.bId) }))
      .filter((p) => p.a && p.b && !dismissed.has(p.key)),
    [pairs, graph, dismissed],
  );

  const dismiss = (key) => {
    const next = new Set(dismissed); next.add(key); setDismissed(next); saveDismissed(next);
  };

  const merge = (pair) => {
    const chosen = keepChoice[pair.key] || (richness(pair.a) >= richness(pair.b) ? pair.aId : pair.bId);
    const dropId = chosen === pair.aId ? pair.bId : pair.aId;
    onMerge(chosen, dropId);
    // The dropped id is gone; remember so the (now-stale) pair never re-shows.
    dismiss(pair.key);
  };

  return (
    <div className="sheet-scrim" role="dialog" aria-modal="true" aria-label="Possible duplicates" onClick={onClose}>
      <div className="sheet dups" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grip" />
        <div className="dups__head">
          <h2 className="dups__title"><MergeIcon /> Possible duplicates</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </div>

        {visible.length === 0 ? (
          <div className="dups__empty">
            <CheckIcon />
            <p>No duplicates to review — your tree looks tidy.</p>
          </div>
        ) : (
          <>
            <p className="dups__intro">
              These people share a name and look like they might be the same person.
              Pick the record to keep, then merge — or dismiss if they're different people.
            </p>
            <ul className="dups__list">
              {visible.map((pair) => {
                const keepId = keepChoice[pair.key] || (richness(pair.a) >= richness(pair.b) ? pair.aId : pair.bId);
                return (
                  <li key={pair.key} className={`dups__pair${pair.confidence === 'high' ? ' dups__pair--high' : ''}`}>
                    <div className="dups__cards">
                      {[pair.a, pair.b].map((person) => {
                        const isKeep = person.id === keepId;
                        return (
                          <button
                            key={person.id}
                            type="button"
                            className={`dups__card${isKeep ? ' dups__card--keep' : ''}`}
                            onClick={() => setKeepChoice((s) => ({ ...s, [pair.key]: person.id }))}
                            aria-pressed={isKeep}
                          >
                            <Avatar person={person} size={48} />
                            <span className="dups__card-name">{person.display_name}</span>
                            <span className="dups__card-meta">
                              {person.birth_date ? `b. ${person.birth_date}` : 'no birth date'}
                            </span>
                            <span className="dups__card-tag">{isKeep ? 'Keep' : 'Merge in'}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="dups__reasons">
                      {pair.reasons.map((r) => <span key={r} className="dups__reason">{r}</span>)}
                    </div>
                    <div className="dups__actions">
                      <button className="dups__merge" onClick={() => merge(pair)}>
                        Merge into {graph.byId.get(keepId)?.display_name?.split(/\s+/)[0]}
                      </button>
                      <button className="dups__dismiss" onClick={() => dismiss(pair.key)}>
                        Not a duplicate
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function MergeIcon() {
  return (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3v4a5 5 0 0 0 5 5 5 5 0 0 1 5 5v4M7 21v-4a5 5 0 0 1 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><circle cx="7" cy="3" r="0.5" stroke="currentColor" strokeWidth="1.7"/></svg>);
}
function CloseIcon() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>);
}
function CheckIcon() {
  return (<svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6"/><path d="M8.5 12.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>);
}

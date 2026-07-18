import { useState, useMemo, useEffect } from 'react';
import Avatar from './Avatar.jsx';
import { pairKey } from '../lib/duplicates.js';

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

// Compact "who's connected to whom" for a candidate — the actual gap that
// caused real confusion after a bad merge (report: "I couldn't tell whose
// kids belonged to who easily"). First names only, capped, so two full
// families don't blow out the card at typical widths.
function relNames(graph, list, cap = 3) {
  const names = list
    .map((x) => graph.byId.get(x.id)?.display_name?.split(/\s+/)[0])
    .filter(Boolean);
  if (names.length === 0) return null;
  const shown = names.slice(0, cap).join(', ');
  return names.length > cap ? `${shown} +${names.length - cap}` : shown;
}

/*
 * Review possible duplicate people and merge them. Each card pair lets you pick
 * which record to keep (the fuller one is preselected) and merges the other into
 * it, or dismiss the suggestion if they're actually different people.
 */
export default function DuplicatesSheet({ pairs, graph, onMerge, onDismiss, onClose, onShowInTree }) {
  const [keepChoice, setKeepChoice] = useState({}); // pairKey → chosen keepId
  // A pair awaiting the "are you sure" confirm before its merge actually
  // commits — a merge used to fire on the very first tap with no way back
  // (real report: "I accidentally merged Ashley last week and it caused
  // some confusion... I couldn't tell whose kids belonged to who").
  const [confirmKey, setConfirmKey] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // `pairs` arrives already filtered to un-dismissed candidates (the caller
  // owns dismissal — see lib/duplicates.js — so the topbar's count pill and
  // this list always agree). Just resolve the person records and drop any
  // pair whose person no longer exists (e.g. removed since this list rendered).
  const visible = useMemo(
    () => pairs
      .map((p) => ({ ...p, key: pairKey(p.aId, p.bId), a: graph.byId.get(p.aId), b: graph.byId.get(p.bId) }))
      .filter((p) => p.a && p.b),
    [pairs, graph],
  );

  const commitMerge = (pair) => {
    const chosen = keepChoice[pair.key] || (richness(pair.a) >= richness(pair.b) ? pair.aId : pair.bId);
    const dropId = chosen === pair.aId ? pair.bId : pair.aId;
    onMerge(chosen, dropId);
    // The dropped id is gone; remember so the (now-stale) pair never re-shows.
    onDismiss(pair.key);
    setConfirmKey(null);
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
                const keepPerson = keepId === pair.a.id ? pair.a : pair.b;
                const dropPerson = keepId === pair.a.id ? pair.b : pair.a;
                const dropRelCount = graph.parents(dropPerson.id).length
                  + graph.children(dropPerson.id).length
                  + graph.partners(dropPerson.id).length;
                const isConfirming = confirmKey === pair.key;
                return (
                  <li key={pair.key} className={`dups__pair${pair.confidence === 'high' ? ' dups__pair--high' : ''}`}>
                    <div className="dups__cards">
                      {[pair.a, pair.b].map((person) => {
                        const isKeep = person.id === keepId;
                        // Whose kids belong to whom, at a glance — the actual
                        // gap that caused real confusion after a bad merge
                        // (report: "I couldn't tell whose kids belonged to
                        // who easily"), visible before committing rather than
                        // discovered after.
                        const parentNames = relNames(graph, graph.parents(person.id));
                        const childNames = relNames(graph, graph.children(person.id));
                        const partnerNames = relNames(graph, graph.partners(person.id));
                        return (
                          <button
                            key={person.id}
                            type="button"
                            className={`dups__card${isKeep ? ' dups__card--keep' : ''}`}
                            onClick={() => { setKeepChoice((s) => ({ ...s, [pair.key]: person.id })); setConfirmKey(null); }}
                            aria-pressed={isKeep}
                          >
                            <Avatar person={person} size={48} />
                            <span className="dups__card-name">{person.display_name}</span>
                            <span className="dups__card-meta">
                              {person.birth_date ? `b. ${person.birth_date}` : 'no birth date'}
                            </span>
                            {(parentNames || childNames || partnerNames) && (
                              <span className="dups__card-rels">
                                {parentNames && <span className="dups__card-rel"><b>Parents</b> {parentNames}</span>}
                                {childNames && <span className="dups__card-rel"><b>Children</b> {childNames}</span>}
                                {partnerNames && <span className="dups__card-rel"><b>Partner</b> {partnerNames}</span>}
                              </span>
                            )}
                            <span className="dups__card-tag">{isKeep ? 'Keep' : 'Merge in'}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="dups__reasons">
                      {pair.reasons.map((r) => <span key={r} className="dups__reason">{r}</span>)}
                    </div>
                    {isConfirming ? (
                      <div className="dups__confirm">
                        <span>
                          This moves {dropPerson.display_name.split(/\s+/)[0]}'s
                          {dropRelCount > 0 ? ` ${dropRelCount} relationship${dropRelCount === 1 ? '' : 's'} (parents, children, partners) ` : ' record '}
                          onto {keepPerson.display_name.split(/\s+/)[0]}'s and can't be easily undone.
                        </span>
                        <div className="dups__confirm-btns">
                          <button className="dups__merge" onClick={() => commitMerge(pair)}>Merge</button>
                          <button className="dups__cancel" onClick={() => setConfirmKey(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="dups__actions">
                        <button className="dups__merge" onClick={() => setConfirmKey(pair.key)}>
                          Merge into {keepPerson.display_name.split(/\s+/)[0]}
                        </button>
                        {onShowInTree && (
                          <button className="dups__show-tree" onClick={() => onShowInTree(pair.aId, pair.bId)}>
                            Show both in tree
                          </button>
                        )}
                        <button className="dups__dismiss" onClick={() => onDismiss(pair.key)}>
                          Not a duplicate
                        </button>
                      </div>
                    )}
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

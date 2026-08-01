import { useState, useMemo, useEffect } from 'react';
import Avatar from './Avatar.jsx';

const PAGE_SIZE = 20;

// Short, human labels for each check type — shown as a small badge on every
// card so "why was this flagged" is legible at a glance, not just buried in
// the prose reason.
const TYPE_LABELS = {
  concurrent_partners: 'Overlapping partners',
  implausible_age: 'Implausible age',
  death_before_birth: 'Death before birth',
  child_before_parent: 'Born before parent',
  child_after_parent_death: "Born after parent's death",
  parent_too_young: 'Parent too young',
  marriage_outside_lifespan: 'Marriage outside lifespan',
  ancestor_cycle: 'Circular ancestry',
};

/*
 * Review data-integrity issues — logically impossible or wildly implausible
 * facts (two simultaneous current partners, a 140-year lifespan, a child
 * born before their own parent) flagged for a human to look at. Never
 * fixes anything automatically: each card links straight to the profile(s)
 * involved so the actual correction happens through the normal edit flow,
 * or can be dismissed if it's not really a mistake (see lib/integrity.js's
 * own doc comment on why every check here favors precision over recall).
 *
 * `embedded`: renders just the section content (no scrim/sheet/own head/
 * close, no empty-state message) — used by ArchiveCareSheet.jsx to host
 * this list alongside DuplicatesSheet's, under one shared head.
 */
export default function IntegritySheet({ issues, graph, onDismiss, onClose, onOpenPerson, embedded = false }) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [bulkConfirming, setBulkConfirming] = useState(false);

  useEffect(() => {
    if (embedded) return; // the host (ArchiveCareSheet) owns Escape-to-close
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [embedded, onClose]);

  // `issues` arrives already filtered to un-dismissed (the caller owns
  // dismissal, same convention as DuplicatesSheet/lib/duplicates.js, so the
  // topbar's count pill and this list always agree). Resolve person records
  // and drop anything referencing someone since removed.
  const visible = useMemo(
    () => issues
      .map((i) => ({ ...i, people: i.personIds.map((id) => graph.byId.get(id)).filter(Boolean) }))
      .filter((i) => i.people.length === i.personIds.length)
      .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1)),
    [issues, graph],
  );

  const paged = visible.slice(0, visibleCount);

  if (embedded && visible.length === 0) return null;

  const content = (
    <>
      {!embedded && (
        <div className="dups__head">
          <h2 className="dups__title"><ShieldIcon /> Details worth reviewing</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </div>
      )}

        {visible.length === 0 ? (
          <div className="dups__empty">
            <CheckIcon />
            <p>Your archive looks healthy — nothing to review.</p>
          </div>
        ) : (
          <>
            {embedded && (
              <h3 className="dups__embedded-heading">Details worth reviewing <span className="dups__embedded-count">{visible.length}</span></h3>
            )}
            <p className="dups__intro">
              These facts look logically impossible or very unlikely — a good sign one of them
              has a wrong date or link. Open a profile to fix it, or dismiss if it's genuinely correct.
            </p>
            {visible.length > 1 && (
              <div className="dups__bulk">
                {bulkConfirming ? (
                  <div className="dups__bulk-confirm">
                    <span>Dismiss all {visible.length} issues shown as reviewed?</span>
                    <div className="dups__bulk-confirm-btns">
                      <button
                        className="dups__merge"
                        onClick={() => { visible.forEach((i) => onDismiss(i.key)); setBulkConfirming(false); }}
                      >
                        Yes, dismiss all
                      </button>
                      <button className="dups__cancel" onClick={() => setBulkConfirming(false)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button className="dups__bulk-dismiss" onClick={() => setBulkConfirming(true)}>
                    Dismiss all {visible.length} as reviewed
                  </button>
                )}
              </div>
            )}
            <ul className="dups__list">
              {paged.map((issue) => (
                <li key={issue.key} className={`dups__pair${issue.severity === 'high' ? ' dups__pair--high' : ''}`}>
                  <span className="integrity__type-badge">{TYPE_LABELS[issue.type] || issue.type}</span>
                  <div className="dups__cards">
                    {issue.people.map((person) => (
                      <button
                        key={person.id}
                        type="button"
                        className="dups__card"
                        onClick={() => onOpenPerson(person.id)}
                      >
                        <Avatar person={person} size={48} />
                        <span className="dups__card-name">{person.display_name}</span>
                        <span className="dups__card-meta">
                          {person.birth_date ? `b. ${person.birth_date}` : 'no birth date'}
                        </span>
                        <span className="dups__card-tag">View profile</span>
                      </button>
                    ))}
                  </div>
                  <p className="integrity__reason">{issue.reason}</p>
                  <div className="dups__actions">
                    <button className="dups__dismiss" onClick={() => onDismiss(issue.key)}>
                      Dismiss
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {visible.length > visibleCount && (
              <button
                className="dups__more"
                onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
              >
                Show {Math.min(PAGE_SIZE, visible.length - visibleCount)} more (of {visible.length})
              </button>
            )}
          </>
        )}
    </>
  );

  if (embedded) return <section className="dups__embedded-section">{content}</section>;

  return (
    <div className="sheet-scrim" role="dialog" aria-modal="true" aria-label="Details worth reviewing" onClick={onClose}>
      <div className="sheet dups" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grip" />
        {content}
      </div>
    </div>
  );
}

function ShieldIcon() {
  return (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>);
}
function CloseIcon() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>);
}
function CheckIcon() {
  return (<svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6"/><path d="M8.5 12.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>);
}

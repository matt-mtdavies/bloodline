import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import DuplicatesSheet from './DuplicatesSheet.jsx';
import IntegritySheet, { TYPE_LABELS, typeAnchorId } from './IntegritySheet.jsx';

/*
 * "Care for your archive" — the single maintenance workspace combining
 * possible-duplicate review and data-integrity review under one head,
 * per the premium-UX refinement brief: duplicates and data-quality checks
 * are maintenance, not discovery, and showing them as two separate popover
 * entries made the topbar's family-overview panel read as four competing
 * cards. Both sub-lists keep their own internal logic (merge/dismiss,
 * bulk-dismiss, pagination) unchanged — this is purely a shared shell
 * around DuplicatesSheet/IntegritySheet's own `embedded` mode.
 */
export default function ArchiveCareSheet({
  duplicatePairs, integrityIssues, graph,
  onMerge, onDismissDuplicate, onShowInTree,
  onDismissIntegrity, onMarkDeceased, onOpenPerson,
  onClose,
}) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isEmpty = duplicatePairs.length === 0 && integrityIssues.length === 0;

  // ── Scroll position across a data-driven re-render ────────────────────────
  // duplicatePairs/integrityIssues are both computed off the render path
  // (useIdleValue in App.jsx) and deliberately reset to an EMPTY array the
  // instant the underlying tree data changes — including a change made
  // right here (Mark as deceased, Dismiss, Merge) — before the real,
  // recomputed list lands a beat later (App.jsx's own comment on
  // useIdleValue explains why: never show a stale candidate a destructive
  // action could fire against). That transient empty frame collapses this
  // sheet's scrollable content, the browser clamps scrollTop to fit, and
  // nothing ever restores it once the real list repopulates. Real report:
  // "tapping to mark someone as deceased takes me back to the top of the
  // list, where I then have to scroll back to where I was." Snapshot the
  // scroll offset the instant an action fires, then keep re-asserting it on
  // every subsequent change to either list until it actually "sticks" (the
  // container is tall enough again) — self-terminating, no timers, and
  // harmless during the transient empty frame (there's nothing to scroll to
  // there anyway, so the assignment just gets reclamped like it already
  // would with no fix at all).
  const scrollElRef = useRef(null);
  const pendingScrollRef = useRef(null);
  const armScrollRestore = () => {
    if (scrollElRef.current) pendingScrollRef.current = scrollElRef.current.scrollTop;
  };
  useLayoutEffect(() => {
    const el = scrollElRef.current;
    if (pendingScrollRef.current == null || !el) return;
    el.scrollTop = pendingScrollRef.current;
    if (el.scrollTop === pendingScrollRef.current) pendingScrollRef.current = null;
  }, [duplicatePairs, integrityIssues]);
  const withScrollRestore = (fn) => (...args) => { armScrollRestore(); fn(...args); };

  // ── Section-nav chips ───────────────────────────────────────────────────
  // A big backlog (real report: 36 "details worth reviewing" behind a long
  // duplicates list) needed a way to jump straight to a section instead of
  // scrolling past everything ahead of it — same tap-a-chip-to-jump pattern
  // Perimeter Preview's genogram chips already use, adapted for a plain
  // (non-virtualized) list: a DOM id per section + scrollIntoView.
  const [integrityExpanded, setIntegrityExpanded] = useState(false);
  const pendingJumpRef = useRef(null);
  useLayoutEffect(() => {
    const id = pendingJumpRef.current;
    if (!id) return;
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      pendingJumpRef.current = null;
    }
  }, [integrityExpanded]);

  const jumpToDuplicates = () => {
    document.getElementById('archivecare-duplicates')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  // A type's first card may be paginated out of IntegritySheet's own
  // "Show N more" cutoff — force it to render everything once, so every
  // chip's target is guaranteed to actually exist to scroll to. Once
  // expanded, later chip taps (any type) can jump immediately.
  const jumpToType = (type) => {
    const id = typeAnchorId(type);
    if (integrityExpanded) {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      pendingJumpRef.current = id;
      setIntegrityExpanded(true);
    }
  };

  const typeOrder = [];
  const typeCounts = {};
  for (const issue of integrityIssues) {
    if (!(issue.type in typeCounts)) { typeOrder.push(issue.type); typeCounts[issue.type] = 0; }
    typeCounts[issue.type]++;
  }
  const chips = [
    ...(duplicatePairs.length > 0 ? [{ key: 'dup', label: 'Duplicates', count: duplicatePairs.length, onClick: jumpToDuplicates }] : []),
    ...typeOrder.map((type) => ({ key: type, label: TYPE_LABELS[type] || type, count: typeCounts[type], onClick: () => jumpToType(type) })),
  ];

  return (
    <div className="sheet-scrim" role="dialog" aria-modal="true" aria-label="Care for your archive" onClick={onClose}>
      <div className="sheet dups" ref={scrollElRef} onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grip" />
        <div className="dups__head">
          <h2 className="dups__title"><CareIcon /> Care for your archive</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </div>

        {isEmpty ? (
          <div className="dups__empty">
            <CheckIcon />
            <p>Your archive looks healthy — nothing to review.</p>
          </div>
        ) : (
          <>
            {chips.length > 1 && (
              <div className="dups__section-chips" role="tablist" aria-label="Jump to a section">
                {chips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    className="filter-pill"
                    onClick={chip.onClick}
                  >
                    {chip.label} <span className="dups__section-chip-count">{chip.count}</span>
                  </button>
                ))}
              </div>
            )}
            <DuplicatesSheet
              embedded
              pairs={duplicatePairs}
              graph={graph}
              onMerge={withScrollRestore(onMerge)}
              onDismiss={withScrollRestore(onDismissDuplicate)}
              onShowInTree={onShowInTree}
            />
            <IntegritySheet
              embedded
              forceShowAll={integrityExpanded}
              issues={integrityIssues}
              graph={graph}
              onDismiss={withScrollRestore(onDismissIntegrity)}
              onMarkDeceased={withScrollRestore(onMarkDeceased)}
              onOpenPerson={onOpenPerson}
            />
          </>
        )}
      </div>
    </div>
  );
}

function CareIcon() {
  return (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>);
}
function CloseIcon() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>);
}
function CheckIcon() {
  return (<svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6"/><path d="M8.5 12.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>);
}

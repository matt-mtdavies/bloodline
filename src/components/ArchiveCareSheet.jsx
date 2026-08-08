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

  // ── Bridge over the transient idle-recompute reset ─────────────────────────
  // duplicatePairs/integrityIssues are both computed off the render path
  // (useIdleValue in App.jsx) and deliberately reset to an EMPTY array the
  // instant the underlying tree data changes — including a change made
  // right here (Mark as deceased, Merge; Dismiss only touches one of the
  // two, since dismissal doesn't itself edit tree data) — before the real,
  // recomputed list lands a beat later (App.jsx's own comment on
  // useIdleValue explains why: never show a stale candidate a destructive
  // action could fire against). Marking someone deceased edits the person,
  // which changes `graph`, which is a dependency of BOTH lists — so both go
  // to `[]` in the very same render. Reacting to that literally (the
  // original version of this fix did) meant the sheet's own `isEmpty`
  // branch would fire, swapping the whole content out for the "archive
  // looks healthy" checkmark screen and unmounting DuplicatesSheet/
  // IntegritySheet, before the real list landed a moment later — on a
  // large real family, the recompute can take long enough for that flash to
  // be genuinely visible. Real report: "it stays where it is for a minute,
  // then looks like it tries to show a confirmation screen, then bounces me
  // back to the top" — that "confirmation screen" was this checkmark state,
  // and the collapse to near-zero height is what forced the scroll to 0.
  // Fixed at the root rather than papered over with a bigger scroll hack:
  // hold the last known-good lists on screen through a transient reset, and
  // only treat the sheet as genuinely empty once it's STAYED empty for a
  // settle window — long enough for any in-flight idle recompute to land,
  // short enough that a real "nothing left to review" still reads as
  // immediate. Safe to display slightly-stale data here (unlike the
  // Merge-button case useIdleValue's own comment is about): every action a
  // card can fire operates on the specific person/pair id already captured
  // at click time, and Merge itself still requires its own explicit
  // confirm step regardless of how fresh the list behind it is.
  // Generous on purpose: computeIntegrityIssues/findDuplicatePairs walk every
  // relationship in the graph, and on a large real family (this account's
  // own is 1000+ people) that can genuinely take longer than a snappy
  // debounce window — showing the "looks healthy" success state a beat late
  // is a much smaller cost than showing it prematurely, mid-recompute.
  const SETTLE_MS = 1200;
  const lastGoodRef = useRef({ duplicatePairs, integrityIssues });
  if (duplicatePairs.length > 0 || integrityIssues.length > 0) {
    lastGoodRef.current = { duplicatePairs, integrityIssues };
  }
  const rawEmpty = duplicatePairs.length === 0 && integrityIssues.length === 0;
  const [settledEmpty, setSettledEmpty] = useState(rawEmpty);
  useEffect(() => {
    if (!rawEmpty) { setSettledEmpty(false); return undefined; }
    const t = setTimeout(() => setSettledEmpty(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, [rawEmpty]);
  const shownDuplicatePairs = rawEmpty && !settledEmpty ? lastGoodRef.current.duplicatePairs : duplicatePairs;
  const shownIntegrityIssues = rawEmpty && !settledEmpty ? lastGoodRef.current.integrityIssues : integrityIssues;
  const isEmpty = settledEmpty;

  // ── Scroll position across a data-driven re-render ────────────────────────
  // Secondary, defensive layer: the hold-last-good bridge above avoids the
  // big collapse-to-empty-state jump in the common case, but a genuine
  // height change (e.g. dismissing the last item in a section) can still
  // shift the scroll offset a little. Snapshot it the instant an action
  // fires, then keep re-asserting it on every subsequent change to either
  // list until it actually "sticks" — self-terminating, no timers.
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
  }, [shownDuplicatePairs, shownIntegrityIssues]);
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
  for (const issue of shownIntegrityIssues) {
    if (!(issue.type in typeCounts)) { typeOrder.push(issue.type); typeCounts[issue.type] = 0; }
    typeCounts[issue.type]++;
  }
  const chips = [
    ...(shownDuplicatePairs.length > 0 ? [{ key: 'dup', label: 'Duplicates', count: shownDuplicatePairs.length, onClick: jumpToDuplicates }] : []),
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
              pairs={shownDuplicatePairs}
              graph={graph}
              onMerge={withScrollRestore(onMerge)}
              onDismiss={withScrollRestore(onDismissDuplicate)}
              onShowInTree={onShowInTree}
            />
            <IntegritySheet
              embedded
              forceShowAll={integrityExpanded}
              issues={shownIntegrityIssues}
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

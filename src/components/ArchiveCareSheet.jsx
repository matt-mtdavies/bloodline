import { useEffect } from 'react';
import DuplicatesSheet from './DuplicatesSheet.jsx';
import IntegritySheet from './IntegritySheet.jsx';

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

  return (
    <div className="sheet-scrim" role="dialog" aria-modal="true" aria-label="Care for your archive" onClick={onClose}>
      <div className="sheet dups" onClick={(e) => e.stopPropagation()}>
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
            <DuplicatesSheet
              embedded
              pairs={duplicatePairs}
              graph={graph}
              onMerge={onMerge}
              onDismiss={onDismissDuplicate}
              onShowInTree={onShowInTree}
            />
            <IntegritySheet
              embedded
              issues={integrityIssues}
              graph={graph}
              onDismiss={onDismissIntegrity}
              onMarkDeceased={onMarkDeceased}
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

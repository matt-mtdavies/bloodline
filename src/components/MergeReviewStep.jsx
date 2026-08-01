/*
 * The "what's actually about to happen" screen for a merge-mode import —
 * shown between Preview and committing, only for Merge (not Replace, which
 * is already an unambiguous full-tree action with its own warning). Built
 * for the delta-reimport case specifically: someone who already imported
 * once, re-importing an updated export from the same source. Rather than
 * blindly committing and hoping nothing doubled, this shows exactly what
 * summarizeMergeImport (lib/duplicates.js) found — genuinely new people,
 * existing people gaining new facts (and WHAT facts, not just a count), and
 * how many records in the file were already fully accounted for — before
 * anything is written. Shared by GedcomImport.jsx and FamilySearchImport.jsx,
 * same convention as ImportDoneStep.jsx.
 */
export default function MergeReviewStep({ summary, duplicateCount = 0, noun = 'person', nounPlural = 'people', onApply, onBack }) {
  const { newPeople, enrichedPeople, unchangedCount } = summary;
  const nothingNew = newPeople.length === 0 && enrichedPeople.length === 0;

  return (
    <div className="gedcom__review">
      {nothingNew ? (
        <div className="gedcom__review-empty">
          <div className="gedcom__review-empty-icon" aria-hidden="true"><CheckIcon /></div>
          <p className="gedcom__review-empty-title">You're already up to date.</p>
          <p className="gedcom__review-empty-sub">
            Every {noun} in this file matches what's already in your tree
            {unchangedCount > 0 ? ` — checked against ${unchangedCount} existing record${unchangedCount === 1 ? '' : 's'}` : ''}.
          </p>
        </div>
      ) : (
        <>
          <div className="gedcom__stats gedcom__stats--review">
            {newPeople.length > 0 && (
              <div className="gedcom__stat">
                <span className="gedcom__stat-num">{newPeople.length}</span>
                <span className="gedcom__stat-label">new {newPeople.length === 1 ? noun : nounPlural}</span>
              </div>
            )}
            {enrichedPeople.length > 0 && (
              <div className="gedcom__stat">
                <span className="gedcom__stat-num">{enrichedPeople.length}</span>
                <span className="gedcom__stat-label">gaining new facts</span>
              </div>
            )}
            {unchangedCount > 0 && (
              <div className="gedcom__stat gedcom__stat--muted">
                <span className="gedcom__stat-num">{unchangedCount}</span>
                <span className="gedcom__stat-label">already up to date</span>
              </div>
            )}
          </div>

          {newPeople.length > 0 && (
            <div className="gedcom__review-section">
              <p className="gedcom__review-section-title">New {newPeople.length === 1 ? noun : nounPlural}</p>
              <div className="gedcom__names">
                {newPeople.slice(0, 8).map((p) => (
                  <span key={p.id} className="gedcom__name-chip">{p.display_name}</span>
                ))}
                {newPeople.length > 8 && (
                  <span className="gedcom__name-chip gedcom__name-chip--more">+{newPeople.length - 8} more</span>
                )}
              </div>
            </div>
          )}

          {enrichedPeople.length > 0 && (
            <div className="gedcom__review-section">
              <p className="gedcom__review-section-title">Gaining new facts</p>
              <ul className="gedcom__review-list">
                {enrichedPeople.slice(0, 20).map((p) => (
                  <li key={p.id} className="gedcom__review-row">
                    <span className="gedcom__review-row-name">{p.name}</span>
                    <span className="gedcom__review-row-changes">{p.changes.join(' · ')}</span>
                  </li>
                ))}
                {enrichedPeople.length > 20 && (
                  <li className="gedcom__review-row gedcom__review-row--more">+{enrichedPeople.length - 20} more</li>
                )}
              </ul>
            </div>
          )}
        </>
      )}

      {duplicateCount > 0 && (
        <p className="gedcom__dup-note" role="status">
          <DupIcon /> {duplicateCount} possible duplicate {duplicateCount === 1 ? 'person' : 'people'} still {duplicateCount === 1 ? 'needs' : 'need'} review —
          you'll find them under "Possible duplicates" afterward.
        </p>
      )}

      <div className="gedcom__preview-actions">
        <button className="gedcom__back-btn" onClick={onBack}>← Back</button>
        <button className="gedcom__import-btn" onClick={onApply}>
          {nothingNew ? 'Close' : 'Add & update →'}
        </button>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DupIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{display:'inline',verticalAlign:'middle',marginRight:4}}>
      <path d="M12 9v4M12 16.5h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M10.3 3.9 1.8 18.3a1.6 1.6 0 0 0 1.4 2.4h17.6a1.6 1.6 0 0 0 1.4-2.4L13.7 3.9a1.6 1.6 0 0 0-2.8 0Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
    </svg>
  );
}

import { useMemo, useState } from 'react';

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
 *
 * Real user feedback: on a large re-import (300+ people, 355 flagged
 * duplicates), an all-or-nothing Apply wasn't granular enough — "I don't
 * necessarily want to add all new people, and maybe I only want the diffs
 * to existing people, or maybe I only want diffs for a few selected
 * people." Every new-person row and every enriched-person row is now its
 * own toggle, defaulting to included (so a quick Apply with no taps behaves
 * exactly as before this existed) — onApply receives the two exclusion sets
 * and dedupeMergeImport's own skipPeople/skipEnrichmentFor opts do the rest:
 * a deselected new person is dropped along with any relationship that would
 * have linked to them; a deselected existing person still gets its
 * duplicate collapsed/de-doubled normally, it just doesn't pick up any new
 * facts from it.
 *
 * A "new" person can still be a person who's ALREADY in the tree — most
 * commonly a living relative the source export omits a birth date for
 * (Ancestry's own privacy convention), which is exactly what
 * dedupeMergeImport's ordinary name+year match needs and can never get.
 * findLikelyExistingMatches (lib/duplicates.js) catches many of these via a
 * second signal — a shared relative already matched by name+year — and
 * summarizeMergeImport attaches it as `_likelyExisting` on the affected
 * newPeople entries. Those start OUT of the selection (excluded by
 * default, the opposite of every other new person) and carry a visibly
 * different row treatment, so the review doesn't quietly re-add 51 people
 * who were already there — confirmed against a real 81-person batch where
 * that was true for 51 of them.
 *
 * Codex design review, second pass: new people and enriched people used to
 * render as two visually DIFFERENT widgets — new people were a wrapped grid
 * of chip pills (no check glyph, state conveyed only by opacity/
 * strikethrough), enriched people were a vertical list of rows with a real
 * checkmark circle. Two different visual languages for the identical "tap
 * to include/exclude" action read as ambiguous — a chip could plausibly
 * mean "add this" or "this is flagged as a duplicate" depending which of
 * the two you'd seen first. Both sections now share ONE row treatment
 * (ReviewRow below). A sticky summary sentence pins under the numeric
 * stats so the plain-language consequence of the current selection ("You're
 * about to add 68 new people and update 12 existing records") stays visible
 * while scrolling a long list — the numbers alone don't say what tapping
 * Apply actually DOES. Per-row change details collapse to a short preview
 * with a "+N more" disclosure rather than always showing the full diff
 * inline, so one person with many changes doesn't turn their row into a
 * wall of text next to everyone else's one-liner.
 */
const CHANGE_PREVIEW_COUNT = 2;

export default function MergeReviewStep({ summary, duplicateCount = 0, noun = 'person', nounPlural = 'people', onApply, onBack }) {
  const { newPeople, enrichedPeople, unchangedCount } = summary;
  const [excludedNew, setExcludedNew] = useState(() => new Set(newPeople.filter((p) => p._likelyExisting).map((p) => p.id)));
  const [excludedExisting, setExcludedExisting] = useState(() => new Set());
  const [expandedChanges, setExpandedChanges] = useState(() => new Set());
  const likelyExistingCount = useMemo(() => newPeople.filter((p) => p._likelyExisting).length, [newPeople]);

  const toggleNew = (id) => setExcludedNew((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleExisting = (id) => setExcludedExisting((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleExpanded = (id) => setExpandedChanges((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const includedNewCount = newPeople.length - excludedNew.size;
  const includedExistingCount = enrichedPeople.length - excludedExisting.size;
  const nothingToShow = newPeople.length === 0 && enrichedPeople.length === 0;
  const nothingSelected = !nothingToShow && includedNewCount === 0 && includedExistingCount === 0;

  const applyLabel = useMemo(() => {
    if (nothingToShow) return 'Close';
    const parts = [];
    if (includedNewCount > 0) parts.push(`${includedNewCount} new`);
    if (includedExistingCount > 0) parts.push(`${includedExistingCount} updated`);
    return parts.length ? `Add & update (${parts.join(', ')}) →` : 'Nothing selected';
  }, [nothingToShow, includedNewCount, includedExistingCount]);

  // Plain-language echo of applyLabel's numbers — the sticky bar's whole
  // reason to exist is saying what Apply will actually DO, in a sentence a
  // long list of rows can't obscure by scrolling past it.
  const summarySentence = useMemo(() => {
    if (nothingToShow) return null;
    if (nothingSelected) return "You're about to import nothing — everything below is excluded.";
    const parts = [];
    if (includedNewCount > 0) parts.push(`add ${includedNewCount} new ${includedNewCount === 1 ? noun : nounPlural}`);
    if (includedExistingCount > 0) {
      parts.push(`update ${includedExistingCount} existing ${includedExistingCount === 1 ? 'record' : 'records'}`);
    }
    return `You're about to ${parts.join(' and ')}.`;
  }, [nothingToShow, nothingSelected, includedNewCount, includedExistingCount, noun, nounPlural]);

  function handleApply() {
    onApply({ excludedNewIds: excludedNew, excludedExistingIds: excludedExisting });
  }

  return (
    <div className="gedcom__review">
      {nothingToShow ? (
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
          <div className="gedcom__review-sticky">
            <div className="gedcom__stats gedcom__stats--review">
              {newPeople.length > 0 && (
                <div className="gedcom__stat">
                  <span className="gedcom__stat-num">{includedNewCount}<span className="gedcom__stat-num-of">/{newPeople.length}</span></span>
                  <span className="gedcom__stat-label">new {nounPlural}</span>
                </div>
              )}
              {enrichedPeople.length > 0 && (
                <div className="gedcom__stat">
                  <span className="gedcom__stat-num">{includedExistingCount}<span className="gedcom__stat-num-of">/{enrichedPeople.length}</span></span>
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
            {summarySentence && (
              <p className="gedcom__review-summary" role="status">{summarySentence}</p>
            )}
          </div>

          {newPeople.length > 0 && (
            <div className="gedcom__review-section">
              <div className="gedcom__review-section-head">
                <p className="gedcom__review-section-title">New {nounPlural} — tap to leave one out</p>
                <SelectLinks
                  onAll={() => setExcludedNew(new Set())}
                  onNone={() => setExcludedNew(new Set(newPeople.map((p) => p.id)))}
                />
              </div>
              {likelyExistingCount > 0 && (
                <p className="gedcom__review-flag-note">
                  <FlagIcon /> {likelyExistingCount} of these share a close relative already in your tree — left
                  out below (flagged) since they're likely already there under a slightly different record. Tap to
                  include if they really are new.
                </p>
              )}
              <ul className="gedcom__review-list">
                {newPeople.map((p) => (
                  <ReviewRow
                    key={p.id}
                    name={p.display_name}
                    off={excludedNew.has(p.id)}
                    onToggle={() => toggleNew(p.id)}
                    flagNote={p._likelyExisting ? `Might already be ${p._likelyExisting.name} — ${p._likelyExisting.reason}` : null}
                  />
                ))}
              </ul>
            </div>
          )}

          {enrichedPeople.length > 0 && (
            <div className="gedcom__review-section">
              <div className="gedcom__review-section-head">
                <p className="gedcom__review-section-title">Gaining new facts — tap to leave one out</p>
                <SelectLinks
                  onAll={() => setExcludedExisting(new Set())}
                  onNone={() => setExcludedExisting(new Set(enrichedPeople.map((p) => p.id)))}
                />
              </div>
              <ul className="gedcom__review-list">
                {enrichedPeople.map((p) => {
                  const expanded = expandedChanges.has(p.id);
                  const restCount = p.changes.length - CHANGE_PREVIEW_COUNT;
                  return (
                    <ReviewRow
                      key={p.id}
                      name={p.name}
                      off={excludedExisting.has(p.id)}
                      onToggle={() => toggleExisting(p.id)}
                      changesText={(expanded ? p.changes : p.changes.slice(0, CHANGE_PREVIEW_COUNT)).join(' · ')}
                      detailsLabel={restCount > 0 ? (expanded ? 'Show less' : `+${restCount} more`) : null}
                      onToggleDetails={restCount > 0 ? () => toggleExpanded(p.id) : null}
                    />
                  );
                })}
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
        <button className="gedcom__import-btn" onClick={handleApply} disabled={nothingSelected}>
          {applyLabel}
        </button>
      </div>
    </div>
  );
}

// One shared row treatment for both "new" and "enriched" people — a real
// checkbox-style row (checkmark circle, not a chip), matching what the
// enriched section already used so both read the same, unambiguous way.
// The inclusion toggle and the (optional) details disclosure are two
// separate buttons rather than one nested inside the other — a <button>
// can't contain another interactive element, and they need independent
// click targets (expanding details must never also exclude the person).
function ReviewRow({ name, off, onToggle, flagNote = null, changesText = null, detailsLabel = null, onToggleDetails = null }) {
  return (
    <li>
      <div className={`gedcom__review-row${off ? ' gedcom__review-row--off' : ''}${flagNote ? ' gedcom__review-row--flagged' : ''}`}>
        <button
          type="button"
          className="gedcom__review-row-toggle"
          aria-pressed={!off}
          onClick={onToggle}
        >
          <span className="gedcom__review-row-check" aria-hidden="true">{off ? '' : <CheckIcon size={12} />}</span>
          <span className="gedcom__review-row-text">
            <span className="gedcom__review-row-name">{name}</span>
            {flagNote && <span className="gedcom__review-row-flag">{flagNote}</span>}
            {changesText && <span className="gedcom__review-row-changes">{changesText}</span>}
          </span>
        </button>
        {detailsLabel && (
          <button type="button" className="gedcom__review-row-details" onClick={(e) => { e.stopPropagation(); onToggleDetails(); }}>
            {detailsLabel}
          </button>
        )}
      </div>
    </li>
  );
}

function SelectLinks({ onAll, onNone }) {
  return (
    <span className="gedcom__review-select-links">
      <button type="button" className="gedcom__review-select-link" onClick={onAll}>All</button>
      <span className="gedcom__review-select-sep">·</span>
      <button type="button" className="gedcom__review-select-link" onClick={onNone}>None</button>
    </span>
  );
}

function CheckIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

function FlagIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{display:'inline',verticalAlign:'middle',marginRight:4}}>
      <path d="M5 3v18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
      <path d="M5 4h11l-2.5 3.5L16 11H5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/>
    </svg>
  );
}

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
 * default, the opposite of every other new person) and — per the Codex
 * design review below — render as their OWN section rather than flagged
 * rows mixed into the New people list: "Potential matches — not selected."
 * A person deciding whether to trust a big re-import needs that boundary
 * to be structural, not a visual detail inside a list they might not
 * notice; confirmed against a real 81-person batch where 51 of them were
 * exactly this case.
 *
 * Codex design review, second pass: new people and enriched people used to
 * render as two visually DIFFERENT widgets — new people were a wrapped grid
 * of chip pills with no check glyph (state only conveyed by opacity/
 * strikethrough), enriched people were a vertical list of rows with a real
 * checkmark circle. Both sections now share ONE row treatment (ReviewRow
 * below). A sticky summary sentence pins under the numeric stats so the
 * plain-language consequence of the current selection stays visible while
 * scrolling a long list.
 *
 * Codex design review, third pass (polish): (1) the flagged/matches rows
 * get their own section (above) with a stated consequence — "Including
 * this person will add N relationships" — computed from summary.raw's own
 * relationship list (the same one a real Apply would write), so the number
 * is never a guess; (2) the "+N more" details disclosure now names who it's
 * about, shows a rotating chevron, and exposes real aria-expanded state;
 * (3) "All"/"None" carry a real accessible name per section/action
 * ("Include all new people") — the visible text stays terse, but a screen
 * reader tabbing past several identical bare "All"/"None" pairs on one
 * screen previously had no way to tell them apart.
 */
const CHANGE_PREVIEW_COUNT = 2;

export default function MergeReviewStep({ summary, duplicateCount = 0, noun = 'person', nounPlural = 'people', onApply, onBack }) {
  const { newPeople, enrichedPeople, unchangedCount } = summary;
  const [excludedNew, setExcludedNew] = useState(() => new Set(newPeople.filter((p) => p._likelyExisting).map((p) => p.id)));
  const [excludedExisting, setExcludedExisting] = useState(() => new Set());
  const [expandedChanges, setExpandedChanges] = useState(() => new Set());

  const plainNewPeople = useMemo(() => newPeople.filter((p) => !p._likelyExisting), [newPeople]);
  const potentialMatches = useMemo(() => newPeople.filter((p) => p._likelyExisting), [newPeople]);

  // How many relationships including this person would actually add —
  // summary.raw.relationships is dedupeMergeImport's own kept-edges list
  // (already deduped/remapped against the existing tree), the same set a
  // real Apply writes, so this is a fact about the file, not an estimate.
  const relCountByPersonId = useMemo(() => {
    const m = new Map();
    for (const r of summary.raw?.relationships || []) {
      m.set(r.from_person, (m.get(r.from_person) || 0) + 1);
      m.set(r.to_person, (m.get(r.to_person) || 0) + 1);
    }
    return m;
  }, [summary.raw]);

  const toggleNewIds = (ids, exclude) => setExcludedNew((prev) => {
    const next = new Set(prev);
    for (const id of ids) { if (exclude) next.add(id); else next.delete(id); }
    return next;
  });
  const toggleNew = (id) => toggleNewIds([id], !excludedNew.has(id));
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

          {plainNewPeople.length > 0 && (
            <div className="gedcom__review-section">
              <div className="gedcom__review-section-head">
                <p className="gedcom__review-section-title">New {nounPlural} — tap to leave one out</p>
                <SelectLinks
                  sectionLabel={`new ${nounPlural}`}
                  onAll={() => toggleNewIds(plainNewPeople.map((p) => p.id), false)}
                  onNone={() => toggleNewIds(plainNewPeople.map((p) => p.id), true)}
                />
              </div>
              <ul className="gedcom__review-list">
                {plainNewPeople.map((p) => (
                  <ReviewRow
                    key={p.id}
                    name={p.display_name}
                    off={excludedNew.has(p.id)}
                    onToggle={() => toggleNew(p.id)}
                  />
                ))}
              </ul>
            </div>
          )}

          {potentialMatches.length > 0 && (
            <div className="gedcom__review-section">
              <div className="gedcom__review-section-head">
                <p className="gedcom__review-section-title">Potential matches — not selected</p>
                <SelectLinks
                  sectionLabel="potential matches"
                  onAll={() => toggleNewIds(potentialMatches.map((p) => p.id), false)}
                  onNone={() => toggleNewIds(potentialMatches.map((p) => p.id), true)}
                />
              </div>
              <p className="gedcom__review-flag-note">
                <FlagIcon /> These share a close relative already in your tree — likely already there under a
                slightly different record. Left out by default; tap to include if they really are new.
              </p>
              <ul className="gedcom__review-list">
                {potentialMatches.map((p) => (
                  <ReviewRow
                    key={p.id}
                    name={p.display_name}
                    off={excludedNew.has(p.id)}
                    onToggle={() => toggleNew(p.id)}
                    flagNote={`Might already be ${p._likelyExisting.name} — ${p._likelyExisting.reason}`}
                    consequence={relConsequence(relCountByPersonId.get(p.id))}
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
                  sectionLabel="existing records"
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
                      detailsCount={restCount > 0 ? restCount : null}
                      detailsExpanded={expanded}
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

function relConsequence(count) {
  if (!count) return null;
  return `Including this person will add ${count} relationship${count === 1 ? '' : 's'}.`;
}

// One shared row treatment for both "new" and "enriched" people — a real
// checkbox-style row (checkmark circle, not a chip), matching what the
// enriched section already used so both read the same, unambiguous way.
// The inclusion toggle and the (optional) details disclosure are two
// separate buttons rather than one nested inside the other — a <button>
// can't contain another interactive element, and they need independent
// click targets (expanding details must never also exclude the person).
function ReviewRow({ name, off, onToggle, flagNote = null, consequence = null, changesText = null, detailsCount = null, detailsExpanded = false, onToggleDetails = null }) {
  const detailsLabel = detailsExpanded ? 'Show less' : `+${detailsCount} more`;
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
            {consequence && <span className="gedcom__review-row-consequence">{consequence}</span>}
            {changesText && <span className="gedcom__review-row-changes">{changesText}</span>}
          </span>
        </button>
        {onToggleDetails && (
          <button
            type="button"
            className="gedcom__review-row-details"
            aria-expanded={detailsExpanded}
            aria-label={detailsExpanded ? `Show fewer changes for ${name}` : `Show ${detailsCount} more change${detailsCount === 1 ? '' : 's'} for ${name}`}
            onClick={(e) => { e.stopPropagation(); onToggleDetails(); }}
          >
            {detailsLabel}
            <ChevronIcon expanded={detailsExpanded} />
          </button>
        )}
      </div>
    </li>
  );
}

function SelectLinks({ onAll, onNone, sectionLabel }) {
  return (
    <span className="gedcom__review-select-links">
      <button type="button" className="gedcom__review-select-link" aria-label={`Include all ${sectionLabel}`} onClick={onAll}>All</button>
      <span className="gedcom__review-select-sep">·</span>
      <button type="button" className="gedcom__review-select-link" aria-label={`Exclude all ${sectionLabel}`} onClick={onNone}>None</button>
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

function ChevronIcon({ expanded }) {
  return (
    <svg
      width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true"
      className={`gedcom__review-row-chevron${expanded ? ' gedcom__review-row-chevron--up' : ''}`}
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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

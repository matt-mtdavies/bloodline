import { familySpan } from '../lib/dates.js';

/*
 * The moment right after a GEDCOM or FamilySearch import lands — replacing
 * the old purely functional confirmation ("N people imported / View my
 * tree →") with a narrative landing moment. Real feedback: "Instead of
 * dropping them into a tree, Bloodline could gently introduce them: 'We've
 * found 486 people connected across 212 years of family history.'" Same
 * data as the old copy (a person count, the source's own caveats about
 * what it can't carry) — just framed as an arrival rather than a receipt.
 *
 * Shared by GedcomImport.jsx and FamilySearchImport.jsx, which differ only
 * in noun ("person" vs "ancestor") and what their source can't carry
 * (portraits/memories) — everything else, including the family-span
 * calculation, is identical and lives here once.
 *
 * `addedCount`/`enrichedCount` (merge mode only, from summarizeMergeImport —
 * see lib/duplicates.js): a delta re-import of an already-imported file
 * mostly COLLAPSES re-adds rather than adding new people, so `people.length`
 * (the raw parsed batch) would overstate what actually happened — "The
 * family just got bigger... We've found 300 more people" when only 5 were
 * genuinely new. When addedCount is 0, this lands on an honest "up to date"
 * state instead of the arrival narrative, which doesn't fit an import that
 * added nobody.
 */
export default function ImportDoneStep({ people, mergeMode, noun = 'person', nounPlural = 'people', sourceNote, addedCount, enrichedCount = 0, onClose }) {
  const span = familySpan(people);
  const isMerge = mergeMode === 'merge';
  const count = isMerge && addedCount != null ? addedCount : people.length;
  const nothingAdded = isMerge && addedCount === 0;

  const narrative = nothingAdded
    ? enrichedCount > 0
      ? `No new ${nounPlural}, but ${enrichedCount} ${enrichedCount === 1 ? 'profile' : 'profiles'} picked up new details from this file.`
      : `Nothing in this file was new — your tree already had everyone in it.`
    : `We've found ${isMerge ? `${count} more` : count} ${count === 1 ? noun : nounPlural}${span ? ` connected across ${span.spanYears} years of family history` : ''}.`;

  return (
    <div className="gedcom__done">
      <div className="gedcom__done-icon" aria-hidden="true">
        <CheckIcon />
      </div>
      <h3 className="gedcom__done-title">
        {nothingAdded ? 'Your tree is up to date.' : isMerge ? 'The family just got bigger.' : 'Welcome home.'}
      </h3>
      <p className="gedcom__done-narrative">{narrative}</p>
      {!nothingAdded && (
        <p className="gedcom__done-sub">
          {isMerge
            ? "They've been added to your existing tree — let's see who's new."
            : "Let's begin with the people who brought you here."}
          {' '}{sourceNote}
        </p>
      )}
      <button className="gedcom__import-btn" onClick={onClose}>
        {nothingAdded ? 'Done' : isMerge ? 'See what\'s new →' : 'Meet your family →'}
      </button>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
 */
export default function ImportDoneStep({ people, mergeMode, noun = 'person', nounPlural = 'people', sourceNote, onClose }) {
  const span = familySpan(people);
  const count = people.length;
  const isMerge = mergeMode === 'merge';

  return (
    <div className="gedcom__done">
      <div className="gedcom__done-icon" aria-hidden="true">
        <CheckIcon />
      </div>
      <h3 className="gedcom__done-title">
        {isMerge ? 'The family just got bigger.' : 'Welcome home.'}
      </h3>
      <p className="gedcom__done-narrative">
        We've found {isMerge ? `${count} more` : count} {count === 1 ? noun : nounPlural}
        {span ? ` connected across ${span.spanYears} years of family history` : ''}.
      </p>
      <p className="gedcom__done-sub">
        {isMerge
          ? "They've been added to your existing tree — let's see who's new."
          : "Let's begin with the people who brought you here."}
        {' '}{sourceNote}
      </p>
      <button className="gedcom__import-btn" onClick={onClose}>
        {isMerge ? 'See what\'s new →' : 'Meet your family →'}
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

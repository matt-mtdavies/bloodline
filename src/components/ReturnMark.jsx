import Logo from './Logo.jsx';

/*
 * The one consistent "go back" control for every full-screen page reached
 * from the tree (Tree Insights, Family settings, Your profile, Family
 * Activity, Family timeline) and Home's own two nested subpages (How it
 * works, Family trees). Replaces roughly a dozen bespoke close-button
 * treatments — a plain circle here, a rounded square there, three
 * different background tokens — with the one mark the topbar itself
 * already uses to mean "this takes you home": the breathing family mark,
 * idle exactly like it is everywhere else, so the same recognizable
 * gesture works no matter which page or how deep it opened from.
 *
 * Deliberately icon-only, no wordmark — every one of these pages already
 * carries its own title ("Tree insights", "Family settings", ...)
 * immediately beside it; only Home itself (the top of the stack, closest
 * in spirit to the topbar) pairs the mark with "Bloodline" text, composed
 * directly in Home.jsx rather than through this shared component.
 *
 * `onClick` keeps whatever destination the page already wired to its old
 * close button — HowItWorks/FamilyTrees still return to Home (they're
 * nested under it), everything else still returns straight to the tree.
 * This is a visual and interaction unification, not a navigation change.
 */
export default function ReturnMark({ onClick, label = 'Back to the tree' }) {
  return (
    <button className="return-mark" onClick={onClick} aria-label={label}>
      <Logo size={20} idle animate={false} />
    </button>
  );
}

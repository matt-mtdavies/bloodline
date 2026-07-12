/*
 * Shared military iconography — branch marks, the Australian slouch hat
 * special case, and the medal glyph. Used by the profile's Military Service
 * section (the dog tag), the Activity Feed (badges on military-related
 * updates), and Tree Insights (the service-records module) so all three
 * surfaces draw the same marks rather than three near-identical SVG sets.
 */

// Picks the closest icon for a branch — a nation-specific icon when we
// recognize both the branch and a nation known to have one (today: just the
// Australian slouch hat for army), otherwise the generic branch icon, and
// the plain ribbon when branch itself isn't known. Deliberately starting
// with one nation rather than building a library up front — more added
// later only as real family records call for them.
export function BranchIcon({ branch, nation, size = 14 }) {
  if (branch === 'army' && (nation || '').toLowerCase().includes('australia')) return <SlouchHatIcon size={size} />;
  if (branch === 'army') return <ArmyIcon size={size} />;
  if (branch === 'navy') return <NavyIcon size={size} />;
  if (branch === 'air_force') return <AirForceIcon size={size} />;
  return <RibbonIcon size={size} />;
}

export function ArmyIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 14.5l8-6.5 8 6.5M4 20l8-6.5 8 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function NavyIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="5.5" r="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7.5v13M6.5 13H4a8 8 0 0 0 16 0h-2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 10.8h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function AirForceIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9.6 12.3c-2.6-.2-5.7-1.5-8.1-3.4 0 2.8 2.4 5.7 6.9 6.9M14.4 12.3c2.6-.2 5.7-1.5 8.1-3.4 0 2.8-2.4 5.7-6.9 6.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// A simplified, abstracted silhouette — the wide brim, one side pinned up
// against the crown, a small badge mark — not a literal or historically
// precise rendering of any specific era's slouch hat.
export function SlouchHatIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2 16.3c2.6-1.7 6.2-2.6 10-2.6s7.4.9 10 2.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7.6 13.9c0-3.3 2-5.9 4.4-5.9s4.4 2.6 4.4 5.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16.4 14.1c1.5.5 3.1.1 4-1.1-.9-1.3-2.5-1.9-4-1.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="17.6" cy="12.1" r="0.9" fill="currentColor" />
    </svg>
  );
}

// A medal disc on a ribbon — diverging ribbon tails at top, a star inside
// the disc — distinct from RibbonIcon by having a filled disc rather than
// an open circle.
export function MedalIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8.5 3.5l2 5M15.5 3.5l-2 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="15" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 11.8l1 2.1 2.3.33-1.65 1.6.4 2.28L12 17l-2.05 1.1.4-2.27-1.65-1.6 2.3-.33z" fill="currentColor" />
    </svg>
  );
}

export function RibbonIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 13l-2 8 5.5-3 5.5 3-2-8" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

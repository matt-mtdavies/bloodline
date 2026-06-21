// Role hierarchy (higher index = more access).
export const ROLES = ['viewer', 'contributor', 'editor', 'coadmin', 'owner'];
export const ROLE_LABELS = {
  owner: 'Owner', coadmin: 'Co-Admin', editor: 'Editor',
  contributor: 'Contributor', viewer: 'Viewer',
};
export const ROLE_COLORS = {
  owner: '#241f1c', coadmin: '#c2603a', editor: '#3a6ec2',
  contributor: '#3a8a4a', viewer: '#8a8480',
};

export const VISIBILITY_LABELS = {
  full: 'Open', summary: 'Protected', private: 'Private',
};
export const VISIBILITY_DESCS = {
  full: 'All details visible to everyone',
  summary: 'Name and dates only — bio, memories and photos hidden',
  private: 'Exists in the tree but all details are sealed',
};

export function roleRank(role) {
  return ROLES.indexOf(role ?? 'viewer');
}

export function canEdit(myRole) {
  return roleRank(myRole) >= roleRank('editor');
}

export function canInvite(myRole) {
  return roleRank(myRole) >= roleRank('coadmin');
}

// What level of detail a viewer with `myRole` can see for a given person.
// Returns 'full' | 'summary' | 'hidden'.
export function effectiveVisibility(person, myRole) {
  if (roleRank(myRole) >= roleRank('coadmin')) return 'full';
  const v = person?.visibility ?? 'full';
  if (v === 'private') return 'hidden';
  if (v === 'summary') return 'summary';
  return 'full';
}

// Whether a specific profile section is visible.
export function sectionVisible(person, section, myRole) {
  if (roleRank(myRole) >= roleRank('coadmin')) return true;
  if (effectiveVisibility(person, myRole) !== 'full') return false;
  const sv = person?.sectionVisibility;
  return sv?.[section] !== false; // default true
}

export const SECTIONS = [
  { key: 'bio', label: 'About / bio' },
  { key: 'events', label: 'Life events' },
  { key: 'memories', label: 'Memories' },
  { key: 'photos', label: 'Photos' },
  { key: 'documents', label: 'Documents' },
];

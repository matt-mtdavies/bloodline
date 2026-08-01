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
// What each assignable role can actually do — shown wherever a role is
// picked (the invite flow, ManageMemberSheet's role picker) so the choice
// is explained inline rather than left to the label alone.
export const ROLE_DESCS = {
  coadmin: 'Can manage members, edit the whole tree',
  editor: 'Can add and edit people, memories, photos',
  contributor: 'Can add memories and photos only',
  viewer: 'Read-only access',
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

// Contributors and above may add memories & photos (but not edit structure).
export function canContribute(myRole) {
  return roleRank(myRole) >= roleRank('contributor');
}

export function canInvite(myRole) {
  return roleRank(myRole) >= roleRank('coadmin');
}

// Hard-to-undo, whole-tree-affecting actions (erase tree, replace-import,
// merge duplicate people, remove a person entirely) — same bar as inviting,
// named separately so call sites read as "is this destructive enough to
// need an admin" rather than "can this person send invites".
export function canManageTree(myRole) {
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

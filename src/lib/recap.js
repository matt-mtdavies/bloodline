// Groups the activity log into a cinematic "what changed since you were
// last here" queue for RecapTour — one stop per PERSON (not per event), so
// three edits to the same profile become one visit with a "3 updates"
// caption instead of the bubble being revisited three times.
//
// `member_joined` and `person_removed` events have no tree person to fly to
// (the latter's personId no longer resolves to anyone), so they're excluded;
// everything else already carries the personId/personName the activity feed
// itself relies on. Your OWN edits are excluded too — this is "what changed
// while you were away", not a personal changelog of your own actions, so
// editing your own tree shouldn't make it look like something needs
// catching up on.
const CAP = 20; // keep the tour to a real "highlights reel", not a slog
const NO_BUBBLE_TYPES = new Set(['member_joined', 'person_removed']);

export function groupRecapUpdates(activity, sinceMs, { cap = CAP, viewerEmail = null } = {}) {
  if (!sinceMs || !activity?.length) return [];

  const byPerson = new Map();
  for (const event of activity) {
    if (!event.personId || NO_BUBBLE_TYPES.has(event.type)) continue;
    if (viewerEmail && event.authorEmail && event.authorEmail === viewerEmail) continue;
    const at = new Date(event.created_at).getTime();
    if (!(at > sinceMs)) continue;
    let group = byPerson.get(event.personId);
    if (!group) {
      group = { personId: event.personId, personName: event.personName, events: [], firstAt: at };
      byPerson.set(event.personId, group);
    }
    group.events.push(event);
    if (at < group.firstAt) group.firstAt = at;
  }

  const groups = [...byPerson.values()].sort((a, b) => a.firstAt - b.firstAt);
  // Keep the most RECENT `cap` people changed (not the oldest), but preserve
  // chronological order for playback so the tour reads as a narrative.
  return groups.length > cap ? groups.slice(groups.length - cap) : groups;
}

export function captionForRecapGroup(group) {
  if (group.events.length > 1) return `${group.events.length} updates`;
  return captionForEvent(group.events[0]);
}

function captionForEvent(event) {
  switch (event.type) {
    case 'person_added': return 'Added to the tree';
    case 'memory_added': return 'New memory added';
    case 'photo_added': return 'New photo added';
    case 'document_added': return 'New document added';
    case 'portrait_updated': return 'Portrait updated';
    case 'person_updated': return event.detail ? `${capitalize(event.detail)} updated` : 'Profile updated';
    case 'relationship_added': return 'Family connection added';
    case 'relationship_changed': return 'Relationship updated';
    case 'relationship_removed': return 'Family connection removed';
    case 'people_merged': return 'Merged with a duplicate profile';
    case 'health_updated': return 'Health information updated';
    default: return 'Updated';
  }
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

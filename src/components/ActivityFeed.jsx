import { useMemo, useEffect } from 'react';
import Avatar from './Avatar.jsx';
import { BranchIcon, MedalIcon } from './MilitaryIcons.jsx';
import ReturnMark from './ReturnMark.jsx';

// person_updated activity details that trace back to a military-only edit
// (see App.jsx's applyDocumentField, which turns 'military_branch' etc. into
// 'military branch', and store.js's addMedal, which always logs 'medals') —
// the only detail strings we can badge without guessing what actually changed.
const MILITARY_FIELD_DETAILS = new Set(['military branch', 'military nation', 'military service number', 'military rank']);

export default function ActivityFeed({ activity = [], people = [], userEmail, onClose, onSelectPerson, recapCount = 0, onShowRecap }) {
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  // Resolve an author's real name from their email by matching a tree person —
  // so the feed shows "Jess Ransom", not the "jscottd" guessed from the address.
  const nameByEmail = useMemo(() => {
    const m = new Map();
    for (const p of people) {
      for (const e of [p.email, p.invited_email]) {
        if (e) m.set(e.toLowerCase(), p.display_name);
      }
    }
    return m;
  }, [people]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Group events by calendar-day label (newest first)
  const grouped = useMemo(() => {
    const groups = [];
    let currentLabel = null;
    let currentItems = [];
    for (const event of activity) {
      const label = dayLabel(event.created_at);
      if (label !== currentLabel) {
        if (currentLabel !== null) groups.push({ label: currentLabel, items: currentItems });
        currentLabel = label;
        currentItems = [event];
      } else {
        currentItems.push(event);
      }
    }
    if (currentLabel !== null) groups.push({ label: currentLabel, items: currentItems });
    return groups;
  }, [activity]);

  return (
    <>
      <div className="activity-scrim" onClick={onClose} aria-hidden="true" />
      <div className="activity-panel" role="dialog" aria-label="Family activity" aria-modal="true">
        <div className="activity-panel__header">
          <ReturnMark onClick={onClose} />
          <h2 className="activity-panel__title">Family Activity</h2>
        </div>

        {recapCount > 0 && onShowRecap && (
          <button className="activity-recap-hero" onClick={onShowRecap}>
            <span className="activity-recap-hero__spark" aria-hidden="true"><SparkIcon /></span>
            <span className="activity-recap-hero__text">
              <span className="activity-recap-hero__title">
                {recapCount} {recapCount === 1 ? 'update' : 'updates'} since you were last here
              </span>
              <span className="activity-recap-hero__cta">Show me</span>
            </span>
            <ChevronRightIcon />
          </button>
        )}

        {activity.length === 0 ? (
          <ActivityEmpty />
        ) : (
          <div className="activity-list">
            {grouped.map(({ label, items }) => (
              <div key={label}>
                <p className="activity-day">{label}</p>
                {items.map((event) => (
                  <ActivityRow
                    key={event.id}
                    event={event}
                    person={byId.get(event.personId) ?? { display_name: event.personName }}
                    userEmail={userEmail}
                    nameByEmail={nameByEmail}
                    onSelect={() => { onClose(); onSelectPerson?.(event.personId); }}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function ActivityRow({ event, person, userEmail, nameByEmail, onSelect }) {
  const { color, Icon } = militaryTypeConfig(event, person) ?? typeConfig(event.type);
  const showDetail = (event.type === 'memory_added' || event.type === 'document_added') && event.detail;
  // For join events, there's no tree person — show the member's own avatar.
  const avatarPerson = event.type === 'member_joined'
    ? { display_name: event.personName || event.authorName }
    : person;
  // Nothing to navigate to for either — the person's gone (member_joined has
  // no tree person at all; person_removed's personId no longer resolves).
  const nonInteractive = event.type === 'member_joined' || event.type === 'person_removed';

  return (
    <button className="activity-row" onClick={nonInteractive ? undefined : onSelect}
      style={nonInteractive ? { cursor: 'default' } : undefined}>
      <div className="activity-row__avatar-wrap">
        <Avatar person={avatarPerson} size={40} />
        <span className="activity-row__badge" style={{ background: color }} aria-hidden="true">
          <Icon />
        </span>
      </div>
      <div className="activity-row__body">
        <p className="activity-row__desc">
          <EventDescription event={event} userEmail={userEmail} nameByEmail={nameByEmail} />
        </p>
        {showDetail && (
          <p className="activity-row__detail">
            {event.type === 'memory_added' ? `"${event.detail}"` : event.detail}
          </p>
        )}
      </div>
      <time className="activity-row__time" dateTime={event.created_at}>
        {relativeTime(event.created_at)}
      </time>
    </button>
  );
}

function EventDescription({ event, userEmail, nameByEmail }) {
  const isMe = userEmail && event.authorEmail ? event.authorEmail === userEmail : !event.authorEmail;
  const resolvedName = (event.authorEmail && nameByEmail?.get(event.authorEmail.toLowerCase()))
    || event.authorName || 'Someone';
  const author = <strong key="a">{isMe ? 'You' : resolvedName}</strong>;
  const subject = <strong key="s" className="activity-row__subject">{event.personName}</strong>;

  switch (event.type) {
    case 'person_added':
      return <>{author} added {subject} to the tree</>;
    case 'memory_added':
      return <>{author} added a memory of {subject}</>;
    case 'photo_added':
      return <>{author} added a photo of {subject}</>;
    case 'document_added':
      return <>{author} added a document for {subject}</>;
    case 'portrait_updated':
      return <>{author} updated {subject}'s portrait</>;
    case 'person_updated':
      return <>{author} updated {subject}'s {event.detail ?? 'profile'}</>;
    case 'relationship_added':
      return (
        <>
          {author} connected {subject}
          {event.detail ? <> and <strong key="d">{event.detail}</strong></> : null}
        </>
      );
    case 'member_joined':
      return <>{author} joined the family tree</>;
    case 'relationship_changed':
      return (
        <>
          {author} updated {subject}'s relationship
          {event.detail ? <> — <strong key="d">{event.detail}</strong></> : null}
        </>
      );
    case 'relationship_removed':
      return (
        <>
          {author} removed the connection between {subject}
          {event.detail ? <> and <strong key="d">{event.detail}</strong></> : null}
        </>
      );
    case 'people_merged':
      return (
        <>
          {author} merged {subject}
          {event.detail ? <> with <strong key="d">{event.detail}</strong></> : null}
        </>
      );
    case 'person_removed':
      return <>{author} removed {subject} from the tree</>;
    case 'health_updated':
      return <>{author} updated {subject}'s health information</>;
    case 'keepsake_generated':
      return <>{author} compiled the {event.detail || 'latest edition'} of {subject}'s Keepsake</>;
    default:
      return <>{author} updated {subject}</>;
  }
}

function ActivityEmpty() {
  return (
    <div className="activity-empty">
      <div className="activity-empty__icon">
        <PulseIcon />
      </div>
      <p className="activity-empty__title">No activity yet</p>
      <p className="activity-empty__sub">
        Add people, write memories, and upload photos — every action will appear here.
      </p>
    </div>
  );
}

// A military-specific badge override for person_updated events whose detail
// unambiguously traces to a military edit — a medal add, or one of the four
// document-extracted service fields. Everything else (including the generic
// 'life events' detail, which can't tell a military-tagged event from a
// birthday) falls through to the plain edit icon rather than guess.
function militaryTypeConfig(event, person) {
  if (event.type !== 'person_updated') return null;
  if (event.detail === 'medals') return { color: '#a8842f', Icon: () => <MedalIcon size={9} /> };
  if (MILITARY_FIELD_DETAILS.has(event.detail)) {
    return { color: '#5b6b7a', Icon: () => <BranchIcon branch={person?.military_branch} nation={person?.military_nation} size={9} /> };
  }
  return null;
}

function typeConfig(type) {
  switch (type) {
    case 'person_added':      return { color: '#3a8a5a', Icon: PersonAddIcon };
    case 'memory_added':      return { color: '#c2603a', Icon: MemoryIcon };
    case 'photo_added':       return { color: '#3b73b8', Icon: CameraIcon };
    case 'document_added':    return { color: '#7b5ea8', Icon: DocumentIcon };
    case 'portrait_updated':  return { color: '#c2603a', Icon: PortraitIcon };
    case 'person_updated':    return { color: '#6b6f76', Icon: EditIcon };
    case 'relationship_added':return { color: '#4b6ea8', Icon: LinkIcon };
    case 'relationship_changed': return { color: '#6b7fb8', Icon: LinkIcon };
    case 'relationship_removed': return { color: '#8a5a52', Icon: UnlinkIcon };
    case 'people_merged':     return { color: '#3d8c7a', Icon: MergeIcon };
    case 'person_removed':    return { color: '#8a6f52', Icon: PersonRemoveIcon };
    case 'health_updated':    return { color: '#5a8a72', Icon: HeartIcon };
    case 'member_joined':     return { color: '#2a7a6a', Icon: JoinIcon };
    case 'keepsake_generated':return { color: '#a44d2c', Icon: KeepsakeIcon };
    default:                  return { color: '#6b6f76', Icon: EditIcon };
  }
}

export function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const tDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((tDay - dDay) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString('en-GB', { weekday: 'long' });
  if (diffDays < 365) return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/* ── Icons ─────────────────────────────────────────────────────────────────── */


function PersonAddIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10" cy="8" r="4" stroke="currentColor" strokeWidth="2.2" />
      <path d="M2 20c0-4 3.6-7 8-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M18 13v7M14.5 16.5h7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function MemoryIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
        stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"
        stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
        stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <polyline points="14 2 14 8 20 8" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <line x1="9" y1="13" x2="15" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="9" y1="17" x2="15" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PortraitIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2.2" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UnlinkIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8.5 15.5a5 5 0 0 0 7.54.04l3-3a5 5 0 0 0-7.07-7.07l-1 1"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.5 8.5a5 5 0 0 0-7.54-.04l-3 3a5 5 0 0 0 7.07 7.07l1-1"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="3" y1="21" x2="21" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function MergeIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="7" cy="6" r="3" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="17" cy="6" r="3" stroke="currentColor" strokeWidth="2.2" />
      <path d="M7 9v2a5 5 0 0 0 10 0V9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="18" r="3.5" stroke="currentColor" strokeWidth="2.2" />
    </svg>
  );
}

function PersonRemoveIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10" cy="8" r="4" stroke="currentColor" strokeWidth="2.2" />
      <path d="M2 20c0-4 3.6-7 8-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M14.5 16.5h7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 20.5s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9.5c0 6-8 11-8 11z"
        stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function JoinIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2.2" />
      <path d="M2 21c0-4 3.1-7 7-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M19 12l-5 5 5 5M14 17h7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function KeepsakeIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l1.8 4.9L18.7 9.7l-4.9 1.8L12 16.4l-1.8-4.9L5.3 9.7l4.9-1.8L12 3z" fill="currentColor" />
      <path d="M19 14l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7L19 14z" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PulseIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" stroke="currentColor" strokeWidth="1.7"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

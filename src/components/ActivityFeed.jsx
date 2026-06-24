import { useMemo, useEffect } from 'react';
import Avatar from './Avatar.jsx';

export default function ActivityFeed({ activity = [], people = [], onClose, onSelectPerson }) {
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

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
          <h2 className="activity-panel__title">Family Activity</h2>
          <button className="activity-panel__close" onClick={onClose} aria-label="Close activity panel">
            <CloseIcon />
          </button>
        </div>

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

function ActivityRow({ event, person, onSelect }) {
  const { color, Icon } = typeConfig(event.type);
  const showDetail = (event.type === 'memory_added' || event.type === 'document_added') && event.detail;

  return (
    <button className="activity-row" onClick={onSelect}>
      <div className="activity-row__avatar-wrap">
        <Avatar person={person} size={40} />
        <span className="activity-row__badge" style={{ background: color }} aria-hidden="true">
          <Icon />
        </span>
      </div>
      <div className="activity-row__body">
        <p className="activity-row__desc">
          <EventDescription event={event} />
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

function EventDescription({ event }) {
  const author = <strong key="a">{event.authorName ?? 'You'}</strong>;
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

function typeConfig(type) {
  switch (type) {
    case 'person_added':      return { color: '#3a8a5a', Icon: PersonAddIcon };
    case 'memory_added':      return { color: '#c2603a', Icon: MemoryIcon };
    case 'photo_added':       return { color: '#3b73b8', Icon: CameraIcon };
    case 'document_added':    return { color: '#7b5ea8', Icon: DocumentIcon };
    case 'portrait_updated':  return { color: '#c2603a', Icon: PortraitIcon };
    case 'person_updated':    return { color: '#6b6f76', Icon: EditIcon };
    case 'relationship_added':return { color: '#4b6ea8', Icon: LinkIcon };
    default:                  return { color: '#6b6f76', Icon: EditIcon };
  }
}

function relativeTime(iso) {
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

function dayLabel(iso) {
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

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

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

function PulseIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" stroke="currentColor" strokeWidth="1.7"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

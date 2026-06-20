import { useEffect, useRef } from 'react';
import Avatar from './Avatar.jsx';
import { lifespan, formatDate, ageOrAt } from '../lib/dates.js';
import { relationLabel } from '../data/graph.js';
import { profileCompleteness, lifeEvents } from '../lib/profile.js';
import { fileToDataUrl } from '../lib/image.js';

/*
 * The profile. In V2 this is the destination, not a popover — a portrait,
 * a life, and the beginnings of the stories that should outlast a person.
 * The tree recedes behind it; this rises as a full reading surface.
 *
 * Living minors get a light privacy note rather than full exposure (§7).
 */
export default function PersonSheet({
  graph,
  personId,
  viewerId,
  memories = [],
  photos = [],
  lockEscape = false,
  onClose,
  onFocus,
  onOpenPerson,
  onAddRelative,
  onEdit,
  onEditTimeline,
  onAddMemory,
  onVoteMemory,
  onRemoveMemory,
  onAddPhoto,
  onOpenLightbox,
  onPhoto,
}) {
  const person = personId ? graph.byId.get(personId) : null;
  const fileRef = useRef(null);
  const galleryRef = useRef(null);

  useEffect(() => {
    if (!person || lockEscape) return; // a stacked overlay owns Escape
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [person, onClose, lockEscape]);

  if (!person) return null;

  const minor = person.is_minor && !person.is_deceased;
  const partners = graph.partners(person.id);
  const parents = graph.parents(person.id);
  const children = graph.children(person.id);
  const siblings = graph.siblings(person.id);

  const groups = [
    { title: partners.length > 1 ? 'Partners' : 'Partner', items: partners },
    { title: 'Parents', items: parents },
    { title: 'Children', items: children },
    { title: 'Siblings', items: siblings },
  ].filter((g) => g.items.length);

  const relToViewer =
    viewerId && viewerId !== person.id ? relationLabel(graph, viewerId, person.id) : null;
  const location = person.residence || person.birth_place;
  const age = ageOrAt(person);
  const events = minor ? [] : lifeEvents(person);
  const personMemories = minor
    ? []
    : memories
        .filter((m) => m.person_id === person.id)
        .sort((a, b) => b.votes - a.votes || (a.created_at < b.created_at ? 1 : -1));
  const personPhotos = minor ? [] : photos.filter((p) => p.person_id === person.id);
  const completeness = minor ? null : profileCompleteness(person, graph, personMemories.length);

  // Picked gallery files are downscaled, then added one by one.
  const onGalleryPick = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    for (const file of files) {
      try {
        const src = await fileToDataUrl(file, 1800);
        onAddPhoto?.(person.id, src);
      } catch {
        /* skip an unreadable file */
      }
    }
  };

  const metaBits = [];
  if (person.occupation) metaBits.push(person.occupation);
  metaBits.push(lifespan(person));
  if (age && !person.is_deceased) metaBits.push(`age ${age}`);

  return (
    <div className="profile-scrim" onClick={onClose}>
      <article
        className="profile"
        role="dialog"
        aria-modal="true"
        aria-label={`${person.display_name} profile`}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="profile__close" onClick={onClose} aria-label="Close profile">
          <CloseIcon />
        </button>

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <header className="profile__hero">
          <button
            className="avatar-edit avatar-edit--lg"
            onClick={() => fileRef.current?.click()}
            aria-label={person.photo ? 'Change photo' : 'Add a photo'}
            title={person.photo ? 'Change photo' : 'Add a photo'}
          >
            <Avatar person={person} size={108} />
            <span className="avatar-edit__badge">
              <CameraIcon />
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onPhoto?.(person.id, file);
              e.target.value = '';
            }}
          />

          {relToViewer && <p className="profile__kin">{relToViewer}</p>}
          <h2 className="profile__name">{person.display_name}</h2>
          <p className="profile__meta">{metaBits.join('  ·  ')}</p>
          {location && (
            <p className="profile__where">
              <PinIcon />
              {location}
            </p>
          )}

          <div className="profile__badges">
            {person.is_deceased && <span className="badge badge--memorial">In loving memory</span>}
            {minor && <span className="badge badge--quiet">Child · limited details</span>}
            {person.confidence === 'uncertain' && (
              <span className="badge badge--quiet">Unconfirmed</span>
            )}
          </div>

          {!minor && person.tags?.length > 0 && (
            <ul className="tags">
              {person.tags.map((t) => (
                <li className="tag" key={t}>
                  {t}
                </li>
              ))}
            </ul>
          )}
        </header>

        {/* ── Actions ──────────────────────────────────────────────────────── */}
        <div className="profile__actions">
          <button className="action action--primary" onClick={() => onAddRelative?.(person.id)}>
            <PlusIcon />
            Add a relative
          </button>
          <button className="action" onClick={() => onEdit?.(person.id)}>
            <PencilIcon />
            Edit
          </button>
        </div>

        {minor ? (
          <p className="profile__private">
            Details for children are kept private and shared only within the family.
          </p>
        ) : (
          <div className="profile__body">
            {completeness && completeness.score < 100 && (
              <div className="meter" aria-label={`Profile ${completeness.score}% complete`}>
                <div className="meter__top">
                  <span className="meter__pct">{completeness.score}% complete</span>
                  <span className="meter__missing">
                    Add {completeness.missing.slice(0, 2).join(', ').toLowerCase()}
                    {completeness.missing.length > 2 ? '…' : ''}
                  </span>
                </div>
                <div className="meter__bar">
                  <span className="meter__fill" style={{ width: `${completeness.score}%` }} />
                </div>
              </div>
            )}

            {/* About */}
            {person.bio && (
              <section className="profile-section">
                <h3 className="profile-section__title">About</h3>
                <p className="profile__about">{person.bio}</p>
              </section>
            )}

            {/* Photos */}
            <section className="profile-section">
              <div className="profile-section__head">
                <h3 className="profile-section__title">
                  Photos{personPhotos.length > 0 ? ` · ${personPhotos.length}` : ''}
                </h3>
                <button className="section-edit" onClick={() => galleryRef.current?.click()}>
                  Add
                </button>
              </div>
              <input
                ref={galleryRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={onGalleryPick}
              />
              {personPhotos.length > 0 ? (
                <ul className="gallery">
                  {personPhotos.map((ph, idx) => (
                    <li key={ph.id}>
                      <button
                        className="gallery__cell"
                        onClick={() => onOpenLightbox?.(person.id, idx)}
                        aria-label={ph.caption || 'View photo'}
                      >
                        <img src={ph.src} alt={ph.caption || ''} loading="lazy" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <button className="empty-add" onClick={() => galleryRef.current?.click()}>
                  <PlusIcon />
                  Add photos
                </button>
              )}
            </section>

            {/* Key life events */}
            <section className="profile-section">
              <div className="profile-section__head">
                <h3 className="profile-section__title">Key life events</h3>
                <button className="section-edit" onClick={() => onEditTimeline?.(person.id)}>
                  {events.length > 0 ? 'Edit' : null}
                </button>
              </div>
              {events.length > 0 ? (
                <ol className="timeline">
                  {events.map((e, i) => (
                    <li className="timeline__item" key={`${e.year}-${i}`}>
                      <span className="timeline__year">{e.year}</span>
                      <span className="timeline__dot" aria-hidden="true" />
                      <span className="timeline__body">
                        <span className="timeline__title">{e.title}</span>
                        {e.detail && <span className="timeline__detail">{e.detail}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <button className="empty-add" onClick={() => onEditTimeline?.(person.id)}>
                  <PlusIcon />
                  Add a life event
                </button>
              )}
            </section>

            {/* Relationships */}
            {groups.length > 0 && (
              <section className="profile-section">
                <h3 className="profile-section__title">Relationships</h3>
                {groups.map((g) => (
                  <div className="rel-group" key={g.title}>
                    <h4 className="rel-group__label">{g.title}</h4>
                    <ul className="rel-group__list">
                      {g.items.map((item) => {
                        const rel = graph.byId.get(item.id);
                        if (!rel) return null;
                        return (
                          <li key={item.id}>
                            <button className="rel-chip" onClick={() => onOpenPerson(item.id)}>
                              <Avatar person={rel} size={40} />
                              <span className="rel-chip__text">
                                <span className="rel-chip__name">{rel.display_name}</span>
                                <span className="rel-chip__kind">
                                  {relationLabel(graph, person.id, item.id)}
                                  {item.qualifier && item.qualifier !== 'biological'
                                    ? ` · ${item.qualifier}`
                                    : ''}
                                </span>
                              </span>
                              <ChevronIcon />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </section>
            )}

            {/* Memories — the heart of the profile. */}
            <section className="profile-section">
              <div className="profile-section__head">
                <h3 className="profile-section__title">
                  Memories{personMemories.length > 0 ? ` · ${personMemories.length}` : ''}
                </h3>
                <button className="section-edit" onClick={() => onAddMemory?.(person.id)}>
                  Add
                </button>
              </div>

              {personMemories.length > 0 ? (
                <ul className="memories">
                  {personMemories.map((mem) => (
                    <li className="memory" key={mem.id}>
                      <p className="memory__text">{mem.text}</p>
                      <div className="memory__foot">
                        <span className="memory__by">{mem.author}</span>
                        <span className="memory__actions">
                          {mem.author === 'You' && (
                            <button
                              className="memory__del"
                              onClick={() => onRemoveMemory?.(mem.id)}
                              aria-label="Remove memory"
                            >
                              Remove
                            </button>
                          )}
                          <button
                            className={'memory__vote' + (mem.youVoted ? ' memory__vote--on' : '')}
                            onClick={() => onVoteMemory?.(mem.id)}
                            aria-pressed={mem.youVoted}
                            aria-label={`${mem.votes} ${mem.votes === 1 ? 'person finds' : 'people find'} this meaningful`}
                          >
                            <HeartIcon filled={mem.youVoted} />
                            {mem.votes > 0 ? mem.votes : ''}
                          </button>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <button className="empty-add" onClick={() => onAddMemory?.(person.id)}>
                  <PlusIcon />
                  Be the first to add a memory
                </button>
              )}
            </section>

            {/* Phase 3 invitations — shown as what they'll become. */}
            <section className="profile-section">
              <h3 className="profile-section__title">Coming soon</h3>
              <ul className="soon-list">
                <li className="soon-row">
                  <span className="soon-row__icon">✶</span>
                  <span className="soon-row__text">
                    <span className="soon-row__title">Life story</span>
                    <span className="soon-row__sub">
                      A narrative woven from the timeline, photos and memories.
                    </span>
                  </span>
                  <span className="soon-row__tag">Soon</span>
                </li>
                <li className="soon-row">
                  <span className="soon-row__icon">❀</span>
                  <span className="soon-row__text">
                    <span className="soon-row__title">Legacy</span>
                    <span className="soon-row__sub">
                      Advice, values and the things future generations should know.
                    </span>
                  </span>
                  <span className="soon-row__tag">Soon</span>
                </li>
              </ul>
            </section>
          </div>
        )}

        <footer className="profile__foot">
          <button className="btn btn--primary" onClick={() => onFocus(person.id)}>
            Centre the tree here
          </button>
        </footer>
      </article>
    </div>
  );
}

function CameraIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"
        fill="currentColor"
      />
      <circle cx="12" cy="13" r="3.2" fill="#fff" />
    </svg>
  );
}
function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 20h4L19 9l-4-4L4 16v4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M14 6l4 4" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function HeartIcon({ filled }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} aria-hidden="true">
      <path
        d="M12 20s-7-4.6-7-9.7A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7 3.3c0 5.1-7 9.7-7 9.7Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}
function ChevronIcon() {
  return (
    <svg className="rel-chip__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

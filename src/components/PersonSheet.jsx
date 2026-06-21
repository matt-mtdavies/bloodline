import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import SmartImg from './SmartImg.jsx';
import { lifespan, formatDate, ageOrAt } from '../lib/dates.js';
import { relationLabel } from '../data/graph.js';
import { profileCompleteness, lifeEvents } from '../lib/profile.js';
import { fileToDataUrl } from '../lib/image.js';
import { streamBio } from '../lib/ai.js';

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
  documents = [],
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
  onAddDocument,
  onRemoveDocument,
  onUpdateStory,
  onPhoto,
}) {
  const person = personId ? graph.byId.get(personId) : null;
  const fileRef = useRef(null);
  const galleryRef = useRef(null);
  const docRef = useRef(null);
  const storyAbort = useRef(null);
  const [storyState, setStoryState] = useState({ phase: 'idle', text: '', error: null });

  useEffect(() => {
    if (!person || lockEscape) return; // a stacked overlay owns Escape
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [person, onClose, lockEscape]);

  // Reset generation state whenever the viewed person changes.
  useEffect(() => {
    storyAbort.current?.abort();
    storyAbort.current = null;
    setStoryState({ phase: 'idle', text: '', error: null });
  }, [personId]);

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
  const personDocs = minor ? [] : documents.filter((d) => d.person_id === person.id);
  const completeness = minor ? null : profileCompleteness(person, graph, personMemories.length);

  const generateStory = async () => {
    storyAbort.current?.abort();
    const ac = new AbortController();
    storyAbort.current = ac;
    setStoryState({ phase: 'generating', text: '', error: null });

    const relSummary = [];
    for (const x of partners) {
      const p = graph.byId.get(x.id);
      if (p) relSummary.push({ label: 'Partner', name: p.display_name });
    }
    for (const x of parents) {
      const p = graph.byId.get(x.id);
      if (p) relSummary.push({ label: x.qualifier === 'biological' ? 'Parent' : `${x.qualifier} parent`, name: p.display_name });
    }
    for (const x of children) {
      const p = graph.byId.get(x.id);
      if (p) relSummary.push({ label: x.qualifier === 'biological' ? 'Child' : `${x.qualifier} child`, name: p.display_name });
    }

    await streamBio(
      person,
      { memories: personMemories, relSummary },
      {
        signal: ac.signal,
        onChunk: (text) => setStoryState((s) => ({ ...s, text: s.text + text })),
        onDone: () => setStoryState((s) => ({ ...s, phase: 'done' })),
        onError: (err) => {
          if (!err) return; // aborted — no-op
          setStoryState({ phase: 'idle', text: '', error: err.message });
        },
      },
    );
  };

  // Document files: images are downscaled, PDFs stored raw (capped at 8 MB).
  const onDocPick = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    for (const file of files) {
      try {
        if (file.size > 8 * 1024 * 1024) continue; // skip files > 8 MB
        const title = file.name.replace(/\.[^.]+$/, ''); // filename without extension
        let src;
        if (file.type.startsWith('image/')) {
          src = await fileToDataUrl(file, 1200);
        } else {
          src = await new Promise((res, rej) => {
            const reader = new FileReader();
            reader.onload = () => res(reader.result);
            reader.onerror = rej;
            reader.readAsDataURL(file);
          });
        }
        onAddDocument?.(person.id, { title, mime: file.type, src });
      } catch {
        /* skip unreadable file */
      }
    }
  };

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
                        <SmartImg src={ph.src} alt={ph.caption || ''} />
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

            {/* Documents */}
            <section className="profile-section">
              <div className="profile-section__head">
                <h3 className="profile-section__title">
                  Documents{personDocs.length > 0 ? ` · ${personDocs.length}` : ''}
                </h3>
                <button className="section-edit" onClick={() => docRef.current?.click()}>
                  Add
                </button>
              </div>
              <input
                ref={docRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                hidden
                onChange={onDocPick}
              />
              {personDocs.length > 0 ? (
                <ul className="doc-list">
                  {personDocs.map((doc) => (
                    <li key={doc.id}>
                      <div className="doc-row">
                        <span className="doc-row__icon" aria-hidden="true">
                          {doc.mime?.startsWith('image/') ? <DocImageIcon /> : <DocFileIcon />}
                        </span>
                        {doc.mime?.startsWith('image/') ? (
                          <SmartImg className="doc-thumb" src={doc.src} alt={doc.title} />
                        ) : null}
                        <span className="doc-row__text">
                          <span className="doc-row__title">{doc.title}</span>
                          <span className="doc-row__meta">
                            {doc.mime === 'application/pdf' ? 'PDF' : 'Image'} · {doc.created_at}
                          </span>
                        </span>
                        <span className="doc-row__actions">
                          <a
                            className="doc-row__open"
                            href={doc.src}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open ${doc.title}`}
                          >
                            Open
                          </a>
                          <button
                            className="doc-row__del"
                            onClick={() => onRemoveDocument?.(doc.id)}
                            aria-label={`Remove ${doc.title}`}
                          >
                            Remove
                          </button>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <button className="empty-add" onClick={() => docRef.current?.click()}>
                  <PlusIcon />
                  Add certificates, letters or records
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

            {/* Life Story — AI-generated from the person's timeline + memories. */}
            <section className="profile-section">
              <div className="profile-section__head">
                <h3 className="profile-section__title">Life Story</h3>
                {storyState.phase === 'idle' && (person.story || storyState.error) && (
                  <button className="story-regen" onClick={generateStory}>
                    {storyState.error ? 'Try again' : 'Regenerate'}
                  </button>
                )}
                {storyState.phase === 'generating' && (
                  <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>Writing…</span>
                )}
              </div>

              {storyState.phase === 'idle' && storyState.error && (
                <p className="story-error">{storyState.error}</p>
              )}

              {storyState.phase === 'idle' && !person.story && !storyState.error && (
                <button className="ai-generate" onClick={generateStory}>
                  <SparkleIcon />
                  Generate life story with AI
                </button>
              )}

              {storyState.phase === 'idle' && person.story && (
                <p className="story">{person.story}</p>
              )}

              {(storyState.phase === 'generating' || storyState.phase === 'done') && (
                <p className={`story${storyState.phase === 'generating' ? ' story--generating' : ''}`}>
                  {storyState.text}
                </p>
              )}

              {storyState.phase === 'done' && (
                <>
                  <div className="story-actions">
                    <button
                      className="btn btn--primary"
                      onClick={() => {
                        onUpdateStory?.(person.id, storyState.text);
                        setStoryState({ phase: 'idle', text: '', error: null });
                      }}
                    >
                      Keep it
                    </button>
                    <button
                      className="btn"
                      onClick={() => setStoryState({ phase: 'idle', text: '', error: null })}
                    >
                      Dismiss
                    </button>
                  </div>
                  <p className="story-note">Generated by AI · review before keeping</p>
                </>
              )}
            </section>

            {/* Future features */}
            <section className="profile-section">
              <h3 className="profile-section__title">Coming soon</h3>
              <ul className="soon-list">
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
function DocFileIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 4a2 2 0 0 1 2-2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8 13h8M8 17h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function DocImageIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
      <path d="M3 16l5-5 4 4 3-3 6 5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
function SparkleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

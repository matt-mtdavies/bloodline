import { useEffect, useRef } from 'react';
import Avatar from './Avatar.jsx';
import { lifespan, formatDate } from '../lib/dates.js';
import { relationLabel } from '../data/graph.js';

/*
 * The person card. The active bubble stays sharp on the tree while everyone
 * else blurs back; this card slides in alongside as a clean panel. From here you
 * add a relative, edit details, or give them a face.
 *
 * Living minors get a light privacy note rather than full exposure (§7).
 */
export default function PersonSheet({
  graph,
  personId,
  onClose,
  onFocus,
  onOpenPerson,
  onAddRelative,
  onEdit,
  onPhoto,
}) {
  const person = personId ? graph.byId.get(personId) : null;
  const fileRef = useRef(null);

  useEffect(() => {
    if (!person) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [person, onClose]);

  if (!person) return null;

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

  return (
    <div className="sheet-scrim sheet-scrim--soft" onClick={onClose}>
      <section
        className="sheet sheet--card"
        role="dialog"
        aria-modal="true"
        aria-label={`${person.display_name} profile`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet__head">
          <button
            className="avatar-edit"
            onClick={() => fileRef.current?.click()}
            aria-label={person.photo ? 'Change photo' : 'Add a photo'}
            title={person.photo ? 'Change photo' : 'Add a photo'}
          >
            <Avatar person={person} size={84} />
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
          <div className="sheet__id">
            <h2>{person.display_name}</h2>
            <p className="sheet__life">{lifespan(person)}</p>
            <div className="sheet__badges">
              {person.is_deceased && <span className="badge badge--memorial">In loving memory</span>}
              {!person.is_deceased && person.is_minor && (
                <span className="badge badge--quiet">Child · limited details</span>
              )}
              {person.confidence === 'uncertain' && (
                <span className="badge badge--quiet">Unconfirmed</span>
              )}
            </div>
          </div>
          <button className="icon-btn sheet__edit" onClick={() => onEdit?.(person.id)} aria-label="Edit details">
            <PencilIcon />
          </button>
        </header>

        <div className="sheet__actions">
          <button className="action action--primary" onClick={() => onAddRelative?.(person.id)}>
            <PlusIcon />
            Add a relative
          </button>
        </div>

        <div className="sheet__body">
          {person.is_minor && !person.is_deceased ? (
            <p className="sheet__bio sheet__bio--muted">
              Details for children are kept private and shared only within the family.
            </p>
          ) : (
            person.bio && <p className="sheet__bio">{person.bio}</p>
          )}

          <dl className="sheet__facts">
            {person.birth_place && (
              <div>
                <dt>Born</dt>
                <dd>
                  {formatDate(person.birth_date) || '—'}
                  {person.birth_place ? ` · ${person.birth_place}` : ''}
                </dd>
              </div>
            )}
            {person.is_deceased && person.death_date && (
              <div>
                <dt>Died</dt>
                <dd>{formatDate(person.death_date)}</dd>
              </div>
            )}
          </dl>

          {groups.map((g) => (
            <div className="sheet__rel" key={g.title}>
              <h3>{g.title}</h3>
              <ul>
                {g.items.map((item) => {
                  const rel = graph.byId.get(item.id);
                  if (!rel) return null;
                  return (
                    <li key={item.id}>
                      <button className="rel-chip" onClick={() => onOpenPerson(item.id)}>
                        <Avatar person={rel} size={38} />
                        <span className="rel-chip__text">
                          <span className="rel-chip__name">{rel.display_name}</span>
                          <span className="rel-chip__kind">
                            {relationLabel(graph, person.id, item.id)}
                            {item.qualifier && item.qualifier !== 'biological'
                              ? ` · ${item.qualifier}`
                              : ''}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <footer className="sheet__foot">
          <button className="btn btn--primary" onClick={() => onFocus(person.id)}>
            Centre the tree here
          </button>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </footer>
      </section>
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
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 20h4L19 9l-4-4L4 16v4Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M14 6l4 4" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

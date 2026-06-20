import { useEffect } from 'react';
import Avatar from './Avatar.jsx';
import { lifespan, formatDate } from '../lib/dates.js';
import { relationLabel } from '../data/graph.js';

/*
 * The person card — an elegant sheet that rises over the tree without losing it.
 * Photo, dates, places, story, and the people they're bound to (tap to fly
 * there). Living minors get a light privacy note rather than full exposure (§7).
 */
export default function PersonSheet({ graph, personId, onClose, onFocus, onOpenPerson }) {
  const person = personId ? graph.byId.get(personId) : null;

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
    <div className="sheet-scrim" onClick={onClose}>
      <section
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${person.display_name} profile`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet__grip" />
        <header className="sheet__head">
          <Avatar person={person} size={84} />
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
        </header>

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
                      <button
                        className="rel-chip"
                        onClick={() => onOpenPerson(item.id)}
                      >
                        <Avatar person={rel} size={38} />
                        <span className="rel-chip__text">
                          <span className="rel-chip__name">{rel.display_name}</span>
                          <span className="rel-chip__kind">
                            {relationLabel(graph, person.id, item.id)}
                            {item.status === 'former' ? ' · former' : ''}
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

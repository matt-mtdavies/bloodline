import { useEffect, useLayoutEffect, useRef } from 'react';
import Avatar from './Avatar.jsx';
import { lifespan, formatDate } from '../lib/dates.js';
import { relationLabel } from '../data/graph.js';

/*
 * The person card. Instead of a slab that covers the tree, it appears to grow
 * out of the tapped bubble (a FLIP transform from the bubble's screen position),
 * leaves the tree visible behind, and keeps a slim tether back to the bubble so
 * you never lose track of who you're looking at. Closing shrinks it back in.
 *
 * Living minors get a light privacy note rather than full exposure (§7).
 */
export default function PersonSheet({
  graph,
  personId,
  origin,
  getPos,
  onClose,
  onFocus,
  onOpenPerson,
}) {
  const person = personId ? graph.byId.get(personId) : null;
  const cardRef = useRef(null);
  const lineRef = useRef(null);
  const dotRef = useRef(null);

  // FLIP in: place the card at the bubble (small), then spring it to rest.
  useLayoutEffect(() => {
    if (!person) return;
    const card = cardRef.current;
    if (!card) return;
    const r = card.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const ox = origin?.x ?? cx;
    const oy = origin?.y ?? cy;

    card.style.transition = 'none';
    card.style.transformOrigin = '50% 50%';
    card.style.transform = `translate(${ox - cx}px, ${oy - cy}px) scale(0.16)`;
    card.style.opacity = '0';
    void card.offsetWidth; // commit the "from" state
    card.style.transition = '';
    card.style.transform = '';
    card.style.opacity = '';
  }, [person, origin]);

  // Keep the tether's ends glued to the live bubble and the card as both move
  // (the tree lifts on open and the bubble keeps drifting).
  useEffect(() => {
    if (!person || !origin || !getPos) return;
    let raf;
    const tick = () => {
      const p = getPos();
      const card = cardRef.current;
      if (p && card && lineRef.current && dotRef.current) {
        const r = card.getBoundingClientRect();
        // Attach to the card's near (left) edge, level with the bubble, so the
        // line reads as the bubble opening sideways into the card.
        const ax = r.left;
        const ay = Math.max(r.top + 26, Math.min(r.bottom - 26, p.y));
        lineRef.current.setAttribute('x1', p.x);
        lineRef.current.setAttribute('y1', p.y);
        lineRef.current.setAttribute('x2', ax);
        lineRef.current.setAttribute('y2', ay);
        dotRef.current.setAttribute('cx', p.x);
        dotRef.current.setAttribute('cy', p.y);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [person, origin, getPos]);

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
      {origin && (
        <svg className="tether" aria-hidden="true">
          <line
            ref={lineRef}
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="2 6"
          />
          <circle ref={dotRef} r="5" fill="var(--accent)" />
        </svg>
      )}
      <section
        className="sheet sheet--card"
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${person.display_name} profile`}
        onClick={(e) => e.stopPropagation()}
      >
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

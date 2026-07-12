import SmartImg from './SmartImg.jsx';
import { militaryEvents, militaryDocuments, militaryQuotes, serviceYears, hasMilitaryService } from '../lib/military.js';

/*
 * Military Service — conditional, only rendered when there's real
 * military-tagged data on this person (see hasMilitaryService). Three
 * registers, deliberately different from each other rather than three
 * variations on the same card:
 *   - the campaign route: a journey, not a table — waypoints along a
 *     dashed line, the same military-tagged events already on the
 *     timeline, just given room to read as a story of movement.
 *   - the record: bureaucratic fact, tabular and quiet.
 *   - the story: verbatim quotes from the documents themselves — the
 *     human voice inside the paperwork.
 */
export default function MilitaryService({ person, personDocs, onOpenDocument }) {
  if (!hasMilitaryService(person, personDocs)) return null;

  const events = militaryEvents(person);
  const docs = militaryDocuments(personDocs);
  const quotes = militaryQuotes(personDocs);
  const years = serviceYears(events);

  return (
    <section className="profile-section military">
      <div className="profile-section__head">
        <h3 className="profile-section__title">
          <span className="military__title-icon" aria-hidden="true"><RibbonIcon /></span>
          Military Service
        </h3>
        {(years || docs.length > 0) && (
          <span className="military__span">
            {[years, docs.length > 0 ? `${docs.length} record${docs.length === 1 ? '' : 's'}` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
      </div>

      {events.length > 0 && (
        <div className="military__route" role="list" aria-label="Service timeline">
          {events.map((e, i) => (
            <div className="military__waypoint" role="listitem" key={i}>
              <span className="military__waypoint-dot" aria-hidden="true" />
              <span className="military__waypoint-year">{e.year}</span>
              <span className="military__waypoint-title">{e.title}</span>
              {e.detail && <span className="military__waypoint-detail">{e.detail}</span>}
            </div>
          ))}
        </div>
      )}

      {quotes.length > 0 && (
        <div className="military__quotes">
          {quotes.map((q, i) => (
            <blockquote className="military__quote" key={i}>
              <p>&ldquo;{q.quote}&rdquo;</p>
              <cite>— {q.docTitle}{q.year ? `, ${q.year}` : ''}</cite>
            </blockquote>
          ))}
        </div>
      )}

      {docs.length > 0 && (
        <div className="military__docs">
          {docs.map((d) => (
            <button
              key={d.id}
              className="military__doc"
              onClick={() => onOpenDocument?.(d)}
              aria-label={`Open ${d.title}`}
            >
              <span className="military__doc-thumb">
                {d.mime?.startsWith('image/') ? (
                  <SmartImg src={d.src} alt={d.title} />
                ) : d.thumb ? (
                  <img src={d.thumb} alt={d.title} />
                ) : (
                  <DocGlyph />
                )}
              </span>
              <span className="military__doc-title">{d.title}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function RibbonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 13l-2 8 5.5-3 5.5 3-2-8" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function DocGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 4a2 2 0 0 1 2-2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 13h8M8 17h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

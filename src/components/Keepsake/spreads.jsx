import { useState } from 'react';
import Avatar from '../Avatar.jsx';
import Constellation from './Constellation.jsx';
import { BranchIcon, MedalIcon } from '../MilitaryIcons.jsx';

/*
 * The Keepsake's spreads — one component per page of the book, each taking
 * exactly one spread descriptor from lib/keepsake.js (no component touches
 * the graph or store directly; the data layer already resolved everything,
 * privacy included). Phase 1 is the static book; where the AI narrative
 * will flow in Phase 2, a quiet pending rule holds the space.
 */

function Ornament() {
  return (
    <div className="ks-orn" aria-hidden="true">
      <svg width="9" height="9" viewBox="0 0 10 10"><path d="M5 0l5 5-5 5-5-5z" fill="currentColor" /></svg>
    </div>
  );
}

function ProsePending({ children }) {
  return <p className="ks-prose-pending">{children}</p>;
}

export function CoverSpread({ spread }) {
  // A portrait that fails to load (removed from R2, offline) must fall back
  // to the bare-cover treatment — otherwise the white cover type sits
  // illegibly on a white page.
  const [photoFailed, setPhotoFailed] = useState(false);
  const photo = photoFailed ? null : spread.photo;
  return (
    <section className={`ks-spread ks-cover${photo ? '' : ' ks-cover--bare'}`}>
      {photo && (
        <div className="ks-cover__photo" aria-hidden="true">
          <img src={photo} alt="" onError={() => setPhotoFailed(true)} />
        </div>
      )}
      <div className="ks-cover__body">
        <p className="ks-cover__kicker">A Bloodline Keepsake</p>
        <h1 className="ks-cover__name">{spread.name}</h1>
        <div className="ks-cover__meta">
          {spread.lifespan && <span className="ks-cover__lifespan">{spread.lifespan}</span>}
          {spread.epithet && <span className="ks-cover__epithet">{spread.epithet}</span>}
        </div>
      </div>
    </section>
  );
}

export function FrontispieceSpread({ spread }) {
  const roles = spread.roles?.length ? spread.roles.join(' · ') : null;
  return (
    <section className="ks-spread">
      <div className="ks-spread__inner ks-front">
        {roles && <p className="ks-front__roles">{cap(roles)}</p>}
        <Ornament />
        {spread.familyName && (
          <p className="ks-label ks-front__family">{spread.familyName}</p>
        )}
        <p className="ks-front__records">
          Compiled from {spread.recordCount.toLocaleString()} family records
        </p>
      </div>
    </section>
  );
}

export function OriginsSpread({ spread }) {
  return (
    <section className="ks-spread">
      <div className="ks-spread__inner">
        <p className="ks-label ks-label--accent">Origins</p>
        {spread.born.place && <h2 className="ks-origins__place">{spread.born.place}</h2>}
        {spread.born.date && <p className="ks-origins__date">Born {spread.born.date}</p>}
        {spread.narrative
          ? <div className="ks-prose ks-prose--dropcap" style={{ marginTop: 22 }}>{spread.narrative.map((p, i) => <p key={i}>{p}</p>)}</div>
          : <ProsePending>The story of these beginnings will be written when this edition is compiled.</ProsePending>}
        {spread.parents.length > 0 && (
          <>
            <Ornament />
            <div className="ks-parents">
              {spread.parents.map((p) => (
                <div className="ks-parent" key={p.id}>
                  <Avatar person={{ display_name: p.name, photo: p.photo }} size={48} />
                  <div>
                    <span className="ks-parent__name">{p.name}</span>
                    <span className="ks-parent__role">Parent</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

export function ConstellationSpread({ spread }) {
  return (
    <section className="ks-spread">
      <div className="ks-spread__inner ks-constellation">
        <p className="ks-label ks-label--accent" style={{ textAlign: 'center', marginBottom: 18 }}>
          The Family Constellation
        </p>
        <Constellation nodes={spread.nodes} links={spread.links} />
        <p className="ks-label ks-constellation__caption">
          {spread.nodes.length} of the family, drawn together
        </p>
      </div>
    </section>
  );
}

export function ChaptersSpread({ spread }) {
  return (
    <section className="ks-spread" style={{ minHeight: 'auto' }}>
      <div className="ks-spread__inner">
        <p className="ks-label ks-label--accent">Chapters of a Life</p>
        {spread.chapters.map((ch, i) => (
          <article className="ks-chapter" key={i}>
            <p className="ks-chapter__years">{ch.narrativeTitle || ch.label}</p>
            {ch.paragraphs
              ? <div className={`ks-prose${i === 0 ? ' ks-prose--dropcap' : ''}`}>{ch.paragraphs.map((p, j) => <p key={j}>{p}</p>)}</div>
              : <ProsePending>This chapter will be written when the edition is compiled.</ProsePending>}
            {ch.events.length > 0 && (
              <ul className="ks-chapter__events">
                {ch.events.map((e, j) => (
                  <li className="ks-chapter__event" key={j}>
                    <span className="ks-chapter__event-year">{e.year}</span>
                    <span className="ks-chapter__event-title">
                      {e.title}
                      {e.detail && <span className="ks-chapter__event-detail">{e.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
        {spread.bio && !spread.chapters.some((c) => c.paragraphs) && (
          <blockquote className="ks-quote">{spread.bio}</blockquote>
        )}
      </div>
    </section>
  );
}

export function ServiceSpread({ spread }) {
  const { profile, events, medals, quotes } = spread;
  const idLine = [profile.rank, profile.serviceNumber, profile.nation].filter(Boolean).join(' · ');
  return (
    <section className="ks-spread" style={{ minHeight: 'auto' }}>
      <div className="ks-spread__inner">
        <p className="ks-label ks-label--accent">In Service</p>
        <div className="ks-service__id">
          <BranchIcon branch={profile.branch} nation={profile.nation} size={18} />
          {idLine && <span>{idLine}</span>}
        </div>
        {events.length > 0 && (
          <ul className="ks-chapter__events">
            {events.map((e, i) => (
              <li className="ks-chapter__event" key={i}>
                <span className="ks-chapter__event-year">{e.year}</span>
                <span className="ks-chapter__event-title">
                  {e.title}
                  {e.detail && <span className="ks-chapter__event-detail">{e.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {quotes.map((q, i) => (
          <blockquote className="ks-quote" key={i}>
            {q.quote}
            {q.docTitle && <cite>{q.docTitle}</cite>}
          </blockquote>
        ))}
        {medals.length > 0 && (
          <div className="ks-medals">
            {medals.map((m, i) => (
              <span className="ks-medal" key={i}><MedalIcon size={13} />{m.name || m}</span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function PlacesSpread({ spread }) {
  return (
    <section className="ks-spread">
      <div className="ks-spread__inner">
        <p className="ks-label ks-label--accent">The Places</p>
        <ul className="ks-places">
          {spread.places.map((p, i) => (
            <li className="ks-place" key={i}>
              <span className="ks-place__name">{p.place}</span>
              <p className="ks-label ks-place__role">{p.role}{p.year ? ` · ${p.year}` : ''}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function VoicesSpread({ spread }) {
  return (
    <section className="ks-spread" style={{ minHeight: 'auto' }}>
      <div className="ks-spread__inner">
        <p className="ks-label ks-label--accent" style={{ marginBottom: 26 }}>Voices</p>
        {spread.voices.map((v, i) => (
          <div className="ks-voice" key={i}>
            <blockquote>{v.text}</blockquote>
            {v.author && <cite>— {v.author}</cite>}
          </div>
        ))}
      </div>
    </section>
  );
}

export function AlbumSpread({ spread }) {
  return (
    <section className="ks-spread" style={{ minHeight: 'auto' }}>
      <div className="ks-spread__inner">
        <p className="ks-label ks-label--accent">The Album</p>
        <div className="ks-album">
          {spread.photos.map((p, i) => (
            <figure className={`ks-album__item${i === 0 ? ' ks-album__item--hero' : ''}`} key={i}>
              <img src={p.src} alt={p.caption || ''} loading="lazy" />
              {(p.caption || p.date) && (
                <figcaption>{[p.caption, p.date].filter(Boolean).join(' · ')}</figcaption>
              )}
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

export function DocumentsSpread({ spread }) {
  return (
    <section className="ks-spread" style={{ minHeight: 'auto' }}>
      <div className="ks-spread__inner">
        <p className="ks-label ks-label--accent">Documents of a Life</p>
        <div className="ks-docs">
          {spread.documents.map((d) => (
            <div className="ks-doc" key={d.id}>
              {(d.thumb || (d.mime || '').startsWith('image/')) && (
                <img src={d.thumb || d.src} alt="" loading="lazy" />
              )}
              <p className="ks-doc__title">{d.title}</p>
              {d.fact && <p className="ks-doc__fact">{d.fact}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function RecordSpread({ spread }) {
  if (!spread.rows.length) return null;
  return (
    <section className="ks-spread">
      <div className="ks-spread__inner">
        <p className="ks-label ks-label--accent">The Record</p>
        <table className="ks-record">
          <tbody>
            {spread.rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td>{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function LegacySpread({ spread }) {
  return (
    <section className={`ks-spread${spread.memorial ? ' ks-legacy--memorial' : ''}`}>
      <div className="ks-spread__inner">
        <p className="ks-label ks-label--accent">Legacy</p>
        <h2 className="ks-title">Who follows</h2>
        <div className="ks-legacy__row">
          {[...spread.children, ...spread.grandchildren].map((p) => (
            <div className="ks-legacy__person" key={p.id}>
              <Avatar person={{ display_name: p.name, photo: p.photo }} size={54} />
              <span className="ks-legacy__name">{p.name.split(/\s+/)[0]}</span>
            </div>
          ))}
        </div>
        <p className="ks-legacy__line">
          {spread.children.length} {spread.children.length === 1 ? 'child' : 'children'}
          {spread.grandchildren.length > 0 && (
            <> · {spread.grandchildren.length} {spread.grandchildren.length === 1 ? 'grandchild' : 'grandchildren'}
              {spread.youngestYear && <>, the youngest born {spread.youngestYear}</>}</>
          )}
        </p>
      </div>
    </section>
  );
}

export function ColophonSpread({ spread, edition }) {
  const compiled = edition?.compiledAt
    ? new Date(edition.compiledAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  return (
    <section className="ks-spread">
      <div className="ks-spread__inner ks-colophon">
        <Ornament />
        <p className="ks-colophon__edition">
          {edition?.editionNumber ? `${ordinalWord(edition.editionNumber)} edition` : 'Draft edition'}
          {compiled && <> — compiled {compiled}</>}
        </p>
        <p className="ks-colophon__meta">
          Drawn from {spread.recordCount.toLocaleString()} family records
          {spread.familyName && <><br />{spread.familyName}</>}
          {spread.contributors.length > 0 && (
            <><br />With the contributions of {spread.contributors.join(', ')}</>
          )}
        </p>
        {spread.sparse && (
          <p className="ks-colophon__invite">
            This story is still being written. Every memory, photo and date the
            family adds will find its place in the next edition.
          </p>
        )}
        <p className="ks-colophon__privacy">
          Generated from your tree and stays private to your family.
        </p>
      </div>
    </section>
  );
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
function ordinalWord(n) {
  return ORDINALS[n - 1] || `${n}th`;
}

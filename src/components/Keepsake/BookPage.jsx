import { useState } from 'react';
import Avatar from '../Avatar.jsx';
import Constellation from './Constellation.jsx';
import { BranchIcon, MedalIcon } from '../MilitaryIcons.jsx';
import { roman, contentWidth } from '../../lib/typeset.js';

/*
 * The typeset book's page renderer — one fixed, magazine-true page at the
 * canvas's logical size. Never scrolls; the typesetter (lib/typeset.js)
 * guarantees the blocks fit. Shares nothing stylistically with the scroll
 * reader's spreads (spreads.jsx) on purpose: this is the .ks-pg design
 * system, print furniture and all — running head, folio, drop caps, quote
 * wells, full-bleed photo pages.
 */

function EditPencil({ onEdit, section, light = false }) {
  if (!onEdit || !section) return null;
  return (
    <button
      className={`ks-editbtn${light ? ' ks-editbtn--light' : ''}`}
      onClick={() => onEdit(section)}
      aria-label="Edit this section"
      title="Edit this section"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

const Diamond = ({ size = 8 }) => (
  <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true"><path d="M5 0l5 5-5 5-5-5z" fill="currentColor" /></svg>
);

/* ── The cover ──────────────────────────────────────────────────────────────
   Composed like a real masthead: kicker at the crown, the name enormous in
   Fraunces (stacked, fitted to the trim width), the credit block low, one
   cover line along the foot. The type is FITTED in JS — a long surname must
   fill the width the way a cover artist would set it, not wrap or shrink
   into safety. */
function fitCoverName(name, canvas) {
  const words = (name || '').trim().split(/\s+/);
  const lines = words.length >= 2
    ? [words.slice(0, -1).join(' '), words[words.length - 1]]
    : [name || ''];
  const longest = Math.max(...lines.map((l) => l.length), 1);
  // Fraunces averages ~0.55em advance at display weights; leave a whisper of
  // margin so the rag never kisses the trim.
  const size = Math.max(
    canvas.w * 0.085,
    Math.min(canvas.w * 0.185, (contentWidth(canvas) * 1.78) / longest),
  );
  return { lines, size };
}

function CoverPage({ block, canvas, onEditSection }) {
  const s = block.spread;
  const { lines, size } = fitCoverName(s.name, canvas);
  // A portrait that fails to load (removed from R2, offline) falls back to
  // the bare treatment — white cover type on white paper is illegible.
  const [photoFailed, setPhotoFailed] = useState(false);
  const photo = photoFailed ? null : s.photo || null;
  return (
    <div className={`ks-pg-cover${photo ? '' : ' ks-pg-cover--bare'}`}>
      {photo ? (
        <div className="ks-pg-cover__photo" aria-hidden="true">
          <img src={photo} alt="" onError={() => setPhotoFailed(true)} />
        </div>
      ) : (
        <div className="ks-pg-cover__wash" aria-hidden="true" />
      )}
      <div className="ks-pg-cover__grain" aria-hidden="true" />
      <div className="ks-pg-cover__masthead">
        <Diamond size={7} />
        <span>A Bloodline Keepsake</span>
        <Diamond size={7} />
      </div>
      <div className="ks-pg-cover__well">
        <h1 className="ks-pg-cover__name" style={{ fontSize: size }}>
          {lines.map((l, i) => <span key={i}>{l}</span>)}
        </h1>
        <div className="ks-pg-cover__credit">
          {s.lifespan && <span className="ks-pg-cover__lifespan">{s.lifespan}</span>}
          {s.epithet && <span className="ks-pg-cover__epithet">{s.epithet}</span>}
          <EditPencil onEdit={onEditSection} section="epithet" light={!!photo} />
        </div>
        {block.familyName && (
          <div className="ks-pg-cover__line">
            <span>{block.familyName}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Fixed pages ───────────────────────────────────────────────────────── */

function FrontPage({ block }) {
  const s = block.spread;
  const roles = s.roles?.length ? s.roles.join(' · ') : null;
  return (
    <div className="ks-pg-front">
      {roles && <p className="ks-pg-front__roles">{cap(roles)}</p>}
      <div className="ks-pg-orn"><Diamond /></div>
      {s.familyName && <p className="ks-pg-label">{s.familyName}</p>}
      <p className="ks-pg-front__records">Compiled from {s.recordCount.toLocaleString()} family records</p>
    </div>
  );
}

function ConstellationPage({ block }) {
  const s = block.spread;
  return (
    <div className="ks-pg-const">
      <p className="ks-pg-label ks-pg-label--night">The Family Constellation</p>
      <Constellation nodes={s.nodes} links={s.links} />
      <p className="ks-pg-label ks-pg-label--night ks-pg-const__caption">
        {s.nodes.length} of the family, drawn together
      </p>
    </div>
  );
}

function AlbumHeroPage({ block }) {
  const p = block.photo;
  return (
    <figure className="ks-pg-hero">
      <img src={p.src} alt={p.caption || ''} />
      {(p.caption || p.date) && (
        <figcaption>{[p.caption, p.date].filter(Boolean).join(' · ')}</figcaption>
      )}
      <span className="ks-pg-hero__label">The Album</span>
    </figure>
  );
}

function AlbumGridPage({ block }) {
  return (
    <div className="ks-pg-albumgrid" data-count={block.photos.length}>
      {block.photos.map((p, i) => (
        <figure className="ks-pg-albumgrid__item" key={i}>
          <img src={p.src} alt={p.caption || ''} loading="lazy" />
          {(p.caption || p.date) && (
            <figcaption>{[p.caption, p.date].filter(Boolean).join(' · ')}</figcaption>
          )}
        </figure>
      ))}
    </div>
  );
}

function DocsGridPage({ block }) {
  return (
    <div className="ks-pg-docs">
      <p className="ks-pg-label ks-pg-label--accent">Documents of a Life</p>
      <div className="ks-pg-docs__grid">
        {block.documents.map((d) => (
          <div className="ks-pg-doc" key={d.id}>
            {(d.thumb || (d.mime || '').startsWith('image/')) && (
              <img src={d.thumb || d.src} alt="" loading="lazy" />
            )}
            <p className="ks-pg-doc__title">{d.title}</p>
            {d.fact && <p className="ks-pg-doc__fact">{d.fact}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function RecordPage({ block }) {
  return (
    <div className="ks-pg-record">
      <p className="ks-pg-label ks-pg-label--accent">The Record</p>
      <table>
        <tbody>
          {block.rows.map((r) => (
            <tr key={r.label}><th scope="row">{r.label}</th><td>{r.value}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ColophonPage({ block, edition }) {
  const s = block.spread;
  const compiled = edition?.compiledAt
    ? new Date(edition.compiledAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  return (
    <div className="ks-pg-colophon">
      <div className="ks-pg-orn"><Diamond /></div>
      <p className="ks-pg-colophon__edition">
        {edition?.editionNumber ? `${ordinalWord(edition.editionNumber)} edition` : 'Draft edition'}
        {compiled && <> — compiled {compiled}</>}
      </p>
      <p className="ks-pg-colophon__meta">
        Drawn from {s.recordCount.toLocaleString()} family records
        {s.familyName && <><br />{s.familyName}</>}
        {s.contributors.length > 0 && <><br />With the contributions of {s.contributors.join(', ')}</>}
      </p>
      {s.sparse && (
        <p className="ks-pg-colophon__invite">
          This story is still being written. Every memory, photo and date the
          family adds will find its place in the next edition.
        </p>
      )}
      <p className="ks-pg-colophon__privacy">Generated from your tree and stays private to your family.</p>
    </div>
  );
}

/* ── Flow blocks ───────────────────────────────────────────────────────── */

function Block({ block, onEditSection }) {
  switch (block.kind) {
    case 'sectionOpen':
      return (
        <header className={`ks-pgb ks-pgb--open${block.memorial ? ' ks-pgb--memorial' : ''}`}>
          <p className="ks-pg-label ks-pg-label--accent">
            {block.label}
            <EditPencil onEdit={onEditSection} section={block.section} />
          </p>
          {block.title && <h2 className="ks-pgb-open__title">{block.title}</h2>}
          {block.sub && <p className="ks-pgb-open__sub">{block.sub}</p>}
        </header>
      );
    case 'chapterOpen':
      return (
        <header className="ks-pgb ks-pgb--chapter">
          <span className="ks-pgb-chapter__num" aria-hidden="true">{roman(block.num)}</span>
          <p className="ks-pg-label ks-pg-label--accent">
            {block.label}
            <EditPencil onEdit={onEditSection} section={block.section} />
          </p>
          {block.title && <h2 className="ks-pgb-open__title">{block.title}</h2>}
        </header>
      );
    case 'prose':
      return <p className={`ks-pgb ks-pgb--prose${block.dropcap ? ' ks-pgb--dropcap' : ''}`}>{block.text}</p>;
    case 'pending':
      return <p className="ks-pgb ks-pgb--pending">{block.text}</p>;
    case 'parents':
      return (
        <div className="ks-pgb ks-pgb--parents">
          {block.parents.map((p) => (
            <div className="ks-pgb-parent" key={p.id}>
              <Avatar person={{ display_name: p.name, photo: p.photo }} size={46} />
              <div>
                <span className="ks-pgb-parent__name">{p.name}</span>
                <span className="ks-pgb-parent__role">Parent</span>
              </div>
            </div>
          ))}
        </div>
      );
    case 'event':
      return (
        <div className="ks-pgb ks-pgb--event">
          <span className="ks-pgb-event__year">{block.event.year}</span>
          <span className="ks-pgb-event__title">
            {block.event.title}
            {block.event.detail && <span className="ks-pgb-event__detail">{block.event.detail}</span>}
          </span>
        </div>
      );
    case 'quote':
      return (
        <blockquote className="ks-pgb ks-pgb--quote">
          {block.text}
          {block.cite && <cite>{block.cite}</cite>}
        </blockquote>
      );
    case 'voice':
      return (
        <div className="ks-pgb ks-pgb--voice">
          <span className="ks-pgb-voice__mark" aria-hidden="true">“</span>
          <blockquote>{block.voice.text}</blockquote>
          {block.voice.author && <cite>— {block.voice.author}</cite>}
        </div>
      );
    case 'serviceId': {
      const p = block.profile;
      const idLine = [p.rank, p.serviceNumber, p.nation].filter(Boolean).join(' · ');
      return (
        <div className="ks-pgb ks-pgb--serviceid">
          <BranchIcon branch={p.branch} nation={p.nation} size={18} />
          {idLine && <span>{idLine}</span>}
        </div>
      );
    }
    case 'medals':
      return (
        <div className="ks-pgb ks-pgb--medals">
          {block.medals.map((m, i) => (
            <span className="ks-pgb-medal" key={i}><MedalIcon size={13} />{m.name || m}</span>
          ))}
        </div>
      );
    case 'place':
      return (
        <div className="ks-pgb ks-pgb--place">
          <span className="ks-pgb-place__name">{block.place.place}</span>
          <span className="ks-pg-label ks-pgb-place__role">
            {block.place.role}{block.place.year ? ` · ${block.place.year}` : ''}
          </span>
        </div>
      );
    case 'legacyRow':
      return (
        <div className="ks-pgb ks-pgb--legacyrow">
          {block.people.map((p) => (
            <div className="ks-pgb-legacy__person" key={p.id}>
              <Avatar person={{ display_name: p.name, photo: p.photo }} size={52} />
              <span>{p.name.split(/\s+/)[0]}</span>
            </div>
          ))}
        </div>
      );
    case 'legacyLine': {
      const s = block.spread;
      return (
        <p className="ks-pgb ks-pgb--legacyline">
          {s.children.length} {s.children.length === 1 ? 'child' : 'children'}
          {s.grandchildren.length > 0 && (
            <> · {s.grandchildren.length} {s.grandchildren.length === 1 ? 'grandchild' : 'grandchildren'}
              {s.youngestYear && <>, the youngest born {s.youngestYear}</>}</>
          )}
        </p>
      );
    }
    default:
      return null;
  }
}

const FIXED = {
  cover: CoverPage,
  front: FrontPage,
  constellation: ConstellationPage,
  albumHero: AlbumHeroPage,
  albumGrid: AlbumGridPage,
  docsGrid: DocsGridPage,
  record: RecordPage,
  colophon: ColophonPage,
};

// Pages whose composition owns the whole trim — no running head, no folio.
const BARE = new Set(['cover', 'albumHero']);

/*
 * One page. pageNo is 1-based (the cover is page 1, unnumbered by
 * convention). subjectName feeds the running head every interior page
 * carries, the way a real feature well runs its subject across the top.
 */
export default function BookPage({ page, pageNo, canvas, subjectName, edition, onEditSection }) {
  const fixedKind = page.kind === 'fixed' ? page.block.kind : null;
  const bare = fixedKind ? BARE.has(fixedKind) : false;
  const dark = fixedKind ? !!page.block.dark : false;
  const furniture = !bare;

  let body;
  if (fixedKind) {
    const Fixed = FIXED[fixedKind];
    body = Fixed ? <Fixed block={page.block} canvas={canvas} edition={edition} onEditSection={onEditSection} /> : null;
  } else {
    body = page.blocks.map((b) => <Block key={b.id} block={b} onEditSection={onEditSection} />);
  }

  return (
    <div
      className={`ks-pg ks-pgs ks-pgs--${canvas.id}${dark ? ' ks-pg--night' : ''}${bare ? ' ks-pg--bleed' : ''}${fixedKind ? ` ks-pg--${fixedKind}` : ''}`}
      style={{
        width: canvas.w,
        height: canvas.h,
        '--ks-padx': `${canvas.padX}px`,
        '--ks-padtop': `${canvas.padTop}px`,
        '--ks-padbot': `${canvas.padBottom}px`,
      }}
    >
      {furniture && pageNo > 1 && (
        <div className="ks-pg__head" aria-hidden="true">
          <span>{subjectName}</span>
        </div>
      )}
      <div className="ks-pg__body">{body}</div>
      {furniture && pageNo > 1 && (
        <div className="ks-pg__folio" aria-hidden="true">{pageNo}</div>
      )}
    </div>
  );
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
function ordinalWord(n) {
  return ORDINALS[n - 1] || `${n}th`;
}

export { Block as TypesetBlock };

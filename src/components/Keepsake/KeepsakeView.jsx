import { useEffect, useMemo, useRef, useState } from 'react';
import { buildKeepsake, applyNarrative } from '../../lib/keepsake.js';
import {
  CoverSpread, FrontispieceSpread, OriginsSpread, ConstellationSpread,
  ChaptersSpread, ServiceSpread, PlacesSpread, VoicesSpread, AlbumSpread,
  DocumentsSpread, RecordSpread, LegacySpread, ColophonSpread,
} from './spreads.jsx';
import KeepsakeBook from './KeepsakeBook.jsx';
import KeepsakePager from './KeepsakePager.jsx';
import '../../styles/keepsake.css';

/*
 * The Keepsake reader — a full-screen book over the app (docs/KEEPSAKE.md).
 * Phase 1 built the static magazine; Phase 2 wires the narrative engine:
 * on open, fetch the latest compiled edition from /api/keepsake (stored in
 * R2, shared by the whole family). If the tree has grown since it was
 * compiled (facts hash differs), a quiet banner offers to weave the new
 * records in; while recompiling, the previous edition stays readable.
 * Signed-out / demo sessions simply read the Phase-1 book, placeholders
 * and all — no banner, no errors.
 */

const SPREADS = {
  cover: CoverSpread,
  frontispiece: FrontispieceSpread,
  origins: OriginsSpread,
  constellation: ConstellationSpread,
  chapters: ChaptersSpread,
  service: ServiceSpread,
  places: PlacesSpread,
  voices: VoicesSpread,
  album: AlbumSpread,
  documents: DocumentsSpread,
  record: RecordSpread,
  legacy: LegacySpread,
  colophon: ColophonSpread,
};

export default function KeepsakeView({
  graph, personId, memories, photos, documents, activity, familyName, onClose, onCompiled,
  canEdit = false,
}) {
  const keepsake = useMemo(
    () => buildKeepsake(graph, personId, { memories, photos, documents, activity, familyName }),
    [graph, personId, memories, photos, documents, activity, familyName],
  );

  // 'loading' → 'ready' (authed, edition or null) | 'unavailable' (signed
  // out, no server, storage unconfigured — the static book still reads fine).
  const [editionState, setEditionState] = useState('loading');
  const [edition, setEdition] = useState(null);
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState(false);

  // 'book' (the page-turn magazine, the default) | 'scroll' (the long read).
  const [readerMode, setReaderMode] = useState(() => {
    try { return localStorage.getItem('ks_reader_mode') || 'book'; } catch { return 'book'; }
  });
  function toggleReaderMode() {
    setReaderMode((m) => {
      const next = m === 'book' ? 'scroll' : 'book';
      try { localStorage.setItem('ks_reader_mode', next); } catch { /* remembered next visit or not */ }
      return next;
    });
  }

  const spreads = useMemo(
    () => applyNarrative(keepsake?.spreads || [], edition?.narrative),
    [keepsake, edition],
  );

  useEffect(() => {
    let alive = true;
    setEditionState('loading');
    setEdition(null);
    setCompileError(false);
    (async () => {
      try {
        const r = await fetch(`/api/keepsake?personId=${encodeURIComponent(personId)}`);
        if (!alive) return;
        if (!r.ok) { setEditionState('unavailable'); return; }
        const body = await r.json().catch(() => null);
        if (!alive) return;
        setEdition(body || null);
        setEditionState('ready');
      } catch {
        if (alive) setEditionState('unavailable');
      }
    })();
    return () => { alive = false; };
  }, [personId]);

  // ── Narrative editing (the human is trusted over the machine) ────────────
  // { id: 'epithet' | 'origins' | 'legacy' | 'chapter:N', title, text }.
  const [editing, setEditing] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | error
  const editingRef = useRef(null);
  editingRef.current = editing;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // Escape closes the topmost layer only: the edit sheet before the book.
      if (editingRef.current) setEditing(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Print scoping: the print stylesheet hides the app and reflows the book
  // into pages, but it must only ever apply while a Keepsake is actually
  // open — printing the tree view normally shouldn't be hijacked. A body
  // class carries that scope.
  useEffect(() => {
    document.body.classList.add('ks-has-print');
    return () => document.body.classList.remove('ks-has-print');
  }, []);

  // 'idle' | 'preparing' — the Print button decodes every image first so
  // nothing prints as a grey box (lazy-loaded album photos especially).
  const [printState, setPrintState] = useState('idle');
  async function handlePrint() {
    if (printState !== 'idle') return;
    setPrintState('preparing');
    try {
      const imgs = [...(containerRef.current?.querySelectorAll('img') || [])];
      imgs.forEach((img) => { img.loading = 'eager'; });
      await Promise.all(imgs.map((img) => img.decode().catch(() => {})));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      window.print();
    } finally {
      setPrintState('idle');
    }
  }

  // Both reader modes now run on the typeset pages (KeepsakeBook /
  // KeepsakePager) and report their own progress; the old scroll-spread
  // observers are gone with the free-scrolling reader they served.
  const containerRef = useRef(null);
  const progressRef = useRef(null);

  if (!keepsake) return null;

  const stale = edition && edition.hash !== keepsake.factsHash;
  const canCompile = editionState === 'ready';

  async function compile() {
    if (compiling) return;
    setCompiling(true);
    setCompileError(false);
    try {
      const chaptersSpread = keepsake.spreads.find((s) => s.key === 'chapters');
      const colophon = keepsake.spreads.find((s) => s.key === 'colophon');
      const r = await fetch('/api/keepsake', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          personId,
          facts: keepsake.facts,
          chapterPlan: (chaptersSpread?.chapters || []).map((c) => c.label),
          recordCount: colophon?.recordCount ?? null,
        }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok || !body?.narrative) { setCompileError(true); return; }
      setEdition(body);
      onCompiled?.(body);
    } catch {
      setCompileError(true);
    } finally {
      setCompiling(false);
    }
  }

  // Which section a pencil opens, prefilled from the current narrative.
  // Paragraphs edit as one text block, blank line between paragraphs —
  // the same convention as every multi-paragraph field in the app.
  function beginEdit(id) {
    const n = edition?.narrative;
    if (!n) return;
    if (id === 'epithet') setEditing({ id, title: null, text: n.epithet || '' });
    else if (id === 'origins') setEditing({ id, title: null, text: (n.origins || []).join('\n\n') });
    else if (id === 'legacy') setEditing({ id, title: null, text: (n.legacy || []).join('\n\n') });
    else if (id.startsWith('chapter:')) {
      const i = Number(id.slice(8));
      const ch = n.chapters?.[i];
      setEditing({ id, title: ch?.title || '', text: (ch?.paragraphs || []).join('\n\n') });
    }
    setSaveState('idle');
  }

  async function saveEdit() {
    if (!editing || !edition?.narrative || saveState === 'saving') return;
    const paragraphs = editing.text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const n = structuredClone(edition.narrative);
    if (editing.id === 'epithet') {
      if (!editing.text.trim()) { setSaveState('error'); return; }
      n.epithet = editing.text.trim();
    } else if (editing.id === 'origins') {
      n.origins = paragraphs;
    } else if (editing.id === 'legacy') {
      n.legacy = paragraphs;
    } else if (editing.id.startsWith('chapter:')) {
      const i = Number(editing.id.slice(8));
      const plan = keepsake.spreads.find((s) => s.key === 'chapters')?.chapters || [];
      // Editing a chapter the AI never wrote (still pending) creates its
      // narrative slot; earlier missing slots are padded so indexes align.
      while (n.chapters.length <= i) {
        const j = n.chapters.length;
        n.chapters.push({ title: '', years: plan[j]?.label || '', paragraphs: [] });
      }
      n.chapters[i] = { ...n.chapters[i], title: (editing.title || '').trim(), paragraphs };
    }
    setSaveState('saving');
    try {
      const r = await fetch('/api/keepsake', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ personId, narrative: n }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok || !body?.narrative) { setSaveState('error'); return; }
      setEdition(body);
      setEditing(null);
      setSaveState('idle');
    } catch {
      setSaveState('error');
    }
  }

  const onEditSection = canEdit && edition?.narrative && editionState === 'ready' ? beginEdit : null;

  const renderSpread = (spread, withPencils = true) => {
    const Spread = SPREADS[spread.key];
    return Spread
      ? <Spread spread={spread} edition={edition} onEditSection={withPencils ? onEditSection : null} />
      : null;
  };

  return (
    <div
      ref={containerRef}
      className={`keepsake-view${readerMode === 'book' ? ' ks-mode-book' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${keepsake.subject.name} — Keepsake`}
    >
      <div className="ks-progress" aria-hidden="true">
        <div ref={progressRef} className="ks-progress__bar" />
      </div>
      <div className="ks-chrome">
        <span className="ks-chrome__mark">A Bloodline Keepsake</span>
        <div className="ks-chrome__btns">
          <button
            className="ks-chrome__btn"
            onClick={toggleReaderMode}
            aria-label={readerMode === 'book' ? 'Read as scrolling pages' : 'Read as a book'}
            title={readerMode === 'book' ? 'Read as scrolling pages' : 'Read as a book — turn the pages'}
          >
            {readerMode === 'book' ? <ScrollModeIcon /> : <BookModeIcon />}
          </button>
          <button
            className="ks-chrome__btn ks-chrome__btn--print"
            onClick={handlePrint}
            disabled={printState !== 'idle'}
            aria-label={printState === 'preparing' ? 'Preparing pages…' : 'Print this Keepsake'}
            title={printState === 'preparing' ? 'Preparing pages…' : 'Print — or save as PDF from the print dialog'}
          >
            <PrintIcon />
          </button>
          <button className="ks-chrome__btn" onClick={onClose} aria-label="Close the Keepsake">
            <CloseIcon />
          </button>
        </div>
      </div>


      {/* The edition bar — compile / weave-in / error, never blocking the read.
          Styled as a small mastheaded card (badge + kicker + note), matching
          the cover's own typographic language, rather than a generic system
          notification pill — this is the one moment before the book exists
          where the reader needs to feel this is still a Bloodline object. */}
      {canCompile && (compiling || compileError || !edition || stale) && (
        <div className={`ks-banner${compileError ? ' ks-banner--error' : ''}`} role="status">
          <div className="ks-banner__grain" aria-hidden="true" />
          <div className="ks-banner__top">
            <span className={`ks-banner__badge${compiling ? ' ks-banner__badge--busy' : ''}`} aria-hidden="true">
              {compiling ? <SpinnerIcon /> : compileError ? <AlertIcon /> : !edition ? <QuillIcon /> : <SparkleIcon />}
            </span>
            <span className="ks-banner__text">
              <span className="ks-banner__kicker">
                <DiamondIcon />
                {compiling ? 'Compiling' : compileError ? 'Trouble compiling' : !edition ? 'First edition' : 'New chapters'}
                <DiamondIcon />
              </span>
              <span className="ks-banner__note">
                {compiling
                  ? 'The story is being written…'
                  : compileError
                  ? "Couldn't compile this edition."
                  : !edition
                  ? "This book hasn't been written yet."
                  : 'The tree has grown since this edition was compiled.'}
              </span>
            </span>
          </div>
          {!compiling && (
            <button className="ks-banner__btn" onClick={compile}>
              {compileError ? 'Try again' : !edition ? 'Compile the first edition' : 'Weave in the changes'}
            </button>
          )}
        </div>
      )}

      {readerMode === 'book' ? (
        <KeepsakeBook
          spreads={spreads}
          subjectName={keepsake.subject.name}
          edition={edition}
          onEditSection={onEditSection}
          onProgress={(p) => {
            if (progressRef.current) progressRef.current.style.transform = `scaleX(${p})`;
          }}
        />
      ) : (
        <KeepsakePager
          spreads={spreads}
          subjectName={keepsake.subject.name}
          edition={edition}
          onEditSection={onEditSection}
          onProgress={(p) => {
            if (progressRef.current) progressRef.current.style.transform = `scaleX(${p})`;
          }}
        />
      )}
      {/* Print reads the whole book in normal flow; both screen readers only
          mount a page or two at a time, so a plain copy of every spread
          lives here — hidden on screen, the print pipeline's input on
          paper. */}
      <div className="ks-printflow" aria-hidden="true">
        {spreads.map((spread) => (
          <div key={spread.key}>{renderSpread(spread, false)}</div>
        ))}
      </div>

      {/* The edit sheet — one implementation for every section. */}
      {editing && (
        <div className="sheet-scrim sheet-scrim--modal" onClick={() => setEditing(null)}>
          <div className="sheet sheet--form ks-editsheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Edit this section">
            <div className="sheet__grip" />
            <h2 className="ks-editsheet__head">
              {editing.id === 'epithet' ? 'The cover line'
                : editing.id === 'origins' ? 'Origins'
                : editing.id === 'legacy' ? 'Legacy'
                : 'This chapter'}
            </h2>
            {editing.title !== null && (
              <input
                className="field__input"
                value={editing.title}
                placeholder="Chapter title"
                onChange={(e) => setEditing((s) => ({ ...s, title: e.target.value }))}
              />
            )}
            {editing.id === 'epithet' ? (
              <input
                className="field__input"
                autoFocus
                value={editing.text}
                onChange={(e) => setEditing((s) => ({ ...s, text: e.target.value }))}
              />
            ) : (
              <textarea
                className="field__input field__input--area"
                rows={10}
                autoFocus={editing.title === null}
                value={editing.text}
                onChange={(e) => setEditing((s) => ({ ...s, text: e.target.value }))}
                placeholder="Leave a blank line between paragraphs."
              />
            )}
            <p className="ks-editsheet__hint">
              Your words replace the compiled prose for the whole family — recompiling a
              new edition will write over them again.
            </p>
            {saveState === 'error' && (
              <p className="ks-editsheet__error">Couldn&apos;t save — check the text and try again.</p>
            )}
            <div className="ks-editsheet__actions">
              <button className="btn btn--primary" onClick={saveEdit} disabled={saveState === 'saving'}>
                {saveState === 'saving' ? 'Saving…' : 'Save'}
              </button>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BookModeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5.5C10.2 4 7.8 3.5 5 3.5c-.9 0-1.7.06-2.5.17V18.7c.8-.12 1.6-.17 2.5-.17 2.8 0 5.2.5 7 2 1.8-1.5 4.2-2 7-2 .9 0 1.7.05 2.5.17V3.67A17 17 0 0 0 19 3.5c-2.8 0-5.2.5-7 2z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M12 5.5v15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function ScrollModeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 5h14M5 10h14M5 15h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M17.5 14v6m0 0l-2.4-2.4M17.5 20l2.4-2.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PrintIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 8V3h10v5M7 17H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 14h10v7H7z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

// The edition banner's badge/kicker icons — a quill for the not-yet-written
// state, a sparkle for weaving in new chapters, an alert for a failed
// compile, and a spinner while one is in flight.
function QuillIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 4c-4.5 0-11 2.5-13.5 9C5 16.5 4 19 3 20c1-.3 4-1.2 6.5-2.7 5-3 8.5-8.8 8.5-11.7 0-.6-.2-1.1-.5-1.4-.3-.3-.8-.5-1.4-.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9.5 14.5c1.2-2.5 3.3-5.7 6-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" fill="currentColor" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" fill="currentColor" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4l9 16H3l9-16z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 10.5v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" />
    </svg>
  );
}
function SpinnerIcon() {
  return (
    <svg className="ks-banner__spin" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2.4" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
function DiamondIcon() {
  return (
    <svg className="ks-banner__diamond" width="6" height="6" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M5 0l5 5-5 5-5-5z" fill="currentColor" />
    </svg>
  );
}

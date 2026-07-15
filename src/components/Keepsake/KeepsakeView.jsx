import { useEffect, useMemo, useRef, useState } from 'react';
import { buildKeepsake, applyNarrative } from '../../lib/keepsake.js';
import {
  CoverSpread, FrontispieceSpread, OriginsSpread, ConstellationSpread,
  ChaptersSpread, ServiceSpread, PlacesSpread, VoicesSpread, AlbumSpread,
  DocumentsSpread, RecordSpread, LegacySpread, ColophonSpread,
} from './spreads.jsx';
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

  // ── Motion (Phase 3) ──────────────────────────────────────────────────────
  // One observer marks each spread .ks-in the first time a quarter of it is
  // on screen — every entrance animation keys off that class. Under
  // prefers-reduced-motion the class is inert (all motion CSS lives inside
  // a no-preference media block), so this can run unconditionally.
  const containerRef = useRef(null);
  const progressRef = useRef(null);
  const spreadCount = keepsake?.spreads.length || 0;

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('ks-in');
            io.unobserve(e.target);
          }
        }
      },
      { root, threshold: 0.25 },
    );
    root.querySelectorAll('.ks-spread').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [spreadCount]);

  // One rAF-throttled scroll listener drives both the reading-progress
  // hairline and the chapters rail fill (--ks-read on the chapters spread).
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const max = root.scrollHeight - root.clientHeight;
      const p = max > 0 ? root.scrollTop / max : 0;
      if (progressRef.current) progressRef.current.style.transform = `scaleX(${p})`;
      const chapters = root.querySelector('.ks-spread--chapters');
      if (chapters) {
        const r = chapters.getBoundingClientRect();
        const read = Math.max(0, Math.min(1, (root.clientHeight * 0.8 - r.top) / r.height));
        chapters.style.setProperty('--ks-read', String(read));
      }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    root.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => { root.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [spreadCount]);

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

  const spreads = applyNarrative(keepsake.spreads, edition?.narrative);

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

  return (
    <div ref={containerRef} className="keepsake-view" role="dialog" aria-modal="true" aria-label={`${keepsake.subject.name} — Keepsake`}>
      <div className="ks-progress" aria-hidden="true">
        <div ref={progressRef} className="ks-progress__bar" />
      </div>
      <div className="ks-chrome">
        <span className="ks-chrome__mark">A Bloodline Keepsake</span>
        <div className="ks-chrome__btns">
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


      {/* The edition bar — compile / weave-in / error, never blocking the read. */}
      {canCompile && (compiling || compileError || !edition || stale) && (
        <div className="ks-banner" role="status">
          {compiling ? (
            <span className="ks-banner__note">Compiling this edition — the story is being written…</span>
          ) : compileError ? (
            <>
              <span className="ks-banner__note">Couldn&apos;t compile this edition.</span>
              <button className="ks-banner__btn" onClick={compile}>Try again</button>
            </>
          ) : !edition ? (
            <>
              <span className="ks-banner__note">This book hasn&apos;t been written yet.</span>
              <button className="ks-banner__btn" onClick={compile}>Compile the first edition</button>
            </>
          ) : (
            <>
              <span className="ks-banner__note">The tree has grown since this edition was compiled.</span>
              <button className="ks-banner__btn" onClick={compile}>Weave in the changes</button>
            </>
          )}
        </div>
      )}

      {spreads.map((spread) => {
        const Spread = SPREADS[spread.key];
        return Spread
          ? <Spread key={spread.key} spread={spread} edition={edition} onEditSection={onEditSection} />
          : null;
      })}

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

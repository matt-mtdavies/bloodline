import { useState, useRef, useCallback } from 'react';
import { gedcomToStore } from '../lib/gedcom.js';

export default function GedcomImport({ onImport, onClose }) {
  const [step, setStep] = useState('upload'); // upload | preview | importing | done
  const [parsed, setParsed] = useState(null);
  const [mergeMode, setMergeMode] = useState('replace');
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();

  const processFile = useCallback((file) => {
    if (!file) return;
    if (!file.name.match(/\.(ged|gedcom)$/i)) {
      setError('Please choose a .ged or .gedcom file.');
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const result = gedcomToStore(e.target.result);
        if (result.people.length === 0) {
          setError('No people found in this file. Is it a valid GEDCOM export?');
          return;
        }
        setParsed(result);
        setStep('preview');
      } catch {
        setError('Could not parse this file. Please try a standard GEDCOM 5.5 export from Ancestry, FamilySearch, or MyHeritage.');
      }
    };
    reader.onerror = () => setError('Could not read the file.');
    reader.readAsText(file, 'UTF-8');
  }, []);

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    processFile(e.dataTransfer.files[0]);
  }

  const firstPersonId = useRef(null);

  function handleImport() {
    setStep('importing');
    firstPersonId.current = parsed.people[0]?.id ?? null;
    setTimeout(() => {
      onImport(parsed.people, parsed.relationships, { merge: mergeMode === 'merge' });
      setStep('done');
    }, 500);
  }

  return (
    <div className="sheet-scrim" role="dialog" aria-modal="true" aria-label="Import GEDCOM file" onClick={() => onClose(null)}>
      <div className="sheet gedcom-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grip" />
        <div className="gedcom__head">
          <h2 className="gedcom__title">Import family tree</h2>
          <button className="icon-btn" onClick={() => onClose(null)} aria-label="Close"><CloseIcon /></button>
        </div>

        {step === 'upload' && (
          <UploadStep
            dragging={dragging}
            error={error}
            inputRef={inputRef}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onChange={(e) => processFile(e.target.files[0])}
            onZoneClick={() => inputRef.current?.click()}
          />
        )}

        {step === 'preview' && parsed && (
          <PreviewStep
            parsed={parsed}
            mergeMode={mergeMode}
            onMergeMode={setMergeMode}
            onImport={handleImport}
            onBack={() => { setStep('upload'); setParsed(null); }}
          />
        )}

        {step === 'importing' && (
          <div className="gedcom__importing">
            <div className="gedcom__spinner" aria-hidden="true" />
            <p className="gedcom__importing-label">Importing your family tree…</p>
          </div>
        )}

        {step === 'done' && parsed && (
          <DoneStep
            count={parsed.people.length}
            mergeMode={mergeMode}
            onClose={() => onClose(firstPersonId.current)}
          />
        )}
      </div>
    </div>
  );
}

/* ── Steps ─────────────────────────────────────────────────────────────────── */

function UploadStep({ dragging, error, inputRef, onDragOver, onDragLeave, onDrop, onChange, onZoneClick }) {
  return (
    <div className="gedcom__upload">
      <p className="gedcom__intro">
        Import a GEDCOM file exported from Ancestry, FamilySearch, MyHeritage, 23andMe, or any
        genealogy app. Your data stays on your device.
      </p>

      <div
        className={`gedcom__dropzone${dragging ? ' gedcom__dropzone--over' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={onZoneClick}
        role="button"
        tabIndex={0}
        aria-label="Drop a GEDCOM file or click to browse"
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onZoneClick(); }}
      >
        <UploadIcon />
        <span className="gedcom__dropzone-label">
          Drop your <strong>.ged</strong> file here
        </span>
        <span className="gedcom__dropzone-sub">or click to browse</span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".ged,.gedcom"
        className="gedcom__file-input"
        onChange={onChange}
        aria-hidden="true"
        tabIndex={-1}
      />

      {error && <p className="gedcom__error" role="alert">{error}</p>}

      <div className="gedcom__sources">
        {SOURCES.map((s) => (
          <span key={s} className="gedcom__source-chip">{s}</span>
        ))}
      </div>
    </div>
  );
}

const SOURCES = ['Ancestry', 'FamilySearch', 'MyHeritage', '23andMe', 'Findmypast', 'MacFamilyTree', 'Gramps'];

function PreviewStep({ parsed, mergeMode, onMergeMode, onImport, onBack }) {
  const { people, relationships } = parsed;
  const partnerCount = relationships.filter((r) => r.type === 'partner').length;
  const parentCount = relationships.filter((r) => r.type === 'parent').length;
  const withBio = people.filter((p) => p.bio).length;
  const withDates = people.filter((p) => p.birth_date || p.death_date).length;

  // Show a sample of names
  const sample = people.slice(0, 6).map((p) => p.display_name);
  const extra = people.length - sample.length;

  return (
    <div className="gedcom__preview">
      <div className="gedcom__stats">
        <div className="gedcom__stat">
          <span className="gedcom__stat-num">{people.length}</span>
          <span className="gedcom__stat-label">people</span>
        </div>
        <div className="gedcom__stat">
          <span className="gedcom__stat-num">{partnerCount}</span>
          <span className="gedcom__stat-label">couples</span>
        </div>
        <div className="gedcom__stat">
          <span className="gedcom__stat-num">{parentCount}</span>
          <span className="gedcom__stat-label">parent links</span>
        </div>
        <div className="gedcom__stat">
          <span className="gedcom__stat-num">{withDates}</span>
          <span className="gedcom__stat-label">with dates</span>
        </div>
      </div>

      <div className="gedcom__names">
        {sample.map((name, i) => (
          <span key={i} className="gedcom__name-chip">{name}</span>
        ))}
        {extra > 0 && <span className="gedcom__name-chip gedcom__name-chip--more">+{extra} more</span>}
      </div>

      {withBio > 0 && (
        <p className="gedcom__bio-note">
          <NoteIcon /> {withBio} {withBio === 1 ? 'person has' : 'people have'} biography notes that will be imported.
        </p>
      )}

      <div className="gedcom__merge-section">
        <p className="gedcom__merge-title">How should we handle your existing tree?</p>
        <div className="gedcom__merge-opts">
          <button
            className={`gedcom__merge-opt${mergeMode === 'replace' ? ' gedcom__merge-opt--on' : ''}`}
            onClick={() => onMergeMode('replace')}
          >
            <span className="gedcom__merge-opt-name">Replace</span>
            <span className="gedcom__merge-opt-desc">Start fresh with the imported tree. Your current tree will be erased.</span>
          </button>
          <button
            className={`gedcom__merge-opt${mergeMode === 'merge' ? ' gedcom__merge-opt--on' : ''}`}
            onClick={() => onMergeMode('merge')}
          >
            <span className="gedcom__merge-opt-name">Merge</span>
            <span className="gedcom__merge-opt-desc">Append to your current tree. Duplicate people may appear.</span>
          </button>
        </div>
      </div>

      <div className="gedcom__preview-actions">
        <button className="gedcom__back-btn" onClick={onBack}>← Back</button>
        <button className="gedcom__import-btn" onClick={onImport}>
          Import {people.length} {people.length === 1 ? 'person' : 'people'} →
        </button>
      </div>
    </div>
  );
}

function DoneStep({ count, mergeMode, onClose }) {
  return (
    <div className="gedcom__done">
      <div className="gedcom__done-icon" aria-hidden="true">
        <CheckIcon />
      </div>
      <h3 className="gedcom__done-title">
        {count} {count === 1 ? 'person' : 'people'} imported
      </h3>
      <p className="gedcom__done-sub">
        {mergeMode === 'merge'
          ? 'The new people have been added to your existing tree.'
          : 'Your family tree has been replaced with the imported data.'}
        {' '}Portraits and photos aren't included in GEDCOM files, but all names, dates, and relationships are in.
      </p>
      <button className="gedcom__import-btn" onClick={onClose}>
        View my tree →
      </button>
    </div>
  );
}

/* ── Icons ──────────────────────────────────────────────────────────────────── */

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points="17 8 12 3 7 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{display:'inline',verticalAlign:'middle',marginRight:4}}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points="14 2 14 8 20 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="8" y1="13" x2="16" y2="13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
      <line x1="8" y1="17" x2="13" y2="17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
    </svg>
  );
}

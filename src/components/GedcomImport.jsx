import { useState, useRef, useCallback, useMemo } from 'react';
import { gedcomToStore } from '../lib/gedcom.js';
import { findDuplicatePairs, summarizeMergeImport } from '../lib/duplicates.js';
import ImportDoneStep from './ImportDoneStep.jsx';
import MergeReviewStep from './MergeReviewStep.jsx';

export default function GedcomImport({ onImport, onClose, canReplace = true, existingPeople = [], existingRelationships = [], familyName = '' }) {
  const [step, setStep] = useState('upload'); // upload | preview | review | importing | done
  const [parsed, setParsed] = useState(null);
  // Real incident (docs/SAFETY.md): this used to default to 'replace' —
  // silently pre-selecting a full, irreversible tree wipe — for anyone with
  // co-admin+ permission, on the theory that only they'd ever see the
  // option at all. A tester with exactly that permission clicked the
  // now-highlighted "Import" button without noticing Replace was already
  // selected and wiped 797 of 1,104 people. Replace must never be the
  // starting state for anyone, regardless of permission — it's an
  // affirmative, rare choice, not a default.
  const [mergeMode, setMergeMode] = useState('merge');
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();

  // How many likely-duplicate people would this import create? A real report
  // (600-person import, "cited many duplicates created") had no way to know
  // this before committing — merge mode compares the imported batch against
  // the existing tree (only pairs touching a NEW person, since pre-existing
  // duplicates already have their own review path); replace mode compares
  // the imported batch against itself, since the old tree won't exist after.
  const duplicateCount = useMemo(() => {
    if (!parsed) return 0;
    if (mergeMode === 'merge') {
      const newIds = new Set(parsed.people.map((p) => p.id));
      const pairs = findDuplicatePairs(
        [...existingPeople, ...parsed.people],
        [...existingRelationships, ...parsed.relationships],
      );
      return pairs.filter((pr) => newIds.has(pr.aId) || newIds.has(pr.bId)).length;
    }
    return findDuplicatePairs(parsed.people, parsed.relationships).length;
  }, [parsed, mergeMode, existingPeople, existingRelationships]);

  // What a merge would actually do — genuinely new people vs. existing
  // people gaining new facts vs. records already fully accounted for. Only
  // computed for merge mode; Replace is a full, unambiguous wipe-and-start-
  // fresh action that doesn't need a diff. This is what makes "Update from
  // file" a reviewable delta rather than a blind re-commit — see
  // summarizeMergeImport's own doc comment (lib/duplicates.js).
  const mergeSummary = useMemo(() => {
    if (!parsed || mergeMode !== 'merge') return null;
    return summarizeMergeImport(existingPeople, existingRelationships, parsed.people, parsed.relationships);
  }, [parsed, mergeMode, existingPeople, existingRelationships]);

  // mergeSummary above is deliberately LIVE (it depends on existingPeople,
  // which is App.jsx's own data.people prop) — necessary so the review
  // screen always reflects the CURRENT tree if it's edited elsewhere while
  // this sheet is open. But that liveness is exactly wrong for the Done
  // screen: the instant commitImport's onImport() call lands, existingPeople
  // updates to include what was just merged, mergeSummary recomputes against
  // the now-already-merged tree, and the diff collapses to zero — a real bug
  // caught live-testing this (Done screen said "up to date" immediately
  // after adding a genuinely new person). frozenSummary snapshots the
  // summary at the moment Apply is clicked, before anything commits, so the
  // Done screen always describes what actually just happened.
  const frozenSummary = useRef(null);
  // What the user actually chose to apply on the review screen (per-person
  // opt-outs — see MergeReviewStep.jsx's own comment). Defaults to "include
  // everything" so Replace mode (which never visits the review screen) and
  // a merge where nobody touched a toggle both behave exactly as before
  // this existed.
  const selectionRef = useRef({ excludedNewIds: new Set(), excludedExistingIds: new Set() });

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
    // Replace commits immediately (a full, unambiguous wipe-and-start-fresh
    // action with its own warning already shown). Merge goes to the review
    // step first — see mergeSummary above. Freeze the summary the instant we
    // commit to reviewing it, before anything changes underneath it.
    if (mergeMode === 'merge') {
      frozenSummary.current = mergeSummary;
      setStep('review');
      return;
    }
    commitImport();
  }

  function commitImport(selection = { excludedNewIds: new Set(), excludedExistingIds: new Set() }) {
    setStep('importing');
    selectionRef.current = selection;
    const summary = frozenSummary.current;
    const { excludedNewIds, excludedExistingIds } = selection;
    // Land on a genuinely new (and actually included) person when there is
    // one, rather than whichever record happened to be first in the file —
    // for a merge that only enriched existing people, that's the first
    // included person who gained something; only truly falls back to the
    // raw batch order for Replace.
    firstPersonId.current =
      summary?.newPeople.find((p) => !excludedNewIds.has(p.id))?.id
      ?? summary?.enrichedPeople.find((p) => !excludedExistingIds.has(p.id))?.id
      ?? parsed.people[0]?.id
      ?? null;
    setTimeout(() => {
      onImport(parsed.people, parsed.relationships, {
        merge: mergeMode === 'merge',
        skipPeople: excludedNewIds,
        skipEnrichmentFor: excludedExistingIds,
      });
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
            canReplace={canReplace}
            duplicateCount={duplicateCount}
            familyName={familyName}
          />
        )}

        {step === 'review' && frozenSummary.current && (
          <MergeReviewStep
            summary={frozenSummary.current}
            duplicateCount={duplicateCount}
            onApply={commitImport}
            onBack={() => setStep('preview')}
          />
        )}

        {step === 'importing' && (
          <div className="gedcom__importing">
            <div className="gedcom__spinner" aria-hidden="true" />
            <p className="gedcom__importing-label">Importing your family tree…</p>
          </div>
        )}

        {step === 'done' && parsed && (
          <ImportDoneStep
            people={parsed.people}
            mergeMode={mergeMode}
            addedCount={frozenSummary.current ? frozenSummary.current.newPeople.length - selectionRef.current.excludedNewIds.size : undefined}
            enrichedCount={frozenSummary.current ? frozenSummary.current.enrichedPeople.length - selectionRef.current.excludedExistingIds.size : 0}
            sourceNote="Portraits and photos aren't included in GEDCOM files, but all names, dates, and relationships are in."
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

function PreviewStep({ parsed, mergeMode, onMergeMode, onImport, onBack, canReplace, duplicateCount = 0, familyName = '' }) {
  const { people, relationships } = parsed;
  const partnerCount = relationships.filter((r) => r.type === 'partner').length;
  const parentCount = relationships.filter((r) => r.type === 'parent').length;
  const withBio = people.filter((p) => p.bio).length;
  const withDates = people.filter((p) => p.birth_date || p.death_date).length;

  // Show a sample of names
  const sample = people.slice(0, 6).map((p) => p.display_name);
  const extra = people.length - sample.length;

  // Real incident (docs/SAFETY.md): Replace used to commit on a single tap
  // of the main action button, with only a line of subtext as a warning. It
  // must never be one tap away from an irreversible whole-tree wipe again —
  // same bar as Family Settings' "Start over — erase tree": type the family
  // name back before it can fire. Merge is completely unaffected.
  const [replaceConfirming, setReplaceConfirming] = useState(false);
  const [replaceTypedName, setReplaceTypedName] = useState('');
  const replaceNameMatches = familyName && replaceTypedName.trim() === familyName.trim();

  function handleActionClick() {
    if (mergeMode === 'replace' && !replaceConfirming) {
      setReplaceConfirming(true);
      return;
    }
    onImport();
  }

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

      {duplicateCount > 0 && (
        <p className="gedcom__dup-note" role="status">
          <DupIcon /> {duplicateCount} possible duplicate {duplicateCount === 1 ? 'person' : 'people'}
          {mergeMode === 'merge' ? ' against your existing tree' : ' within this file'} —
          you'll be able to review and merge them from "Possible duplicates" after importing.
        </p>
      )}

      <div className="gedcom__merge-section">
        <p className="gedcom__merge-title">How should we handle your existing tree?</p>
        <div className="gedcom__merge-opts">
          {canReplace && (
            <button
              className={`gedcom__merge-opt${mergeMode === 'replace' ? ' gedcom__merge-opt--on' : ''}`}
              onClick={() => { onMergeMode('replace'); setReplaceConfirming(false); setReplaceTypedName(''); }}
            >
              <span className="gedcom__merge-opt-name">Replace</span>
              <span className="gedcom__merge-opt-desc">Start fresh with the imported tree. Your current tree will be erased.</span>
            </button>
          )}
          <button
            className={`gedcom__merge-opt${mergeMode === 'merge' ? ' gedcom__merge-opt--on' : ''}`}
            onClick={() => { onMergeMode('merge'); setReplaceConfirming(false); setReplaceTypedName(''); }}
          >
            <span className="gedcom__merge-opt-name">Merge</span>
            <span className="gedcom__merge-opt-desc">Append to your current tree. Duplicate people may appear.</span>
          </button>
        </div>
        {!canReplace && (
          <p className="gedcom__merge-note">Only a co-admin or owner can replace the whole tree.</p>
        )}
      </div>

      {replaceConfirming ? (
        <div className="fs__reset-confirm">
          <p className="fs__reset-warning">
            This erases every person, relationship, memory, photo, and document currently in
            {' '}<strong>{familyName || 'your tree'}</strong> — for every family member, not just you — and
            replaces it with the {people.length} {people.length === 1 ? 'person' : 'people'} in this file.
            It can't be undone.
          </p>
          <label className="fs__reset-label">
            Type <strong>{familyName || 'your family name'}</strong> to confirm
          </label>
          <input
            className="fs__reset-input"
            value={replaceTypedName}
            onChange={(e) => setReplaceTypedName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && replaceNameMatches) onImport(); }}
            placeholder={familyName}
            autoFocus
          />
          <div className="fs__reset-btns">
            <button className="fs__danger-btn" disabled={!replaceNameMatches} onClick={onImport}>
              Replace tree
            </button>
            <button
              className="fs__reset-cancel"
              onClick={() => { setReplaceConfirming(false); setReplaceTypedName(''); }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="gedcom__preview-actions">
          <button className="gedcom__back-btn" onClick={onBack}>← Back</button>
          <button className="gedcom__import-btn" onClick={handleActionClick}>
            {mergeMode === 'merge' ? 'Review changes →' : `Import ${people.length} ${people.length === 1 ? 'person' : 'people'} →`}
          </button>
        </div>
      )}
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

function DupIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{display:'inline',verticalAlign:'middle',marginRight:4}}>
      <path d="M12 9v4M12 16.5h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M10.3 3.9 1.8 18.3a1.6 1.6 0 0 0 1.4 2.4h17.6a1.6 1.6 0 0 0 1.4-2.4L13.7 3.9a1.6 1.6 0 0 0-2.8 0Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
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

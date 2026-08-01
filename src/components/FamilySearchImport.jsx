import { useState, useMemo, useRef } from 'react';
import { openFamilySearchOAuth, fetchTree } from '../lib/familysearch.js';
import { findDuplicatePairs, summarizeMergeImport } from '../lib/duplicates.js';
import ImportDoneStep from './ImportDoneStep.jsx';
import MergeReviewStep from './MergeReviewStep.jsx';

const GENERATION_OPTIONS = [
  { value: 3, label: '3 generations', sub: 'Up to 15 ancestors' },
  { value: 4, label: '4 generations', sub: 'Up to 31 ancestors' },
  { value: 5, label: '5 generations', sub: 'Up to 63 ancestors' },
];

export default function FamilySearchImport({ onImport, onClose, canReplace = true, existingPeople = [], existingRelationships = [], familyName = '' }) {
  const [step, setStep] = useState('connect'); // connect | fetching | preview | review | importing | done
  const [generations, setGenerations] = useState(4);
  const [token, setToken] = useState(null);
  const [result, setResult] = useState(null); // { people, relationships }
  // Real incident (docs/SAFETY.md) in GedcomImport.jsx's sibling flow — this
  // must never default to 'replace' for anyone, regardless of permission.
  // See GedcomImport.jsx's own comment for the full story.
  const [mergeMode, setMergeMode] = useState('merge');
  const [error, setError] = useState(null);

  // Same proactive duplicate check as GedcomImport.jsx — see its comment.
  const duplicateCount = useMemo(() => {
    if (!result) return 0;
    if (mergeMode === 'merge') {
      const newIds = new Set(result.people.map((p) => p.id));
      const pairs = findDuplicatePairs(
        [...existingPeople, ...result.people],
        [...existingRelationships, ...result.relationships],
      );
      return pairs.filter((pr) => newIds.has(pr.aId) || newIds.has(pr.bId)).length;
    }
    return findDuplicatePairs(result.people, result.relationships).length;
  }, [result, mergeMode, existingPeople, existingRelationships]);

  // Same reviewable-delta summary as GedcomImport.jsx — see its own comment
  // and summarizeMergeImport's doc comment (lib/duplicates.js).
  const mergeSummary = useMemo(() => {
    if (!result || mergeMode !== 'merge') return null;
    return summarizeMergeImport(existingPeople, existingRelationships, result.people, result.relationships);
  }, [result, mergeMode, existingPeople, existingRelationships]);

  // Frozen at the moment Apply is clicked — see GedcomImport.jsx's own
  // comment for why this can't just read the live mergeSummary: the instant
  // onImport() commits, existingPeople updates and mergeSummary recomputes
  // against the now-already-merged tree, silently zeroing out the Done
  // screen's counts.
  const frozenSummary = useRef(null);
  // What the user chose to apply on the review screen — see GedcomImport.jsx
  // and MergeReviewStep.jsx's own comments.
  const selectionRef = useRef({ excludedNewIds: new Set(), excludedExistingIds: new Set() });

  const firstPersonId = useRef(null);

  async function handleConnect() {
    setError(null);
    try {
      const accessToken = await openFamilySearchOAuth();
      setToken(accessToken);
      setStep('fetching');
      const data = await fetchTree(accessToken, generations);
      setResult(data);
      setStep('preview');
    } catch (err) {
      if (err.message === 'cancelled') {
        setError(null); // user closed popup — silent
        return;
      }
      setError(err.message || 'Could not connect to FamilySearch.');
      setStep('connect');
    }
  }

  async function handleFetch() {
    setError(null);
    setStep('fetching');
    try {
      const data = await fetchTree(token, generations);
      setResult(data);
      setStep('preview');
    } catch (err) {
      setError(err.message || 'Failed to fetch family tree.');
      setStep('preview');
    }
  }

  function handleImport() {
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
    firstPersonId.current =
      summary?.newPeople.find((p) => !excludedNewIds.has(p.id))?.id
      ?? summary?.enrichedPeople.find((p) => !excludedExistingIds.has(p.id))?.id
      ?? result.people[0]?.id
      ?? null;
    setTimeout(() => {
      onImport(result.people, result.relationships, {
        merge: mergeMode === 'merge',
        skipPeople: excludedNewIds,
        skipEnrichmentFor: excludedExistingIds,
      });
      setStep('done');
    }, 500);
  }

  return (
    <div className="sheet-scrim" role="dialog" aria-modal="true" aria-label="Import from FamilySearch" onClick={() => onClose(null)}>
      <div className="sheet gedcom-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grip" />
        <div className="gedcom__head">
          <div className="fs-import__head-title">
            <FamilySearchLogo />
            <h2 className="gedcom__title">FamilySearch</h2>
          </div>
          <button className="icon-btn" onClick={() => onClose(null)} aria-label="Close"><CloseIcon /></button>
        </div>

        {step === 'connect' && (
          <ConnectStep
            generations={generations}
            onGenerations={setGenerations}
            error={error}
            onConnect={handleConnect}
          />
        )}

        {step === 'fetching' && (
          <FetchingStep generations={generations} />
        )}

        {step === 'preview' && result && (
          <PreviewStep
            result={result}
            generations={generations}
            onGenerations={setGenerations}
            mergeMode={mergeMode}
            onMergeMode={setMergeMode}
            error={error}
            onFetch={handleFetch}
            onImport={handleImport}
            onBack={() => setStep('connect')}
            canReplace={canReplace}
            duplicateCount={duplicateCount}
            familyName={familyName}
          />
        )}

        {step === 'review' && frozenSummary.current && (
          <MergeReviewStep
            summary={frozenSummary.current}
            duplicateCount={duplicateCount}
            noun="ancestor"
            nounPlural="ancestors"
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

        {step === 'done' && result && (
          <ImportDoneStep
            people={result.people}
            mergeMode={mergeMode}
            noun="ancestor"
            nounPlural="ancestors"
            addedCount={frozenSummary.current ? frozenSummary.current.newPeople.length - selectionRef.current.excludedNewIds.size : undefined}
            enrichedCount={frozenSummary.current ? frozenSummary.current.enrichedPeople.length - selectionRef.current.excludedExistingIds.size : 0}
            sourceNote="Profile portraits and memories aren't part of FamilySearch data, but all names, dates, and relationships are in."
            onClose={() => onClose(firstPersonId.current)}
          />
        )}
      </div>
    </div>
  );
}

/* ── Steps ─────────────────────────────────────────────────────────────────── */

function ConnectStep({ generations, onGenerations, error, onConnect }) {
  return (
    <div className="gedcom__upload">
      <p className="gedcom__intro">
        Sign in with your FamilySearch account to import your ancestors directly.
        FamilySearch is the world's largest free genealogy database, with billions
        of historical records.
      </p>

      <div className="fs-import__gen-section">
        <p className="fs-import__gen-title">How many generations to import?</p>
        <div className="fs-import__gen-opts">
          {GENERATION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`fs-import__gen-opt${generations === opt.value ? ' fs-import__gen-opt--on' : ''}`}
              onClick={() => onGenerations(opt.value)}
            >
              <span className="fs-import__gen-num">{opt.value}</span>
              <span className="fs-import__gen-label">{opt.label}</span>
              <span className="fs-import__gen-sub">{opt.sub}</span>
            </button>
          ))}
        </div>
      </div>

      {error && <p className="gedcom__error" role="alert">{error}</p>}

      <button className="fs-import__connect-btn" onClick={onConnect}>
        <FamilySearchLogo size={18} />
        Sign in with FamilySearch
      </button>

      <p className="fs-import__privacy">
        Your FamilySearch credentials are entered directly on FamilySearch's website.
        Bloodline never sees your password.
      </p>
    </div>
  );
}

function FetchingStep({ generations }) {
  return (
    <div className="gedcom__importing">
      <div className="gedcom__spinner" aria-hidden="true" />
      <p className="gedcom__importing-label">Fetching {generations} generations of ancestors…</p>
      <p className="fs-import__fetch-sub">This may take a few seconds for large trees.</p>
    </div>
  );
}

function PreviewStep({ result, generations, onGenerations, mergeMode, onMergeMode, error, onFetch, onImport, onBack, canReplace, duplicateCount = 0, familyName = '' }) {
  const { people, relationships } = result;
  const partnerCount = relationships.filter((r) => r.type === 'partner').length;
  const parentCount = relationships.filter((r) => r.type === 'parent').length;
  const withDates = people.filter((p) => p.birth_date || p.death_date).length;
  const sample = people.slice(0, 6).map((p) => p.display_name);
  const extra = people.length - sample.length;

  // Same typed-confirmation gate as GedcomImport.jsx's PreviewStep — see its
  // own comment for why this exists.
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
        {sample.map((name, i) => <span key={i} className="gedcom__name-chip">{name}</span>)}
        {extra > 0 && <span className="gedcom__name-chip gedcom__name-chip--more">+{extra} more</span>}
      </div>

      {/* Re-fetch with different generation count */}
      <div className="fs-import__gen-section fs-import__gen-section--compact">
        <p className="fs-import__gen-title">Generations imported</p>
        <div className="fs-import__gen-opts fs-import__gen-opts--row">
          {GENERATION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`fs-import__gen-pill${generations === opt.value ? ' fs-import__gen-pill--on' : ''}`}
              onClick={() => { onGenerations(opt.value); onFetch(); }}
            >
              {opt.value}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="gedcom__error" role="alert">{error}</p>}

      {duplicateCount > 0 && (
        <p className="gedcom__dup-note" role="status">
          <DupIcon /> {duplicateCount} possible duplicate {duplicateCount === 1 ? 'person' : 'people'}
          {mergeMode === 'merge' ? ' against your existing tree' : ' within this import'} —
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
            replaces it with the {people.length} {people.length === 1 ? 'person' : 'people'} from FamilySearch.
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
          <button className="gedcom__back-btn" onClick={onBack}>← Disconnect</button>
          <button className="gedcom__import-btn" onClick={handleActionClick}>
            {mergeMode === 'merge' ? 'Review changes →' : `Import ${people.length} ${people.length === 1 ? 'person' : 'people'} →`}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Icons ──────────────────────────────────────────────────────────────────── */

function FamilySearchLogo({ size = 22 }) {
  // FamilySearch green leaf mark, simplified as a generic leaf SVG
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 22C12 22 3 16.5 3 9a9 9 0 0 1 18 0c0 7.5-9 13-9 13z"
        fill="#3e7d2d"
        stroke="none"
      />
      <path d="M12 22V9" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12 14c0 0-3-2-4-5" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M12 11c0 0 2.5-1.5 3.5-4" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
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

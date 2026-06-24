import { useState } from 'react';
import { openFamilySearchOAuth, fetchTree } from '../lib/familysearch.js';

const GENERATION_OPTIONS = [
  { value: 3, label: '3 generations', sub: 'Up to 15 ancestors' },
  { value: 4, label: '4 generations', sub: 'Up to 31 ancestors' },
  { value: 5, label: '5 generations', sub: 'Up to 63 ancestors' },
];

export default function FamilySearchImport({ onImport, onClose }) {
  const [step, setStep] = useState('connect'); // connect | fetching | preview | importing | done
  const [generations, setGenerations] = useState(4);
  const [token, setToken] = useState(null);
  const [result, setResult] = useState(null); // { people, relationships }
  const [mergeMode, setMergeMode] = useState('replace');
  const [error, setError] = useState(null);

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
    setStep('importing');
    setTimeout(() => {
      onImport(result.people, result.relationships, { merge: mergeMode === 'merge' });
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
          />
        )}

        {step === 'importing' && (
          <div className="gedcom__importing">
            <div className="gedcom__spinner" aria-hidden="true" />
            <p className="gedcom__importing-label">Importing your family tree…</p>
          </div>
        )}

        {step === 'done' && result && (
          <DoneStep
            count={result.people.length}
            mergeMode={mergeMode}
            onClose={() => onClose(result.people[0]?.id ?? null)}
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

function PreviewStep({ result, generations, onGenerations, mergeMode, onMergeMode, error, onFetch, onImport, onBack }) {
  const { people, relationships } = result;
  const partnerCount = relationships.filter((r) => r.type === 'partner').length;
  const parentCount = relationships.filter((r) => r.type === 'parent').length;
  const withDates = people.filter((p) => p.birth_date || p.death_date).length;
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
        <button className="gedcom__back-btn" onClick={onBack}>← Disconnect</button>
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
        {count} {count === 1 ? 'ancestor' : 'ancestors'} imported
      </h3>
      <p className="gedcom__done-sub">
        {mergeMode === 'merge'
          ? 'The new ancestors have been added to your existing tree.'
          : 'Your family tree has been populated with your FamilySearch ancestry.'}
        {' '}Profile portraits and memories aren't part of FamilySearch data, but all
        names, dates, and relationships are in.
      </p>
      <button className="gedcom__import-btn" onClick={onClose}>
        View my tree →
      </button>
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

function CheckIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

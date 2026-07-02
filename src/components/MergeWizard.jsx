import { useState, useEffect, useRef } from 'react';

/*
 * Full-screen wizard shown when a user with their own tree accepts an invitation
 * to join another family's tree. Guides them through matching duplicate people,
 * then merges the data and finalises the join.
 *
 * Flow: loading → intro → match → confirm → merging → done
 */

export default function MergeWizard({ inviteToken, myTree, onComplete }) {
  const [step, setStep] = useState('loading');
  const [theirData, setTheirData] = useState(null);
  const [pairings, setPairings] = useState([]);
  const [error, setError] = useState(null);
  // Snapshot myTree on first render so store updates don't re-trigger the fetch.
  const myTreeRef = useRef(myTree);

  useEffect(() => {
    const snapshot = myTreeRef.current;
    fetch(`/api/merge?invite=${encodeURIComponent(inviteToken)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        setTheirData(data);
        setPairings(suggestPairs(snapshot.people || [], data.tree?.people || []));
        setStep('intro');
      })
      .catch((status) => {
        setError(
          status === 410
            ? 'This invitation has expired. Ask the family to send a new one.'
            : 'Could not load the invitation. Check your connection and try again.',
        );
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteToken]); // myTree intentionally omitted — captured in ref above

  // Builds the tree to submit for a given choice against whatever target-family
  // tree snapshot is passed in — factored out so a 409 retry (below) can
  // recompute against the fresh tree the server sends back, reusing the same
  // pairings the user already reviewed rather than restarting the wizard.
  function computeMergedTree(choice, theirTree) {
    return choice === 'join'
      ? { people: [], relationships: [], memories: [], photos: [], documents: [], ...theirTree }
      : buildMergedTree(myTreeRef.current, theirTree, pairings);
  }

  async function completeMerge(choice) {
    setStep('merging');
    setError(null);
    try {
      let theirTree = theirData.tree || {};
      let baseUpdatedAt = theirData.treeUpdatedAt ?? null;
      let mergedTree = computeMergedTree(choice, theirTree);

      let res = await fetch('/api/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ invite: inviteToken, tree: mergedTree, baseUpdatedAt }),
      });

      // Someone in the target family saved a change while this wizard was
      // open — the server refused to overwrite it (see functions/api/merge.js).
      // Recompute once against the fresh tree it sent back, using the same
      // pairings already reviewed, and retry — this only fails a second time
      // if another save lands in the couple hundred ms the retry itself
      // takes, astronomically unlikely, so one retry is enough.
      if (res.status === 409) {
        const conflictBody = await res.json().catch(() => ({}));
        theirTree = conflictBody.tree || theirTree;
        baseUpdatedAt = conflictBody.treeUpdatedAt ?? null;
        mergedTree = computeMergedTree(choice, theirTree);
        res = await fetch('/api/merge', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ invite: inviteToken, tree: mergedTree, baseUpdatedAt }),
        });
        if (res.status === 409) {
          throw new Error('The family tree kept changing — please try the merge again.');
        }
      }

      if (!res.ok) throw new Error('Server error');
      setStep('done');
      setTimeout(onComplete, 1600);
    } catch (e) {
      setError(e?.message || 'Something went wrong. Please try again.');
      setStep('confirm');
    }
  }

  if (error && step !== 'confirm') {
    return (
      <Scaffold>
        <ErrorIcon />
        <h1 className="mw__title">Something went wrong</h1>
        <p className="mw__sub">{error}</p>
        <button className="mw__btn-primary" onClick={() => { setError(null); setStep('loading'); window.location.reload(); }}>
          Try again
        </button>
      </Scaffold>
    );
  }

  if (step === 'loading') {
    return (
      <Scaffold>
        <Spinner />
        <p className="mw__sub" style={{ marginTop: 16 }}>Loading invitation…</p>
      </Scaffold>
    );
  }

  if (step === 'intro') {
    return (
      <IntroStep
        myTree={myTreeRef.current}
        theirData={theirData}
        onJoin={() => completeMerge('join')}
        onMerge={() => setStep('match')}
      />
    );
  }

  if (step === 'match') {
    return (
      <MatchStep
        pairings={pairings}
        onUpdate={setPairings}
        onNext={() => setStep('confirm')}
        onBack={() => setStep('intro')}
      />
    );
  }

  if (step === 'confirm') {
    return (
      <ConfirmStep
        myTree={myTreeRef.current}
        theirData={theirData}
        pairings={pairings}
        error={error}
        onConfirm={() => completeMerge('merge')}
        onBack={() => { setError(null); setStep('match'); }}
      />
    );
  }

  if (step === 'merging') {
    return (
      <Scaffold>
        <Spinner />
        <h1 className="mw__title" style={{ marginTop: 20 }}>Merging your trees…</h1>
        <p className="mw__sub">This only takes a moment.</p>
      </Scaffold>
    );
  }

  if (step === 'done') {
    return (
      <Scaffold>
        <DoneIcon />
        <h1 className="mw__title">You're in!</h1>
        <p className="mw__sub">
          Welcome to <strong>{theirData?.familyName}</strong>. Your family data has been combined.
        </p>
      </Scaffold>
    );
  }

  return null;
}

// ── Steps ─────────────────────────────────────────────────────────────────────

function IntroStep({ myTree, theirData, onJoin, onMerge }) {
  const myCount = myTree.people?.length || 0;
  const theirCount = theirData.tree?.people?.length || 0;
  const fromName = theirData.fromEmail
    ? theirData.fromEmail.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'Someone';

  return (
    <Scaffold>
      <TreesIcon />
      <h1 className="mw__title">Two trees, one family</h1>
      <p className="mw__sub">
        {fromName} has invited you to join <strong>{theirData.familyName}</strong>.
        {myCount > 0 && (
          <> You already have {myCount} {myCount === 1 ? 'person' : 'people'} in your own tree — let's make sure nobody gets left behind.</>
        )}
      </p>

      <div className="mw__tree-pair">
        <div className="mw__tree-card">
          <div className="mw__tree-count">{myCount}</div>
          <div className="mw__tree-label">Your tree</div>
        </div>
        <div className="mw__tree-plus">
          <PlusIcon />
        </div>
        <div className="mw__tree-card mw__tree-card--theirs">
          <div className="mw__tree-count">{theirCount}</div>
          <div className="mw__tree-label">{theirData.familyName}</div>
        </div>
      </div>

      <button className="mw__btn-primary" onClick={onMerge}>
        Review and merge
        <ChevronIcon />
      </button>
      <button className="mw__btn-ghost" onClick={onJoin}>
        Skip — just join their tree
      </button>
      <p className="mw__fine">Skipping will replace your tree with theirs.</p>
    </Scaffold>
  );
}

function MatchStep({ pairings, onUpdate, onNext, onBack }) {
  const suggested = pairings.filter((p) => p.theirPerson);
  const additions = pairings.filter((p) => !p.theirPerson);

  function toggle(idx) {
    onUpdate(pairings.map((p, i) => (i === idx ? { ...p, accepted: !p.accepted } : p)));
  }

  return (
    <Scaffold scrollable>
      <div className="mw__step-label">Step 1 of 2</div>
      <h1 className="mw__title">Are these the same person?</h1>
      <p className="mw__sub">We found some people who appear in both trees. Confirm the ones that match.</p>

      {suggested.length === 0 && (
        <p className="mw__sub" style={{ textAlign: 'center', padding: '16px 0' }}>
          No overlapping people found — everyone will be added as new.
        </p>
      )}

      <div className="mw__matches">
        {suggested.map((pair, i) => {
          const globalIdx = pairings.indexOf(pair);
          return (
            <div key={i} className={`mw__match ${pair.accepted ? 'mw__match--on' : ''}`}>
              <PersonChip person={pair.myPerson} side="mine" />
              <button className="mw__match-toggle" onClick={() => toggle(globalIdx)}>
                {pair.accepted ? <SameIcon /> : <DiffIcon />}
                <span>{pair.accepted ? 'Same' : 'Different'}</span>
              </button>
              <PersonChip person={pair.theirPerson} side="theirs" />
            </div>
          );
        })}
      </div>

      {additions.length > 0 && (
        <div className="mw__additions">
          <div className="mw__additions-label">
            Also adding {additions.length} {additions.length === 1 ? 'person' : 'people'} only in your tree
          </div>
          <div className="mw__chips">
            {additions.map((p) => (
              <span key={p.myPerson.id} className="mw__chip">{p.myPerson.display_name}</span>
            ))}
          </div>
        </div>
      )}

      <div className="mw__footer">
        <button className="mw__btn-primary" onClick={onNext}>
          Confirm
          <ChevronIcon />
        </button>
        <button className="mw__btn-ghost" onClick={onBack}>
          Back
        </button>
      </div>
    </Scaffold>
  );
}

function ConfirmStep({ myTree, theirData, pairings, error, onConfirm, onBack }) {
  const matched = pairings.filter((p) => p.theirPerson && p.accepted).length;
  const added = pairings.filter((p) => !p.theirPerson || !p.accepted).length;
  const memories = myTree.memories?.length || 0;
  const photos = myTree.photos?.length || 0;

  return (
    <Scaffold>
      <div className="mw__step-label">Step 2 of 2</div>
      <h1 className="mw__title">Ready to merge</h1>
      <p className="mw__sub">
        Here's what will happen when you complete the merge into <strong>{theirData.familyName}</strong>.
      </p>

      <div className="mw__summary">
        {matched > 0 && (
          <div className="mw__summary-row">
            <CheckIcon />
            <span>{matched} {matched === 1 ? 'person' : 'people'} matched and merged</span>
          </div>
        )}
        {added > 0 && (
          <div className="mw__summary-row">
            <PlusFilledIcon />
            <span>{added} {added === 1 ? 'person' : 'people'} from your tree added</span>
          </div>
        )}
        {memories > 0 && (
          <div className="mw__summary-row">
            <MemoryIcon />
            <span>{memories} {memories === 1 ? 'memory' : 'memories'} carried over</span>
          </div>
        )}
        {photos > 0 && (
          <div className="mw__summary-row">
            <PhotoIcon />
            <span>{photos} {photos === 1 ? 'photo' : 'photos'} carried over</span>
          </div>
        )}
      </div>

      {error && <p className="mw__error">{error}</p>}

      <button className="mw__btn-primary" onClick={onConfirm}>
        Complete merge
        <ChevronIcon />
      </button>
      <button className="mw__btn-ghost" onClick={onBack}>
        Back
      </button>
    </Scaffold>
  );
}

// ── Layout shell ───────────────────────────────────────────────────────────────

function Scaffold({ children, scrollable }) {
  return (
    <div className="mw-overlay">
      <div className={`mw-card${scrollable ? ' mw-card--scroll' : ''}`}>
        <div className="mw-brand">
          <BrandIcon />
          <span>Bloodline</span>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Person display chip ────────────────────────────────────────────────────────

function PersonChip({ person, side }) {
  const { base, light } = monogramColors(person.display_name);
  const initials_ = initials(person.display_name);
  return (
    <div className={`mw__person ${side === 'theirs' ? 'mw__person--theirs' : ''}`}>
      <span
        className="mw__person-avatar"
        style={{ background: `linear-gradient(160deg, ${light}, ${base})` }}
        aria-hidden="true"
      >
        {initials_}
      </span>
      <span className="mw__person-name">{person.display_name}</span>
      {person.birth_date && (
        <span className="mw__person-year">b. {person.birth_date.slice(0, 4)}</span>
      )}
    </div>
  );
}

// ── Dedup + merge algorithms ──────────────────────────────────────────────────

function normName(n) {
  return (n || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

function scorePair(a, b) {
  const an = normName(a.display_name), bn = normName(b.display_name);
  if (!an || !bn) return 0;
  if (an === bn) return 1.0;
  const ap = an.split(' '), bp = bn.split(' ');
  let s = 0;
  if (ap[0] === bp[0]) s += 0.4;
  if (ap.at(-1) === bp.at(-1)) s += 0.2;
  const ay = (a.birth_date || '').slice(0, 4);
  const by_ = (b.birth_date || '').slice(0, 4);
  if (ay && by_) {
    if (ay === by_) s += 0.4;
    else if (Math.abs(Number(ay) - Number(by_)) <= 1) s += 0.2;
  }
  if (a.gender && b.gender && a.gender === b.gender) s += 0.05;
  return Math.min(s, 0.99);
}

function suggestPairs(myPeople, theirPeople) {
  const used = new Set();
  return myPeople.map((mine) => {
    let best = 0, match = null;
    for (const theirs of theirPeople) {
      if (used.has(theirs.id)) continue;
      const s = scorePair(mine, theirs);
      if (s > best) { best = s; match = theirs; }
    }
    if (best >= 0.6 && match) {
      used.add(match.id);
      return { myPerson: mine, theirPerson: match, score: best, accepted: best >= 0.9 };
    }
    return { myPerson: mine, theirPerson: null, score: 0, accepted: false };
  });
}

const rnd = (pfx) => pfx + Math.random().toString(36).slice(2, 9);

function buildMergedTree(myTree, theirTree, pairings) {
  const merged = structuredClone(theirTree);
  merged.people = merged.people || [];
  merged.relationships = merged.relationships || [];
  merged.memories = merged.memories || [];
  merged.photos = merged.photos || [];
  merged.documents = merged.documents || [];

  const idMap = new Map(); // myPersonId → finalPersonId

  for (const { myPerson, theirPerson, accepted } of pairings) {
    if (theirPerson && accepted) {
      idMap.set(myPerson.id, theirPerson.id);
      // Fill empty fields in their person with data from mine.
      const tp = merged.people.find((p) => p.id === theirPerson.id);
      if (tp) {
        for (const [k, v] of Object.entries(myPerson)) {
          if (k === 'id' || Array.isArray(v)) continue;
          if (v != null && v !== '' && (tp[k] == null || tp[k] === '')) tp[k] = v;
        }
        if (myPerson.tags?.length) {
          tp.tags = [...new Set([...(tp.tags || []), ...myPerson.tags])];
        }
        if (myPerson.events?.length) {
          const eKeys = new Set((tp.events || []).map((e) => `${e.year}|${e.title}`));
          for (const ev of myPerson.events) {
            if (!eKeys.has(`${ev.year}|${ev.title}`)) {
              (tp.events = tp.events || []).push(ev);
            }
          }
        }
      }
    } else {
      const newId = rnd('p_');
      idMap.set(myPerson.id, newId);
      merged.people.push({ ...myPerson, id: newId });
    }
  }

  // Any myTree people not in pairings (safety net).
  const pairedMyIds = new Set(pairings.map((p) => p.myPerson.id));
  for (const p of myTree.people || []) {
    if (!pairedMyIds.has(p.id) && !idMap.has(p.id)) {
      const newId = rnd('p_');
      idMap.set(p.id, newId);
      merged.people.push({ ...p, id: newId });
    }
  }

  // Port relationships, deduplicating by type+from+to.
  const relKeys = new Set(
    merged.relationships.map((r) => `${r.type}|${r.from_person}|${r.to_person}`),
  );
  for (const rel of myTree.relationships || []) {
    const from = idMap.get(rel.from_person);
    const to = idMap.get(rel.to_person);
    if (!from || !to) continue;
    const key = `${rel.type}|${from}|${to}`;
    if (!relKeys.has(key)) {
      merged.relationships.push({ ...rel, id: rnd('r_'), from_person: from, to_person: to });
      relKeys.add(key);
    }
  }

  for (const m of myTree.memories || []) {
    const personId = idMap.get(m.person_id);
    if (personId) merged.memories.push({ ...m, id: rnd('m_'), person_id: personId });
  }
  for (const ph of myTree.photos || []) {
    const personId = idMap.get(ph.person_id);
    if (personId) merged.photos.push({ ...ph, id: rnd('ph_'), person_id: personId });
  }
  for (const doc of myTree.documents || []) {
    const personId = idMap.get(doc.person_id);
    if (personId) merged.documents.push({ ...doc, id: rnd('doc_'), person_id: personId });
  }

  // Remap the joining user's self-reference so their identity is preserved in
  // the merged tree (used for relationship labels and the active focus default).
  if (myTree.myPersonId) {
    const remapped = idMap.get(myTree.myPersonId);
    if (remapped) merged.myPersonId = remapped;
  }

  return merged;
}

// ── Monogram helpers (duplicated from color.js to keep this self-contained) ───

function monogramColors(name) {
  const palettes = [
    { base: '#c2603a', light: '#e8b9a6' },
    { base: '#4a7c59', light: '#a8c9b0' },
    { base: '#5b6ea8', light: '#b3bede' },
    { base: '#8b5e3c', light: '#c9a882' },
    { base: '#7a4f7a', light: '#c3a0c3' },
    { base: '#3a7a8b', light: '#8ac3cc' },
  ];
  const idx = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % palettes.length;
  return palettes[idx];
}

function initials(name) {
  const parts = (name || '?').trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function BrandIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 56 56" fill="none" aria-hidden="true">
      <circle cx="28" cy="14" r="10" fill="#c2603a" />
      <circle cx="14" cy="40" r="8" fill="#c2603a" opacity="0.7" />
      <circle cx="42" cy="40" r="8" fill="#c2603a" opacity="0.5" />
      <line x1="28" y1="24" x2="14" y2="32" stroke="#c2603a" strokeWidth="2.5" opacity="0.6" />
      <line x1="28" y1="24" x2="42" y2="32" stroke="#c2603a" strokeWidth="2.5" opacity="0.6" />
    </svg>
  );
}

function TreesIcon() {
  return (
    <div className="mw__hero-icon">
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <circle cx="16" cy="12" r="8" fill="#c2603a" opacity="0.9" />
        <circle cx="8" cy="40" r="6" fill="#c2603a" opacity="0.55" />
        <circle cx="24" cy="40" r="6" fill="#c2603a" opacity="0.55" />
        <line x1="16" y1="20" x2="8" y2="34" stroke="#c2603a" strokeWidth="2" opacity="0.5" />
        <line x1="16" y1="20" x2="24" y2="34" stroke="#c2603a" strokeWidth="2" opacity="0.5" />
        <circle cx="48" cy="12" r="8" fill="#5b6ea8" opacity="0.9" />
        <circle cx="40" cy="40" r="6" fill="#5b6ea8" opacity="0.55" />
        <circle cx="56" cy="40" r="6" fill="#5b6ea8" opacity="0.55" />
        <line x1="48" y1="20" x2="40" y2="34" stroke="#5b6ea8" strokeWidth="2" opacity="0.5" />
        <line x1="48" y1="20" x2="56" y2="34" stroke="#5b6ea8" strokeWidth="2" opacity="0.5" />
        <path d="M28 30h8" stroke="#c2603a" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      </svg>
    </div>
  );
}

function ErrorIcon() {
  return (
    <div className="mw__hero-icon mw__hero-icon--warn">
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 9v4M12 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function DoneIcon() {
  return (
    <div className="mw__hero-icon mw__hero-icon--done">
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 12l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function Spinner() {
  return <div className="mw__spinner" aria-label="Loading" />;
}

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SameIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#c2603a" />
      <path d="M8 12l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DiffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 12h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#4a7c59" opacity="0.15" />
      <path d="M8 12l3 3 5-5" stroke="#4a7c59" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusFilledIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#5b6ea8" opacity="0.15" />
      <path d="M12 8v8M8 12h8" stroke="#5b6ea8" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function MemoryIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="var(--ink-soft)" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function PhotoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke="var(--ink-soft)" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="4" stroke="var(--ink-soft)" strokeWidth="1.7" />
    </svg>
  );
}

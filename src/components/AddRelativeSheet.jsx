import { useEffect, useRef, useState, useMemo } from 'react';
import { RELATIONSHIPS, QUALIFIER_KEYS, bioParentGendersFilled } from '../data/store.js';

const QUALIFIERS = [
  { key: 'biological', label: 'Biological' },
  { key: 'step', label: 'Step' },
  { key: 'adoptive', label: 'Adopted' },
];

// Relationship types that support linking to an already-existing person.
const LINKABLE = new Set(['partner', 'ex_partner', 'mother', 'father', 'son', 'daughter', 'brother', 'sister']);

/*
 * Relationship-first add (§4): the only required answer is *who* they are to
 * the anchor person and their name — three seconds. Everything else (dates,
 * birthplace, occupation, deceased, tags...) lives in the one real profile
 * form (EditPersonSheet) — "Add & edit details" creates the person then opens
 * it immediately, rather than duplicating a slice of those fields in here.
 *
 * When the relationship type is linkable, a toggle lets the user pick an
 * existing person from the tree instead of creating a new one.
 */
export default function AddRelativeSheet({ anchor, people = [], relationships = [], onClose, onAdd, onLinkExisting }) {
  const [relKey, setRelKey] = useState(null);
  const [qualifier, setQualifier] = useState('biological');
  const [mode, setMode] = useState('new'); // 'new' | 'existing'
  const [given, setGiven] = useState('');
  const [middle, setMiddle] = useState('');
  const [family, setFamily] = useState('');
  const [search, setSearch] = useState('');
  const [coParentStatus, setCoParentStatus] = useState(null); // 'partner' | 'ex_partner'
  const nameRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Reset mode to 'new' when relationship type changes.
  const pickRel = (key) => {
    setRelKey(key);
    setQualifier('biological');
    setMode('new');
    setSearch('');
    setCoParentStatus(null);
  };

  // Adding a mother while a father is already linked (or vice versa) — find
  // that existing co-parent so we can ask how the two of them relate. Without
  // this, addRelative()/setRelationshipKind() never link the two parents to
  // each other at all: no partner edge means no couple pod in the tree (see
  // links.js, which requires one) and the pair silently renders as two
  // disconnected single parents.
  const coParent = useMemo(() => {
    if (relKey !== 'mother' && relKey !== 'father') return null;
    const otherGender = relKey === 'mother' ? 'male' : 'female';
    for (const r of relationships) {
      if (r.type !== 'parent' || r.to_person !== anchor.id) continue;
      const p = people.find((x) => x.id === r.from_person);
      if (p?.gender === otherGender) return p;
    }
    return null;
  }, [relKey, relationships, people, anchor.id]);

  // Which bio-parent genders are already filled for the anchor.
  const filledGenders = useMemo(() => bioParentGendersFilled
    ? bioParentGendersFilled(anchor.id)
    : new Set(), [anchor.id]);

  // A relationship chip is disabled if adding it would violate a bio constraint.
  const isDisabled = (r) => {
    if (r.key === 'mother' && filledGenders.has('female')) return true;
    if (r.key === 'father' && filledGenders.has('male')) return true;
    return false;
  };

  // The existing DIRECT relationship between the anchor and a candidate, if any,
  // so the picker can show it and the user understands selecting will reassign.
  const directRelation = (candId) => {
    for (const r of relationships) {
      if (r.type === 'partner' &&
        ((r.from_person === anchor.id && r.to_person === candId) ||
         (r.from_person === candId && r.to_person === anchor.id))) {
        return r.partner_status === 'former' ? 'ex-partner' : 'partner';
      }
      if (r.type === 'parent' && r.from_person === anchor.id && r.to_person === candId) return 'child';
      if (r.type === 'parent' && r.from_person === candId && r.to_person === anchor.id) return 'parent';
    }
    return null;
  };

  // Candidates for link-existing mode: everyone but the anchor, filtered by
  // search across their names. Already-linked people ARE shown (with their
  // current relationship) so a wrong link can be corrected here.
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter((p) => {
      if (p.id === anchor.id) return false;
      if (!q) return true;
      const hay = `${p.display_name} ${p.birth_name || ''} ${p.given_names || ''} ${p.family_name || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [people, search, anchor.id]);

  const needsCoParentAnswer = !!coParent && !coParentStatus;
  const canAdd = relKey && given.trim().length > 0 && !needsCoParentAnswer;
  const canLink = relKey && mode === 'existing' && !needsCoParentAnswer;

  const submit = (openDetails = false) => {
    if (!canAdd) return;
    onAdd({
      relKey,
      qualifier: QUALIFIER_KEYS.has(relKey) ? qualifier : 'biological',
      given: given.trim(),
      middle: middle.trim(),
      family: family.trim(),
      coParentId: coParent?.id || null,
      coParentStatus: coParent ? coParentStatus : null,
      openDetails,
    });
  };

  const linkTo = (personId) => {
    // Map relKey to the edge type expected by addRelationship.
    const type = relKey === 'partner' ? 'partner'
      : relKey === 'ex_partner' ? 'ex_partner'
      : (relKey === 'mother' || relKey === 'father') ? 'parent'
      : (relKey === 'son' || relKey === 'daughter') ? 'parent'
      : null;
    if (!type) return;
    // For parent edges the direction matters: parent is from_person, child is to_person.
    // When relKey is mother/father the existing person IS the parent of anchor.
    // When relKey is son/daughter the anchor IS the parent, existing is the child.
    if (relKey === 'mother' || relKey === 'father') {
      onLinkExisting?.(personId, type); // addRelationship(anchor, existing, 'parent') → existing is parent of anchor
      // But we need existing as parent → pass a flag via a wrapper that swaps the direction.
      // Simplest: use a different callback convention.
    } else {
      onLinkExisting?.(personId, type);
    }
  };

  const linkToExisting = (personId) => {
    if (!canLink) return;
    const q = QUALIFIER_KEYS.has(relKey) ? qualifier : 'biological';
    onLinkExisting?.(personId, relKey, q, coParent?.id || null, coParent ? coParentStatus : null);
  };

  const firstName = anchor.display_name.split(/\s+/)[0];
  const showLinkToggle = relKey && LINKABLE.has(relKey) && people.length > 0;

  return (
    <div className="sheet-scrim sheet-scrim--modal" onClick={onClose}>
      <section
        className="sheet sheet--form"
        role="dialog"
        aria-modal="true"
        aria-label={`Add a relative of ${anchor.display_name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="form__head">
          <h2>Add to {firstName}&apos;s family</h2>
          <p className="form__sub">Who are they to {firstName}?</p>
        </header>

        <div className="chipgrid" role="radiogroup" aria-label="Relationship">
          {RELATIONSHIPS.map((r) => {
            const disabled = isDisabled(r);
            return (
              <button
                key={r.key}
                role="radio"
                aria-checked={relKey === r.key}
                aria-disabled={disabled}
                className={'chip' + (relKey === r.key ? ' chip--on' : '') + (disabled ? ' chip--disabled' : '')}
                onClick={() => !disabled && pickRel(r.key)}
                title={disabled ? `${firstName} already has a biological ${r.label.toLowerCase()}` : undefined}
              >
                {r.label}
              </button>
            );
          })}
        </div>

        {/* Mode toggle: new person vs link existing */}
        {showLinkToggle && (
          <div className="mode-toggle" role="group" aria-label="Add mode">
            <button
              className={'mode-tab' + (mode === 'new' ? ' mode-tab--on' : '')}
              onClick={() => { setMode('new'); setSearch(''); }}
            >
              New person
            </button>
            <button
              className={'mode-tab' + (mode === 'existing' ? ' mode-tab--on' : '')}
              onClick={() => { setMode('existing'); setTimeout(() => searchRef.current?.focus(), 50); }}
            >
              Already in tree
            </button>
          </div>
        )}

        {QUALIFIER_KEYS.has(relKey) && (
          <div className="qualifier-row" role="radiogroup" aria-label="Qualifier">
            {QUALIFIERS.map((q) => (
              <button
                key={q.key}
                role="radio"
                aria-checked={qualifier === q.key}
                className={'qualifier-chip' + (qualifier === q.key ? ' qualifier-chip--on' : '')}
                onClick={() => setQualifier(q.key)}
              >
                {q.label}
              </button>
            ))}
          </div>
        )}

        {coParent && (
          <div className="coparent-row" role="radiogroup" aria-label="Relationship between parents">
            <p className="coparent-row__label">
              Are {given.trim() || 'they'} and {coParent.display_name.split(/\s+/)[0]} partners, or ex-partners?
            </p>
            <div className="qualifier-row">
              <button
                role="radio"
                aria-checked={coParentStatus === 'partner'}
                className={'qualifier-chip' + (coParentStatus === 'partner' ? ' qualifier-chip--on' : '')}
                onClick={() => setCoParentStatus('partner')}
              >
                Partners
              </button>
              <button
                role="radio"
                aria-checked={coParentStatus === 'ex_partner'}
                className={'qualifier-chip' + (coParentStatus === 'ex_partner' ? ' qualifier-chip--on' : '')}
                onClick={() => setCoParentStatus('ex_partner')}
              >
                Ex-partners
              </button>
            </div>
          </div>
        )}

        {/* New person form */}
        {mode === 'new' && (
          <div className={'form__reveal' + (relKey ? ' form__reveal--open' : '')}>
            <div className="field-row">
              <label className="field">
                <span className="field__label">First name</span>
                <div className="input-wrap">
                  <input
                    ref={nameRef}
                    className="field__input"
                    value={given}
                    onChange={(e) => setGiven(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submit()}
                    placeholder="e.g. Margaret"
                    autoComplete="off"
                  />
                  {given && <button type="button" className="input-clear" onClick={() => setGiven('')} aria-label="Clear" tabIndex={-1}>×</button>}
                </div>
              </label>
              <label className="field">
                <span className="field__label">Middle name <span className="field__label-sub">optional</span></span>
                <div className="input-wrap">
                  <input
                    className="field__input"
                    value={middle}
                    onChange={(e) => setMiddle(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submit()}
                    placeholder="e.g. Anne"
                    autoComplete="off"
                  />
                  {middle && <button type="button" className="input-clear" onClick={() => setMiddle('')} aria-label="Clear" tabIndex={-1}>×</button>}
                </div>
              </label>
            </div>
            <label className="field">
              <span className="field__label">Family name</span>
              <div className="input-wrap">
                <input
                  className="field__input"
                  value={family}
                  onChange={(e) => setFamily(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                  placeholder="e.g. Davies"
                  autoComplete="off"
                />
                {family && <button type="button" className="input-clear" onClick={() => setFamily('')} aria-label="Clear" tabIndex={-1}>×</button>}
              </div>
            </label>
          </div>
        )}

        {/* Link existing person picker */}
        {mode === 'existing' && relKey && (
          <div className="link-existing">
            <div className="input-wrap link-existing__search">
              <input
                ref={searchRef}
                className="field__input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name…"
                autoComplete="off"
              />
              {search && <button type="button" className="input-clear" onClick={() => setSearch('')} aria-label="Clear" tabIndex={-1}>×</button>}
            </div>
            <ul className="link-existing__list" role="listbox">
              {candidates.length === 0 && (
                <li className="link-existing__empty">No matching people found</li>
              )}
              {candidates.map((p) => {
                const current = directRelation(p.id);
                return (
                  <li key={p.id} role="option">
                    <button
                      className="link-existing__item"
                      disabled={!canLink}
                      onClick={() => linkToExisting(p.id)}
                    >
                      <span className="link-existing__name">{p.display_name}</span>
                      {current && <span className="link-existing__current">currently {current}</span>}
                      {p.birth_date && <span className="link-existing__date">b. {p.birth_date}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <footer className="sheet__foot">
          {mode === 'new' ? (
            <>
              <button className="btn btn--primary" disabled={!canAdd} onClick={() => submit(false)}>
                {given.trim() ? `Add ${given.trim()}` : 'Add'}
              </button>
              <button className="btn" disabled={!canAdd} onClick={() => submit(true)}>
                Add &amp; edit details
              </button>
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

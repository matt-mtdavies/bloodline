import { useEffect, useRef, useState, useMemo } from 'react';
import { RELATIONSHIPS, QUALIFIER_KEYS, bioParentGendersFilled } from '../data/store.js';
import DateField from './DateField.jsx';

const QUALIFIERS = [
  { key: 'biological', label: 'Biological' },
  { key: 'step', label: 'Step' },
  { key: 'adoptive', label: 'Adopted' },
];

const GENDER_OPTIONS = ['Male', 'Female', 'Non-binary', 'Other'];
const TODAY = new Date().toISOString().slice(0, 10);

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
export default function AddRelativeSheet({ anchor, people = [], relationships = [], graph, onClose, onAdd, onLinkExisting }) {
  const [relKey, setRelKey] = useState(null);
  const [qualifier, setQualifier] = useState('biological');
  const [mode, setMode] = useState('new'); // 'new' | 'existing'
  const [given, setGiven] = useState('');
  const [middle, setMiddle] = useState('');
  const [family, setFamily] = useState('');
  const [search, setSearch] = useState('');
  const [coParentStatus, setCoParentStatus] = useState(null); // 'partner' | 'ex_partner'
  // The rest of what a real record needs, captured up front instead of left
  // for a later edit that often never happens (see the sheet's own comment
  // below on why this still isn't the FULL profile form).
  const [gender, setGender] = useState(''); // only asked for partner/ex-partner — every other type implies it
  const [birthName, setBirthName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [birthPlace, setBirthPlace] = useState('');
  const [residence, setResidence] = useState('');
  const [isDeceased, setIsDeceased] = useState(false);
  const [deathDate, setDeathDate] = useState('');
  // Marriage details for a new partner/ex-partner, captured here rather than
  // left for the buried per-relationship "manage" menu on the profile
  // (feedback: "there is a married component... but it's not obvious").
  // Separation date is independent of isMarried — an ex-partner relationship
  // can have ended whether or not they were ever married.
  const [isMarried, setIsMarried] = useState(false);
  const [marriageDate, setMarriageDate] = useState('');
  const [separationDate, setSeparationDate] = useState('');
  // A biological child's other parent: silent when the anchor has exactly one
  // partner on record (today's frictionless case, unchanged); an explicit
  // chip choice the moment there's more than one, so a new child is never
  // handed every partner the anchor has ever had as a "biological" parent.
  const [childCoParentMode, setChildCoParentMode] = useState(null); // null | 'existing' | 'none' | 'new'
  const [childCoParentId, setChildCoParentId] = useState(null);
  const [childCoParentGiven, setChildCoParentGiven] = useState('');
  const [childCoParentFamily, setChildCoParentFamily] = useState('');
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
    const meta = RELATIONSHIPS.find((r) => r.key === key);
    setGender(meta?.gender === 'male' ? 'Male' : meta?.gender === 'female' ? 'Female' : '');
    setBirthName('');
    setBirthDate('');
    setBirthPlace('');
    setResidence('');
    setIsDeceased(false);
    setDeathDate('');
    setIsMarried(false);
    setMarriageDate('');
    setSeparationDate('');
    setChildCoParentMode(null);
    setChildCoParentId(null);
    setChildCoParentGiven('');
    setChildCoParentFamily('');
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

  // The flip side, for a biological son/daughter: who (if anyone already on
  // record) is the child's other parent? Every partner the anchor has EVER
  // had is a candidate — including exes, since a child from a past
  // relationship is exactly the honest case this replaces "assume all of
  // them" with. Silent (no picker shown) when there's exactly one, since
  // that's unambiguous; an explicit choice the moment there's more than one.
  const childCoParentCandidates = useMemo(() => {
    if (!graph || (relKey !== 'son' && relKey !== 'daughter') || qualifier !== 'biological') return [];
    return graph.partners(anchor.id).map((p) => graph.byId.get(p.id)).filter(Boolean);
  }, [graph, relKey, qualifier, anchor.id]);

  useEffect(() => {
    if (childCoParentCandidates.length === 1 && childCoParentMode == null) {
      setChildCoParentMode('existing');
      setChildCoParentId(childCoParentCandidates[0].id);
    }
  }, [childCoParentCandidates, childCoParentMode]);

  const needsChildCoParentAnswer = childCoParentCandidates.length > 1 && (
    childCoParentMode == null ||
    (childCoParentMode === 'new' && !childCoParentGiven.trim())
  );

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
      const hay = `${p.display_name} ${p.birth_name || ''} ${p.middle_name || ''} ${p.given_names || ''} ${p.family_name || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [people, search, anchor.id]);

  const needsCoParentAnswer = !!coParent && !coParentStatus;
  const canAdd = relKey && given.trim().length > 0 && !needsCoParentAnswer && !needsChildCoParentAnswer;
  const canLink = relKey && mode === 'existing' && !needsCoParentAnswer;

  const submit = (openDetails = false) => {
    if (!canAdd) return;
    onAdd({
      relKey,
      qualifier: QUALIFIER_KEYS.has(relKey) ? qualifier : 'biological',
      given: given.trim(),
      middle: middle.trim(),
      family: family.trim(),
      birth_name: birthName.trim(),
      gender: (relKey === 'partner' || relKey === 'ex_partner') ? (gender || null) : null,
      birth_date: birthDate.trim(),
      birth_place: birthPlace.trim(),
      residence: residence.trim(),
      is_deceased: isDeceased,
      death_date: isDeceased ? deathDate.trim() : '',
      is_married: (relKey === 'partner' || relKey === 'ex_partner') ? isMarried : false,
      marriage_date: (relKey === 'partner' || relKey === 'ex_partner') && isMarried ? marriageDate.trim() : '',
      separation_date: relKey === 'ex_partner' ? separationDate.trim() : '',
      coParentId: coParent?.id || null,
      coParentStatus: coParent ? coParentStatus : null,
      childCoParentMode,
      childCoParentId: childCoParentMode === 'existing' ? childCoParentId : null,
      childCoParentNew: childCoParentMode === 'new'
        ? { given: childCoParentGiven.trim(), family: childCoParentFamily.trim() }
        : null,
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
                onClick={() => {
                  setQualifier(q.key);
                  setChildCoParentMode(null);
                  setChildCoParentId(null);
                  setChildCoParentGiven('');
                  setChildCoParentFamily('');
                }}
              >
                {q.label}
              </button>
            ))}
          </div>
        )}

        {/* Who's the other biological parent? Only surfaces once there's a
            real choice to make (the anchor has 2+ partners on record) —
            exactly one candidate is applied silently, above. */}
        {childCoParentCandidates.length > 1 && (
          <div className="coparent-row" role="radiogroup" aria-label="Who's the other parent">
            <p className="coparent-row__label">
              Who's {given.trim() || 'their'} other parent?
            </p>
            <div className="qualifier-row">
              {childCoParentCandidates.map((c) => (
                <button
                  key={c.id}
                  role="radio"
                  aria-checked={childCoParentMode === 'existing' && childCoParentId === c.id}
                  className={'qualifier-chip' + (childCoParentMode === 'existing' && childCoParentId === c.id ? ' qualifier-chip--on' : '')}
                  onClick={() => { setChildCoParentMode('existing'); setChildCoParentId(c.id); }}
                >
                  {c.display_name.split(/\s+/)[0]}
                </button>
              ))}
              <button
                role="radio"
                aria-checked={childCoParentMode === 'new'}
                className={'qualifier-chip' + (childCoParentMode === 'new' ? ' qualifier-chip--on' : '')}
                onClick={() => { setChildCoParentMode('new'); setChildCoParentId(null); }}
              >
                Someone not in the tree
              </button>
              <button
                role="radio"
                aria-checked={childCoParentMode === 'none'}
                className={'qualifier-chip' + (childCoParentMode === 'none' ? ' qualifier-chip--on' : '')}
                onClick={() => { setChildCoParentMode('none'); setChildCoParentId(null); }}
              >
                Skip for now
              </button>
            </div>
            {childCoParentMode === 'new' && (
              <div className="field-row coparent-row__new">
                <label className="field">
                  <span className="field__label">Their first name</span>
                  <div className="input-wrap">
                    <input
                      className="field__input"
                      value={childCoParentGiven}
                      onChange={(e) => setChildCoParentGiven(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                </label>
                <label className="field">
                  <span className="field__label">Family name <span className="field__label-sub">optional</span></span>
                  <div className="input-wrap">
                    <input
                      className="field__input"
                      value={childCoParentFamily}
                      onChange={(e) => setChildCoParentFamily(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                </label>
              </div>
            )}
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

            <label className="field">
              <span className="field__label">Birth name <span className="field__label-sub">/ maiden name</span></span>
              <div className="input-wrap">
                <input
                  className="field__input"
                  value={birthName}
                  onChange={(e) => setBirthName(e.target.value)}
                  placeholder="If different from current name"
                  autoComplete="off"
                />
                {birthName && <button type="button" className="input-clear" onClick={() => setBirthName('')} aria-label="Clear" tabIndex={-1}>×</button>}
              </div>
            </label>

            {(relKey === 'partner' || relKey === 'ex_partner') ? (
              <div className="field-row">
                <label className="field">
                  <span className="field__label">Date of birth</span>
                  <div className="input-wrap dob-wrap">
                    <DateField value={birthDate} max={TODAY} onChange={setBirthDate} />
                    {birthDate && <button type="button" className="input-clear" onClick={() => setBirthDate('')} aria-label="Clear" tabIndex={-1}>×</button>}
                  </div>
                </label>
                <label className="field">
                  <span className="field__label">Gender</span>
                  <div className="pill-pick pill-pick--gender">
                    {GENDER_OPTIONS.map((g) => (
                      <button
                        key={g}
                        type="button"
                        className={`pill-pick__opt${gender === g ? ' pill-pick__opt--on' : ''}`}
                        onClick={() => setGender((cur) => (cur === g ? '' : g))}
                      >{g}</button>
                    ))}
                  </div>
                </label>
              </div>
            ) : (
              <label className="field">
                <span className="field__label">Date of birth</span>
                <div className="input-wrap dob-wrap">
                  <DateField value={birthDate} max={TODAY} onChange={setBirthDate} />
                  {birthDate && <button type="button" className="input-clear" onClick={() => setBirthDate('')} aria-label="Clear" tabIndex={-1}>×</button>}
                </div>
              </label>
            )}

            <div className="field-row">
              <label className="field">
                <span className="field__label">Birthplace</span>
                <div className="input-wrap">
                  <input
                    className="field__input"
                    value={birthPlace}
                    onChange={(e) => setBirthPlace(e.target.value)}
                    placeholder="e.g. Cardiff, Wales"
                    autoComplete="off"
                  />
                  {birthPlace && <button type="button" className="input-clear" onClick={() => setBirthPlace('')} aria-label="Clear" tabIndex={-1}>×</button>}
                </div>
              </label>
              <label className="field">
                <span className="field__label">Lives in</span>
                <div className="input-wrap">
                  <input
                    className="field__input"
                    value={residence}
                    onChange={(e) => setResidence(e.target.value)}
                    placeholder="City, Country"
                    autoComplete="off"
                  />
                  {residence && <button type="button" className="input-clear" onClick={() => setResidence('')} aria-label="Clear" tabIndex={-1}>×</button>}
                </div>
              </label>
            </div>

            <label className="toggle">
              <input
                type="checkbox"
                checked={isDeceased}
                onChange={(e) => setIsDeceased(e.target.checked)}
              />
              <span>No longer with us</span>
            </label>
            {isDeceased && (
              <label className="field">
                <span className="field__label">Date passed</span>
                <div className="input-wrap dob-wrap">
                  <DateField value={deathDate} max={TODAY} onChange={setDeathDate} />
                  {deathDate && <button type="button" className="input-clear" onClick={() => setDeathDate('')} aria-label="Clear" tabIndex={-1}>×</button>}
                </div>
              </label>
            )}

            {/* Marriage details, captured here rather than left for the
                per-relationship "manage" menu on the profile — same
                deliberate exception to "everything else lives in the edit
                form" as birthplace/residence/deceased above. */}
            {(relKey === 'partner' || relKey === 'ex_partner') && (
              <>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={isMarried}
                    onChange={(e) => setIsMarried(e.target.checked)}
                  />
                  <span>{relKey === 'ex_partner' ? 'They were married' : 'They married'}</span>
                </label>
                {isMarried && (
                  <label className="field">
                    <span className="field__label">Marriage date</span>
                    <div className="input-wrap dob-wrap">
                      <DateField value={marriageDate} max={TODAY} onChange={setMarriageDate} />
                      {marriageDate && <button type="button" className="input-clear" onClick={() => setMarriageDate('')} aria-label="Clear" tabIndex={-1}>×</button>}
                    </div>
                  </label>
                )}
                {relKey === 'ex_partner' && (
                  <label className="field">
                    <span className="field__label">Year separated <span className="field__label-sub">optional</span></span>
                    <div className="input-wrap dob-wrap">
                      <DateField value={separationDate} max={TODAY} onChange={setSeparationDate} />
                      {separationDate && <button type="button" className="input-clear" onClick={() => setSeparationDate('')} aria-label="Clear" tabIndex={-1}>×</button>}
                    </div>
                  </label>
                )}
              </>
            )}
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
                      <span className="link-existing__namewrap">
                        <span className="link-existing__name">{p.display_name}</span>
                        {p.middle_name && !p.display_name.toLowerCase().includes(p.middle_name.toLowerCase()) && (
                          <span className="link-existing__middle"> · {p.middle_name}</span>
                        )}
                      </span>
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

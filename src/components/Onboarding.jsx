import { useState } from 'react';

const TOTAL_STEPS = 6;

export default function Onboarding({ onComplete }) {
  const [step, setStep] = useState(0);
  const [leaving, setLeaving] = useState(false);

  // Form state — all optional except me.name
  const [me, setMe] = useState({ name: '', birthYear: '' });
  const [partner, setPartner] = useState({ name: '' });
  const [parents, setParents] = useState([{ name: '' }, { name: '' }]);
  const [children, setChildren] = useState([]);
  const [memoryPersonIdx, setMemoryPersonIdx] = useState(null);
  const [memoryText, setMemoryText] = useState('');
  const [familyName, setFamilyName] = useState('');

  const suggestedName = me.name.trim()
    ? `The ${me.name.trim().split(/\s+/).pop()} Family`
    : 'My Family';

  const allPeople = [
    { label: me.name.trim() || 'You' },
    ...(partner.name.trim() ? [{ label: partner.name.trim() }] : []),
    ...parents.filter((p) => p.name.trim()).map((p) => ({ label: p.name.trim() })),
    ...children.filter((c) => c.name.trim()).map((c) => ({ label: c.name.trim() })),
  ];

  const next = () => setStep((s) => s + 1);

  const finish = () => {
    setLeaving(true);
    setTimeout(() => {
      onComplete({
        me,
        partner: partner.name.trim() ? partner : null,
        parents: parents.filter((p) => p.name.trim()),
        children: children.filter((c) => c.name.trim()),
        memoryPersonIdx,
        memoryText,
        familyName: familyName.trim() || suggestedName,
      });
    }, 480);
  };

  const updateParent = (i, val) =>
    setParents((ps) => ps.map((p, j) => (j === i ? { name: val } : p)));

  const addChild = () => setChildren((cs) => [...cs, { name: '' }]);
  const updateChild = (i, val) =>
    setChildren((cs) => cs.map((c, j) => (j === i ? { name: val } : c)));
  const removeChild = (i) =>
    setChildren((cs) => cs.filter((_, j) => j !== i));

  return (
    <div className={`ob${leaving ? ' ob--exit' : ''}`}>
      {/* Progress dots */}
      <div className="ob__progress" aria-hidden="true">
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <span
            key={i}
            className={`ob__dot${i < step ? ' ob__dot--done' : i === step ? ' ob__dot--active' : ''}`}
          />
        ))}
      </div>

      {/* Step body */}
      <div className="ob__body">
        <div key={step} className="ob__step">
          {step === 0 && <StepYou me={me} onChange={setMe} />}
          {step === 1 && <StepPartner partner={partner} onChange={setPartner} />}
          {step === 2 && <StepParents parents={parents} onUpdate={updateParent} />}
          {step === 3 && (
            <StepChildren
              children={children}
              onAdd={addChild}
              onUpdate={updateChild}
              onRemove={removeChild}
            />
          )}
          {step === 4 && (
            <StepMemory
              people={allPeople}
              selectedIdx={memoryPersonIdx}
              onSelect={setMemoryPersonIdx}
              text={memoryText}
              onText={setMemoryText}
            />
          )}
          {step === 5 && (
            <StepFamilyName
              value={familyName}
              onChange={setFamilyName}
              suggestion={suggestedName}
            />
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="ob__foot">
        {step === 0 && (
          <button className="ob__continue" disabled={!me.name.trim()} onClick={next}>
            Continue →
          </button>
        )}
        {step === 1 && (
          <>
            <button
              className="ob__continue"
              disabled={!partner.name.trim()}
              onClick={next}
            >
              Continue →
            </button>
            <button className="ob__skip" onClick={next}>
              Skip for now
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <button className="ob__continue" onClick={next}>
              Continue →
            </button>
            <button className="ob__skip" onClick={next}>
              Skip
            </button>
          </>
        )}
        {step === 3 && (
          <>
            <button className="ob__continue" onClick={next}>
              Continue →
            </button>
            <button className="ob__skip" onClick={next}>
              No children yet · Skip
            </button>
          </>
        )}
        {step === 4 && (
          <>
            <button className="ob__continue" onClick={next}>
              Continue →
            </button>
            <button className="ob__skip" onClick={next}>
              Skip for now
            </button>
          </>
        )}
        {step === 5 && (
          <button className="ob__continue" onClick={finish}>
            Build my family tree →
          </button>
        )}
      </div>
    </div>
  );
}

function StepYou({ me, onChange }) {
  return (
    <>
      <p className="ob__q">Let's start with you.</p>
      <input
        className="ob__input"
        value={me.name}
        onChange={(e) => onChange((m) => ({ ...m, name: e.target.value }))}
        onKeyDown={(e) => e.key === 'Enter' && me.name.trim() && e.target.blur()}
        placeholder="Your full name"
        autoFocus
        autoComplete="name"
      />
      <input
        className="ob__input ob__input--sm"
        value={me.birthYear}
        onChange={(e) => onChange((m) => ({ ...m, birthYear: e.target.value }))}
        placeholder="Birth year (optional)"
        inputMode="numeric"
      />
    </>
  );
}

function StepPartner({ partner, onChange }) {
  return (
    <>
      <p className="ob__q">Do you have a partner or spouse?</p>
      <input
        className="ob__input"
        value={partner.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder="Their name"
        autoFocus
        autoComplete="off"
      />
      <p className="ob__hint">Optional — you can add this later</p>
    </>
  );
}

function StepParents({ parents, onUpdate }) {
  return (
    <>
      <p className="ob__q">Who are your parents?</p>
      <p className="ob__sub">
        Add as many as apply — parents, step-parents, adoptive parents.
      </p>
      {parents.map((p, i) => (
        <input
          key={i}
          className="ob__input"
          value={p.name}
          onChange={(e) => onUpdate(i, e.target.value)}
          placeholder={i === 0 ? "Mum's name" : "Dad's name"}
          autoFocus={i === 0}
          autoComplete="off"
        />
      ))}
      <p className="ob__hint">Optional</p>
    </>
  );
}

function StepChildren({ children, onAdd, onUpdate, onRemove }) {
  return (
    <>
      <p className="ob__q">Do you have any children?</p>
      <div className="ob__dyn">
        {children.map((c, i) => (
          <div key={i} className="ob__dyn-item">
            <input
              className="ob__input"
              value={c.name}
              onChange={(e) => onUpdate(i, e.target.value)}
              placeholder={`Child ${i + 1}'s name`}
              autoFocus={i === children.length - 1}
              autoComplete="off"
            />
            <button
              className="ob__dyn-rm"
              onClick={() => onRemove(i)}
              aria-label="Remove"
            >
              ×
            </button>
          </div>
        ))}
        <button className="ob__add-btn" onClick={onAdd}>
          + Add a child
        </button>
      </div>
      <p className="ob__hint">Optional — skip if not applicable</p>
    </>
  );
}

function StepMemory({ people, selectedIdx, onSelect, text, onText }) {
  return (
    <>
      <p className="ob__q">Who would you most want future generations to remember?</p>
      <p className="ob__sub">
        Pick someone you just named, or skip and add memories later.
      </p>
      <div className="ob__chips">
        {people.map((p, i) => (
          <button
            key={i}
            className={`ob__chip${selectedIdx === i ? ' ob__chip--on' : ''}`}
            onClick={() => onSelect(selectedIdx === i ? null : i)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {selectedIdx !== null && (
        <textarea
          className="ob__input ob__input--area"
          value={text}
          onChange={(e) => onText(e.target.value)}
          placeholder={`What's one thing about ${people[selectedIdx]?.label || 'them'} that only your family knows?`}
          rows={4}
          autoFocus
        />
      )}
    </>
  );
}

function StepFamilyName({ value, onChange, suggestion }) {
  return (
    <>
      <p className="ob__q">What do you call this family?</p>
      <input
        className="ob__input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={suggestion}
        autoFocus
        autoComplete="off"
      />
      <p className="ob__hint">Shown at the top of your tree · You can change this any time</p>
    </>
  );
}

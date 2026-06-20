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
      <IconSelf />
      <p className="ob__q">Let's start with you.</p>
      <input
        className="ob__input"
        value={me.name}
        onChange={(e) => onChange((m) => ({ ...m, name: e.target.value }))}
        onKeyDown={(e) => e.key === 'Enter' && me.name.trim() && e.target.blur()}
        placeholder="Your full name"
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
      <IconPartner />
      <p className="ob__q">Do you have a partner or spouse?</p>
      <input
        className="ob__input"
        value={partner.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder="Their name"
        autoComplete="off"
      />
      <p className="ob__hint">Optional — you can add this later</p>
    </>
  );
}

function StepParents({ parents, onUpdate }) {
  return (
    <>
      <IconParents />
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
      <IconChildren />
      <p className="ob__q">Do you have any children?</p>
      <div className="ob__dyn">
        {children.map((c, i) => (
          <div key={i} className="ob__dyn-item">
            <input
              className="ob__input"
              value={c.name}
              onChange={(e) => onUpdate(i, e.target.value)}
              placeholder={`Child ${i + 1}'s name`}
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
      <IconMemory />
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
        />
      )}
    </>
  );
}

function StepFamilyName({ value, onChange, suggestion }) {
  return (
    <>
      <IconFamilyName />
      <p className="ob__q">What do you call this family?</p>
      <input
        className="ob__input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={suggestion}
        autoComplete="off"
      />
      <p className="ob__hint">Shown at the top of your tree · You can change this any time</p>
    </>
  );
}

/* ── Step icons ─────────────────────────────────────────────────────────── */

function IconSelf() {
  return (
    <svg className="ob-icon" viewBox="0 0 80 80" fill="none" aria-hidden="true">
      <circle cx="40" cy="26" r="16" stroke="#c2603a" strokeWidth="2.5"
              className="obi-c" style={{ '--t': '0.05s' }} />
      <path d="M10 74c0-16.569 13.431-30 30-30s30 13.431 30 30"
            stroke="#c2603a" strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray="1" strokeDashoffset="1" pathLength="1"
            className="obi-l" style={{ '--t': '0.4s' }} />
    </svg>
  );
}

function IconPartner() {
  return (
    <svg className="ob-icon" viewBox="0 0 80 80" fill="none" aria-hidden="true">
      <circle cx="28" cy="40" r="21" stroke="#4a7c6f" strokeWidth="2.5"
              className="obi-c" style={{ '--t': '0.05s' }} />
      <circle cx="52" cy="40" r="21" stroke="#c2603a" strokeWidth="2.5"
              className="obi-c" style={{ '--t': '0.28s' }} />
    </svg>
  );
}

function IconParents() {
  return (
    <svg className="ob-icon" viewBox="0 0 80 80" fill="none" aria-hidden="true">
      {/* You (bottom) */}
      <circle cx="40" cy="63" r="10" fill="#d4c4ba"
              className="obi-c" style={{ '--t': '0.05s' }} />
      {/* Lines up */}
      <path d="M40 53 L22 32" stroke="#d4c4ba" strokeWidth="2" strokeLinecap="round"
            strokeDasharray="1" strokeDashoffset="1" pathLength="1"
            className="obi-l" style={{ '--t': '0.22s' }} />
      <path d="M40 53 L58 32" stroke="#d4c4ba" strokeWidth="2" strokeLinecap="round"
            strokeDasharray="1" strokeDashoffset="1" pathLength="1"
            className="obi-l" style={{ '--t': '0.32s' }} />
      {/* Parents (top) */}
      <circle cx="20" cy="21" r="13" stroke="#4a7c6f" strokeWidth="2.5"
              className="obi-c" style={{ '--t': '0.45s' }} />
      <circle cx="60" cy="21" r="13" stroke="#7c6244" strokeWidth="2.5"
              className="obi-c" style={{ '--t': '0.58s' }} />
    </svg>
  );
}

function IconChildren() {
  return (
    <svg className="ob-icon" viewBox="0 0 80 80" fill="none" aria-hidden="true">
      {/* You (top) */}
      <circle cx="40" cy="18" r="14" fill="#c2603a"
              className="obi-c" style={{ '--t': '0.05s' }} />
      {/* Lines down */}
      <path d="M40 32 L22 53" stroke="#d4c4ba" strokeWidth="2" strokeLinecap="round"
            strokeDasharray="1" strokeDashoffset="1" pathLength="1"
            className="obi-l" style={{ '--t': '0.26s' }} />
      <path d="M40 32 L58 53" stroke="#d4c4ba" strokeWidth="2" strokeLinecap="round"
            strokeDasharray="1" strokeDashoffset="1" pathLength="1"
            className="obi-l" style={{ '--t': '0.34s' }} />
      {/* Children (bottom) */}
      <circle cx="20" cy="63" r="11" fill="#4a5a7c"
              className="obi-c" style={{ '--t': '0.5s' }} />
      <circle cx="60" cy="63" r="11" fill="#6f4a7c"
              className="obi-c" style={{ '--t': '0.62s' }} />
    </svg>
  );
}

function IconMemory() {
  return (
    <svg className="ob-icon" viewBox="0 0 80 80" fill="none" aria-hidden="true">
      {/* 5-pointed star */}
      <path d="M40,12 L46,31 L67,31 L51,43 L57,63 L40,51 L23,63 L29,43 L13,31 L33,31 Z"
            fill="rgba(194,96,58,0.1)" stroke="#c2603a" strokeWidth="2.2" strokeLinejoin="round"
            className="obi-c" style={{ '--t': '0.05s' }} />
    </svg>
  );
}

function IconFamilyName() {
  return (
    <svg className="ob-icon" viewBox="0 0 80 80" fill="none" aria-hidden="true">
      {/* Roof */}
      <path d="M8 42 L40 12 L72 42"
            stroke="#241f1c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray="1" strokeDashoffset="1" pathLength="1"
            className="obi-l" style={{ '--t': '0.05s' }} />
      {/* Walls */}
      <path d="M16 42 L16 70 L64 70 L64 42"
            stroke="#241f1c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray="1" strokeDashoffset="1" pathLength="1"
            className="obi-l" style={{ '--t': '0.4s' }} />
      {/* Door */}
      <path d="M32 70 L32 55 L48 55 L48 70"
            stroke="#c2603a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray="1" strokeDashoffset="1" pathLength="1"
            className="obi-l" style={{ '--t': '0.68s' }} />
    </svg>
  );
}

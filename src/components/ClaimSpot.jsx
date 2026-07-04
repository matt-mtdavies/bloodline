import { useState, useMemo, useEffect, useRef } from 'react';
import Avatar from './Avatar.jsx';

/*
 * Claim Your Spot — a warm welcome shown to a member who hasn't yet linked
 * themselves to a person in the tree. If the invite that brought them here
 * was created for a specific bubble, suggestedPersonId names it directly —
 * the strongest signal, since it doesn't depend on the invitee actually
 * signing in with the exact email the invite was sent to. Otherwise we fall
 * back to the older heuristic (a person whose recorded invited_email/email
 * matches the viewer's), which still covers invites sent before that field
 * existed, or a link-only share with no email at all. Failing both, they
 * search and pick, or say they're not in the tree yet.
 */
export default function ClaimSpot({ graph, familyName, viewerEmail, suggestedPersonId, onClaim, onSkip }) {
  const people = graph.people || [];
  const email = (viewerEmail || '').toLowerCase();

  const suggested = useMemo(() => {
    if (suggestedPersonId) {
      const named = people.find((p) => p.id === suggestedPersonId);
      if (named) return named;
    }
    return people.find((p) => p.invited_email?.toLowerCase() === email || p.email?.toLowerCase() === email) || null;
  }, [people, email, suggestedPersonId]);

  const [mode, setMode] = useState(suggested ? 'suggest' : 'pick'); // suggest | pick
  const [q, setQ] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (mode === 'pick') setTimeout(() => inputRef.current?.focus(), 350);
  }, [mode]);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = people.filter((p) => p.id !== suggested?.id);
    const list = s
      ? base.filter((p) => p.display_name?.toLowerCase().includes(s))
      : base;
    return list.slice(0, 8);
  }, [q, people, suggested]);

  const firstName = (p) => (p?.display_name || '').trim().split(/\s+/)[0];

  return (
    <div className="sheet-scrim sheet-scrim--modal" role="dialog" aria-modal="true" aria-label="Claim your spot">
      <div className="sheet claim" onClick={(e) => e.stopPropagation()}>
        <div className="claim__hero">
          <div className="claim__hero-aurora" aria-hidden="true" />
          <span className="claim__spark" aria-hidden="true"><SparkIcon /></span>
          <p className="claim__welcome">Welcome to</p>
          <h2 className="claim__family">{familyName || 'the family'}</h2>
        </div>

        {mode === 'suggest' && suggested ? (
          <div className="claim__suggest">
            <p className="claim__lead">Let's put you on the tree. Are you…</p>
            <div className="claim__candidate">
              <Avatar person={suggested} size={72} />
              <div className="claim__candidate-name">{suggested.display_name}</div>
              {suggested.birth_date && (
                <div className="claim__candidate-sub">b. {String(suggested.birth_date).slice(0, 4)}</div>
              )}
            </div>
            <button className="claim__primary" onClick={() => onClaim(suggested.id, suggested.display_name)}>
              Yes — that's me
            </button>
            <button className="claim__link" onClick={() => setMode('pick')}>No, that's not me</button>
          </div>
        ) : (
          <div className="claim__pick">
            <p className="claim__lead">Which person in the tree is you?</p>
            <input
              ref={inputRef}
              className="claim__search"
              placeholder="Search your name…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoComplete="off"
            />
            <ul className="claim__list">
              {matches.length === 0 ? (
                <li className="claim__empty">No one found for “{q}”.</li>
              ) : matches.map((p) => (
                <li key={p.id}>
                  <button className="claim__row" onClick={() => onClaim(p.id, p.display_name)}>
                    <Avatar person={p} size={38} />
                    <span className="claim__row-name">{p.display_name}</span>
                    {p.birth_date && <span className="claim__row-year">b. {String(p.birth_date).slice(0, 4)}</span>}
                    <span className="claim__row-go"><ChevronRightIcon /></span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <button className="claim__skip" onClick={onSkip}>I'm not in the tree yet</button>
      </div>
    </div>
  );
}

function SparkIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l1.8 4.9L18.7 9.7l-4.9 1.8L12 16.4l-1.8-4.9L5.3 9.7l4.9-1.8L12 3z" fill="currentColor"/>
      <path d="M19 14l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7L19 14z" fill="currentColor" opacity="0.7"/>
    </svg>
  );
}
function ChevronRightIcon() {
  return (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>);
}

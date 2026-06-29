import { useState, useEffect, useRef } from 'react';
import Avatar from './Avatar.jsx';
import ShareLink from './ShareLink.jsx';

const ROLES = [
  {
    key: 'contributor',
    label: 'Contributor',
    desc: 'Can add memories and photos',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"
          stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    key: 'editor',
    label: 'Editor',
    desc: 'Can edit the whole tree',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"
          stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
          stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    key: 'viewer',
    label: 'Viewer',
    desc: 'Read-only access',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
          stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    ),
  },
];

// Lower number = more access. A member can only grant their own level or below.
const ROLE_RANK = { owner: 0, coadmin: 1, editor: 2, contributor: 3, viewer: 4 };

export default function InviteSheet({ person, myRole = 'owner', onSend, onClose }) {
  // Only offer roles at or below the inviter's own access level.
  const callerRank = ROLE_RANK[myRole] ?? ROLE_RANK.viewer;
  const allowedRoles = ROLES.filter((r) => (ROLE_RANK[r.key] ?? ROLE_RANK.viewer) >= callerRank);
  const [email, setEmail] = useState(person.email || person.invited_email || '');
  const [role, setRole] = useState(
    allowedRoles.some((r) => r.key === 'contributor') ? 'contributor' : (allowedRoles[0]?.key || 'viewer'),
  );
  // idle | linking | sending | link | sent | sent-no-email | error
  const [phase, setPhase] = useState('idle');
  const [inviteUrl, setInviteUrl] = useState('');
  const inputRef = useRef(null);

  const firstName = person.display_name.trim().split(/\s+/)[0];

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const busy = phase === 'linking' || phase === 'sending';

  // Generate a shareable link without sending an email — send it via any channel.
  async function handleCreateLink() {
    if (busy) return;
    setPhase('linking');
    try {
      const result = await onSend(person.id, { email: email.trim(), role, notify: false });
      setInviteUrl(result?.inviteUrl || '');
      setPhase('link');
    } catch {
      setPhase('error');
    }
  }

  // Email the invite (existing flow). Requires an address.
  async function handleSend(e) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || busy) return;
    setPhase('sending');
    try {
      const result = await onSend(person.id, { email: trimmed, role, notify: true });
      setInviteUrl(result?.inviteUrl || '');
      setPhase(result?.emailSent === false ? 'sent-no-email' : 'sent');
    } catch {
      setPhase('error');
    }
  }

  const alreadyInvited = !!person.invited_at && !!person.invited_email;
  const isReady = phase === 'sent' || phase === 'sent-no-email' || phase === 'link';

  return (
    <div className="sheet-scrim invite-scrim" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Invite ${firstName}`}>
      <div className="sheet invite-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grip" />

        {isReady ? (
          <div className="invite-sheet__success">
            <div className={`invite-sheet__success-ring${phase === 'sent-no-email' ? ' invite-sheet__success-ring--warn' : ''}`}>
              {phase === 'sent-no-email' ? (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 9v4M12 17h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
                </svg>
              ) : phase === 'link' ? (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M9 15l6-6M10 6l1-1a4 4 0 0 1 6 6l-1 1M14 18l-1 1a4 4 0 0 1-6-6l1-1" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <h2 className="invite-sheet__sent-title">
              {phase === 'sent-no-email' ? 'Invite saved — email failed'
                : phase === 'link' ? `${firstName}'s invite link is ready`
                : 'Invitation sent'}
            </h2>
            <p className="invite-sheet__sent-body">
              {phase === 'sent-no-email'
                ? `The invite is saved and ${email.trim()} can still accept it, but the email didn't go out. Send them the link below instead.`
                : phase === 'link'
                ? `Send this link to ${firstName} however you like — text, WhatsApp, anything. They join the moment they open it.`
                : `We've emailed ${email.trim()} a link to join the family tree. If it's not in their inbox, ask them to check spam — or just send the link below.`
              }
            </p>
            {inviteUrl && (
              <div className="invite-sheet__share">
                {phase !== 'link' && <p className="invite-sheet__share-label">Or send them this link directly</p>}
                <ShareLink url={inviteUrl} shareText={`Join our family tree on Bloodline`} />
              </div>
            )}
            <button className="invite-sheet__done" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            {/* Person header */}
            <div className="invite-sheet__who">
              <Avatar person={person} size={72} />
              <h2 className="invite-sheet__headline">
                Invite {firstName}<br />
                <span className="invite-sheet__headline-sub">to tell their story</span>
              </h2>
            </div>

            <p className="invite-sheet__body">
              {firstName} will be able to add memories, confirm their own details,
              and share their side of the family history.
            </p>

            {alreadyInvited && (
              <p className="invite-sheet__resend-note">
                <CheckCircleIcon />
                Already invited to {person.invited_email}.
              </p>
            )}

            <label className="invite-sheet__label">What can they do?</label>
            <div className="invite-sheet__roles">
              {allowedRoles.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className={`invite-sheet__role${role === r.key ? ' invite-sheet__role--on' : ''}`}
                  onClick={() => setRole(r.key)}
                >
                  <span className="invite-sheet__role-icon">{r.icon}</span>
                  <span className="invite-sheet__role-name">{r.label}</span>
                  <span className="invite-sheet__role-desc">{r.desc}</span>
                </button>
              ))}
            </div>

            {/* Share a link — no email needed, send via any channel. */}
            <button
              className="invite-sheet__linkbtn"
              type="button"
              onClick={handleCreateLink}
              disabled={busy}
            >
              <LinkIcon />
              {phase === 'linking' ? 'Creating link…' : 'Create a share link'}
            </button>

            <div className="invite-sheet__or"><span>or send by email</span></div>

            <form onSubmit={handleSend} noValidate>
              <input
                ref={inputRef}
                id="invite-email"
                className="invite-sheet__input"
                type="email"
                placeholder={`${firstName.toLowerCase()}@example.com`}
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (phase === 'error') setPhase('idle'); }}
                autoComplete="email"
                inputMode="email"
              />

              {phase === 'error' && (
                <p className="invite-sheet__error">Couldn't do that — check your connection and try again.</p>
              )}

              <button
                className="invite-sheet__send"
                type="submit"
                disabled={!email.trim() || busy}
              >
                {phase === 'sending' ? 'Sending…' : `Email invitation to ${firstName} →`}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function LinkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 15l6-6M10 6l1-1a4 4 0 0 1 6 6l-1 1M14 18l-1 1a4 4 0 0 1-6-6l1-1"
        stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CheckCircleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"
      style={{ display: 'inline', verticalAlign: 'middle', marginRight: 5, flexShrink: 0 }}>
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 4L12 14.01l-3-3" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

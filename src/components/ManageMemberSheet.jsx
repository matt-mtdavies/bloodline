import { useState, useEffect } from 'react';
import { ROLE_LABELS, ROLE_DESCS, roleRank } from '../lib/visibility.js';

/*
 * "Manage {name}" — replaces the permanent role <select> + bare "×" that
 * used to sit on every member row (premium-UX refinement brief: a quiet
 * role badge in the row, one "More" action opening this sheet instead).
 * Role choices are explained inline (what each role can do), and removing
 * access is a protected, explained destructive action — never a bare X.
 */
export default function ManageMemberSheet({ member, assignableRoles, isSelf, onUpdateRole, onRemove, onClose }) {
  const [removeConfirming, setRemoveConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const initials = (member.display_name || member.email).slice(0, 2).toUpperCase();
  const joined = new Date(member.joined_at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  // A manager may act only on someone below their own role. `assignableRoles`
  // contains exactly the roles below the current member, so this also keeps a
  // Co-Admin from being offered controls for a fellow Co-Admin.
  const canChangeRole = !isSelf && assignableRoles.includes(member.role);
  const canRemove = canChangeRole; // same protection bar as changing role

  async function handleRemove() {
    setRemoving(true);
    await onRemove(member.id);
    setRemoving(false);
  }

  return (
    <div className="sheet-scrim" role="dialog" aria-modal="true" aria-label={`Manage ${member.display_name || member.email}`} onClick={onClose}>
      <div className="sheet mms" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grip" />
        <div className="dups__head">
          <h2 className="dups__title">Manage member</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </div>

        <div className="mms__who">
          <div className="mms__avatar">{initials}</div>
          <div className="mms__who-text">
            <span className="mms__name">{member.display_name || member.email}{isSelf ? ' (you)' : ''}</span>
            {member.display_name && <span className="mms__meta">{member.email}</span>}
            <span className="mms__meta">Joined {joined}</span>
          </div>
        </div>

        {member.role === 'owner' ? (
          <p className="mms__note">The family owner can't be changed or removed here.</p>
        ) : isSelf ? (
          <p className="mms__note">You can't change your own role or remove yourself here — ask another co-admin or the owner.</p>
        ) : !canChangeRole ? (
          <p className="mms__note">Only a co-admin or owner can change roles.</p>
        ) : (
          <>
            <p className="fs__label">Role</p>
            <div className="fs__role-grid">
              {assignableRoles.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`fs__role-opt${member.role === r ? ' fs__role-opt--on' : ''}`}
                  onClick={() => onUpdateRole(member.id, r)}
                >
                  <span className="fs__role-name">{ROLE_LABELS[r]}</span>
                  <span className="fs__role-desc">{ROLE_DESCS[r]}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {canRemove && (
          <div className="mms__danger">
            {removeConfirming ? (
              <div className="dups__confirm mms__remove-confirm">
                <span>
                  This removes {(member.display_name || member.email).split(/\s+/)[0]}'s access to the family tree —
                  they'll need a new invitation to rejoin. It doesn't delete anything they've already added.
                </span>
                <div className="dups__confirm-btns">
                  <button className="fs__danger-btn" onClick={handleRemove} disabled={removing}>
                    {removing ? 'Removing…' : 'Remove access'}
                  </button>
                  <button className="dups__cancel" onClick={() => setRemoveConfirming(false)} disabled={removing}>Cancel</button>
                </div>
              </div>
            ) : (
              <button className="mms__remove-btn" onClick={() => setRemoveConfirming(true)}>
                Remove access
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CloseIcon() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>);
}

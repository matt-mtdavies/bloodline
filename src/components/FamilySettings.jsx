import { useState, useEffect, useCallback } from 'react';
import {
  ROLES, ROLE_LABELS, ROLE_COLORS, canInvite, roleRank,
} from '../lib/visibility.js';

const INVITE_ROLES = ['coadmin', 'editor', 'contributor', 'viewer'];

export default function FamilySettings({ myRole, familyName, onUpdateFamilyName, onReset, onLogout, onClose }) {
  const [tab, setTab] = useState('members'); // 'members' | 'invite'
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const [inviteStatus, setInviteStatus] = useState('idle'); // idle | sending | sent | error
  const [nameEdit, setNameEdit] = useState(familyName);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/family/members');
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function sendInvite(e) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteStatus('sending');
    try {
      const res = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      if (!res.ok) throw new Error();
      setInviteStatus('sent');
      setInviteEmail('');
      setTimeout(() => { setInviteStatus('idle'); setTab('members'); load(); }, 2000);
    } catch {
      setInviteStatus('error');
    }
  }

  async function updateRole(userId, role) {
    await fetch('/api/family/members', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'update-role', userId, role }),
    });
    load();
  }

  async function removeMember(userId) {
    if (!confirm('Remove this person from the family tree?')) return;
    await fetch('/api/family/members', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'remove', userId }),
    });
    load();
  }

  const isOwnerOrCoadmin = canInvite(myRole);

  function handleNameSave() {
    const trimmed = nameEdit.trim();
    if (trimmed && trimmed !== familyName) onUpdateFamilyName(trimmed);
  }

  function handleReset() {
    if (!confirm('This will erase your entire family tree and start fresh. Are you sure?')) return;
    onReset();
    onClose();
  }

  return (
    <div className="sheet-scrim" role="dialog" aria-modal="true" aria-label="Family settings">
      <div className="sheet">
        <div className="sheet__grip" />
        <div className="fs__head">
          <div>
            <h2 className="fs__title">Family settings</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Family name */}
        <div className="fs__section">
          <label className="fs__label">Family name</label>
          <div className="fs__name-row">
            <input
              className="fs__input"
              value={nameEdit}
              onChange={(e) => setNameEdit(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.target.blur(); } }}
              placeholder="My Family"
            />
            {nameEdit.trim() !== familyName && nameEdit.trim() && (
              <button className="fs__name-save" onClick={handleNameSave}>Save</button>
            )}
          </div>
        </div>

        {/* Auth not enabled */}
        {!loading && !data?.familyId && (
          <div className="fs__empty">
            <p>Family sharing isn't set up yet.</p>
            <p className="fs__empty-sub">Your tree is saving correctly — sharing and invites will appear here once your account is fully initialised. Try signing out and back in.</p>
          </div>
        )}

        {data?.familyId && (
          <>
            {/* Tabs */}
            <div className="fs__tabs">
              <button
                className={`fs__tab${tab === 'members' ? ' fs__tab--on' : ''}`}
                onClick={() => setTab('members')}
              >
                Members{data.members?.length ? ` (${data.members.length})` : ''}
              </button>
              {isOwnerOrCoadmin && (
                <button
                  className={`fs__tab${tab === 'invite' ? ' fs__tab--on' : ''}`}
                  onClick={() => setTab('invite')}
                >
                  Invite
                </button>
              )}
            </div>

            {tab === 'members' && (
              <div className="fs__members">
                {data.members?.map((m) => (
                  <MemberRow
                    key={m.id}
                    member={m}
                    myRole={myRole}
                    isSelf={m.id === data.myId}
                    onUpdateRole={updateRole}
                    onRemove={removeMember}
                  />
                ))}
                {data.invites?.length > 0 && (
                  <>
                    <p className="fs__section-label">Pending invites</p>
                    {data.invites.map((inv) => (
                      <div key={inv.id} className="fs__invite-row">
                        <span className="fs__invite-email">{inv.email}</span>
                        <RoleBadge role={inv.role} />
                        <span className="fs__invite-pending">Pending</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {tab === 'invite' && isOwnerOrCoadmin && (
              <form className="fs__invite-form" onSubmit={sendInvite} noValidate>
                <p className="fs__invite-intro">
                  They'll receive a branded email with an invitation link to join your family tree.
                </p>

                <label className="fs__label">Email address</label>
                <input
                  className="fs__input"
                  type="email"
                  placeholder="family@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  autoFocus
                />

                <label className="fs__label">Role</label>
                <div className="fs__role-grid">
                  {INVITE_ROLES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={`fs__role-opt${inviteRole === r ? ' fs__role-opt--on' : ''}`}
                      onClick={() => setInviteRole(r)}
                    >
                      <span className="fs__role-name">{ROLE_LABELS[r]}</span>
                      <span className="fs__role-desc">{ROLE_DESCS[r]}</span>
                    </button>
                  ))}
                </div>

                {inviteStatus === 'sent' ? (
                  <p className="fs__sent">Invitation sent ✓</p>
                ) : (
                  <button
                    className="ob__continue"
                    type="submit"
                    disabled={inviteStatus === 'sending' || !inviteEmail.trim()}
                  >
                    {inviteStatus === 'sending' ? 'Sending…' : 'Send invitation →'}
                  </button>
                )}
                {inviteStatus === 'error' && (
                  <p className="fs__err">Could not send. Check your connection.</p>
                )}
              </form>
            )}
          </>
        )}

        {/* Danger zone */}
        <div className="fs__danger">
          {onLogout && (
            <button className="fs__signout-btn" onClick={onLogout}>
              Sign out
            </button>
          )}
          <button className="fs__danger-btn" onClick={handleReset}>
            Start over — erase tree
          </button>
        </div>
      </div>
    </div>
  );
}

function MemberRow({ member, myRole, isSelf, onUpdateRole, onRemove }) {
  const canChange = canInvite(myRole) && !isSelf && member.role !== 'owner';
  const initials = member.email.slice(0, 2).toUpperCase();

  return (
    <div className="fs__member">
      <div className="fs__member-avatar">{initials}</div>
      <div className="fs__member-info">
        <span className="fs__member-email">{member.email}{isSelf ? ' (you)' : ''}</span>
        <span className="fs__member-joined">
          Joined {new Date(member.joined_at * 1000).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
        </span>
      </div>
      {canChange ? (
        <select
          className="fs__role-select"
          value={member.role}
          onChange={(e) => onUpdateRole(member.id, e.target.value)}
        >
          {INVITE_ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
      ) : (
        <RoleBadge role={member.role} />
      )}
      {canChange && (
        <button className="fs__remove" onClick={() => onRemove(member.id)} aria-label="Remove member">✕</button>
      )}
    </div>
  );
}

function RoleBadge({ role }) {
  return (
    <span
      className="fs__role-badge"
      style={{ '--badge-color': ROLE_COLORS[role] || '#8a8480' }}
    >
      {ROLE_LABELS[role] || role}
    </span>
  );
}

const ROLE_DESCS = {
  coadmin: 'Can manage members, edit the whole tree',
  editor: 'Can add and edit people, memories, photos',
  contributor: 'Can add memories and photos only',
  viewer: 'Read-only access',
};

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ROLES, ROLE_LABELS, ROLE_COLORS, canInvite, roleRank,
} from '../lib/visibility.js';
import ShareLink from './ShareLink.jsx';
import { ActivityRow, dayLabel } from './ActivityFeed.jsx';

const INVITE_ROLES = ['coadmin', 'editor', 'contributor', 'viewer'];

export default function FamilySettings({
  myRole, familyName, onUpdateFamilyName, onReset, onLogout, onClose, onImportGedcom, onImportFamilySearch,
  people = [], userEmail, onSelectPerson,
}) {
  const [tab, setTab] = useState('members'); // 'members' | 'invite' | 'activity'
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fbType, setFbType]     = useState('idea');
  const [fbMsg, setFbMsg]       = useState('');
  const [fbStatus, setFbStatus] = useState('idle'); // idle | sending | sent | error
  const [pendingConfirm, setPendingConfirm] = useState(null); // { type:'member'|'invite', id }
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const [inviteStatus, setInviteStatus] = useState('idle'); // idle | linking | link | sending | sent | sent-no-email | error
  const [inviteError, setInviteError] = useState(''); // human-readable failure reason
  const [inviteUrl, setInviteUrl] = useState(''); // shareable link for the last invite
  const [resendStates, setResendStates] = useState({}); // { [inviteId]: 'idle'|'sending'|'sent'|'error' }
  const [copiedId, setCopiedId] = useState(null); // pending invite whose link was just copied
  const [nameEdit, setNameEdit] = useState(familyName);

  // Full audit log (owner/coadmin only) — backed by the durable server-side
  // activity_log table, not the client's own capped/mergeable cache, so it
  // can't be silently thinned out by a stale device's sync.
  const [auditItems, setAuditItems] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [auditError, setAuditError] = useState(false);
  const [auditLoaded, setAuditLoaded] = useState(false);

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

  const loadAudit = useCallback(async (before) => {
    setAuditLoading(true);
    setAuditError(false);
    try {
      const url = before ? `/api/activity?before=${encodeURIComponent(before)}` : '/api/activity';
      const res = await fetch(url);
      if (!res.ok) { setAuditError(true); return; }
      const body = await res.json();
      setAuditItems((prev) => (before ? [...prev, ...(body.items || [])] : (body.items || [])));
      setAuditHasMore(!!body.hasMore);
    } catch {
      setAuditError(true);
    } finally {
      setAuditLoading(false);
      setAuditLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (tab === 'activity' && !auditLoaded) loadAudit();
  }, [tab, auditLoaded, loadAudit]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const busy = inviteStatus === 'linking' || inviteStatus === 'sending';
  const isReady = inviteStatus === 'sent' || inviteStatus === 'sent-no-email' || inviteStatus === 'link';

  function resetInvite() {
    setInviteStatus('idle');
    setInviteUrl('');
    setInviteEmail('');
    setInviteError('');
  }

  async function createLink() {
    if (busy) return;
    setInviteStatus('linking');
    setInviteError('');
    setInviteUrl('');
    try {
      const res = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim() || '', role: inviteRole, notify: false }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInviteError(body.error || 'Could not create link. Check your connection.');
        setInviteStatus('error');
        return;
      }
      setInviteUrl(body.inviteUrl || '');
      setInviteStatus('link');
      load();
    } catch {
      setInviteError('Could not create link. Check your connection.');
      setInviteStatus('error');
    }
  }

  async function sendInvite(e) {
    e.preventDefault();
    if (!inviteEmail.trim() || busy) return;
    setInviteStatus('sending');
    setInviteError('');
    setInviteUrl('');
    try {
      const res = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole, notify: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInviteError(body.error || 'Could not send. Check your connection.');
        setInviteStatus('error');
        return;
      }
      if (body.inviteUrl) setInviteUrl(body.inviteUrl);
      if (body.emailSent === false) {
        setInviteStatus('sent-no-email');
        load();
        return;
      }
      setInviteStatus('sent');
      load();
    } catch {
      setInviteError('Could not send. Check your connection.');
      setInviteStatus('error');
    }
  }

  async function updateRole(userId, role) {
    const res = await fetch('/api/family/members', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'update-role', userId, role }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Could not update role — please try again.');
    }
    load();
  }

  async function removeMember(userId) {
    await fetch('/api/family/members', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'remove', userId }),
    });
    setPendingConfirm(null);
    load();
  }

  async function cancelInvite(id) {
    const res = await fetch(`/api/invite?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Could not cancel invite — please try again.');
    }
    setPendingConfirm(null);
    load();
  }

  async function updateInviteRole(id, role) {
    await fetch('/api/invite', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, role }),
    });
    load();
  }

  async function resendInvite(id) {
    setResendStates((s) => ({ ...s, [id]: 'sending' }));
    try {
      const res = await fetch('/api/invite/resend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.emailSent === false) throw new Error();
      setResendStates((s) => ({ ...s, [id]: 'sent' }));
      setTimeout(() => setResendStates((s) => ({ ...s, [id]: 'idle' })), 3000);
    } catch {
      setResendStates((s) => ({ ...s, [id]: 'error' }));
      setTimeout(() => setResendStates((s) => ({ ...s, [id]: 'idle' })), 3000);
    }
  }

  async function copyInviteLink(inv) {
    if (!inv.invite_url) return;
    try { await navigator.clipboard.writeText(inv.invite_url); } catch { /* ignore */ }
    setCopiedId(inv.id);
    setTimeout(() => setCopiedId((c) => (c === inv.id ? null : c)), 1800);
  }

  // Deduplicate pending invites by email (keep most recent per address).
  const dedupedInvites = useMemo(() => {
    if (!data?.invites) return [];
    const seen = new Set();
    return data.invites.filter((inv) => {
      if (seen.has(inv.email)) return false;
      seen.add(inv.email);
      return true;
    });
  }, [data?.invites]);

  // Use the role returned by the API (source of truth) rather than the prop,
  // which can be stale when data._meta isn't populated yet.
  const effectiveRole = data?.myRole || myRole;
  const isOwnerOrCoadmin = canInvite(effectiveRole);

  // Audit log rendering support — same shape ActivityFeed uses, so its
  // ActivityRow can be reused as-is.
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const nameByEmail = useMemo(() => {
    const m = new Map();
    for (const p of people) {
      for (const e of [p.email, p.invited_email]) {
        if (e) m.set(e.toLowerCase(), p.display_name);
      }
    }
    return m;
  }, [people]);
  const groupedAudit = useMemo(() => {
    const groups = [];
    let currentLabel = null;
    let currentItems = [];
    for (const event of auditItems) {
      const label = dayLabel(event.created_at);
      if (label !== currentLabel) {
        if (currentLabel !== null) groups.push({ label: currentLabel, items: currentItems });
        currentLabel = label;
        currentItems = [event];
      } else {
        currentItems.push(event);
      }
    }
    if (currentLabel !== null) groups.push({ label: currentLabel, items: currentItems });
    return groups;
  }, [auditItems]);

  function handleNameSave() {
    const trimmed = nameEdit.trim();
    if (trimmed && trimmed !== familyName) onUpdateFamilyName(trimmed);
  }

  async function sendFeedback(e) {
    e.preventDefault();
    if (!fbMsg.trim()) return;
    setFbStatus('sending');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: fbType, message: fbMsg.trim(), page: window.location.pathname }),
      });
      if (!res.ok) throw new Error();
      setFbStatus('sent');
      setFbMsg('');
      setTimeout(() => setFbStatus('idle'), 3000);
    } catch {
      setFbStatus('error');
    }
  }

  function handleReset() {
    if (!confirm('This will erase your entire family tree and start fresh. Are you sure?')) return;
    onReset();
    onClose();
  }

  return (
    <div className="sheet-scrim" role="dialog" aria-modal="true" aria-label="Family settings" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grip" />
        <div className="fs__head">
          <div>
            <h2 className="fs__title">Family settings</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><CloseIcon /></button>
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
              {isOwnerOrCoadmin && (
                <button
                  className={`fs__tab${tab === 'activity' ? ' fs__tab--on' : ''}`}
                  onClick={() => setTab('activity')}
                >
                  Audit log
                </button>
              )}
            </div>

            {tab === 'members' && (
              <div className="fs__members">
                {data.members?.map((m) => (
                  <MemberRow
                    key={m.id}
                    member={m}
                    myRole={effectiveRole}
                    isSelf={m.id === data.myId}
                    onUpdateRole={updateRole}
                    onRemove={removeMember}
                    confirming={pendingConfirm?.type === 'member' && pendingConfirm?.id === m.id}
                    onRequestConfirm={() => setPendingConfirm({ type: 'member', id: m.id })}
                    onCancelConfirm={() => setPendingConfirm(null)}
                  />
                ))}
                {dedupedInvites.length > 0 && (
                  <>
                    <p className="fs__section-label">Pending invites</p>
                    {dedupedInvites.map((inv) => {
                      const confirming = pendingConfirm?.type === 'invite' && pendingConfirm?.id === inv.id;
                      return (
                        <div key={inv.id} className="fs__member">
                          <div className="fs__member-avatar">{inv.email.slice(0, 2).toUpperCase()}</div>
                          <div className="fs__member-info">
                            <span className="fs__member-email">{inv.email}</span>
                            <span className="fs__member-joined fs__invite-pending">Pending</span>
                          </div>
                          {confirming ? (
                            <div className="fs__confirm-inline">
                              <span className="fs__confirm-label">Cancel invite?</span>
                              <button className="fs__confirm-yes" onClick={() => cancelInvite(inv.id)}>Yes</button>
                              <button className="fs__confirm-no" onClick={() => setPendingConfirm(null)}>No</button>
                            </div>
                          ) : (
                            <>
                              {isOwnerOrCoadmin ? (
                                <select
                                  className="fs__role-select"
                                  value={inv.role}
                                  onChange={(e) => updateInviteRole(inv.id, e.target.value)}
                                >
                                  {INVITE_ROLES.map((r) => (
                                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                                  ))}
                                </select>
                              ) : (
                                <RoleBadge role={inv.role} />
                              )}
                              {isOwnerOrCoadmin && inv.invite_url && (
                                <button
                                  className={`fs__resend-btn${copiedId === inv.id ? ' fs__resend-btn--sent' : ''}`}
                                  onClick={() => copyInviteLink(inv)}
                                  aria-label="Copy invite link"
                                >
                                  {copiedId === inv.id ? 'Copied' : 'Copy link'}
                                </button>
                              )}
                              {isOwnerOrCoadmin && (
                                <button
                                  className={`fs__resend-btn${resendStates[inv.id] === 'sent' ? ' fs__resend-btn--sent' : ''}${resendStates[inv.id] === 'error' ? ' fs__resend-btn--err' : ''}`}
                                  onClick={() => resendInvite(inv.id)}
                                  disabled={resendStates[inv.id] === 'sending'}
                                  aria-label="Resend invite email"
                                >
                                  {resendStates[inv.id] === 'sending' ? '…'
                                    : resendStates[inv.id] === 'sent' ? 'Sent!'
                                    : resendStates[inv.id] === 'error' ? 'Failed'
                                    : 'Resend'}
                                </button>
                              )}
                              {isOwnerOrCoadmin && (
                                <button
                                  className="fs__remove"
                                  onClick={() => setPendingConfirm({ type: 'invite', id: inv.id })}
                                  aria-label="Cancel invite"
                                >
                                  <CloseIcon />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}

            {tab === 'invite' && isOwnerOrCoadmin && (
              <div className="fs__invite-form">
                {isReady ? (
                  <div className="fs__invite-done">
                    <div className={`fs__invite-ring${inviteStatus === 'sent-no-email' ? ' fs__invite-ring--warn' : ''}`}>
                      {inviteStatus === 'sent-no-email' ? (
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M12 9v4M12 17h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
                          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
                        </svg>
                      ) : inviteStatus === 'link' ? (
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M9 15l6-6M10 6l1-1a4 4 0 0 1 6 6l-1 1M14 18l-1 1a4 4 0 0 1-6-6l1-1" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      ) : (
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <p className="fs__invite-title">
                      {inviteStatus === 'link' ? 'Link is ready'
                        : inviteStatus === 'sent-no-email' ? 'Invite saved — email failed'
                        : 'Invitation sent'}
                    </p>
                    <p className="fs__invite-body">
                      {inviteStatus === 'link'
                        ? 'Send this to anyone however you like — text, WhatsApp, anything. They join the moment they open it.'
                        : inviteStatus === 'sent-no-email'
                        ? `The invite is saved but the email didn't go out. Send the link below instead.`
                        : `Invitation emailed. You can also send this link directly.`}
                    </p>
                    {inviteUrl && <ShareLink url={inviteUrl} shareText="Join our family tree on Bloodline" />}
                    <button type="button" className="fs__invite-again" onClick={resetInvite}>
                      Invite someone else
                    </button>
                  </div>
                ) : (
                  <>
                    <label className="fs__label">What can they do?</label>
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

                    <button type="button" className="fs__link-btn" onClick={createLink} disabled={busy}>
                      <FsLinkIcon />
                      {inviteStatus === 'linking' ? 'Creating link…' : 'Create a share link'}
                    </button>

                    <div className="fs__or"><span>or send by email</span></div>

                    <form onSubmit={sendInvite} noValidate>
                      <input
                        className="fs__input"
                        type="email"
                        placeholder="family@example.com"
                        value={inviteEmail}
                        onChange={(e) => { setInviteEmail(e.target.value); if (inviteStatus === 'error') setInviteStatus('idle'); }}
                      />
                      {inviteStatus === 'error' && (
                        <p className="fs__err">{inviteError || 'Could not send. Check your connection.'}</p>
                      )}
                      <button
                        className="fs__email-btn"
                        type="submit"
                        disabled={!inviteEmail.trim() || busy}
                      >
                        {inviteStatus === 'sending' ? 'Sending…' : 'Email invitation →'}
                      </button>
                    </form>
                  </>
                )}
              </div>
            )}

            {tab === 'activity' && isOwnerOrCoadmin && (
              <div className="fs__audit">
                <p className="fs__audit-note">
                  The complete history of changes to this tree, recorded on the server —
                  unlike the quick activity feed, this can't be thinned out by any
                  device's own sync.
                </p>
                {auditItems.length === 0 && !auditLoading ? (
                  <p className="fs__audit-empty">
                    {auditError ? 'Could not load the audit log — check your connection.' : 'No activity recorded yet.'}
                  </p>
                ) : (
                  <>
                    {groupedAudit.map(({ label, items }) => (
                      <div key={label}>
                        <p className="activity-day">{label}</p>
                        {items.map((event) => (
                          <ActivityRow
                            key={event.id}
                            event={event}
                            person={peopleById.get(event.personId) ?? { display_name: event.personName }}
                            userEmail={userEmail}
                            nameByEmail={nameByEmail}
                            onSelect={() => onSelectPerson?.(event.personId)}
                          />
                        ))}
                      </div>
                    ))}
                    {auditHasMore && (
                      <button
                        type="button"
                        className="fs__audit-more"
                        onClick={() => loadAudit(auditItems[auditItems.length - 1]?.created_at)}
                        disabled={auditLoading}
                      >
                        {auditLoading ? 'Loading…' : 'Load more'}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}

        {/* Import */}
        <div className="fs__section">
          <label className="fs__label">Import data</label>
          <button className="fs__fs-btn" onClick={() => { onClose(); onImportFamilySearch?.(); }}>
            <LeafIcon />
            Import from FamilySearch
          </button>
          <button className="fs__import-btn" style={{ marginTop: 8 }} onClick={() => { onClose(); onImportGedcom?.(); }}>
            <GedcomIcon />
            Import GEDCOM file
          </button>
          <p className="fs__import-hint">
            From Ancestry, MyHeritage, 23andMe, MacFamilyTree, and more.
          </p>
        </div>

        {/* Feedback */}
        <div className="fs__section">
          <label className="fs__label">Send feedback</label>
          {fbStatus === 'sent' ? (
            <p className="fs__sent"><CheckIcon /> Thanks — your feedback has been sent.</p>
          ) : (
            <form onSubmit={sendFeedback} noValidate>
              <div className="fs__fb-types">
                {[
                  ['idea',   <FbIdeaIcon />,   'Idea'],
                  ['bug',    <FbBugIcon />,    'Bug'],
                  ['praise', <FbPraiseIcon />, 'Praise'],
                  ['other',  <FbOtherIcon />,  'Other'],
                ].map(([v, icon, label]) => (
                  <button
                    key={v}
                    type="button"
                    className={`fs__fb-type${fbType === v ? ' fs__fb-type--on' : ''}`}
                    onClick={() => setFbType(v)}
                  >{icon}{label}</button>
                ))}
              </div>
              <textarea
                className="fs__fb-textarea"
                placeholder="What's on your mind?"
                value={fbMsg}
                onChange={(e) => setFbMsg(e.target.value)}
                rows={3}
                maxLength={2000}
              />
              <button
                className="fs__fb-submit"
                type="submit"
                disabled={fbStatus === 'sending' || !fbMsg.trim()}
              >
                {fbStatus === 'sending' ? 'Sending…' : 'Send →'}
              </button>
              {fbStatus === 'error' && (
                <p className="fs__err">Could not send — please try again.</p>
              )}
            </form>
          )}
        </div>

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

function MemberRow({ member, myRole, isSelf, onUpdateRole, onRemove, confirming, onRequestConfirm, onCancelConfirm }) {
  const canChange = canInvite(myRole) && !isSelf && member.role !== 'owner';
  const assignableRoles = INVITE_ROLES.filter((r) => roleRank(r) < roleRank(myRole));
  const initials = (member.display_name || member.email).slice(0, 2).toUpperCase();

  return (
    <div className="fs__member">
      <div className="fs__member-avatar">{initials}</div>
      <div className="fs__member-info">
        <span className="fs__member-email">
          {member.display_name || member.email}{isSelf ? ' (you)' : ''}
        </span>
        <span className="fs__member-joined">
          {member.display_name ? member.email + ' · ' : ''}
          Joined {new Date(member.joined_at * 1000).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
        </span>
      </div>
      {confirming ? (
        <div className="fs__confirm-inline">
          <span className="fs__confirm-label">Remove?</span>
          <button className="fs__confirm-yes" onClick={() => onRemove(member.id)}>Yes</button>
          <button className="fs__confirm-no" onClick={onCancelConfirm}>No</button>
        </div>
      ) : (
        <>
          {canChange ? (
            <select
              className="fs__role-select"
              value={member.role}
              onChange={(e) => onUpdateRole(member.id, e.target.value)}
            >
              {assignableRoles.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          ) : (
            <RoleBadge role={member.role} />
          )}
          {canChange && (
            <button className="fs__remove" onClick={onRequestConfirm} aria-label="Remove member"><CloseIcon /></button>
          )}
        </>
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

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{display:'inline',verticalAlign:'middle',marginRight:4}}>
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function GedcomIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points="17 8 12 3 7 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
    </svg>
  );
}

function LeafIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 22C12 22 3 16.5 3 9a9 9 0 0 1 18 0c0 7.5-9 13-9 13z" fill="#3e7d2d" stroke="none"/>
      <path d="M12 22V9" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M12 14c0 0-2.5-1.5-3.5-4.5" stroke="white" strokeWidth="1.3" strokeLinecap="round"/>
      <path d="M12 11c0 0 2-1 3-3.5" stroke="white" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}

function FbIdeaIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 21h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
      <path d="M12 3a6 6 0 0 1 4.24 10.24c-.6.6-.99 1.4-1.24 2.26V18H9v-2.5c-.25-.86-.64-1.66-1.24-2.26A6 6 0 0 1 12 3z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function FbBugIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 2l1.88 1.88M16 2l-1.88 1.88" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
      <path d="M9 9a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0V9z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6 10H3M21 10h-3M6 15H3M21 15h-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
      <path d="M9 20c0 1.1.9 2 3 2s3-.9 3-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
    </svg>
  );
}

function FbPraiseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function FbOtherIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function FsLinkIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 15l6-6M10 6l1-1a4 4 0 0 1 6 6l-1 1M14 18l-1 1a4 4 0 0 1-6-6l1-1"
        stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

const ROLE_DESCS = {
  coadmin: 'Can manage members, edit the whole tree',
  editor: 'Can add and edit people, memories, photos',
  contributor: 'Can add memories and photos only',
  viewer: 'Read-only access',
};

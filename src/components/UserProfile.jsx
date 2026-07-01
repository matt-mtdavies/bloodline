import { useState, useEffect, useCallback, useRef } from 'react';
import { clearLocalData } from '../data/store.js';

export default function UserProfile({ user, people = [], onClose, onLogout, onSaved, onPhoto }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [nameEdit, setNameEdit] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // null | 'saved' | string (error)
  const [families, setFamilies] = useState(null); // null = loading, [] = single/none
  const [switchingId, setSwitchingId] = useState(null);
  const [switchError, setSwitchError] = useState('');
  const saveTimer = useRef(null);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/user/profile');
      if (res.ok) {
        const p = await res.json();
        setProfile(p);
        setNameEdit(p.display_name || '');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch('/api/families')
      .then((r) => (r.ok ? r.json() : { families: [] }))
      .then((d) => setFamilies(d.families || []))
      .catch(() => setFamilies([]));
  }, []);

  async function switchFamily(familyId) {
    if (switchingId) return;
    setSwitchingId(familyId);
    setSwitchError('');
    try {
      const res = await fetch('/api/families/switch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ family_id: familyId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      // Wipe the cached tree so the reload can't push this family's data over
      // the one we're switching to — the fresh load will pull the right tree.
      clearLocalData();
      window.location.reload();
    } catch (e) {
      setSwitchError(e.message || 'Could not switch families');
      setSwitchingId(null);
    }
  }

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function patch(fields) {
    setSaving(true);
    clearTimeout(saveTimer.current);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(fields),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      setSaveStatus('saved');
      setProfile((p) => ({ ...p, ...fields }));
      onSaved?.({ ...profile, ...fields });
    } catch (e) {
      setSaveStatus(e.message || 'Could not save');
    } finally {
      setSaving(false);
      saveTimer.current = setTimeout(() => setSaveStatus(null), 2500);
    }
  }

  function handleNameBlur() {
    const trimmed = nameEdit.trim();
    if (trimmed === (profile?.display_name || '')) return;
    patch({ display_name: trimmed || null });
  }

  function handleNameKeyDown(e) {
    if (e.key === 'Enter') e.target.blur();
  }

  async function toggleNotif(key) {
    const prefs = { ...(profile?.notification_prefs ?? { activity: true, invites: true }) };
    prefs[key] = !prefs[key];
    patch({ notification_prefs: prefs });
  }

  function claimBubble(person_id) {
    if (!person_id) { patch({ person_id: null }); return; }
    const person = people.find((p) => p.id === person_id);
    patch({ person_id, person_name: person?.display_name ?? person_id });
  }

  const initials = getInitials(profile?.display_name || user?.email || '');
  const claimedPerson = profile?.person_id
    ? people.find((p) => p.id === profile.person_id)
    : null;
  const claimedPhoto = claimedPerson?.photo || null;

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (file && claimedPerson) onPhoto?.(claimedPerson.id, file);
    e.target.value = '';
  }

  return (
    <div className="sheet-scrim" role="dialog" aria-modal="true" aria-label="Your profile" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grip" />

        <div className="fs__head">
          <h2 className="fs__title">Your profile</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </div>

        {/* Avatar + identity */}
        <div className="up__hero">
          <button
            className={`up__avatar-btn${claimedPerson ? '' : ' up__avatar-btn--noclaim'}`}
            onClick={() => claimedPerson && fileRef.current?.click()}
            aria-label={claimedPerson ? (claimedPhoto ? 'Change photo' : 'Add a photo') : 'Claim your bubble to add a photo'}
            title={claimedPerson ? undefined : 'Claim your bubble below to add a photo'}
          >
            {claimedPhoto
              ? <img src={claimedPhoto} alt="" className="up__avatar-img" />
              : <span className="up__avatar-initials">{initials}</span>
            }
            {claimedPerson && (
              <span className="up__avatar-badge" aria-hidden="true"><CameraIcon /></span>
            )}
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleFileChange} />
          <div className="up__identity">
            <p className="up__email">{user?.email}</p>
            {saveStatus === 'saved' && <p className="up__save-status up__save-status--ok">Saved</p>}
            {saveStatus && saveStatus !== 'saved' && <p className="up__save-status up__save-status--err">{saveStatus}</p>}
          </div>
        </div>

        {/* Display name */}
        <div className="fs__section">
          <label className="fs__label" htmlFor="up-display-name">Display name</label>
          <input
            id="up-display-name"
            className="fs__input"
            value={nameEdit}
            onChange={(e) => setNameEdit(e.target.value)}
            onBlur={handleNameBlur}
            onKeyDown={handleNameKeyDown}
            placeholder="Your name"
            disabled={loading || saving}
          />
          <p className="up__hint">How you appear to other family members.</p>
        </div>

        {/* Claim a bubble */}
        <div className="fs__section">
          <label className="fs__label" htmlFor="up-claim">Your bubble in the tree</label>
          <select
            id="up-claim"
            className="up__claim-select"
            value={profile?.person_id || ''}
            onChange={(e) => claimBubble(e.target.value || null)}
            disabled={loading || saving}
          >
            <option value="">— Not claimed yet —</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.display_name}</option>
            ))}
          </select>
          {claimedPerson && (
            <p className="up__hint">
              Linked to <strong>{claimedPerson.display_name}</strong>. Your name and photo will sync to their bubble.
            </p>
          )}
          {!claimedPerson && !loading && (
            <p className="up__hint">Pick which person in the tree represents you.</p>
          )}
        </div>

        {/* Family trees — switcher for anyone who belongs to more than one */}
        {families && families.length > 1 && (
          <div className="fs__section">
            <p className="fs__label">Family trees</p>
            <div className="up__family-list">
              {families.map((f) => (
                <div key={f.family_id} className={`up__family-row${f.is_current ? ' up__family-row--current' : ''}`}>
                  <div className="up__family-text">
                    <span className="up__family-name">{f.name || 'Untitled family'}</span>
                    <span className="up__family-meta">
                      {roleLabel(f.role)} · {f.member_count} member{f.member_count === 1 ? '' : 's'}
                    </span>
                  </div>
                  {f.is_current ? (
                    <span className="up__family-current">Viewing</span>
                  ) : (
                    <button
                      className="up__family-switch"
                      onClick={() => switchFamily(f.family_id)}
                      disabled={!!switchingId}
                    >
                      {switchingId === f.family_id ? 'Switching…' : 'Switch'}
                    </button>
                  )}
                </div>
              ))}
            </div>
            {switchError && <p className="up__save-status up__save-status--err">{switchError}</p>}
            <p className="up__hint">Switching reloads the app on that family's tree.</p>
          </div>
        )}

        {/* Notifications */}
        {profile && (
          <div className="fs__section">
            <p className="fs__label">Notifications</p>
            <div className="up__notif-list">
              <label className="up__notif-row">
                <div className="up__notif-text">
                  <span className="up__notif-title">Family activity</span>
                  <span className="up__notif-desc">Emails when people add memories, photos, or new relatives</span>
                </div>
                <button
                  role="switch"
                  aria-checked={profile.notification_prefs?.activity ?? true}
                  className={`up__toggle${(profile.notification_prefs?.activity ?? true) ? ' up__toggle--on' : ''}`}
                  onClick={() => toggleNotif('activity')}
                  disabled={saving}
                >
                  <span className="up__toggle-knob" />
                </button>
              </label>
              <label className="up__notif-row">
                <div className="up__notif-text">
                  <span className="up__notif-title">Invites</span>
                  <span className="up__notif-desc">Emails when someone invites you to a family tree</span>
                </div>
                <button
                  role="switch"
                  aria-checked={profile.notification_prefs?.invites ?? true}
                  className={`up__toggle${(profile.notification_prefs?.invites ?? true) ? ' up__toggle--on' : ''}`}
                  onClick={() => toggleNotif('invites')}
                  disabled={saving}
                >
                  <span className="up__toggle-knob" />
                </button>
              </label>
            </div>
          </div>
        )}

        {/* Admin dashboard — only visible to the site admin */}
        {user?.isAdmin && (
          <div className="fs__section">
            <a className="up__admin-link" href="/admin.html">
              <ChartIcon />
              <span>
                <span className="up__admin-title">Admin dashboard</span>
                <span className="up__admin-desc">Users, families, invites &amp; email deliverability</span>
              </span>
              <ArrowIcon />
            </a>
          </div>
        )}

        {/* Sign out */}
        <div className="fs__danger">
          {onLogout && (
            <button className="fs__signout-btn" onClick={onLogout}>
              Sign out
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function roleLabel(role) {
  const labels = { owner: 'Owner', coadmin: 'Co-Admin', editor: 'Editor', contributor: 'Contributor', viewer: 'Viewer' };
  return labels[role] || role;
}

function getInitials(str) {
  if (!str) return '?';
  const parts = str.trim().split(/[\s@._]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.slice(0, 2) ?? '?').toUpperCase();
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
      <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="1.8"/>
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 3v18h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M7 14l3.5-4 3 3L18 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

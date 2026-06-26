import { useState, useEffect, useCallback, useRef } from 'react';

export default function UserProfile({ user, people = [], onClose, onLogout, onSaved }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [nameEdit, setNameEdit] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // null | 'saved' | string (error)
  const saveTimer = useRef(null);

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

  async function claimBubble(person_id) {
    patch({ person_id: person_id || null });
  }

  const initials = getInitials(profile?.display_name || user?.email || '');
  const claimedPerson = profile?.person_id
    ? people.find((p) => p.id === profile.person_id)
    : null;

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
          <div className="up__avatar">{initials}</div>
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

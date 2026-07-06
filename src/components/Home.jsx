import { useState, useEffect, useCallback } from 'react';
import Logo from './Logo.jsx';
import { clearLocalData } from '../data/store.js';

/*
 * The home hub — reached by tapping the logo. A calm step outside the tree:
 * switch between trees you belong to, start a brand-new one, jump to account
 * settings, or sign out. Full-screen (not a bottom sheet) so it reads as its
 * own place rather than another overlay stacked on the canvas — an aurora
 * hero up top (same treatment as Tree Insights / Claim Your Spot) gives it
 * the same "wow" arrival moment those already have.
 */
export default function Home({ user, onClose, onOpenAccount, onLogout }) {
  const [families, setFamilies] = useState(null); // null = loading
  const [switchingId, setSwitchingId] = useState(null);
  const [switchError, setSwitchError] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const loadFamilies = useCallback(() => {
    if (!user) { setFamilies([]); return; }
    fetch('/api/families')
      .then((r) => (r.ok ? r.json() : { families: [] }))
      .then((d) => setFamilies(d.families || []))
      .catch(() => setFamilies([]));
  }, [user]);

  useEffect(() => { loadFamilies(); }, [loadFamilies]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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

  async function createTree() {
    if (creating) return;
    setCreating(true);
    setCreateError('');
    try {
      const res = await fetch('/api/families', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      clearLocalData();
      window.location.reload();
    } catch (e) {
      setCreateError(e.message || 'Could not create a new tree');
      setCreating(false);
    }
  }

  return (
    <div className="home" role="dialog" aria-modal="true" aria-label="Bloodline home">
      <div className="home__hero">
        <div className="home__hero-aurora" aria-hidden="true" />
        <button className="home__close" onClick={onClose} aria-label="Back to your tree">
          <CloseIcon />
        </button>
        <div className="home__mark">
          <Logo size={58} />
        </div>
        <p className="home__word">Bloodline</p>
        {user && (
          <p className="home__greeting">
            {user.display_name ? `Welcome back, ${firstName(user.display_name)}` : user.email}
          </p>
        )}
      </div>

      <div className="home__scroll">
        {user && (
          <section className="home__section" style={{ '--i': 0 }}>
            <h2 className="home__section-title">Your trees</h2>
            {families == null && <p className="home__hint">Loading…</p>}
            {families && families.length > 0 && (
              <div className="home__tree-list">
                {families.map((f) => (
                  <div key={f.family_id} className={`home__tree-row${f.is_current ? ' home__tree-row--current' : ''}`}>
                    <span className={`home__tree-medallion${f.is_current ? ' home__tree-medallion--current' : ''}`} aria-hidden="true">
                      <Logo size={20} animate={false} />
                    </span>
                    <div className="home__tree-text">
                      <span className="home__tree-name">{f.name || 'Untitled family'}</span>
                      <span className="home__tree-meta">
                        {roleLabel(f.role)} · {f.member_count} member{f.member_count === 1 ? '' : 's'}
                      </span>
                    </div>
                    {f.is_current ? (
                      <span className="home__tree-current">Viewing</span>
                    ) : (
                      <button
                        className="home__tree-switch"
                        onClick={() => switchFamily(f.family_id)}
                        disabled={!!switchingId}
                      >
                        {switchingId === f.family_id ? 'Switching…' : 'Switch'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {switchError && <p className="up__save-status up__save-status--err">{switchError}</p>}

            <button className="home__row-btn home__row-btn--create" onClick={createTree} disabled={creating}>
              <span className="home__row-icon home__row-icon--create"><PlusIcon /></span>
              <span className="home__row-text">
                <span className="home__row-title">{creating ? 'Creating…' : 'Create a new tree'}</span>
                <span className="home__row-desc">Start fresh — your other trees stay untouched</span>
              </span>
              <ArrowIcon />
            </button>
            {createError && <p className="up__save-status up__save-status--err">{createError}</p>}
          </section>
        )}

        {!user && (
          <section className="home__section" style={{ '--i': 0 }}>
            <h2 className="home__section-title">Your trees</h2>
            <p className="home__hint">
              Sign in to save a tree of your own, invite relatives, and switch between
              multiple trees.
            </p>
          </section>
        )}

        {user && (
          <section className="home__section" style={{ '--i': 1 }}>
            <h2 className="home__section-title">Account</h2>
            <button className="home__row-btn" onClick={onOpenAccount}>
              <span className="home__row-icon"><PersonIcon /></span>
              <span className="home__row-text">
                <span className="home__row-title">Profile &amp; settings</span>
                <span className="home__row-desc">Display name, notifications, claimed bubble</span>
              </span>
              <ArrowIcon />
            </button>
          </section>
        )}

        <section className="home__section" style={{ '--i': 2 }}>
          <h2 className="home__section-title">Learn</h2>
          <div className="home__learn-grid">
            <div className="home__learn-tile">
              <span className="home__learn-icon"><TapIcon /></span>
              <p className="home__learn-title">Tap a face</p>
              <p className="home__learn-desc">Bring their branch of the family into view.</p>
            </div>
            <div className="home__learn-tile">
              <span className="home__learn-icon"><SearchTileIcon /></span>
              <p className="home__learn-title">Search</p>
              <p className="home__learn-desc">Jump straight to anyone and expand their relationships.</p>
            </div>
            <div className="home__learn-tile">
              <span className="home__learn-icon"><LineageTileIcon /></span>
              <p className="home__learn-title">Lineage mode</p>
              <p className="home__learn-desc">Trace the direct bloodline between two people.</p>
            </div>
            <div className="home__learn-tile">
              <span className="home__learn-icon"><ClockTileIcon /></span>
              <p className="home__learn-title">Timeline</p>
              <p className="home__learn-desc">Play your family's history back in order.</p>
            </div>
          </div>
        </section>

        {user && onLogout && (
          <div className="home__signout">
            <button className="fs__signout-btn" onClick={onLogout}>Sign out</button>
          </div>
        )}
      </div>
    </div>
  );
}

function firstName(name) {
  return (name || '').trim().split(/\s+/)[0] || name;
}

function roleLabel(role) {
  const labels = { owner: 'Owner', coadmin: 'Co-Admin', editor: 'Editor', contributor: 'Contributor', viewer: 'Viewer' };
  return labels[role] || role;
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="home__row-arrow">
      <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.7"/>
      <path d="M4.5 20c1.4-3.6 4.4-5.5 7.5-5.5s6.1 1.9 7.5 5.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
    </svg>
  );
}

function TapIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="8" cy="16" r="2.3" fill="currentColor"/>
      <path d="M12.3 15.6c2.3-1 3.7-3.3 3.7-6.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
      <path d="M15.6 18.2c3.2-1.5 5.2-4.9 5.2-9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.5"/>
    </svg>
  );
}

function SearchTileIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.7"/>
      <path d="M19 19l-3.8-3.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
    </svg>
  );
}

function LineageTileIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="5.5" cy="18.5" r="2.5" stroke="currentColor" strokeWidth="1.6"/>
      <circle cx="18.5" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.6"/>
      <path d="M7.4 16.8C11 12 13 12 16.6 7.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  );
}

function ClockTileIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7"/>
      <path d="M12 7v5l3.2 1.9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

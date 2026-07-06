import { useState, useEffect, useCallback } from 'react';
import Logo from './Logo.jsx';
import { clearLocalData } from '../data/store.js';

/*
 * The home hub — reached by tapping the logo. A calm step outside the tree:
 * switch between trees you belong to, start a brand-new one, jump to account
 * settings, or sign out. Full-screen (not a bottom sheet) so it reads as its
 * own place rather than another overlay stacked on the canvas.
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
      <button className="home__close" onClick={onClose} aria-label="Back to your tree">
        <CloseIcon />
      </button>

      <div className="home__scroll">
        <div className="home__mark">
          <Logo size={52} />
          <p className="home__word">Bloodline</p>
        </div>
        {user && (
          <p className="home__greeting">
            {user.display_name ? `Welcome back, ${user.display_name}.` : `Signed in as ${user.email}.`}
          </p>
        )}

        {user && (
          <section className="home__section">
            <h2 className="home__section-title">Your trees</h2>
            {families == null && <p className="home__hint">Loading…</p>}
            {families && families.length > 0 && (
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
            )}
            {switchError && <p className="up__save-status up__save-status--err">{switchError}</p>}

            <button className="home__create-btn" onClick={createTree} disabled={creating}>
              <PlusIcon />
              {creating ? 'Creating…' : 'Create a new tree'}
            </button>
            {createError && <p className="up__save-status up__save-status--err">{createError}</p>}
            <p className="home__hint">
              Starting a new tree switches you onto it and walks you through setup again —
              your other trees stay exactly as you left them.
            </p>
          </section>
        )}

        {!user && (
          <section className="home__section">
            <h2 className="home__section-title">Your trees</h2>
            <p className="home__hint">
              Sign in to save a tree of your own, invite relatives, and switch between
              multiple trees.
            </p>
          </section>
        )}

        {user && (
          <section className="home__section">
            <h2 className="home__section-title">Account</h2>
            <button className="home__row-btn" onClick={onOpenAccount}>
              <span className="home__row-text">
                <span className="home__row-title">Profile &amp; settings</span>
                <span className="home__row-desc">Display name, notifications, claimed bubble</span>
              </span>
              <ArrowIcon />
            </button>
          </section>
        )}

        <section className="home__section">
          <h2 className="home__section-title">Learn</h2>
          <ul className="home__learn-list">
            <li><strong>Tap a face</strong> to bring their branch of the family into view.</li>
            <li><strong>Search</strong> jumps straight to anyone and expands their relationships.</li>
            <li><strong>Lineage mode</strong> traces the direct bloodline between two people.</li>
            <li><strong>Timeline</strong> plays your family's history back in chronological order.</li>
          </ul>
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
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

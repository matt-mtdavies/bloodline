import { useState, useEffect, useCallback } from 'react';
import Logo from './Logo.jsx';
import { clearLocalData } from '../data/store.js';

/*
 * The home hub — reached by tapping the logo. An editorial arrival moment,
 * not a settings page: a full-bleed hero with drifting bubbles (the tree's
 * own visual motif, brought forward as ambient motion) and a big stat pull,
 * then a magazine-style walkthrough of the tree's key moves, each with its
 * own small looping animation rather than a static glyph.
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

  const currentFamily = families?.find((f) => f.is_current) || null;

  return (
    <div className="home" role="dialog" aria-modal="true" aria-label="Bloodline home">
      <div className="home__hero">
        <div className="home__orbs" aria-hidden="true">
          <span className="home__orb home__orb--wash1" />
          <span className="home__orb home__orb--wash2" />
          <span className="home__orb home__orb--bubble home__orb--b1" />
          <span className="home__orb home__orb--bubble home__orb--b2" />
          <span className="home__orb home__orb--bubble home__orb--b3" />
          <span className="home__orb home__orb--bubble home__orb--b4" />
        </div>
        <button className="home__close" onClick={onClose} aria-label="Back to your tree">
          <CloseIcon />
        </button>

        <div className="home__hero-inner">
          <div className="home__hero-mark"><Logo size={30} /></div>
          {user ? (
            <>
              <p className="home__eyebrow">Welcome back</p>
              <h1 className="home__headline">{firstName(user.display_name) || 'there'}</h1>
              {currentFamily && (
                <div className="home__hero-stat">
                  <span className="home__hero-num">{currentFamily.member_count}</span>
                  <span className="home__hero-stat-text">
                    {currentFamily.member_count === 1 ? 'person' : 'people'} in<br />
                    <strong>{currentFamily.name}</strong>
                  </span>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="home__eyebrow">Bloodline</p>
              <h1 className="home__headline">A living portrait<br />of your family.</h1>
              <p className="home__hero-thesis">The tree is navigation. The profile is the destination.</p>
            </>
          )}
        </div>
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
          <p className="home__eyebrow home__eyebrow--section">A quick tour</p>
          <h2 className="home__section-title home__section-title--big">How it works</h2>
          <div className="home__feature-list">
            <div className="home__feature-row">
              <span className="home__feature-icon home__feature-icon--tap"><TapIcon /></span>
              <span className="home__feature-text">
                <span className="home__feature-title">Tap a face</span>
                <span className="home__feature-desc">Bring their branch of the family into view.</span>
              </span>
            </div>
            <div className="home__feature-row">
              <span className="home__feature-icon home__feature-icon--search"><SearchTileIcon /></span>
              <span className="home__feature-text">
                <span className="home__feature-title">Search</span>
                <span className="home__feature-desc">Jump straight to anyone and expand their relationships.</span>
              </span>
            </div>
            <div className="home__feature-row">
              <span className="home__feature-icon home__feature-icon--lineage"><LineageTileIcon /></span>
              <span className="home__feature-text">
                <span className="home__feature-title">Lineage mode</span>
                <span className="home__feature-desc">Trace the direct bloodline between two people.</span>
              </span>
            </div>
            <div className="home__feature-row">
              <span className="home__feature-icon home__feature-icon--timeline"><ClockTileIcon /></span>
              <span className="home__feature-text">
                <span className="home__feature-title">Timeline</span>
                <span className="home__feature-desc">Play your family's history back in order.</span>
              </span>
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

// Each of these carries its own small infinite loop — a glance at the icon
// IS the demo, not just a label for it.

function TapIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="8" cy="16" r="2.1" fill="currentColor"/>
      <circle className="home__anim-ripple home__anim-ripple--1" cx="8" cy="16" r="4.4" stroke="currentColor" strokeWidth="1.4"/>
      <circle className="home__anim-ripple home__anim-ripple--2" cx="8" cy="16" r="4.4" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  );
}

function SearchTileIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="6" cy="16" r="1.4" fill="currentColor" opacity="0.3"/>
      <circle cx="12" cy="16" r="1.4" fill="currentColor" opacity="0.3"/>
      <circle cx="18" cy="16" r="1.4" fill="currentColor" opacity="0.3"/>
      <g className="home__anim-glass">
        <circle cx="6" cy="9" r="4" stroke="currentColor" strokeWidth="1.6"/>
        <path d="M8.9 12l2.7 2.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
      </g>
    </svg>
  );
}

function LineageTileIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="5.5" cy="18.5" r="2.3" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="18.5" cy="5.5" r="2.3" stroke="currentColor" strokeWidth="1.5"/>
      <path
        className="home__anim-path"
        pathLength="1"
        strokeDasharray="1"
        d="M7.6 16.8C11 12 13 12 16.4 7.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ClockTileIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.3" stroke="currentColor" strokeWidth="1.6"/>
      <line className="home__anim-hand" x1="12" y1="12" x2="12" y2="6.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
      <circle cx="12" cy="12" r="1" fill="currentColor"/>
    </svg>
  );
}

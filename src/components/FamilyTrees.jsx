import { useState, useEffect, useCallback } from 'react';
import Logo from './Logo.jsx';
import { clearLocalData } from '../data/store.js';

/*
 * The family-tree switcher — the list + create/switch actions that used to
 * sit inline on Home under "Your trees", now a page of its own reached by
 * tapping "Family trees" there. Same data, same actions; just off the home
 * scroll so someone with several trees doesn't have to scroll past all of
 * them to reach the rest of the hub.
 */
export default function FamilyTrees({ user, onClose, onGoToTree }) {
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
    <div className="subpage" role="dialog" aria-modal="true" aria-label="Family trees">
      <div className="subpage__top">
        <button className="subpage__close" onClick={onClose} aria-label="Back">
          <BackIcon />
        </button>
        <span className="subpage__top-title">Family trees</span>
        <span className="subpage__top-spacer" aria-hidden="true" />
      </div>

      <div className="subpage__scroll">
        <h1 className="subpage__title">Your family trees</h1>

        {!user && (
          <p className="home__hint">
            Sign in to save a tree of your own, invite relatives, and switch between
            multiple trees.
          </p>
        )}

        {user && families == null && <p className="home__hint">Loading…</p>}

        {user && families && families.length > 0 && (
          <div className="home__tree-list">
            {families.map((f) => {
              // The tree you're already on is a zero-risk tap straight back
              // to the canvas — the whole row is clickable. Switching to a
              // different tree reloads and clears the local cache, so that
              // stays a deliberate tap on its own smaller button instead.
              const Row = f.is_current ? 'button' : 'div';
              return (
                <Row
                  key={f.family_id}
                  type={f.is_current ? 'button' : undefined}
                  onClick={f.is_current ? onGoToTree : undefined}
                  className={`home__tree-row${f.is_current ? ' home__tree-row--current home__tree-row--clickable' : ''}`}
                >
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
                </Row>
              );
            })}
          </div>
        )}
        {switchError && <p className="up__save-status up__save-status--err">{switchError}</p>}

        {user && (
          <button className="home__row-btn home__row-btn--create" onClick={createTree} disabled={creating}>
            <span className="home__row-icon home__row-icon--create"><PlusIcon /></span>
            <span className="home__row-text">
              <span className="home__row-title">{creating ? 'Creating…' : 'Create a new tree'}</span>
              <span className="home__row-desc">Start fresh — your other trees stay untouched</span>
            </span>
            <ArrowIcon />
          </button>
        )}
        {createError && <p className="up__save-status up__save-status--err">{createError}</p>}
      </div>
    </div>
  );
}

function roleLabel(role) {
  const labels = { owner: 'Owner', coadmin: 'Co-Admin', editor: 'Editor', contributor: 'Contributor', viewer: 'Viewer' };
  return labels[role] || role;
}

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="home__row-arrow">
      <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

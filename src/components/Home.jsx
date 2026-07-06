import { useState, useEffect, useCallback } from 'react';
import Logo from './Logo.jsx';
import { clearLocalData } from '../data/store.js';

/*
 * The home hub — reached by tapping the logo. Built like a product page,
 * not a settings screen: a real stat card up top (your actual family's
 * numbers, not marketing copy), then a walkthrough where each feature is a
 * small faithful mockup of its real in-app look — the ripple when you tap a
 * face, the card a search result lands in, the path Lineage mode draws, the
 * scrubber Timeline plays — rather than a static icon standing in for it.
 */
export default function Home({ user, familyName, stats = null, onClose, onOpenAccount, onLogout }) {
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

  const first = user?.display_name ? firstName(user.display_name) : null;
  const insights = buildInsights(stats);

  return (
    <div className="home" role="dialog" aria-modal="true" aria-label="Bloodline home">
      <div className="home__top">
        <div className="home__brand">
          <Logo size={22} animate={false} />
          <span className="home__brand-word">Bloodline</span>
        </div>
        <button className="home__close" onClick={onClose} aria-label="Back to your tree">
          <CloseIcon />
        </button>
      </div>

      <div className="home__scroll">
        {/* The hero: real numbers from this family's own tree, not stock copy */}
        <div className="home__hero-card">
          <div className="home__hero-card-head">
            <p className="home__hero-card-eyebrow">{first ? `Welcome back, ${first}` : 'Currently viewing'}</p>
            <h2 className="home__hero-card-title">{familyName || 'Your family'}</h2>
            {stats && stats.people > 0 && (
              <p className="home__hero-card-sub">
                {stats.people} {stats.people === 1 ? 'person' : 'people'}
                {stats.yearSpan && <> · {stats.yearSpan}</>}
              </p>
            )}
          </div>

          <TreeConstellation />

          {insights.length > 0 && (
            <div className="home__insights">
              {insights.map((row, i) => (
                <div className="home__insight-row" key={i}>
                  <span className={`home__insight-icon home__insight-icon--${row.tone}`}>{row.icon}</span>
                  <div className="home__insight-text">
                    <span className="home__insight-stat">{row.stat}</span>
                    <span className="home__insight-desc">{row.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* The editorial line — the brief's own thesis, given room to breathe */}
        <div className="home__editorial">
          <h1 className="home__editorial-head">
            The tree is navigation.<br />
            <em>The profile is the destination.</em>
          </h1>
          <p className="home__editorial-sub">
            Tap into any branch to bring it into focus, trace a straight line of blood
            between two people, or watch your family's history unfold year by year.
          </p>
        </div>

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

          <div className="home__feature-card">
            <TapMock />
            <div className="home__feature-text">
              <span className="home__feature-title">Tap a face</span>
              <span className="home__feature-desc">Bring their branch of the family into view.</span>
            </div>
          </div>

          <div className="home__feature-card">
            <SearchMock />
            <div className="home__feature-text">
              <span className="home__feature-title">Search</span>
              <span className="home__feature-desc">Jump straight to anyone and expand their relationships.</span>
            </div>
          </div>

          <div className="home__feature-card">
            <LineageMock />
            <div className="home__feature-text">
              <span className="home__feature-title">Lineage mode</span>
              <span className="home__feature-desc">Trace the direct bloodline between two people.</span>
            </div>
          </div>

          <div className="home__feature-card">
            <TimelineMock />
            <div className="home__feature-text">
              <span className="home__feature-title">Timeline</span>
              <span className="home__feature-desc">Play your family's history back in order.</span>
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

// Builds up to two real, computed facts about this family for the hero card
// — the same trick as showing an actual chart instead of a generic graphic.
function buildInsights(stats) {
  if (!stats || !stats.people) return [];
  const rows = [];
  rows.push({
    tone: 'accent',
    icon: <CheckGlyph />,
    stat: `${stats.withPhoto} of ${stats.people}`,
    desc: 'people have a portrait added',
  });
  if (stats.yearSpan && stats.yearMin && stats.yearMax && stats.yearMax > stats.yearMin) {
    rows.push({
      tone: 'sage',
      icon: <SparkGlyph />,
      stat: stats.yearSpan,
      desc: `${stats.yearMax - stats.yearMin} years of family history captured`,
    });
  } else if (stats.surnames) {
    rows.push({
      tone: 'sage',
      icon: <SparkGlyph />,
      stat: stats.surnames,
      desc: 'surnames carried through your tree',
    });
  }
  return rows;
}

/* ── The hero's centrepiece: a small family-tree graphic instead of a
   generic chart, reusing the same three-generation shape as the intro. */
function TreeConstellation() {
  return (
    <svg className="home__constellation" viewBox="0 0 200 150" aria-hidden="true">
      <line x1="100" y1="26" x2="100" y2="62" stroke="var(--hairline)" strokeWidth="1.6" />
      <line x1="100" y1="62" x2="54" y2="96" stroke="var(--hairline)" strokeWidth="1.6" />
      <line x1="100" y1="62" x2="146" y2="96" stroke="var(--hairline)" strokeWidth="1.6" />
      <line x1="54" y1="96" x2="34" y2="132" stroke="var(--hairline)" strokeWidth="1.6" />
      <line x1="54" y1="96" x2="74" y2="132" stroke="var(--hairline)" strokeWidth="1.6" />
      <circle className="home__const-node home__const-node--1" cx="100" cy="18" r="16" fill="#c2603a" />
      <circle className="home__const-node home__const-node--2" cx="54" cy="88" r="14.5" fill="#3f5e4e" />
      <circle className="home__const-node home__const-node--3" cx="146" cy="88" r="14.5" fill="#b08642" />
      <circle className="home__const-node home__const-node--4" cx="34" cy="138" r="11" fill="#6b5e7a" />
      <circle className="home__const-node home__const-node--5" cx="74" cy="138" r="11" fill="#a44d2c" />
    </svg>
  );
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

function CheckGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function SparkGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l1.8 4.9L18.7 9.7l-4.9 1.8L12 16.4l-1.8-4.9L5.3 9.7l4.9-1.8L12 3z" fill="currentColor"/>
    </svg>
  );
}

/* ── Feature mockups — small faithful reproductions of the real in-app
   look, each animating on its own loop, standing in for a screenshot. */

function TapMock() {
  return (
    <div className="home__mock home__mock--tap">
      <svg className="home__mock-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <line x1="50" y1="54" x2="24" y2="30" stroke="var(--hairline)" strokeWidth="1.4" />
        <line x1="50" y1="54" x2="76" y2="26" stroke="var(--hairline)" strokeWidth="1.4" />
      </svg>
      <span className="home__mock-bubble home__mock-tap-neighbor" style={{ left: '24%', top: '30%', width: 30, height: 30, background: '#3f5e4e' }} />
      <span className="home__mock-bubble home__mock-tap-neighbor" style={{ left: '76%', top: '26%', width: 26, height: 26, background: '#b08642' }} />
      <span className="home__mock-bubble" style={{ left: '70%', top: '78%', width: 22, height: 22, background: '#6b5e7a', opacity: 0.55 }} />
      <span className="home__mock-bubble home__mock-bubble--focus" style={{ left: '50%', top: '54%', width: 40, height: 40, background: '#c2603a' }}>
        <span className="home__mock-ripple home__mock-ripple--1" />
        <span className="home__mock-ripple home__mock-ripple--2" />
      </span>
      <span className="home__mock-pill home__mock-tap-pill" style={{ left: '50%', top: '26%' }}>Grandma Rose</span>
      <span className="home__mock-touch" style={{ left: '50%', top: '54%' }} />
    </div>
  );
}

function SearchMock() {
  return (
    <div className="home__mock home__mock--search">
      <div className="home__mock-searchbar">
        <SearchGlyph />
        <span className="home__mock-typing">Grandma Rose</span>
      </div>
      <div className="home__mock-result">
        <span className="home__mock-result-avatar" />
        <span className="home__mock-result-text">
          <strong>Rose Carter</strong>
          <em>Maternal grandmother</em>
        </span>
      </div>
    </div>
  );
}

function SearchGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8"/>
      <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );
}

function LineageMock() {
  return (
    <div className="home__mock">
      <svg className="home__mock-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path
          className="home__mock-lineage-path"
          pathLength="1"
          strokeDasharray="1"
          d="M18 78 C 40 78 40 30 50 30 S 70 55 82 22"
          stroke="var(--sage)"
          strokeWidth="2.2"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
      <span className="home__mock-bubble home__mock-bubble--muted" style={{ left: '40%', top: '50%', width: 18, height: 18, background: '#b0a898' }} />
      <span className="home__mock-bubble home__mock-bubble--muted" style={{ left: '60%', top: '62%', width: 16, height: 16, background: '#b0a898' }} />
      <span className="home__mock-bubble home__mock-bubble--end home__mock-lineage-end" style={{ left: '18%', top: '78%', width: 28, height: 28, background: '#3f5e4e' }} />
      <span className="home__mock-bubble home__mock-bubble--end home__mock-lineage-end" style={{ left: '82%', top: '22%', width: 28, height: 28, background: '#3f5e4e' }} />
      <span className="home__mock-pill home__mock-lineage-label" style={{ left: '58%', top: '46%' }}>3 generations</span>
    </div>
  );
}

function TimelineMock() {
  return (
    <div className="home__mock home__mock--timeline">
      <div className="home__mock-track">
        <span className="home__mock-tick home__mock-tick--start">1952</span>
        <span className="home__mock-tick home__mock-tick--end">2024</span>
        <span className="home__mock-playhead" />
      </div>
      <span className="home__mock-tl-node home__mock-tl-node--1" style={{ background: '#c2603a' }} />
      <span className="home__mock-tl-node home__mock-tl-node--2" style={{ background: '#3f5e4e' }} />
      <span className="home__mock-tl-node home__mock-tl-node--3" style={{ background: '#b08642' }} />
      <span className="home__mock-play-btn"><PlayGlyph /></span>
    </div>
  );
}

function PlayGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 4l15 8-15 8V4z" />
    </svg>
  );
}

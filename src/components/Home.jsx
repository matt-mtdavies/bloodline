import { useState } from 'react';
import Logo from './Logo.jsx';
import { ActivityRow } from './ActivityFeed.jsx';

/*
 * The home hub — reached by tapping the logo. A launch point, not the whole
 * app in one scroll: a real stat card up top (your actual family's numbers,
 * not marketing copy), a condensed look at what's changed recently, and a
 * tight checklist that hands off to dedicated pages (family trees, the
 * tutorial clips, account, install) rather than stacking all of it inline.
 */
export default function Home({
  user, familyName, stats = null, activity = [], people = [], userEmail,
  onClose, onOpenAccount, onLogout, onOpenInstall, onOpenHowItWorks, onOpenFamilyTrees,
  onOpenActivity, onSelectPerson,
}) {
  // Already-installed (standalone) visits have nothing to gain from this
  // row, so it only shows where it's actually actionable.
  const [isStandalone] = useState(
    () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone || false,
  );

  const first = user?.display_name ? firstName(user.display_name) : null;
  const tiles = buildStatTiles(stats);
  const recent = activity.slice(0, 3);
  const byId = new Map(people.map((p) => [p.id, p]));
  const nameByEmail = new Map();
  for (const p of people) {
    for (const e of [p.email, p.invited_email]) {
      if (e) nameByEmail.set(e.toLowerCase(), p.display_name);
    }
  }

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

          {tiles.length > 0 && (
            <div className="home__stat-grid">
              {tiles.map((t, i) => (
                <div className="home__stat-tile" key={i}>
                  <span className="home__stat-value">{t.value}</span>
                  <span className="home__stat-label">{t.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* The editorial line — the brief's own thesis, given room to breathe */}
        <div className="home__editorial">
          <h1 className="home__editorial-head">
            The tree is where you explore.<br />
            <em>The profile is where you discover.</em>
          </h1>
          <p className="home__editorial-sub">
            Tap into any branch to bring it into focus, trace a straight line of blood
            between two people, or watch your family's history unfold year by year.
          </p>
        </div>

        <div className="home__row">
          {recent.length > 0 && onOpenActivity && (
            <section className="home__section" style={{ '--i': 0 }}>
              <h2 className="home__section-title">Continue your journey</h2>
              <div className="home__recent-list">
                {recent.map((event) => (
                  <ActivityRow
                    key={event.id}
                    event={event}
                    person={byId.get(event.personId) ?? { display_name: event.personName }}
                    userEmail={userEmail}
                    nameByEmail={nameByEmail}
                    onSelect={() => onSelectPerson?.(event.personId)}
                  />
                ))}
              </div>
              <button className="home__view-all" onClick={onOpenActivity}>View all recent activity</button>
            </section>
          )}

          <section className="home__section" style={{ '--i': 1 }}>
            <h2 className="home__section-title">Explore</h2>

            {onOpenFamilyTrees && (
              <button className="home__row-btn" onClick={onOpenFamilyTrees}>
                <span className="home__row-icon"><TreeIcon /></span>
                <span className="home__row-text">
                  <span className="home__row-title">Family trees</span>
                  <span className="home__row-desc">
                    {user ? 'Switch trees, or start a new one' : 'Sign in to save a tree of your own'}
                  </span>
                </span>
                <ArrowIcon />
              </button>
            )}

            {onOpenHowItWorks && (
              <button className="home__row-btn" onClick={onOpenHowItWorks}>
                <span className="home__row-icon"><PlayIcon /></span>
                <span className="home__row-text">
                  <span className="home__row-title">How it works</span>
                  <span className="home__row-desc">A quick tour of tap, search, lineage and timeline</span>
                </span>
                <ArrowIcon />
              </button>
            )}

            {user && (
              <button className="home__row-btn" onClick={onOpenAccount}>
                <span className="home__row-icon"><PersonIcon /></span>
                <span className="home__row-text">
                  <span className="home__row-title">Profile &amp; settings</span>
                  <span className="home__row-desc">Display name, notifications, claimed bubble</span>
                </span>
                <ArrowIcon />
              </button>
            )}

            {!isStandalone && onOpenInstall && (
              <button className="home__row-btn" onClick={onOpenInstall}>
                <span className="home__row-icon"><InstallIcon /></span>
                <span className="home__row-text">
                  <span className="home__row-title">Install Bloodline</span>
                  <span className="home__row-desc">Add it to your home screen or dock for full-screen access</span>
                </span>
                <ArrowIcon />
              </button>
            )}
          </section>
        </div>

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

// Up to four real, computed facts about this family for the hero card — the
// same trick as showing an actual chart instead of a generic graphic. The
// first tile is either the family's year span or, failing that (no birth
// dates recorded yet), how many surnames it carries — never both, since
// they're two ways of answering the same "how much history is here" beat.
function buildStatTiles(stats) {
  if (!stats || !stats.people) return [];
  const tiles = [];
  if (stats.yearMin != null && stats.yearMax != null && stats.yearMax > stats.yearMin) {
    tiles.push({ value: String(stats.yearMax - stats.yearMin), label: 'Years of history' });
  } else if (stats.surnames) {
    tiles.push({ value: stats.surnames, label: 'Surnames carried' });
  }
  tiles.push({ value: String(stats.withPhoto), label: 'Faces preserved' });
  tiles.push({ value: String(stats.connections), label: 'Family connections' });
  tiles.push({ value: String(stats.memories), label: 'Stories recorded' });
  return tiles;
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

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="home__row-arrow">
      <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function InstallIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3v12M12 15l-4.5-4.5M12 15l4.5-4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M4.5 16v3a2 2 0 002 2h11a2 2 0 002-2v-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
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

function TreeIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="6" r="3.2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="6" cy="17" r="3.2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="18" cy="17" r="3.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 9.2v3.3M12 12.5L6 14.2M12 12.5l6 1.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10 8.5l6 3.5-6 3.5v-7z" fill="currentColor" />
    </svg>
  );
}

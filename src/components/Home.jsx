import { useState, useMemo } from 'react';
import Logo from './Logo.jsx';
import { ActivityRow } from './ActivityFeed.jsx';
import { computeThisMonth, computeInsightModules, pickDailyHighlight } from '../lib/insightModules.js';

/*
 * The home hub — reached by tapping the logo. A launch point, not the whole
 * app in one scroll: a real stat card up top (your actual family's numbers,
 * not marketing copy), a condensed look at what's changed recently, and a
 * tight checklist that hands off to dedicated pages (family trees, the
 * tutorial clips, account, install) rather than stacking all of it inline.
 */
export default function Home({
  user, familyName, stats = null, activity = [], people = [], graph = null, userEmail,
  onClose, onOpenAccount, onLogout, onOpenInstall, onOpenHowItWorks, onOpenFamilyTrees,
  onOpenActivity, onSelectPerson, onOpenFamilySettings, onOpenInsights,
  keepsakeNudge = null, onOpenKeepsake = null,
}) {
  // Already-installed (standalone) visits have nothing to gain from this
  // row, so it only shows where it's actually actionable.
  const [isStandalone] = useState(
    () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone || false,
  );

  const first = user?.display_name ? firstName(user.display_name) : null;
  const tiles = buildStatTiles(stats);
  const thisMonth = useMemo(() => (graph ? computeThisMonth(graph) : null), [graph]);
  // No specific viewer stands behind the hub, so only the modules that don't
  // lean on "your" position in the tree (see pickDailyHighlight) contribute.
  const insightTeaser = useMemo(
    () => (graph ? pickDailyHighlight(computeInsightModules(graph, null)) : null),
    [graph],
  );
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

        {thisMonth && (
          <ThisMonth data={thisMonth} onSelectPerson={onSelectPerson} />
        )}

        {insightTeaser && onOpenInsights && (
          <button className="home__insights-card" onClick={onOpenInsights}>
            <span className="home__insights-ico"><SparkIcon /></span>
            <span className="home__insights-body">
              <span className="home__insights-label">Did you know?</span>
              <span className="home__insights-text">{insightTeaser}</span>
            </span>
            <ArrowIcon />
          </button>
        )}

        {/* The Keepsake loop made visible: compile it, and come back when the
            tree has grown past the last edition (docs/KEEPSAKE.md Phase 5). */}
        {keepsakeNudge && onOpenKeepsake && (
          <button className="home__insights-card home__insights-card--keepsake" onClick={onOpenKeepsake}>
            <span className="home__insights-ico"><BookIcon /></span>
            <span className="home__insights-body">
              <span className="home__insights-label">Your Keepsake</span>
              <span className="home__insights-text">
                {keepsakeNudge === 'create'
                  ? 'The illustrated story of your life, ready to be compiled from the family’s records.'
                  : keepsakeNudge === 'stale'
                  ? 'The tree has grown since your last edition — weave the changes in.'
                  : 'Open the illustrated story of your life.'}
              </span>
            </span>
            <ArrowIcon />
          </button>
        )}

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

            {onOpenFamilySettings && (
              <button className="home__row-btn" onClick={onOpenFamilySettings}>
                <span className="home__row-icon"><SettingsIcon /></span>
                <span className="home__row-text">
                  <span className="home__row-title">Family settings</span>
                  <span className="home__row-desc">Invite people, manage roles, rename the family</span>
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

// A practical, always-current digest — not a threshold-gated "insight" (see
// lib/insightModules.js#computeThisMonth). Capped by default so a
// birthday-heavy family doesn't turn the hub into a scrolling calendar —
// "+N more" just expands the same list in place, no navigating away and
// losing your spot on Home.
const MONTH_CAP = 5;
function ThisMonth({ data, onSelectPerson }) {
  const { month, birthdays, anniversaries } = data;
  const [expanded, setExpanded] = useState(false);
  const all = [
    ...birthdays.map((b) => ({ kind: 'birthday', day: b.day, ...b })),
    ...anniversaries.map((a) => ({ kind: 'anniversary', day: a.day, ...a })),
  ].sort((a, b) => a.day - b.day);
  const items = expanded ? all : all.slice(0, MONTH_CAP);
  const overflow = all.length - MONTH_CAP;

  return (
    <section className="home__section home__month" style={{ '--i': 0 }}>
      <h2 className="home__section-title">{month} in your family</h2>
      <div className="home__month-list">
        {items.map((item) => (
          <button
            key={`${item.kind}-${item.kind === 'birthday' ? item.id : item.aId + item.bId}`}
            className={`home__month-row${item.isToday ? ' home__month-row--today' : ''}`}
            onClick={() => onSelectPerson?.(item.kind === 'birthday' ? item.id : item.aId)}
          >
            <span className="home__month-day">{item.day}</span>
            <span className="home__month-body">
              {item.kind === 'birthday' ? (
                <>
                  <span className="home__month-t">{item.name}</span>
                  <span className="home__month-d">
                    {item.isToday ? 'Birthday today' : 'Birthday'}
                    {item.turning != null ? ` · turning ${item.turning}` : ''}
                  </span>
                </>
              ) : (
                <>
                  <span className="home__month-t">{item.aName} &amp; {item.bName}</span>
                  <span className="home__month-d">
                    {item.isToday ? 'Anniversary today' : 'Anniversary'} · {item.years} {item.years === 1 ? 'year' : 'years'}
                  </span>
                </>
              )}
            </span>
          </button>
        ))}
      </div>
      {overflow > 0 && (
        <button className="home__month-more" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show less' : `+${overflow} more this month`}
        </button>
      )}
    </section>
  );
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

function SettingsIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function BookIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 8h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l1.8 4.9L18.7 9.7l-4.9 1.8L12 16.4l-1.8-4.9L5.3 9.7l4.9-1.8L12 3z" fill="currentColor"/>
      <path d="M19 14l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7L19 14z" fill="currentColor" opacity="0.7"/>
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

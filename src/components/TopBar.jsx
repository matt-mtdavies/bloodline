import { useState, useRef, useEffect, forwardRef } from 'react';
import Logo from './Logo.jsx';

export default function TopBar({ familyName, stats, view, syncStatus, onToggleView, onOpenLegend, onOpenSettings, onOpenActivity, activityCount = 0, user, userPhoto, onOpenProfile }) {
  const [statsOpen, setStatsOpen] = useState(false);
  const popoverRef = useRef(null);
  const statsRef = useRef(null);

  useEffect(() => {
    if (!statsOpen) return;
    const onDown = (e) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target) &&
        statsRef.current && !statsRef.current.contains(e.target)
      ) {
        setStatsOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') setStatsOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [statsOpen]);

  return (
    <header className="topbar">
      {/* Row 1: app brand left, actions right */}
      <div className="topbar__bar">
        <div className="topbar__brand">
          <Logo size={26} />
          <span className="topbar__word">Bloodline</span>
        </div>
        <div className="topbar__actions">
          {syncStatus === 'saving' && (
            <span className="sync-status sync-status--saving" aria-live="polite">Saving…</span>
          )}
          {syncStatus === 'saved' && (
            <span className="sync-status sync-status--saved" aria-live="polite"><SavedCheckIcon /> Saved</span>
          )}
          {syncStatus === 'error' && (
            <span className="sync-status sync-status--error" aria-live="assertive">Not saved — retrying…</span>
          )}
          {syncStatus === 'error-auth' && (
            <span className="sync-status sync-status--error" aria-live="assertive">Session expired — please reload</span>
          )}
          <button
            className="pill pill--bell"
            onClick={onOpenActivity}
            aria-label={activityCount ? `Family activity — ${activityCount} new` : 'Family activity'}
          >
            <BellIcon />
            {activityCount > 0 && (
              <span className="activity-badge" aria-hidden="true">
                {activityCount > 9 ? '9+' : activityCount}
              </span>
            )}
          </button>
          <button className="pill" onClick={onOpenSettings} aria-label="Family settings">
            <SettingsIcon />
          </button>
          {user && onOpenProfile && (
            <button
              className="topbar-avatar"
              onClick={onOpenProfile}
              aria-label="Your profile"
              title={user.display_name || user.email}
            >
              {userPhoto
                ? <img src={userPhoto} alt="" className="topbar-avatar__img" />
                : userInitials(user)
              }
            </button>
          )}
        </div>
      </div>

      {/* Row 2: legend (left) + family name + stats (centre) + view toggle (right) */}
      <div className="topbar__treerow">
        <button
          className="topbar__row2-btn"
          onClick={onOpenLegend}
          aria-label="Legend — visual guide and display options"
        >
          <LegendIcon />
        </button>
        <div className="topbar__treerow__center">
          <span className="topbar__familyname">{familyName}</span>
          {stats && stats.people > 0 && (
            <button
              ref={statsRef}
              className={`topbar__stats topbar__stats--btn${statsOpen ? ' topbar__stats--active' : ''}`}
              onClick={() => setStatsOpen((s) => !s)}
              aria-label="View family archive details"
              aria-expanded={statsOpen}
            >
              {stats.people} {stats.people === 1 ? 'person' : 'people'}
              {stats.surnames && <> · {stats.surnames}</>}
              {stats.yearSpan && <> · {stats.yearSpan}</>}
              {stats.photos > 0 && <> · {stats.photos} {stats.photos === 1 ? 'photo' : 'photos'}</>}
              {stats.memories > 0 && <> · {stats.memories} {stats.memories === 1 ? 'memory' : 'memories'}</>}
            </button>
          )}
        </div>
        <button
          className="topbar__row2-btn"
          onClick={onToggleView}
          aria-label={view === 'bubbles' ? 'Switch to list view' : 'Switch to tree view'}
        >
          {view === 'bubbles' ? <ListIcon /> : <TreeIcon />}
        </button>
      </div>

      {/* Stats detail popover */}
      {statsOpen && stats && (
        <StatsPopover ref={popoverRef} stats={stats} onClose={() => setStatsOpen(false)} />
      )}
    </header>
  );
}

const StatsPopover = forwardRef(function StatsPopover({ stats, onClose }, ref) {
  const total = stats.people;
  const maxCount = stats.surnameList?.[0]?.count ?? 1;
  const spanYears = stats.yearMin && stats.yearMax ? stats.yearMax - stats.yearMin : null;

  return (
    <div ref={ref} className="stats-popover" role="dialog" aria-label="Family archive details">
      <button className="stats-popover__close" onClick={onClose} aria-label="Close">
        <CloseIcon />
      </button>

      {/* Surnames */}
      {stats.surnameList?.length > 0 && (
        <section className="stats-popover__section">
          <h3 className="stats-popover__heading">Surnames</h3>
          <ul className="stats-popover__surname-list">
            {stats.surnameList.map(({ name, count }) => (
              <li key={name} className="stats-popover__surname-row">
                <span className="stats-popover__surname-name">{name}</span>
                <div className="stats-bar">
                  <div
                    className="stats-bar__fill"
                    style={{ width: `${Math.round((count / maxCount) * 100)}%` }}
                  />
                </div>
                <span className="stats-popover__surname-count">{count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Time span */}
      {stats.yearMin && (
        <section className="stats-popover__section">
          <h3 className="stats-popover__heading">Time span</h3>
          <p className="stats-popover__span-label">
            {stats.yearMin}
            {stats.yearMax !== stats.yearMin && <> – {stats.yearMax}</>}
            {spanYears > 0 && <span className="stats-popover__muted"> · {spanYears} years</span>}
          </p>
          {stats.oldestName && (
            <p className="stats-popover__timerow">
              <span className="stats-popover__muted">Earliest</span>
              {stats.oldestName}
              <span className="stats-popover__muted">({stats.yearMin})</span>
            </p>
          )}
          {stats.youngestName && stats.youngestName !== stats.oldestName && (
            <p className="stats-popover__timerow">
              <span className="stats-popover__muted">Latest</span>
              {stats.youngestName}
              <span className="stats-popover__muted">({stats.yearMax})</span>
            </p>
          )}
        </section>
      )}

      {/* Completeness */}
      <section className="stats-popover__section">
        <h3 className="stats-popover__heading">Archive completeness</h3>
        <ul className="stats-popover__completeness-list">
          <CompRow label="Portraits" value={stats.withPhoto} total={total} />
          <CompRow label="Biographies" value={stats.withBio} total={total} />
          <CompRow label="Birth dates" value={stats.withBirthDate} total={total} />
        </ul>
      </section>

      {/* Totals footer */}
      {(stats.photos > 0 || stats.memories > 0) && (
        <p className="stats-popover__footer">
          {stats.photos > 0 && <>{stats.photos} {stats.photos === 1 ? 'photo' : 'photos'}</>}
          {stats.photos > 0 && stats.memories > 0 && <> · </>}
          {stats.memories > 0 && <>{stats.memories} {stats.memories === 1 ? 'memory' : 'memories'}</>}
        </p>
      )}
    </div>
  );
});

function CompRow({ label, value, total }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <li className="stats-popover__comp-row">
      <span className="stats-popover__comp-label">{label}</span>
      <div className="stats-bar stats-bar--comp">
        <div className="stats-bar__fill stats-bar__fill--comp" style={{ width: `${pct}%` }} />
      </div>
      <span className="stats-popover__comp-count">{value} / {total}</span>
    </li>
  );
}

function userInitials(user) {
  const src = user.display_name || user.email || '';
  const parts = src.trim().split(/[\s@._]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.slice(0, 2) ?? '?').toUpperCase();
}

/* ── Icons ──────────────────────────────────────────────────────────────── */

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

function SavedCheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
      <circle cx="9" cy="6" r="2.2" fill="white" stroke="currentColor" strokeWidth="1.6"/>
      <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
      <circle cx="16" cy="12" r="2.2" fill="white" stroke="currentColor" strokeWidth="1.6"/>
      <line x1="4" y1="18" x2="20" y2="18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
      <circle cx="10" cy="18" r="2.2" fill="white" stroke="currentColor" strokeWidth="1.6"/>
    </svg>
  );
}

function LegendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="8" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.6"/>
      <path d="M12.5 12h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
      <path d="M17 12v2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
      <path d="M19.5 12v1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{flexShrink:0}}>
      <line x1="9" y1="6" x2="20" y2="6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      <line x1="9" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      <line x1="9" y1="18" x2="20" y2="18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      <circle cx="5" cy="6" r="1.2" fill="currentColor"/>
      <circle cx="5" cy="12" r="1.2" fill="currentColor"/>
      <circle cx="5" cy="18" r="1.2" fill="currentColor"/>
    </svg>
  );
}

function TreeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{flexShrink:0}}>
      <circle cx="12" cy="4" r="2.2" stroke="currentColor" strokeWidth="1.6"/>
      <circle cx="5" cy="19" r="2.2" stroke="currentColor" strokeWidth="1.6"/>
      <circle cx="19" cy="19" r="2.2" stroke="currentColor" strokeWidth="1.6"/>
      <path d="M12 6.2v5.3M12 11.5l-5 4.8M12 11.5l5 4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  );
}

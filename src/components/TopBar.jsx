import { useState, useRef, useEffect, forwardRef } from 'react';
import Logo from './Logo.jsx';

export default function TopBar({ familyName, stats, view, layout, syncStatus, syncError, onRetrySync, onSetViewMode, onOpenLegend, bloodlineOnly = false, onToggleBloodlineOnly, onOpenSettings, onOpenActivity, activityCount = 0, user, userPhoto, onOpenProfile, onOpenHome, onSearch, onOpenInsights, onOpenTimeline, onOpenDuplicates, duplicateCount = 0, storageWarning, syncToast, onDismissSyncToast, recapNudgeCount = 0, onShowRecap, onDismissRecapNudge }) {
  const [statsOpen, setStatsOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const popoverRef = useRef(null);
  const statsRef = useRef(null);
  const viewMenuRef = useRef(null);
  const viewMenuBtnRef = useRef(null);

  // The three ways of seeing the family — tree is the default, chart trades
  // the organic camera for a traditional static chart, list drops canvas
  // entirely for a screen-reader-friendly directory. Layout (organic/chart)
  // only means anything while view === 'bubbles', hence the nesting here.
  const viewMode = view !== 'bubbles' ? 'list' : layout === 'chart' ? 'chart' : 'tree';

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

  useEffect(() => {
    if (!viewMenuOpen) return;
    const onDown = (e) => {
      if (
        viewMenuRef.current && !viewMenuRef.current.contains(e.target) &&
        viewMenuBtnRef.current && !viewMenuBtnRef.current.contains(e.target)
      ) {
        setViewMenuOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') setViewMenuOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [viewMenuOpen]);

  return (
    <header className="topbar">
      {/* Row 1: app brand left, actions right */}
      <div className="topbar__bar">
        <button className="topbar__brand" onClick={onOpenHome} aria-label="Home">
          <Logo size={26} idle />
          <span className="topbar__word">Bloodline</span>
          <span className="hover-tip hover-tip--down">Home</span>
        </button>
        <div className="topbar__actions">
          {onSearch && (
            <button className="pill" onClick={onSearch} aria-label="Search family members">
              <TopBarSearchIcon />
              <span className="hover-tip hover-tip--down">Search</span>
            </button>
          )}
          {syncStatus === 'saving' && (
            <span className="sync-status sync-status--saving" aria-live="polite">Saving…</span>
          )}
          {syncStatus === 'saved' && (
            <span className="sync-status sync-status--saved" aria-live="polite"><SavedCheckIcon /> Saved</span>
          )}
          {syncStatus === 'error' && (
            <button
              className="sync-status sync-status--error sync-status--retry"
              aria-live="assertive"
              onClick={onRetrySync}
              title="Tap to retry now"
            >
              Not saved{syncError?.code ? ` (${syncError.message})` : ''} — tap to retry
            </button>
          )}
          {syncStatus === 'error-auth' && (
            <span className="sync-status sync-status--error" aria-live="assertive">Session expired — please reload</span>
          )}
          {syncStatus === 'error-forbidden' && (
            <span className="sync-status sync-status--error" aria-live="assertive">
              {syncError?.message || 'Not allowed — ask a co-admin'}
            </span>
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
            <span className="hover-tip hover-tip--down">Activity</span>
          </button>
          <button className="pill" onClick={onOpenSettings} aria-label="Family settings">
            <SettingsIcon />
            <span className="hover-tip hover-tip--down">Settings</span>
          </button>
          {user && onOpenProfile && (
            <button
              className="topbar-avatar"
              onClick={onOpenProfile}
              aria-label="Your profile"
            >
              {userPhoto
                ? <img src={userPhoto} alt="" className="topbar-avatar__img" />
                : <span className="topbar-avatar__initials">{userInitials(user)}</span>
              }
              <span className="hover-tip hover-tip--down">{user.display_name || user.email}</span>
            </button>
          )}
        </div>
      </div>

      {/* Row 2: legend (left, alone — it's a reference/help icon) + family
          name + stats (centre) + view toggle & bloodline-only (right,
          stacked — both are "how the tree displays" controls, so they read
          as one cluster and keep the row visually balanced left/right). */}
      <div className="topbar__treerow">
        <button
          className="topbar__row2-btn"
          onClick={onOpenLegend}
          aria-label="Legend — visual guide and display options"
        >
          <LegendIcon />
          <span className="hover-tip hover-tip--right">Legend</span>
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
              {/* Leads the string (not trailing) — the pill truncates with an
                  ellipsis once it runs long on a real family, and a flag
                  appended at the end would silently never render. */}
              {bloodlineOnly && <><span className="topbar__stats-flag">Bloodline only</span> · </>}
              {stats.people} {stats.people === 1 ? 'person' : 'people'}
              {stats.surnames && <> · {stats.surnames}</>}
              {stats.yearSpan && <> · {stats.yearSpan}</>}
              {stats.photos > 0 && <> · {stats.photos} {stats.photos === 1 ? 'photo' : 'photos'}</>}
              {stats.memories > 0 && <> · {stats.memories} {stats.memories === 1 ? 'memory' : 'memories'}</>}
            </button>
          )}
        </div>
        <div className="topbar__row2-stack topbar__row2-stack--right">
          <button
            ref={viewMenuBtnRef}
            className={`topbar__row2-btn${viewMenuOpen ? ' topbar__row2-btn--active' : ''}`}
            onClick={() => setViewMenuOpen((o) => !o)}
            aria-label="Change how the family is shown"
            aria-expanded={viewMenuOpen}
          >
            <span className="viewmode-trigger__icon">
              {viewModeIcon(viewMode)}
              <ChevronDownMiniIcon />
            </span>
            {/* Names the CONTROL, not the current state — a click here opens
                a picker between three modes now, it doesn't just toggle to
                the other one, so "Tree view" read as a stale, inaccurate
                label once this stopped being a direct switch. */}
            <span className="hover-tip hover-tip--left">Change view</span>
          </button>
          {viewMenuOpen && (
            <ViewModeMenu
              ref={viewMenuRef}
              mode={viewMode}
              onSelect={(m) => { onSetViewMode(m); setViewMenuOpen(false); }}
            />
          )}
          <button
            className={`topbar__row2-btn${bloodlineOnly ? ' topbar__row2-btn--active' : ''}`}
            onClick={onToggleBloodlineOnly}
            aria-label="Bloodline only — show only biological and adoptive connections"
            aria-pressed={bloodlineOnly}
          >
            <BloodlineIcon />
            <span className="hover-tip hover-tip--left">Bloodline only</span>
          </button>
        </div>
      </div>

      {/* Toasts — anchored right under the stats row rather than floating
          over the bottom dock, so they never compete with the tap targets
          down there. Lives in normal flow inside this fixed header, so it
          tracks the header's real height (safe-area inset, family-name
          wrapping, etc.) with no hardcoded offset to keep in sync. */}
      {storageWarning && (
        <div className="storage-toast" role="alert">
          Storage full — this change won&apos;t survive a reload. Try removing some photos.
        </div>
      )}
      {syncToast && (
        <div className="storage-toast" role="status" onClick={onDismissSyncToast}>
          {syncToast}
        </div>
      )}
      {recapNudgeCount > 0 && (
        <button className="recap-nudge" onClick={onShowRecap}>
          <span className="recap-nudge__spark" aria-hidden="true">✨</span>
          {recapNudgeCount} {recapNudgeCount === 1 ? 'update' : 'updates'} while you were away — Show me
          <span
            className="recap-nudge__dismiss"
            role="button"
            tabIndex={0}
            aria-label="Dismiss"
            onClick={(e) => { e.stopPropagation(); onDismissRecapNudge?.(); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onDismissRecapNudge?.(); } }}
          >
            ×
          </span>
        </button>
      )}

      {/* Stats detail popover */}
      {statsOpen && stats && (
        <StatsPopover
          ref={popoverRef}
          stats={stats}
          onClose={() => setStatsOpen(false)}
          onOpenInsights={onOpenInsights ? () => { setStatsOpen(false); onOpenInsights(); } : null}
          onOpenTimeline={onOpenTimeline ? () => { setStatsOpen(false); onOpenTimeline(); } : null}
          onOpenDuplicates={onOpenDuplicates ? () => { setStatsOpen(false); onOpenDuplicates(); } : null}
          duplicateCount={duplicateCount}
        />
      )}
    </header>
  );
}

const StatsPopover = forwardRef(function StatsPopover({ stats, onClose, onOpenInsights, onOpenTimeline, onOpenDuplicates, duplicateCount = 0 }, ref) {
  const total = stats.people;
  const maxCount = stats.surnameList?.[0]?.count ?? 1;
  const spanYears = stats.yearMin && stats.yearMax ? stats.yearMax - stats.yearMin : null;

  return (
    <div ref={ref} className="stats-popover" role="dialog" aria-label="Family archive details">
      <button className="stats-popover__close" onClick={onClose} aria-label="Close">
        <CloseIcon />
      </button>

      {onOpenInsights && (
        <button className="stats-popover__insights-btn" onClick={onOpenInsights}>
          <SparkIcon />
          <span>Tree insights</span>
          <span className="stats-popover__insights-arrow"><ChevronRightIcon /></span>
        </button>
      )}

      {onOpenTimeline && (
        <button className="stats-popover__timeline-btn" onClick={onOpenTimeline}>
          <PopClockIcon />
          <span>Family timeline</span>
          <span className="stats-popover__insights-arrow"><ChevronRightIcon /></span>
        </button>
      )}

      {onOpenDuplicates && duplicateCount > 0 && (
        <button className="stats-popover__dups-btn" onClick={onOpenDuplicates}>
          <DupIcon />
          <span>Review {duplicateCount} possible duplicate{duplicateCount > 1 ? 's' : ''}</span>
          <span className="stats-popover__insights-arrow"><ChevronRightIcon /></span>
        </button>
      )}

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

const VIEW_MODES = [
  { id: 'tree', label: 'Tree', desc: 'Free-flowing network' },
  { id: 'chart', label: 'Chart', desc: 'Traditional family tree chart' },
  { id: 'list', label: 'List', desc: 'Accessible, searchable directory' },
];

function viewModeIcon(mode) {
  if (mode === 'chart') return <ChartModeIcon />;
  if (mode === 'list') return <ListIcon />;
  return <TreeIcon />;
}

// The three ways of seeing the family, moved here from what used to be a
// segmented control buried in the Legend sheet — a primary navigation choice
// belongs in the header next to the thing it switches, not inside a
// reference sheet for what the colours and lines mean.
const ViewModeMenu = forwardRef(function ViewModeMenu({ mode, onSelect }, ref) {
  return (
    <div ref={ref} className="viewmode-popover" role="menu" aria-label="Change how the family is shown">
      {VIEW_MODES.map((m) => (
        <button
          key={m.id}
          className={`viewmode-popover__option${mode === m.id ? ' viewmode-popover__option--active' : ''}`}
          onClick={() => onSelect(m.id)}
          role="menuitemradio"
          aria-checked={mode === m.id}
        >
          <span className="viewmode-popover__icon">{viewModeIcon(m.id)}</span>
          <span className="viewmode-popover__text">
            <span className="viewmode-popover__label">{m.label}</span>
            <span className="viewmode-popover__desc">{m.desc}</span>
          </span>
          {mode === m.id && <CheckIcon />}
        </button>
      ))}
    </div>
  );
});

function userInitials(user) {
  const src = user.display_name || user.email || '';
  const parts = src.trim().split(/[\s@._]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.slice(0, 2) ?? '?').toUpperCase();
}

/* ── Icons ──────────────────────────────────────────────────────────────── */

function TopBarSearchIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.7"/>
      <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l1.8 4.9L18.7 9.7l-4.9 1.8L12 16.4l-1.8-4.9L5.3 9.7l4.9-1.8L12 3z" fill="currentColor"/>
      <path d="M19 14l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7L19 14z" fill="currentColor" opacity="0.7"/>
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function PopClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8"/>
      <path d="M12 7.5v5l3 1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function DupIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="5" stroke="currentColor" strokeWidth="1.7"/>
      <circle cx="15" cy="15" r="5" stroke="currentColor" strokeWidth="1.7"/>
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
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
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

// A single unbroken line of three generations — no side branches — for the
// "Bloodline only" toggle, deliberately the quiet opposite of TreeIcon's
// branching Y: this is the one straight line of blood the network reduces to
// once partners, in-laws and step-relatives are filtered out. Threaded as one
// continuous stroke (not two short disconnected segments) with generations
// tapering largest-to-smallest top-to-bottom, so it reads as beads on a
// strand — not three uniform dots, which at this size could pass for a
// kebab/overflow-menu icon. Stroke weight matches the other row-2 icons
// (1.5-1.6) rather than running heavier — three circles plus a spine is
// already more ink than a single-glyph icon like Legend, so anything bolder
// reads as "on" even at rest, undermining the active state's own contrast.
function BloodlineIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3v17.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="12" cy="4.4" r="2.7" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="12" cy="19.2" r="1.5" stroke="currentColor" strokeWidth="1.5"/>
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

// Rectangular boxes on tidy rows, not TreeIcon's circles-and-branches — the
// deliberate visual cue that this is the static, card-based chart, not the
// organic network.
function ChartModeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{flexShrink:0}}>
      <rect x="8" y="3" width="8" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.6"/>
      <rect x="2" y="16" width="8" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.6"/>
      <rect x="14" y="16" width="8" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.6"/>
      <path d="M12 8v4M12 12H6v4M12 12h6v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  );
}

// A tiny affordance chevron, not a standalone control — signals "tap opens a
// menu" the same way a native <select> does, since a single click here no
// longer just toggles between two states now that there are three.
function ChevronDownMiniIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="viewmode-trigger__chevron">
      <path d="M5 9l7 7 7-7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{flexShrink:0}}>
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

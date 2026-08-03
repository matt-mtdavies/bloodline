import { useState, useRef, useEffect, forwardRef } from 'react';
import Logo from './Logo.jsx';
import { PERIMETER_OPTIONS } from '../lib/familyPerimeter.js';

export default function TopBar({ familyName, stats, view, layout, syncStatus, syncError, onRetrySync, onSetViewMode, onOpenLegend, bloodlineOnly = false, onToggleBloodlineOnly, onOpenActivity, activityCount = 0, user, userPhoto, onOpenProfile, onOpenHome, onSearch, onOpenInsights, onOpenTimeline, onOpenArchiveCare, archiveCareCount = 0, archiveCareHasNew = false, storageWarning, storageNearLimit, treeSizeWarning, syncToast, onDismissSyncToast, recapNudgeCount = 0, onShowRecap, onDismissRecapNudge, perimeterActive = false, perimeterLevel = null, onOpenPerimeterSettings, anyOverlayOpen = false }) {
  const perimeterLevelLabel = PERIMETER_OPTIONS.find((o) => o.value === perimeterLevel)?.label ?? null;
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
          {/* The brand mark IS the save indicator now — no second icon pops
              up beside it (real feedback: two breathing family-marks
              side by side "looks odd"). Saving just breathes harder, the
              same `loading` pulse already used on the splash screen,
              swapped in on the exact same element rather than a pill
              appearing next to it; the instant syncStatus leaves 'saving'
              it eases straight back to the quiet `idle` drift — no
              checkmark tick, since a fresh burst of motion right as
              things go quiet would undercut the point of going quiet. */}
          <Logo size={26} loading={syncStatus === 'saving'} idle={syncStatus !== 'saving'} paused={anyOverlayOpen} animate={false} />
          <span className="topbar__word">Bloodline</span>
          <span className="hover-tip hover-tip--down">Home</span>
        </button>
        {/* Screen readers still get the saving/saved transition — just from
            an invisible live region instead of a visible pill, since the
            visible cue moved onto the brand mark above. */}
        <span className="visually-hidden" aria-live="polite">
          {syncStatus === 'saving' ? 'Saving…' : syncStatus === 'saved' ? 'Saved' : ''}
        </span>
        <div className="topbar__actions">
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
          {syncStatus === 'error-toolarge' && (
            <span className="sync-status sync-status--error" aria-live="assertive">
              {syncError?.message || 'Tree too large to save'}
            </span>
          )}
          {onSearch && (
            <button className="pill" onClick={onSearch} aria-label="Search family members">
              <TopBarSearchIcon />
              <span className="hover-tip hover-tip--down">Search</span>
            </button>
          )}
          {/* Bloodline-only — a GLOBAL display filter (it affects every view,
              not just the chart), so it lives with the other global controls
              up here rather than paired with the chart-specific view switcher.
              Circular like its neighbours; its "on" state is a soft accent
              tint, not a solid slab — the stats pill already spells out
              "Bloodline only", so this need only whisper. */}
          <button
            className={`pill${bloodlineOnly ? ' pill--on' : ''}`}
            onClick={onToggleBloodlineOnly}
            aria-label="Bloodline only — show only biological and adoptive connections"
            aria-pressed={bloodlineOnly}
          >
            <BloodlineIcon />
            <span className="hover-tip hover-tip--down">Bloodline only</span>
          </button>
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
          name + scoped archive context (centre) + view toggle (right,
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
            <div className="topbar__stats-row">
              {/* One continuous capsule makes the Perimeter Preview's rings read as scope for the
                  count, not as an unrelated toolbar action. Its children are
                  still sibling buttons: the halo opens the setting that owns
                  the preference, while archive facts open Family Overview. */}
              <div className="topbar__stats-capsule">
                {perimeterActive && perimeterLevelLabel && onOpenPerimeterSettings && (
                  <button
                    className={`perimeter-scope perimeter-scope--${perimeterLevel}`}
                    onClick={onOpenPerimeterSettings}
                    aria-label={`Family Perimeter: ${perimeterLevelLabel}. Open Family Perimeter settings.`}
                  >
                    <PerimeterPreviewIcon level={perimeterLevel} />
                    <span className="hover-tip hover-tip--down">{perimeterLevelLabel}</span>
                  </button>
                )}
                <button
                  ref={statsRef}
                  className={`topbar__stats topbar__stats--btn${statsOpen ? ' topbar__stats--active' : ''}`}
                  onClick={() => setStatsOpen((s) => !s)}
                  aria-label="View family archive details"
                  aria-expanded={statsOpen}
                >
                  {bloodlineOnly && <><span className="topbar__stats-flag">Bloodline only</span> · </>}
                  {stats.people} {stats.people === 1 ? 'person' : 'people'}
                  {stats.surnames && <> · {stats.surnames}</>}
                  {stats.yearSpan && <> · {stats.yearSpan}</>}
                  {stats.photos > 0 && <> · {stats.photos} {stats.photos === 1 ? 'photo' : 'photos'}</>}
                  {stats.memories > 0 && <> · {stats.memories} {stats.memories === 1 ? 'memory' : 'memories'}</>}
                </button>
              </div>
            </div>
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
              <ViewSwitcherIcon />
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
      {!storageWarning && storageNearLimit && (
        <div className="storage-toast" role="status">
          Your tree is getting large — free up space by removing some photos before storage runs out.
        </div>
      )}
      {treeSizeWarning && (
        <div className="storage-toast" role="status">
          Your family archive is approaching the database size limit — removing some older documents or memories will free up room.
        </div>
      )}
      {syncToast && (
        <div className="storage-toast" role="status" onClick={onDismissSyncToast}>
          {syncToast}
        </div>
      )}
      {recapNudgeCount > 0 && (
        // Two real, independent controls as SIBLINGS, not a dismiss `role="button"`
        // nested inside the "show me" <button> — a <button> inside a <button> is
        // invalid HTML; browsers silently reparent it out, which is exactly what
        // made keyboard/screen-reader behavior here unreliable (Codex review).
        <div className="recap-nudge">
          <button className="recap-nudge__main" onClick={onShowRecap}>
            <span className="recap-nudge__spark" aria-hidden="true">✨</span>
            {recapNudgeCount} {recapNudgeCount === 1 ? 'update' : 'updates'} while you were away — Show me
          </button>
          <button
            type="button"
            className="recap-nudge__dismiss"
            aria-label="Dismiss"
            onClick={() => onDismissRecapNudge?.()}
          >
            ×
          </button>
        </div>
      )}

      {/* Stats detail popover */}
      {statsOpen && stats && (
        <StatsPopover
          ref={popoverRef}
          stats={stats}
          onClose={() => setStatsOpen(false)}
          onOpenInsights={onOpenInsights ? () => { setStatsOpen(false); onOpenInsights(); } : null}
          onOpenTimeline={onOpenTimeline ? () => { setStatsOpen(false); onOpenTimeline(); } : null}
          onOpenArchiveCare={onOpenArchiveCare ? () => { setStatsOpen(false); onOpenArchiveCare(); } : null}
          archiveCareCount={archiveCareCount}
          archiveCareHasNew={archiveCareHasNew}
        />
      )}
    </header>
  );
}

const SURNAME_PREVIEW_COUNT = 5;

const StatsPopover = forwardRef(function StatsPopover({ stats, onClose, onOpenInsights, onOpenTimeline, onOpenArchiveCare, archiveCareCount = 0, archiveCareHasNew = false }, ref) {
  const total = stats.people;
  const maxCount = stats.surnameList?.[0]?.count ?? 1;
  const spanYears = stats.yearMin && stats.yearMax ? stats.yearMax - stats.yearMin : null;
  const [surnamesExpanded, setSurnamesExpanded] = useState(false);
  const surnamesToShow = surnamesExpanded ? stats.surnameList : stats.surnameList?.slice(0, SURNAME_PREVIEW_COUNT);
  const hasMoreSurnames = (stats.surnameList?.length ?? 0) > SURNAME_PREVIEW_COUNT;

  return (
    <div ref={ref} className="stats-popover" role="dialog" aria-label="Family overview">
      {/* Its own heading + close, so the X unambiguously closes THIS panel —
          not Tree insights, which used to sit directly under a bare corner
          close button with no label of its own (Codex review: "the close
          icon must not appear to dismiss Tree insights"). */}
      <div className="stats-popover__head">
        <h2 className="stats-popover__title">Family overview</h2>
        <button className="stats-popover__close" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
      </div>

      {/* Discover — Tree insights (terracotta, primary) then Family timeline
          (calm, secondary). Kept visually first and un-labelled as its own
          eyebrow-less pair; Archive Care below gets the explicit label,
          since that's the one that needs to read as clearly separate. */}
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

      {/* Care for your archive — possible duplicates and data-quality checks
          merged into one quiet maintenance entry, distinct from the two
          discovery cards above. "details worth reviewing" rather than
          "issues": most of these turn out to be correct once looked at,
          and "issues" reads as corruption before anyone's actually checked. */}
      {onOpenArchiveCare && archiveCareCount > 0 && (
        <section className="stats-popover__care">
          <h3 className="stats-popover__heading">Care for your archive</h3>
          <button className="stats-popover__care-btn" onClick={onOpenArchiveCare}>
            <ShieldWarnIcon />
            <span>{archiveCareCount} detail{archiveCareCount > 1 ? 's' : ''} worth reviewing</span>
            {archiveCareHasNew && <span className="stats-popover__care-dot" aria-label="New" />}
            <span className="stats-popover__insights-arrow"><ChevronRightIcon /></span>
          </button>
        </section>
      )}

      {/* Surnames */}
      {stats.surnameList?.length > 0 && (
        <section className="stats-popover__section">
          <h3 className="stats-popover__heading">Surnames</h3>
          <ul className="stats-popover__surname-list">
            {surnamesToShow.map(({ name, count }) => (
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
          {hasMoreSurnames && (
            <button
              type="button"
              className="stats-popover__surnames-more"
              onClick={() => setSurnamesExpanded((v) => !v)}
            >
              {surnamesExpanded ? 'Show fewer' : `View all ${stats.surnameList.length} surnames`}
            </button>
          )}
        </section>
      )}

      {/* Time span — one insight sentence, not a labelled stats block. */}
      {stats.yearMin && (
        <section className="stats-popover__section">
          <p className="stats-popover__timespan">
            {spanYears > 0 ? (
              <>{spanYears} years of family history <span className="stats-popover__muted">· {stats.yearMin}–{stats.yearMax}</span></>
            ) : (
              <>Family history from <span className="stats-popover__muted">{stats.yearMin}</span></>
            )}
          </p>
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

// The trigger button's own icon — deliberately NOT viewModeIcon(viewMode).
// That would make the button's icon change every time you switch modes,
// which reads as "what does this button even do" rather than "tap to
// switch view" — a control should look the same regardless of the state
// it's currently in. A generic stacked-layers glyph (distinct from all
// three per-mode icons below) reads as "there are several ways to see
// this" independent of which one happens to be active.
function ViewSwitcherIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{flexShrink:0}}>
      <rect x="4" y="4" width="13" height="13" rx="3" stroke="currentColor" strokeWidth="1.7"/>
      <rect x="8" y="9" width="13" height="13" rx="3" stroke="currentColor" strokeWidth="1.7"/>
    </svg>
  );
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

function ShieldWarnIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12 8.5v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
      <circle cx="12" cy="15.5" r="0.9" fill="currentColor"/>
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

// Compact form of the exact ring diagram used in PerimeterPreview. Reusing
// its four levels and selected-ring treatment avoids teaching a different
// Perimeter glyph in the header.
function PerimeterPreviewIcon({ level = 'first' }) {
  const rings = [
    { value: 'everyone', r: 94, color: 'var(--ink-faint, #a6abb3)' },
    { value: 'third', r: 76, color: 'var(--gold, #b08642)' },
    { value: 'second', r: 56, color: 'var(--sage, #3f5e4e)' },
    { value: 'first', r: 34, color: 'var(--accent, #c2603a)' },
  ];
  return (
    <svg className="perimeter-preview-icon" viewBox="0 0 200 200" aria-hidden="true">
      {rings.map((ring) => {
        const selected = level === ring.value;
        return (
          <circle
            key={ring.value}
            cx="100" cy="100" r={ring.r}
            fill="none"
            stroke={ring.color}
            strokeWidth={selected ? 7 : 4.5}
            opacity={selected ? 1 : 0.42}
          />
        );
      })}
      <circle cx="100" cy="100" r="12" fill="var(--accent, #c2603a)" />
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

// Overlapping bubbles at varying size — echoes the organic canvas itself
// (and the brand mark) rather than Lineage's straight branching path, which
// this used to be a near-duplicate of (both a root node forking to two
// others). Lineage genuinely is a point-to-point route, so it keeps that
// glyph; Tree mode is the free-flowing bubble network, so its icon should
// look like one.
function TreeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{flexShrink:0}}>
      <circle cx="10" cy="9" r="5.5" fill="currentColor" opacity="0.85"/>
      <circle cx="16" cy="14" r="4.6" fill="currentColor" opacity="0.55"/>
      <circle cx="7" cy="17" r="3.2" fill="currentColor" opacity="0.7"/>
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

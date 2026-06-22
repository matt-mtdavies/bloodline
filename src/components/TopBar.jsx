import Logo from './Logo.jsx';

export default function TopBar({ familyName, view, syncStatus, onToggleView, onOpenLegend, onOpenSettings }) {
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
            <span className="sync-status sync-status--error" aria-live="assertive">Not saved — check connection</span>
          )}
          <button className="pill" onClick={onOpenSettings} aria-label="Family settings">
            <SettingsIcon />
          </button>
          <button className="pill" onClick={onOpenLegend} aria-label="Legend — what the styles mean">
            <LegendIcon />
          </button>
          <button className="pill" onClick={onToggleView} aria-label={view === 'bubbles' ? 'Switch to list view' : 'Switch to tree view'}>
            {view === 'bubbles' ? <ListIcon /> : <TreeIcon />}
          </button>
        </div>
      </div>
      {/* Row 2: family tree name, full-width editorial treatment */}
      <div className="topbar__treerow">
        <span className="topbar__familyname">{familyName}</span>
      </div>
    </header>
  );
}

/* Checkmark — saved confirmation */
function SavedCheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/* Sliders / adjust — settings */
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

/* Key — legend / guide to styles */
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

/* Stacked lines — list view */
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

/* Branch nodes — tree view */
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

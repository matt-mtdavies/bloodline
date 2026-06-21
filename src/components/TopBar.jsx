import Logo from './Logo.jsx';

export default function TopBar({ familyName, view, onToggleView, onOpenLegend, onOpenSettings, user }) {
  return (
    <header className="topbar">
      {/* Row 1: logo mark left, action buttons right — no overlap possible */}
      <div className="topbar__bar">
        <Logo size={32} />
        <div className="topbar__actions">
          {user ? (
            <button
              className="topbar__avatar-btn"
              onClick={onOpenSettings}
              title={`Signed in as ${user.email}`}
              aria-label="Account & settings"
            >
              {user.email.slice(0, 2).toUpperCase()}
            </button>
          ) : (
            <button className="pill" onClick={onOpenSettings} aria-label="Family settings & sharing">
              <ShareIcon />
            </button>
          )}
          <button className="pill" onClick={onOpenLegend} aria-label="What the styles mean">
            <KeyIcon />
          </button>
          <button className="pill pill--label" onClick={onToggleView}>
            {view === 'bubbles' ? 'List' : 'Tree'}
          </button>
        </div>
      </div>
      {/* Row 2: brand name + family label, centred across full width */}
      <div className="topbar__heading">
        <span className="masthead__word">Bloodline</span>
        <div className="masthead__family">
          <span className="masthead__rule" />
          <span className="masthead__familyname">{familyName}</span>
          <span className="masthead__rule" />
        </div>
      </div>
    </header>
  );
}

function ShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="18" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="6" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="18" cy="19" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.5 10.5l7-4M8.5 13.5l7 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 11v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="8" r="1.1" fill="currentColor" />
    </svg>
  );
}

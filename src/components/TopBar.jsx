import Logo from './Logo.jsx';

export default function TopBar({ familyName, view, onToggleView, onOpenLegend }) {
  return (
    <header className="topbar">
      <div className="masthead">
        <div className="masthead__brand">
          <Logo size={40} />
          <span className="masthead__word">Bloodline</span>
        </div>
        <div className="masthead__family">
          <span className="masthead__rule" />
          <span className="masthead__familyname">{familyName}</span>
          <span className="masthead__rule" />
        </div>
      </div>

      <div className="topbar__actions">
        <button className="pill" onClick={onOpenLegend} aria-label="What the styles mean">
          <KeyIcon />
        </button>
        <button className="pill pill--label" onClick={onToggleView}>
          {view === 'bubbles' ? 'List' : 'Tree'}
        </button>
      </div>
    </header>
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

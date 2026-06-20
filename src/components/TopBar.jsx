export default function TopBar({ familyName, view, onToggleView, onOpenLegend }) {
  return (
    <header className="topbar">
      <div className="brand">
        <Emblem />
        <span className="brand__name">{familyName}</span>
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

// The two-bubble heirloom mark — a tiny echo of the tree itself.
function Emblem() {
  return (
    <svg className="brand__emblem" width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <circle cx="10" cy="11" r="6.4" fill="#c2603a" />
      <circle cx="16.5" cy="11" r="6.4" fill="#3f5e4e" opacity="0.92" />
      <circle cx="13.25" cy="11" r="3.1" fill="#f7f3ec" opacity="0.55" />
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

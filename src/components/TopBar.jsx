export default function TopBar({
  familyName,
  focusName,
  view,
  onToggleView,
  onOpenLegend,
}) {
  return (
    <header className="topbar">
      <div className="topbar__title">
        <span className="topbar__family">{familyName}</span>
        {focusName && view === 'bubbles' && (
          <span className="topbar__focus">Centred on {focusName}</span>
        )}
      </div>
      <div className="topbar__actions">
        <button className="pill" onClick={onOpenLegend} aria-label="What the styles mean">
          <KeyIcon />
        </button>
        <button className="pill pill--label" onClick={onToggleView}>
          {view === 'bubbles' ? 'List view' : 'Tree view'}
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

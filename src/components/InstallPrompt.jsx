import { useState } from 'react';
import Logo from './Logo.jsx';

/*
 * "Add to Home Screen" nudge. Three paths:
 *   • Chrome/Android/desktop — a captured beforeinstallprompt event fires the
 *     real native installer.
 *   • iOS Safari — no event exists, so we guide: Share → Add to Home Screen.
 *   • Anything else — a generic browser-menu hint.
 * Shown once; dismissal is remembered by the caller.
 */
export default function InstallPrompt({ installEvent, onClose }) {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent || '');
  const [busy, setBusy] = useState(false);

  async function install() {
    if (!installEvent) return;
    setBusy(true);
    try { installEvent.prompt(); await installEvent.userChoice; } catch { /* ignore */ }
    onClose();
  }

  return (
    <div className="install-card" role="dialog" aria-label="Add Bloodline to your home screen">
      <button className="install-card__close" onClick={onClose} aria-label="Dismiss"><CloseIcon /></button>
      <div className="install-card__icon"><Logo size={34} /></div>
      <div className="install-card__body">
        <h3 className="install-card__title">Keep Bloodline a tap away</h3>
        {installEvent ? (
          <>
            <p className="install-card__text">Add it to your home screen for full-screen, app-like access.</p>
            <button className="install-card__cta" onClick={install} disabled={busy}>
              {busy ? 'Opening…' : 'Add to Home Screen'}
            </button>
          </>
        ) : isIOS ? (
          <p className="install-card__text">
            Tap <ShareGlyph /> <strong>Share</strong> in Safari, then <strong>Add to Home Screen</strong>.
          </p>
        ) : (
          <p className="install-card__text">
            Open your browser menu and choose <strong>Install</strong> or <strong>Add to Home Screen</strong>.
          </p>
        )}
      </div>
    </div>
  );
}

function ShareGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ verticalAlign: '-2px', margin: '0 1px' }}>
      <path d="M12 3v12M12 3L8 7M12 3l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6 11H5a2 2 0 00-2 2v6a2 2 0 002 2h14a2 2 0 002-2v-6a2 2 0 00-2-2h-1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function CloseIcon() {
  return (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>);
}

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const DISMISSED_KEY = 'bloodline:install-dismissed';
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function alreadyDismissed() {
  try {
    const t = parseInt(localStorage.getItem(DISMISSED_KEY) || '0', 10);
    return t > 0 && Date.now() - t < DISMISS_TTL_MS;
  } catch { return false; }
}
function markDismissed() {
  try { localStorage.setItem(DISMISSED_KEY, String(Date.now())); } catch { /* noop */ }
}

const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

const isStandalone = () =>
  window.navigator.standalone === true ||
  window.matchMedia('(display-mode: standalone)').matches;

export default function InstallPrompt() {
  const [mode, setMode] = useState(null); // null | 'android' | 'ios'
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showIosSheet, setShowIosSheet] = useState(false);

  useEffect(() => {
    if (isStandalone() || alreadyDismissed()) return;

    if (isIos()) {
      const t = setTimeout(() => setMode('ios'), 3500);
      return () => clearTimeout(t);
    }

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setMode('android');
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const dismiss = () => {
    markDismissed();
    setMode(null);
    setShowIosSheet(false);
  };

  const installAndroid = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') markDismissed();
    setMode(null);
  };

  if (!mode) return null;

  // Portal to document.body so iOS Safari's overflow:hidden on #root doesn't clip us
  return createPortal(
    <>
      <div className="install-banner" role="complementary" aria-label="Install app">
        <img className="install-banner__icon" src="/apple-touch-icon.png" alt="" width={44} height={44} />
        <div className="install-banner__text">
          <span className="install-banner__name">Bloodline</span>
          <span className="install-banner__sub">Save to Home Screen</span>
        </div>
        <button
          className="btn btn--primary install-banner__add"
          onClick={mode === 'ios' ? () => setShowIosSheet(true) : installAndroid}
        >
          Add
        </button>
        <button className="install-banner__dismiss" onClick={dismiss} aria-label="Dismiss">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {showIosSheet && (
        <div className="install-ios-scrim" onClick={dismiss}>
          <div className="install-ios-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="install-ios__handle" />
            <img className="install-ios__icon" src="/apple-touch-icon.png" alt="Bloodline" width={72} height={72} />
            <h2 className="install-ios__title">Add to Home Screen</h2>
            <p className="install-ios__intro">Full app experience — opens instantly, works offline.</p>

            <ol className="install-ios__steps">
              <li className="install-ios__step">
                <span className="install-ios__num">1</span>
                <span className="install-ios__step-text">
                  Tap the{' '}
                  <svg className="install-ios__share-icon" width="17" height="19" viewBox="0 0 18 20" fill="none" aria-label="Share">
                    <path d="M9 1v12M5 5l4-4 4 4" stroke="#007AFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M1 9v9a1 1 0 001 1h14a1 1 0 001-1V9" stroke="#007AFF" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  {' '}Share button in Safari
                </span>
              </li>
              <li className="install-ios__step">
                <span className="install-ios__num">2</span>
                <span className="install-ios__step-text">Tap <strong>Add to Home Screen</strong></span>
              </li>
              <li className="install-ios__step">
                <span className="install-ios__num">3</span>
                <span className="install-ios__step-text">Tap <strong>Add</strong> in the top-right</span>
              </li>
            </ol>

            <button className="btn btn--primary install-ios__done" onClick={dismiss}>Got it</button>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}

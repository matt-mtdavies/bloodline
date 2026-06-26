import { useState, useEffect, useRef } from 'react';

/*
 * Persistent nudge shown to anonymous ?new trial users after they complete
 * onboarding. A small banner at the bottom of the screen with a "Create free
 * account" CTA. Clicking it opens a sheet with the full email → code flow.
 * On successful verify the session cookie is set; App.jsx calls applySession()
 * via the onSaveComplete callback to load the user and sync the tree to D1.
 */
export default function SaveNudge({ onSaveComplete }) {
  const [dismissed, setDismissed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState('email'); // 'email' | 'code'
  const [status, setStatus] = useState('idle'); // 'idle' | 'sending' | 'verifying' | 'error'
  const [errorMsg, setErrorMsg] = useState('');
  const codeRef = useRef(null);
  const emailRef = useRef(null);

  useEffect(() => {
    if (sheetOpen) {
      const t = setTimeout(() => (phase === 'email' ? emailRef : codeRef).current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [sheetOpen, phase]);

  if (dismissed) return null;

  async function requestCode(e) {
    if (e?.preventDefault) e.preventDefault();
    if (!email.trim()) return;
    setStatus('sending');
    setErrorMsg('');
    try {
      const res = await fetch('/api/auth/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not send code.');
      setPhase('code');
      setCode('');
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message || 'Could not send code. Try again.');
    }
  }

  async function verifyCode(codeToVerify = code) {
    if (codeToVerify.length !== 6) return;
    setStatus('verifying');
    setErrorMsg('');
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: codeToVerify }),
      });
      if (res.ok) {
        setSheetOpen(false);
        setDismissed(true);
        onSaveComplete?.();
        return;
      }
      const body = await res.json().catch(() => ({}));
      setErrorMsg(
        body.error === 'Invalid or expired code'
          ? 'Wrong code or it has expired. Try again or request a new one.'
          : 'Something went wrong. Please try again.',
      );
      setStatus('error');
      setCode('');
    } catch {
      setStatus('error');
      setErrorMsg('Could not verify. Check your connection and try again.');
    }
  }

  function handleCodeChange(e) {
    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(val);
    if (val.length === 6) verifyCode(val);
  }

  return (
    <>
      <div className="save-nudge" role="status" aria-live="polite">
        <div className="save-nudge__text">
          <SaveIcon />
          <span>Your tree is saved on this device only.</span>
        </div>
        <div className="save-nudge__actions">
          <button className="save-nudge__cta" onClick={() => setSheetOpen(true)}>
            Create free account
          </button>
          <button
            className="save-nudge__dismiss"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {sheetOpen && (
        <div
          className="sheet-scrim"
          onClick={() => setSheetOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Create your free account"
        >
          <div className="sheet save-nudge__sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet__grip" />

            <div className="save-nudge__sheet-head">
              <h2 className="save-nudge__sheet-title">Save your tree</h2>
              <p className="save-nudge__sheet-sub">
                {phase === 'email'
                  ? 'Create a free account to keep your tree safe and share it with family.'
                  : `We sent a 6-digit code to ${email}`}
              </p>
            </div>

            {phase === 'email' ? (
              <form onSubmit={requestCode} noValidate>
                {errorMsg && <p className="save-nudge__err">{errorMsg}</p>}
                <label className="login-card__label" htmlFor="nudge-email">
                  Email address
                </label>
                <input
                  id="nudge-email"
                  ref={emailRef}
                  className="login-card__input"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={status === 'sending'}
                />
                <button
                  className="login-card__cta"
                  type="submit"
                  disabled={status === 'sending' || !email.trim()}
                >
                  {status === 'sending' ? 'Sending…' : 'Send me a code →'}
                </button>
                <p className="login-card__hint">No password needed. We'll email you a 6-digit code.</p>
                <p className="login-card__legal">
                  By continuing you agree to our{' '}
                  <a href="/terms.html" target="_blank" rel="noopener noreferrer">Terms</a>
                  {' '}and{' '}
                  <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
                </p>
              </form>
            ) : (
              <div>
                {errorMsg && <p className="save-nudge__err">{errorMsg}</p>}
                <label className="login-card__label" htmlFor="nudge-code">
                  Sign-in code
                </label>
                <input
                  id="nudge-code"
                  ref={codeRef}
                  className="login-card__code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  maxLength={6}
                  value={code}
                  onChange={handleCodeChange}
                  disabled={status === 'verifying'}
                />
                {status === 'verifying' && (
                  <p className="login-card__hint" style={{ textAlign: 'center', marginTop: 12 }}>
                    Verifying…
                  </p>
                )}
                <div className="login-card__resend-row">
                  <button
                    className="login-card__resend"
                    onClick={() => { setPhase('email'); setStatus('idle'); setErrorMsg(''); }}
                  >
                    ← Change email
                  </button>
                  <button
                    className="login-card__resend"
                    disabled={status === 'sending'}
                    onClick={requestCode.bind(null, {})}
                  >
                    {status === 'sending' ? 'Sending…' : 'Resend code'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function SaveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0, opacity: 0.7 }}>
      <rect x="5" y="3" width="14" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 3v5h6V3" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8 15h8M8 18h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

import { useState, useRef, useEffect } from 'react';
import Logo from './Logo.jsx';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [step, setStep] = useState('email'); // 'email' | 'code'
  const [code, setCode] = useState('');
  const [status, setStatus] = useState('idle'); // idle | sending | verifying | error
  const [errorMsg, setErrorMsg] = useState('');
  const codeRef = useRef(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.has('auth')) {
      setErrorMsg(
        p.get('auth') === 'expired'
          ? 'That link has expired — enter your email for a new code.'
          : 'Something went wrong. Please try again.',
      );
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Focus the code input as soon as we switch to that step.
  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  async function requestCode(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('sending');
    setErrorMsg('');
    try {
      const res = await fetch('/api/auth/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!res.ok) throw new Error();
      setStep('code');
      setCode('');
      setStatus('idle');
    } catch {
      setStatus('error');
      setErrorMsg('Could not send the code. Check your connection and try again.');
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
        window.location.reload();
        return;
      }
      const body = await res.json().catch(() => ({}));
      setErrorMsg(body.error === 'Invalid or expired code'
        ? 'Wrong code or it has expired. Try again or request a new one.'
        : 'Something went wrong. Please try again.');
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
    <div className="login-screen">
      <div className="login-card">
        <div className="login-card__brand">
          <Logo size={36} />
          <span>Bloodline</span>
        </div>

        {step === 'email' ? (
          <form onSubmit={requestCode} noValidate>
            <p className="login-card__tagline">
              Your family's story,<br />preserved forever.
            </p>
            {errorMsg && <p className="login-card__err">{errorMsg}</p>}
            <label className="login-card__label" htmlFor="login-email">
              Email address
            </label>
            <input
              id="login-email"
              className="login-card__input"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
            <button
              className="login-card__cta"
              type="submit"
              disabled={status === 'sending' || !email.trim()}
            >
              {status === 'sending' ? 'Sending…' : 'Send me a code →'}
            </button>
            <p className="login-card__hint">
              No password needed. We'll email you a 6-digit code.
            </p>
          </form>
        ) : (
          <div>
            <p className="login-card__tagline" style={{ marginBottom: 4 }}>
              Check your email
            </p>
            <p className="login-card__hint" style={{ marginBottom: 24 }}>
              We sent a 6-digit code to <strong>{email}</strong>
            </p>

            {errorMsg && <p className="login-card__err">{errorMsg}</p>}

            <label className="login-card__label" htmlFor="login-code">
              Sign-in code
            </label>
            <input
              id="login-code"
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
                onClick={() => { setStep('email'); setStatus('idle'); setErrorMsg(''); }}
              >
                ← Change email
              </button>
              <button
                className="login-card__resend"
                disabled={status === 'sending'}
                onClick={requestCode.bind(null, { preventDefault: () => {} })}
              >
                {status === 'sending' ? 'Sending…' : 'Resend code'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

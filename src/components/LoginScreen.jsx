import { useState, useEffect, useRef } from 'react';
import Logo from './Logo.jsx';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle'); // idle | sending | sent | verifying | error
  const [errorMsg, setErrorMsg] = useState('');
  const [code, setCode] = useState('');
  const codeRef = useRef(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.has('auth')) {
      const reason = p.get('auth');
      setErrorMsg(
        reason === 'expired'
          ? 'That link has expired. Enter your email to get a new one.'
          : 'Something went wrong. Please try again.',
      );
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Focus code input when it appears
  useEffect(() => {
    if (status === 'sent') setTimeout(() => codeRef.current?.focus(), 100);
  }, [status]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('sending');
    setErrorMsg('');
    setCode('');
    try {
      const res = await fetch('/api/auth/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!res.ok) throw new Error();
      setStatus('sent');
    } catch {
      setStatus('error');
      setErrorMsg('Could not send the link. Please check your connection and try again.');
    }
  }

  async function handleCode(e) {
    e.preventDefault();
    const clean = code.replace(/\s/g, '');
    if (clean.length !== 6) return;
    setStatus('verifying');
    setErrorMsg('');
    try {
      const res = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: clean }),
      });
      if (res.ok) {
        window.location.reload();
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.error === 'Code expired' ? 'Code expired — request a new one.' : 'Incorrect code. Try again.');
        setStatus('sent');
        setCode('');
        codeRef.current?.focus();
      }
    } catch {
      setErrorMsg('Connection error. Please try again.');
      setStatus('sent');
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-card__brand">
          <Logo size={36} />
          <span>Bloodline</span>
        </div>

        {status === 'idle' || status === 'sending' || status === 'error' ? (
          <form onSubmit={handleSubmit} noValidate>
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
              Check your inbox
            </p>
            <p className="login-card__hint" style={{ marginBottom: 24 }}>
              We sent a 6-digit code to <strong>{email}</strong>
            </p>

            {errorMsg && <p className="login-card__err">{errorMsg}</p>}

            <form onSubmit={handleCode} noValidate>
              <label className="login-card__label" htmlFor="login-code">
                Enter your code
              </label>
              <input
                id="login-code"
                ref={codeRef}
                className="login-card__input login-card__input--code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000 000"
                maxLength={7}
                value={code}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d]/g, '').slice(0, 6);
                  setCode(v.length > 3 ? `${v.slice(0, 3)} ${v.slice(3)}` : v);
                }}
              />
              <button
                className="login-card__cta"
                type="submit"
                disabled={status === 'verifying' || code.replace(/\s/g, '').length !== 6}
              >
                {status === 'verifying' ? 'Verifying…' : 'Sign in →'}
              </button>
            </form>

            <button
              className="login-card__resend"
              onClick={() => { setStatus('idle'); setErrorMsg(''); setCode(''); }}
            >
              Use a different email
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

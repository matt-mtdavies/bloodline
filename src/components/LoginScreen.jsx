import { useState, useEffect } from 'react';
import Logo from './Logo.jsx';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle'); // idle | sending | sent | error
  const [errorMsg, setErrorMsg] = useState('');

  // Handle redirects back from /api/auth/verify with an error flag.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.has('auth')) {
      const reason = p.get('auth');
      setErrorMsg(
        reason === 'expired'
          ? 'That link has expired. Enter your email to get a new one.'
          : 'Something went wrong. Please try again.',
      );
      // Clean the URL without a page reload.
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  async function handleSubmit(e) {
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
      if (!res.ok) throw new Error('Request failed');
      setStatus('sent');
    } catch {
      setStatus('error');
      setErrorMsg('Could not send the link. Please check your connection and try again.');
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-card__brand">
          <Logo size={36} />
          <span>Bloodline</span>
        </div>

        {status === 'sent' ? (
          <div className="login-card__sent">
            <div className="login-card__sent-icon">✉</div>
            <p className="login-card__sent-title">Check your inbox</p>
            <p className="login-card__sent-body">
              We sent a link to <strong>{email}</strong>.<br />
              Tap it to open your family tree.
            </p>
            <button
              className="login-card__resend"
              onClick={() => setStatus('idle')}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <p className="login-card__tagline">
              Your family's story,<br />preserved forever.
            </p>

            {errorMsg && (
              <p className="login-card__err">{errorMsg}</p>
            )}

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
              {status === 'sending' ? 'Sending…' : 'Send me a link →'}
            </button>

            <p className="login-card__hint">
              No password needed. We'll email you a secure sign-in link.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

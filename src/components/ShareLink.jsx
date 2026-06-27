import { useState, useRef } from 'react';

/*
 * A copyable / shareable invite link. Lets the inviter hand the link over
 * through any channel — text, WhatsApp, etc. — not just email.
 *   • Copy   — writes to the clipboard with a brief "Copied!" confirmation.
 *   • Share  — opens the native share sheet (phones) when available.
 */
export default function ShareLink({ url, shareText, compact = false }) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef(null);
  const timer = useRef(null);

  if (!url) return null;

  const flash = () => {
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  };

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback for older / insecure-context browsers: select + execCommand.
      inputRef.current?.select();
      try { document.execCommand('copy'); } catch { /* no-op */ }
    }
    flash();
  }

  const canShare = typeof navigator !== 'undefined' && !!navigator.share;
  async function share() {
    try {
      await navigator.share({ title: 'Bloodline', text: shareText || 'Join our family tree', url });
    } catch { /* user dismissed — ignore */ }
  }

  return (
    <div className={`sharelink${compact ? ' sharelink--compact' : ''}`}>
      <input
        ref={inputRef}
        className="sharelink__url"
        value={url}
        readOnly
        onFocus={(e) => e.target.select()}
        aria-label="Invite link"
      />
      <button type="button" className="sharelink__btn" onClick={copy} aria-label="Copy invite link">
        {copied ? <CheckIcon /> : <CopyIcon />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
      {canShare && (
        <button type="button" className="sharelink__btn sharelink__btn--share" onClick={share} aria-label="Share invite link">
          <ShareIcon />
          <span>Share</span>
        </button>
      )}
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="18" cy="5" r="2.6" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="6" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="18" cy="19" r="2.6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.3 10.8l7.4-4.3M8.3 13.2l7.4 4.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

import { useState } from 'react';

/*
 * An image that never shows a broken glyph. While it loads it sits on a warm
 * placeholder; if it fails (offline, a dead URL, a blocked third-party host) it
 * keeps that placeholder with a quiet photo mark rather than the browser's
 * default broken-image icon. Photos are the heart of the product (§1), so a
 * missing one should still feel cared-for, never like an error.
 */
export default function SmartImg({ src, alt = '', className = '' }) {
  const [state, setState] = useState('loading'); // 'loading' | 'ok' | 'error'

  return (
    <span className={`smartimg smartimg--${state} ${className}`.trim()}>
      {state !== 'error' && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
        />
      )}
      {state !== 'ok' && (
        <span className="smartimg__ph" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="8.5" cy="10" r="1.6" fill="currentColor" />
            <path d="M4 17l4.5-4.2a1.5 1.5 0 012 0L14 16l2-1.8a1.5 1.5 0 012 0L20 16"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
    </span>
  );
}

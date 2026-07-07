import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './styles/global.css';
import App from './App.jsx';

// Registers the service worker AND actually acts on updates. skipWaiting +
// clientsClaim (vite.config.js) mean a new SW takes control the moment it's
// ready, but a tab that's already open keeps running its OLD JavaScript in
// memory regardless — nothing about "the new SW is in control" swaps out
// already-loaded modules. Without this, that tab is stuck silently running
// a stale build until the user happens to fully close and reopen the app.
//
// But reloading the INSTANT an update is ready — with no regard for whether
// the user is mid-session looking at the tree — is what caused the app to
// flash the tree in and then yank back to the loading screen a couple
// seconds later. Instead: reload immediately only if the tab is already in
// the background (nobody's looking, so it's invisible); otherwise wait
// until the user backgrounds it (switches away / locks the phone) and
// reload then. They'll simply find the fresh build next time they open the
// app — never a visible flash-and-reload mid-session, and never a delay to
// the app's own initial mount (this only changes *when* a reload happens,
// nothing about how or when the tree itself loads or saves).
function reloadForUpdate() {
  if (document.visibilityState === 'hidden') {
    window.location.reload();
    return;
  }
  const onHidden = () => {
    if (document.visibilityState !== 'hidden') return;
    document.removeEventListener('visibilitychange', onHidden);
    window.location.reload();
  };
  document.addEventListener('visibilitychange', onHidden);
}

registerSW({ immediate: true, onNeedRefresh: reloadForUpdate });

class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ position:'fixed', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'#faf7f4', gap:16, padding:32, textAlign:'center' }}>
          <svg width="42" height="40" viewBox="0 0 42 40" fill="none" aria-hidden="true">
            <circle cx="15" cy="17" r="10" fill="#c2603a"/>
            <circle cx="27" cy="17" r="10" fill="#3f5e4e"/>
            <circle cx="21" cy="29" r="6.6" fill="#b08642"/>
          </svg>
          <p style={{ color:'#6b5a4e', fontSize:15, margin:0 }}>Something went wrong — please reload.</p>
          <button onClick={() => location.reload()} style={{ padding:'10px 24px', background:'#c2603a', color:'#fff', borderRadius:999, border:'none', fontSize:15, cursor:'pointer' }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

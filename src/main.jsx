import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './styles/global.css';
import App from './App.jsx';

// Registers the service worker AND actually acts on updates. skipWaiting +
// clientsClaim (vite.config.js) mean a new SW takes control the moment it's
// ready, but a tab that's already open keeps running its OLD JavaScript
// in memory regardless — nothing about "the new SW is in control" swaps out
// already-loaded modules. Without this, that tab is stuck silently running
// a stale build until the user happens to fully close and reopen the app,
// which is exactly the manual step that left people staring at a broken
// layout with no idea why or how to fix it. Reloading the instant an
// update is ready means every device self-heals on its own.
registerSW({ immediate: true, onNeedRefresh: () => window.location.reload() });

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

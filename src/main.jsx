import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './styles/global.css';
import App from './App.jsx';

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

function boot() {
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

// An update found once the tree's already on screen must never yank it away
// mid-session — reload immediately only if the tab's already in the
// background (nobody's looking), otherwise wait until it's backgrounded
// (switch away / lock the phone) and reload then. They simply find the
// fresh build next time they open the app.
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

// A brand-new visit has no existing service worker controlling the page, so
// there's nothing for an update to be found against — mount right away,
// no reason to pay any grace period for a check that can't produce one.
//
// A RETURNING visit is the case that used to flash the tree in and yank it
// back a couple of seconds later: the page loads under the OLD service
// worker, then the new one (already deployed, found almost instantly thanks
// to skipWaiting+clientsClaim) swaps in right as the tree finishes its first
// paint. So here, give the registration a short, HARD-CAPPED window to say
// "found an update, reloading" BEFORE mounting anything — if it does, the
// reload happens invisibly (nothing was ever shown to yank away, just a
// beat longer on the loading screen). If the cap elapses first, mount
// normally regardless of what the registration is doing — a stalled
// network, a registration error, anything — this can never hang past the
// cap, and once mounted, a late update falls back to the same safe,
// deferred reload as a long-running session.
const hadControllerAlready = !!(window.navigator?.serviceWorker?.controller);

if (!hadControllerAlready) {
  boot();
  registerSW({ immediate: true, onNeedRefresh: reloadForUpdate });
} else {
  const GRACE_MS = 400;
  let decided = false;
  const timer = setTimeout(() => {
    if (decided) return;
    decided = true;
    boot();
  }, GRACE_MS);

  registerSW({
    immediate: true,
    onNeedRefresh() {
      if (decided) {
        reloadForUpdate(); // already mounted — defer, don't yank
        return;
      }
      decided = true;
      clearTimeout(timer);
      window.location.reload(); // nothing mounted yet — invisible
    },
  });
}

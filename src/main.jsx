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

let mounted = false;
function boot() {
  if (mounted) return; // idempotent — see the safety-net timer below
  mounted = true;
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

// registerType is 'prompt' (see vite.config.js) and workbox.skipWaiting is
// OFF — a new service worker installs and then waits, patiently, until
// something explicitly tells it to take over. That "something" is calling
// updateSW() (the function registerSW() returns): it sends the skip-waiting
// message, the new worker activates and claims clients, and — this part is
// vite-plugin-pwa's own built-in behaviour once a waiting worker was ever
// reported, not something we wire ourselves — the page reloads the moment
// that worker actually becomes "controlling". So the entire question of
// *when* an update becomes visible reduces to *when we choose to call
// updateSW()*, and this file's only job is answering that safely.
//
// An update found once the tree's already on screen must never yank it
// away mid-session — call updateSW() immediately only if the tab's already
// in the background (nobody's looking), otherwise wait until it IS
// backgrounded (switch away / lock the phone) and call it then. They
// simply find the fresh build next time they open the app.
//
// "Hidden" is confirmed with a short delay rather than trusted the instant
// it fires — some mobile browsers (iOS Safari/PWA in particular) fire a
// spurious visibilitychange during the launch handoff or a tab-switch
// gesture, hidden for only a moment before returning to visible. Applying
// the update on that blip is exactly the bug this mechanism exists to
// prevent — a real backgrounding stays hidden far longer than this check
// needs.
// Takes a thunk rather than the update function directly — registerSW()
// returns it, but onNeedRefresh (the callback passed alongside) is invoked
// with zero arguments, so each call site closes over its own registerSW()
// result instead.
function applyUpdateWhenSafe(callUpdateSW) {
  const confirmHiddenThenUpdate = () => {
    setTimeout(() => {
      if (document.visibilityState === 'hidden') callUpdateSW();
    }, 1000);
  };
  if (document.visibilityState === 'hidden') {
    confirmHiddenThenUpdate();
    return;
  }
  const onHidden = () => {
    if (document.visibilityState !== 'hidden') return;
    document.removeEventListener('visibilitychange', onHidden);
    confirmHiddenThenUpdate();
  };
  document.addEventListener('visibilitychange', onHidden);
}

// A brand-new visit has no existing service worker controlling the page, so
// there's nothing for an update to be found against — mount right away,
// no reason to pay any grace period for a check that can't produce one.
//
// A RETURNING visit is the case that used to flash the tree in and yank it
// back a couple of seconds later: the page loads under the OLD service
// worker, then the new one (already deployed) is found within moments of
// registering. So here, give the registration a short, HARD-CAPPED window
// to say "found one" BEFORE mounting anything — if it does, apply it right
// then (invisible: nothing was ever shown to yank away, just a beat longer
// on the loading screen). If the cap elapses first, mount normally
// regardless of what the registration is doing — a stalled network, a
// registration error, anything — this can never hang past the cap, and
// once mounted, a late update falls back to the same safe, deferred
// behaviour as a long-running session.
const hadControllerAlready = !!(window.navigator?.serviceWorker?.controller);

if (!hadControllerAlready) {
  boot();
  const updateSW = registerSW({ immediate: true, onNeedRefresh: () => applyUpdateWhenSafe(updateSW) });
} else {
  // 400ms proved too tight against a real deploy's actual registration/
  // update-check latency (cold network, a real Cloudflare edge round trip)
  // — an update was routinely found just after the cap. Longer, but still
  // capped: this can never hang past it, same guarantee as before.
  const GRACE_MS = 1200;
  let decided = false;
  const timer = setTimeout(() => {
    if (decided) return;
    decided = true;
    boot();
  }, GRACE_MS);

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      if (decided) {
        applyUpdateWhenSafe(updateSW); // already mounted — defer, don't yank
        return;
      }
      decided = true;
      clearTimeout(timer);
      updateSW(); // nothing mounted yet — the eventual reload is invisible
      // Safety net: if the activate→"controlling"→reload cascade never
      // actually completes (a dropped message, a browser quirk), mount
      // anyway rather than risk hanging on the loading screen forever.
      setTimeout(() => { if (!mounted) boot(); }, 2500);
    },
  });
}

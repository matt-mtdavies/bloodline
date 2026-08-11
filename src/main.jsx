import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './styles/global.css';
import App from './App.jsx';
import { isLabOpen } from './lib/treePhysicsFlag.js';

function isLivingAtlasOpen() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('lab') === 'living-atlas';
}

// Set only by applyUpdateWhenSafe below, and only to a REAL waiting
// updateSW() reference — never invented — so the ErrorBoundary's Reload
// button below can tell "an update is sitting there, deferred until the
// tab backgrounds" apart from "nothing pending, this is just an ordinary
// crash." A real report: a crash recurred on every open, on a device that
// (per its own reported symptoms — a stale identity that only cleared on
// refresh, never on its own) looked stuck on an old bundle, and plain
// `location.reload()` alone cannot break that: the still-active OLD
// service worker keeps serving its own precached OLD index.html/JS on
// every request until a waiting new worker actually takes over, and this
// file's own deferred-update design (see applyUpdateWhenSafe) only ever
// applies one once the tab backgrounds — which never happens for a tab
// that's simply never switched away from. A crash is exactly the safe
// moment that deferral exists to wait for (nothing on screen left to
// yank away), so Reload should apply a pending update immediately here
// rather than reloading right back onto the same stale, still-crashing
// bundle.
let pendingUpdateSW = null;

class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(e) { return { error: e }; }
  handleReload = () => {
    if (pendingUpdateSW) {
      const apply = pendingUpdateSW;
      pendingUpdateSW = null;
      apply();
      // Safety net matching this file's own convention elsewhere: if the
      // update doesn't actually reload the page on its own (a stalled
      // activation, a dropped message), don't leave the user stuck on
      // the crash screen — fall back to a plain reload.
      setTimeout(() => location.reload(), 3000);
    } else {
      location.reload();
    }
  };
  render() {
    if (this.state.error) {
      return (
        <div style={{ position:'fixed', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'#faf7f4', gap:16, padding:32, textAlign:'center' }}>
          <svg width="42" height="40" viewBox="0 0 42 40" fill="none" aria-hidden="true">
            <circle cx="13.9" cy="16.5" r="11.8" fill="#c2603a"/>
            <circle cx="28.1" cy="16.5" r="11.8" fill="#3f5e4e"/>
            <circle cx="21" cy="30.6" r="7.8" fill="#c4913f"/>
          </svg>
          <p style={{ color:'#6b5a4e', fontSize:15, margin:0 }}>Something went wrong — please reload.</p>
          <button onClick={this.handleReload} style={{ padding:'10px 24px', background:'#c2603a', color:'#fff', borderRadius:999, border:'none', fontSize:15, cursor:'pointer' }}>
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
  // The Living Atlas is a separate, offline-input-only concept prototype. It
  // mounts instead of the application, is lazy-loaded, and does not import
  // the production store or call an API. It can use synthetic fixtures or
  // parse a GEDCOM file selected from this device entirely in the browser.
  if (isLivingAtlasOpen()) {
    const LivingAtlas = React.lazy(() => import('./viz/atlas/LivingAtlasLab.jsx'));
    createRoot(document.getElementById('root')).render(
      <React.StrictMode>
        <ErrorBoundary>
          <React.Suspense fallback={null}>
            <LivingAtlas />
          </React.Suspense>
        </ErrorBoundary>
      </React.StrictMode>,
    );
    return;
  }
  // The Tree Motion Lab (?lab=tree-motion) mounts INSTEAD of the app and is
  // lazy-loaded, so neither it, its fixtures nor the experimental engine are
  // in the bundle any ordinary visitor downloads. It never touches
  // localStorage beyond its own engine flag — see src/lib/treePhysicsFlag.js.
  // It never touches src/data/store.js at all (no import, no sync, no
  // writes) — the one deliberate exception is a single, strictly opt-in,
  // strictly read-only GET to /api/tree (src/viz/v2/realFamily.js, fired
  // only by an explicit button press, never on mount) so the real physics
  // question can be judged against a real family, not just fixtures; that
  // module's own header and its test suite (tests/realFamily.test.mjs) pin
  // "never more than one call, always a plain GET" as a mechanical
  // guarantee, not just a code-review promise. Closing the URL is still the
  // whole rollback — nothing here can leave a trace in the real tree.
  if (isLabOpen()) {
    const Lab = React.lazy(() => import('./viz/v2/TreeMotionLab.jsx'));
    createRoot(document.getElementById('root')).render(
      <React.StrictMode>
        <ErrorBoundary>
          <React.Suspense fallback={null}>
            <Lab />
          </React.Suspense>
        </ErrorBoundary>
      </React.StrictMode>,
    );
    return;
  }
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
  // Visible to the ErrorBoundary's Reload button (see its own comment
  // above) for exactly as long as this update is genuinely still waiting
  // on a backgrounding that hasn't happened yet.
  pendingUpdateSW = callUpdateSW;
  const applyNow = () => {
    pendingUpdateSW = null;
    callUpdateSW();
  };
  const confirmHiddenThenUpdate = () => {
    setTimeout(() => {
      if (document.visibilityState === 'hidden') applyNow();
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

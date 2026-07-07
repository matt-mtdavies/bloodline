import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Bloodline is a PWA: installable, app-like, offline-tolerant shell.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // NOT 'autoUpdate' — that bakes a build-time flag into vite-plugin-pwa's
      // OWN generated register.js wrapper that reloads unconditionally the
      // instant a new SW activates (see node_modules/vite-plugin-pwa/dist/
      // client/build/register.js's `if (auto) wb.addEventListener('activated',
      // ...window.location.reload())` branch) — completely bypassing whatever
      // onNeedRefresh callback main.jsx passes to registerSW() at runtime.
      // Every bit of custom reload-timing logic in main.jsx (grace window,
      // deferring until backgrounded) was silently dead code under
      // 'autoUpdate': the flash-tree-then-reload bug was never actually
      // routed through any of it. 'prompt' takes the OTHER branch in that
      // same file, the one that actually calls onNeedRefresh.
      registerType: 'prompt',
      // The default auto-injected registration script just calls
      // navigator.serviceWorker.register() and stops — it has no idea when
      // a new version has taken over, so a tab left open across a deploy
      // just keeps running the old JS indefinitely with no way to know it's
      // stale. main.jsx registers manually via virtual:pwa-register instead,
      // so it can reload the instant an update is ready.
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png'],
      manifest: {
        name: 'Bloodline',
        short_name: 'Bloodline',
        description: 'A living portrait of your family.',
        theme_color: '#f7f3ec',
        background_color: '#f7f3ec',
        display: 'standalone',
        orientation: 'portrait',
        // SVG-only icons render inconsistently across launchers — some
        // (notably several Android/Chrome versions) want an actual raster
        // bitmap and silently fall back to something blurrier without one.
        // 'maskable' points at a separately-padded source (favicon-maskable.svg
        // → icon-512-maskable.png) with real safe-zone margin, not the same
        // artwork reused — Android crops maskable icons to its own shape
        // (circle, squircle, etc.), and the tightly-cropped default icon
        // would lose its edges under that treatment.
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // NOT skipWaiting — that makes a newly-installed worker activate
        // itself immediately regardless of what main.jsx decides, which is
        // exactly how the flash-tree-then-reload bug kept happening even
        // after main.jsx grew careful reload-timing logic: the new worker
        // was already taking over on its own schedule. A worker now sits
        // patiently in the "waiting" state until main.jsx explicitly calls
        // the update function returned by registerSW() — clientsClaim then
        // still takes effect immediately at THAT point, so there's still
        // no need to close every tab first once an update is actually applied.
        clientsClaim: true,
        // NOT 'html' — index.html references content-hashed JS/CSS filenames
        // for the exact build that produced it, so precaching it pins a
        // client to that one build's asset graph until its service worker
        // fully cuts over. Any mismatch during that window (an update racing
        // a page load, iOS Safari's aggressive SW/cache eviction, a stale SW
        // reaching for a prior deploy's now-recycled asset hashes) serves an
        // HTML shell pointing at JS/CSS that doesn't match what's live — the
        // JS often still boots from memory (hence the UI looking "alive",
        // e.g. still showing "Saving…") while the CSS fails outright and the
        // whole layout collapses to unstyled block flow. Reported multiple
        // times as exactly that: a giant unstyled photo, everything stacked
        // top to bottom instead of the fixed canvas layout.
        globPatterns: ['**/*.{js,css,svg,woff2}'],
        // vite-plugin-pwa defaults this to 'index.html', which makes
        // workbox-build register an automatic NavigationRoute bound to
        // whatever's precached at that URL — since index.html is no longer
        // precached (see above), that route would still win over the
        // runtimeCaching rule below (routes match in registration order,
        // and the auto-added one comes first) and fail to serve anything.
        // Disabling it outright lets the runtimeCaching NetworkFirst rule
        // actually be the one handling navigations.
        navigateFallback: null,
        runtimeCaching: [
          {
            // Navigations always go to the network first (short timeout),
            // so the HTML shell is fresh and points at the CURRENT
            // deployment's assets — falls back to the last-cached shell
            // only when genuinely offline.
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html-shell',
              networkTimeoutSeconds: 3,
            },
          },
          {
            urlPattern: ({ url }) => url.origin.includes('randomuser.me'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'portraits',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
    // Mirror the production /faces proxy so portraits are same-origin in dev too.
    proxy: {
      '/faces': {
        target: 'https://randomuser.me',
        changeOrigin: true,
        rewrite: (p) =>
          p.replace(/^\/faces\/(men|women)\/(\d{1,3}\.jpg)$/, '/api/portraits/$1/$2'),
      },
      // Proxy /api to wrangler dev (Pages Functions) running on 8788.
      '/api': { target: 'http://localhost:8788', changeOrigin: true },
    },
  },
});

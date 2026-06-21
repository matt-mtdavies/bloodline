import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Bloodline is a PWA: installable, app-like, offline-tolerant shell.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icon-*.png'],
      manifest: {
        name: 'Bloodline',
        short_name: 'Bloodline',
        description: 'A living portrait of your family.',
        theme_color: '#1c1108',
        background_color: '#1c1108',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png',          sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png',          sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.svg',           sizes: 'any',     type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // Keep the app shell offline-tolerant; faces are remote and best-effort.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // Don't intercept server-rendered routes — let them reach Cloudflare Pages Functions.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/invite\//, /^\/api\//],
        runtimeCaching: [
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

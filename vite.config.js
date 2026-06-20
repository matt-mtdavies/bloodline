import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Bloodline is a PWA: installable, app-like, offline-tolerant shell.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Bloodline',
        short_name: 'Bloodline',
        description: 'A living portrait of your family.',
        theme_color: '#f7f3ec',
        background_color: '#f7f3ec',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Keep the app shell offline-tolerant; faces are remote and best-effort.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
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
    },
  },
});

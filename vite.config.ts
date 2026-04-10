import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';

export default defineConfig({
  // GitHub project pages: set GITHUB_PAGES_BASE=/repo-name/ when building (omit for custom domain at /).
  base: process.env.GITHUB_PAGES_BASE || '/',
  define: {
    // Automatically inject build timestamp for version tracking
    'import.meta.env.VITE_BUILD_TIMESTAMP': JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/*.png'],
      manifest: false,
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\.bsky\.app\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'bsky-cdn',
              expiration: { maxEntries: 500, maxAgeSeconds: 86400 * 30 },
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: { maxEntries: 200, maxAgeSeconds: 86400 * 60 },
            },
          },
          {
            urlPattern: /\.(?:js|css)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'static-resources',
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  build: {
    target: 'es2020',
    minify: 'terser',
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Split oauth library
          if (id.includes('@atproto/oauth-client-browser')) {
            return 'oauth';
          }
          // Split thread-related code
          if (id.includes('/pages/Thread')) {
            return 'thread';
          }
          // Split feed-related code
          if (id.includes('/api/feed')) {
            return 'feed';
          }
        },
      },
    },
  },
});

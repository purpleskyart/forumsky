import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

function versionPlugin() {
  return {
    name: 'version-generator',
    closeBundle() {
      const outDir = resolve(__dirname, 'dist');
      if (!existsSync(outDir)) {
        mkdirSync(outDir, { recursive: true });
      }
      const version = Date.now().toString(36);
      writeFileSync(
        resolve(outDir, 'version.json'),
        JSON.stringify({ version, timestamp: new Date().toISOString() })
      );
    },
  };
}

export default defineConfig({
  // GitHub project pages: set GITHUB_PAGES_BASE=/repo-name/ when building (omit for custom domain at /).
  base: process.env.GITHUB_PAGES_BASE || '/',
  plugins: [
    preact(),
    versionPlugin(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/*.png'],
      manifest: false,
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,json}'],
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
    rollupOptions: {
      output: {
        manualChunks: {
          oauth: ['@atproto/oauth-client-browser'],
        },
      },
    },
  },
});

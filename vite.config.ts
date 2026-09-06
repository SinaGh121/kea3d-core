import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['kea3d-icon.svg', 'kea3d-192.png', 'kea3d-512.png', 'KEA3D_MPL-2.0.txt', 'THIRD_PARTY_NOTICES.txt', 'licenses/*.txt'],
      manifest: {
        name: 'Kea3D',
        short_name: 'Kea3D',
        description: 'Fast, private, local-first 3D model viewer.',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'any',
        background_color: '#090b0f',
        theme_color: '#10141b',
        icons: [
          { src: 'kea3d-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'kea3d-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'kea3d-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{html,js,css,svg,png,woff2,wasm,txt}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});

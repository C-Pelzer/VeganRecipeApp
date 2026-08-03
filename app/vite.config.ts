import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Recipe Swipe',
        short_name: 'Recipes',
        description: 'Private household recipe swipe & meal planner',
        theme_color: '#166534',
        background_color: '#0a0a0a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // Recipe photos + the data bundle need to survive offline in the kitchen.
        globPatterns: ['**/*.{js,css,html,svg}'],
        runtimeCaching: [
          {
            urlPattern: /\/data\/recipes\.json$/,
            handler: 'CacheFirst',
            options: { cacheName: 'recipe-data' },
          },
          {
            urlPattern: /\/images\/recipes\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'recipe-images',
              expiration: { maxEntries: 1000 },
            },
          },
        ],
      },
    }),
  ],
  // Recipe images/data are large and shouldn't fail the build on Workbox's default size cap.
  server: {
    host: true,
  },
})

import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const supabaseUrl = env.VITE_SUPABASE_URL

  return {
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
          icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
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
              // Recipe photos live in Supabase Storage (scripts/upload-images.mjs), not
              // this app's own origin — match the storage bucket's URL prefix instead of
              // a local path.
              urlPattern: new RegExp(
                `^${supabaseUrl}/storage/v1/object/public/recipe-images/`,
              ),
              handler: 'CacheFirst',
              options: {
                cacheName: 'recipe-images',
                expiration: { maxEntries: 1000 },
                cacheableResponse: { statuses: [0, 200] },
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
    preview: {
      host: true,
    },
  }
})

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The staff panel's dev server.
 *
 * No `publicDir` override: unlike apps/web this serves none of the legacy
 * `design/` artwork, which is also why its compose service needs no bind mount
 * from outside the build context.
 *
 * The `/api` proxy is what makes every call same-origin -- the API has no CORS
 * configuration at all, and that absence is doing useful work.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.VITE_HOST ?? '127.0.0.1',
    port: 5174,
    // Fail rather than slide to 5175: inside a container that would look
    // exactly like the service being dead on its published port.
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.API_TARGET ?? 'http://127.0.0.1:3001',
        changeOrigin: false,
      },
    },
  },
})

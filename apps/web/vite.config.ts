import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * `design/` is served as-is from the repo root (outside v2/, next to the
 * legacy PHP it belongs to) instead of being bundled: 34 MB
 * of sprite sheets across 1,382 files, and 153 stylesheets holding roughly
 * 2,400 relative url() references. Mounting the whole tree at / means a rule
 * in /skin/ik_city_0.4.5.css still resolves ../img/foo.gif to /img/foo.gif,
 * so not one line of the legacy CSS has to change.
 */
const designDir = fileURLToPath(new URL('../../../design', import.meta.url))

/** The version the toolbar prints. The legacy read it from a config item. */
const version = process.env.npm_package_version ?? '0.0.0'

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(version),
  },
  publicDir: designDir,
  build: {
    // Keep the sprite tree out of dist; a real deployment serves it from a
    // static host or the API in front of the same path.
    copyPublicDir: false,
  },
  server: {
    // 0.0.0.0 inside a container, loopback on the host. Same for the API
    // target: `api` is the compose service name, 127.0.0.1 is a local run.
    host: process.env.VITE_HOST ?? '127.0.0.1',
    // Not 5173: that is Vite's default, and other local projects sit on it --
    // an IPv6 listener there shadows this one for browsers resolving
    // `localhost`. VITE_PORT overrides for anyone who needs the old port back.
    port: Number(process.env.VITE_PORT ?? 5175),
    proxy: {
      '/api': {
        target: process.env.API_TARGET ?? 'http://127.0.0.1:3001',
        changeOrigin: false,
        /**
         * The staff panel is not reachable from the game's origin.
         *
         * Browsers scope cookies by host, not by port, so this page and the
         * panel on :5174 share a cookie jar -- and because this proxy forwards
         * all of `/api` to the same Express, a `fetch('/api/admin/...')` from
         * here would be *same-origin*, carry the admin session, and be able to
         * read the admin CSRF cookie. One XSS in the game client would then
         * drive the whole panel. The API refuses those requests by `Origin`
         * too (apps/api/src/admin/auth.ts); this is the outer of the two locks.
         *
         * `false` is Vite's "answer 404 and do not proxy"; anything else
         * (undefined) carries on to the target.
         */
        bypass: (req) => (req.url?.startsWith('/api/admin') ? false : undefined),
      },
    },
  },
})

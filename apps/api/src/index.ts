import cookieParser from 'cookie-parser'
import express from 'express'

import { requireCsrf, requireSession } from './auth.js'
import { requireAdmin } from './admin/auth.js'
import { actionsRouter } from './routes/actions.js'
import {
  adminAuthRouter,
  adminNotFoundRouter,
  adminReadRouter,
  adminWriteRouter,
} from './routes/admin.js'
import { authRouter } from './routes/auth.js'
import { mapRouter } from './routes/map.js'
import { readRouter } from './routes/read.js'
import { stateRouter } from './routes/state.js'

const app = express()

app.use(express.json({ limit: '64kb' }))
app.use(cookieParser())

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.use('/api', authRouter)

// The staff panel.
//
// Mounted on the narrower `/api/admin` prefix, and before the player stack, for
// two symmetric reasons. `app.use(path, mw, router)` attaches `mw` to *every*
// request under `path`, not just the ones the router matches -- so mounting the
// admin guards on `/api` would 401 every player request that has no admin
// cookie, and mounting these routers after `requireSession` would 401 the
// panel's own login route. A separate identity, session table and cookie pair
// live in admin/auth.ts; the trailing 404 keeps a mistyped admin path from
// falling through into the player stack and answering a confusing 401.
app.use('/api/admin', adminAuthRouter)
app.use('/api/admin', requireAdmin, adminReadRouter)
// The write router carries its own origin and CSRF gates per route, so a path
// that matches nothing reaches the 404 below instead of failing a CSRF check.
app.use('/api/admin', requireAdmin, adminWriteRouter)
app.use('/api/admin', adminNotFoundRouter)

app.use('/api', requireSession, stateRouter)
app.use('/api', requireSession, mapRouter)
app.use('/api', requireSession, readRouter)
// Every mutation: session, then double-submit CSRF. The legacy had no CSRF
// protection at all -- every action was a bare GET, so an <img> tag on any
// page a logged-in player visited could demolish their buildings.
app.use('/api', requireSession, requireCsrf, actionsRouter)

// Errors must not leak stack traces or SQL. The legacy shipped with
// error_reporting(E_ALL) and db_debug on in its generated config, rendering
// full statements and absolute paths to any visitor.
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err)
    res.status(500).json({ error: 'internal_error' })
  },
)

const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '127.0.0.1'

app.listen(port, host, () => {
  console.log(`api listening on http://${host}:${port}`)
})

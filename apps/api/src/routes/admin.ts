/**
 * The staff panel's HTTP surface, `/api/admin/*`.
 *
 * Three routers, because the gates differ: the auth router is reachable without
 * a session (something has to be, or nobody could ever log in), the read router
 * needs one, and the write router needs a session, a CSRF token and a request
 * that actually came from the panel's own origin.
 *
 * Paths here are relative to the `/api/admin` mount, and both halves of that
 * matter. `app.use(path, mw, router)` attaches the middleware to every request
 * under `path` rather than to the routes the router happens to match: mounting
 * these on `/api` would have made `requireAdmin` a gate on the whole player API,
 * and mounting them after `app.use('/api', requireSession, …)` would have made
 * the player session a requirement for the panel's own login route. The 404 at
 * the bottom is the third face of the same fact -- without it a mistyped admin
 * path falls through into the player stack and comes back as 401.
 */

import {
  adminAuditListSchema,
  adminBanSchema,
  adminLoginSchema,
  adminPlayerCreateSchema,
  adminPlayerListSchema,
  adminPlayerUpdateSchema,
  adminResourceGrantSchema,
  adminUserCreateSchema,
  adminUserUpdateSchema,
} from '@izariam/shared/admin'
import { Router } from 'express'
import type { Request, Response } from 'express'

import {
  AdminFailure,
  adminFailureStatus,
  createAdmin,
  deleteAdmin,
  listAdmins,
  updateAdmin,
} from '../admin/admins.js'
import {
  ADMIN_SESSION_COOKIE,
  clearAdminCookies,
  clearRateLimit,
  createAdminSession,
  destroyAdminSession,
  issueAdminCsrf,
  loginRateLimited,
  requireAdmin,
  requireAdminCsrf,
  requireAdminOrigin,
  setAdminSessionCookie,
  verifyAdminLogin,
} from '../admin/auth.js'
import {
  PlayerFailure,
  banPlayer,
  getPlayer,
  listPlayers,
  playerFailureStatus,
  unbanPlayer,
  updatePlayer,
} from '../admin/players.js'
import { audit, listAudit } from '../admin/audit.js'
import {
  ResourceFailure,
  grantResources,
  playerResources,
  resourceFailureStatus,
} from '../admin/resources.js'
import { getSummary } from '../admin/summary.js'
import { createPasswordResetForUser } from '../actions/password-reset.js'
import {
  RegisterFailure,
  register,
  registerFailureStatus,
} from '../actions/register.js'
import { pool, transaction } from '../db.js'

export const adminAuthRouter: Router = Router()
export const adminReadRouter: Router = Router()
export const adminWriteRouter: Router = Router()

/** The acting admin, as the audit log and the self-edit guards want it. */
function actor(req: Request) {
  return { id: req.admin!.id, ip: req.ip }
}

function badInput(res: Response, detail?: unknown) {
  res.status(400).json({ error: 'invalid_input', detail })
}

function parsedId(req: Request): number | null {
  const id = Number(req.params.id)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** Turns the two failure classes into the status codes their codes imply. */
function sendFailure(res: Response, err: unknown): boolean {
  if (err instanceof AdminFailure) {
    res.status(adminFailureStatus(err.code)).json({ error: err.code })
    return true
  }
  if (err instanceof PlayerFailure) {
    res.status(playerFailureStatus(err.code)).json({ error: err.code })
    return true
  }
  if (err instanceof RegisterFailure) {
    res.status(registerFailureStatus(err.code)).json({ error: err.code })
    return true
  }
  if (err instanceof ResourceFailure) {
    res.status(resourceFailureStatus(err.code)).json({ error: err.code })
    return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

// The origin gate covers login too. Nothing is authenticated yet, so this is
// not CSRF protection -- it stops the game page (or any other site) from
// silently signing the browser into the panel as somebody else.
adminAuthRouter.post('/auth/login', requireAdminOrigin, async (req, res) => {
  const parsed = adminLoginSchema.safeParse(req.body)
  if (!parsed.success) {
    badInput(res)
    return
  }

  // Every failed attempt costs an argon2 hash in the same process that serves
  // the game, so the counter is about CPU, not about guessing.
  if (loginRateLimited(req.ip ?? 'unknown')) {
    res.status(429).json({ error: 'too_many_attempts' })
    return
  }

  const result = await verifyAdminLogin(pool, parsed.data.email, parsed.data.password)
  if (!result.ok) {
    // One answer for every rejection -- wrong password, disabled account, wrong
    // role. Naming them would confirm which addresses belong to staff.
    res.status(401).json({ error: 'bad_credentials' })
    return
  }

  clearRateLimit(req.ip ?? 'unknown')
  const session = await createAdminSession(
    pool,
    result.admin.id,
    req.ip,
    req.get('user-agent') ?? undefined,
  )
  await pool.query('update admin_users set last_login_at = now() where id = $1', [result.admin.id])

  setAdminSessionCookie(res, session)
  issueAdminCsrf(res)
  res.json({ admin: result.admin })
})

adminAuthRouter.get('/auth/me', requireAdmin, (req, res) => {
  res.json({ admin: req.admin })
})

adminAuthRouter.get('/auth/csrf', requireAdmin, (_req, res) => {
  issueAdminCsrf(res)
  res.json({ ok: true })
})

// No CSRF gate, matching the player side: a forced logout is a nuisance, not a
// vulnerability, and a panel that cannot log out is worse.
adminAuthRouter.post('/auth/logout', requireAdmin, async (req, res) => {
  const id = req.cookies?.[ADMIN_SESSION_COOKIE]
  if (id) await destroyAdminSession(pool, id)
  clearAdminCookies(res)
  res.status(204).end()
})

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

adminReadRouter.get('/admins', async (_req, res) => {
  res.json({ rows: await listAdmins(pool) })
})

adminReadRouter.get('/players', async (req, res) => {
  const parsed = adminPlayerListSchema.safeParse(req.query)
  if (!parsed.success) {
    badInput(res, parsed.error.issues)
    return
  }
  res.json(await listPlayers(pool, parsed.data))
})

adminReadRouter.get('/players/:id', async (req, res) => {
  const id = parsedId(req)
  if (id === null) {
    badInput(res)
    return
  }
  const found = await getPlayer(pool, id)
  if (!found) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  res.json(found)
})

/**
 * A player's stocks as they stand now.
 *
 * Goes through the tick rather than reading the columns: the numbers a staff
 * member sizes a grant against should be the ones the player will see, and
 * warehouse capacity is computed from the town's buildings rather than stored.
 * `advance()` writes nothing -- `persist()` is the only writer, and it is not
 * called here.
 */
adminReadRouter.get('/players/:id/resources', async (req, res) => {
  const id = parsedId(req)
  if (id === null) {
    badInput(res)
    return
  }
  const found = await transaction((client) => playerResources(client, id))
  if (!found) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  res.json(found)
})

adminReadRouter.get('/audit', async (req, res) => {
  const parsed = adminAuditListSchema.safeParse(req.query)
  if (!parsed.success) {
    badInput(res, parsed.error.issues)
    return
  }
  res.json(await listAudit(pool, parsed.data))
})

adminReadRouter.get('/summary', async (_req, res) => {
  res.json(await getSummary(pool))
})

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * The mutation gates, applied per route rather than at the mount.
 *
 * `app.use('/api/admin', ...gates, adminWriteRouter)` would run them for every
 * request that reached this layer, including ones that match no route here at
 * all -- so a mistyped path answered `csrf_failed` instead of falling through
 * to the 404 below. `requireAdmin` stays at the mount: an unknown path should
 * still need a session before it is told the path is unknown.
 */
const WRITE = [requireAdminOrigin, requireAdminCsrf]

adminWriteRouter.post('/admins', ...WRITE, async (req, res) => {
  const parsed = adminUserCreateSchema.safeParse(req.body)
  if (!parsed.success) {
    badInput(res, parsed.error.issues)
    return
  }
  try {
    const id = await transaction((client) => createAdmin(client, actor(req), parsed.data))
    res.status(201).json({ id })
  } catch (err) {
    if (!sendFailure(res, err)) throw err
  }
})

adminWriteRouter.patch('/admins/:id', ...WRITE, async (req, res) => {
  const id = parsedId(req)
  const parsed = adminUserUpdateSchema.safeParse(req.body)
  if (id === null || !parsed.success) {
    badInput(res, parsed.success ? undefined : parsed.error.issues)
    return
  }
  try {
    await transaction((client) => updateAdmin(client, actor(req), id, parsed.data))
    res.json({ ok: true })
  } catch (err) {
    if (!sendFailure(res, err)) throw err
  }
})

adminWriteRouter.delete('/admins/:id', ...WRITE, async (req, res) => {
  const id = parsedId(req)
  if (id === null) {
    badInput(res)
    return
  }
  try {
    await transaction((client) => deleteAdmin(client, actor(req), id))
    res.status(204).end()
  } catch (err) {
    if (!sendFailure(res, err)) throw err
  }
})

/**
 * Create a player.
 *
 * `register()` verbatim, because it is the only place that knows the whole
 * starting graph: the user row, an atomically claimed island slot, the town
 * hall at slot 0, the notes row and `current_town_id`/`capital_town_id`. It
 * throws, so a half-built account unwinds with the transaction.
 *
 * The one difference from `POST /auth/register`: no `createSession`. The panel
 * opens the account, it does not sign into it -- and with the cookie jar shared
 * across ports, handing the browser a player session here would clobber the
 * admin's own.
 */
adminWriteRouter.post('/players', ...WRITE, async (req, res) => {
  const parsed = adminPlayerCreateSchema.safeParse(req.body)
  if (!parsed.success) {
    badInput(res, parsed.error.issues)
    return
  }
  try {
    const created = await transaction(async (client) => {
      const result = await register(client, parsed.data)
      await audit(client, {
        adminUserId: req.admin!.id,
        action: 'player.create',
        targetType: 'player',
        targetId: result.userId,
        meta: { login: parsed.data.login },
        ip: req.ip,
      })
      return result
    })
    res.status(201).json(created)
  } catch (err) {
    if (!sendFailure(res, err)) throw err
  }
})

adminWriteRouter.patch('/players/:id', ...WRITE, async (req, res) => {
  const id = parsedId(req)
  const parsed = adminPlayerUpdateSchema.safeParse(req.body)
  if (id === null || !parsed.success) {
    badInput(res, parsed.success ? undefined : parsed.error.issues)
    return
  }
  try {
    await transaction((client) => updatePlayer(client, actor(req), id, parsed.data))
    res.json({ ok: true })
  } catch (err) {
    if (!sendFailure(res, err)) throw err
  }
})

adminWriteRouter.post('/players/:id/ban', ...WRITE, async (req, res) => {
  const id = parsedId(req)
  const parsed = adminBanSchema.safeParse(req.body)
  if (id === null || !parsed.success) {
    badInput(res, parsed.success ? undefined : parsed.error.issues)
    return
  }
  try {
    const result = await transaction((client) =>
      banPlayer(client, actor(req), id, parsed.data),
    )
    res.json(result)
  } catch (err) {
    if (!sendFailure(res, err)) throw err
  }
})

adminWriteRouter.post('/players/:id/unban', ...WRITE, async (req, res) => {
  const id = parsedId(req)
  if (id === null) {
    badInput(res)
    return
  }
  try {
    await transaction((client) => unbanPlayer(client, actor(req), id))
    res.json({ ok: true })
  } catch (err) {
    if (!sendFailure(res, err)) throw err
  }
})

/**
 * Grant or set resources.
 *
 * The write goes through `advance()` + `persist()` -- the same path a game
 * action takes -- because the columns behind these numbers are owned by the
 * tick. See admin/resources.ts for the five ways a plain UPDATE goes wrong.
 */
adminWriteRouter.post('/players/:id/resources', ...WRITE, async (req, res) => {
  const id = parsedId(req)
  const parsed = adminResourceGrantSchema.safeParse(req.body)
  if (id === null || !parsed.success) {
    badInput(res, parsed.success ? undefined : parsed.error.issues)
    return
  }
  try {
    const result = await transaction((client) =>
      grantResources(client, actor(req), id, parsed.data),
    )
    res.json(result)
  } catch (err) {
    if (!sendFailure(res, err)) throw err
  }
})

/**
 * Hand out a password reset ticket instead of setting a password.
 *
 * An admin who can set a player's password can sign in as them and leave no
 * trace; a one-shot, one-hour ticket cannot be used twice, drops every session
 * on use, and never tells the admin what the new password is.
 */
adminWriteRouter.post('/players/:id/reset-link', ...WRITE, async (req, res) => {
  const id = parsedId(req)
  if (id === null) {
    badInput(res)
    return
  }
  const exists = await pool.query('select 1 from users where id = $1', [id])
  if (exists.rowCount === 0) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  const token = await transaction(async (client) => {
    const issued = await createPasswordResetForUser(client, id)
    await audit(client, {
      adminUserId: req.admin!.id,
      action: 'player.reset_link',
      targetType: 'player',
      targetId: id,
      ip: req.ip,
    })
    return issued
  })
  res.json({ token })
})

/**
 * Anything under `/api/admin` that matched nothing above stops here.
 *
 * Without it the request would carry on into the player middleware stack and
 * come back as `401 not_authenticated`, which reads like an auth bug rather
 * than a typo.
 */
export const adminNotFoundRouter: Router = Router()
adminNotFoundRouter.all('/{*path}', (_req, res) => {
  res.status(404).json({ error: 'not_found' })
})

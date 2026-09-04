/**
 * Session auth for the staff panel.
 *
 * Everything here is a second, parallel copy of the player scheme in
 * `../auth.ts` rather than a shared one, and each difference is deliberate:
 *
 * - **Different cookie names.** Browsers scope cookies by host, not by port, so
 *   the game on 127.0.0.1:5173 and the panel on :5174 share one jar. If the
 *   panel wrote `izariam_session`, a staff member logging in here would silently
 *   overwrite their own player session -- and `res.clearCookie` on logout would
 *   sign them out of the game.
 * - **A different table.** `sessions.user_id` is a NOT NULL foreign key into
 *   `users`; an admin id stored there would either fail the constraint or, with
 *   the constraint relaxed, authenticate as the player who happens to share the
 *   number.
 * - **A different request property.** `req.admin`, never `req.userId`, so no
 *   handler can mistake one id for the other.
 * - **A shorter life.** Eight hours, not the players' seven days: a panel
 *   session is a shift.
 * - **Status re-read on every request.** See `requireAdmin`.
 */

import { randomBytes } from 'node:crypto'

import argon2 from 'argon2'
import type { NextFunction, Request, Response } from 'express'

import { csrfGuard } from '../auth.js'
import { pool } from '../db.js'
import type { Queryable } from '../state/load.js'

export const ADMIN_SESSION_COOKIE = 'izariam_admin_session'
export const ADMIN_CSRF_COOKIE = 'izariam_admin_csrf'
const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60

/**
 * The session cookie is scoped to the panel's own path, so a request from the
 * game origin never carries it at all. The CSRF cookie cannot be: the panel
 * reads it with `document.cookie` from a document at `/`, and a path-scoped
 * cookie is invisible there -- every mutation would 403 forever.
 *
 * `clearCookie` has to repeat the path or the browser keeps the cookie. (The
 * e2e cookie jar ignores paths, so that mistake would pass its tests.)
 */
const SESSION_COOKIE_PATH = '/api/admin'

/** `secure` cookies are never stored over plain http, so a hardcoded `true`
 *  would make the panel un-loginnable on a laptop. */
const SECURE_COOKIES = process.env.NODE_ENV === 'production'

export type AdminRole = 'super_admin'

export interface AdminIdentity {
  id: number
  email: string
  name: string
  role: AdminRole
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AdminIdentity
    }
  }
}

function newToken(): string {
  return randomBytes(32).toString('base64url')
}

export async function createAdminSession(
  client: Queryable,
  adminUserId: number,
  ip?: string,
  userAgent?: string,
): Promise<string> {
  const id = newToken()
  await client.query(
    `insert into admin_sessions (id, admin_user_id, expires_at, ip_address, user_agent)
     values ($1, $2, now() + make_interval(secs => $3), $4, $5)`,
    [id, adminUserId, ADMIN_SESSION_TTL_SECONDS, ip ?? null, userAgent ?? null],
  )
  return id
}

export async function destroyAdminSession(client: Queryable, id: string) {
  await client.query('delete from admin_sessions where id = $1', [id])
}

export type AdminLoginResult =
  | { ok: true; admin: AdminIdentity }
  | { ok: false; reason: 'bad_credentials' }

/**
 * Verify a panel login.
 *
 * Every rejection is the same `bad_credentials`, including "this account is
 * disabled" and "this role may not sign in". Naming those would confirm which
 * addresses belong to staff, and the panel is the highest-privilege surface in
 * the stack. The unknown-address branch spends an argon2 hash for the same
 * reason `verifyLogin` does (../auth.ts:87-92): so the response time does not
 * answer the question either.
 */
export async function verifyAdminLogin(
  client: Queryable,
  email: string,
  password: string,
): Promise<AdminLoginResult> {
  const { rows } = await client.query(
    `select id, email, name, role, active, password_hash
       from admin_users where lower(email) = lower($1) limit 1`,
    [email],
  )
  const admin = rows[0]
  if (!admin) {
    await argon2.hash(password, { type: argon2.argon2id })
    return { ok: false, reason: 'bad_credentials' }
  }

  if (!(await argon2.verify(String(admin.password_hash), password))) {
    return { ok: false, reason: 'bad_credentials' }
  }
  if (!admin.active) return { ok: false, reason: 'bad_credentials' }
  if (admin.role !== 'super_admin') return { ok: false, reason: 'bad_credentials' }

  return {
    ok: true,
    admin: {
      id: Number(admin.id),
      email: String(admin.email),
      name: String(admin.name),
      role: 'super_admin',
    },
  }
}

/**
 * Populates req.admin, or 401s.
 *
 * Unlike `requireSession`, this joins the identity table and re-checks `active`
 * and `role` on **every** request. The player lookup is the hottest query in
 * the app and reads one column from one table; the price of that is a ban not
 * biting until the session expires, which is why banning deletes sessions. The
 * panel serves a handful of requests a minute, so it can afford the join -- and
 * gets the property the player path lacks: disabling an admin, or dropping
 * their role, ends their access on the next request rather than at the next
 * login.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const id = req.cookies?.[ADMIN_SESSION_COOKIE]
  if (!id) {
    res.status(401).json({ error: 'not_authenticated' })
    return
  }

  const { rows } = await pool.query(
    `select a.id, a.email, a.name, a.role, a.active
       from admin_sessions s join admin_users a on a.id = s.admin_user_id
      where s.id = $1 and s.expires_at > now()`,
    [id],
  )
  const admin = rows[0]
  if (!admin) {
    res.status(401).json({ error: 'session_expired' })
    return
  }
  if (!admin.active) {
    res.status(403).json({ error: 'account_disabled' })
    return
  }
  if (admin.role !== 'super_admin') {
    res.status(403).json({ error: 'forbidden' })
    return
  }

  req.admin = {
    id: Number(admin.id),
    email: String(admin.email),
    name: String(admin.name),
    role: 'super_admin',
  }
  next()
}

export const requireAdminCsrf = csrfGuard(ADMIN_CSRF_COOKIE)

/**
 * The panel's own origin, and the only one allowed to send it a mutation.
 *
 * Without this the game page can drive the whole panel API: its Vite server
 * proxies all of `/api` to the same Express, so `fetch('/api/admin/...')` from
 * :5173 is *same-origin*, and the shared cookie jar supplies the session. The
 * game's proxy also refuses `/api/admin` (apps/web/vite.config.ts), so this is
 * the second of two locks on the same door.
 *
 * Browsers always send `Origin` on a POST, so a missing header means the caller
 * is not a browser; that is refused too rather than waved through.
 */
const ADMIN_ORIGIN = process.env.ADMIN_ORIGIN ?? 'http://127.0.0.1:5174'
const ALLOWED_ORIGINS = new Set([ADMIN_ORIGIN, ADMIN_ORIGIN.replace('127.0.0.1', 'localhost')])

export function requireAdminOrigin(req: Request, res: Response, next: NextFunction) {
  const origin = req.get('origin')
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    res.status(403).json({ error: 'bad_origin' })
    return
  }
  next()
}

export function setAdminSessionCookie(res: Response, id: string) {
  res.cookie(ADMIN_SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'strict',
    secure: SECURE_COOKIES,
    path: SESSION_COOKIE_PATH,
    maxAge: ADMIN_SESSION_TTL_SECONDS * 1000,
  })
}

export function clearAdminCookies(res: Response) {
  res.clearCookie(ADMIN_SESSION_COOKIE, { path: SESSION_COOKIE_PATH })
  res.clearCookie(ADMIN_CSRF_COOKIE)
}

export function issueAdminCsrf(res: Response): string {
  const token = newToken()
  res.cookie(ADMIN_CSRF_COOKIE, token, {
    sameSite: 'strict',
    secure: SECURE_COOKIES,
    httpOnly: false,
    maxAge: ADMIN_SESSION_TTL_SECONDS * 1000,
  })
  return token
}

/**
 * A fixed-window attempt counter for the login route.
 *
 * Not about guessing resistance -- the development password is in the
 * repository. It is that every failed attempt spends an argon2 hash in the
 * *same* Node process that serves the game, so an unauthenticated endpoint is
 * otherwise a free way to stall every player's requests.
 */
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000
const ATTEMPT_LIMIT = 10
const attempts = new Map<string, { count: number; resetAt: number }>()

export function loginRateLimited(ip: string): boolean {
  const now = Date.now()
  const seen = attempts.get(ip)
  if (!seen || seen.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS })
    // Cheap sweep: this map only ever holds admin login sources.
    if (attempts.size > 1000) {
      for (const [key, value] of attempts) if (value.resetAt <= now) attempts.delete(key)
    }
    return false
  }
  seen.count += 1
  return seen.count > ATTEMPT_LIMIT
}

/** A successful login forgets the counter for that address. */
export function clearRateLimit(ip: string) {
  attempts.delete(ip)
}

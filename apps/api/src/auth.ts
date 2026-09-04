/**
 * Session auth.
 *
 * The legacy signed its session cookie with `md5(payload . encryption_key)`
 * where encryption_key shipped empty (izariam/config/config.php:220,
 * system/libraries/Session.php:651), so anyone could forge a session and the
 * payload went straight into unserialize(). Sessions here are opaque random
 * ids stored server-side; the cookie carries no state at all.
 *
 * The cookie is httpOnly and SameSite=Lax -- the legacy set neither
 * (Session.php:655-662), and had no CSRF protection anywhere, which meant one
 * visited page could change a victim's password.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'

import argon2 from 'argon2'
import type { NextFunction, Request, Response } from 'express'

import { pool } from './db.js'
import type { Queryable } from './state/load.js'

export const SESSION_COOKIE = 'izariam_session'
export const CSRF_COOKIE = 'izariam_csrf'
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: number
    }
  }
}

function newToken(): string {
  return randomBytes(32).toString('base64url')
}

export async function createSession(
  client: Queryable,
  userId: number,
  ip?: string,
  userAgent?: string,
): Promise<string> {
  const id = newToken()
  await client.query(
    `insert into sessions (id, user_id, expires_at, ip_address, user_agent)
     values ($1, $2, now() + make_interval(secs => $3), $4, $5)`,
    [id, userId, SESSION_TTL_SECONDS, ip ?? null, userAgent ?? null],
  )
  return id
}

export async function destroySession(client: Queryable, id: string) {
  await client.query('delete from sessions where id = $1', [id])
}

export type LoginResult =
  | { ok: true; userId: number }
  | { ok: false; reason: 'bad_credentials' }
  | { ok: false; reason: 'account_blocked'; until: number; blockedReason: string | null }

/**
 * Verify a login. Accounts migrated from the legacy carry their old md5 in
 * `legacy_password_md5`; the first successful login upgrades them to argon2id
 * and clears it, so nobody has to reset a password for the migration.
 *
 * The ban check runs *after* the password is verified, as the legacy's did
 * (izariam/models/player_model.php:270-272, reached only once the login and
 * password matched), so a guesser cannot use it to learn which accounts exist.
 * An elapsed ban is cleared on the way through, matching :275-280.
 */
export async function verifyLogin(
  client: Queryable,
  login: string,
  password: string,
): Promise<LoginResult> {
  // `limit 1` because the lookup is on lower(login) and the unique index that
  // guarantees at most one such row was added later than this query.
  const { rows } = await client.query(
    `select id, password_hash, legacy_password_md5, blocked_until, blocked_reason
       from users where lower(login) = lower($1) limit 1`,
    [login],
  )
  const user = rows[0]
  if (!user) {
    // Spend roughly the same time as a real verification so the response does
    // not reveal whether the account exists.
    await argon2.hash(password, { type: argon2.argon2id })
    return { ok: false, reason: 'bad_credentials' }
  }

  if (user.legacy_password_md5) {
    const { createHash } = await import('node:crypto')
    const digest = createHash('md5').update(password).digest('hex')
    const a = Buffer.from(digest)
    const b = Buffer.from(String(user.legacy_password_md5))
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: 'bad_credentials' }
    }
    const upgraded = await argon2.hash(password, { type: argon2.argon2id })
    await client.query(
      'update users set password_hash = $2, legacy_password_md5 = null where id = $1',
      [user.id, upgraded],
    )
  } else if (!(await argon2.verify(String(user.password_hash), password))) {
    return { ok: false, reason: 'bad_credentials' }
  }

  const userId = Number(user.id)
  const blockedUntil: Date | null = user.blocked_until ? new Date(user.blocked_until) : null
  if (blockedUntil && blockedUntil.getTime() > Date.now()) {
    return {
      ok: false,
      reason: 'account_blocked',
      until: Math.floor(blockedUntil.getTime() / 1000),
      blockedReason: user.blocked_reason ?? null,
    }
  }
  if (blockedUntil) {
    await client.query(
      'update users set blocked_until = null, blocked_reason = null where id = $1',
      [userId],
    )
  }

  return { ok: true, userId }
}

/** Populates req.userId, or 401s. */
export async function requireSession(req: Request, res: Response, next: NextFunction) {
  const id = req.cookies?.[SESSION_COOKIE]
  if (!id) {
    res.status(401).json({ error: 'not_authenticated' })
    return
  }
  const { rows } = await pool.query(
    'select user_id from sessions where id = $1 and expires_at > now()',
    [id],
  )
  const userId = rows[0]?.user_id
  if (userId == null) {
    res.status(401).json({ error: 'session_expired' })
    return
  }
  req.userId = Number(userId)
  next()
}

/**
 * Double-submit CSRF: the token lives in a readable cookie and must be echoed
 * in a header. Applied to every state-changing route.
 *
 * A factory rather than a single function because the staff panel runs the same
 * scheme with its own cookie name -- the two apps share a cookie jar (browsers
 * scope by host, not by port), so they cannot share a token.
 */
export function csrfGuard(cookieName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const cookie = req.cookies?.[cookieName]
    const header = req.get('x-csrf-token')
    if (!cookie || !header || cookie !== header) {
      res.status(403).json({ error: 'csrf_failed' })
      return
    }
    next()
  }
}

export const requireCsrf = csrfGuard(CSRF_COOKIE)

/**
 * The CSRF cookie has to outlive the browser, because the session cookie does.
 * Written without a maxAge it was a browser-session cookie: close the browser,
 * come back the next day still logged in -- `requireSession` only reads the
 * session cookie -- and every mutation 403s, with nothing able to re-issue the
 * token short of logging out and back in. `GET /api/auth/csrf` now covers the
 * remaining gap for a session that loses it some other way.
 */
export function issueCsrf(res: Response): string {
  const token = newToken()
  res.cookie(CSRF_COOKIE, token, {
    sameSite: 'lax',
    secure: false,
    httpOnly: false,
    maxAge: SESSION_TTL_SECONDS * 1000,
  })
  return token
}

export function setSessionCookie(res: Response, id: string) {
  res.cookie(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: SESSION_TTL_SECONDS * 1000,
  })
}

import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '@izariam/shared'
import { Router } from 'express'

import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  createSession,
  destroySession,
  issueCsrf,
  requireSession,
  setSessionCookie,
  verifyLogin,
} from '../auth.js'
import {
  RegisterFailure,
  type RegisterErrorCode,
  register,
  registerFailureStatus,
} from '../actions/register.js'
import { ResetFailure, consumePasswordReset, createPasswordReset } from '../actions/password-reset.js'
import { pool, transaction } from '../db.js'

export const authRouter: Router = Router()

/**
 * The 400-vs-409 split lives with `register()` itself, since the panel's
 * "create player" route answers with the same codes.
 *
 * The distinction matters to the client, not just to HTTP: every code is one
 * the start page has a translated message for
 * (apps/web/src/screens/StartPage.tsx:36-43). Answering a short password with a
 * generic `invalid_input` -- which is what happened while the request schema
 * owned the length rules -- put a raw error code on the page.
 */
function sendRegisterFailure(res: import('express').Response, code: RegisterErrorCode) {
  res.status(registerFailureStatus(code)).json({ error: code })
}

/** Development convenience only: there is no mail transport in this stack. */
const EXPOSE_RESET_TOKEN = process.env.NODE_ENV !== 'production'

authRouter.post('/auth/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input', detail: parsed.error.issues })
    return
  }

  let result: { userId: number; townId: number; session: string }
  try {
    result = await transaction(async (client) => {
      const created = await register(client, parsed.data)
      const session = await createSession(
        client,
        created.userId,
        req.ip,
        req.get('user-agent') ?? undefined,
      )
      return { ...created, session }
    })
  } catch (err) {
    // register() throws so the transaction unwinds; a returned failure would
    // have committed the half-built account.
    if (err instanceof RegisterFailure) {
      sendRegisterFailure(res, err.code)
      return
    }
    throw err
  }

  setSessionCookie(res, result.session)
  issueCsrf(res)
  // Registration logs straight in, as the legacy did -- there is no email
  // confirmation gate (izariam/controllers/main.php:188).
  res.status(201).json({ userId: result.userId, townId: result.townId })
})

authRouter.post('/auth/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' })
    return
  }

  const result = await verifyLogin(pool, parsed.data.login, parsed.data.password)
  if (!result.ok) {
    if (result.reason === 'account_blocked') {
      res.status(403).json({
        error: 'account_blocked',
        until: result.until,
        reason: result.blockedReason,
      })
      return
    }
    res.status(401).json({ error: 'bad_credentials' })
    return
  }

  const session = await createSession(
    pool,
    result.userId,
    req.ip,
    req.get('user-agent') ?? undefined,
  )
  setSessionCookie(res, session)
  issueCsrf(res)
  res.json({ userId: result.userId })
})

/**
 * Re-issue the CSRF token for a live session.
 *
 * A GET, so it needs no token of its own -- the chicken-and-egg a client with
 * a valid session but no CSRF cookie would otherwise be stuck in. It is behind
 * `requireSession` so it hands nothing to an anonymous caller.
 */
authRouter.get('/auth/csrf', requireSession, (_req, res) => {
  issueCsrf(res)
  res.json({ ok: true })
})

authRouter.post('/auth/logout', requireSession, async (req, res) => {
  const id = req.cookies?.[SESSION_COOKIE]
  if (id) await destroySession(pool, id)
  res.clearCookie(SESSION_COOKIE)
  res.clearCookie(CSRF_COOKIE)
  res.status(204).end()
})

authRouter.post('/auth/forgot-password', async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' })
    return
  }

  const token = await createPasswordReset(pool, parsed.data.email)
  if (token) {
    console.log(`[password-reset] token for ${parsed.data.email}: ${token}`)
  }
  // Identical answer whether or not the address is registered.
  res.json(token && EXPOSE_RESET_TOKEN ? { ok: true, token } : { ok: true })
})

authRouter.post('/auth/reset-password', async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' })
    return
  }

  try {
    await transaction((client) =>
      consumePasswordReset(client, parsed.data.token, parsed.data.password),
    )
  } catch (err) {
    if (err instanceof ResetFailure) {
      res.status(400).json({ error: err.code })
      return
    }
    if (err instanceof RegisterFailure) {
      sendRegisterFailure(res, err.code)
      return
    }
    throw err
  }

  // Not signed in afterwards: the reset dropped every session, and going
  // through the login form proves the new password works.
  res.json({ ok: true })
})

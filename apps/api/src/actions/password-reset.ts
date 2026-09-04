/**
 * Password reset.
 *
 * The legacy's equivalent was `action=sendPassword`
 * (izariam/controllers/main.php:206-251): it looked an account up by email,
 * generated an eight-character password, wrote `md5()` of it onto the account
 * and mailed the plaintext. There was no token and no confirmation step, so a
 * single POST reset the password of any address you knew, and the mail itself
 * carried a working credential. None of that is reproduced.
 *
 * Here the mail would carry a token; only its sha-256 is stored, it expires in
 * an hour, it is good once, and using it drops every session the account had.
 * There is no mail transport in this stack, so outside production the token
 * comes back on the response and is logged -- see `routes/auth.ts`.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import argon2 from 'argon2'

import { checkPassword } from './register.js'
import type { Queryable } from '../state/load.js'

export const RESET_TTL_SECONDS = 60 * 60

export class ResetFailure extends Error {
  constructor(readonly code: 'invalid_token') {
    super(code)
    this.name = 'ResetFailure'
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Issue a ticket, or `null` when no account has that address.
 *
 * The caller must answer identically either way: whether an address is
 * registered is not something an anonymous request gets to find out.
 */
export async function createPasswordReset(
  client: Queryable,
  email: string,
): Promise<string | null> {
  const { rows } = await client.query(
    'select id from users where lower(email) = lower($1) limit 1',
    [email],
  )
  const userId: number | undefined = rows[0]?.id
  if (userId === undefined) return null
  return createPasswordResetForUser(client, userId)
}

/**
 * The same ticket, for a caller that already knows which account it means.
 *
 * `users.email` is not unique, so the address lookup above has to settle for
 * the first match. The admin panel picks a player by id and must not be able to
 * hand a ticket to the wrong one of two accounts sharing an address.
 */
export async function createPasswordResetForUser(
  client: Queryable,
  userId: number,
): Promise<string> {
  // One live ticket per account: asking again invalidates the previous mail.
  await client.query('delete from password_resets where user_id = $1', [userId])

  const token = randomBytes(32).toString('base64url')
  await client.query(
    `insert into password_resets (user_id, token_hash, expires_at)
     values ($1, $2, now() + make_interval(secs => $3))`,
    [userId, hashToken(token), RESET_TTL_SECONDS],
  )
  return token
}

/**
 * Spend a ticket and set the new password. Returns the account it belonged to.
 *
 * Throws `RegisterFailure('password_length')` for a password registration
 * would also refuse -- one rule, one place -- and `ResetFailure` for a token
 * that is unknown, already spent or expired, all reported identically.
 */
export async function consumePasswordReset(
  client: Queryable,
  token: string,
  password: string,
): Promise<number> {
  checkPassword(password)

  const digest = hashToken(token)
  const { rows } = await client.query(
    `select id, user_id, token_hash from password_resets
      where token_hash = $1 and used_at is null and expires_at > now() limit 1`,
    [digest],
  )
  const ticket = rows[0]
  if (!ticket) throw new ResetFailure('invalid_token')

  // The lookup above already matched on equality; this is the constant-time
  // comparison that keeps the stored digest from being probed a byte at a time
  // if that index is ever replaced by a scan.
  const a = Buffer.from(digest)
  const b = Buffer.from(String(ticket.token_hash))
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ResetFailure('invalid_token')

  const userId = Number(ticket.user_id)
  const hash = await argon2.hash(password, { type: argon2.argon2id })
  await client.query(
    'update users set password_hash = $2, legacy_password_md5 = null where id = $1',
    [userId, hash],
  )
  await client.query('update password_resets set used_at = now() where id = $1', [ticket.id])
  // Whoever was using the old password is signed out, which is the point of
  // resetting it.
  await client.query('delete from sessions where user_id = $1', [userId])

  return userId
}

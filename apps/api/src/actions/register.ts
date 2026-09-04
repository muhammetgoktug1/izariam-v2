/**
 * Registration, ported from izariam/controllers/main.php:95-204.
 *
 * Three things are deliberately different from the legacy:
 *
 * 1. It runs in one transaction, and it signals failure by *throwing*. The
 *    legacy performed seven sequential writes with no rollback, so a failure
 *    part-way left a user with no town, or a town holding an island slot that
 *    nothing pointed at. Returning a failure value instead of throwing had the
 *    same effect here for one code path -- `world_full` is decided after the
 *    user row is written, and a plain return lets the caller's transaction
 *    commit it, leaving an account with no town that can never be registered
 *    again because the name is now taken.
 *
 * 2. The island slot is claimed atomically. The legacy SELECTed a random
 *    island with a free slot (main.php:126) and then issued an unguarded
 *    UPDATE (:147), so two concurrent registrations could take the same slot
 *    and silently orphan the first town. Here the unique constraint on
 *    (island_id, slot) decides the winner and the loser retries.
 *
 * 3. Validation lives here and nowhere else. The request schema only checks
 *    that the fields are strings, so each rule below produces the specific
 *    code the start page has a translated message for.
 *
 * Passwords are argon2id rather than the legacy's unsalted md5
 * (izariam/models/player_model.php:265), and the plaintext is never emailed
 * back (:170).
 */

import argon2 from 'argon2'

import type { Queryable } from '../state/load.js'

export interface RegisterInput {
  login: string
  password: string
  email: string
}

export type RegisterErrorCode =
  | 'name_length'
  | 'password_length'
  | 'invalid_email'
  | 'name_taken'
  | 'world_full'

/** Every rejected registration. Thrown, so the caller's transaction unwinds. */
export class RegisterFailure extends Error {
  constructor(readonly code: RegisterErrorCode) {
    super(code)
    this.name = 'RegisterFailure'
  }
}

export interface RegisterResult {
  userId: number
  townId: number
}

export const LOGIN_MIN = 3
export const LOGIN_MAX = 30
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 30

/** Only even slots 0..14 are offered; odd ones are reachable by relocation. */
const STARTING_SLOTS = [0, 2, 4, 6, 8, 10, 12, 14]

const CLAIM_SLOT = `
  with free as (
    select i.id as island_id, s.slot
    from islands i
    cross join unnest($2::int[]) as s(slot)
    left join towns t on t.island_id = i.id and t.slot = s.slot
    where t.id is null
    order by random()
    limit 1
  )
  insert into towns (user_id, island_id, slot, name, last_update)
  select $1, island_id, slot, 'Polis', now() from free
  on conflict (island_id, slot) do nothing
  returning id
`

/** Matches the legacy's validation, which used CodeIgniter's valid_email().
 *  Exported so the admin panel applies the same rule to the addresses it
 *  writes instead of inventing a second one. */
export function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/**
 * Which registration failures are conflicts and which are bad input.
 *
 * Lives here rather than in the route because two routers now answer with it --
 * the public start page and the panel's "create player" form -- and the client
 * side of each has a translated message per code.
 */
const CONFLICT_CODES: ReadonlySet<RegisterErrorCode> = new Set(['name_taken', 'world_full'])

export function registerFailureStatus(code: RegisterErrorCode): 400 | 409 {
  return CONFLICT_CODES.has(code) ? 409 : 400
}

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505'

/**
 * Rejects the input the way the legacy did, in the same order
 * (main.php:105-110), and with codes the client can translate.
 *
 * Exported so password reset can apply the same password rule without
 * restating the bounds.
 */
export function checkPassword(password: string): void {
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new RegisterFailure('password_length')
  }
}

export async function register(
  client: Queryable,
  input: RegisterInput,
): Promise<RegisterResult> {
  const login = input.login.trim()
  if (login.length < LOGIN_MIN || login.length > LOGIN_MAX) {
    throw new RegisterFailure('name_length')
  }
  checkPassword(input.password)
  if (!validEmail(input.email)) throw new RegisterFailure('invalid_email')

  const existing = await client.query('select 1 from users where lower(login) = lower($1)', [login])
  if (existing.rows.length > 0) throw new RegisterFailure('name_taken')

  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id })

  // The pre-check above is a courtesy; the unique index on lower(login) is what
  // actually decides, so a name claimed between the two statements still lands
  // here as a conflict rather than a 500.
  let userId: number
  try {
    const inserted = await client.query(
      `insert into users (login, email, password_hash, register_complete, last_visit_at)
       values ($1, $2, $3, true, now())
       returning id`,
      [login, input.email, passwordHash],
    )
    userId = Number(inserted.rows[0]!.id)
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new RegisterFailure('name_taken')
    }
    throw err
  }

  // Retry on a lost slot race. Each attempt re-picks at random, so contention
  // resolves quickly even when many players register at once.
  let townId: number | undefined
  for (let attempt = 0; attempt < 8 && townId === undefined; attempt++) {
    const claim = await client.query(CLAIM_SLOT, [userId, STARTING_SLOTS])
    townId = claim.rows[0]?.id
  }
  // Throwing rather than returning is what keeps the user row from being
  // committed without a town (legacy: main.php:191-195 deleted it by hand).
  if (townId === undefined) throw new RegisterFailure('world_full')

  // Town hall at slot 0, level 1 -- this is what marks a town as founded.
  // Load_Player skips any town whose slot 0 is still level 0, which is how an
  // in-flight colonisation stays out of the economy.
  await client.query(
    `insert into town_buildings (town_id, slot, type, level) values ($1, 0, 1, 1)`,
    [townId],
  )
  // Starting resources and population come from the column defaults, which
  // carry the legacy's values (500 wood, 40 citizens, 3 action points).
  await client.query(`insert into notes (user_id) values ($1)`, [userId])
  await client.query(`update users set current_town_id = $2, capital_town_id = $2 where id = $1`, [
    userId,
    townId,
  ])

  return { userId, townId: Number(townId) }
}

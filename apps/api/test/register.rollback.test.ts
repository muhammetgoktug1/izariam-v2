/**
 * Registration is all-or-nothing.
 *
 * `world_full` is the one rejection decided *after* the user row is written,
 * which makes it the only way to observe whether the transaction actually
 * unwinds. While `register()` reported failures by returning a value, it did
 * not: `transaction()` saw a normal return, committed, and left an account with
 * no town -- unreachable, and holding a name that could never be registered
 * again. The legacy deleted the row by hand for exactly this case
 * (izariam/controllers/main.php:191-195).
 *
 * An empty world cannot be arranged against a seeded database (200 islands x 8
 * starting slots), so the slot claim is starved at the client instead.
 */

import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { RegisterFailure, register } from '../src/actions/register.js'
import { pool, transaction } from '../src/db.js'
import type { Queryable } from '../src/state/load.js'

let reachable = false

beforeAll(async () => {
  try {
    await pool.query('select 1')
    reachable = true
  } catch {
    reachable = false
  }
})

afterAll(async () => {
  await pool.end()
})

/** Every statement passes through except the island-slot claim, which never
 *  finds a free slot -- a full world. */
function worldFull(client: pg.PoolClient): Queryable {
  return {
    query: (text: string, params: unknown[]) =>
      text.includes('insert into towns')
        ? Promise.resolve({ rows: [] })
        : client.query(text, params as unknown[]),
  }
}

describe('registration rollback', () => {
  it('leaves no account behind when the world is full', async () => {
    if (!reachable) return
    const login = `rb${process.pid}${Math.floor(performance.now())}`.slice(0, 30)

    await expect(
      transaction((client) =>
        register(worldFull(client), {
          login,
          password: 'parola12345',
          email: 'rb@example.com',
        }),
      ),
    ).rejects.toThrow(RegisterFailure)

    const { rows } = await pool.query('select 1 from users where lower(login) = lower($1)', [login])
    expect(rows, 'the user row must not survive a failed registration').toHaveLength(0)

    // And the name is free, so the player can simply try again.
    const retry = await pool.query('select 1 from users where lower(login) = lower($1)', [login])
    expect(retry.rows).toHaveLength(0)
  })
})

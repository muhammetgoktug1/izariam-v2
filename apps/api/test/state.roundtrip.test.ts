/**
 * Integration test for the persistence boundary: register a player, load the
 * graph, advance it with the rules engine, save, and reload.
 *
 * Requires the `pg` service from docker-compose. Skipped when DATABASE_URL is
 * unset so the unit suites still run on a bare checkout.
 */

import { tickPlayer } from '@izariam/rules'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { register } from '../src/actions/register.js'
import { loadPlayerState } from '../src/state/load.js'
import { savePlayerState } from '../src/state/save.js'

const URL = process.env.DATABASE_URL ?? 'postgres://izariam:izariam@127.0.0.1:5432/izariam'

let pool: pg.Pool
let reachable = false

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: URL, connectionTimeoutMillis: 2000 })
  try {
    await pool.query('select 1')
    reachable = true
  } catch {
    reachable = false
  }
})

afterAll(async () => {
  await pool?.end()
})

/** Unique per run so repeated runs do not collide on the login constraint. */
function uniqueLogin(prefix: string): string {
  return `${prefix}${process.pid}${Math.floor(performance.now())}`.slice(0, 30)
}

async function withRollback<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    return await fn(client)
  } finally {
    await client.query('rollback')
    client.release()
  }
}

describe.runIf(process.env.DATABASE_URL !== 'skip')('state round trip', () => {
  it('registers a player and claims exactly one island slot', async () => {
    if (!reachable) return
    await withRollback(async (c) => {
      // register() throws RegisterFailure rather than returning a failure
      // value, so the caller's transaction unwinds instead of committing a
      // half-built account.
      const res = await register(c, {
        login: uniqueLogin('rt'),
        password: 'parola12345',
        email: 'rt@example.com',
      })

      const { rows } = await c.query(
        'select island_id, slot from towns where user_id = $1',
        [res.userId],
      )
      expect(rows).toHaveLength(1)
      expect([0, 2, 4, 6, 8, 10, 12, 14]).toContain(Number(rows[0].slot))
    })
  })

  it('loads the graph a freshly registered player should have', async () => {
    if (!reachable) return
    await withRollback(async (c) => {
      const res = await register(c, {
        login: uniqueLogin('ld'),
        password: 'parola12345',
        email: 'ld@example.com',
      })
      const state = await loadPlayerState(c, res.userId)
      expect(state).not.toBeNull()
      expect(state!.towns).toHaveLength(1)

      const town = state!.towns[0]!
      expect(town.buildings.bySlot[0]).toEqual({ type: 1, level: 1 })
      expect(town.resources.wood).toBe(500)
      expect(town.peoples).toBe(40)
      expect(state!.islands[town.islandId]).toBeDefined()
      expect(state!.user.capitalTownId).toBe(town.id)
    })
  })

  it('survives load -> tick -> save -> reload with the tick applied', async () => {
    if (!reachable) return
    await withRollback(async (c) => {
      const res = await register(c, {
        login: uniqueLogin('tk'),
        password: 'parola12345',
        email: 'tk@example.com',
      })
      // Backdate the town so the tick has an hour of elapsed time to apply.
      await c.query(`update towns set last_update = now() - interval '1 hour' where id = $1`, [
        res.townId,
      ])
      // 30 lumberjacks, which the island's level-1 sawmill can just about hold.
      await c.query(`update towns set workers = 30, peoples = 10 where id = $1`, [res.townId])

      const before = await loadPlayerState(c, res.userId)
      expect(before).not.toBeNull()
      const startGold = before!.user.gold
      const startWood = before!.towns[0]!.resources.wood

      const now = Math.floor(Date.now() / 1000)
      const { state, messages } = tickPlayer(before!, now)
      await savePlayerState(c, state, messages)

      const after = await loadPlayerState(c, res.userId)
      expect(after).not.toBeNull()
      const town = after!.towns[0]!

      // 30 workers under the node cap produce 30 wood/hour.
      expect(town.resources.wood).toBeGreaterThan(startWood)
      expect(town.resources.wood).toBeCloseTo(startWood + 30, 1)
      // 10 free citizens at 3 gold each.
      expect(after!.user.gold).toBeCloseTo(startGold + 30, 1)
      // The watermark advanced, so a second tick is a no-op.
      expect(town.lastUpdate).toBeGreaterThanOrEqual(now - 1)

      const { state: twice } = tickPlayer(after!, now)
      expect(twice.towns[0]!.resources.wood).toBeCloseTo(town.resources.wood, 4)
    })
  })

  it('reads the whole player graph in a single statement', async () => {
    if (!reachable) return
    await withRollback(async (c) => {
      const res = await register(c, {
        login: uniqueLogin('q'),
        password: 'parola12345',
        email: 'q@example.com',
      })
      let statements = 0
      const counting = {
        query: (text: string, params: unknown[]) => {
          statements++
          return c.query(text, params as any[])
        },
      }
      const state = await loadPlayerState(counting, res.userId)
      expect(state).not.toBeNull()
      // The legacy needed 25 at the very best, and up to ~950.
      expect(statements).toBe(1)
    })
  })
})

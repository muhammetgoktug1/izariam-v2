/**
 * The island monument, over HTTP.
 *
 * Three things here cannot be checked anywhere else. The three-good gate and
 * the surplus carry are rules, but they only matter once the counters come
 * from a row rather than an argument. The roster is a query. And the last case
 * is the reason the whole feature locks the island row: two players donating
 * at once must add up to one expansion, not two, and that only fails against a
 * real database.
 */

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { cleanup, makePool, newPlayer, probe, type Player } from './harness.js'

let pool: pg.Pool
let up = false

beforeAll(async () => {
  pool = makePool()
  up = await probe(pool)
})

afterAll(async () => {
  if (up) await cleanup(pool)
  await pool?.end()
})

const TEMPLE = 26

async function stock(townId: number) {
  await pool.query(
    `update towns set wood = 500000, wine = 500000, marble = 500000, crystal = 500000,
       sulfur = 500000, peoples = 5000 where id = $1`,
    [townId],
  )
}

async function building(townId: number, slot: number, type: number, level = 1) {
  await pool.query(
    `insert into town_buildings (town_id, slot, type, level) values ($1, $2, $3, $4)
     on conflict (town_id, slot) do update set type = excluded.type, level = excluded.level`,
    [townId, slot, type, level],
  )
}

async function islandOf(townId: number): Promise<number> {
  const { rows } = await pool.query('select island_id from towns where id = $1', [townId])
  return Number(rows[0].island_id)
}

async function islandRow(islandId: number) {
  const { rows } = await pool.query(
    `select trade_resource, wonder, wonder_level,
            wonder_wine_donated as wine, wonder_marble_donated as marble,
            wonder_crystal_donated as crystal, wonder_sulfur_donated as sulfur
       from islands where id = $1`,
    [islandId],
  )
  return rows[0]
}

/** The luxury an island produces, which is the one its monument refuses. */
const OWN_GOOD: Record<number, string> = { 1: 'wine', 2: 'marble', 3: 'crystal', 4: 'sulfur' }
const GOODS = ['wine', 'marble', 'crystal', 'sulfur']

/**
 * A player on an island that has a monument, with a temple standing.
 *
 * Registration picks the island, so the monument is whatever that island got
 * at seed time; the tests read `wonder` back rather than assuming one.
 */
async function donor(prefix: string): Promise<{ p: Player; islandId: number }> {
  const p = await newPlayer(prefix)
  // A warehouse first: the tick clamps every resource to capacity before the
  // action runs, so without one a 1,200-good donation has nothing to pay from.
  await building(p.townId, 1, 6, 20)
  await building(p.townId, 3, TEMPLE, 4)
  await building(p.townId, 0, 1, 8)
  await stock(p.townId)
  const islandId = await islandOf(p.townId)
  // Registration puts the player on whichever island has a free slot, which
  // an earlier case in this file may already have expanded -- so the monument
  // is put back to where a fresh world starts it. Every seeded island has one;
  // an imported island might not, and gets Demeter rather than a skipped test.
  await pool.query(
    `update islands set wonder = coalesce(nullif(wonder, 0), 3), wonder_level = 1,
       wonder_wine_donated = 0, wonder_marble_donated = 0,
       wonder_crystal_donated = 0, wonder_sulfur_donated = 0
     where id = $1`,
    [islandId],
  )
  return { p, islandId }
}

async function goodsFor(islandId: number): Promise<string[]> {
  const row = await islandRow(islandId)
  const own = OWN_GOOD[Number(row.trade_resource)]
  return GOODS.filter((g) => g !== own)
}

describe('donating to the island monument', () => {
  it('moves the good out of the town and onto the island', async () => {
    if (!up) return
    const { p, islandId } = await donor('wdonate')
    const [good] = await goodsFor(islandId)

    // One tick first, so the reading below is not the pre-clamp figure `stock`
    // wrote: `advance()` runs before every action and trims each resource to
    // the warehouse ceiling.
    expect((await p.client.getJson('/state')).status).toBe(200)
    const { rows: before } = await pool.query(
      `select ${good} as stock from towns where id = $1`,
      [p.townId],
    )

    const res = await p.client.post('/actions/donateWonder', {
      townId: p.townId,
      islandId,
      good,
      amount: 250,
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)

    const row = await islandRow(islandId)
    expect(Number(row[good!])).toBe(250)

    const { rows } = await pool.query(
      `select wonder_donated, ${good} as stock from towns where id = $1`,
      [p.townId],
    )
    expect(Number(rows[0].wonder_donated)).toBe(250)
    expect(Number(rows[0].stock)).toBeLessThanOrEqual(Number(before[0].stock) - 250)
  })

  it('refuses the good the island produces itself, and changes nothing', async () => {
    if (!up) return
    const { p, islandId } = await donor('wown')
    const own = OWN_GOOD[Number((await islandRow(islandId)).trade_resource)]!

    const res = await p.client.post('/actions/donateWonder', {
      townId: p.townId,
      islandId,
      good: own,
      amount: 100,
    })
    expect(res.status).toBe(409)
    expect((res.body as any).error).toBe('wonder_wrong_good')

    const row = await islandRow(islandId)
    expect(Number(row[own])).toBe(0)
    expect(Number(row.wonder_level)).toBe(1)
  })

  it('expands only when all three goods are paid, and keeps the surplus', async () => {
    if (!up) return
    const { p, islandId } = await donor('wgate')
    const goods = await goodsFor(islandId)
    const cost = 1200 // wonderUpgradeCost(1), gamedata/temple.json

    for (const good of goods.slice(0, 2)) {
      const res = await p.client.post('/actions/donateWonder', {
        townId: p.townId,
        islandId,
        good,
        amount: cost,
      })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
    }
    expect(Number((await islandRow(islandId)).wonder_level)).toBe(1)

    const res = await p.client.post('/actions/donateWonder', {
      townId: p.townId,
      islandId,
      good: goods[2],
      amount: cost + 90,
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)

    const row = await islandRow(islandId)
    expect(Number(row.wonder_level)).toBe(2)
    expect(Number(row[goods[0]!])).toBe(0)
    expect(Number(row[goods[1]!])).toBe(0)
    // What was given over the cost stays on the monument.
    expect(Number(row[goods[2]!])).toBe(90)
  })

  /**
   * The lock, which is the point of the design.
   *
   * Both donations alone complete level 2. `savePlayerState` writes island rows
   * blind, and without `select … for update` in the donate route both requests
   * read the same pre-upgrade counters, both see the last good land, and the
   * monument reaches 3 for one level's worth of goods.
   */
  it('counts two simultaneous donations once each, and expands once', async () => {
    if (!up) return
    const { p, islandId } = await donor('wrace1')
    const goods = await goodsFor(islandId)
    const cost = 1200

    // Two of the three already paid, so either donation completes the level.
    await pool.query(
      `update islands set wonder_${goods[0]}_donated = $2, wonder_${goods[1]}_donated = $2
         where id = $1`,
      [islandId, cost],
    )

    // A neighbour on the same island.
    const other = await newPlayer('wrace2')
    const { rows } = await pool.query(
      `with free as (
         select s.slot from unnest(array[1,3,5,7,9,11,13]) as s(slot)
         left join towns t on t.island_id = $2 and t.slot = s.slot
         where t.id is null order by s.slot limit 1
       )
       insert into towns (user_id, island_id, slot, name, last_update)
       select $1, $2, slot, 'Neighbour', now() from free returning id`,
      [other.userId, islandId],
    )
    const otherTownId = Number(rows[0].id)
    await building(otherTownId, 0, 1, 8)
    await stock(otherTownId)

    const [a, b] = await Promise.all([
      p.client.post('/actions/donateWonder', {
        townId: p.townId,
        islandId,
        good: goods[2],
        amount: cost,
      }),
      other.client.post('/actions/donateWonder', {
        townId: otherTownId,
        islandId,
        good: goods[2],
        amount: cost,
      }),
    ])
    expect(a.status, JSON.stringify(a.body)).toBe(200)
    expect(b.status, JSON.stringify(b.body)).toBe(200)

    const row = await islandRow(islandId)
    expect(Number(row.wonder_level)).toBe(2)
    // Both donations landed: one paid for the level, the other is still there.
    expect(Number(row[goods[2]!])).toBe(cost)
  })
})

describe('GET /island/:id/wonder', () => {
  it('reports every town on the island with its converted islanders and share', async () => {
    if (!up) return
    const { p, islandId } = await donor('wroster')
    await pool.query('update towns set templer = 20 where id = $1', [p.townId])

    const res = await p.client.getJson(`/island/${islandId}/wonder`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const body = res.body as any

    expect(body.island.goods).toHaveLength(3)
    expect(body.island.goods).not.toContain(OWN_GOOD[Number(body.island.tradeResource)])
    expect(body.island.costPerGood).toBeGreaterThan(0)

    const mine = body.towns.find((row: any) => row.townId === p.townId)
    expect(mine).toBeTruthy()
    expect(mine.priests).toBe(20)
    // Five islanders each, capped at what the town can hold.
    expect(mine.converted).toBe(Math.min(100, mine.capacity))

    const shares = body.towns.reduce((sum: number, row: any) => sum + row.share, 0)
    expect(shares).toBeCloseTo(1, 5)
    expect(body.faith.faith).toBeGreaterThan(0)
  })

  it('is 404 for an island that does not exist and 400 for a bad id', async () => {
    if (!up) return
    const { p } = await donor('wmiss')
    expect((await p.client.getJson('/island/99999999/wonder')).status).toBe(404)
    expect((await p.client.getJson('/island/0/wonder')).status).toBe(400)
  })
})

describe('the monument caps the miracle', () => {
  it('grants the monument level when faith would have allowed more', async () => {
    if (!up) return
    const { p, islandId } = await donor('wclamp')
    // Enough priests that the island believes completely, on a monument that
    // has not been expanded at all.
    await pool.query('update towns set templer = 5000, peoples = 100 where id = $1', [p.townId])

    const res = await p.client.post('/actions/activateMiracle', { islandId })
    expect(res.status, JSON.stringify(res.body)).toBe(200)

    const { rows } = await pool.query(
      'select level from miracle_activations where user_id = $1 and island_id = $2',
      [p.userId, islandId],
    )
    expect(Number(rows[0].level)).toBe(1)

    // Raise the monument, wind the cooldown back, and the same faith buys more.
    await pool.query('update islands set wonder_level = 3 where id = $1', [islandId])
    await pool.query(
      `update miracle_activations set activated_at = now() - interval '30 days'
         where user_id = $1 and island_id = $2`,
      [p.userId, islandId],
    )

    const again = await p.client.post('/actions/activateMiracle', { islandId })
    expect(again.status, JSON.stringify(again.body)).toBe(200)
    const after = await pool.query(
      'select level from miracle_activations where user_id = $1 and island_id = $2',
      [p.userId, islandId],
    )
    expect(Number(after.rows[0].level)).toBe(3)
  })
})

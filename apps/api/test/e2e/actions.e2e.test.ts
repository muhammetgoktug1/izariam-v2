/**
 * All 40 mutation endpoints, over HTTP.
 *
 * Two layers:
 *
 * 1. A smoke pass that posts a schema-valid body to every endpoint and insists
 *    the answer comes from the *rules* -- 200, or 409 with a reason. A 400
 *    means the request contract moved, a 404 or 403 means the mount or a guard
 *    is wrong, and a 500 means it never got there. None of that was covered
 *    before: the only integration test in the repo called `register()` as a
 *    function and never opened a socket.
 * 2. Effect tests for the actions a player uses, each asserting the change in
 *    `GET /api/state` rather than in the database, because that is what the
 *    screens read.
 */

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { constructionHead, hurryCost } from '@izariam/rules'

import {
  Client,
  PASSWORD,
  cleanup,
  makePool,
  newPlayer,
  probe,
  uniqueLogin,
  type Player,
} from './harness.js'

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

/** Enough of everything that an action fails on its own rules, not on stock. */
async function stock(townId: number) {
  await pool.query(
    `update towns set wood = 500000, wine = 500000, marble = 500000, crystal = 500000,
       sulfur = 500000, peoples = 5000, action_points = 3 where id = $1`,
    [townId],
  )
}

/** Put a finished building on a slot without waiting for a build queue. */
async function building(townId: number, slot: number, type: number, level = 1) {
  await pool.query(
    `insert into town_buildings (town_id, slot, type, level) values ($1, $2, $3, $4)
     on conflict (town_id, slot) do update set type = excluded.type, level = excluded.level`,
    [townId, slot, type, level],
  )
}

async function state(p: Player) {
  const res = await p.client.getJson('/state')
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body
}

function town(snapshot: any, townId: number) {
  return snapshot.state.towns.find((t: any) => t.id === townId)
}

/**
 * A second, founded town, placed straight onto a free odd slot.
 *
 * Colonisation is a fleet that has to arrive, so the actions that merely need
 * two towns do not go through it.
 */
async function secondTown(userId: number, name = 'Colony'): Promise<number> {
  const { rows } = await pool.query(
    `with free as (
       select i.id, s.slot from islands i
       cross join unnest(array[1,3,5,7,9,11,13]) as s(slot)
       left join towns t on t.island_id = i.id and t.slot = s.slot
       where t.id is null order by random() limit 1
     )
     insert into towns (user_id, island_id, slot, name, last_update)
     select $1, id, slot, $2, now() from free returning id`,
    [userId, name],
  )
  const townId = Number(rows[0].id)
  await building(townId, 0, 1, 1) // town hall: what marks a town as founded
  await stock(townId)
  return townId
}

describe('every mutation endpoint answers from the rules engine', () => {
  let p: Player
  let islandId = 0

  beforeAll(async () => {
    if (!up) return
    p = await newPlayer('smoke')
    await stock(p.townId)
    const snapshot = await state(p)
    islandId = town(snapshot, p.townId).islandId
  })

  /**
   * A schema-valid body for each endpoint. Ids that need to exist deliberately
   * do not: a spy, mission or message that is not the caller's must come back
   * as a rules refusal, never as a crash.
   */
  const cases = (): [string, unknown][] => [
    ['build', { townId: p.townId, slot: 1, type: 2 }],
    ['upgrade', { townId: p.townId, slot: 0 }],
    ['demolish', { townId: p.townId, slot: 1 }],
    ['abortBuildings', { townId: p.townId }],
    ['leaveConstructionList', { townId: p.townId, index: 0 }],
    ['workers', { townId: p.townId, screen: '', slot: 0, resourceWorkers: 1 }],
    ['resources', { townId: p.townId, kind: 'resource', islandId, donation: 1 }],
    ['tavern', { townId: p.townId, slot: 6, amount: 0 }],
    ['army', { townId: p.townId, slot: 5, counts: {} }],
    ['fleet', { townId: p.townId, slot: 4, counts: {} }],
    ['armyEdit', { townId: p.townId, counts: {} }],
    ['abortUnits', { townId: p.townId }],
    ['abortShips', { townId: p.townId }],
    ['spyes/buy', { townId: p.townId }],
    ['spyes/send', { townId: p.townId, islandId: 0, targetTownId: p.townId }],
    ['spyes/return', { townId: p.townId, spyId: 1, fromTownId: p.townId }],
    ['resolveEspionage', { townId: p.townId, spyId: 1, mission: 3 }],
    ['branchOffice', { townId: p.townId }],
    [
      'trade',
      {
        townId: p.townId,
        targetTownId: p.townId,
        type: 1,
        counts: {},
        prices: {},
        transporters: 0,
      },
    ],
    [
      'transport',
      { townId: p.townId, islandId, targetTownId: p.townId, cargo: {}, transporters: 0 },
    ],
    ['transporter', { townId: p.townId }],
    ['abortFleet', { missionId: 1 }],
    [
      'tradeRoute/create',
      { fromTownId: p.townId, toTownId: p.townId, tradegood: 0, hour: 12, count: 10 },
    ],
    [
      'tradeRoute/edit',
      {
        routeId: 1,
        fromTownId: p.townId,
        toTownId: p.townId,
        tradegood: 0,
        hour: 12,
        count: 10,
      },
    ],
    ['tradeRoute/delete', { deleteId: 1 }],
    ['colonize/found', { townId: p.townId, islandId, slot: 1, send: {}, transports: 1 }],
    ['colonize/relocate', { townId: p.townId, islandId, slot: 1 }],
    ['abolishColony', {}],
    ['changeCapital', { townId: p.townId }],
    ['doResearch', { way: 1, id: 1 }],
    ['buyPremium', { type: 'wood' }],
    ['renameLogin', { login: uniqueLogin('rn') }],
    [
      'changePassword',
      { oldPassword: 'wrongwrong1', newPassword: PASSWORD, confirmPassword: PASSWORD },
    ],
    ['setCitySelectMode', { mode: 1 }],
    ['skipTutorial', {}],
    ['tutorials', { action: 'next', id: 0 }],
    ['renameTown', { townId: p.townId, name: 'Smoke' }],
    ['sendUserMessage', { toUserId: p.userId, type: 1, text: 'hello' }],
    ['readUserMessage', { id: 1 }],
    ['deleteUserMessages', { id: 1 }],
  ]

  it('covers all 40', () => {
    if (!up) return
    expect(cases()).toHaveLength(40)
  })

  /**
   * 200 accepted; 409 the rules refused; 403 and 404 the two routes that pick
   * their own status for an ownership or lookup failure (actions.ts:519-520,
   * :635). Every other code, and every error below, means the request never
   * reached the rules.
   */
  const ROUTED = new Set([200, 403, 404, 409])
  const WIRING_ERRORS = new Set([
    'invalid_request',
    'not_authenticated',
    'session_expired',
    'csrf_failed',
    'internal_error',
    'no_player',
  ])

  it('reaches the rules for every one', async () => {
    if (!up) return
    const wrong: string[] = []
    for (const [path, body] of cases()) {
      const res = await p.client.post(`/actions/${path}`, body)
      const error = (res.body as { error?: string } | null)?.error
      if (!ROUTED.has(res.status) || (error && WIRING_ERRORS.has(error))) {
        wrong.push(`${path} -> ${res.status} ${JSON.stringify(res.body)}`)
      }
    }
    expect(wrong.join('\n')).toBe('')
  })
})

describe('buildings', () => {
  it('queues two builds and drops the queued one', async () => {
    if (!up) return
    const p = await newPlayer('build')
    await stock(p.townId)
    // A second entry in the build queue is a premium account feature -- the
    // sidebox is literally the premium build queue (sidebox/city.php).
    const premium = await p.client.post('/actions/buyPremium', { type: 'account' })
    expect(premium.status, JSON.stringify(premium.body)).toBe(200)

    for (const [slot, type] of [
      [1, 2],
      [2, 3],
    ]) {
      const queued = await p.client.post('/actions/build', { townId: p.townId, slot, type })
      expect(queued.status, JSON.stringify(queued.body)).toBe(200)
    }
    expect(town(await state(p), p.townId).buildQueue).toHaveLength(2)

    // Index 0 is the entry under construction and the rules refuse it
    // (building.ts:434); the city sidebox sends that one to the demolition
    // screen instead.
    const head = await p.client.post('/actions/leaveConstructionList', {
      townId: p.townId,
      index: 0,
    })
    expect(head.status).toBe(409)
    expect(head.body.error).toBe('construction_entry_missing')

    const left = await p.client.post('/actions/leaveConstructionList', {
      townId: p.townId,
      index: 1,
    })
    expect(left.status, JSON.stringify(left.body)).toBe(200)
    expect(town(await state(p), p.townId).buildQueue).toHaveLength(1)
  })

  it('moves citizens onto the saw mill', async () => {
    if (!up) return
    const p = await newPlayer('work')
    await stock(p.townId)

    const res = await p.client.post('/actions/workers', {
      townId: p.townId,
      screen: '',
      slot: 0,
      resourceWorkers: 12,
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(town(await state(p), p.townId).workers).toBe(12)
  })

  it('renames a town', async () => {
    if (!up) return
    const p = await newPlayer('rt')
    const res = await p.client.post('/actions/renameTown', { townId: p.townId, name: 'Miletos' })
    expect(res.status).toBe(200)
    expect(town(await state(p), p.townId).name).toBe('Miletos')
  })
})

describe('recruitment', () => {
  /** The queue the barracks and shipyard sideboxes render, and the two abort
   *  endpoints that had no caller at all before. */
  it('fills the land queue and empties it again', async () => {
    if (!up) return
    const p = await newPlayer('army')
    await stock(p.townId)
    await building(p.townId, 5, 5, 3) // barracks, level 3

    const recruited = await p.client.post('/actions/army', {
      townId: p.townId,
      slot: 5,
      counts: { 3: 2 },
    })
    expect(recruited.status, JSON.stringify(recruited.body)).toBe(200)

    const withQueue = town(await state(p), p.townId)
    expect(withQueue.landQueue.length).toBeGreaterThan(0)
    expect(withQueue.landQueueStartedAt).not.toBeNull()

    const aborted = await p.client.post('/actions/abortUnits', { townId: p.townId })
    expect(aborted.status, JSON.stringify(aborted.body)).toBe(200)

    const cleared = town(await state(p), p.townId)
    expect(cleared.landQueue).toHaveLength(0)
    expect(cleared.landQueueStartedAt).toBeNull()
  })

  it('fills the naval queue and empties it again', async () => {
    if (!up) return
    const p = await newPlayer('fleet')
    await stock(p.townId)
    await building(p.townId, 4, 4, 3) // shipyard, level 3

    const recruited = await p.client.post('/actions/fleet', {
      townId: p.townId,
      slot: 4,
      counts: { 16: 1 },
    })
    expect(recruited.status, JSON.stringify(recruited.body)).toBe(200)
    expect(town(await state(p), p.townId).navalQueue.length).toBeGreaterThan(0)

    const aborted = await p.client.post('/actions/abortShips', { townId: p.townId })
    expect(aborted.status, JSON.stringify(aborted.body)).toBe(200)
    expect(town(await state(p), p.townId).navalQueue).toHaveLength(0)
  })
})

describe('trade routes', () => {
  it('creates, edits and deletes a standing order', async () => {
    if (!up) return
    const p = await newPlayer('tr')
    await stock(p.townId)
    // A route between a town and itself is `select_city` (trade.ts:483).
    const other = await secondTown(p.userId, 'Ephesos')

    const created = await p.client.post('/actions/tradeRoute/create', {
      fromTownId: p.townId,
      toTownId: other,
      tradegood: 0,
      hour: 9,
      count: 100,
    })
    expect(created.status, JSON.stringify(created.body)).toBe(200)

    const afterCreate = await state(p)
    expect(afterCreate.state.tradeRoutes).toHaveLength(1)
    const route = afterCreate.state.tradeRoutes[0]
    expect(route.sendCount).toBe(100)

    // The endpoint the trade advisor could not reach before.
    const edited = await p.client.post('/actions/tradeRoute/edit', {
      routeId: route.id,
      fromTownId: p.townId,
      toTownId: other,
      tradegood: 0,
      hour: 9,
      count: 250,
    })
    expect(edited.status, JSON.stringify(edited.body)).toBe(200)

    const afterEdit = await state(p)
    expect(afterEdit.state.tradeRoutes).toHaveLength(1)
    expect(afterEdit.state.tradeRoutes[0].sendCount).toBe(250)
    expect(afterEdit.state.tradeRoutes[0].id).toBe(route.id)

    const deleted = await p.client.post('/actions/tradeRoute/delete', { deleteId: route.id })
    expect(deleted.status).toBe(200)
    expect((await state(p)).state.tradeRoutes).toHaveLength(0)
  })
})

describe('colonisation', () => {
  it('founding claims the slot, and aborting while loading frees it again', async () => {
    if (!up) return
    const p = await newPlayer('col')
    await stock(p.townId)
    // A palace (one colony allowed) and freighters to carry it.
    await building(p.townId, 1, 10, 1)
    await pool.query('update users set transports = 10, gold = 100000 where id = $1', [p.userId])

    // A free slot anywhere in the world -- the target island does not have to
    // be one the player already has a town on.
    const { rows: spots } = await pool.query(
      `select i.id as island, s.slot from islands i
       cross join unnest(array[0,2,4,6,8,10,12,14]) as s(slot)
       left join towns t on t.island_id = i.id and t.slot = s.slot
       where t.id is null order by random() limit 1`,
    )
    const spot = { island: Number(spots[0].island), slot: Number(spots[0].slot) }

    const founded = await p.client.post('/actions/colonize/found', {
      townId: p.townId,
      islandId: spot.island,
      slot: spot.slot,
      send: {},
      transports: 3,
    })
    expect(founded.status, JSON.stringify(founded.body)).toBe(200)

    // The slot shows as claimed while the fleet is loading.
    const board = await p.client.getJson(`/island/${spot.island}`)
    expect(board.status).toBe(200)
    const claimed = board.body.slots.find((s: any) => s.slot === spot.slot)
    expect(claimed?.town).toBeTruthy()

    const snapshot = await state(p)
    const mission = snapshot.state.missions.find((m: any) => m.kind === 'colonise')
    expect(mission).toBeTruthy()

    const aborted = await p.client.post('/actions/abortFleet', { missionId: mission.id })
    expect(aborted.status, JSON.stringify(aborted.body)).toBe(200)

    // The slot is free on the board again...
    const freed = await p.client.getJson(`/island/${spot.island}`)
    const slotAfter = freed.body.slots.find((s: any) => s.slot === spot.slot)
    expect(slotAfter?.town ?? null).toBeNull()
    // ...and no orphan town row was left behind in the table the board reads:
    // a level-0 row here would paint the founding placeholder forever.
    const { rows: orphans } = await pool.query(
      'select id from towns where user_id = $1 and island_id = $2 and slot = $3',
      [p.userId, spot.island, spot.slot],
    )
    expect(orphans).toHaveLength(0)
    // The fleet came home with everything it took.
    expect((await state(p)).state.missions).toHaveLength(0)
  })
})

describe('account', () => {
  it('renames the login and the new name is the one that logs in', async () => {
    if (!up) return
    const p = await newPlayer('rl')
    const next = uniqueLogin('rl2')

    const res = await p.client.post('/actions/renameLogin', { login: next })
    expect(res.status, JSON.stringify(res.body)).toBe(200)

    expect((await new Client().post('/auth/login', { login: next, password: PASSWORD })).status).toBe(200)
    expect(
      (await new Client().post('/auth/login', { login: p.login, password: PASSWORD })).status,
    ).toBe(401)
  })

  it('changes the password and refuses the old one afterwards', async () => {
    if (!up) return
    const p = await newPlayer('cp')
    const next = 'yenisifre123'

    const wrong = await p.client.post('/actions/changePassword', {
      oldPassword: 'nonsense123',
      newPassword: next,
      confirmPassword: next,
    })
    // Its own status: the route checks the hash itself (actions.ts:635).
    expect(wrong.status).toBe(403)
    expect(wrong.body.error).toBe('bad_credentials')

    const ok = await p.client.post('/actions/changePassword', {
      oldPassword: PASSWORD,
      newPassword: next,
      confirmPassword: next,
    })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)

    expect(
      (await new Client().post('/auth/login', { login: p.login, password: PASSWORD })).status,
    ).toBe(401)
    expect(
      (await new Client().post('/auth/login', { login: p.login, password: next })).status,
    ).toBe(200)
  })

  it('stores the town selector mode and the tutorial step', async () => {
    if (!up) return
    const p = await newPlayer('opt')

    expect((await p.client.post('/actions/setCitySelectMode', { mode: 2 })).status).toBe(200)
    expect((await state(p)).state.user.options.citySelect).toBe(2)

    expect((await p.client.post('/actions/skipTutorial')).status).toBe(200)
    const after = await state(p)
    expect(after.state.user.tutorialStep).toBeGreaterThan(0)
  })

  it('spends ambrosia on a premium boost', async () => {
    if (!up) return
    const p = await newPlayer('prem')
    const before = (await state(p)).state.user.ambrosia

    const res = await p.client.post('/actions/buyPremium', { type: 'wood' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)

    const after = await state(p)
    expect(after.state.user.ambrosia).toBeLessThan(before)
    expect(after.state.user.premium.wood).not.toBeNull()
  })

  it('promotes a second town to capital', async () => {
    if (!up) return
    const p = await newPlayer('cap')
    const colonyId = await secondTown(p.userId)
    // The rules want a palace standing in the current capital and a
    // governor's residence in the colony, both off slot 0 (colony.ts:562-564).
    await building(p.townId, 3, 10, 2) // PALACE
    await building(colonyId, 3, 15, 1) // PALACE_COLONY

    const res = await p.client.post('/actions/changeCapital', { townId: colonyId })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect((await state(p)).state.user.capitalTownId).toBe(colonyId)
  })
})

describe('mail', () => {
  it('sends, reads and deletes a message between two players', async () => {
    if (!up) return
    const sender = await newPlayer('from')
    const recipient = await newPlayer('to')

    const sent = await sender.client.post('/actions/sendUserMessage', {
      toUserId: recipient.userId,
      type: 1,
      text: 'ittifak kuralım',
    })
    expect(sent.status, JSON.stringify(sent.body)).toBe(200)

    const inbox = await recipient.client.getJson('/messages/inbox')
    expect(inbox.status).toBe(200)
    const message = inbox.body.messages.find((m: any) => m.text.includes('ittifak'))
    expect(message).toBeDefined()

    expect((await recipient.client.post('/actions/readUserMessage', { id: message.id })).status).toBe(200)
    expect(
      (await recipient.client.post('/actions/deleteUserMessages', { id: message.id })).status,
    ).toBe(200)

    const after = await recipient.client.getJson('/messages/inbox')
    expect(after.body.messages.some((m: any) => m.id === message.id)).toBe(false)
  })
})

/**
 * Ten simultaneous purchases of a ship the player can afford once.
 *
 * `advance()` takes `select … from users where id = $1 for update` so a
 * read-modify-write cannot interleave with another one: `loadPlayerState` reads
 * the graph with no lock of its own and `savePlayerState` writes it back with
 * blind full-row UPDATEs, which is the classic lost-update shape.
 *
 * Honesty about what this proves: it pins the *behaviour* -- one ship, one
 * charge -- and it would catch a rule that stopped checking the price. It does
 * not demonstrate the lock, because the window between the read and the write
 * is small enough that the interleaving does not reproduce on demand; removing
 * the lock leaves this test green. The lock is there for the case the timing
 * does line up.
 */
describe('concurrent actions cannot spend the same gold twice', () => {
  it('accepts exactly one of two simultaneous purchases', async () => {
    if (!up) return
    const player = await newPlayer('race')

    // The first ship on the ladder costs 480 and the second 897
    // (gamedata/curves.json, transport_cost_by_count), so this buys exactly
    // one. The write lands after the tick that /state just persisted.
    const state = await player.client.getJson('/state')
    const town = state.body.state.towns[0]
    await pool.query('update users set gold = 600 where id = $1', [player.userId])

    // Ten at once rather than two: the window between reading the gold and
    // writing it back is a few hundred microseconds, so two requests often miss
    // each other by luck. Ten do not.
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        player.client.post('/actions/transporter', { townId: town.id }),
      ),
    )

    const accepted = results.filter((r) => r.status === 200)
    expect(accepted).toHaveLength(1)
    for (const refused of results.filter((r) => r.status !== 200)) {
      expect(refused.body.error).toBe('not_enough_gold')
    }

    const { rows } = await pool.query('select gold, transports from users where id = $1', [
      player.userId,
    ])
    expect(Number(rows[0].transports)).toBe(1)
    // 600 - 480: one ship's worth gone, not two.
    expect(Number(rows[0].gold)).toBeLessThan(600)
    expect(Number(rows[0].gold)).toBeGreaterThanOrEqual(100)
  })
})

/**
 * Ambrosia for build time -- the one action with no legacy counterpart.
 *
 * The interesting claim is not that ambrosia leaves the account: it is that
 * nothing else had to change for the building to finish. The action only
 * rewinds `build_queue.started_at`; the *tick* on the next request is what
 * completes the level, credits the score and charges the queue's next entry.
 */
describe('ambrosia buys build time', () => {
  const PURSE = 500

  /** A player with one queued build and a full purse. */
  async function queued(prefix: string) {
    const p = await newPlayer(prefix)
    await stock(p.townId)
    await pool.query('update users set ambrosia = $2 where id = $1', [p.userId, PURSE])
    const res = await p.client.post('/actions/build', { townId: p.townId, slot: 1, type: 2 })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return p
  }

  /** Where the queue head stands, and the raw column behind it. */
  async function head(p: Player) {
    const snapshot = await state(p)
    const t = town(snapshot, p.townId)
    const { rows } = await pool.query(
      `select extract(epoch from started_at)::int as started
         from build_queue where town_id = $1 and position = 0`,
      [p.townId],
    )
    return {
      snapshot,
      town: t,
      started: rows.length > 0 ? Number(rows[0].started) : null,
      now: snapshot.now as number,
      /** Seconds still to run, by the same reading the action takes. */
      remaining: (constructionHead(snapshot.state, t)?.endsAt ?? snapshot.now) - snapshot.now,
    }
  }

  /**
   * Push the head's start so that exactly `remaining` seconds are left.
   *
   * The level's own duration is read back from the graph rather than hardcoded:
   * a port at level 1 is a few minutes, and a test that assumed a number would
   * quietly start testing the free-under-five-minutes path if the curve moved.
   */
  async function leave(p: Player, remaining: number) {
    const h = await head(p)
    const info = constructionHead(h.snapshot.state, h.town)!
    const duration = info.endsAt - info.startedAt
    await pool.query(
      `update build_queue set started_at = to_timestamp($2) where town_id = $1 and position = 0`,
      [p.townId, h.now - duration + remaining],
    )
  }

  it('completes the building on the next tick and charges no more than it quoted', async () => {
    if (!up) return
    const p = await queued('hurryall')
    await leave(p, 7200)

    const before = await head(p)
    const quote = hurryCost(before.remaining)
    expect(quote).toBeGreaterThan(0)

    const res = await p.client.post('/actions/hurryConstruction', {
      townId: p.townId,
      slot: 1,
      mode: 'all',
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)

    // The next read is the one that runs the tick, and the tick is what builds.
    const after = await state(p)
    const t = town(after, p.townId)
    expect(t.buildQueue).toHaveLength(0)
    expect(t.buildings.bySlot['1']).toMatchObject({ type: 2, level: 1 })

    const spent = PURSE - after.state.user.ambrosia
    expect(spent).toBeGreaterThan(0)
    expect(spent).toBeLessThanOrEqual(quote)
  })

  it('halving leaves the building unfinished with half the wait', async () => {
    if (!up) return
    const p = await queued('hurryhalf')
    await leave(p, 7200)

    const before = await head(p)
    const remaining = before.remaining

    const res = await p.client.post('/actions/hurryConstruction', {
      townId: p.townId,
      slot: 1,
      mode: 'half',
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)

    const after = await head(p)
    expect(after.town.buildQueue).toHaveLength(1)
    expect(after.remaining).toBeGreaterThan(0)
    expect(after.remaining).toBeLessThanOrEqual(Math.ceil(remaining / 2))

    const spent = PURSE - after.snapshot.state.user.ambrosia
    expect(spent).toBeGreaterThan(0)
    expect(spent).toBeLessThan(hurryCost(remaining))
  })

  it('changes nothing at all when the ambrosia is short', async () => {
    if (!up) return
    const p = await queued('hurrypoor')
    await leave(p, 7200)
    await pool.query('update users set ambrosia = 0 where id = $1', [p.userId])

    const before = await head(p)
    const res = await p.client.post('/actions/hurryConstruction', {
      townId: p.townId,
      slot: 1,
      mode: 'all',
    })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('not_enough_ambrosia')

    const after = await head(p)
    expect(after.started).toBe(before.started)
    expect(after.snapshot.state.user.ambrosia).toBe(0)
    expect(after.town.buildQueue).toHaveLength(1)
  })

  it('refuses a slot that is not the one being built', async () => {
    if (!up) return
    const p = await queued('hurryslot')

    const res = await p.client.post('/actions/hurryConstruction', {
      townId: p.townId,
      slot: 2,
      mode: 'all',
    })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('construction_other_slot')
  })

  it('refuses when the town is building nothing', async () => {
    if (!up) return
    const p = await newPlayer('hurrynone')

    const res = await p.client.post('/actions/hurryConstruction', {
      townId: p.townId,
      slot: 1,
      mode: 'all',
    })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('no_construction')
  })

  it('gives the last five minutes away', async () => {
    if (!up) return
    const p = await queued('hurryfree')
    await leave(p, 120)
    await pool.query('update users set ambrosia = 0 where id = $1', [p.userId])

    const res = await p.client.post('/actions/hurryConstruction', {
      townId: p.townId,
      slot: 1,
      mode: 'all',
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)

    const after = await state(p)
    expect(after.state.user.ambrosia).toBe(0)
    expect(town(after, p.townId).buildings.bySlot['1']).toMatchObject({ type: 2, level: 1 })
  })

  it('will not reach into somebody else another player is building', async () => {
    if (!up) return
    const mine = await queued('hurrymine')
    const other = await newPlayer('hurryother')

    const res = await other.client.post('/actions/hurryConstruction', {
      townId: mine.townId,
      slot: 1,
      mode: 'all',
    })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('unknown_town')
  })
})

/**
 * The temple, which the legacy builds and then forgets.
 *
 * `towns.templer` is a column the 2012 game writes from nowhere and reads
 * nowhere; the eight wonders are text with no way to call them. Everything
 * asserted here is therefore new behaviour, and the point of each test is that
 * the number reaches something the *server* recomputes -- happiness through
 * derive(), population through the tick -- rather than a field the client was
 * told to trust.
 */
describe('temple, priests and miracles', () => {
  /** A player whose town has a temple, with room to spare. */
  async function withTemple(prefix: string, level = 4) {
    const p = await newPlayer(prefix)
    await stock(p.townId)
    await building(p.townId, 3, 26, level)
    // A bigger town hall: priests come out of the citizens, and the starting
    // sixty do not stretch far.
    await building(p.townId, 0, 1, 8)
    await pool.query('update towns set peoples = 200 where id = $1', [p.townId])
    return p
  }

  async function islandOf(townId: number): Promise<number> {
    const { rows } = await pool.query('select island_id from towns where id = $1', [townId])
    return Number(rows[0].island_id)
  }

  it('assigns priests and pays two happiness for each', async () => {
    if (!up) return
    const p = await withTemple('priest')

    const before = await state(p)
    const happinessBefore = before.derived.towns[p.townId].happiness

    const res = await p.client.post('/actions/workers', {
      townId: p.townId,
      screen: 'temple',
      slot: 3,
      priests: 10,
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)

    const after = await state(p)
    const t = town(after, p.townId)
    expect(t.templer).toBe(10)
    expect(after.derived.towns[p.townId].happiness).toBeGreaterThan(happinessBefore)
    expect(after.derived.towns[p.townId].happinessBreakdown.priests).toBe(20)
    expect(after.derived.towns[p.townId].faith).toBeGreaterThan(0)

    const { rows } = await pool.query('select templer from towns where id = $1', [p.townId])
    expect(Number(rows[0].templer)).toBe(10)
  })

  it('refuses more priests than the temple houses, and changes nothing', async () => {
    if (!up) return
    const p = await withTemple('priestcap', 1)

    // A level 1 temple takes twelve.
    const res = await p.client.post('/actions/workers', {
      townId: p.townId,
      screen: 'temple',
      slot: 3,
      priests: 13,
    })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('priests_rejected')

    const { rows } = await pool.query('select templer from towns where id = $1', [p.townId])
    expect(Number(rows[0].templer)).toBe(0)
  })

  it('refuses priests in a town with no temple', async () => {
    if (!up) return
    const p = await newPlayer('notemple')
    await stock(p.townId)

    const res = await p.client.post('/actions/workers', {
      townId: p.townId,
      screen: 'temple',
      slot: 3,
      priests: 1,
    })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('priests_rejected')
  })

  it('reports island faith from every town there, not just this one', async () => {
    if (!up) return
    const p = await withTemple('faith')
    // A level 4 temple houses eighteen; asking for more is the next test.
    const assigned = await p.client.post('/actions/workers', {
      townId: p.townId,
      screen: 'temple',
      slot: 3,
      priests: 12,
    })
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200)

    const islandId = await islandOf(p.townId)
    const snapshot = await state(p)
    const faith = snapshot.chrome.faith[String(islandId)]
    expect(faith).toBeDefined()
    expect(faith.priests).toBeGreaterThanOrEqual(12)
    expect(faith.faith).toBeGreaterThan(0)
    expect(faith.faith).toBeLessThanOrEqual(1)
  })

  it('will not call a miracle the island does not believe in yet, and will once it does', async () => {
    if (!up) return
    const p = await withTemple('miracle')
    const islandId = await islandOf(p.townId)
    // Demeter, whose effect this port can actually deliver.
    await pool.query('update islands set wonder = 3 where id = $1', [islandId])

    const early = await p.client.post('/actions/activateMiracle', { islandId })
    expect(early.status).toBe(409)
    expect(early.body.error).toBe('faith_too_low')

    // Enough priests to convert a fifth of the island.
    const { rows } = await pool.query(
      `select coalesce(sum(coalesce((select level from town_buildings
                                      where town_id = t.id and slot = 0), 0)), 0) as levels,
              count(*)::int as towns
         from towns t where t.island_id = $1`,
      [islandId],
    )
    expect(Number(rows[0].towns)).toBeGreaterThan(0)
    await pool.query('update towns set templer = 400, peoples = 10 where id = $1', [p.townId])

    const called = await p.client.post('/actions/activateMiracle', { islandId })
    expect(called.status, JSON.stringify(called.body)).toBe(200)

    const stored = await pool.query(
      'select wonder, level from miracle_activations where user_id = $1 and island_id = $2',
      [p.userId, islandId],
    )
    expect(stored.rows).toHaveLength(1)
    expect(Number(stored.rows[0].wonder)).toBe(3)
    expect(Number(stored.rows[0].level)).toBeGreaterThanOrEqual(1)

    // The god does not answer twice in a row.
    const again = await p.client.post('/actions/activateMiracle', { islandId })
    expect(again.status).toBe(409)
    expect(again.body.error).toBe('miracle_cooling_down')
  })

  /**
   * A combat god is called like any other.
   *
   * It used to be refused with `miracle_needs_combat`, which spared the player
   * a cooldown spent on nothing but also meant an island under Ares, Hades,
   * Hephaistos or the Colossus had a temple that did nothing at all -- half
   * the islands in the world. The effect is a missing consumer, not a missing
   * rule: it lands the day this port has a fight.
   */
  it('calls a battle miracle and records it, effect or no effect', async () => {
    if (!up) return
    const p = await withTemple('ares')
    const islandId = await islandOf(p.townId)
    await pool.query('update islands set wonder = 6 where id = $1', [islandId])
    await pool.query('update towns set templer = 400, peoples = 10 where id = $1', [p.townId])

    const res = await p.client.post('/actions/activateMiracle', { islandId })
    expect(res.status, JSON.stringify(res.body)).toBe(200)

    const stored = await pool.query(
      'select wonder from miracle_activations where user_id = $1 and island_id = $2',
      [p.userId, islandId],
    )
    expect(Number(stored.rows[0].wonder)).toBe(6)
  })

  it('grows the population faster while Demeter is answering', async () => {
    if (!up) return
    const p = await withTemple('demeter')
    const islandId = await islandOf(p.townId)
    await pool.query('update islands set wonder = 3 where id = $1', [islandId])

    /** Citizens gained over an hour, measured by rewinding the town's clock. */
    async function growthOverAnHour(): Promise<number> {
      await pool.query(
        `update towns set peoples = 50, last_update = now() - interval '1 hour'
          where id = $1`,
        [p.townId],
      )
      const snapshot = await state(p)
      return town(snapshot, p.townId).peoples - 50
    }

    const plain = await growthOverAnHour()
    expect(plain).toBeGreaterThan(0)

    await pool.query('update towns set templer = 400, peoples = 10 where id = $1', [p.townId])
    expect((await p.client.post('/actions/activateMiracle', { islandId })).status).toBe(200)

    const blessed = await growthOverAnHour()
    // At least a citizen an hour more, whichever level the faith unlocked.
    expect(blessed).toBeGreaterThan(plain + 0.9)
  })
})

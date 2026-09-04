/**
 * The read endpoints every screen loads from.
 *
 * `GET /api/state` carries the whole player graph -- 68 of the legacy's 70
 * read screens rendered off the same Player_Model -- so most of this file is
 * about that one response having the shape the screens index into. The other
 * seven exist because they look at somebody else's rows or at an unbounded
 * table.
 */

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Client, cleanup, makePool, newPlayer, probe, type Player } from './harness.js'

let pool: pg.Pool
let up = false
let p: Player

beforeAll(async () => {
  pool = makePool()
  up = await probe(pool)
  if (up) p = await newPlayer('read')
})

afterAll(async () => {
  if (up) await cleanup(pool)
  await pool?.end()
})

describe('GET /state', () => {
  it('returns the whole graph a fresh player should have', async () => {
    if (!up) return
    const res = await p.client.getJson('/state')
    expect(res.status).toBe(200)

    const { now, state, derived, chrome } = res.body
    expect(now).toBeGreaterThan(1_700_000_000)

    expect(state.user.capitalTownId).toBe(p.townId)
    expect(state.towns).toHaveLength(1)

    const town = state.towns[0]
    expect(town.buildings.bySlot['0']).toEqual({ type: 1, level: 1 })
    expect(town.resources.wood).toBeGreaterThanOrEqual(500)
    expect(town.landQueue).toEqual([])
    expect(town.navalQueue).toEqual([])
    expect(state.islands[town.islandId]).toBeDefined()

    // The chrome reads these on every page.
    expect(derived.towns[town.id]).toBeDefined()
    expect(chrome.towns[String(town.id)]).toBeDefined()
    expect(typeof chrome.transports.free).toBe('number')
    expect(typeof chrome.notes).toBe('string')
  })
})

describe('GET /map', () => {
  it('returns the islands inside the requested window', async () => {
    if (!up) return
    // A pan is ~19x19 tiles; MAX_SPAN caps the window at 40 (map.ts:29).
    const res = await p.client.getJson('/map?xMin=0&xMax=40&yMin=0&yMax=40')
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(Array.isArray(res.body.islands)).toBe(true)
    expect(res.body.islands.length).toBeGreaterThan(0)
    for (const island of res.body.islands) {
      expect(island.x).toBeGreaterThanOrEqual(0)
      expect(island.x).toBeLessThanOrEqual(40)
    }
  })

  it('refuses a window wider than a pan', async () => {
    if (!up) return
    const res = await p.client.getJson('/map?xMin=0&xMax=500&yMin=0&yMax=500')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('area_too_large')
  })
})

describe('GET /island/:id', () => {
  it('returns 17 slots with the caller in one of them', async () => {
    if (!up) return
    const snapshot = await p.client.getJson('/state')
    const islandId = snapshot.body.state.towns[0].islandId

    const res = await p.client.getJson(`/island/${islandId}`)
    expect(res.status).toBe(200)
    expect(res.body.island.id).toBe(islandId)
    expect(res.body.slots).toHaveLength(17)
    expect(res.body.slots.some((s: any) => s.town?.id === p.townId)).toBe(true)
  })

  it('rejects a non-numeric id rather than querying with it', async () => {
    if (!up) return
    const res = await p.client.getJson('/island/not-a-number')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_island')
  })
})

describe('GET /highscore', () => {
  it('pages a ranked list', async () => {
    if (!up) return
    const res = await p.client.getJson('/highscore?category=total&page=0')
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.page).toBe(0)
    expect(Array.isArray(res.body.rows)).toBe(true)
    expect(res.body.total).toBeGreaterThan(0)
    for (const row of res.body.rows) {
      expect(typeof row.login).toBe('string')
      expect(typeof row.rank).toBe('number')
    }
  })

  it('refuses a category outside the nine', async () => {
    if (!up) return
    const res = await p.client.getJson('/highscore?category=charisma')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('unknown_category')
  })
})

describe('GET /messages/:box', () => {
  it('answers for both boxes and refuses a third', async () => {
    if (!up) return
    for (const box of ['inbox', 'outbox']) {
      const res = await p.client.getJson(`/messages/${box}`)
      expect(res.status, box).toBe(200)
      expect(Array.isArray(res.body.messages)).toBe(true)
    }
    const bad = await p.client.getJson('/messages/drafts')
    expect(bad.status).toBe(400)
  })
})

describe('GET /town/:id/branch-office', () => {
  it('describes the caller as a trading partner', async () => {
    if (!up) return
    const res = await p.client.getJson(`/town/${p.townId}/branch-office`)
    expect(res.status).toBe(200)
    expect(res.body.town.id).toBe(p.townId)
    expect(Array.isArray(res.body.offers)).toBe(true)
  })
})

describe('GET /spy-targets', () => {
  it('answers with a map, empty for a player with no spies', async () => {
    if (!up) return
    const res = await p.client.getJson('/spy-targets')
    expect(res.status).toBe(200)
    expect(res.body.targets).toEqual({})
  })
})

describe('/town-messages', () => {
  it('lists the advisor news and clears the lamp when marked read', async () => {
    if (!up) return
    const p = await newPlayer('news')

    // What the tick writes when a building finishes (tick.ts:344-350). Written
    // directly so the test does not have to wait out a build.
    await pool.query(
      `insert into town_messages (user_id, town_id, kind, params)
       values ($1, $2, 'building_completed', '{"slot":1,"type":2,"level":1}')`,
      [p.userId, p.townId],
    )

    const before = await p.client.getJson('/state')
    expect(before.body.chrome.newTownMessages).toBe(1)

    const list = await p.client.getJson('/town-messages')
    expect(list.status).toBe(200)
    expect(list.body.messages).toHaveLength(1)
    expect(list.body.messages[0]).toMatchObject({
      kind: 'building_completed',
      townId: p.townId,
      read: false,
    })
    expect(list.body.messages[0].params).toEqual({ slot: 1, type: 2, level: 1 })

    const marked = await p.client.post('/town-messages/read')
    expect(marked.status).toBe(200)
    expect(marked.body.marked).toBe(1)

    // The whole point: the advisor portrait goes out.
    const after = await p.client.getJson('/state')
    expect(after.body.chrome.newTownMessages).toBe(0)
    expect((await p.client.getJson('/town-messages')).body.messages[0].read).toBe(true)
  })

  it('guards the mark-read with CSRF', async () => {
    if (!up) return
    const p = await newPlayer('newscsrf')
    const res = await p.client.request('POST', '/town-messages/read', {}, { csrf: false })
    expect(res.status).toBe(403)
  })

  it('hides notices older than a week, as the legacy list query did', async () => {
    if (!up) return
    const p = await newPlayer('newsold')
    await pool.query(
      `insert into town_messages (user_id, town_id, kind, params, created_at)
       values ($1, $2, 'building_completed', '{}', now() - interval '8 days')`,
      [p.userId, p.townId],
    )
    expect((await p.client.getJson('/town-messages')).body.messages).toHaveLength(0)
    // The count keeps no window -- the legacy's own asymmetry.
    expect((await p.client.getJson('/state')).body.chrome.newTownMessages).toBe(1)
  })
})

describe('/notes', () => {
  it('round-trips the notepad', async () => {
    if (!up) return
    const empty = await p.client.getJson('/notes')
    expect(empty.status).toBe(200)
    expect(empty.body.text).toBe('')

    const written = await p.client.put('/notes', { text: 'mermer al, şarap sat' })
    expect(written.status).toBe(200)

    const back = await p.client.getJson('/notes')
    expect(back.body.text).toBe('mermer al, şarap sat')
  })

  it('refuses a note that is not a string or is too long', async () => {
    if (!up) return
    expect((await p.client.put('/notes', { text: 42 })).status).toBe(400)
    expect((await p.client.put('/notes', { text: 'x'.repeat(20_001) })).status).toBe(400)
  })
})

describe('guards', () => {
  it('needs a session for every read', async () => {
    if (!up) return
    const anon = new Client()
    for (const path of [
      '/state',
      '/map?xMin=0&xMax=1&yMin=0&yMax=1',
      '/island/1',
      '/messages/inbox',
      '/town-messages',
      '/highscore',
      `/town/${p.townId}/branch-office`,
      '/spy-targets',
      '/notes',
    ]) {
      const res = await anon.getJson(path)
      expect(res.status, path).toBe(401)
    }
  })

  it('leaves /health open', async () => {
    if (!up) return
    const res = await new Client().getJson('/health')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

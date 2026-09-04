/**
 * Donating to an island's monument.
 *
 * Nothing here is golden either -- the legacy has the mechanic in its help text
 * and nowhere else. What these pin is the shape the API depends on: a refused
 * donation must leave the town's stock alone and hand back no island to write,
 * and an accepted one must decide the new level from the counters it was
 * given, because those counters come from a locked row and are the only thing
 * standing between two donors and a monument that gains two levels for one
 * level's worth of goods.
 */

import { describe, expect, it } from 'vitest'

import { donateWonder } from '../src/actions/wonder.js'
import { derive } from '../src/derive.js'
import { WONDER_MAX_LEVEL, wonderUpgradeCost } from '../src/temple.js'
import { BUILDING, type WonderGood } from '../src/types.js'
import { TICK_FIXTURES, nowOf, stateFromFixture } from './fixture.js'

function ctx() {
  const scenario = Object.values(TICK_FIXTURES)[0]!
  const { state, subjectTownId } = stateFromFixture(scenario.before)
  const now = nowOf(scenario)
  const town = state.towns.find((t) => t.id === subjectTownId)!
  town.islandId = 1
  town.buildings.bySlot = {
    0: { type: BUILDING.TOWN_HALL, level: 4 },
    3: { type: BUILDING.TEMPLE, level: 4 },
  }
  town.resources = { wood: 0, wine: 50_000, marble: 50_000, crystal: 50_000, sulfur: 50_000 }
  town.wonderDonated = 0
  const derived = derive(state, now).towns[town.id]!
  return { ctx: { state, town, derived, now }, town, state, now }
}

/** A wine island, so it takes marble, crystal and sulfur. */
function island(overrides: Partial<Parameters<typeof donateWonder>[1]['island']> = {}) {
  return {
    wonder: 3,
    tradeResource: 1,
    wonderLevel: 1,
    donated: { wine: 0, marble: 0, crystal: 0, sulfur: 0 } as Record<WonderGood, number>,
    ...overrides,
  }
}

describe('donateWonder', () => {
  it('moves the goods out of the town and onto the monument', () => {
    const { ctx: c, town } = ctx()
    const before = town.resources.marble

    const result = donateWonder(c, { islandId: 1, good: 'marble', amount: 300, island: island() })

    expect(result.ok).toBe(true)
    expect(town.resources.marble).toBe(before - 300)
    expect(town.wonderDonated).toBe(300)
    expect(result.island!.donated.marble).toBe(300)
    expect(result.island!.wonderLevel).toBe(1)
    expect(result.levelsGained).toBe(0)
  })

  it('refuses the good the island produces itself', () => {
    const { ctx: c, town } = ctx()
    const before = town.resources.wine

    const result = donateWonder(c, { islandId: 1, good: 'wine', amount: 100, island: island() })

    expect(result).toMatchObject({ ok: false, reason: 'wonder_wrong_good' })
    expect(result.island).toBeUndefined()
    expect(town.resources.wine).toBe(before)
  })

  it('refuses an island with no monument, and a finished one', () => {
    const { ctx: c } = ctx()
    expect(
      donateWonder(c, { islandId: 1, good: 'marble', amount: 100, island: island({ wonder: 0 }) }),
    ).toMatchObject({ ok: false, reason: 'wonder_no_wonder' })
    expect(
      donateWonder(c, {
        islandId: 1,
        good: 'marble',
        amount: 100,
        island: island({ wonderLevel: WONDER_MAX_LEVEL }),
      }),
    ).toMatchObject({ ok: false, reason: 'wonder_max_level' })
  })

  it('refuses another island, a non-positive amount and more than the town holds', () => {
    const { ctx: c, town } = ctx()
    const before = town.resources.marble

    for (const bad of [
      { islandId: 2, good: 'marble' as const, amount: 100, island: island() },
      { islandId: 1, good: 'marble' as const, amount: 0, island: island() },
      { islandId: 1, good: 'marble' as const, amount: -50, island: island() },
      { islandId: 1, good: 'marble' as const, amount: before + 1, island: island() },
    ]) {
      expect(donateWonder(c, bad)).toMatchObject({ ok: false, reason: 'donation_rejected' })
    }
    expect(town.resources.marble).toBe(before)
  })

  it('expands the monument only when the last of the three goods lands', () => {
    const { ctx: c } = ctx()
    const cost = wonderUpgradeCost(1)!

    const twoPaid = island({ donated: { wine: 0, marble: cost, crystal: cost, sulfur: 0 } })
    const partial = donateWonder(c, {
      islandId: 1,
      good: 'sulfur',
      amount: cost - 1,
      island: twoPaid,
    })
    expect(partial.island!.wonderLevel).toBe(1)

    const last = donateWonder(c, {
      islandId: 1,
      good: 'sulfur',
      amount: cost,
      island: twoPaid,
    })
    expect(last.island!.wonderLevel).toBe(2)
    expect(last.levelsGained).toBe(1)
    // The cost comes off all three, not just the one that was given.
    expect(last.island!.donated).toMatchObject({ marble: 0, crystal: 0, sulfur: 0 })
  })

  it('carries the surplus into the next level', () => {
    const { ctx: c } = ctx()
    const cost = wonderUpgradeCost(1)!
    const twoPaid = island({ donated: { wine: 0, marble: cost, crystal: cost, sulfur: 0 } })

    const result = donateWonder(c, {
      islandId: 1,
      good: 'sulfur',
      amount: cost + 40,
      island: twoPaid,
    })
    expect(result.island!.wonderLevel).toBe(2)
    expect(result.island!.donated.sulfur).toBe(40)
  })

  it('does not buy two levels with one good, however much of it arrives', () => {
    const { ctx: c } = ctx()
    const first = wonderUpgradeCost(1)!
    const second = wonderUpgradeCost(2)!
    const twoPaid = island({ donated: { wine: 0, marble: first, crystal: first, sulfur: 0 } })

    const result = donateWonder(c, {
      islandId: 1,
      good: 'sulfur',
      amount: first + second,
      island: twoPaid,
    })
    // The other two goods only ever covered the first level.
    expect(result.island!.wonderLevel).toBe(2)
    expect(result.island!.donated.sulfur).toBe(second)
  })

  it('says so in a town message when the monument grows, and stays quiet otherwise', () => {
    const { ctx: c, state } = ctx()
    const cost = wonderUpgradeCost(1)!

    const quiet = donateWonder(c, { islandId: 1, good: 'marble', amount: 10, island: island() })
    expect(quiet.ok && quiet.messages).toEqual([])

    const loud = donateWonder(c, {
      islandId: 1,
      good: 'sulfur',
      amount: cost,
      island: island({ donated: { wine: 0, marble: cost, crystal: cost, sulfur: 0 } }),
    })
    expect(loud.ok && loud.messages).toMatchObject([
      { channel: 'town', userId: state.user.id, kind: 'island_wonder_upgraded' },
    ])
  })
})

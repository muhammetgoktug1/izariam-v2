/**
 * The ambrosia-for-build-time curve, and the action that spends it.
 *
 * Not a golden test -- there is nothing in the legacy to be golden against.
 * The curve is live Ikariam's (ikariam.fandom.com/wiki/Shorten_Building_Time)
 * and these are its named points, plus the one property the two screens depend
 * on: a price that never rises as the clock runs down.
 */

import { describe, expect, it } from 'vitest'

import { hurryConstruction } from '../src/actions/building.js'
import { derive } from '../src/derive.js'
import {
  HURRY_CAP,
  HURRY_FREE_SECONDS,
  constructionHead,
  hurryCost,
} from '../src/hurry.js'
import { TICK_FIXTURES, nowOf, stateFromFixture } from './fixture.js'

describe('hurryCost', () => {
  it('is free for the last five minutes', () => {
    expect(hurryCost(0)).toBe(0)
    expect(hurryCost(1)).toBe(0)
    expect(hurryCost(HURRY_FREE_SECONDS)).toBe(0)
  })

  it('charges four per half hour on top of a flat four', () => {
    expect(hurryCost(301)).toBe(5)
    expect(hurryCost(1800)).toBe(8)
    expect(hurryCost(3600)).toBe(12)
    expect(hurryCost(7200)).toBe(20)
    expect(hurryCost(21600)).toBe(52)
  })

  it('meets its cap at eighteen hours and never passes it', () => {
    expect(hurryCost(64_799)).toBe(HURRY_CAP)
    expect(hurryCost(64_800)).toBe(HURRY_CAP)
    expect(hurryCost(1_000_000)).toBe(HURRY_CAP)
  })

  it('never falls as the remaining time grows', () => {
    let previous = 0
    for (let s = 0; s <= 70_000; s += 137) {
      const cost = hurryCost(s)
      expect(cost).toBeGreaterThanOrEqual(previous)
      previous = cost
    }
  })

  it('prices half a wait below the whole wait', () => {
    const remaining = 7200
    expect(hurryCost(Math.floor(remaining / 2))).toBeLessThan(hurryCost(remaining))
  })
})

/** A town with one queued upgrade, an hour from done, and money to burn. */
function building(remaining: number) {
  const scenario = Object.values(TICK_FIXTURES)[0]!
  const { state, subjectTownId } = stateFromFixture(scenario.before)
  const now = nowOf(scenario)
  const town = state.towns.find((t) => t.id === subjectTownId)!

  town.buildings.bySlot = { 0: { type: 1, level: 1 }, 3: { type: 5, level: 1 } }
  town.buildQueue = [{ slot: 3, type: 5 }]
  town.buildStartedAt = now
  const head = constructionHead(state, town)!
  // Wind the start back so exactly `remaining` seconds are left.
  town.buildStartedAt = now - (head.endsAt - now - remaining)

  state.user.ambrosia = 1000
  const ctx = { state, town, derived: derive(state, now).towns[town.id]!, now }
  return { state, town, ctx, now }
}

describe('hurryConstruction', () => {
  it('finishing takes the price and puts the clock on now', () => {
    const { state, town, ctx, now } = building(7200)

    expect(hurryConstruction(ctx, 3, 'all').ok).toBe(true)
    expect(state.user.ambrosia).toBe(1000 - hurryCost(7200))
    expect(constructionHead(state, town)!.endsAt).toBe(now)
  })

  it('halving removes half the wait and costs less than finishing', () => {
    const { state, town, ctx, now } = building(7200)

    expect(hurryConstruction(ctx, 3, 'half').ok).toBe(true)
    expect(state.user.ambrosia).toBe(1000 - hurryCost(3600))
    expect(constructionHead(state, town)!.endsAt - now).toBe(3600)
  })

  it('refuses a slot that is not at the head of the queue', () => {
    const { state, ctx } = building(7200)

    const result = hurryConstruction(ctx, 4, 'all')
    expect(result).toMatchObject({ ok: false, reason: 'construction_other_slot' })
    expect(state.user.ambrosia).toBe(1000)
  })

  it('refuses when nothing is being built', () => {
    const { state, town, ctx } = building(7200)
    town.buildQueue = []
    town.buildStartedAt = null

    expect(hurryConstruction(ctx, 3, 'all')).toMatchObject({
      ok: false,
      reason: 'no_construction',
    })
    expect(state.user.ambrosia).toBe(1000)
  })

  it('refuses -- and charges nothing -- when the ambrosia is short by one', () => {
    const { state, town, ctx } = building(7200)
    state.user.ambrosia = hurryCost(7200) - 1
    const startedAt = town.buildStartedAt

    expect(hurryConstruction(ctx, 3, 'all')).toMatchObject({
      ok: false,
      reason: 'not_enough_ambrosia',
    })
    expect(state.user.ambrosia).toBe(hurryCost(7200) - 1)
    expect(town.buildStartedAt).toBe(startedAt)
  })

  it('finishes the last five minutes for nothing', () => {
    const { state, town, ctx, now } = building(120)
    state.user.ambrosia = 0

    expect(hurryConstruction(ctx, 3, 'all').ok).toBe(true)
    expect(state.user.ambrosia).toBe(0)
    expect(constructionHead(state, town)!.endsAt).toBe(now)
  })
})

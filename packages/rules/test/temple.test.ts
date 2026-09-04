/**
 * Priests, faith, and calling a miracle.
 *
 * None of this is golden: the legacy stores `templer` and reads it nowhere, and
 * its eight wonders exist as text. What *is* pinned against the legacy is
 * everything these numbers must not disturb -- see the golden suites, which
 * pass unchanged because every fixture has zero priests.
 */

import { describe, expect, it } from 'vitest'

import { activateMiracle } from '../src/actions/miracle.js'
import { derive } from '../src/derive.js'
import { missionTiming } from '../src/missions.js'
import {
  COOLDOWN_FLOOR,
  HAPPINESS_PER_PRIEST,
  MIRACLES,
  WONDER_MAX_LEVEL,
  cooldownFor,
  effectiveMiracleLevel,
  miracleBonus,
  miracleLevelForFaith,
  priestsByLevel,
  townFaith,
  wonderGoods,
  wonderUpgradeCost,
} from '../src/temple.js'
import { BUILDING } from '../src/types.js'
import { TICK_FIXTURES, nowOf, stateFromFixture } from './fixture.js'

describe('priestsByLevel', () => {
  it('is the table Ikariam publishes, not a curve through its ends', () => {
    // The geometric fit this replaced hit 12 and 1411 and missed everything
    // between -- level 2 came out at 14 against a published 22, level 10 at 33
    // against 195.
    expect(priestsByLevel(1)).toBe(12)
    expect(priestsByLevel(2)).toBe(22)
    expect(priestsByLevel(5)).toBe(73)
    expect(priestsByLevel(10)).toBe(195)
    expect(priestsByLevel(20)).toBe(542)
    expect(priestsByLevel(38)).toBe(1411)
    expect(priestsByLevel(50)).toBe(2127)
  })

  it('holds at the last published level rather than falling off it', () => {
    expect(priestsByLevel(51)).toBe(priestsByLevel(50))
  })

  it('is nothing without a temple, and never goes backwards', () => {
    expect(priestsByLevel(0)).toBe(0)
    let previous = 0
    for (let level = 1; level <= 50; level++) {
      const priests = priestsByLevel(level)
      expect(priests).toBeGreaterThanOrEqual(previous)
      previous = priests
    }
  })
})

describe('townFaith', () => {
  it('converts five citizens per priest', () => {
    expect(townFaith(0, 100)).toBe(0)
    expect(townFaith(10, 100)).toBeCloseTo(0.5)
    expect(townFaith(20, 100)).toBe(1)
  })

  it('stops at total belief rather than passing it', () => {
    expect(townFaith(500, 100)).toBe(1)
  })

  it('is zero for a town that can hold nobody', () => {
    expect(townFaith(10, 0)).toBe(0)
  })
})

describe('miracleLevelForFaith', () => {
  it('opens a level every twenty per cent, and the fifth at total belief', () => {
    expect(miracleLevelForFaith(0.199)).toBe(0)
    expect(miracleLevelForFaith(0.2)).toBe(1)
    expect(miracleLevelForFaith(0.4)).toBe(2)
    expect(miracleLevelForFaith(0.6)).toBe(3)
    expect(miracleLevelForFaith(0.8)).toBe(4)
    expect(miracleLevelForFaith(0.99)).toBe(4)
    expect(miracleLevelForFaith(1)).toBe(5)
  })
})

describe('effectiveMiracleLevel', () => {
  it('is the smaller of what is believed and what the monument carries', () => {
    // Total belief under a monument nobody has raised.
    expect(effectiveMiracleLevel(1, 1)).toBe(1)
    // A finished monument on an island that barely believes.
    expect(effectiveMiracleLevel(5, 0.2)).toBe(1)
    expect(effectiveMiracleLevel(3, 1)).toBe(3)
    expect(effectiveMiracleLevel(5, 1)).toBe(5)
  })

  it('is nothing below the first threshold, whatever the monument', () => {
    expect(effectiveMiracleLevel(5, 0.19)).toBe(0)
  })

  it('never reads past the five levels that exist', () => {
    expect(effectiveMiracleLevel(9, 1)).toBe(5)
    expect(effectiveMiracleLevel(-1, 1)).toBe(0)
  })
})

describe('wonderGoods', () => {
  it('accepts every luxury but the one the island digs up', () => {
    expect(wonderGoods(1)).toEqual(['marble', 'crystal', 'sulfur'])
    expect(wonderGoods(2)).toEqual(['wine', 'crystal', 'sulfur'])
    expect(wonderGoods(3)).toEqual(['wine', 'marble', 'sulfur'])
    expect(wonderGoods(4)).toEqual(['wine', 'marble', 'crystal'])
  })

  it('still answers with three for a trade resource no island has', () => {
    expect(wonderGoods(0)).toHaveLength(3)
  })
})

describe('wonderUpgradeCost', () => {
  it('rises with every level and stops at the fifth', () => {
    let previous = 0
    for (let level = 1; level < WONDER_MAX_LEVEL; level++) {
      const cost = wonderUpgradeCost(level)!
      expect(cost).toBeGreaterThan(previous)
      previous = cost
    }
    expect(wonderUpgradeCost(WONDER_MAX_LEVEL)).toBeNull()
  })
})

describe('cooldownFor', () => {
  it('takes a tenth off for each further temple on the same god', () => {
    const spec = MIRACLES[3]!
    expect(cooldownFor(spec, 1)).toBe(spec.cooldown)
    expect(cooldownFor(spec, 2)).toBe(Math.round(spec.cooldown * 0.9))
    expect(cooldownFor(spec, 3)).toBe(Math.round(spec.cooldown * 0.8))
  })

  it('never halves more than once, however many temples there are', () => {
    const spec = MIRACLES[3]!
    expect(cooldownFor(spec, 20)).toBe(Math.round(spec.cooldown * COOLDOWN_FLOOR))
  })
})

function player() {
  const scenario = Object.values(TICK_FIXTURES)[0]!
  const { state, subjectTownId } = stateFromFixture(scenario.before)
  const now = nowOf(scenario)
  const town = state.towns.find((t) => t.id === subjectTownId)!
  town.buildings.bySlot = {
    0: { type: BUILDING.TOWN_HALL ?? 1, level: 4 },
    3: { type: BUILDING.TEMPLE, level: 4 },
  }
  return { state, town, now }
}

describe('miracleBonus', () => {
  it('is zero with nothing called', () => {
    const { state, now } = player()
    expect(miracleBonus(state, 'population', now)).toBe(0)
  })

  it('reads the level that was called', () => {
    const { state, now } = player()
    state.user.miracles = [{ islandId: 1, wonder: 3, level: 2, activatedAt: now }]
    // Demeter, level 2: twelve citizens an hour.
    expect(miracleBonus(state, 'population', now)).toBe(12)
  })

  it('stops the moment the duration runs out', () => {
    const { state, now } = player()
    const spec = MIRACLES[3]!
    state.user.miracles = [
      { islandId: 1, wonder: 3, level: 5, activatedAt: now - spec.duration },
    ]
    expect(miracleBonus(state, 'population', now)).toBe(0)
    expect(miracleBonus(state, 'population', now - 1)).toBe(36)
  })

  it('takes the stronger of two rather than their sum', () => {
    const { state, now } = player()
    state.user.miracles = [
      { islandId: 1, wonder: 7, level: 1, activatedAt: now },
      { islandId: 2, wonder: 7, level: 4, activatedAt: now },
    ]
    // 0.1 and 0.7, not 0.8.
    expect(miracleBonus(state, 'travel', now)).toBeCloseTo(0.7)
  })

  it('never reports a combat miracle, whatever is stored', () => {
    const { state, now } = player()
    state.user.miracles = [{ islandId: 1, wonder: 6, level: 5, activatedAt: now }]
    expect(miracleBonus(state, 'combat', now)).toBe(0)
  })
})

describe('priests and happiness', () => {
  it('pay two each, and are counted as citizens while they do', () => {
    const { state, town, now } = player()
    const before = derive(state, now).towns[town.id]!

    // Ten citizens become priests: the same people, a different job.
    town.peoples -= 10
    town.templer += 10
    const after = derive(state, now).towns[town.id]!

    expect(after.happinessBreakdown.priests).toBe(HAPPINESS_PER_PRIEST * 10)
    expect(after.totalPeoples).toBeCloseTo(before.totalPeoples)
    // The bonus lands, and the population penalty does not move -- which is the
    // whole reason `templer` had to join the total.
    expect(after.happiness).toBeCloseTo(before.happiness + HAPPINESS_PER_PRIEST * 10)
  })

  it('reports the temple ceiling and how much of the town believes', () => {
    const { state, town, now } = player()
    town.templer = 12
    const d = derive(state, now).towns[town.id]!
    expect(d.priestLimit).toBe(priestsByLevel(4))
    expect(d.faith).toBeCloseTo(townFaith(12, d.maxPeoples))
  })
})

describe('activateMiracle', () => {
  const island = () => {
    const { state, town, now } = player()
    town.islandId = 1
    state.islands[1] = {
      id: 1,
      name: 'test',
      x: 1,
      y: 1,
      type: 1,
      tradeResource: 1,
      wonder: 3,
      woodLevel: 1,
      tradeLevel: 1,
      woodDonated: 0,
      tradeDonated: 0,
      woodUpgradeStartedAt: null,
      tradeUpgradeStartedAt: null,
      wonderLevel: 5,
      wonderDonated: { wine: 0, marble: 0, crystal: 0, sulfur: 0 },
    }
    return { state, town, now }
  }

  it('records the level the faith unlocked', () => {
    const { state, now } = island()
    const result = activateMiracle(
      { state, now },
      { islandId: 1, wonder: 3, faith: 0.45, wonderLevel: 5 },
    )
    expect(result.ok).toBe(true)
    expect(state.user.miracles).toEqual([
      { islandId: 1, wonder: 3, level: 2, activatedAt: now },
    ])
  })

  it('records the monument level when that is the smaller of the two', () => {
    const { state, now } = island()
    activateMiracle({ state, now }, { islandId: 1, wonder: 3, faith: 1, wonderLevel: 2 })
    expect(state.user.miracles[0]!.level).toBe(2)
  })

  it('refuses an island with no wonder', () => {
    const { state, now } = island()
    expect(
      activateMiracle({ state, now }, { islandId: 1, wonder: 0, faith: 1, wonderLevel: 5 }),
    ).toMatchObject({
      ok: false,
      reason: 'no_wonder',
    })
  })

  it('refuses when no town of yours on that island has a temple', () => {
    const { state, town, now } = island()
    town.buildings.bySlot = { 0: { type: 1, level: 4 } }
    expect(
      activateMiracle({ state, now }, { islandId: 1, wonder: 3, faith: 1, wonderLevel: 5 }),
    ).toMatchObject({
      ok: false,
      reason: 'no_temple_on_island',
    })
  })

  it('calls a combat god like any other, and leaves the effect to a fight', () => {
    const { state, now } = island()
    state.islands[1]!.wonder = 6
    expect(
      activateMiracle({ state, now }, { islandId: 1, wonder: 6, faith: 1, wonderLevel: 5 }).ok,
    ).toBe(true)
    expect(state.user.miracles).toEqual([
      { islandId: 1, wonder: 6, level: 5, activatedAt: now },
    ])
    // Nothing reads it yet, which is a missing consumer rather than a refusal.
    expect(miracleBonus(state, 'combat', now)).toBe(0)
  })

  it('refuses below the first threshold', () => {
    const { state, now } = island()
    expect(
      activateMiracle({ state, now }, { islandId: 1, wonder: 3, faith: 0.19, wonderLevel: 5 }),
    ).toMatchObject({ ok: false, reason: 'faith_too_low' })
  })

  it('refuses while the god is still resting, and allows it afterwards', () => {
    const { state, now } = island()
    const spec = MIRACLES[3]!
    state.user.miracles = [{ islandId: 1, wonder: 3, level: 1, activatedAt: now - 1 }]

    expect(
      activateMiracle({ state, now }, { islandId: 1, wonder: 3, faith: 1, wonderLevel: 5 }),
    ).toMatchObject({
      ok: false,
      reason: 'miracle_cooling_down',
    })

    const later = now + spec.cooldown
    expect(
      activateMiracle(
        { state, now: later },
        { islandId: 1, wonder: 3, faith: 1, wonderLevel: 5 },
      ).ok,
    ).toBe(true)
    expect(state.user.miracles).toHaveLength(1)
  })

  it('lets a second temple on the same god call it back sooner', () => {
    const { state, town, now } = island()
    const spec = MIRACLES[3]!

    // A second town, on a second island, under the same god.
    state.islands[2] = { ...state.islands[1]!, id: 2 }
    state.towns.push({
      ...town,
      id: town.id + 1000,
      islandId: 2,
      buildings: { bySlot: { 3: { type: BUILDING.TEMPLE, level: 4 } } },
    })

    state.user.miracles = [{ islandId: 1, wonder: 3, level: 1, activatedAt: now }]
    const shortened = now + Math.round(spec.cooldown * 0.9)

    expect(
      activateMiracle(
        { state, now: shortened },
        { islandId: 1, wonder: 3, faith: 1, wonderLevel: 5 },
      ).ok,
    ).toBe(true)
  })
})

/**
 * The two lines a miracle reaches inside the mission engine.
 *
 * `missionTiming` is where Poseidon and Hermes land -- one divides the sail,
 * the other the quay -- and it is the only function in the port with those two
 * numbers in it, so testing it directly is testing the effect.
 */
describe('Poseidon and Hermes reach the mission clock', () => {
  const islands = {
    1: {
      id: 1,
      name: 'a',
      x: 10,
      y: 10,
      type: 1,
      tradeResource: 1,
      wonder: 7,
      woodLevel: 1,
      tradeLevel: 1,
      woodDonated: 0,
      tradeDonated: 0,
      woodUpgradeStartedAt: null,
      tradeUpgradeStartedAt: null,
      wonderLevel: 5,
      wonderDonated: { wine: 0, marble: 0, crystal: 0, sulfur: 0 },
    },
    2: {
      id: 2,
      name: 'b',
      x: 40,
      y: 40,
      type: 1,
      tradeResource: 1,
      wonder: 5,
      woodLevel: 1,
      tradeLevel: 1,
      woodDonated: 0,
      tradeDonated: 0,
      woodUpgradeStartedAt: null,
      tradeUpgradeStartedAt: null,
      wonderLevel: 5,
      wonderDonated: { wine: 0, marble: 0, crystal: 0, sulfur: 0 },
    },
  }

  const cargo = { wood: 500, wine: 0, marble: 0, crystal: 0, sulfur: 0, gold: 0, peoples: 0 }

  const townAt = (id: number, islandId: number) => ({
    id,
    userId: 1,
    islandId,
    slot: 1,
    lastUpdate: 0,
    peoples: 0,
    resources: { wood: 0, wine: 0, marble: 0, crystal: 0, sulfur: 0 },
    // A port, so loading takes a measurable amount of time.
    buildings: { bySlot: { 1: { type: 2, level: 5 } } },
  })

  const mission = {
    id: 1,
    userId: 1,
    fromTownId: 1,
    toTownId: 2,
    kind: 'transport' as const,
    loadingFromStartedAt: 0,
    loadingToStartedAt: null,
    departedAt: 100,
    returnStartedAt: null,
    arrivesAt: null,
    abortPercent: 0,
    transports: 1,
    cargo,
    units: {},
    tradeTerms: {},
  }

  const research = { levels: {}, points: 0, branchSeen: {} }

  function timing(boosts?: { travel: number; loading: number }) {
    return missionTiming(
      mission,
      townAt(1, 1),
      townAt(2, 2),
      islands,
      research,
      {},
      1000,
      boosts,
    )!
  }

  it('halves nothing without a miracle', () => {
    const plain = timing()
    expect(plain.travelTime).toBeGreaterThan(0)
    expect(plain.loadingTime).toBeGreaterThan(0)
  })

  it('sails faster under Poseidon and loads faster under Hermes', () => {
    const plain = timing()
    const blessed = timing({ travel: 1, loading: 1 })

    expect(blessed.travelTime).toBeCloseTo(plain.travelTime / 2)
    expect(blessed.loadingTime).toBeCloseTo(plain.loadingTime / 2)
  })
})

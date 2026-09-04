/**
 * Golden test: every cost value the legacy PHP produced must come back
 * identical from the TypeScript port.
 *
 * fixtures/lookups.json was dumped from the running CodeIgniter app
 * (izariam/controllers/dump.php) and holds 16,149 values covering 18
 * buildings x 51 levels, 23 units, 59 research nodes, both island node
 * tables, every single-argument curve, and each discount path exercised on
 * its own. If this file goes red, the port changed the economy.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  actionPointsByLevel,
  branchCapacityByLevel,
  branchRadiusByLevel,
  buildingCost,
  islandNodeCost,
  peoplesByLevel,
  premiumCost,
  researchInfo,
  scientistsByLevel,
  speedByPortLevel,
  spyGoldByMission,
  spyRiskByMission,
  spyTimeByCoords,
  spyTimeByLevel,
  timeByCoords,
  transportCostByCount,
  unitCost,
  wallDataByLevel,
  wineByTavernLevel,
} from '../src/costs.js'
import type { LevelsByType } from '../src/costs.js'
import type { ResearchState } from '../src/types.js'

const here = dirname(fileURLToPath(import.meta.url))
const FIX = JSON.parse(
  readFileSync(resolve(here, '../../../fixtures/lookups.json'), 'utf8'),
) as Record<string, any>

const EPS = 1e-6

function research(set: Record<string, number> = {}): ResearchState {
  const levels: Record<string, number> = {}
  for (const [way, count] of [
    [1, 14],
    [2, 15],
    [3, 16],
    [4, 14],
  ] as const) {
    for (let i = 1; i <= count; i++) levels[`${way}_${i}`] = 0
  }
  for (const [k, v] of Object.entries(set)) {
    // "res2_11" -> "2_11"
    levels[k.replace(/^res/, '')] = v
  }
  return { levels, points: 0, branchSeen: {} }
}

function levels(set: Record<number, number> = {}): LevelsByType {
  const l: LevelsByType = {}
  for (let i = 0; i <= 30; i++) l[i] = 0
  for (const [k, v] of Object.entries(set)) l[Number(k)] = v
  return l
}

const ZR = research()
const ZL = levels()

/** Compare every key the fixture recorded; extra keys on our side are fine. */
function expectMatches(label: string, got: object, exp: Record<string, unknown>) {
  const bag = got as Record<string, unknown>
  for (const [k, want] of Object.entries(exp)) {
    const have = bag[k]
    if (want === null) {
      // PHP returned null (a switch with no matching case). Our curves
      // normalise that to 0; both mean "no value defined here".
      expect(have === null || have === 0, `${label}.${k}: expected null-ish, got ${have}`).toBe(
        true,
      )
      continue
    }
    expect(
      Math.abs(Number(have) - Number(want)) <= EPS,
      `${label}.${k}: got ${have}, expected ${want}`,
    ).toBe(true)
  }
}

/**
 * The temple. `building_cost()` has no `case 26`, so the fixture records it as
 * free with max_level 0 -- the port gives it live Ikariam's table instead
 * (config.ts DELIBERATE_DIVERGENCES, entry 5), which is the only building
 * whose cost deliberately leaves the legacy behind.
 */
const TEMPLE = '26'

describe('buildingCost', () => {
  it('reproduces the base cost table for every building and level', () => {
    let n = 0
    for (const [bid, byLevel] of Object.entries(FIX.building_cost)) {
      if (bid === TEMPLE) continue
      for (const [level, exp] of Object.entries(byLevel as Record<string, any>)) {
        expectMatches(
          `building_cost[${bid}][${level}]`,
          buildingCost(Number(bid), Number(level), ZR, ZL),
          exp,
        )
        n++
      }
    }
    expect(n).toBe(30 * 51)
  })

  it('gives the temple the cost the legacy left out', () => {
    const one = buildingCost(26, 1, ZR, ZL)
    expect(one.wood).toBe(121)
    expect(one.marble).toBe(118)
    expect(one.time).toBe(735)
    expect(one.max_level).toBe(50)

    // The fixture says otherwise, on purpose.
    expect((FIX.building_cost as any)['26']['1'].wood).toBeFalsy()
  })

  it('reproduces every research and carpentry discount path', () => {
    const cases: Record<string, [Record<string, number>, Record<number, number>]> = {
      res2_2: [{ res2_2: 1 }, {}],
      res2_11: [{ res2_11: 1 }, {}],
      carpentry_7: [{}, { 21: 7 }],
      all: [{ res2_2: 1, res2_11: 1 }, { 21: 12 }],
    }
    for (const [name, [rset, lset]] of Object.entries(cases)) {
      const r = research(rset)
      const l = levels(lset)
      for (const [key, exp] of Object.entries(FIX.building_cost_discounts[name])) {
        const [bid, level] = key.split('@')
        expectMatches(
          `bc_disc[${name}][${key}]`,
          buildingCost(Number(bid), Number(level), r, l),
          exp as Record<string, unknown>,
        )
      }
    }
  })
})

describe('unitCost', () => {
  it('reproduces the raw unit table', () => {
    for (const [uid, exp] of Object.entries(FIX.army_cost_base)) {
      expectMatches(
        `army_cost_base[${uid}]`,
        unitCost(Number(uid), ZR, ZL, false),
        exp as Record<string, unknown>,
      )
    }
  })

  it('reproduces gold discounts and build-time reductions', () => {
    const cases: Record<string, [Record<string, number>, Record<number, number>]> = {
      ship_research: [{ res1_3: 1, res1_6: 1, res1_11: 1, res1_14: 3 }, {}],
      troop_research: [{ res4_2: 1, res4_5: 1, res4_10: 1, res4_14: 2 }, {}],
      barracks_20: [{}, { 5: 20 }],
      shipyard_20: [{}, { 4: 20 }],
      carpentry_10: [{}, { 21: 10 }],
    }
    for (const [name, [rset, lset]] of Object.entries(cases)) {
      const r = research(rset)
      const l = levels(lset)
      for (const [uid, exp] of Object.entries(FIX.army_cost_discounts[name])) {
        expectMatches(
          `ac_disc[${name}][${uid}]`,
          unitCost(Number(uid), r, l, true) as unknown as Record<string, unknown>,
          exp as Record<string, unknown>,
        )
      }
    }
  })
})

describe('islandNodeCost', () => {
  it('reproduces the sawmill and mine tables, including the level offset', () => {
    for (const [iid, byLevel] of Object.entries(FIX.island_cost)) {
      for (const [level, exp] of Object.entries(byLevel as Record<string, any>)) {
        expectMatches(
          `island_cost[${iid}][${level}]`,
          islandNodeCost(Number(iid), Number(level)) as unknown as Record<string, unknown>,
          exp,
        )
      }
    }
  })
})

describe('researchInfo', () => {
  it('reproduces point costs and the first unmet prerequisite', () => {
    const all1 = research(
      Object.fromEntries(Object.keys(research().levels).map((k) => [`res${k}`, 1])),
    )
    for (const [name, r] of [
      ['empty', ZR],
      ['all_level_1', all1],
    ] as const) {
      for (const [key, exp] of Object.entries(FIX.research[name])) {
        const [way, id] = key.split('.')
        const e = exp as Record<string, unknown>
        expectMatches(`research[${name}][${key}]`, researchInfo(Number(way), Number(id), r), {
          need_way: e.need_way,
          need_id: e.need_id,
          points: e.points,
          id: e.id,
        })
      }
    }
  })
})

describe('curves', () => {
  const table: Record<string, (n: number) => number> = {
    peoples_by_level: peoplesByLevel,
    scientists_by_level: scientistsByLevel,
    wine_by_tavern_level: wineByTavernLevel,
    speed_by_port_level: speedByPortLevel,
    spyes_time_by_level: spyTimeByLevel,
    branchOffice_capacity_by_level: branchCapacityByLevel,
    branchOffice_radius_by_level: branchRadiusByLevel,
    action_points_by_level: actionPointsByLevel,
    transport_cost_by_count: transportCostByCount,
    spy_risk_by_mission: spyRiskByMission,
    spy_gold_by_mission: spyGoldByMission,
    premium_cost: premiumCost,
  }

  for (const [name, fn] of Object.entries(table)) {
    it(name, () => {
      for (const [key, exp] of Object.entries(FIX[name] as Record<string, number | null>)) {
        const got = fn(Number(key))
        if (exp === null) {
          expect(got, `${name}[${key}]`).toBe(0)
        } else {
          expect(Math.abs(got - exp) <= EPS, `${name}[${key}]: got ${got}, expected ${exp}`).toBe(
            true,
          )
        }
      }
    })
  }

  it('wall_data_by_level', () => {
    for (const [key, exp] of Object.entries(FIX.wall_data_by_level as Record<string, any>)) {
      const got = wallDataByLevel(Number(key))
      expect(got.health).toBe(exp.health)
    }
  })
})

describe('travel time', () => {
  it('timeByCoords', () => {
    for (const [key, exp] of Object.entries(FIX.time_by_coords as Record<string, number>)) {
      const [coords, speed] = key.split('@')
      const [x1, x2, y1, y2] = coords!.split(',').map(Number)
      const got = timeByCoords(x1!, x2!, y1!, y2!, Number(speed))
      expect(Math.abs(got - exp) <= EPS, `time_by_coords[${key}]: got ${got}, exp ${exp}`).toBe(
        true,
      )
    }
  })

  it('spyTimeByCoords', () => {
    for (const [key, exp] of Object.entries(FIX.spy_time_by_coords as Record<string, number>)) {
      const [x1, x2, y1, y2] = key.split(',').map(Number)
      const got = spyTimeByCoords(x1!, x2!, y1!, y2!)
      expect(Math.abs(got - exp) <= EPS, `spy_time_by_coords[${key}]: got ${got}, exp ${exp}`).toBe(
        true,
      )
    }
  })
})

/**
 * Cost and lookup formulas, ported from izariam/models/data_model.php.
 *
 * The numeric tables live in @izariam/gamedata (extracted by
 * tools/extract-gamedata.py); this module only holds the arithmetic that sits
 * on top of them -- research discounts, build-time reductions, tail formulas.
 *
 * Every function here is checked against fixtures/lookups.json, which was
 * dumped from the running legacy PHP. Do not "fix" a formula that looks wrong
 * without also deciding what to do with the fixture: see config.ts.
 */

import {
  BUILDINGS,
  CURVES,
  ISLAND_NODES,
  RESEARCH,
  UNITS,
  type UnitStats,
} from '@izariam/gamedata'

import { LEGACY_QUIRKS, type LegacyQuirks } from './config.js'
import { BUILDING, type ResearchState, researchLevel } from './types.js'

export interface BuildingCost {
  wood: number
  wine: number
  marble: number
  crystal: number
  sulfur: number
  time: number
  max_level: number
}

const BUILDING_FIELDS = ['wood', 'wine', 'marble', 'crystal', 'sulfur', 'time'] as const

/** Building levels in a town, keyed by building type. Absent means 0. */
export type LevelsByType = Record<number, number>

function lvl(levels: LevelsByType, type: number): number {
  return levels[type] ?? 0
}

/**
 * Construction cost and duration for taking `type` to `level`.
 *
 * Research discounts are additive and apply to all five resources; the
 * carpentry shop adds a further wood-only discount. Build *time* is not
 * reduced here -- only unit production time is (see unitCost).
 */
export function buildingCost(
  type: number,
  level: number,
  research: ResearchState,
  levels: LevelsByType,
): BuildingCost {
  if (level < 0) level = 0
  const table = BUILDINGS[String(type)]

  const out: BuildingCost = {
    wood: 0,
    wine: 0,
    marble: 0,
    crystal: 0,
    sulfur: 0,
    time: 0,
    max_level: 0,
  }

  if (table) {
    for (const f of BUILDING_FIELDS) {
      const arr = table.levels[f]
      if (!arr) continue
      const v = level < arr.length ? arr[level]! : 0
      out[f] = v > 0 ? v : 0
    }
    out.max_level = table.max_level
  }

  let minus = 0
  if (researchLevel(research, 2, 2) > 0) minus += 0.02 // Pulley
  if (researchLevel(research, 2, 6) > 0) minus += 0.04 // Geometry
  if (researchLevel(research, 2, 11) > 0) minus += 0.08 // Water level

  const carpentry = lvl(levels, BUILDING.CARPENTERING)
  const minusWood = minus + (carpentry > 0 ? 0.01 * carpentry : 0)

  for (const f of BUILDING_FIELDS) {
    if (f === 'time') continue
    const m = f === 'wood' ? minusWood : minus
    out[f] = Math.max(0, out[f] - out[f] * m)
  }
  return out
}

/**
 * Which building's level shortens a unit's production, and the level at which
 * the reduction starts. `null` threshold means the full level counts with no
 * minimum. Keyed by unit array index (unit id - 1); index 22 (the cargo ship)
 * has no entry and is never reduced.
 */
const TIME_REDUCTION: Record<number, { building: number; threshold: number | null }> = {
  0: { building: BUILDING.BARRACKS, threshold: 4 },
  1: { building: BUILDING.BARRACKS, threshold: 12 },
  2: { building: BUILDING.BARRACKS, threshold: null },
  3: { building: BUILDING.BARRACKS, threshold: 6 },
  4: { building: BUILDING.BARRACKS, threshold: 2 },
  5: { building: BUILDING.BARRACKS, threshold: 7 },
  6: { building: BUILDING.BARRACKS, threshold: 13 },
  7: { building: BUILDING.BARRACKS, threshold: 3 },
  8: { building: BUILDING.BARRACKS, threshold: 8 },
  9: { building: BUILDING.BARRACKS, threshold: 14 },
  10: { building: BUILDING.BARRACKS, threshold: 10 },
  11: { building: BUILDING.BARRACKS, threshold: 11 },
  12: { building: BUILDING.BARRACKS, threshold: 5 },
  13: { building: BUILDING.BARRACKS, threshold: 9 },
  // Indices 14 and 15 straddle the land/naval boundary but both read the
  // shipyard level in the legacy switch. Reproduced as-is.
  14: { building: BUILDING.SHIPYARD, threshold: null },
  15: { building: BUILDING.SHIPYARD, threshold: null },
  16: { building: BUILDING.SHIPYARD, threshold: 4 },
  17: { building: BUILDING.SHIPYARD, threshold: 5 },
  18: { building: BUILDING.SHIPYARD, threshold: 2 },
  19: { building: BUILDING.SHIPYARD, threshold: 3 },
  20: { building: BUILDING.SHIPYARD, threshold: 6 },
  21: { building: BUILDING.SHIPYARD, threshold: 7 },
}

const TIME_REDUCTION_PER_LEVEL = 0.0455

/** Units 15..23 (array index >= 15) are ships and use the naval research line. */
const FIRST_SHIP_INDEX = 15

/**
 * Recruitment cost, stats and build time for one unit of `unitId` (1..23).
 *
 * `useResearch = false` returns the raw table, which is what the golden
 * fixture's base case records.
 */
export function unitCost(
  unitId: number,
  research: ResearchState,
  levels: LevelsByType,
  useResearch = true,
): UnitStats {
  let idx = Math.floor(unitId) - 1
  if (idx < 0) idx = 0
  const base = UNITS[String(idx + 1)]
  if (!base) throw new Error(`unknown unit id ${unitId}`)

  const out: UnitStats = { ...base }
  for (const k of Object.keys(out) as (keyof UnitStats)[]) {
    if (out[k] < 0) out[k] = 0
  }

  let minusGold = 0
  if (useResearch) {
    if (idx >= FIRST_SHIP_INDEX) {
      if (researchLevel(research, 1, 3) > 0) minusGold += 0.02 // Ship repair
      if (researchLevel(research, 1, 6) > 0) minusGold += 0.04 // Resin
      if (researchLevel(research, 1, 11) > 0) minusGold += 0.08 // Nautical maps
      const future = researchLevel(research, 1, 14)
      if (future > 0) minusGold += 0.02 * future
    } else {
      if (researchLevel(research, 4, 2) > 0) minusGold += 0.02 // Maps
      if (researchLevel(research, 4, 5) > 0) minusGold += 0.04 // Code of honour
      if (researchLevel(research, 4, 10) > 0) minusGold += 0.08 // Logistics
      const future = researchLevel(research, 4, 14)
      if (future > 0) minusGold += 0.02 * future
    }
  }

  const carpentry = lvl(levels, BUILDING.CARPENTERING)
  const minusWood = carpentry > 0 ? 0.01 * carpentry : 0

  out.gold = Math.max(0, out.gold - out.gold * minusGold)
  out.wood = Math.max(0, out.wood - out.wood * minusWood)

  const red = TIME_REDUCTION[idx]
  if (red) {
    const level = lvl(levels, red.building)
    if (red.threshold === null) {
      out.time -= out.time * level * TIME_REDUCTION_PER_LEVEL
    } else if (level >= red.threshold) {
      out.time -= out.time * (level - red.threshold) * TIME_REDUCTION_PER_LEVEL
    }
  }
  out.time = out.time < 0 ? 1 : Math.floor(out.time)
  return out
}

export interface IslandNodeCost {
  wood: number
  workers: number
  time: number
  max_level: number
}

/**
 * Cost of upgrading an island resource node, and the worker capacity the
 * current level grants. Node 0 is the sawmill; 1..4 all share the mine table.
 *
 * Note the off-by-one: the legacy subtracts 1 from the level before indexing,
 * so level 1 reads row 0 (30 workers).
 */
export function islandNodeCost(nodeId: number, level: number): IslandNodeCost {
  const idx = level - 1
  const table = ISLAND_NODES[String(nodeId)]
  const out: IslandNodeCost = { wood: 0, workers: 0, time: 0, max_level: 0 }
  if (!table) return out

  for (const f of ['wood', 'workers', 'time'] as const) {
    const arr = table.levels[f]
    if (!arr) continue
    const v = idx >= 0 && idx < arr.length ? arr[idx]! : 0
    out[f] = v > 0 ? v : 0
  }
  out.max_level = table.max_level
  return out
}

export interface ResearchInfo {
  id: number
  points: number
  /** 0 when every prerequisite is met. */
  need_way: number
  need_id: number
}

/**
 * Point cost of a research node and the first prerequisite still missing.
 *
 * Repeat levels cost `points * (currentLevel + 1)`, applied after the lookup
 * (data_model.php:1490-1491).
 */
export function researchInfo(way: number, id: number, research: ResearchState): ResearchInfo {
  const node = RESEARCH.nodes[`${way}.${id}`]
  const out: ResearchInfo = { id, points: node?.points ?? 0, need_way: 0, need_id: 0 }
  if (!node) return out

  for (const req of node.requires) {
    if (researchLevel(research, req.way, req.id) === 0) {
      out.need_way = req.way
      out.need_id = req.id
      break
    }
  }

  const level = researchLevel(research, way, id)
  if (level > 0) out.points = out.points * (level + 1)
  return out
}

// ---------------------------------------------------------------------------
// Single-argument curves
// ---------------------------------------------------------------------------

function curve(name: string, key: number): number | null {
  const v = CURVES[name]?.[String(key)]
  return v === undefined ? null : (v as number | null)
}

/** Population cap from the town hall level. Extrapolates past level 48. */
export function peoplesByLevel(level: number): number {
  if (level > 48) return 6760 + (level - 48) * 250
  return curve('peoples_by_level', level) ?? 60
}

/** Scientist cap from the academy level. Extrapolates past level 28. */
export function scientistsByLevel(level: number): number {
  if (level > 28) return 300 + (level - 28) * 20
  return curve('scientists_by_level', level) ?? 0
}

/**
 * Wine burned per hour at a given tavern setting.
 *
 * Above level 40 the legacy computes `818 + ((40 - level) * 60)`, which has
 * its operands reversed and turns consumption into production around level
 * 54. Unreachable in play (the tavern's cost table stops at 39) but kept
 * behind a flag rather than silently corrected.
 */
export function wineByTavernLevel(level: number, quirks: LegacyQuirks = LEGACY_QUIRKS): number {
  if (level > 40) {
    return quirks.invertedTavernWineAbove40 ? 818 + (40 - level) * 60 : 818 + (level - 40) * 60
  }
  return curve('wine_by_tavern_level', level) ?? 0
}

/** Port loading rate. The table ends at level 36; the port caps at 35. */
export function speedByPortLevel(level: number): number {
  return curve('speed_by_port_level', level) ?? 0
}

/**
 * Gold price of the next cargo ship.
 *
 * The price ladder has 160 entries and the legacy returns 0 past the end, so
 * every ship after the 160th is free -- and nothing caps the count. Reachable,
 * unlike the tavern bug.
 */
export function transportCostByCount(
  count: number,
  quirks: LegacyQuirks = LEGACY_QUIRKS,
): number {
  if (count >= 160) {
    if (quirks.freeTransportsPast160) return 0
    return curve('transport_cost_by_count', 159) ?? 0
  }
  return curve('transport_cost_by_count', count) ?? 0
}

/** Seconds to train one spy at the given safehouse level. */
export function spyTimeByLevel(level: number): number {
  return curve('spyes_time_by_level', level) ?? 0
}

/** Branch-office trade capacity: 400 * level^2. */
export function branchCapacityByLevel(level: number): number {
  return curve('branchOffice_capacity_by_level', level) ?? 400 * level * level
}

/** Branch-office search radius. */
export function branchRadiusByLevel(level: number): number {
  return curve('branchOffice_radius_by_level', level) ?? (level >= 3 ? Math.ceil(level / 2) : 1)
}

/** Action points from the town hall level. */
export function actionPointsByLevel(level: number): number {
  return curve('action_points_by_level', level) ?? (level > 0 ? 3 : 0) + Math.floor(level / 4)
}

export function spyRiskByMission(mission: number): number {
  return curve('spy_risk_by_mission', mission) ?? 0
}

export function spyGoldByMission(mission: number): number {
  return curve('spy_gold_by_mission', mission) ?? 0
}

/**
 * Always 0: `CURVES.premium_cost` is eight nulls, because the extractor keyed
 * the table by integer while `data_model.php:1579-1591` switches on the boost
 * *name*. Kept so the golden fixture still has something to compare against;
 * the prices the game actually uses are `PREMIUM_COST` in actions/colony.ts.
 */
export function premiumCost(type: number): number {
  return curve('premium_cost', type) ?? 0
}

/** Wall hit points and armour rating. Combat never reads these. */
export function wallDataByLevel(level: number): { health: number; reservation: number | null } {
  const raw = CURVES.wall_data_by_level?.[String(level)] as
    | { health: number; reservation: number | null }
    | undefined
  return raw ?? { health: 100 + level * 50, reservation: null }
}

// ---------------------------------------------------------------------------
// Travel
// ---------------------------------------------------------------------------

/**
 * Seconds for a fleet of the given speed to travel between two island
 * coordinates. Same-tile moves take half the one-tile time.
 */
export function timeByCoords(
  x1: number,
  x2: number,
  y1: number,
  y2: number,
  speed: number,
): number {
  const distance = Math.sqrt((x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2))
  if ((x1 === x2 && y1 === y2) || distance <= 0) {
    return ((1200 / speed) * 1 * 60) / 2
  }
  return (1200 / speed) * distance * 60
}

/** Seconds for a spy to reach a target: (distance + 1) * 300. */
export function spyTimeByCoords(x1: number, x2: number, y1: number, y2: number): number {
  const distance = Math.sqrt((x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2))
  return (distance + 1) * 300
}

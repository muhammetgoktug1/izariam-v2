/**
 * Derived per-town state, ported from Player_Model::Load_Player
 * (izariam/models/player_model.php:17-259).
 *
 * Nothing here mutates: given a PlayerState it returns the values the tick and
 * the screens read -- warehouse capacity, gold saldo, happiness, corruption,
 * production rates, population caps.
 *
 * The legacy recomputed all of this from scratch twice per request (once in
 * the Game controller, once inside Update_Model) against a memoisation cache
 * that never hit. Here it is computed once and passed down.
 */

import {
  islandNodeCost,
  peoplesByLevel,
  researchInfo,
  unitCost,
  type LevelsByType,
  type ResearchInfo,
} from './costs.js'
import {
  FORESTER_BONUS_PER_LEVEL,
  GARRISON_BASE,
  GARRISON_PER_LEVEL,
  GOLD_PER_CITIZEN,
  GOLD_PER_SCIENTIST,
  GOLD_PER_SCIENTIST_WITH_RESEARCH,
  OVERFLOW_WORKER_RATE,
  PREMIUM_CAPACITY_MULTIPLIER,
  PREMIUM_PRODUCTION_MULTIPLIER,
  SECONDS_PER_HOUR,
  WAREHOUSE_CAPACITY_PER_LEVEL,
  type GameConfig,
  DEFAULT_CONFIG,
} from './config.js'
import { RESEARCH_BRANCH_SIZE } from '@izariam/gamedata'

import {
  HAPPINESS_PER_PRIEST,
  miracleBonus,
  priestsByLevel,
  townFaith,
} from './temple.js'

import {
  BUILDING,
  RESOURCE_BY_TRADE_RESOURCE,
  levelsByType,
  researchLevel,
  type ResearchState,
  type PlayerState,
  type PremiumKind,
  type Resource,
  type TownState,
  type UserState,
} from './types.js'

/** Unit ids 1..22 carry gold upkeep; 23 (the cargo ship) is tracked on the
 *  user as `transports` and deliberately excluded by the legacy loop. */
const UPKEEP_UNIT_MAX = 22
/** Ids 1..14 are land units; only these count toward the garrison. */
const LAND_UNIT_MAX = 14

export interface HappinessBreakdown {
  base: number
  capital: number
  research: number
  tavern: number
  wine: number
  /** Two per priest, uncapped (temple.ts). Not a legacy term: the 2012 game
   *  stores priests and reads them nowhere. */
  priests: number
  /** Total citizens, subtracted from the sum above. */
  peoples: number
}

export interface DerivedTown {
  townId: number
  /** Building levels keyed by type -- the `$levels[]` array the cost
   *  functions index. */
  levels: LevelsByType
  /** Per-resource warehouse capacity. */
  capacity: number
  warehouseCount: number
  warehouseLevels: number[]
  /** Citizens including the assigned ones. */
  totalPeoples: number
  maxPeoples: number
  garrisonLimit: number
  /** Net gold per hour. */
  saldo: number
  /** Gold per hour from citizens minus scientists, before army upkeep. */
  peoplesGold: number
  /** Gold per hour spent on army upkeep. */
  armyGoldNeed: number
  landUnitCount: number
  /** Priests this town's temple can house; 0 without one (temple.ts). */
  priestLimit: number
  /** How much of the town believes, 0..1. */
  faith: number
  /** Resources plunder could not reach, per resource. Display-only for now --
   *  there is no combat -- but Athene's miracle multiplies it. */
  safeResources: number
  happiness: number
  happinessBreakdown: HappinessBreakdown
  corruption: number
  /** Base resource produced per second, before the forester bonus. */
  resourceProduction: number
  /** Resource per second after the premium multiplier. */
  resourceProductionBonus: number
  tradegoodProduction: number
  tradegoodProductionBonus: number
  /** Which resource this town's island yields. */
  tradeResource: Resource
  alreadyBuilt: Record<number, boolean>
}

export interface DerivedPlayer {
  towns: Record<number, DerivedTown>
  /** Research point multiplier from the science branch. */
  plusResearch: number
  /** Per-resource premium production multipliers. */
  plus: Record<Resource, number>
  plusCapacity: number
  scientists: number
  /** Towns whose colonisation has not completed are excluded. */
  activeTownIds: number[]
}

function premiumActive(user: UserState, kind: PremiumKind, now: number): boolean {
  const until = user.premium[kind]
  return until != null && until > now
}

function slotLevel(town: TownState, slot: number): number {
  return town.buildings.bySlot[slot]?.level ?? 0
}

/**
 * A town only counts once its first building exists. The legacy skips any
 * town with `pos0_level == 0`, which is how an in-flight colonisation is kept
 * out of the economy until the fleet lands.
 */
export function isTownActive(town: TownState): boolean {
  return slotLevel(town, 0) > 0
}

export function derive(
  state: PlayerState,
  now: number,
  config: GameConfig = DEFAULT_CONFIG,
): DerivedPlayer {
  const { user } = state
  const research = user.research

  const plus: Record<Resource, number> = { wood: 1, wine: 1, marble: 1, crystal: 1, sulfur: 1 }
  for (const r of ['wood', 'wine', 'marble', 'crystal', 'sulfur'] as const) {
    if (premiumActive(user, r, now)) plus[r] = PREMIUM_PRODUCTION_MULTIPLIER
  }
  const plusCapacity = premiumActive(user, 'capacity', now) ? PREMIUM_CAPACITY_MULTIPLIER : 1

  let plusResearch = 1
  if (researchLevel(research, 3, 2) > 0) plusResearch += 0.02 // Paper
  if (researchLevel(research, 3, 5) > 0) plusResearch += 0.04 // Ink
  if (researchLevel(research, 3, 11) > 0) plusResearch += 0.08 // Mechanical pen
  const futureScience = researchLevel(research, 3, 16)
  if (futureScience > 0) plusResearch += 0.02 * futureScience

  const active = state.towns.filter(isTownActive)
  const colonies = active.length - 1

  const scientistsGoldNeed =
    researchLevel(research, 3, 13) > 0 ? GOLD_PER_SCIENTIST_WITH_RESEARCH : GOLD_PER_SCIENTIST

  const towns: Record<number, DerivedTown> = {}
  let scientists = 0

  for (const town of active) {
    const levels = levelsByType(town)
    const island = state.islands[town.islandId]

    // --- warehouse capacity -------------------------------------------
    let capacity = config.standardCapacity
    let warehouseCount = 0
    const warehouseLevels: number[] = []
    const alreadyBuilt: Record<number, boolean> = {}
    for (let i = 0; i <= 26; i++) alreadyBuilt[i] = false
    for (let slot = 0; slot <= 14; slot++) {
      const b = town.buildings.bySlot[slot]
      if (!b) continue
      if (b.type === BUILDING.WAREHOUSE) {
        capacity += b.level * WAREHOUSE_CAPACITY_PER_LEVEL
        warehouseCount++
        warehouseLevels.push(b.level)
      }
      if (b.level > 0) alreadyBuilt[b.type] = true
    }
    /**
     * A queued building counts as built, which is `correct_buildings()`
     * (player_model.php:378-393): it walks the whole build queue and stamps the
     * ordered type onto the empty slot it is going to occupy, marking
     * `already_build[type]`. The construction menu then hides that type
     * (buildingGround.php:20).
     *
     * Without it the menu keeps offering a building that is already on its way,
     * and ordering it again queues a second one at level 1 rather than sending
     * the player to the upgrade panel for level 2 -- which is exactly what the
     * rules allow, since `build()` reads stored slot types only
     * (actions/building.ts:169-186, faithful to actions.php:403-411).
     */
    for (const entry of town.buildQueue) {
      if (entry.type > 0) alreadyBuilt[entry.type] = true
    }

    // Priests count as citizens. The legacy left `templer` out of every total
    // it computed, which was harmless while nothing could create one -- with
    // priests assignable, leaving them out would pay twice for the same
    // citizen: the population penalty drops *and* the priest bonus lands.
    const totalPeoples =
      town.peoples + town.scientists + town.workers + town.tradegood + town.templer
    scientists += town.scientists

    const priestLimit = priestsByLevel(levels[BUILDING.TEMPLE] ?? 0)

    // Slot 0 and slot 14 specifically -- not "town hall and wall by type".
    const garrisonLimit =
      GARRISON_BASE + (slotLevel(town, 0) + slotLevel(town, 14)) * GARRISON_PER_LEVEL

    // --- gold saldo -----------------------------------------------------
    let saldo = town.peoples * GOLD_PER_CITIZEN - town.scientists * scientistsGoldNeed
    const peoplesGold = saldo
    let armyGoldNeed = 0
    let landUnitCount = 0
    for (let unitId = 1; unitId <= UPKEEP_UNIT_MAX; unitId++) {
      const count = town.army[unitId] ?? 0
      if (count <= 0) continue
      const cost = unitCost(unitId, research, levels)
      armyGoldNeed += cost.gold * count
      if (unitId <= LAND_UNIT_MAX) landUnitCount += count
    }
    saldo -= armyGoldNeed

    // --- population cap and happiness -----------------------------------
    let maxPeoples = peoplesByLevel(slotLevel(town, 0))
    const isCapital = user.capitalTownId === town.id
    const breakdown: HappinessBreakdown = {
      base: 196,
      capital: 0,
      research: 0,
      tavern: levels[BUILDING.TAVERN] ?? 0,
      wine: town.tavernWine * 60,
      priests: HAPPINESS_PER_PRIEST * town.templer,
      peoples: totalPeoples,
    }
    if (researchLevel(research, 3, 1) > 0 && isCapital) {
      maxPeoples += 50
      breakdown.capital += 50
    }
    if (researchLevel(research, 2, 8) > 0) {
      breakdown.research += 25
    }
    if (researchLevel(research, 2, 14) > 0 && isCapital) {
      maxPeoples += 200
      breakdown.capital += 200
    }
    const wellbeing = researchLevel(research, 2, 15)
    if (wellbeing > 0) {
      maxPeoples += 20 * wellbeing
      breakdown.research += 10 * wellbeing
    }
    let happiness =
      breakdown.base +
      breakdown.capital +
      breakdown.research +
      breakdown.tavern +
      breakdown.wine +
      breakdown.priests -
      breakdown.peoples

    // --- corruption ------------------------------------------------------
    let corruption = 0
    if (colonies > 0) {
      corruption =
        1 -
        ((levels[BUILDING.PALACE] ?? 0) + (levels[BUILDING.PALACE_COLONY] ?? 0) + 1) /
          (colonies + 1)
      if (corruption > 0) {
        happiness -= (town.peoples + happiness) * corruption
      }
    }

    // --- production -------------------------------------------------------
    const woodCap = islandNodeCost(0, island?.woodLevel ?? 1).workers
    const tradeCap = islandNodeCost(1, island?.tradeLevel ?? 1).workers
    const tradeResource = RESOURCE_BY_TRADE_RESOURCE[island?.tradeResource ?? 0] ?? 'wood'

    let resourceProduction: number
    if (town.workers > woodCap) {
      // The legacy applies plus_wood here *and* again when computing
      // resourceProductionBonus, so premium wood compounds to 1.44x for the
      // overflow branch only. Reproduced deliberately -- see the note below.
      resourceProduction =
        (woodCap / SECONDS_PER_HOUR) * (1 - corruption) * plus.wood +
        ((town.workers - woodCap) * OVERFLOW_WORKER_RATE) / SECONDS_PER_HOUR *
          (1 - corruption) *
          plus.wood
    } else {
      resourceProduction = (town.workers / SECONDS_PER_HOUR) * (1 - corruption)
    }
    const resourceProductionBonus = resourceProduction * plus.wood

    let tradegoodProduction: number
    if (town.tradegood > tradeCap) {
      tradegoodProduction =
        (tradeCap / SECONDS_PER_HOUR) * (1 - corruption) +
        (((town.tradegood - tradeCap) * OVERFLOW_WORKER_RATE) / SECONDS_PER_HOUR) *
          (1 - corruption)
    } else {
      tradegoodProduction = (town.tradegood / SECONDS_PER_HOUR) * (1 - corruption)
    }
    const tradegoodProductionBonus = tradegoodProduction * plus[tradeResource]

    towns[town.id] = {
      townId: town.id,
      levels,
      capacity,
      warehouseCount,
      warehouseLevels,
      totalPeoples,
      maxPeoples,
      garrisonLimit,
      saldo,
      peoplesGold,
      armyGoldNeed,
      landUnitCount,
      priestLimit,
      faith: townFaith(town.templer, maxPeoples),
      // warehouse.php:12 -- 100 plus 80 a warehouse, times the premium
      // multiplier, and now times whatever Athene is granting.
      safeResources:
        (warehouseCount * 80 + 100) * plusCapacity * (1 + miracleBonus(state, 'storage', now)),
      happiness,
      happinessBreakdown: breakdown,
      corruption,
      resourceProduction,
      resourceProductionBonus,
      tradegoodProduction,
      tradegoodProductionBonus,
      tradeResource,
      alreadyBuilt,
    }
  }

  return {
    towns,
    plusResearch,
    plus,
    plusCapacity,
    scientists,
    activeTownIds: active.map((t) => t.id),
  }
}

/**
 * The next unresearched node in each branch, and whether the research advisor
 * should light up. Ported from Player_Model::Load_Ways
 * (izariam/models/player_model.php:395-420).
 *
 * Each branch is scanned for the first node still at level 0. The scan stops
 * one short of the branch's last node -- that last one is the repeatable
 * "future of ..." tech, and it is only offered once it has been taken at least
 * once. The advisor lights when the offered node is affordable and the player
 * has not already dismissed that branch.
 */
export function researchWays(research: ResearchState): {
  ways: Record<number, ResearchInfo | undefined>
  advisor: boolean
} {
  const ways: Record<number, ResearchInfo | undefined> = {}
  let advisor = false

  for (const [branch, size] of Object.entries(RESEARCH_BRANCH_SIZE)) {
    const way = Number(branch)
    const last = size

    for (let node = 1; node < last; node++) {
      if (researchLevel(research, way, node) === 0) {
        ways[way] = researchInfo(way, node, research)
        break
      }
    }
    if (researchLevel(research, way, last) > 0) {
      ways[way] = researchInfo(way, last, research)
    }

    const offered = ways[way]
    if (offered && offered.points <= research.points && !research.branchSeen[way]) {
      advisor = true
    }
  }

  return { ways, advisor }
}

/**
 * Extra wood from the forester's house, and extra trade good from the
 * matching refinery. The legacy applies these inside Update_Towns rather than
 * in Load_Player, so they are exposed separately.
 */
export function foresterMultiplier(levels: LevelsByType): number {
  return 1 + FORESTER_BONUS_PER_LEVEL * (levels[BUILDING.FORESTER] ?? 0)
}

export function warehouseCapacity(derived: DerivedTown, plusCapacity: number): number {
  return derived.capacity * plusCapacity
}

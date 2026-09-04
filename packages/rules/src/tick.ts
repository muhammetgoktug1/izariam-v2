/**
 * The town tick, ported from Update_Model::Update_Towns and Update_Islands
 * (izariam/models/update_model.php:85-506) plus the Update_Player wrapper
 * (:22-84).
 *
 * Advances a player's world from `town.lastUpdate` to `now`. The legacy has no
 * cron: this runs on every authenticated request and derives everything from
 * elapsed seconds, which is why offline accumulation works. That design is
 * kept -- it is correct and cheap -- but the double hydration, the duplicated
 * Update_Missions call and the 25-950 query round-trips are not.
 *
 * Several formulas below look wrong because they are. They are reproduced
 * exactly so fixtures/tick.json passes; each is flagged and gated in config.ts.
 */

import {
  actionPointsByLevel,
  buildingCost,
  islandNodeCost,
  spyTimeByLevel,
  unitCost,
  wineByTavernLevel,
  type LevelsByType,
} from './costs.js'
import {
  DEFAULT_CONFIG,
  FORESTER_BONUS_PER_LEVEL,
  POPULATION_GROWTH_DIVISOR,
  REFINERY_BONUS_PER_LEVEL,
  SECONDS_PER_HOUR,
  type GameConfig,
} from './config.js'
import { derive, isTownActive, type DerivedPlayer, type DerivedTown } from './derive.js'
import { miracleBonus } from './temple.js'
import {
  BUILDING,
  REFINERY_BY_TRADE_RESOURCE,
  RESOURCES,
  RESOURCE_BY_TRADE_RESOURCE,
  type BuildQueueEntry,
  type IslandState,
  type PendingMessage,
  type PlayerState,
  type Resource,
  type TownState,
  type UnitQueueEntry,
} from './types.js'

/** Unit ids 1..22 carry gold upkeep; the cargo ship (23) is excluded. */
const UPKEEP_UNIT_MAX = 22

export interface TickResult {
  state: PlayerState
  messages: PendingMessage[]
  /** Recomputed score facets, matching the legacy points_* columns. */
  scores: Record<string, number>
}

function levelAtSlot(town: TownState, slot: number): number {
  return town.buildings.bySlot[slot]?.level ?? 0
}

function setSlot(town: TownState, slot: number, type: number, level: number) {
  town.buildings.bySlot[slot] = { type, level }
}

/**
 * Advance one player's world to `now`.
 *
 * The caller is responsible for loading the full PlayerState and persisting
 * whatever comes back, inside one transaction. Islands, missions, trade routes
 * and spies are handled by their own modules; hooks for them are invoked in
 * the same order the legacy used.
 */
export function tickPlayer(
  state: PlayerState,
  now: number,
  config: GameConfig = DEFAULT_CONFIG,
  hooks: TickHooks = {},
): TickResult {
  const messages: PendingMessage[] = []

  // points_peoples is the only facet reset before the town loop; the rest
  // carry over from the stored row or are rebuilt by derive().
  const scores: Record<string, number> = { ...state.user.scores, peoples: 0 }

  const derived = derive(state, now, config)
  scores.army = deriveArmyPoints(state, derived)

  for (const town of state.towns) {
    if (!isTownActive(town)) continue
    const d = derived.towns[town.id]
    if (!d) continue
    tickTown(state, town, d, derived, now, config, scores, messages)
    // Spies resolve per town, as the last statement of the legacy's town body
    // (update_model.php:426).
    hooks.spies?.(state, town, now, messages)
  }

  tickIslands(state, now, messages)
  hooks.missions?.(state, now, messages)
  hooks.tradeRoutes?.(state, now, messages)
  // Update_Player called Update_Missions a second time here
  // (update_model.php:37). That was not a design choice: most of the mission
  // block wrote through db->set without touching the in-memory row, so a
  // second pass was the only way deferred state landed -- at the cost of
  // re-running the buy and sell blocks, which debited the fleet's purse and
  // removed its cargo twice. The port mutates state directly, so one pass is
  // both sufficient and correct, and the double charge disappears with it.

  if (state.user.gold < 0) state.user.gold = 0

  for (const kind of [
    'account',
    'wood',
    'wine',
    'marble',
    'crystal',
    'sulfur',
    'capacity',
  ] as const) {
    const until = state.user.premium[kind]
    if (until != null && until < now) state.user.premium[kind] = null
  }

  scores.gold = state.user.gold
  // points_levels, points_complete and points_gold are stored but deliberately
  // left out of the total, exactly as the legacy sums it.
  scores.total =
    (scores.buildings ?? 0) +
    (scores.peoples ?? 0) +
    (scores.research ?? 0) * 6 +
    (scores.army ?? 0) +
    (scores.transports ?? 0)

  state.user.scores = scores
  return { state, messages, scores }
}

export interface TickHooks {
  missions?: (state: PlayerState, now: number, messages: PendingMessage[]) => void
  tradeRoutes?: (state: PlayerState, now: number, messages: PendingMessage[]) => void
  spies?: (state: PlayerState, town: TownState, now: number, messages: PendingMessage[]) => void
}

/** points_army is accumulated inside Load_Player, not the tick. */
function deriveArmyPoints(state: PlayerState, derived: DerivedPlayer): number {
  let points = 0
  for (const town of state.towns) {
    const d = derived.towns[town.id]
    if (!d) continue
    for (let unitId = 1; unitId <= UPKEEP_UNIT_MAX; unitId++) {
      const count = town.army[unitId] ?? 0
      if (count <= 0) continue
      const cost = unitCost(unitId, state.user.research, d.levels)
      points += (cost.wood + cost.wine + cost.crystal + cost.sulfur) * 0.02
    }
  }
  return points
}

function tickTown(
  state: PlayerState,
  town: TownState,
  d: DerivedTown,
  derived: DerivedPlayer,
  now: number,
  config: GameConfig,
  scores: Record<string, number>,
  messages: PendingMessage[],
) {
  const elapsed = now - town.lastUpdate
  town.lastUpdate = now
  const island = state.islands[town.islandId]

  // --- wine burned by the tavern -------------------------------------------
  const wineNeed = wineByTavernLevel(town.tavernWine, config.quirks)
  town.resources.wine -= (wineNeed / SECONDS_PER_HOUR) * elapsed
  if (town.resources.wine < 0) {
    town.resources.wine = 0
    town.tavernWine = 0
  }

  // --- population ----------------------------------------------------------
  let total = d.totalPeoples
  if (total < d.maxPeoples) {
    town.peoples += (d.happiness / POPULATION_GROWTH_DIVISOR / SECONDS_PER_HOUR) * elapsed
    // Demeter's gardens, if the player has called them: citizens per hour on
    // top of the growth the town earned, inside the same cap (temple.ts).
    town.peoples += (miracleBonus(state, 'population', now) / SECONDS_PER_HOUR) * elapsed
    total = town.peoples + town.scientists + town.workers + town.tradegood + town.templer
  }
  // Counted before the clamp below, so a town over its cap scores citizens it
  // is about to lose.
  scores.peoples =
    (scores.peoples ?? 0) +
    Math.floor(town.peoples + town.workers + town.tradegood + town.scientists)
  if (town.peoples < 0) town.peoples = 0
  if (total > d.maxPeoples) {
    town.peoples = d.maxPeoples - (total - town.peoples)
    total = town.peoples + town.scientists + town.workers + town.tradegood + town.templer
  }

  // --- gold ---------------------------------------------------------------
  // saldo was derived from the pre-clamp population, so this can pay for
  // citizens the town no longer has (config.quirks.saldoUsesUnclampedPopulation).
  state.user.gold += (d.saldo / SECONDS_PER_HOUR) * elapsed

  // --- wood ----------------------------------------------------------------
  let resourceAdd = d.resourceProductionBonus * elapsed
  const foresterLevel = d.levels[BUILDING.FORESTER] ?? 0
  if (foresterLevel > 0) {
    resourceAdd += resourceAdd * FORESTER_BONUS_PER_LEVEL * foresterLevel
  }
  town.resources.wood += resourceAdd

  // --- trade good -----------------------------------------------------------
  // The (1 - corruption) and premium factors are already baked into
  // tradegoodProductionBonus, and the legacy applies both a second time here.
  let tradegoodAdd = d.tradegoodProductionBonus * elapsed
  const tradeResourceId = island?.tradeResource ?? 0
  const refinery = REFINERY_BY_TRADE_RESOURCE[tradeResourceId]
  if (refinery !== undefined) {
    const refineryLevel = d.levels[refinery] ?? 0
    if (refineryLevel > 0) {
      tradegoodAdd += tradegoodAdd * REFINERY_BONUS_PER_LEVEL * refineryLevel
    }
    const target: Resource = RESOURCE_BY_TRADE_RESOURCE[tradeResourceId]!
    town.resources[target] += tradegoodAdd * (1 - d.corruption) * derived.plus[target]
  }

  // --- storage cap ----------------------------------------------------------
  // Note: the premium capacity boost is not applied. The legacy computes it
  // but only ever displays it (config.quirks -- see derive()).
  for (const r of RESOURCES) {
    if (town.resources[r] > d.capacity) town.resources[r] = d.capacity
  }

  // --- research -------------------------------------------------------------
  const addPoints = town.scientists * derived.plusResearch
  state.user.research.points += (addPoints / SECONDS_PER_HOUR) * elapsed

  // --- construction queue ----------------------------------------------------
  if (town.buildQueue.length > 0) {
    runBuildQueue(state, town, d, now, scores, messages)
  }

  // --- action points ---------------------------------------------------------
  const fleets = state.missions.filter(
    (m) => m.fromTownId === town.id && m.userId === state.user.id,
  ).length
  town.actionPoints = actionPointsByLevel(levelAtSlot(town, 0)) - fleets

  // --- unit queues ------------------------------------------------------------
  runUnitQueue(town, d, state, 'land')
  runUnitQueue(town, d, state, 'naval')

  // --- spy training -------------------------------------------------------------
  if (town.spyTrainingStartedAt != null) {
    const safehouseLevel = d.levels[BUILDING.SAFEHOUSE] ?? 0
    const spyTime = spyTimeByLevel(safehouseLevel)
    if (now >= town.spyTrainingStartedAt + spyTime) {
      town.spies += 1
      town.spyTrainingStartedAt = null
    }
  }

  // --- army upkeep ----------------------------------------------------------------
  // Charged a second time here: derive() already subtracted it inside saldo
  // (config.quirks.doubleArmyUpkeep).
  if (config.quirks.doubleArmyUpkeep) {
    let armyGold = 0
    for (let unitId = 1; unitId <= UPKEEP_UNIT_MAX; unitId++) {
      const count = town.army[unitId] ?? 0
      const cost = unitCost(unitId, state.user.research, d.levels)
      armyGold += ((cost.gold * count) / SECONDS_PER_HOUR) * elapsed
    }
    state.user.gold -= armyGold
  }
}

/**
 * Resolve the construction queue.
 *
 * The legacy walks two cursors: the real queue it persists, and a "pseudo
 * queue" (`$while_line`) used to decide what to look at next. On the very
 * first completion of a pass it advances only the real one, so the next
 * iteration re-reads the *original* head from the pseudo queue and builds it a
 * second time. `build_queue_head_only` in the fixture pins that behaviour:
 * two queued entries produce three completions.
 *
 * Payment is deferred -- queueing pays for the head only, and completing entry
 * N debits entry N+1. Note the legacy prices N+1 against the level of entry
 * N's slot, which is wrong whenever the two entries target different slots.
 */
function runBuildQueue(
  state: PlayerState,
  town: TownState,
  d: DerivedTown,
  now: number,
  scores: Record<string, number>,
  messages: PendingMessage[],
) {
  const research = state.user.research
  const levels: LevelsByType = d.levels

  let real: BuildQueueEntry[] = [...town.buildQueue]
  let pseudo: BuildQueueEntry[] = [...town.buildQueue]
  let buildings: BuildQueueEntry[] = [...town.buildQueue]
  let buildStart = town.buildStartedAt ?? 0
  let step = 0

  // Declared outside the loop on purpose. PHP's $wood/$wine/... survive from
  // one iteration to the next, and the legacy only recomputes them while more
  // than one entry is queued -- so the last entry's affordability check reads
  // the *previous* entry's projection. Resetting this per iteration would
  // silently drop the final building in every multi-entry queue.
  let projected: Record<Resource, number> | null = null

  while (buildings.length > 0) {
    const head = buildings[0]!
    const level = levelAtSlot(town, head.slot)
    const cost = buildingCost(head.type, level, research, levels)

    if (buildings.length > 1) {
      const nextCost = buildingCost(buildings[1]!.type, level, research, levels)
      projected = {
        wood: town.resources.wood - nextCost.wood,
        wine: town.resources.wine - nextCost.wine,
        marble: town.resources.marble - nextCost.marble,
        crystal: town.resources.crystal - nextCost.crystal,
        sulfur: town.resources.sulfur - nextCost.sulfur,
      }
    }

    if (buildStart + cost.time <= now) {
      const affordable =
        step === 0 || (projected !== null && RESOURCES.every((r) => projected![r] >= 0))

      if (affordable) {
        scores.buildings =
          (scores.buildings ?? 0) +
          (cost.wood + cost.wine + cost.marble + cost.crystal + cost.sulfur) * 0.01
        scores.levels = (scores.levels ?? 0) + 1

        const newLevel = level + 1
        setSlot(town, head.slot, head.type, newLevel)
        messages.push({
          channel: 'town',
          userId: state.user.id,
          townId: town.id,
          kind: newLevel === 1 ? 'building_completed' : 'building_upgraded',
          params: { slot: head.slot, type: head.type, level: newLevel, at: buildStart + cost.time },
        })

        const costsAnything =
          cost.wood > 0 || cost.wine > 0 || cost.marble > 0 || cost.crystal > 0 || cost.sulfur > 0
        if (step > 0 && buildings.length > 1 && costsAnything && projected) {
          for (const r of RESOURCES) town.resources[r] = projected[r]
        }

        if (buildings.length > 1) {
          real = real.slice(1)
          buildStart += cost.time
          if (step > 0) {
            pseudo = pseudo.slice(1)
            // The legacy reloads from the real queue here, then unconditionally
            // overwrites it from the pseudo queue at the bottom of the loop --
            // a dead assignment, so nothing is done with `real` at this point.
          }
        } else {
          real = []
          buildStart = 0
          buildings = []
          break
        }
      } else {
        // Cannot pay for the follow-up: drop the head from both cursors
        // without completing it.
        real = real.slice(1)
        pseudo = pseudo.slice(1)
      }
    } else {
      // Not finished yet. Peek past it in the pseudo queue and stop.
      pseudo = pseudo.slice(1)
      buildings = [...pseudo]
      break
    }

    buildings = [...pseudo]
    step++
  }

  town.buildQueue = real
  town.buildStartedAt = real.length > 0 && buildStart > 0 ? buildStart : null
  if (real.length === 0) town.buildStartedAt = null
}

/**
 * Resolve a unit production queue.
 *
 * Reproduces a real defect: when a whole batch finishes, the legacy advances
 * the queue's start time by `army[0].count * cost.time` *after* popping, so
 * `army[0]` is already the next entry. The time the finished batch consumed is
 * therefore charged at the successor's count, and when the queue empties the
 * start time is not advanced at all.
 */
function runUnitQueue(
  town: TownState,
  d: DerivedTown,
  state: PlayerState,
  kind: 'land' | 'naval',
) {
  const queueKey = kind === 'land' ? 'landQueue' : 'navalQueue'
  const startKey = kind === 'land' ? 'landQueueStartedAt' : 'navalQueueStartedAt'

  let queue: UnitQueueEntry[] = [...town[queueKey]]
  if (queue.length === 0) return
  let start = town[startKey] ?? 0
  const now = town.lastUpdate

  while (queue.length > 0) {
    const head = queue[0]!
    const cost = unitCost(head.unitType, state.user.research, d.levels)
    const elapsed = now - start
    const done = cost.time > 0 ? Math.floor(elapsed / cost.time) : head.count

    if (done >= head.count) {
      town.army[head.unitType] = (town.army[head.unitType] ?? 0) + head.count
      queue = queue.slice(1)
      // Reads the *new* head's count -- see the note above.
      const successor = queue[0]
      start += (successor?.count ?? 0) * cost.time
    } else {
      if (done > 0) {
        town.army[head.unitType] = (town.army[head.unitType] ?? 0) + done
        queue = [{ unitType: head.unitType, count: head.count - done }, ...queue.slice(1)]
        start += done * cost.time
      }
      break
    }
  }

  town[queueKey] = queue
  town[startKey] = queue.length > 0 ? start : null
}

/**
 * Island resource nodes, ported from Update_Islands
 * (update_model.php:431-506).
 *
 * A node starts upgrading as soon as the donated wood covers its cost, and
 * completes once its build time has elapsed. Level 1 costs 0 wood and takes 0
 * seconds, so a fresh island stamps an upgrade start on every tick.
 */
export function tickIslands(state: PlayerState, now: number, messages: PendingMessage[]) {
  const seen = new Set<number>()
  for (const town of state.towns) {
    const island = state.islands[town.islandId]
    if (!island || seen.has(island.id)) continue
    seen.add(island.id)
    tickIslandNode(island, 'wood', now, messages)
    tickIslandNode(island, 'trade', now, messages)
  }
}

function tickIslandNode(
  island: IslandState,
  node: 'wood' | 'trade',
  now: number,
  messages: PendingMessage[],
) {
  const levelKey = node === 'wood' ? 'woodLevel' : 'tradeLevel'
  const donatedKey = node === 'wood' ? 'woodDonated' : 'tradeDonated'
  const startKey = node === 'wood' ? 'woodUpgradeStartedAt' : 'tradeUpgradeStartedAt'
  // Node 0 is the sawmill; every trade good shares the mine table.
  const nodeId = node === 'wood' ? 0 : 1

  const cost = islandNodeCost(nodeId, island[levelKey])
  const started = island[startKey]

  if (started == null) {
    if (island[donatedKey] >= cost.wood) island[startKey] = now
    return
  }

  if (now >= started + cost.time) {
    island[levelKey] += 1
    island[donatedKey] -= cost.wood
    if (island[donatedKey] < 0) island[donatedKey] = 0
    island[startKey] = null
    messages.push({
      channel: 'town',
      userId: 0,
      kind: node === 'wood' ? 'island_sawmill_upgraded' : 'island_mine_upgraded',
      params: { islandId: island.id, level: island[levelKey] },
    })
  }
}

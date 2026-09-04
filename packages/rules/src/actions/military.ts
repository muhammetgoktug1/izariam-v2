/**
 * Military actions, ported from izariam/controllers/actions.php.
 *
 * Recruitment (army/fleet), disbanding (armyEdit), the two queue aborts and
 * the safehouse spy actions. In the legacy each of these was a controller
 * method that mutated $this->Player_Model in place, wrote the same values to
 * the DB and then re-rendered a view; here they mutate the TownState /
 * PlayerState they are handed and report whether the guard chain let them
 * through.
 *
 * A blocked action was answered by silently re-rendering the page, so the
 * legacy has no vocabulary of its own for failure -- the `reason` codes below
 * are named after the guard that rejected the call, and no branch that the
 * legacy accepted is reported as a failure here.
 *
 * None of these actions wrote to town_messages, so `messages` is always empty;
 * the shape is kept uniform with the other action modules.
 */

import { DEFAULT_CONFIG, type GameConfig } from '../config.js'
import { unitCost } from '../costs.js'
import type { DerivedTown } from '../derive.js'
import {
  BUILDING,
  type ActionResult,
  type PendingMessage,
  type PlayerState,
  type SpyState,
  type TownState,
  type UnitQueueEntry,
} from '../types.js'

/** Shared by every action module. Defined locally until it is hoisted. */
export type { ActionResult } from '../types.js'

/**
 * Guard that rejected the call. Assignable to ActionResult's `reason`; the API
 * layer maps these to the localised strings the legacy views hard-coded.
 */
export type MilitaryFailure =
  | 'barracks_missing'
  | 'shipyard_missing'
  | 'position_mismatch'
  | 'barracks_in_build_queue'
  | 'shipyard_in_build_queue'
  | 'unit_queue_full'
  | 'not_enough_resources'
  | 'queue_empty'
  | 'not_enough_gold'
  | 'not_enough_crystal'
  | 'spy_already_training'
  | 'safehouse_full'
  | 'no_idle_spy'
  | 'spy_target_invalid'
  | 'spy_not_found'

/**
 * What an action needs to run. `derived` is the DerivedTown for `town`, i.e.
 * derive(state, now).towns[town.id] -- the legacy re-ran Load_Player before
 * every controller method, so the levels the cost functions index are always
 * the post-tick ones.
 */
export interface ActionContext {
  state: PlayerState
  town: TownState
  derived: DerivedTown
  /** Epoch seconds, the legacy time(). */
  now: number
  config?: GameConfig
}

/** unit id -> requested count, straight off the POST body. */
export type UnitCounts = Record<number, number>

function ok(): ActionResult {
  return { ok: true, messages: [] }
}

function fail(reason: MilitaryFailure): ActionResult {
  return { ok: false, reason }
}

/**
 * `floor($_POST[$i])` with the absent key defaulting to 0
 * (actions.php:189). PHP's floor() of a non-numeric POST value is 0, and it
 * rounds toward negative infinity exactly as Math.floor does -- including for
 * negative input, which the callers below deliberately do not reject.
 */
function postedCount(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return 0
  return Math.floor(raw)
}

/**
 * get_position() (data_model.php:1037-1049): the *last* slot holding the type
 * wins, since the loop never breaks, and 0 doubles as "not found" -- slot 0 is
 * always the town hall. The level is not looked at, but the tick only ever
 * stamps a slot's type together with level 1, so a matched slot is built.
 */
function positionOfType(town: TownState, type: number): number {
  let found = 0
  for (let slot = 0; slot <= 14; slot++) {
    if (town.buildings.bySlot[slot]?.type === type) found = slot
  }
  return found
}

/**
 * Length of the queue as the legacy stored it: "type,count" joined by ";"
 * (data_model.php:1012-1029 parses it back).
 *
 * This is what the queue-size guard measures, so `army_queue_size` is a budget
 * of *characters*, not of entries -- see the note on canQueue().
 */
function serialisedQueueLength(queue: readonly UnitQueueEntry[]): number {
  let length = 0
  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i]!
    if (i > 0) length += 1
    length += String(entry.unitType).length + 1 + String(entry.count).length
  }
  return length
}

interface RecruitSpec {
  /** Barracks for land units, shipyard for ships. */
  building: number
  firstUnit: number
  lastUnit: number
  queueKey: 'landQueue' | 'navalQueue'
  startKey: 'landQueueStartedAt' | 'navalQueueStartedAt'
  missingBuilding: MilitaryFailure
  buildingQueued: MilitaryFailure
}

const LAND: RecruitSpec = {
  building: BUILDING.BARRACKS,
  firstUnit: 1,
  lastUnit: 14,
  queueKey: 'landQueue',
  startKey: 'landQueueStartedAt',
  missingBuilding: 'barracks_missing',
  buildingQueued: 'barracks_in_build_queue',
}

const NAVAL: RecruitSpec = {
  building: BUILDING.SHIPYARD,
  firstUnit: 16,
  lastUnit: 22,
  queueKey: 'navalQueue',
  startKey: 'navalQueueStartedAt',
  missingBuilding: 'shipyard_missing',
  buildingQueued: 'shipyard_in_build_queue',
}

/**
 * Recruit land units 1..14 into the barracks queue
 * (actions.php:169-247).
 *
 * `position` is the board slot the client believes the barracks occupies; the
 * legacy compares it with get_position() and does nothing when they disagree,
 * which is the whole of its CSRF/consistency checking.
 */
export function army(ctx: ActionContext, position: number, counts: UnitCounts): ActionResult {
  const result = recruit(ctx, position, counts, LAND)
  // Tutorial step 11 is "train your first lancers"; only the land queue fires
  // it, and only forwards (actions.php:238-241).
  if (result.ok && ctx.state.user.tutorialStep <= 10) {
    ctx.state.user.tutorialStep = 11
  }
  return result
}

/** Recruit ships 16..22 into the shipyard queue (actions.php:1193-1266).
 *  Identical to army() down to the copy-pasted variable names, minus the
 *  tutorial hook. Unit 15 (the barbarian) and 23 (the cargo ship) are outside
 *  both loops: barbarians are spawned by barbarian villages, cargo ships are
 *  bought on the user row. */
export function fleet(ctx: ActionContext, position: number, counts: UnitCounts): ActionResult {
  return recruit(ctx, position, counts, NAVAL)
}

function recruit(
  ctx: ActionContext,
  position: number,
  counts: UnitCounts,
  spec: RecruitSpec,
): ActionResult {
  const config = ctx.config ?? DEFAULT_CONFIG
  const { state, town } = ctx
  const queue = town[spec.queueKey]

  // Recruiting is blocked only while the production building is the *head* of
  // the construction queue; a barracks queued behind something else does not
  // stop it (actions.php:172).
  const buildHead = town.buildQueue[0]
  if (buildHead !== undefined && buildHead.type === spec.building) {
    return fail(spec.buildingQueued)
  }

  // The legacy measures the queue with strlen() on the serialised line
  // (actions.php:173), so `army_queue_size * 4` is a character budget: three
  // one-digit batches ("1,5;2,5;3,5", 11 chars) fit under the default 12 while
  // two four-digit ones ("16,1000;17,1000") do not. The check also runs before
  // the append, so a single request may add all fourteen unit types at once.
  if (serialisedQueueLength(queue) > config.armyQueueSize * 4) {
    return fail('unit_queue_full')
  }

  const slot = positionOfType(town, spec.building)
  if (slot <= 0) return fail(spec.missingBuilding)
  if (slot !== position) return fail('position_mismatch')

  let needWood = 0
  let needWine = 0
  let needCrystal = 0
  let needSulfur = 0
  let needPeoples = 0
  const appended: UnitQueueEntry[] = []

  for (let unitId = spec.firstUnit; unitId <= spec.lastUnit; unitId++) {
    const count = postedCount(counts[unitId])
    const cost = unitCost(unitId, state.user.research, ctx.derived.levels)
    // Costs are summed for every unit id, but only positive counts reach the
    // queue (actions.php:191-203). A negative count therefore *credits* the
    // town with resources and free citizens and queues nothing -- the client
    // never sends one, but nothing on the server rejects it either.
    needWood += cost.wood * count
    needWine += cost.wine * count
    needCrystal += cost.crystal * count
    needSulfur += cost.sulfur * count
    needPeoples += cost.peoples * count
    if (count > 0) appended.push({ unitType: unitId, count })
  }

  // Marble and gold are deliberately not charged: no unit costs marble, and
  // the gold line is commented out in the legacy (actions.php:182) because
  // units pay their gold as upkeep instead.
  const wood = town.resources.wood - needWood
  const wine = town.resources.wine - needWine
  const crystal = town.resources.crystal - needCrystal
  const sulfur = town.resources.sulfur - needSulfur
  const peoples = town.peoples - needPeoples

  if (wood < 0 || wine < 0 || crystal < 0 || sulfur < 0 || peoples < 0) {
    return fail('not_enough_resources')
  }

  town.resources.wood = wood
  town.resources.wine = wine
  town.resources.crystal = crystal
  town.resources.sulfur = sulfur
  town.peoples = peoples
  town[spec.queueKey] = [...queue, ...appended]

  // The start time is stamped whenever it is unset -- even by a submit whose
  // counts are all zero, which queues nothing yet leaves the town with an
  // empty queue and a start in the past. The tick only rewrites the start
  // while the queue is non-empty (update_model.php:325-395), so the next real
  // batch inherits that stale timestamp and completes instantly.
  const started = town[spec.startKey]
  town[spec.startKey] = started != null && started > 0 ? started : ctx.now
  return ok()
}

/** Ids 1..22 can be disbanded; 23 (the cargo ship) lives on the user row. */
const DISBAND_UNIT_MAX = 22

/**
 * Disband garrisoned units, returning their population (actions.php:248-272).
 *
 * There is no guard of any kind: no building requirement, no cost, and the
 * returned citizens are added straight to the free population without checking
 * the town-hall cap (the next tick clamps them back down).
 */
export function armyEdit(ctx: ActionContext, counts: UnitCounts): ActionResult {
  const { state, town } = ctx
  let peoplesBack = 0

  for (let unitId = 1; unitId <= DISBAND_UNIT_MAX; unitId++) {
    const requested = postedCount(counts[unitId])
    const held = town.army[unitId] ?? 0
    const cost = unitCost(unitId, state.user.research, ctx.derived.levels)
    // `held >= requested` is the only check (actions.php:256). A negative
    // count passes it, subtracts a negative and so *mints* units, while
    // peoplesBack goes negative and drains the town's free citizens.
    if (held >= requested) {
      peoplesBack += requested * cost.peoples
      town.army[unitId] = held - requested
    }
  }

  town.peoples += peoplesBack
  return ok()
}

/**
 * Clear the naval production queue (actions.php:137-152).
 *
 * Nothing is refunded: the resources and the population were spent when the
 * batch was queued, and cancelling returns neither.
 */
export function abortShips(ctx: ActionContext): ActionResult {
  const { town } = ctx
  if (town.navalQueue.length === 0) return fail('queue_empty')
  town.navalQueue = []
  town.navalQueueStartedAt = null
  // actions.php:144 then refills the parsed *ships* cache from the *army*
  // line, so the shipyard screen renders the land queue for the rest of that
  // one request. Not reproducible here and not worth reproducing: the port has
  // no separate parsed-queue cache, and the DB write was already correct.
  return ok()
}

/** Clear the land production queue (actions.php:153-168). No refund either. */
export function abortUnits(ctx: ActionContext): ActionResult {
  const { town } = ctx
  if (town.landQueue.length === 0) return fail('queue_empty')
  town.landQueue = []
  town.landQueueStartedAt = null
  return ok()
}

/** Gold and crystal for one spy, and the gold to send one (actions.php:1620-1645). */
const SPY_BUY_GOLD = 150
const SPY_BUY_CRYSTAL = 80
const SPY_SEND_GOLD = 30

/** mission_type on the spies row: 0 idle at the target, 1 outbound, 2 returning. */
const SPY_MISSION_OUTBOUND = 1
const SPY_MISSION_RETURNING = 2

/** The target of a send, resolved by the caller -- the rules layer cannot read
 *  another player's town. `null` reproduces the legacy's missing-row case. */
export interface SpyTargetTown {
  id: number
  islandId: number
}

export type SpyOrder =
  | { action: 'buy' }
  | {
      action: 'send'
      /** 0 means "the island this town sits on" (actions.php:1632-1635). */
      islandId: number
      target: SpyTargetTown | null
      /** Placeholder id for the new row; the DB assigns the real one. */
      spyId?: number
    }
  | {
      action: 'return'
      /** The URL passes the spy id first and the from-town second, matching
       *  the parameter order ($island, $town) of the legacy method. */
      spyId: number
      fromTownId: number
    }

/**
 * Safehouse actions: train a spy, send one, recall one
 * (actions.php:1617-1658).
 */
export function spyes(ctx: ActionContext, order: SpyOrder): ActionResult {
  const { state, town } = ctx

  switch (order.action) {
    case 'buy': {
      if (state.user.gold < SPY_BUY_GOLD) return fail('not_enough_gold')
      if (town.resources.crystal < SPY_BUY_CRYSTAL) return fail('not_enough_crystal')
      if (town.spyTrainingStartedAt != null && town.spyTrainingStartedAt > 0) {
        return fail('spy_already_training')
      }
      // The safehouse level is the cap, counted against idle spies plus every
      // spy already dispatched from this town. The one in training is not
      // counted, but only one can train at a time.
      const deployed = state.spies.filter((s) => s.fromTownId === town.id).length
      const safehouse = ctx.derived.levels[BUILDING.SAFEHOUSE] ?? 0
      if (safehouse - (deployed + town.spies) <= 0) return fail('safehouse_full')

      state.user.gold -= SPY_BUY_GOLD
      town.resources.crystal -= SPY_BUY_CRYSTAL
      town.spyTrainingStartedAt = ctx.now
      return ok()
    }

    case 'send': {
      if (state.user.gold < SPY_SEND_GOLD) return fail('not_enough_gold')
      if (town.spies <= 0) return fail('no_idle_spy')

      const islandId = order.islandId === 0 ? town.islandId : order.islandId
      // The only validation is that the target town sits on the island the
      // client named (actions.php:1639). Distance, ownership and whether the
      // target is one of your own towns are all unchecked.
      if (order.target === null || order.target.islandId !== islandId) {
        return fail('spy_target_invalid')
      }

      const spy: SpyState = {
        id: order.spyId ?? 0,
        userId: state.user.id,
        fromTownId: town.id,
        toTownId: order.target.id,
        risk: 0,
        missionType: SPY_MISSION_OUTBOUND,
        startedAt: ctx.now,
        lastUpdate: ctx.now,
      }
      state.spies.push(spy)
      town.spies -= 1
      state.user.gold -= SPY_SEND_GOLD
      return ok()
    }

    case 'return': {
      const spy = state.spies.find(
        (s) => s.id === order.spyId && s.fromTownId === order.fromTownId,
      )
      // The lookup is spyes[fromTown][spyId] over every town the player owns,
      // so a spy can be recalled from any town, not only the current one.
      if (!spy) return fail('spy_not_found')
      // mission_start is reset to now whatever the spy was doing. Recalling
      // one still outbound restarts the clock, so the trip home takes the full
      // one-way time from the moment of the recall rather than the time
      // already flown; recalling a spy that is already returning does it
      // again, and can be repeated indefinitely for free.
      spy.missionType = SPY_MISSION_RETURNING
      spy.startedAt = ctx.now
      return ok()
    }
  }
}

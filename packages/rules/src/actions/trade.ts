/**
 * Trade and transport actions, ported from izariam/controllers/actions.php.
 *
 * These are the player-initiated half of the economy: posting branch-office
 * offers, sending a buy or sell fleet at somebody else's offer, running trade
 * routes, loading freighters, buying freighters, and recalling a fleet.
 *
 * The legacy Actions controller never runs the tick -- Update_Model is loaded
 * by the Game controller only (game.php:34) -- so every action below reads
 * state that is up to one request stale, then redirects to a Game URL that
 * ticks afterwards. The port inverts that: tick first, then apply the action.
 * Nothing here depends on the ordering except through `town.actionPoints`,
 * which the tick recomputes from scratch anyway (tick.ts, action points).
 */

import {
  actionPointsByLevel,
  branchCapacityByLevel,
  branchRadiusByLevel,
  transportCostByCount,
  timeByCoords,
  unitCost,
  type LevelsByType,
} from '../costs.js'
import { DEFAULT_CONFIG, type GameConfig } from '../config.js'
import { projectArrival } from '../missions.js'

// Domain state, so it lives in types.ts; re-exported here because every
// caller of branchOffice() reaches for it through this module.
export type { BranchOffer, BranchOfficeState } from '../types.js'
import {
  BUILDING,
  type ActionIntent,
  type ActionResult,
  RESOURCES,
  RESOURCE_BY_TRADE_RESOURCE,
  buildingLevel,
  emptyResources,
  levelsByType,
  type BranchOffer,
  type BranchOfficeState,
  type MissionKind,
  type MissionState,
  type PendingMessage,
  type PlayerState,
  type Resource,
  type Resources,
  type TownState,
} from '../types.js'

/**
 * Result shape shared by every action module.
 *
 * The legacy signalled failure three different ways -- an Error() page, a
 * silent re-render of the same screen, or a redirect that quietly did nothing.
 * All three collapse to `ok: false` here; `reason` carries the legacy language
 * key where one existed and a snake_case code where the failure was silent.
 */
export type { ActionResult } from '../types.js'

export interface ActionContext {
  /** Epoch seconds, the legacy `time()`. */
  now: number
  config?: GameConfig
  /**
   * Id for a newly created mission or trade route. Defaults to one past the
   * highest id already present, which is only correct for a state graph that
   * holds every row the id space can collide with -- the persistence layer
   * should pass the database sequence instead.
   */
  allocateId?: () => number
}

/** Unit 23, the cargo ship. Every fleet in the game travels at its speed. */
const CARGO_SHIP = 23

/** Ambrosia charged for each trade route after the first (actions.php:1796). */
export const AMBROSIA_PER_EXTRA_ROUTE = 10

function nextId(rows: readonly { id: number }[], ctx: ActionContext): number {
  if (ctx.allocateId) return ctx.allocateId()
  let max = 0
  for (const row of rows) if (row.id > max) max = row.id
  return max + 1
}

/** The legacy stores "unset" timestamps as 0, not NULL. */
function unset(at: number | null): boolean {
  return at == null || at === 0
}

interface MissionDraft {
  fromTownId: number
  toTownId: number
  kind: MissionKind
  loadingFromStartedAt: number
  departedAt?: number | null
  transports: number
  cargo?: Partial<Resources & { gold: number; peoples: number }>
  tradeTerms?: MissionState['tradeTerms']
}

function pushMission(state: PlayerState, ctx: ActionContext, draft: MissionDraft): MissionState {
  const mission: MissionState = {
    id: nextId(state.missions, ctx),
    userId: state.user.id,
    fromTownId: draft.fromTownId,
    toTownId: draft.toTownId,
    kind: draft.kind,
    loadingFromStartedAt: draft.loadingFromStartedAt,
    loadingToStartedAt: null,
    departedAt: draft.departedAt ?? null,
    returnStartedAt: null,
    arrivesAt: null,
    abortPercent: 0,
    transports: draft.transports,
    cargo: { ...emptyResources(), gold: 0, peoples: 0, ...draft.cargo },
    units: {},
    tradeTerms: draft.tradeTerms ?? {},
  }
  state.missions.push(mission)
  // The loading countdown on the military screen reads `arrivesAt`; stamp its
  // projection now so the wait is visible from the moment the fleet is queued.
  projectArrival(state, mission, ctx.now)
  return mission
}

// ---------------------------------------------------------------------------
// Branch office
// ---------------------------------------------------------------------------


/**
 * The branch-office columns on the towns row. Defined here rather than in
 * types.ts because no other module reads them; it belongs on TownState.
 */

export function emptyBranchOffice(): BranchOfficeState {
  return {
    searchType: 0,
    searchResource: 0,
    searchRadius: 1,
    offers: {
      wood: { direction: 1, count: 0, price: 0 },
      wine: { direction: 1, count: 0, price: 0 },
      marble: { direction: 1, count: 0, price: 0 },
      crystal: { direction: 1, count: 0, price: 0 },
      sulfur: { direction: 1, count: 0, price: 0 },
    },
  }
}

export interface BranchOfficeParams {
  /** Present when the search form was submitted. */
  search?: { type: number; resource: number; radius?: number }
  /**
   * Present when the five offer rows were submitted; the legacy requires all
   * five counts to be posted together (actions.php:294). A row whose
   * `TradeType` field is missing arrives as 0 in PHP, so the API layer must
   * default `direction` to 0, not to the stored value.
   */
  offers?: Record<Resource, { direction: number; count: number; price: number }>
}

/**
 * Search radius the branch-office dropdown offers at this level. The legacy
 * only used it to render the `<select>` (views/view/branchOffice.php:49) and
 * never checked the submitted value, so this is advisory.
 */
export function maxBranchSearchRadius(branchOfficeLevel: number): number {
  return branchRadiusByLevel(branchOfficeLevel)
}

/**
 * Write the search filters and the five buy/sell offers, settling the gold and
 * warehouse delta (actions.php:273-391).
 *
 * A sell offer reserves stock out of the warehouse; a buy offer reserves gold.
 * Rewriting an offer refunds whatever the previous one held and charges the new
 * one, which is why every path here touches both sides of the ledger.
 */
export function branchOffice(
  state: PlayerState,
  town: TownState,
  branch: BranchOfficeState,
  params: BranchOfficeParams,
  ctx: ActionContext,
): ActionResult {
  // The filters go out in their own UPDATE before the offer block runs
  // (actions.php:289-293), so they stick even when the offers below are
  // rejected. Keep the two writes in this order.
  if (params.search) {
    // `($_POST['type'] <= 1) ? floor($_POST['type']) : 0` -- anything at or
    // below 1 is kept verbatim, so a negative type is stored and then matches
    // no row in the search query.
    branch.searchType = params.search.type <= 1 ? Math.floor(params.search.type) : 0
    const resource = params.search.resource
    branch.searchResource = resource >= 1 && resource <= 4 ? Math.floor(resource) : 0
    // Stored without any clamp to maxBranchSearchRadius(): the radius is a
    // pure view-side filter (branchOffice.php:122) over an unbounded query, so
    // a submitted value larger than the dropdown offers searches the whole map.
    branch.searchRadius = Math.floor(params.search.radius ?? 0)
  }

  const offers = params.offers
  if (!offers) return { ok: true, messages: [] }

  const capacity = branchCapacityByLevel(buildingLevel(town, BUILDING.BRANCH_OFFICE))

  const counts = {} as Record<Resource, number>
  const prices = {} as Record<Resource, number>
  for (const r of RESOURCES) {
    counts[r] = Math.floor(offers[r].count)
    prices[r] = Math.floor(offers[r].price)
  }

  // Summed before the zero-normalisation below, so a sell row priced at 0 --
  // whose count is about to be discarded -- still consumes capacity and can
  // push the whole batch of sell offers over the cap (actions.php:307-312).
  let allTradeResources = 0
  for (const r of RESOURCES) {
    if (offers[r].direction === 1) allTradeResources += counts[r]
  }

  // Everything below lands in scratch copies: the legacy mutates its in-memory
  // objects freely and then simply skips the UPDATE when the totals go
  // negative (actions.php:355-361), which is a rollback by omission.
  let gold = state.user.gold
  const resources: Resources = { ...town.resources }
  const settled = {} as Record<Resource, BranchOffer>
  for (const r of RESOURCES) settled[r] = { ...branch.offers[r] }

  for (const r of RESOURCES) {
    let count = counts[r]
    let price = prices[r]
    if (count === 0) price = 0
    if (price === 0) count = 0

    const direction = offers[r].direction
    const current = settled[r]

    if (direction === 1 && allTradeResources <= capacity) {
      if (current.direction === 1) {
        // Was already on sale: return the old reservation and take the new one
        // out of the warehouse in a single step.
        resources[r] += current.count - count
      } else {
        // Was a buy offer: hand back the gold it had earmarked, then reserve
        // stock for the sell offer replacing it.
        gold += current.count * current.price
        resources[r] -= count
      }
      settled[r] = { direction: 1, count, price }
    } else if (direction === 0) {
      if (current.direction === 0) {
        gold += current.count * current.price - price * count
      } else {
        resources[r] += current.count
        gold -= price * count
      }
      settled[r] = { direction: 0, count, price }
    }
    // No other case exists. In particular a sell offer that busts the capacity
    // cap falls through both branches: the stored offer is left exactly as it
    // was and the player is told nothing.
  }

  if (gold < 0 || RESOURCES.some((r) => resources[r] < 0)) {
    return { ok: false, reason: 'branch_office_unaffordable' }
  }

  state.user.gold = gold
  for (const r of RESOURCES) {
    town.resources[r] = resources[r]
    branch.offers[r] = settled[r]
  }
  return { ok: true, messages: [] }
}

// ---------------------------------------------------------------------------
// Trading against a foreign branch office
// ---------------------------------------------------------------------------

export interface TradeParams {
  /**
   * The town whose branch office is being traded with. The legacy loads the row
   * and then never reads a field off it (actions.php:1701-1702) -- only its
   * existence gates the action, hence the separate flag.
   */
  targetTownId: number
  targetExists: boolean
  /** 1 = buy from the offer, 0 = sell into it. */
  type: number
  /** Quantities per resource. */
  counts: Partial<Record<Resource, number>>
  /** Price tolerance per unit: the most a buyer will pay, the least a seller
   *  will accept. Checked against the offer when the fleet lands. */
  prices: Partial<Record<Resource, number>>
  transporters: number
}

/** floor(), with anything at or below zero collapsing to zero. */
function floorPositive(v: number | undefined): number {
  if (v === undefined) return 0
  const f = Math.floor(v)
  return f > 0 ? f : 0
}

/**
 * Send a fleet to buy from (type 1) or sell into (type 0) a foreign branch
 * office (actions.php:1678-1765).
 */
export function trade(
  state: PlayerState,
  town: TownState,
  params: TradeParams,
  ctx: ActionContext,
): ActionResult {
  if (!(town.actionPoints > 0)) return { ok: false, reason: 'enough_action_points' }
  if (!(params.targetTownId > 0) || !params.targetExists) {
    return { ok: false, reason: 'unknown_town' }
  }

  const counts = {} as Record<Resource, number>
  const prices = {} as Record<Resource, number>
  for (const r of RESOURCES) {
    counts[r] = floorPositive(params.counts[r])
    prices[r] = floorPositive(params.prices[r])
  }

  let goldNeed = 0
  for (const r of RESOURCES) goldNeed += counts[r] * prices[r]
  goldNeed = Math.floor(goldNeed)

  // No clamp at zero, unlike the quantities above: a negative freighter count
  // *adds* ships to the pool below and stamps the mission with a negative
  // ship_transport, which aborting or completing it then refunds again.
  const transporters = Math.floor(params.transporters)
  const transports = state.user.transports - transporters

  // Both tests are strict. A player holding exactly 0 gold cannot trade at all,
  // and the last free freighter in the pool can never be committed -- you need
  // one to spare (actions.php:1704).
  if (!(state.user.gold > 0 && transports > 0)) {
    return { ok: false, reason: 'not_enough_transports' }
  }

  // Note what is missing: trade() never checks
  // `transporters * transportCapacity >= total`, the way transport() does. One
  // freighter will haul any quantity the branch office is willing to sell.

  if (params.type === 1) {
    const gold = state.user.gold - goldNeed
    // Strictly greater again: spending down to exactly 0 buys nothing.
    if (!(gold > 0)) return { ok: false, reason: 'not_enough_gold' }

    state.user.gold = gold
    state.user.transports = transports

    const tradeTerms: MissionState['tradeTerms'] = {}
    for (const r of RESOURCES) tradeTerms[r] = { count: counts[r], price: prices[r] }

    // departedAt == loadingFromStartedAt is deliberate, not a copy-paste slip:
    // mission_data.php:25 reads the two being equal as "loading happens at the
    // far end", which is what a buy run does. A buy fleet therefore skips the
    // home-port loading phase every other mission type waits through.
    pushMission(state, ctx, {
      fromTownId: town.id,
      toTownId: params.targetTownId,
      kind: 'buy',
      loadingFromStartedAt: ctx.now,
      departedAt: ctx.now,
      transports: transporters,
      cargo: { gold: goldNeed },
      tradeTerms,
    })

    town.actionPoints -= 1
    return { ok: true, messages: [] }
  }

  if (params.type === 0) {
    const after = {} as Record<Resource, number>
    for (const r of RESOURCES) after[r] = town.resources[r] - counts[r]
    if (RESOURCES.some((r) => after[r] < 0)) {
      return { ok: false, reason: 'not_enough_resources' }
    }

    state.user.transports = transports

    // A sell run carries the goods in the cargo columns and keeps only the
    // price in the trade terms; trade_*_count stays 0 on the row.
    const tradeTerms: MissionState['tradeTerms'] = {}
    for (const r of RESOURCES) tradeTerms[r] = { count: 0, price: prices[r] }

    pushMission(state, ctx, {
      fromTownId: town.id,
      toTownId: params.targetTownId,
      kind: 'sell',
      loadingFromStartedAt: ctx.now,
      transports: transporters,
      cargo: counts,
      tradeTerms,
    })

    for (const r of RESOURCES) town.resources[r] = after[r]

    // The action point is *not* spent. actions.php:1745 assigns the decrement
    // to `$this->Player_Model->now_town->aactions` -- a property that exists
    // nowhere else -- and the UPDATE two lines later writes back the unchanged
    // `actions`. Selling is free; buying costs a point.
    return { ok: true, messages: [] }
  }

  return { ok: false, reason: 'unknown_trade_type' }
}

// ---------------------------------------------------------------------------
// Trade routes
// ---------------------------------------------------------------------------

export interface TradeRouteParams {
  /** Non-zero deletes that route and ignores everything else. */
  deleteId?: number
  fromTownId?: number
  toTownId?: number
  /** 0..4, indexing RESOURCE_BY_TRADE_RESOURCE. */
  tradegood?: number
  /** Hour of the day the route fires, 0..24. */
  hour?: number
  count?: number
  /** The `save` field: edit `routeId` instead of creating a route. */
  save?: boolean
  routeId?: number
  /**
   * Seconds to add to UTC to reach the wall clock route_time() resolved the
   * hour against. Nothing in the legacy config sets a timezone, so this was
   * whatever the deployment's PHP defaulted to.
   */
  timezoneOffset?: number
}

const SECONDS_PER_DAY = 86400

/**
 * The next occurrence of `hour:00:00` local time at or after `now`, ported from
 * route_time() (izariam/helpers/izariam_helper.php:133-141).
 *
 * The legacy built this out of date()/mktime() against the server's timezone;
 * the offset is a parameter here so the rules stay free of the process clock.
 * Fixed-offset arithmetic diverges from mktime() across a DST boundary, where
 * PHP would land on the same wall-clock hour and this lands an hour off.
 */
export function routeTime(now: number, hour: number, timezoneOffset = 0): number {
  const local = now + timezoneOffset
  const midnight = Math.floor(local / SECONDS_PER_DAY) * SECONDS_PER_DAY
  let at = midnight + hour * 3600
  if (at < local) at += SECONDS_PER_DAY
  return at - timezoneOffset
}

/**
 * Create, edit or delete a trade route (actions.php:1766-1828).
 *
 * The first route is free and every later one costs 10 ambrosia. Editing an
 * existing route is always free, so the cheap way to move a route is to edit
 * one rather than delete and recreate it.
 */
export function tradeRoute(
  state: PlayerState,
  params: TradeRouteParams,
  ctx: ActionContext,
): ActionResult {
  const deleteId = Math.floor(params.deleteId ?? 0)
  if (deleteId > 0) {
    // Load_Trade_Routes only ever loads the caller's own rows
    // (data_model.php:89-97), so the isset() lookup doubles as the ownership
    // check.
    const index = state.tradeRoutes.findIndex((r) => r.id === deleteId)
    if (index < 0) return { ok: false, reason: 'unknown_trade_route' }
    state.tradeRoutes.splice(index, 1)
    return { ok: true, messages: [] }
  }

  // Tested against the raw values, before the floor below (actions.php:1780).
  const rawFrom = params.fromTownId ?? 0
  const rawTo = params.toTownId ?? 0
  if (!(rawFrom > 0 && rawTo > 0 && rawFrom !== rawTo)) {
    return { ok: false, reason: 'select_city' }
  }

  const from = Math.floor(rawFrom)
  const to = Math.floor(rawTo)
  const tradegood = Math.floor(params.tradegood ?? 0)
  const hour = Math.floor(params.hour ?? 0)
  const count = Math.floor(params.count ?? 0)
  const nextRunAt = routeTime(ctx.now, hour, params.timezoneOffset ?? 0)

  // `hour <= 24` admits 24, which route_time() resolves to the following
  // midnight rather than rejecting.
  if (
    !(
      from > 0 &&
      to > 0 &&
      tradegood >= 0 &&
      tradegood <= 4 &&
      hour >= 0 &&
      hour <= 24 &&
      count > 0
    )
  ) {
    return { ok: false, reason: 'invalid_trade_route' }
  }

  const resource = RESOURCE_BY_TRADE_RESOURCE[tradegood] ?? 'wood'

  if (params.save) {
    const routeId = Math.floor(params.routeId ?? 0)
    const route = state.tradeRoutes.find((r) => r.id === routeId)
    if (!route) return { ok: false, reason: 'unknown_trade_route' }
    route.fromTownId = from
    route.toTownId = to
    route.nextRunAt = nextRunAt
    route.resource = resource
    route.sendTime = hour
    route.sendCount = count
    return { ok: true, messages: [] }
  }

  if (state.tradeRoutes.length > 0) {
    if (state.user.ambrosia < AMBROSIA_PER_EXTRA_ROUTE) {
      return { ok: false, reason: 'not_enough_ambrosia' }
    }
    state.user.ambrosia -= AMBROSIA_PER_EXTRA_ROUTE
  }

  // Neither endpoint is checked for ownership. Update_Trade_Routes then indexes
  // the player's own town map with `route.from` (update_model.php:997), so a
  // route from somebody else's town is inert rather than exploitable.
  state.tradeRoutes.push({
    id: nextId(state.tradeRoutes, ctx),
    userId: state.user.id,
    fromTownId: from,
    toTownId: to,
    nextRunAt,
    resource,
    sendCount: count,
    sendTime: hour,
  })
  return { ok: true, messages: [] }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface TransportParams {
  /**
   * The destination island. The legacy loads it and discards the result
   * (actions.php:1836-1838), never checking that the target town sits on it --
   * contrast spyes(), which does check. Only `> 0` matters.
   */
  islandId: number
  targetTownId: number
  targetExists: boolean
  cargo: Partial<Record<Resource, number>>
  transporters: number
}

/**
 * Load freight and send it to another town (actions.php:1829-1897).
 */
export function transport(
  state: PlayerState,
  town: TownState,
  params: TransportParams,
  ctx: ActionContext,
): ActionResult {
  const config = ctx.config ?? DEFAULT_CONFIG
  if (!(town.actionPoints > 0)) return { ok: false, reason: 'enough_action_points' }

  const islandId = Math.floor(params.islandId)
  const targetTownId = Math.floor(params.targetTownId)
  if (!(islandId > 0 && targetTownId >= 0)) return { ok: false, reason: 'no_target' }

  // Taken verbatim from the request. Unlike trade() there is no floor and no
  // clamp at zero, so a negative quantity is subtracted from the warehouse as a
  // credit and rides the mission as negative freight.
  const cargo: Resources = { ...emptyResources() }
  for (const r of RESOURCES) cargo[r] = params.cargo[r] ?? 0

  const after = {} as Record<Resource, number>
  for (const r of RESOURCES) after[r] = town.resources[r] - cargo[r]

  const transporters = params.transporters
  const transports = state.user.transports - transporters
  let total = 0
  for (const r of RESOURCES) total += cargo[r]

  const allowed =
    params.targetExists &&
    state.user.transports >= transporters &&
    transporters !== 0 &&
    after.wood >= 0 &&
    after.wine >= 0 &&
    // Marble is absent from the legacy's guard list (actions.php:1854): wood,
    // wine, crystal and sulfur are checked, marble is not. Shipping more marble
    // than the town holds drives its warehouse negative.
    after.crystal >= 0 &&
    after.sulfur >= 0 &&
    transports >= 0 &&
    transporters * config.transportCapacity >= total &&
    total !== 0

  if (!allowed) return { ok: false, reason: 'trade_fleet_no_freight' }

  for (const r of RESOURCES) town.resources[r] = after[r]
  town.actionPoints -= 1
  state.user.transports = transports

  pushMission(state, ctx, {
    fromTownId: town.id,
    toTownId: targetTownId,
    kind: 'transport',
    loadingFromStartedAt: ctx.now,
    transports: transporters,
    cargo,
  })

  return { ok: true, messages: [] }
}

/**
 * Freighters already committed to the player's own missions still count toward
 * the price ladder (player_model.php:233), so the next ship keeps getting more
 * expensive while a fleet is out.
 */
export function totalTransports(state: PlayerState): number {
  let total = state.user.transports
  for (const mission of state.missions) {
    if (mission.userId === state.user.id) total += mission.transports
  }
  return total
}

/**
 * Buy one cargo ship (actions.php:1898-1919).
 */
export function transporter(state: PlayerState, ctx: ActionContext): ActionResult {
  const config = ctx.config ?? DEFAULT_CONFIG
  const cost = transportCostByCount(totalTransports(state), config.quirks)

  // The `cost > 0` guard turns the end of the price ladder into a wall rather
  // than a giveaway: from the 160th ship on transportCostByCount() returns 0
  // (config.quirks.freeTransportsPast160) and no further ship can be bought.
  if (!(cost > 0 && state.user.gold >= cost)) return { ok: false, reason: 'not_enough_gold' }

  state.user.gold -= cost
  state.user.scores.transports = (state.user.scores.transports ?? 0) + cost / 100
  state.user.transports += 1
  return { ok: true, messages: [] }
}

// ---------------------------------------------------------------------------
// Aborting a fleet
// ---------------------------------------------------------------------------

export interface AbortFleetParams {
  missionId: number
  /**
   * Island coordinates of both endpoints, needed only for a fleet already in
   * flight. The legacy reads them out of Data_Model's cache, which holds
   * foreign towns too (actions.php:113-116); PlayerState reaches only the
   * caller's own islands, so a mission to another player's town must supply
   * them.
   */
  route?: { fromX: number; fromY: number; toX: number; toY: number }
}

function townLevels(state: PlayerState, townId: number | null): LevelsByType {
  if (townId == null) return {}
  const town = state.towns.find((t) => t.id === townId)
  return town ? levelsByType(town) : {}
}

function islandOf(state: PlayerState, townId: number | null) {
  if (townId == null) return undefined
  const town = state.towns.find((t) => t.id === townId)
  return town ? state.islands[town.islandId] : undefined
}

/**
 * Recall a fleet (actions.php:79-136).
 *
 * A fleet still loading in its home port is unwound completely: the mission
 * row goes away and everything it holds is handed back. A fleet already at sea
 * is turned around, and the fraction of the outbound leg it has flown becomes
 * the length of the trip home.
 *
 * There is no ownership check anywhere in this function. Player_Model->missions
 * holds every mission whose `to` *or* `from` is one of the caller's towns
 * (data_model.php:71-86), so an incoming fleet belonging to somebody else can
 * be aborted by its target -- see the note on the refund below.
 */
export function abortFleet(
  state: PlayerState,
  params: AbortFleetParams,
  ctx: ActionContext,
): ActionResult {
  const index = state.missions.findIndex((m) => m.id === params.missionId)
  if (index < 0) return { ok: false, reason: 'unknown_mission' }
  const mission = state.missions[index]!

  if (unset(mission.departedAt)) {
    // Still loading. A colonisation fleet also takes its unbuilt destination
    // town with it and frees the island slot it had claimed.
    const intents: ActionIntent[] = []
    if (mission.kind === 'colonise' && mission.toTownId != null) {
      const colonyIndex = state.towns.findIndex((t) => t.id === mission.toTownId)
      if (colonyIndex >= 0) {
        const colony = state.towns[colonyIndex]!
        const island = state.islands[colony.islandId]
        // Free the slot unconditionally. The legacy issued
        // `UPDATE islands SET city{position} = 0` with nothing to guard
        // (actions.php:90-95); gating on an optional in-memory map meant a loader
        // that skipped it left the town deleted and the slot still occupied.
        if (island) {
          island.slots ??= {}
          delete island.slots[colony.slot]
        }
        state.towns.splice(colonyIndex, 1)
        // The splice alone is in-memory: without this intent the persist step
        // never deletes the row, the slot stays claimed in the towns table it
        // is derived from, and the island board keeps painting the founding
        // placeholder forever.
        intents.push({ kind: 'deleteTown', townId: colony.id })
      }
    }

    // The refund sits outside the colonisation branch despite its indentation
    // (actions.php:91-105): every un-launched mission is unwound this way.
    //
    // It also reads `towns[mission.from]` out of the *caller's* town map. When
    // the mission belongs to another player that lookup is undefined, and PHP
    // resolves `null->wood + $mission->wood` to the cargo figure alone -- the
    // UPDATE then overwrites the foreign origin town's warehouse with it. That
    // cross-player write cannot be expressed against a single-player
    // PlayerState, so the port skips the resource refund when the origin is not
    // the caller's; the gold and freighters below still land on the caller.
    const origin = state.towns.find((t) => t.id === mission.fromTownId)
    if (origin) {
      for (const r of RESOURCES) origin.resources[r] += mission.cargo[r]
      origin.peoples += mission.cargo.peoples
    }
    state.user.gold += mission.cargo.gold
    state.user.transports += mission.transports
    state.missions.splice(index, 1)
    return intents.length > 0 ? { ok: true, messages: [], intents } : { ok: true, messages: [] }
  }

  if (!unset(mission.returnStartedAt)) return { ok: false, reason: 'fleet_already_returning' }

  const fromIsland = islandOf(state, mission.fromTownId)
  const toIsland = islandOf(state, mission.toTownId)
  const route =
    params.route ??
    (fromIsland && toIsland
      ? { fromX: fromIsland.x, fromY: fromIsland.y, toX: toIsland.x, toY: toIsland.y }
      : undefined)
  if (!route) return { ok: false, reason: 'unknown_route' }

  // Priced against whatever town the player currently has selected rather than
  // the mission's origin (actions.php:110). Harmless: unit 23 has no build-time
  // reduction and no research discount touching `speed`, so no town's levels
  // can change the answer.
  const levels = townLevels(state, state.user.currentTownId)
  const speed = unitCost(CARGO_SHIP, state.user.research, levels).speed
  const time = timeByCoords(route.fromX, route.toX, route.fromY, route.toY, speed)

  const elapsed = ctx.now - mission.departedAt!
  // `1 - (time - elapsed) / time`, i.e. the share of the outbound leg already
  // flown; mission_data.php:72 multiplies the one-way time by it to size the
  // return. Two edges survive: a fleet aborted in its first second gets a
  // percent of 0, which mission_data.php:70 rewrites to 1 and so charges a full
  // trip home, and a fleet whose arrival the tick has not caught up with yet
  // has elapsed > time and comes home slower than it went out.
  mission.abortPercent = 1 - (time - elapsed) / time
  mission.returnStartedAt = ctx.now
  return { ok: true, messages: [] }
}

/**
 * Action points the town hall grants before in-flight fleets are deducted.
 *
 * The decrements in trade() and transport() are cosmetic: the next tick
 * overwrites `actionPoints` with `actionPointsByLevel(pos0) - fleets`
 * (update_model.php:304), and the fleet the action just created is what
 * actually holds the point.
 */
export function maxActionPoints(town: TownState): number {
  return actionPointsByLevel(town.buildings.bySlot[0]?.level ?? 0)
}

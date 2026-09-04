/**
 * Fleets, ported from Update_Model::Update_Missions
 * (izariam/models/update_model.php:507-968) with mission_data.php folded in at
 * the point the legacy `include`d it (:514). That include sits *inside* the
 * mission loop and runs in the caller's scope, so every variable it computes
 * ($time, $loading_time, $loading_end, $return_end) is read by the branches
 * below; `missionTiming` is that file.
 *
 * Four kinds share one loop -- colonise (1), transport (2), buy (3), sell (4)
 * -- and none of them has a status column. The phase is read off four stamps:
 *
 *   loadingFromStartedAt  the home quay was claimed at this instant
 *   departedAt            0 until the hold is full, then the sailing instant
 *   loadingToStartedAt    the far quay was claimed
 *   returnStartedAt       0 until the fleet turns for home
 *
 * Everything else -- when the fleet lands, when it finishes loading, when it
 * gets home -- is recomputed from those four and the current distance on every
 * tick, which is why an offline player's fleets all resolve in one pass.
 *
 * Update_Missions runs twice per request (update_model.php:35 and :37) with
 * Update_Trade_Routes between them, and tickPlayer keeps that. The legacy's two
 * passes were not idempotent: several branches wrote a field to the missions
 * table without touching the in-memory row, so the second pass re-read a stale
 * 0 and re-executed. This port has a single copy of each row, so those branches
 * settle on the first pass; the two that change the outcome rather than just
 * the timing are called out at their sites and reported.
 */

import { speedByPortLevel, timeByCoords, unitCost, type LevelsByType } from './costs.js'
import { miracleBonus } from './temple.js'
import {
  BUILDING,
  RESOURCES,
  type IslandState,
  type MissionState,
  type PendingMessage,
  type PlayerState,
  type Resource,
  type Resources,
  type ResearchState,
  type TownBuildings,
} from './types.js'
import type { BranchOffer, BranchOfficeState } from './actions/trade.js'

/** Unit 23. Every fleet in the game moves at the cargo ship's speed. */
const CARGO_SHIP = 23

/**
 * mission_data.php:67 seeds the remaining return time with a sentinel instead
 * of a flag, so an outbound fleet is "arriving home in 68 years".
 */
const NEVER_RETURNS = 2147483647

/**
 * Wood the town hall swallows when a colony is founded
 * (update_model.php:673). The launch screen charged 1250 (actions.php:652), so
 * 250 of it is burned on the quay and never appears anywhere.
 */
const COLONY_FOUNDING_WOOD = 1000

/**
 * The branch-office columns the mission loop reads off the destination town,
 * with the values the schema hands a town that has never opened an office
 * (beta.sql:592-606): every resource marked as *for sale*, at price 0, with
 * nothing in stock. That default matters -- it is why a sell fleet sent to a
 * town without a branch office can never unload (see runBranchSale).
 */
const DEFAULT_OFFER: BranchOffer = { direction: 1, count: 0, price: 0 }

/**
 * A town a mission can point at, own or foreign.
 *
 * TownState satisfies this structurally, so the player's own towns go in as
 * they are and the writes below land on the same objects the rest of the tick
 * is holding. Foreign towns come from a projection the API layer loads: the
 * legacy pulled both endpoints, both owners and both islands for every mission
 * (player_model.php:241-246), and this module needs exactly that much.
 */
export interface MissionTown {
  id: number
  userId: number
  islandId: number
  /** Island slot, cleared when a colonisation is abandoned. */
  slot: number
  lastUpdate: number
  peoples: number
  resources: Resources
  buildings: TownBuildings
  /** Absent is read as DEFAULT_OFFER on all five resources. Named to match
   *  TownState so a player's own town satisfies MissionTown as-is. */
  branchOffice?: BranchOfficeState
}

/** Enough of a user row to settle a trade. UserState satisfies it. */
export interface MissionUser {
  id: number
  gold: number
  transports: number
}

/**
 * Everything outside the ticking player's own graph that the mission loop
 * touches. Own towns and the own user MUST be the same objects that appear in
 * `state`, or half the writes go to a copy.
 */
export interface MissionWorld {
  towns: Record<number, MissionTown>
  users: Record<number, MissionUser>
  islands: Record<number, IslandState>
  /** Towns whose row the caller must delete: abandoned colonisations. */
  removedTownIds: number[]
}

/**
 * The world a solo tick needs: the player's own towns, islands and user.
 *
 * Enough for colonisation and for transports between the player's own towns.
 * A mission pointing at a town this world does not hold is skipped, so the API
 * layer must build the full world for trade.
 */
export function defaultMissionWorld(state: PlayerState): MissionWorld {
  const towns: Record<number, MissionTown> = {}
  for (const town of state.towns) towns[town.id] = town
  return {
    towns,
    users: { [state.user.id]: state.user },
    islands: state.islands,
    removedTownIds: [],
  }
}

/** The legacy stores 0 for "has not happened yet"; the port stores null. */
function ts(value: number | null): number {
  return value ?? 0
}

function offerFor(town: MissionTown, resource: Resource): BranchOffer {
  return town.branchOffice?.offers[resource] ?? DEFAULT_OFFER
}

/**
 * Port level as mission_data.php:29-38 reads it.
 *
 * get_position() (data_model.php:1037) scans pos0..pos14 and returns the *last*
 * slot holding the type, and mission_data then honours only slots 1 and 2. A
 * port anywhere else loads at the level-0 rate of 10 units a minute, which is
 * the slowest quay in the game.
 */
function portLevel(town: MissionTown): number {
  let position = 0
  for (let slot = 0; slot <= 14; slot++) {
    if (town.buildings.bySlot[slot]?.type === BUILDING.PORT) position = slot
  }
  if (position !== 1 && position !== 2) return 0
  return town.buildings.bySlot[position]?.level ?? 0
}

/**
 * Building levels of the player's *currently selected* town, which is what
 * mission_data.php:9 passes to army_cost_by_type -- not the levels of the town
 * the fleet sailed from. It makes no difference today: only `speed` is read out
 * of the result, and no research or building touches it. Kept faithful so that
 * changing the cargo ship's stats changes the same thing it changed in 2012.
 */
function currentTownLevels(state: PlayerState): LevelsByType {
  const town = state.towns.find((t) => t.id === state.user.currentTownId)
  if (!town) return {}
  const levels: LevelsByType = {}
  for (let slot = 0; slot <= 14; slot++) {
    const building = town.buildings.bySlot[slot]
    if (building) levels[building.type] = building.level
  }
  return levels
}

export interface MissionTiming {
  /** Seconds for one leg at cargo-ship speed. */
  travelTime: number
  /** Seconds of loading or unloading at whichever quay is in play. */
  loadingTime: number
  /** Seconds of the outbound leg still to run; negative once it has landed. */
  missionEnd: number
  /** Seconds until the hold is dealt with; <= 0 means done. */
  loadingEnd: number
  /** Seconds until the fleet is home, NEVER_RETURNS while still outbound. */
  returnEnd: number
  /** Which town's quay set loadingTime. */
  portTownId: number
  portLevel: number
  /** Cargo units crossing the quay -- gold rides free, settlers do not. */
  cargoUnits: number
}

/**
 * mission_data.php in full.
 *
 * The one subtle line is the quay choice at :26. `loading_from_start ==
 * mission_start` holds for a fleet that sailed the instant it was queued, i.e.
 * one with nothing to load -- a buy order (actions.php:1716 stamps both with
 * the same time()) -- and for a row with neither stamp set. For anything else
 * the two differ by the home
 * loading time, so the *origin* quay sets the rate for both ends of the trip
 * and a buy order loads at the far end instead. It reads like an accident and
 * behaves like a design.
 *
 * Undefined when either endpoint's island is missing, where the legacy fatalled.
 */
export interface MissionBoosts {
  /** Poseidon: fraction faster at sea. */
  travel: number
  /** Hermes: fraction faster across the quay. */
  loading: number
}

const NO_BOOSTS: MissionBoosts = { travel: 0, loading: 0 }

export function missionTiming(
  mission: MissionState,
  from: MissionTown,
  to: MissionTown,
  islands: Record<number, IslandState>,
  research: ResearchState,
  levels: LevelsByType,
  now: number,
  boosts: MissionBoosts = NO_BOOSTS,
): MissionTiming | undefined {
  const fromIsland = islands[from.islandId]
  const toIsland = islands[to.islandId]
  if (!fromIsland || !toIsland) return undefined

  const cargoUnits =
    mission.cargo.wood +
    mission.cargo.marble +
    mission.cargo.wine +
    mission.cargo.crystal +
    mission.cargo.sulfur +
    mission.cargo.peoples

  const speed = unitCost(CARGO_SHIP, research, levels).speed
  // Poseidon and Hermes, when the player has called them (temple.ts). Both are
  // applied where the number is computed rather than stored on the mission, so
  // a fleet already at sea speeds up while the miracle runs and slows down
  // again when it lapses -- the same way every other timer in the port is
  // recomputed from its start stamp rather than frozen.
  const travelTime =
    timeByCoords(fromIsland.x, toIsland.x, fromIsland.y, toIsland.y, speed) / (1 + boosts.travel)
  const missionEnd = travelTime - (now - ts(mission.departedAt))

  const quay = ts(mission.loadingFromStartedAt) === ts(mission.departedAt) ? to : from
  const level = portLevel(quay)
  const loadingTime = cargoUnits / (speedByPortLevel(level) / 60) / (1 + boosts.loading)

  let returnEnd = NEVER_RETURNS
  if (ts(mission.returnStartedAt) > 0) {
    // mission_data.php:70 rewrites a zero percentage as a full-length return.
    // Only an abort issued in the same second as the launch can produce one.
    const percent = mission.abortPercent === 0 ? 1 : mission.abortPercent
    const remaining = travelTime * percent - (now - ts(mission.returnStartedAt))
    returnEnd = remaining >= 0 ? remaining : 0
  }

  return {
    travelTime,
    loadingTime,
    missionEnd,
    loadingEnd: missionEnd + loadingTime,
    returnEnd,
    portTownId: quay.id,
    portLevel: level,
    cargoUnits,
  }
}

/**
 * Advance every fleet the player can see to `now`.
 *
 * Shaped to satisfy TickHooks.missions; the world is an optional fourth
 * argument the API layer closes over. Missions belonging to other players are
 * in the list too -- Load_Missions selects on `to` as well as `from`
 * (data_model.php:79) -- and are resolved by whichever player ticks first.
 */
export function tickMissions(
  state: PlayerState,
  now: number,
  messages: PendingMessage[],
  world: MissionWorld = defaultMissionWorld(state),
): void {
  // Load_Missions orders by loading_from_start and the quay chain below depends
  // on it: whoever queued first loads first. Ties break on id so that a tick is
  // reproducible where MyISAM's row order was not.
  const ordered = [...state.missions].sort(
    (a, b) => ts(a.loadingFromStartedAt) - ts(b.loadingFromStartedAt) || a.id - b.id,
  )

  const levels = currentTownLevels(state)
  const own: MissionBoosts = {
    travel: miracleBonus(state, 'travel', now),
    loading: miracleBonus(state, 'loading', now),
  }
  const finished = new Set<number>()
  let nextLoading = 0

  for (const mission of ordered) {
    const from = world.towns[mission.fromTownId]
    const to = mission.toTownId == null ? undefined : world.towns[mission.toTownId]
    // The legacy dereferenced both without a guard and fatalled if either row
    // was missing. A mission the caller did not load the endpoints for is left
    // untouched instead.
    if (!from || !to) continue

    // A miracle belongs to the player who called it: a foreign fleet in the
    // same list keeps its own speed.
    const timing = missionTiming(
      mission,
      from,
      to,
      world.islands,
      state.user.research,
      levels,
      now,
      mission.userId === state.user.id ? own : NO_BOOSTS,
    )
    if (!timing) continue

    if (ts(mission.departedAt) === 0) {
      // Somebody else's fleet loading in their own port. Their tick starts it
      // (update_model.php:517), and it does not occupy our quay.
      if (mission.userId === state.user.id) {
        nextLoading = runPortLoading(mission, timing, now, nextLoading)
      }
      continue
    }

    if (ts(mission.returnStartedAt) === 0) {
      if (runOutbound(state, mission, from, to, timing, world, messages)) {
        finished.add(mission.id)
      }
      continue
    }

    // update_model.php:903. The second clause is dead weight: loading_end is a
    // float that only lands exactly on 0 in the buy-nothing branch, which
    // cannot be reached with a return already under way.
    if (timing.returnEnd <= 0 || (timing.loadingEnd === 0 && to.userId === mission.userId)) {
      comeHome(state, mission, from, to, timing, world, messages)
      finished.add(mission.id)
    }
  }

  if (finished.size > 0) {
    state.missions = state.missions.filter((m) => !finished.has(m.id))
  }
}

/**
 * Loading in the home port (update_model.php:517-538).
 *
 * The town has one quay: `next_loading` carries the instant it frees up from
 * one mission to the next, and a fleet that queued earlier than that has its
 * own start pushed back. Returns the new watermark.
 */
function runPortLoading(
  mission: MissionState,
  timing: MissionTiming,
  now: number,
  nextLoading: number,
): number {
  if (nextLoading > 0 && ts(mission.loadingFromStartedAt) < nextLoading) {
    // Written straight onto the row. The legacy persisted this only when the
    // push-back happened to leave the fleet already loaded (:533) but mutated
    // the in-memory copy either way, and the in-memory copy is what the second
    // pass reads -- so keeping it is the closer match. The two diverge only if
    // the fleet in front is cancelled before the next request, which would let
    // the legacy pull this one's start back to where it began.
    mission.loadingFromStartedAt = nextLoading
  }

  const start = ts(mission.loadingFromStartedAt)
  if (now - start - timing.loadingTime >= 0) {
    // Only the first fleet in the queue may sail this pass: past the first,
    // next_loading is non-zero and the departure stamp is simply not written
    // (update_model.php:528). The one behind it leaves on the second
    // Update_Missions pass (update_model.php:37), when the leader has dropped
    // out of this branch and the watermark starts from 0 again -- so a request
    // releases exactly two fleets, however long the queue has been standing.
    if (nextLoading === 0) {
      mission.departedAt = start + timing.loadingTime
      // No legacy column: the row carries only the start stamps and every
      // screen recomputes the arrival. Maintained here as "when the fleet next
      // makes port", which is all any caller wants from it.
      mission.arrivesAt = mission.departedAt + timing.travelTime
    }
  } else {
    // Still on the quay: the next observable event is the departure, so the
    // column follows its projection. Recomputed every pass, which also keeps
    // it truthful after a queue push-back moved the start.
    mission.arrivesAt = start + timing.loadingTime
  }

  // Advanced even when this fleet is still loading, which is what serialises
  // the queue rather than letting everything load at once.
  return start + timing.loadingTime
}

/**
 * Stamp a freshly created mission's `arrivesAt` with its next event, so the
 * countdown exists from the instant the launch screen builds the fleet rather
 * than from the first tick after it: for a fleet still on the quay that is the
 * projected departure, for a buy run that skips home loading (it is created
 * already sailing) the far port. A no-op when the endpoints cannot be
 * resolved -- the next tick fills the column either way.
 */
export function projectArrival(state: PlayerState, mission: MissionState, now: number): void {
  const world = defaultMissionWorld(state)
  const from = world.towns[mission.fromTownId]
  const to = mission.toTownId == null ? undefined : world.towns[mission.toTownId]
  if (!from || !to) return
  const timing = missionTiming(
    mission,
    from,
    to,
    world.islands,
    state.user.research,
    currentTownLevels(state),
    now,
  )
  if (!timing) return
  mission.arrivesAt =
    ts(mission.departedAt) > 0
      ? ts(mission.departedAt) + timing.travelTime
      : ts(mission.loadingFromStartedAt) + timing.loadingTime
}

/**
 * The outbound half: arrive, trade, unload (update_model.php:542-899).
 * Returns true when the mission row is spent.
 */
function runOutbound(
  state: PlayerState,
  mission: MissionState,
  from: MissionTown,
  to: MissionTown,
  timing: MissionTiming,
  world: MissionWorld,
  messages: PendingMessage[],
): boolean {
  const arrival = ts(mission.departedAt) + timing.travelTime
  // Locals, because two branches below diverge from the row on purpose.
  let loadingEnd = timing.loadingEnd
  let loadingTo = ts(mission.loadingToStartedAt)

  if (loadingTo === 0) {
    if (mission.kind === 'colonise' || mission.kind === 'transport' || mission.kind === 'sell') {
      // Stamped whether or not the fleet has actually landed yet, and never
      // persisted -- update_model.php:549 has no UPDATE behind it. Harmless:
      // the same instant is recomputed on every tick.
      loadingTo = arrival
      mission.loadingToStartedAt = arrival
      // The unload ahead is the fleet's next observable event -- the colony is
      // founded, the goods delivered, at arrival + loadingTime -- so the
      // "next makes port" column follows it. Left alone it kept the arrival
      // instant and every countdown built on it sat at 00:00:00 for the whole
      // unload, which read as "the fleet arrived and nothing happened".
      mission.arrivesAt = arrival + timing.loadingTime
    } else if (mission.kind === 'buy' && timing.missionEnd <= 0) {
      const spent = runBranchPurchase(state, mission, to, arrival, world, messages)
      if (spent > 0) {
        mission.loadingToStartedAt = arrival
        mission.arrivesAt = arrival + timing.loadingTime
        // `loadingTo` deliberately left at 0, mirroring update_model.php:623:
        // the row was written, the in-memory copy was not, so the unload block
        // below waits for the next tick. That deferral is load-bearing --
        // `timing` above was measured against an empty hold, and skipping it
        // would send the fleet home without ever loading what it just bought.
      } else {
        // Nothing matched, so there is nothing to load and the fleet turns
        // round immediately (update_model.php:661-662).
        loadingTo = arrival
        mission.loadingToStartedAt = arrival
        loadingEnd = 0
        messages.push({
          channel: 'town',
          userId: mission.userId,
          townId: mission.fromTownId,
          kind: 'mission_buy_empty',
          params: {
            missionId: mission.id,
            fromTownId: mission.fromTownId,
            toTownId: to.id,
            at: arrival,
          },
        })
      }
    }
    // Attack and plunder missions fall through: Update_Missions has no branch
    // for them, so they load, sail, and then sit at the destination forever.
  }

  if (!(loadingTo > 0 && loadingEnd <= 0)) return false

  switch (mission.kind) {
    case 'colonise':
      return foundColony(state, mission, to, timing, arrival, messages)
    case 'transport':
      return deliverTransport(state, mission, to, timing, arrival, messages)
    case 'buy':
      if (ts(mission.returnStartedAt) === 0) {
        turnForHome(mission, timing, arrival)
      }
      return false
    case 'sell':
      runBranchSale(mission, to, timing, arrival, messages)
      return false
    default:
      return false
  }
}

/** Set the three stamps every "leaving now" branch writes together. */
function turnForHome(mission: MissionState, timing: MissionTiming, arrival: number): void {
  const departure = arrival + timing.loadingTime
  mission.returnStartedAt = departure
  mission.loadingToStartedAt = departure
  mission.abortPercent = 1
  mission.arrivesAt = departure + timing.travelTime
}

/**
 * Colonisation lands (update_model.php:668-707).
 *
 * The town row already exists -- the launch screen inserted it with
 * pos0_level 0 (actions.php:618), which is exactly what keeps it out of
 * Load_Player and so out of the economy until now.
 */
function foundColony(
  state: PlayerState,
  mission: MissionState,
  to: MissionTown,
  timing: MissionTiming,
  arrival: number,
  messages: PendingMessage[],
): boolean {
  // pos0_type was never written, at launch or here -- the town hall comes from
  // the column's default of 1.
  to.buildings.bySlot[0] = { type: BUILDING.TOWN_HALL, level: 1 }

  // Absolute writes, not credits: whatever the fresh row held (the schema
  // starts a town on 500 wood) is replaced by the hold.
  to.resources.wood = mission.cargo.wood - COLONY_FOUNDING_WOOD
  to.resources.wine = mission.cargo.wine
  to.resources.marble = mission.cargo.marble
  to.resources.crystal = mission.cargo.crystal
  to.resources.sulfur = mission.cargo.sulfur
  // The 40 settlers and the 9000 gold the launch charged (actions.php:652) are
  // dropped here: nothing writes peoples or gold on the new town. The colony
  // gets 40 citizens anyway, from the column's default -- so the settlers
  // "arrive" whether or not the fleet ever does.
  to.lastUpdate = arrival

  messages.push({
    channel: 'town',
    userId: mission.userId,
    townId: mission.fromTownId,
    kind: 'mission_colony_founded',
    params: {
      missionId: mission.id,
      fromTownId: mission.fromTownId,
      toTownId: to.id,
      wood: mission.cargo.wood - COLONY_FOUNDING_WOOD,
      wine: mission.cargo.wine,
      marble: mission.cargo.marble,
      crystal: mission.cargo.crystal,
      sulfur: mission.cargo.sulfur,
      at: arrival + timing.loadingTime,
    },
  })

  returnFreighters(state, mission)
  return true
}

/**
 * A transport unloads (update_model.php:708-775).
 *
 * Delivery is unconditional -- the destination's warehouse capacity is not
 * consulted, and the overflow sits there until the next town tick trims it.
 */
function deliverTransport(
  state: PlayerState,
  mission: MissionState,
  to: MissionTown,
  timing: MissionTiming,
  arrival: number,
  messages: PendingMessage[],
): boolean {
  for (const r of RESOURCES) to.resources[r] += mission.cargo[r]

  // Rewinds the destination's clock to the landing instant. Update_Towns has
  // already advanced it to now and written that out; this write lands after it
  // and wins, so the next tick pays the town a second time for everything it
  // produced between the fleet landing and the player logging in.
  to.lastUpdate = arrival

  if (to.userId !== mission.userId) {
    messages.push({
      channel: 'town',
      userId: to.userId,
      townId: to.id,
      kind: 'mission_transport_received',
      params: {
        missionId: mission.id,
        fromTownId: mission.fromTownId,
        toTownId: to.id,
        wood: mission.cargo.wood,
        wine: mission.cargo.wine,
        marble: mission.cargo.marble,
        crystal: mission.cargo.crystal,
        sulfur: mission.cargo.sulfur,
        at: arrival,
      },
    })
  }
  messages.push({
    channel: 'town',
    userId: mission.userId,
    townId: mission.fromTownId,
    kind: 'mission_transport_delivered',
    params: {
      missionId: mission.id,
      fromTownId: mission.fromTownId,
      toTownId: to.id,
      wood: mission.cargo.wood,
      wine: mission.cargo.wine,
      marble: mission.cargo.marble,
      crystal: mission.cargo.crystal,
      sulfur: mission.cargo.sulfur,
      at: arrival,
    },
  })

  if (to.userId === mission.userId) {
    // Shipping to yourself: the fleet stays put and the freighters go straight
    // back into the pool.
    returnFreighters(state, mission)
    return true
  }

  if (ts(mission.returnStartedAt) === 0) {
    turnForHome(mission, timing, arrival)
    // Zeroed on the row, which is what stops the return leg delivering the
    // same cargo a second time. Note that `peoples` and `gold` are not zeroed
    // and were never unloaded either, so anything in those two columns rides
    // back home -- unreachable today, since only colonisation loads settlers.
    for (const r of RESOURCES) mission.cargo[r] = 0
  }

  // The legacy dropped the row from its in-memory list here too
  // (update_model.php:774), inside *both* halves of the branch rather than only
  // the one that deleted it. The row survived; it just vanished from the port
  // screen for the rest of that request. Nothing to reproduce.
  return false
}

/**
 * Buy from a branch office (update_model.php:551-663).
 *
 * Returns the gold spent, 0 when nothing matched. Everything is computed into
 * locals and committed in one go, because the legacy's per-resource mutations
 * happen before the `if ($gold > 0)` gate and are thrown away when it fails.
 */
function runBranchPurchase(
  state: PlayerState,
  mission: MissionState,
  to: MissionTown,
  arrival: number,
  world: MissionWorld,
  messages: PendingMessage[],
): number {
  let gold = 0
  const bought = {} as Record<Resource, number>
  const priced = {} as Record<Resource, number>

  for (const r of RESOURCES) {
    const term = mission.tradeTerms[r]
    const offer = offerFor(to, r)
    // Starts at the full order. A resource that fails the test below keeps that
    // figure and is still shipped and still deducted from the office's shelf --
    // see the commit.
    bought[r] = term?.count ?? 0
    priced[r] = offer.price
    if (bought[r] > 0 && offer.direction === 1 && offer.price <= (term?.price ?? 0)) {
      if (offer.count < bought[r]) bought[r] = offer.count
      gold += bought[r] * offer.price
    }
  }

  if (!(gold > 0)) return 0

  if (to.userId !== mission.userId) {
    messages.push({
      channel: 'town',
      userId: to.userId,
      townId: to.id,
      kind: 'mission_buy_loading_incoming',
      params: tradeLineParams(mission, to, bought, priced, arrival),
    })
  }
  messages.push({
    channel: 'town',
    userId: mission.userId,
    townId: mission.fromTownId,
    kind: 'mission_buy_loading',
    params: tradeLineParams(mission, to, bought, priced, arrival),
  })

  for (const r of RESOURCES) {
    // Absolute, and taken from the *order* rather than from what was actually
    // paid for (update_model.php:617-621). A resource the office refused --
    // because it is buying rather than selling, or because its price is above
    // what the order tolerates -- is loaded anyway, in full, for free. The same
    // figure is then taken off the office's shelf below, which will drive it
    // negative. Ordering one marble the office sells alongside ten thousand
    // wood it does not is a complete resource generator.
    mission.cargo[r] = bought[r]
    const branch = to.branchOffice
    if (branch) branch.offers[r].count -= bought[r]
    const term = mission.tradeTerms[r]
    if (term) term.count = 0
  }
  mission.cargo.gold -= gold

  // The office's owner is paid out of the fleet's purse. Not when the buyer is
  // the player being ticked and also owns the office: the legacy read that
  // user's gold off the same object Update_Player writes back from at the end
  // of the request (player_model.php:23), so the credit was overwritten a few
  // lines later. Buying from your own branch office burns the money.
  const seller = world.users[to.userId]
  if (seller && to.userId !== state.user.id) seller.gold += gold

  return gold
}

/** One "resource x at price y" line per resource that changed hands. */
function tradeLineParams(
  mission: MissionState,
  to: MissionTown,
  counts: Record<Resource, number>,
  priced: Record<Resource, number>,
  arrival: number,
): Record<string, unknown> {
  const lines: { resource: Resource; count: number; price: number }[] = []
  for (const r of RESOURCES) {
    if (counts[r] > 0) lines.push({ resource: r, count: counts[r], price: priced[r] })
  }
  return {
    missionId: mission.id,
    fromTownId: mission.fromTownId,
    toTownId: to.id,
    lines,
    at: arrival,
  }
}

/**
 * Sell into a branch office (update_model.php:787-898).
 *
 * The least sound block in the file; each defect is marked at its line. The
 * one that is not a line but a hole: if nothing clears the price test, the
 * fleet is left at the destination with no return stamp, and no later tick can
 * give it one -- the goods and the freighters are gone for good.
 */
function runBranchSale(
  mission: MissionState,
  to: MissionTown,
  timing: MissionTiming,
  arrival: number,
  messages: PendingMessage[],
): void {
  const sold = {} as Record<Resource, number>
  const priced = {} as Record<Resource, number>
  let gold = 0

  for (const r of RESOURCES) {
    const offer = offerFor(to, r)
    const asking = mission.tradeTerms[r]?.price ?? 0
    sold[r] = 0
    priced[r] = offer.price
    // The price test is the wrong way round. Its mirror image in the buy branch
    // (:555) reads "the office is not charging more than I agreed to pay"; this
    // one reads "the office is not paying more than I agreed to accept", so a
    // seller is matched exactly when the bid has fallen to or below the figure
    // they set. Raising your asking price makes a sale *more* likely.
    if (mission.cargo[r] > 0 && offer.direction === 0 && asking >= offer.price) {
      sold[r] = mission.cargo[r] > offer.count ? offer.count : mission.cargo[r]
      // `=`, not `+=` (update_model.php:793). Only the last resource to clear
      // the test decides the whole voyage's takings, and it is priced off the
      // *unclamped* hold at the seller's own asking price rather than at the
      // office's bid for the quantity the office actually took. Whatever gold
      // the fleet was already carrying is overwritten.
      gold = mission.cargo[r] * asking
    }
  }

  if (!RESOURCES.some((r) => sold[r] > 0)) return

  if (to.userId !== mission.userId) {
    messages.push({
      channel: 'town',
      userId: to.userId,
      townId: to.id,
      kind: 'mission_sell_unloaded_incoming',
      // The legacy's rendering of this list prints the marble line when
      // crystal sold and the crystal line when marble did (:840-841): the two
      // conditions and their values are crossed. Display only, and it cannot
      // survive the move to structured parameters, so the lines below are
      // correct and the swap is reported rather than reproduced.
      params: tradeLineParams(mission, to, sold, priced, arrival),
    })
  }
  messages.push({
    channel: 'town',
    userId: mission.userId,
    townId: mission.fromTownId,
    kind: 'mission_sell_unloaded',
    params: tradeLineParams(mission, to, sold, priced, arrival),
  })

  turnForHome(mission, timing, arrival)
  for (const r of RESOURCES) {
    mission.cargo[r] -= sold[r]
    const branch = to.branchOffice
    if (branch) branch.offers[r].count -= sold[r]
    to.resources[r] += sold[r]
  }
  // The office's owner is never debited: the goods land in their warehouse and
  // the payment is conjured into the fleet's hold. A branch office that buys is
  // free money for whoever runs it.
  mission.cargo.gold = gold
}

/**
 * The fleet makes port at home (update_model.php:903-961).
 */
function comeHome(
  state: PlayerState,
  mission: MissionState,
  from: MissionTown,
  to: MissionTown,
  timing: MissionTiming,
  world: MissionWorld,
  messages: PendingMessage[],
): void {
  if (mission.kind === 'colonise') {
    // A colonisation that turned back takes the empty town row with it.
    const island = world.islands[to.islandId]
    if (island?.slots) delete island.slots[to.slot]
    world.removedTownIds.push(to.id)
    state.towns = state.towns.filter((t) => t.id !== to.id)
  }

  const carrying =
    RESOURCES.some((r) => mission.cargo[r] > 0) ||
    mission.cargo.peoples > 0 ||
    mission.cargo.gold > 0

  if (carrying) {
    for (const r of RESOURCES) from.resources[r] += mission.cargo[r]
    from.peoples += mission.cargo.peoples
    const owner = world.users[mission.userId]
    if (owner) owner.gold += mission.cargo.gold

    messages.push({
      channel: 'town',
      userId: mission.userId,
      townId: mission.fromTownId,
      kind: 'mission_fleet_returned',
      params: {
        missionId: mission.id,
        fromTownId: mission.fromTownId,
        toTownId: to.id,
        gold: mission.cargo.gold,
        wood: mission.cargo.wood,
        wine: mission.cargo.wine,
        marble: mission.cargo.marble,
        crystal: mission.cargo.crystal,
        sulfur: mission.cargo.sulfur,
        peoples: mission.cargo.peoples,
        // Dated a full outbound leg after the turn-around, ignoring the abort
        // percentage that made the return shorter (update_model.php:947), so an
        // aborted fleet's homecoming is stamped in the future.
        at: ts(mission.returnStartedAt) + timing.travelTime,
      },
    })
  }

  returnFreighters(state, mission)
}

/**
 * Put the freighters back in the pool.
 *
 * The legacy's SQL reads `WHERE id = <mission id>` (update_model.php:699, :749,
 * :953) -- the mission's own id where the user's belonged. The credit therefore
 * lands on whichever account happens to share that number, and the fleet's
 * owner only gets their ships back through the in-memory line beside it, which
 * fires just for the player being ticked. Resolve someone else's mission for
 * them and their freighters are gone permanently, because the row is deleted in
 * the same breath. Modelled as "only the ticking player is refunded"; the
 * stray credit to an unrelated account is not.
 */
function returnFreighters(state: PlayerState, mission: MissionState): void {
  if (mission.userId === state.user.id) {
    state.user.transports += mission.transports
  }
}

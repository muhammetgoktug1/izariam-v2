/**
 * Construction and city-management actions, ported from the Actions controller
 * (izariam/controllers/actions.php).
 *
 * Each legacy method validated a handful of preconditions, mutated
 * `$this->Player_Model->now_town` and then re-rendered a screen. Here the
 * mutation is the whole contract: the caller ticks the player first, calls one
 * of these, and persists whatever comes back. Rejections are values, not
 * `$this->Error()` calls, so the API layer decides how loud to be.
 *
 * Note that the legacy Actions controller never loaded Update_Model -- only the
 * Game controller did (game.php:34). Every action below therefore ran against
 * whatever the DB held at the end of the player's *previous* page view, which
 * is why so many of them re-derive costs from stored levels. The port is
 * expected to tick before acting; nothing here depends on the stale read.
 *
 * None of these actions produced a message row, so `messages` is always empty.
 * It is part of the result shape because the orchestrator hoists ActionResult
 * for the modules that do emit messages.
 *
 * Rejection reasons in use:
 *   construction_not_allowed   build()'s eligibility gate said no (the legacy
 *                              silently redisplayed the city view)
 *   construction_enough_resources  the legacy lang key for "cannot afford it"
 *   impossible_reduce_level    demolition() refused to touch the town hall
 *   no_build_improve           upgrade() found nothing standing at the slot
 *   construction_entry_missing leaveConstructionList() index out of range
 *   no_construction            hurryConstruction() found nothing under way
 *   construction_other_slot    hurryConstruction() was aimed past the queue head
 *   not_enough_ambrosia        hurryConstruction() could not be paid for
 *   abort_buildings_no_effect  abortBuildings() found no matching town
 *   donation_rejected          resources() failed its amount/island check
 *   tavern_not_at_position / tavern_level_too_low
 *   resource_workers_rejected / tradegood_workers_rejected / scientists_rejected
 *   priests_rejected           more priests than the temple houses, or than
 *                              the town has citizens for
 */

import { BUILDING_CLASS } from '@izariam/gamedata'

import {
  buildingCost,
  islandNodeCost,
  scientistsByLevel,
  type BuildingCost,
} from '../costs.js'
import { DEFAULT_CONFIG, type GameConfig } from '../config.js'
import { isTownActive, type DerivedTown } from '../derive.js'
import { constructionHead, hurryCost } from '../hurry.js'
import { priestsByLevel } from '../temple.js'
import {
  BUILDING,
  type ActionResult,
  RESOURCES,
  researchLevel,
  type BuildQueueEntry,
  type PendingMessage,
  type PlayerState,
  type Resources,
  type TownState,
} from '../types.js'

/**
 * Outcome of a single player action.
 *
 * Defined here for now; hoist it to types.ts once the other action modules
 * land, since every one of them needs the same shape.
 */
export type { ActionResult } from '../types.js'

/**
 * What an action needs to see. `town` is the legacy `now_town` -- the player's
 * currently selected town, which most of these methods mutate regardless of
 * what their arguments name.
 */
export interface ActionContext {
  state: PlayerState
  town: TownState
  /** derive() output for `town`: supplies the `$levels[]` array the cost
   *  functions index and the already-built map. */
  derived: DerivedTown
  /** Epoch seconds, standing in for the legacy `time()`. */
  now: number
  config?: GameConfig
}

function ok(): ActionResult {
  return { ok: true, messages: [] }
}

function reject(reason: string): ActionResult {
  return { ok: false, reason }
}

function slotType(town: TownState, slot: number): number {
  return town.buildings.bySlot[slot]?.type ?? 0
}

function slotLevel(town: TownState, slot: number): number {
  return town.buildings.bySlot[slot]?.level ?? 0
}

/**
 * Write a board slot.
 *
 * Only `bySlot` is touched, matching tick.ts's setSlot. The type -> level map is a
 * denormalised cache that nothing in the rules maintains, and derive() rebuilds
 * the type -> level map from the slots on every call.
 */
function setSlot(town: TownState, slot: number, type: number, level: number) {
  town.buildings.bySlot[slot] = { type, level }
}

/** data_model.php:519-548. Anything outside the switch is bare ground. */
function isBuildingGround(type: number): boolean {
  return (BUILDING_CLASS[String(type)] ?? 'buildingGround') === 'buildingGround'
}

/**
 * The last board slot holding `type`, or 0 (data_model.php:1037-1048).
 *
 * "Not present" and "present at slot 0" are indistinguishable, which is what
 * lets build() queue a second town hall onto an empty slot.
 */
function getPosition(town: TownState, type: number): number {
  let found = 0
  for (let slot = 0; slot <= 14; slot++) {
    if (slotType(town, slot) === type) found = slot
  }
  return found
}

/**
 * The legacy tests the raw `premium_account` column for `> 0`. Update_Player
 * zeroes it once it expires (update_model.php:60-70, ported in tick.ts), so on
 * a freshly ticked state this is exactly "premium is live"; on a stale one an
 * expired timestamp still passes, as it did in 2012.
 */
function hasPremiumAccount(state: PlayerState): boolean {
  const until = state.user.premium.account
  return until != null && until > 0
}

// ---------------------------------------------------------------------------
// build / upgrade
// ---------------------------------------------------------------------------

/**
 * Queue a construction or an upgrade at `position` (actions.php:392-499).
 *
 * The eligibility gate is eight clauses joined with `and` and then, at the very
 * end, `or SizeOf($build_line) == 0`. PHP binds `and` tighter than `or`, so the
 * whole conjunction is bypassed whenever the construction queue is empty: with
 * nothing queued a player may build a type that already stands elsewhere, drop
 * a building onto an occupied slot of a different type, raise the shipyard mid
 * ship-production, or put up a workshop without research 2_13. The clauses only
 * bite on the second and later entries -- which also require a premium account,
 * since `SizeOf(...) > 0 and premium_account > 0` sits inside the conjunction.
 *
 * Payment is deferred. The affordability test always runs, but the debit only
 * happens when the queue was empty; entries 2..n are charged by the tick as
 * their predecessor completes (see runBuildQueue in tick.ts).
 */
export function build(ctx: ActionContext, positionArg: number, idArg: number): ActionResult {
  const id = Math.floor(idArg)
  const position = Math.floor(positionArg)
  const { state, town } = ctx
  const config = ctx.config ?? DEFAULT_CONFIG
  const research = state.user.research

  const level = slotLevel(town, position)
  const type = slotType(town, position)
  const alreadyPosition = getPosition(town, id)
  const queueLength = town.buildQueue.length

  const eligible =
    (alreadyPosition === 0 || alreadyPosition === position || id === BUILDING.WAREHOUSE) &&
    !isBuildingGround(id) &&
    // The shipyard and the barracks cannot be touched while their queue runs.
    (id !== BUILDING.SHIPYARD || town.navalQueue.length === 0) &&
    (id !== BUILDING.BARRACKS || town.landQueue.length === 0) &&
    (id !== BUILDING.WORKSHOP || researchLevel(research, 2, 13) > 0) &&
    (id !== BUILDING.SAFEHOUSE || (town.spyTrainingStartedAt ?? 0) === 0) &&
    // A queued-but-unbuilt slot still reads type 0 here: correct_buildings()
    // patches the type in memory only (player_model.php:390), so two different
    // building types can be queued onto the same empty slot.
    (type === 0 || type === id) &&
    // `<=`, so the real ceiling is town_queue_size + 1 = 4 entries.
    queueLength <= config.townQueueSize &&
    queueLength > 0 &&
    hasPremiumAccount(state)

  if (!eligible && queueLength !== 0) return reject('construction_not_allowed')

  const cost = buildingCost(id, level, research, ctx.derived.levels)
  const remaining: Resources = {
    wood: town.resources.wood - cost.wood,
    wine: town.resources.wine - cost.wine,
    marble: town.resources.marble - cost.marble,
    crystal: town.resources.crystal - cost.crystal,
    sulfur: town.resources.sulfur - cost.sulfur,
  }
  if (RESOURCES.some((r) => remaining[r] < 0)) {
    return reject('construction_enough_resources')
  }

  // Priced against the level standing at the slot right now, so a second entry
  // aimed at the same slot is quoted -- and later charged by the tick -- at the
  // level it is replacing rather than the one it will actually reach.
  if (queueLength === 0) {
    for (const r of RESOURCES) town.resources[r] = remaining[r]
  }

  town.buildQueue = [...town.buildQueue, { slot: position, type: id }]
  if (town.buildStartedAt == null || town.buildStartedAt === 0) {
    town.buildStartedAt = ctx.now
  }

  // Every test reads the tutorial step as it was on entry -- tutorials('set')
  // issues a bare UPDATE and leaves the in-memory user untouched
  // (actions.php:1931-1933). Upgrading an academy from level 1 while on step 4
  // therefore fires both the "built the academy" and the "upgraded a building"
  // branch, and the later write wins.
  const tutorial = state.user.tutorialStep
  if (id === BUILDING.ACADEMY && tutorial <= 4) state.user.tutorialStep = 5
  if (id === BUILDING.BARRACKS && tutorial <= 8) state.user.tutorialStep = 9
  if (id === BUILDING.WALL && tutorial <= 11) state.user.tutorialStep = 12
  if (id === BUILDING.PORT && tutorial <= 13) state.user.tutorialStep = 14
  if (level > 0 && tutorial <= 15) state.user.tutorialStep = 16

  // correct_buildings() runs next in the legacy (actions.php:487). It only
  // stamps the queued type onto empty slots in memory and never persists it, so
  // there is nothing to reproduce here.
  return ok()
}

/**
 * Raise the building already standing at `position` (actions.php:1942-1954).
 *
 * A thin wrapper: it reads the slot's type and hands it to build(). The legacy
 * passes the building's css class as build()'s third argument, which is the
 * redirect target -- a rendering detail with no effect on state.
 */
export function upgrade(ctx: ActionContext, positionArg: number): ActionResult {
  const position = Math.floor(positionArg)
  if (slotLevel(ctx.town, position) <= 0) return reject('no_build_improve')
  return build(ctx, position, slotType(ctx.town, position))
}

// ---------------------------------------------------------------------------
// hurry (no legacy counterpart -- see hurry.ts)
// ---------------------------------------------------------------------------

/** `half` removes half of what is left, `all` removes the lot. */
export type HurryMode = 'half' | 'all'

/**
 * Spend ambrosia to bring the construction at `position` forward.
 *
 * The only thing written is `buildStartedAt`, and that is the whole trick:
 * there is no stored finish time anywhere in the port -- `runBuildQueue`
 * decides with `buildStart + cost.time <= now` (tick.ts:319) -- so moving the
 * start backwards *is* moving the finish forwards. The building is then
 * completed by the next tick, which means the score bump, the town message and
 * the queue's deferred payment all happen exactly as they would have on their
 * own. Completing it here by hand would mean a second copy of runBuildQueue,
 * legacy quirks included.
 *
 * `position` is required rather than implied by the queue: between the moment
 * the screen was drawn and the moment it was clicked the head can finish and
 * the next entry slide up, and paying to rush a building you did not choose is
 * not a mistake a player can undo.
 */
export function hurryConstruction(
  ctx: ActionContext,
  positionArg: number,
  mode: HurryMode,
): ActionResult {
  const head = constructionHead(ctx.state, ctx.town)
  if (!head) return reject('no_construction')
  if (head.slot !== Math.floor(positionArg)) return reject('construction_other_slot')

  // Unreachable on a freshly ticked state -- the head always completes when its
  // time is up, since the affordability test that can drop an entry only runs
  // from the second completion of a pass (tick.ts:332). Guarded anyway, because
  // the alternative is paying for nothing.
  const remaining = head.endsAt - ctx.now
  const removed = mode === 'all' ? remaining : Math.floor(remaining / 2)
  if (removed <= 0) return reject('no_construction')

  const cost = hurryCost(removed)
  if (ctx.state.user.ambrosia < cost) return reject('not_enough_ambrosia')

  ctx.state.user.ambrosia -= cost
  ctx.town.buildStartedAt = head.startedAt - removed
  return ok()
}

// ---------------------------------------------------------------------------
// demolition
// ---------------------------------------------------------------------------

/**
 * Take one level off the building at `position`, or cancel the level under
 * construction there (actions.php:672-814).
 *
 * Refunds 90% of the demolished level's cost, docks 1% of it from
 * points_buildings and one from points_levels, and -- when the queue head
 * matches -- drops that head and immediately charges the town for whatever is
 * behind it, skipping any entry it cannot pay for.
 *
 * Three separate conditions decide what happens, and they are allowed to
 * disagree:
 *   :676  the town hall may only be demolished when the queue *head* is a town
 *         hall, whatever stands at slot 0.
 *   :685  the refund covers the in-progress level (and leaves the standing
 *         level alone) only when the head targets this exact slot.
 *   :711  the queue is edited when the head's *type* matches, wherever it
 *         points -- so demolishing a tavern at slot 7 cancels a queued tavern
 *         at slot 3.
 */
export function demolition(ctx: ActionContext, positionArg: number): ActionResult {
  const position = Math.floor(positionArg)
  const { state, town } = ctx
  const research = state.user.research
  const levels = ctx.derived.levels
  const head = town.buildQueue[0]

  // PHP read NULL out of the missing queue entry, and NULL == 1 is false, so an
  // empty queue leaves slot 0 untouchable.
  if (!(position > 0 || head?.type === BUILDING.TOWN_HALL)) {
    return reject('impossible_reduce_level')
  }

  let level = slotLevel(town, position)
  let type = slotType(town, position)
  // An empty slot falls back to the type at the head of the queue even when the
  // head targets somewhere else, so demolishing bare ground refunds 90% of some
  // unrelated building's first level.
  if (type === 0) type = head?.type ?? 0

  let cost: BuildingCost
  if (head !== undefined && head.slot === position) {
    cost = buildingCost(type, level, research, levels)
  } else {
    // buildingCost clamps a negative level to 0, so demolishing an empty slot
    // pays out the first level's cost and leaves the level at 0 -- repeatable.
    cost = buildingCost(type, level - 1, research, levels)
    if (level > 0) level -= 1
  }

  // Checked after the level was decremented above, so razing the last academy
  // level frees its scientists. In the cancel-the-head branch the level is
  // never decremented, and an academy queued onto an empty slot still trips
  // this at level 0.
  if (type === BUILDING.ACADEMY && level === 0) {
    town.peoples += town.scientists
    town.scientists = 0
  }

  const pool: Resources = {
    wood: town.resources.wood + cost.wood * 0.9,
    wine: town.resources.wine + cost.wine * 0.9,
    marble: town.resources.marble + cost.marble * 0.9,
    crystal: town.resources.crystal + cost.crystal * 0.9,
    sulfur: town.resources.sulfur + cost.sulfur * 0.9,
  }
  const points = (cost.wood + cost.wine + cost.marble + cost.crystal + cost.sulfur) * 0.01

  // `$type_text` is assigned once before the queue pass (:679) and then again on
  // every turn of the re-costing loop (:740), but unlike `$level_text` it is
  // never restored afterwards. Whatever it points at when the loop exits is
  // what :780 zeroes and what :791 writes into *this* slot's type column.
  let typeSlotRef: number | null = position

  if (head !== undefined && head.type === type) {
    let queue: BuildQueueEntry[]
    // The survivor inherits the cancelled entry's build_start, so it keeps all
    // the time the cancelled one had already served.
    let buildStart = town.buildStartedAt
    if (town.buildQueue.length > 1) {
      queue = town.buildQueue.slice(1)
    } else {
      queue = []
      buildStart = null
    }

    if (queue.length > 0) {
      for (;;) {
        const next = queue[0]
        if (next === undefined) {
          // load_build_line('') returns NULL, so `$buildings[0]['position']` is
          // NULL and `$type_text` degrades to the property name 'pos_type'.
          // building_cost(NULL, NULL) is free, which is the only reason this
          // loop is guaranteed to terminate. The bogus handle then resolves to
          // NULL at :791 and MySQL stores 0 in the NOT NULL column.
          typeSlotRef = null
          break
        }
        typeSlotRef = next.slot
        // Priced from the *slot's* stored type, not the queue entry's. The two
        // agree except on slots that build() reached through the empty-queue
        // bypass; an empty slot reads type 0 and so costs nothing.
        const nextCost = buildingCost(
          slotType(town, next.slot),
          slotLevel(town, next.slot),
          research,
          levels,
        )
        if (RESOURCES.every((r) => pool[r] - nextCost[r] >= 0)) {
          for (const r of RESOURCES) pool[r] -= nextCost[r]
          break
        }
        queue = queue.slice(1)
      }
    }

    if (queue.length === 0) buildStart = null
    town.buildQueue = queue
    town.buildStartedAt = buildStart
  }

  // :780 zeroes the type behind the (possibly drifted) handle in memory, but the
  // only column written is this slot's, so the zeroing of a foreign slot is
  // discarded and the slot being demolished inherits the foreign type instead.
  // Cancel the head of a two-entry queue and a level-5 tavern turns into a
  // level-5 museum.
  const persistedType = level <= 0 ? 0 : typeSlotRef === null ? 0 : slotType(town, typeSlotRef)
  setSlot(town, position, persistedType, level)

  for (const r of RESOURCES) town.resources[r] = pool[r]

  const scores = state.user.scores
  scores.buildings = (scores.buildings ?? 0) - points
  scores.levels = (scores.levels ?? 0) - 1

  return ok()
}

// ---------------------------------------------------------------------------
// queue maintenance
// ---------------------------------------------------------------------------

/**
 * Wipe the whole construction queue, refunding nothing (actions.php:60-77).
 *
 * Load_Player keys `$this->towns` by town id (player_model.php:70) while this
 * loop walks 0..count-1 as if it were a list, so the lookup only ever resolves
 * for a town whose id is below the player's town count -- in practice never,
 * outside the first accounts seeded into a fresh universe. When it does resolve
 * it still wipes `now_town`, not the town that was named.
 *
 * PHP's `NULL == 0` also means the default `$town = 0` matches every missing
 * slot; the guard then dereferences NULL, `NULL != ''` is false, and nothing
 * happens anyway.
 */
export function abortBuildings(ctx: ActionContext, townIdArg: number): ActionResult {
  const { state, town } = ctx
  const active = state.towns.filter(isTownActive)

  let index = -1
  for (let i = 0; i < active.length; i++) {
    const at = active.find((t) => t.id === i)
    if (at !== undefined ? at.id === townIdArg : townIdArg === 0) index = i
  }

  const target = index >= 0 ? active.find((t) => t.id === index) : undefined
  if (target === undefined || target.buildQueue.length === 0) {
    return reject('abort_buildings_no_effect')
  }

  town.buildQueue = []
  town.buildStartedAt = null
  return ok()
}

/**
 * Drop one entry from the construction queue (actions.php:1267-1287).
 *
 * The head is unreachable: `$id > 0` guards the whole body, so index 0 can only
 * be removed by demolition(). Nothing is refunded, nothing is re-costed, and
 * build_start is left running -- removing entry 1 of 3 hands entry 2 all of the
 * elapsed time entry 1 had accumulated.
 *
 * `$id` is never floored; a non-integer index simply fails the isset() test,
 * which array indexing reproduces.
 */
export function leaveConstructionList(ctx: ActionContext, index: number): ActionResult {
  const { town } = ctx
  if (!(index > 0) || town.buildQueue[index] === undefined) {
    return reject('construction_entry_missing')
  }
  town.buildQueue = town.buildQueue.filter((_, i) => i !== index)
  return ok()
}

// ---------------------------------------------------------------------------
// population assignment
// ---------------------------------------------------------------------------

export interface WorkersInput {
  /** The screen the form was posted from. Only the tutorial step reads it. */
  screen: string
  /**
   * Second URI segment. The scientist form sends the academy's board slot; the
   * two worker forms send an island id, which nothing validates.
   */
  slot: number
  /** POST `rw`. Leave undefined when the field was absent from the form. */
  resourceWorkers?: number
  /** POST `tw`. */
  tradegoodWorkers?: number
  /** POST `s`. */
  scientists?: number
  /** Priests, from the temple screen. No legacy counterpart. */
  priests?: number
}

/**
 * Move citizens between the free pool and the three jobs
 * (actions.php:1967-2052).
 *
 * The three blocks are independent and each is silently skipped when its own
 * test fails, so a request that moves workers and over-books scientists applies
 * the first half. The result reports the first block that was refused; anything
 * before it has already been applied.
 *
 * Two things are missing from every block: a lower bound, and a floor before
 * the comparison. Assigning -500 workers passes both tests, stores -500, and
 * hands the town 500 extra *free* citizens -- which are paid 3 gold an hour
 * each while the negative worker count merely drains a resource the town was
 * producing anyway.
 */
export function workers(ctx: ActionContext, input: WorkersInput): ActionResult {
  const { state, town } = ctx
  const island = state.islands[town.islandId]
  const research = state.user.research

  const tutorial = state.user.tutorialStep
  if (input.screen === 'resource' && tutorial <= 2) state.user.tutorialStep = 3
  if (input.screen === 'academy' && tutorial <= 6) state.user.tutorialStep = 7

  let rejected: string | null = null

  if (input.resourceWorkers !== undefined) {
    const want = input.resourceWorkers
    const cap = workerCap(islandNodeCost(0, island?.woodLevel ?? 0).workers, ctx)
    const all = town.workers + town.peoples
    if (cap >= want && all >= want) {
      town.workers = Math.floor(want)
      town.peoples = all - Math.floor(want)
    } else {
      rejected ??= 'resource_workers_rejected'
    }
  }

  if (input.tradegoodWorkers !== undefined) {
    const want = input.tradegoodWorkers
    const cap = workerCap(islandNodeCost(1, island?.tradeLevel ?? 0).workers, ctx)
    const all = town.tradegood + town.peoples
    if (cap >= want && all >= want) {
      town.tradegood = Math.floor(want)
      town.peoples = all - Math.floor(want)
    } else {
      rejected ??= 'tradegood_workers_rejected'
    }
  }

  if (input.scientists !== undefined) {
    const want = input.scientists
    // The cap comes from whatever level stands at `slot`; nothing checks that
    // the slot holds the academy. Any academy anywhere in town unlocks the
    // form, so pointing it at a tall town hall raises the ceiling for free.
    const unlocked = input.slot > 0 && (ctx.derived.alreadyBuilt[BUILDING.ACADEMY] ?? false)
    const cap = scientistsByLevel(slotLevel(town, input.slot))
    const all = town.scientists + town.peoples
    if (unlocked && cap >= want && all >= want) {
      town.scientists = Math.floor(want)
      town.peoples = all - Math.floor(want)
    } else {
      rejected ??= 'scientists_rejected'
    }
  }

  /**
   * Priests, which the legacy never had a form for -- `towns.templer` is a
   * column no controller writes.
   *
   * Deliberately stricter than the scientist block above it: the ceiling comes
   * from the temple's *own* level, read by type, so pointing the form at a
   * different slot cannot raise it. The academy's version of that mistake is
   * reproduced above because it is the legacy's; this one has no legacy to be
   * faithful to.
   */
  if (input.priests !== undefined) {
    const want = input.priests
    const cap = priestsByLevel(ctx.derived.levels[BUILDING.TEMPLE] ?? 0)
    const all = town.templer + town.peoples
    if (want >= 0 && cap >= want && all >= want) {
      town.templer = Math.floor(want)
      town.peoples = all - Math.floor(want)
    } else {
      rejected ??= 'priests_rejected'
    }
  }

  return rejected === null ? ok() : reject(rejected)
}

/** Trade unions (research 2_5) lift an island node's worker ceiling by half.
 *  The result is a float, and the comparison against it is not floored. */
function workerCap(base: number, ctx: ActionContext): number {
  return researchLevel(ctx.state.user.research, 2, 5) > 0 ? base * 1.5 : base
}

// ---------------------------------------------------------------------------
// island donation, tavern
// ---------------------------------------------------------------------------

/**
 * Donate wood towards an island node's next level (actions.php:1566-1599).
 *
 * `kind` is the legacy `$type` URI segment: 'resource' feeds the sawmill,
 * anything else feeds the mine.
 */
export function resources(
  ctx: ActionContext,
  kind: string,
  islandId: number,
  donation: number,
): ActionResult {
  const { state, town } = ctx
  const count = Math.floor(donation)

  if (!(town.resources.wood >= count && count > 0 && town.islandId === islandId)) {
    return reject('donation_rejected')
  }

  const island = state.islands[islandId]
  if (kind === 'resource') {
    town.workersWood += count
    if (island) island.woodDonated += count
  } else {
    // actions.php:1579-1580 increments the model and then sets the column to
    // "model + count", so the town's mine contribution counter is credited
    // twice while the island's own total gets one. The counter drives the
    // per-player donation ranking on the island screen, not production, so the
    // inflation is cosmetic -- but it is persisted and it compounds.
    town.tradegoodWood += count * 2
    if (island) island.tradeDonated += count
  }

  town.resources.wood -= count
  return ok()
}

/**
 * Set how much wine the tavern serves (actions.php:1660-1676).
 *
 * The only bound is the tavern's own level. There is no floor at zero, so a
 * negative amount is stored and then read by derive() as `tavernWine * 60`
 * happiness -- a way to make a town miserable at no cost. It never turns into
 * income: wineByTavernLevel() has no entry below level 0 and returns 0.
 */
export function tavern(ctx: ActionContext, positionArg: number, amount: number): ActionResult {
  const position = Math.floor(positionArg)
  const { town } = ctx
  const wine = Math.floor(amount)

  if (slotType(town, position) !== BUILDING.TAVERN) return reject('tavern_not_at_position')
  if (slotLevel(town, position) < wine) return reject('tavern_level_too_low')

  town.tavernWine = wine
  return ok()
}

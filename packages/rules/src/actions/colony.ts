/**
 * Colony, research and account actions, ported from
 * izariam/controllers/actions.php.
 *
 * Every `$this->db->...` in the legacy controller lands in one of three places
 * here: a mutation of the PlayerState handed in, an ActionIntent for rows the
 * rules layer cannot own (town and mission inserts, army/message deletes, user
 * mail, password hashing), or nothing at all -- the controller swallowed most
 * failed preconditions and simply re-rendered the screen.
 *
 * Only two paths in this file called Error() in 2012: colonize() without action
 * points and abolishColony() with the guard unmet. Everything else that returns
 * `{ ok: false }` here was a silent no-op there, so the API layer is free to
 * decide what the client sees; each code says which it was.
 */

import { RESEARCH_BRANCH_SIZE } from '@izariam/gamedata'

import { DEFAULT_CONFIG, type GameConfig } from '../config.js'
import { researchInfo } from '../costs.js'
import { isTownActive } from '../derive.js'
import { projectArrival } from '../missions.js'
import {
  BUILDING,
  type AccountOptions,
  type ActionFail,
  type ActionIntent,
  type ActionOk,
  type ActionResult,
  RESOURCES,
  emptyResources,
  type MissionState,
  type PendingMessage,
  type PlayerState,
  type PremiumKind,
  type Resources,
  type TownState,
} from '../types.js'

export type { AccountOptions } from '../types.js'

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

/**
 * Work the persistence layer must do that is not expressible as a mutation of
 * PlayerState: rows that live outside the player graph, and the one decision
 * (password hashing) the rules layer is not allowed to make.
 */
export type { ActionIntent } from '../types.js'

export type ActionError =
  /** No current town in the player graph. The legacy would have fatalled. */
  | 'no_current_town'
  /** Legacy error page: lang line `enough_action_points`. */
  | 'not_enough_action_points'
  /** Legacy error page: lang line `unable_leave_colony`. */
  | 'unable_leave_colony'
  | 'island_not_loaded'
  | 'island_slot_out_of_range'
  | 'island_slot_occupied'
  | 'unknown_town'
  | 'town_not_on_island'
  | 'not_enough_ambrosia'
  | 'colony_limit_reached'
  | 'not_enough_resources'
  | 'not_enough_cargo_space'
  | 'already_capital'
  | 'no_palace'
  | 'unknown_research'
  | 'not_enough_research_points'
  | 'unknown_premium_type'
  | 'invalid_name'
  | 'login_taken'
  | 'unchanged'
  | 'invalid_option'
  | 'unknown_recipient'
  | 'unknown_message'
  | 'unknown_message_type'

// The canonical shape lives in types.ts so all four action modules agree; the
// API layer switches on one union rather than four. `state` is not part of it:
// actions mutate the PlayerState they were handed.
export type { ActionOk, ActionFail, ActionResult } from '../types.js'

export interface ActionContext {
  /** Epoch seconds -- the legacy time(). */
  now: number
  config?: GameConfig
}

function ok(
  state: PlayerState,
  intents: ActionIntent[] = [],
  messages: PendingMessage[] = [],
): ActionOk {
  void state
  return intents.length > 0 ? { ok: true, messages, intents } : { ok: true, messages }
}

/** PHP's `$v == 1` for a value that arrived from a form. */
function looselyOne(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false
  return Number(value) === 1
}

function fail(error: ActionError): ActionFail {
  return { ok: false, reason: error }
}

// ---------------------------------------------------------------------------
// Constants the legacy hardcoded at the call site
// ---------------------------------------------------------------------------

/** actions.php:605,610-611 -- the colony fee, inline in the controller. */
const COLONY_WOOD_COST = 1250
const COLONY_PEOPLE_COST = 40
const COLONY_GOLD_COST = 9000

/** actions.php:557,587 -- relocating an existing city. */
export const RELOCATE_AMBROSIA_COST = 200

/** actions.php:1360-1366 -- every boost is sold in one-week blocks. */
export const PREMIUM_DURATION = 604800

/**
 * Ambrosia price per boost (data_model.php:1579-1591).
 *
 * Not read from costs.premiumCost(): the extractor keyed premium_cost by
 * integer, but the legacy switch matches on the boost *name*, so
 * CURVES.premium_cost is eight nulls. Kept local until gamedata is re-extracted.
 *
 * Exported because the shop screen has to quote the same number this charges.
 * It did not, and read the null curve instead -- so every row advertised 0
 * ambrosia while `buyPremium` took 10.
 */
export const PREMIUM_COST: Record<string, number> = {
  account: 10,
  wood: 10,
  wine: 3,
  marble: 8,
  crystal: 5,
  sulfur: 3,
  capacity: 14,
}

/** Islands have city0..city16 (beta.sql:110-126). */
const MAX_ISLAND_SLOT = 16

/** Island_Model::Load_Island only walks 0..15, so slot 16 is never rendered. */
const MAX_RENDERED_ISLAND_SLOT = 15

/** doResearch() grants Wealth's bonus to the current town (actions.php:845-860). */
const WEALTH_RESOURCE_GRANT = 130

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * PHP 5 strip_tags(), to the fidelity the callers need: the legacy tests the
 * *stripped* string for emptiness and for login uniqueness, so "<b></b>" is a
 * rejected empty name rather than a valid one, and an unterminated "<"
 * swallows the rest of the string exactly as PHP does.
 */
function stripTags(input: string): string {
  return input.replace(/<[^>]*>/g, '').replace(/<[\s\S]*$/, '')
}

/**
 * Building level by type, rebuilt from the slots the way Load_Player does
 * (player_model.php:87-94). The last slot holding the type wins.
 *
 * Only bySlot is written: levelsByType() derives the type -> level map, and
 * fixture adapter leaves it empty. bySlot is the authoritative copy.
 */
function levelOfType(town: TownState, type: number): number {
  let level = 0
  for (let slot = 0; slot <= 14; slot++) {
    const b = town.buildings.bySlot[slot]
    if (b && b.type === type) level = b.level
  }
  return level
}

/**
 * Data_Model::get_position (data_model.php:1037-1049): the last slot holding
 * `type`, or 0 when there is none -- which is indistinguishable from a genuine
 * hit on slot 0, and is why changeCapital() insists on a position > 0.
 */
function positionOfType(town: TownState, type: number): number {
  let position = 0
  for (let slot = 0; slot <= 14; slot++) {
    if (town.buildings.bySlot[slot]?.type === type) position = slot
  }
  return position
}

/**
 * The towns Load_Player exposes as `$this->towns` -- it skips any town whose
 * pos0_level is 0 (player_model.php:55), which is how a colony still in
 * transit stays invisible to everything the controller does.
 */
function activeTowns(state: PlayerState): TownState[] {
  return state.towns.filter(isTownActive)
}

function currentTown(state: PlayerState): TownState | undefined {
  const id = state.user.currentTownId
  if (id == null) return undefined
  return activeTowns(state).find((t) => t.id === id)
}

// ---------------------------------------------------------------------------
// colonize (actions.php:544-671)
// ---------------------------------------------------------------------------

export interface RelocateInput {
  mode: 'relocate'
  islandId: number
  slot: number
  /** The posted cityId: which of the player's towns to pick up and move. */
  townId: number
}

export interface FoundColonyInput {
  mode: 'found'
  islandId: number
  slot: number
  /** Cargo loaded on top of the 1250 wood the colony itself costs. */
  send: Resources
  transports: number
  /** Ids the persistence layer has reserved. The legacy inserted the town and
   *  then re-read it by (island, position) to learn its id. */
  newTownId: number
  newMissionId: number
}

export type ColonizeInput = RelocateInput | FoundColonyInput

/**
 * The `colonize` entry point: one URL, two unrelated operations chosen by the
 * POST body.
 *
 * Both paths need an action point in the current town, and neither is reached
 * without one -- but only founding spends it (actions.php:635).
 *
 * The legacy picked the relocate branch on
 * `$_POST['action'] == $this->lang->line('move')`, i.e. by comparing the
 * submitted button caption against the *currently selected language*. A form
 * rendered before a language switch posts the old caption, falls through to the
 * else, and dies there because cityId is set: the move is silently dropped.
 * The mode is an argument here, so the caller decides; the port does not
 * reproduce the mis-dispatch.
 */
export function colonize(
  state: PlayerState,
  input: ColonizeInput,
  ctx: ActionContext,
): ActionResult {
  const town = currentTown(state)
  if (!town) return fail('no_current_town')
  if (town.actionPoints <= 0) return fail('not_enough_action_points')

  const islandId = Math.floor(input.islandId)
  const slot = Math.floor(input.slot)
  if (islandId <= 0) return fail('island_not_loaded')
  // The legacy bounded `$position` from below only; anything past city16 built
  // a column name that does not exist and killed the request on a DB error.
  if (slot < 0 || slot > MAX_ISLAND_SLOT) return fail('island_slot_out_of_range')

  return input.mode === 'relocate'
    ? relocateTown(state, { ...input, islandId, slot })
    : foundColony(state, town, { ...input, islandId, slot }, ctx)
}

/**
 * Move an existing city to a free slot on another island for 200 ambrosia
 * (actions.php:557-591).
 *
 * No distance limit, no cooldown, nothing is left behind: the town keeps its
 * buildings, garrison and stock, and the new island's trade good silently
 * replaces the old one.
 */
function relocateTown(state: PlayerState, input: RelocateInput): ActionResult {
  const { user } = state
  const town = activeTowns(state).find((t) => t.id === input.townId)
  if (!town) return fail('unknown_town')
  if (user.ambrosia < RELOCATE_AMBROSIA_COST) return fail('not_enough_ambrosia')

  const target = state.islands[input.islandId]
  if (!target || !target.slots) return fail('island_not_loaded')
  if ((target.slots[input.slot] ?? 0) !== 0) return fail('island_slot_occupied')

  // The old slot is found by scanning the source island's markers for the town
  // id rather than by reading town.position, and the scan stops at 15 -- a town
  // that was founded on slot 16 by hand-crafting the colonize URL can never be
  // moved off it (actions.php:560-564).
  const source = state.islands[town.islandId]
  let nowPosition = -1
  for (let i = 0; i <= MAX_RENDERED_ISLAND_SLOT; i++) {
    if ((source?.slots?.[i] ?? 0) === town.id) nowPosition = i
  }
  if (nowPosition < 0) return fail('town_not_on_island')

  if (source?.slots) source.slots[nowPosition] = 0
  target.slots[input.slot] = town.id
  town.islandId = input.islandId
  town.slot = input.slot
  user.ambrosia -= RELOCATE_AMBROSIA_COST

  return ok(state)
}

/**
 * Found a colony: 1250 wood, 40 citizens and 9000 gold from the current town,
 * plus whatever cargo the player loads (actions.php:595-655).
 *
 * The colony cap is the *capital's* palace level, measured against the number
 * of finished towns. Colonies still in transit are not in Load_Player's town
 * list, so the cap is checked against a count that ignores them: three action
 * points buy three simultaneous colonisations off a level-1 palace. Pending
 * quirk flag `colonyCapIgnoresInFlightColonies`.
 */
function foundColony(
  state: PlayerState,
  town: TownState,
  input: FoundColonyInput,
  ctx: ActionContext,
): ActionResult {
  const { user } = state
  const config = ctx.config ?? DEFAULT_CONFIG
  const towns = activeTowns(state)

  const capital = towns.find((t) => t.id === user.capitalTownId)
  const palaceLevel = capital ? levelOfType(capital, BUILDING.PALACE) : 0
  if (towns.length - 1 >= palaceLevel) return fail('colony_limit_reached')

  const send: Resources = {
    wood: Math.floor(input.send.wood),
    wine: Math.floor(input.send.wine),
    marble: Math.floor(input.send.marble),
    crystal: Math.floor(input.send.crystal),
    sulfur: Math.floor(input.send.sulfur),
  }
  const transporters = Math.floor(input.transports)

  const after: Resources = {
    wood: town.resources.wood - send.wood - COLONY_WOOD_COST,
    wine: town.resources.wine - send.wine,
    marble: town.resources.marble - send.marble,
    crystal: town.resources.crystal - send.crystal,
    sulfur: town.resources.sulfur - send.sulfur,
  }
  const peoples = town.peoples - COLONY_PEOPLE_COST
  const gold = user.gold - COLONY_GOLD_COST
  const transports = user.transports - transporters

  // Marble is deliberately absent from this chain. actions.php:613 checks
  // wood, wine, crystal and sulfur but not marble, and line 639 writes the
  // marble figure regardless, so loading marble the town does not have drives
  // its stock negative. Pending quirk flag `colonizeSkipsMarbleCheck`.
  const affordable =
    user.transports >= transporters &&
    after.wood >= 0 &&
    after.wine >= 0 &&
    after.crystal >= 0 &&
    after.sulfur >= 0 &&
    peoples >= 0 &&
    gold >= 0 &&
    transports >= 0
  if (!affordable) return fail('not_enough_resources')

  // Cargo space has to cover the colony's own 1250 wood and 40 settlers; the
  // 9000 gold rides along free.
  const load =
    send.wood +
    send.wine +
    send.marble +
    send.crystal +
    send.sulfur +
    COLONY_WOOD_COST +
    COLONY_PEOPLE_COST
  if (transporters * config.transportCapacity < load) return fail('not_enough_cargo_space')

  const island = state.islands[input.islandId]
  if (!island || !island.slots) return fail('island_not_loaded')
  if ((island.slots[input.slot] ?? 0) !== 0) return fail('island_slot_occupied')

  const colony = newColonyTown(input.newTownId, user.id, input.islandId, input.slot)
  island.slots[input.slot] = colony.id
  state.towns.push(colony)

  town.resources.wood = after.wood
  town.resources.wine = after.wine
  town.resources.marble = after.marble
  town.resources.crystal = after.crystal
  town.resources.sulfur = after.sulfur
  town.peoples = peoples
  // Stored, but transient: the next tick recomputes actions as
  // actionPointsByLevel(townHall) - fleets, and the new mission is one fleet.
  town.actionPoints -= 1
  user.gold = gold
  user.transports = transports

  const mission: MissionState = {
    id: input.newMissionId,
    userId: user.id,
    fromTownId: town.id,
    toTownId: colony.id,
    kind: 'colonise',
    loadingFromStartedAt: ctx.now,
    loadingToStartedAt: null,
    departedAt: null,
    returnStartedAt: null,
    arrivesAt: null,
    abortPercent: 0,
    transports: transporters,
    // The fleet carries the fee as cargo. Only `wood - 1000` is unloaded on
    // arrival (update_model.php:673), so 1000 of the 1250 evaporates; aborting
    // the mission instead refunds all of it (actions.php:98).
    cargo: {
      ...send,
      wood: send.wood + COLONY_WOOD_COST,
      gold: COLONY_GOLD_COST,
      peoples: COLONY_PEOPLE_COST,
    },
    units: {},
    tradeTerms: {},
  }
  state.missions.push(mission)
  // The loading countdown on the launch and military screens reads
  // `arrivesAt`; without this it stays blank until the first tick after the
  // action, which reads as "nothing is happening" during a long load.
  projectArrival(state, mission, ctx.now)

  return ok(state, [
    { kind: 'createTown', town: colony },
    { kind: 'createMission', mission },
  ])
}

/**
 * The row the legacy INSERTed with four columns, everything else coming from
 * the table defaults (actions.php:618, beta.sql:534-595).
 *
 * pos0 is a town hall at level 0: that is what marks the town as still in
 * transit. The 500 wood and 40 citizens are free defaults -- the wood is
 * overwritten when the fleet lands, the citizens are not, which is what the 40
 * settlers in the cargo actually become.
 */
function newColonyTown(id: number, userId: number, islandId: number, slot: number): TownState {
  const bySlot: Record<number, { type: number; level: number }> = {}
  for (let i = 0; i <= 14; i++) bySlot[i] = { type: 0, level: 0 }
  bySlot[0] = { type: BUILDING.TOWN_HALL, level: 0 }

  return {
    id,
    userId,
    islandId,
    slot,
    name: 'Polis',
    lastUpdate: 0,
    resources: { ...emptyResources(), wood: 500 },
    peoples: 40,
    workers: 0,
    tradegood: 0,
    scientists: 0,
    templer: 0,
    buildings: { bySlot },
    buildQueue: [],
    buildStartedAt: null,
    spies: 0,
    spyTrainingStartedAt: null,
    workersWood: 0,
    tradegoodWood: 0,
    wonderDonated: 0,
    actionPoints: 3,
    tavernWine: 0,
    army: {},
    landQueue: [],
    landQueueStartedAt: null,
    navalQueue: [],
    navalQueueStartedAt: null,
  }
}

// ---------------------------------------------------------------------------
// abolishColony (actions.php:36-59)
// ---------------------------------------------------------------------------

/**
 * Raze the current town. No refund, no confirmation beyond the client's.
 *
 * The guard is "not the capital, and no missions at all". Load_Missions pulls
 * every mission with either end in any of the player's towns, so a single
 * inbound enemy fleet -- anywhere in the empire -- blocks the button until it
 * resolves (data_model.php:71-87).
 *
 * Spies stationed in or aimed at the town are not cleaned up, and the mission
 * table is only safe because of the guard above.
 */
export function abolishColony(state: PlayerState): ActionResult {
  const { user } = state
  const town = currentTown(state)
  if (!town) return fail('no_current_town')
  if (town.id === user.capitalTownId || state.missions.length > 0) {
    return fail('unable_leave_colony')
  }

  const island = state.islands[town.islandId]
  if (island?.slots) island.slots[town.slot] = 0

  for (const route of state.tradeRoutes) {
    // Two UPDATEs in the legacy, one per endpoint; a route that both starts and
    // ends here is hit by both. `send_resource = 0` is wood, not "none".
    if (route.fromTownId === town.id) {
      route.fromTownId = null
      route.sendCount = 0
      route.resource = 'wood'
      route.sendTime = 0
    }
    if (route.toTownId === town.id) {
      route.toTownId = null
      route.sendCount = 0
      route.resource = 'wood'
      route.sendTime = 0
    }
  }

  state.towns = state.towns.filter((t) => t.id !== town.id)
  user.currentTownId = user.capitalTownId

  // The legacy issues the town_messages DELETE twice, verbatim (:42-43).
  return ok(state, [
    { kind: 'deleteTown', townId: town.id },
    { kind: 'deleteArmy', townId: town.id },
    { kind: 'deleteTownMessages', townId: town.id },
  ])
}

// ---------------------------------------------------------------------------
// changeCapital (actions.php:501-543)
// ---------------------------------------------------------------------------

/**
 * Promote a colony to capital.
 *
 * Not a swap, despite appearances: the colony's governor's residence has its
 * *type* rewritten to 10 and keeps the residence's level, while the old
 * capital's palace slot is zeroed outright -- type and level both. Every level
 * ever invested in the palace is destroyed, and the old capital is left without
 * a residence, so it takes the full colony corruption penalty until one is
 * rebuilt. Pending quirk flag `changeCapitalRazesThePalace`.
 *
 * Neither building is required to be finished: get_position() matches on the
 * slot's type, and for the town the player is currently standing in
 * Player_Model::correct_buildings() stamps queued-but-unbuilt types into the
 * empty slots (player_model.php:378-393). This port only sees stored slots.
 */
export function changeCapital(state: PlayerState, townId: number): ActionResult {
  const { user } = state
  if (townId <= 0) return fail('unknown_town')
  if (townId === user.capitalTownId) return fail('already_capital')

  const towns = activeTowns(state)
  const target = towns.find((t) => t.id === townId)
  const capital = towns.find((t) => t.id === user.capitalTownId)
  if (!target || !capital) return fail('unknown_town')

  const palacePosition = positionOfType(capital, BUILDING.PALACE)
  const colonyPosition = positionOfType(target, BUILDING.PALACE_COLONY)
  if (palacePosition <= 0 || colonyPosition <= 0) return fail('no_palace')

  // A queued palace cannot survive the promotion, so it is filtered out of the
  // new capital's build queue -- but only when the queue holds more than one
  // entry (:510). A queue of exactly one is serialised from an empty array and
  // silently wiped, whatever it was building; build_start is left pointing at
  // the vanished job. Pending quirk flag `changeCapitalWipesSingleEntryQueue`.
  if (target.buildQueue.length > 1) {
    target.buildQueue = target.buildQueue.filter((e) => e.type !== BUILDING.PALACE)
  } else {
    target.buildQueue = []
  }

  const colonySlot = target.buildings.bySlot[colonyPosition]
  if (colonySlot) colonySlot.type = BUILDING.PALACE
  capital.buildings.bySlot[palacePosition] = { type: 0, level: 0 }
  user.capitalTownId = townId

  return ok(state)
}

// ---------------------------------------------------------------------------
// doResearch (actions.php:816-865)
// ---------------------------------------------------------------------------

/**
 * Spend research points on one node.
 *
 * The controller checks the branch number and the point balance and nothing
 * else: get_research() reports the first unmet prerequisite, and doResearch
 * throws that half of the answer away, so anything affordable can be researched
 * in any order. Pending quirk flag `researchIgnoresPrerequisites`. There is no
 * level cap either, so every node is repeatable at `points * (level + 1)`.
 *
 * Out-of-range ids are rejected here. get_research() clamps them to the last
 * node in the branch to price them, but doResearch increments `res{way}_{id}`
 * with the *unclamped* id, so the legacy sent a nonexistent column to MySQL and
 * died on the query -- which also rolled back the point deduction, since both
 * were in the same UPDATE. A rejection is the same observable outcome.
 */
export function doResearch(state: PlayerState, way: number, id: number): ActionResult {
  const w = Math.floor(way)
  const i = Math.floor(id)
  if (w <= 0 || w > 4) return fail('unknown_research')
  const branchSize = RESEARCH_BRANCH_SIZE[w] ?? 0
  if (i <= 0 || i > branchSize) return fail('unknown_research')

  const research = state.user.research
  const info = researchInfo(w, i, research)
  if (research.points < info.points) return fail('not_enough_research_points')

  research.points -= info.points
  // Clearing the branch's "seen" flag is what makes the research advisor light
  // up again for this branch.
  research.branchSeen[w] = false
  const key = `${w}_${i}`
  research.levels[key] = (research.levels[key] ?? 0) + 1

  const scores = state.user.scores
  scores.research = (scores.research ?? 0) + info.points * 0.01
  scores.complete = (scores.complete ?? 0) + 4

  // Wealth. The grant lands in whichever town the player happens to be
  // standing in, is not capped to warehouse capacity, and repeats on every
  // level of the node.
  if (w === 2 && i === 3) {
    const town = currentTown(state)
    if (town) {
      for (const r of RESOURCES) town.resources[r] += WEALTH_RESOURCE_GRANT
    }
  }

  return ok(state)
}

// ---------------------------------------------------------------------------
// premium (actions.php:1353-1382)
// ---------------------------------------------------------------------------

/**
 * Buy one week of a boost.
 *
 * A live boost is extended from its current expiry, an inactive one starts now.
 * The legacy tested `premium_x > 0` rather than `> time()`, which would have
 * extended an already-expired stamp into the past -- unreachable in practice
 * because Update_Player zeroes expired boosts before any controller runs
 * (update_model.php:48-54), exactly as tickPlayer() nulls them.
 */
export function buyPremium(
  state: PlayerState,
  type: PremiumKind,
  ctx: ActionContext,
): ActionResult {
  const cost = PREMIUM_COST[type]
  // premium_cost() returns NULL for an unknown boost, and `$ambrosy >= NULL`
  // is true, so the legacy charged nothing and granted nothing.
  if (cost === undefined) return fail('unknown_premium_type')
  if (state.user.ambrosia < cost) return fail('not_enough_ambrosia')

  const until = state.user.premium[type]
  state.user.premium[type] =
    until != null && until > 0 ? until + PREMIUM_DURATION : ctx.now + PREMIUM_DURATION
  state.user.ambrosia -= cost

  return ok(state)
}

// ---------------------------------------------------------------------------
// options (actions.php:1383-1503)
// ---------------------------------------------------------------------------

/**
 * users.options_select, the city-select widget mode. Not on UserState yet --
 * types.ts belongs to another module -- so callers thread it through.
 */


/**
 * Rename the account.
 *
 * `taken` is the answer to the legacy's `SELECT ... WHERE login = ?`; the rules
 * layer cannot run that query, and the check is case-sensitive in MySQL's
 * collation, not in TypeScript, so the caller must do the lookup.
 */
export function renameLogin(state: PlayerState, name: string, taken: boolean): ActionResult {
  const login = stripTags(name)
  if (login === state.user.login) return fail('unchanged')
  if (login === '') return fail('invalid_name')
  if (taken) return fail('login_taken')

  state.user.login = login
  return ok(state)
}

/**
 * Password changes are the API layer's business: the rules engine must not know
 * what the hash is, so this only signals intent.
 *
 * The caller owns the legacy's checks (actions.php:1411-1438): the old password
 * must match the stored hash, the new one must equal its confirmation, and the
 * new one must differ from the old. Note that the two "not empty" guards there
 * compare *md5 digests* against '' and therefore never fire -- an empty new
 * password is accepted. Pending quirk flag `emptyPasswordAccepted` -- it is a
 * security hole rather than a balance decision, so leave it off.
 */
export function changePassword(state: PlayerState): ActionResult {
  return ok(state, [{ kind: 'changePassword' }])
}

/** City-select widget mode, 0..2 (actions.php:1441-1452). */
export function setCitySelectMode(
  state: PlayerState,
  options: AccountOptions,
  mode: number,
): ActionResult {
  const value = Math.floor(mode)
  if (value === options.citySelect) return fail('unchanged')
  if (value < 0 || value > 2) return fail('invalid_option')

  options.citySelect = value
  return ok(state)
}

/**
 * Dismiss the tutorial for good. 999 is the "finished" sentinel and the guard is
 * one-way: once set it can only be moved by tutorials('set')
 * (actions.php:1453-1463). The legacy fired this on the literal posted value
 * -2 and ignored every other value; that mapping belongs to the API layer.
 */
export function skipTutorial(state: PlayerState): ActionResult {
  if (state.user.tutorialStep >= 999) return fail('unchanged')
  state.user.tutorialStep = 999
  return ok(state)
}

// ---------------------------------------------------------------------------
// rename (actions.php:1554-1565)
// ---------------------------------------------------------------------------

/**
 * Rename the current town. No length limit -- the legacy let MySQL truncate at
 * varchar(255) -- and no trim either, so a name of spaces passes. An empty one
 * leaves the controller without rendering anything at all, which is the blank
 * page players reported.
 */
export function renameTown(state: PlayerState, name: string): ActionResult {
  const town = currentTown(state)
  if (!town) return fail('no_current_town')
  const stripped = stripTags(name)
  if (stripped === '') return fail('invalid_name')

  town.name = stripped
  return ok(state)
}

// ---------------------------------------------------------------------------
// tutorials (actions.php:1920-1936)
// ---------------------------------------------------------------------------

export type TutorialAction = 'next' | 'set'

/**
 * Move the tutorial cursor.
 *
 * Both branches are unvalidated `UPDATE users SET tutorial = ...` statements
 * driven straight from the URL: 'next' has no ceiling and will walk past the
 * 999 sentinel, and 'set' writes whatever number it is given.
 */
export function tutorials(state: PlayerState, action: TutorialAction, id = 0): ActionResult {
  if (action === 'next') {
    state.user.tutorialStep += 1
    return ok(state)
  }
  state.user.tutorialStep = Math.floor(id)
  return ok(state)
}

// ---------------------------------------------------------------------------
// messages (actions.php:1289-1352)
// ---------------------------------------------------------------------------

/**
 * A row of `*_user_messages` (beta.sql:703-716). Player-to-player mail is not
 * part of PlayerState, so the caller loads the mailbox and passes it in.
 */
export interface UserMessage {
  id: number
  from: number
  to: number
  type: number
  /** Epoch seconds. */
  date: number
  text: string
  checkedFrom: number
  checkedTo: number
  deletedFrom: number
  deletedTo: number
  archivedFrom: number
  archivedTo: number
}

/**
 * What Load_User_Messages() produces (player_model.php:338-353): mail from the
 * last seven days only, excluding anything already deleted or archived on the
 * viewer's side. Older mail is invisible to every action below -- it cannot be
 * read or deleted, only waited out.
 */
export interface Mailbox {
  inbox: UserMessage[]
  outbox: UserMessage[]
}

/**
 * Send mail. `type` is validated as `> 0 and <= 1`, so 1 is the only value the
 * game ever accepts. Empty bodies are allowed, there is no rate limit, and
 * nothing stops a player messaging themselves.
 *
 * `recipientExists` stands in for Data_Model::Load_User($id).
 */
export function sendUserMessage(
  state: PlayerState,
  input: { toUserId: number; type: number; text: string; recipientExists: boolean },
  ctx: ActionContext,
): ActionResult {
  const type = Math.floor(input.type)
  if (type <= 0 || type > 1) return fail('unknown_message_type')
  if (!input.recipientExists) return fail('unknown_recipient')

  return ok(state, [
    {
      kind: 'sendUserMessage',
      toUserId: input.toUserId,
      type,
      date: ctx.now,
      text: stripTags(input.text),
    },
  ])
}

/**
 * Delete mail, single or in bulk.
 *
 * The two are one branch in the legacy: if `id` names a message in the inbox it
 * is deleted and the posted checkbox set is ignored entirely; only when it does
 * not (`id = 0` from the default argument, say) does the bulk pass run.
 *
 * The bulk pass distinguishes the two mailboxes by checkbox *value*: 1 deletes
 * a sent message, the string 'read' deletes a received one. Its ownership
 * guards are `$message->from = $this->...->id` -- assignments, not comparisons
 * (:1319, :1329) -- so they are always true and additionally overwrite the
 * loaded row. Harmless only because Load_User_Messages already filtered both
 * lists by the current user. Pending quirk flag
 * `mailOwnershipGuardIsAnAssignment`.
 */
export function deleteUserMessages(
  state: PlayerState,
  mailbox: Mailbox,
  input: { id?: number; selection?: Record<number, number | string> },
  ctx: ActionContext,
): ActionResult {
  const id = Math.floor(input.id ?? 0)
  const single = mailbox.inbox.find((m) => m.id === id)
  if (single) {
    single.deletedTo = ctx.now
    return ok(state, [
      { kind: 'markUserMessage', messageId: single.id, field: 'deletedTo', at: ctx.now },
    ])
  }

  const selection = input.selection
  if (!selection) return fail('unknown_message')

  const intents: ActionIntent[] = []
  for (const message of mailbox.outbox) {
    // The legacy compared a $_POST value with `== 1` (actions.php:1320). Form
    // fields arrive as strings, so PHP coerced and '1', '01', ' 1' and 1 all
    // matched; a strict === would silently ignore every one of them.
    if (looselyOne(selection[message.id])) {
      message.deletedFrom = ctx.now
      intents.push({
        kind: 'markUserMessage',
        messageId: message.id,
        field: 'deletedFrom',
        at: ctx.now,
      })
    }
  }
  for (const message of mailbox.inbox) {
    if (selection[message.id] === 'read') {  // actions.php:1330, a string compare in both
      message.deletedTo = ctx.now
      intents.push({
        kind: 'markUserMessage',
        messageId: message.id,
        field: 'deletedTo',
        at: ctx.now,
      })
    }
  }

  return ok(state, intents)
}

/**
 * Mark a received message read. Sent mail has a `checked_from` column that
 * nothing ever writes.
 */
export function readUserMessage(
  state: PlayerState,
  mailbox: Mailbox,
  id: number,
  ctx: ActionContext,
): ActionResult {
  const message = mailbox.inbox.find((m) => m.id === Math.floor(id))
  if (!message) return fail('unknown_message')

  message.checkedTo = ctx.now
  return ok(state, [
    { kind: 'markUserMessage', messageId: message.id, field: 'checkedTo', at: ctx.now },
  ])
}

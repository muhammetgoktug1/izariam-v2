/**
 * Domain state the rules operate on.
 *
 * Everything here is plain data: no DB rows, no ORM entities, no Express.
 * The API layer loads a PlayerState, hands it to a rule, and persists the
 * result. Keeping the boundary hard is what makes the economy testable
 * against the legacy golden fixtures.
 *
 * Time is epoch **seconds** throughout, matching the legacy `time()` that
 * every formula was written against. Converting to Date happens at the DB
 * boundary, not here.
 */

export type Resource = 'wood' | 'wine' | 'marble' | 'crystal' | 'sulfur'

export const RESOURCES: readonly Resource[] = ['wood', 'wine', 'marble', 'crystal', 'sulfur']

export type Resources = Record<Resource, number>

/** The four luxuries. Wood is never one: an island's monument is raised with
 *  goods, and every island produces wood. */
export type WonderGood = Exclude<Resource, 'wood'>

/** Building type ids, as used by gamedata/buildings.json and the legacy
 *  building_class_by_type(). Only the ones the rules branch on are named. */
export const BUILDING = {
  GROUND: 0,
  TOWN_HALL: 1,
  PORT: 2,
  ACADEMY: 3,
  SHIPYARD: 4,
  BARRACKS: 5,
  WAREHOUSE: 6,
  WALL: 7,
  TAVERN: 8,
  MUSEUM: 9,
  PALACE: 10,
  EMBASSY: 11,
  BRANCH_OFFICE: 12,
  WORKSHOP: 13,
  SAFEHOUSE: 14,
  PALACE_COLONY: 15,
  FORESTER: 16,
  STONEMASON: 17,
  GLASSBLOWING: 18,
  WINEGROWER: 19,
  ALCHEMIST: 20,
  CARPENTERING: 21,
  ARCHITECT: 22,
  OPTICIAN: 23,
  VINEYARD: 24,
  FIREWORKER: 25,
  TEMPLE: 26,
} as const

/** Refining building per island trade resource, mirroring the legacy
 *  Update_Towns switch on island.trade_resource. */
export const REFINERY_BY_TRADE_RESOURCE: Record<number, number> = {
  1: BUILDING.WINEGROWER,
  2: BUILDING.STONEMASON,
  3: BUILDING.GLASSBLOWING,
  4: BUILDING.ALCHEMIST,
}

/** Island trade_resource -> the resource column it fills. */
export const RESOURCE_BY_TRADE_RESOURCE: Record<number, Resource> = {
  0: 'wood',
  1: 'wine',
  2: 'marble',
  3: 'crystal',
  4: 'sulfur',
}

export interface ResearchState {
  /** Keyed "way_id", e.g. "2_11". Absent means level 0. */
  levels: Record<string, number>
  points: number
  /** Per-branch "player has seen the newest unlock" flag. */
  branchSeen: Record<number, boolean>
}

export function researchLevel(r: ResearchState, way: number, id: number): number {
  return r.levels[`${way}_${id}`] ?? 0
}

export interface BuildQueueEntry {
  slot: number
  type: number
}

export interface UnitQueueEntry {
  unitType: number
  count: number
}

export interface BranchOffer {
  /**
   * 1 = the town sells this resource to visitors, 0 = it buys.
   * The column defaults to 1 with a count of 0 (towns.branch_trade_*_type).
   */
  direction: 0 | 1
  count: number
  price: number
}

export interface BranchOfficeState {
  /** Which side of the market the search screen looks for: 1 = offers to buy
   *  from, 0 = buyers to sell to. */
  searchType: number
  /** 0..4, indexing RESOURCE_BY_TRADE_RESOURCE. */
  searchResource: number
  searchRadius: number
  offers: Record<Resource, BranchOffer>
}

export interface TownBuildings {
  /** Board position 0..14 -> what stands there. The only stored form.
   *
   *  There is deliberately no type -> level cache here. An earlier shape had
   *  one and nothing ever populated it, so every reader silently saw level 0:
   *  espionage lost the safehouse term from its risk formula and the cost
   *  functions lost the carpentry and barracks discounts. Derive it with
   *  levelsByType() instead. */
  bySlot: Record<number, { type: number; level: number }>
}

export interface TownState {
  id: number
  userId: number
  islandId: number
  slot: number
  name: string
  /** Epoch seconds; the watermark the tick advances from. */
  lastUpdate: number

  resources: Resources
  /** Unassigned citizens. */
  peoples: number
  workers: number
  tradegood: number
  scientists: number
  templer: number

  buildings: TownBuildings
  buildQueue: BuildQueueEntry[]
  buildStartedAt: number | null

  spies: number
  spyTrainingStartedAt: number | null

  workersWood: number
  tradegoodWood: number
  /** Luxury goods this town has given to its island's monument, all three
   *  added together -- the roster shows one figure per town. */
  wonderDonated: number

  actionPoints: number
  tavernWine: number

  /** unitType (1..23) -> count garrisoned here. */
  army: Record<number, number>
  landQueue: UnitQueueEntry[]
  landQueueStartedAt: number | null
  navalQueue: UnitQueueEntry[]
  navalQueueStartedAt: number | null

  /** Trading-post shelf and search filters. Absent when the town has no
   *  branch office, which the rules read as an empty offer on all five
   *  resources. */
  branchOffice?: BranchOfficeState
}

export interface IslandState {
  id: number
  name: string
  x: number
  y: number
  type: number
  tradeResource: number
  wonder: number
  woodLevel: number
  tradeLevel: number
  woodDonated: number
  tradeDonated: number
  woodUpgradeStartedAt: number | null
  tradeUpgradeStartedAt: number | null

  /** The monument's expansion, 1..5. Every island starts at 1. */
  wonderLevel: number
  /** Luxury goods donated toward the next expansion. The island's own trade
   *  good is never accepted, so its entry stays at zero. */
  wonderDonated: Record<WonderGood, number>

  /** Occupied slots, slot -> townId. Only populated when the caller needs it. */
  slots?: Record<number, number>
}

export type PremiumKind =
  | 'account'
  | 'wood'
  | 'wine'
  | 'marble'
  | 'crystal'
  | 'sulfur'
  | 'capacity'

/**
 * A miracle the player has called from one island's wonder.
 *
 * One row per island, replaced on each activation: `activatedAt` alone decides
 * both whether the effect is still running and whether it may be called again
 * (temple.ts). Nothing here is legacy -- the 2012 game has the wonder texts and
 * no way to use them.
 */
export interface MiracleState {
  islandId: number
  /** 1..8, matching `islands.wonder`. */
  wonder: number
  /** The level the island's faith unlocked when it was called, 1..5. */
  level: number
  activatedAt: number
}

/** Per-account UI preferences. Only one exists (actions.php:1441-1452). */
export interface AccountOptions {
  /** City-select widget mode, 0..2. */
  citySelect: number
}

export interface UserState {
  id: number
  login: string
  gold: number
  ambrosia: number
  transports: number
  tutorialStep: number
  currentTownId: number | null
  capitalTownId: number | null
  research: ResearchState
  /** Expiry epoch seconds per boost; null or past = inactive. */
  premium: Partial<Record<PremiumKind, number | null>>
  /** Miracles called from island wonders, at most one row per island. */
  miracles: MiracleState[]
  scores: Record<string, number>
  options: AccountOptions
}

export type MissionKind = 'colonise' | 'transport' | 'buy' | 'sell' | 'attack' | 'plunder'

export interface MissionState {
  id: number
  userId: number
  fromTownId: number
  toTownId: number | null
  kind: MissionKind
  loadingFromStartedAt: number | null
  loadingToStartedAt: number | null
  departedAt: number | null
  returnStartedAt: number | null
  arrivesAt: number | null
  abortPercent: number
  transports: number
  cargo: Resources & { gold: number; peoples: number }
  units: Record<number, number>
  tradeTerms: Partial<Record<Resource, { count: number; price: number }>>
}

export interface TradeRouteState {
  id: number
  userId: number
  fromTownId: number | null
  toTownId: number | null
  nextRunAt: number
  resource: Resource
  sendCount: number
  sendTime: number
}

export interface SpyState {
  id: number
  userId: number
  fromTownId: number
  toTownId: number | null
  risk: number
  missionType: number
  startedAt: number | null
  lastUpdate: number
}

/** Everything one player's tick needs, loaded in a single graph read. */
export interface PlayerState {
  user: UserState
  towns: TownState[]
  /** Every island referenced by a town or mission, keyed by id. */
  islands: Record<number, IslandState>
  missions: MissionState[]
  tradeRoutes: TradeRouteState[]
  spies: SpyState[]
}

/** A message the tick wants written. Structured rather than the legacy
 *  pre-rendered HTML, so the client can localise it. */
export interface PendingMessage {
  channel: 'town' | 'spy'
  userId: number
  townId?: number
  kind: string
  params: Record<string, unknown>
}

/**
 * What every player action returns.
 *
 * Actions mutate the PlayerState they are handed and report what happened;
 * they never touch the database. `intents` carries work the rules layer is
 * deliberately not allowed to do itself -- hashing a password, sending mail --
 * for the API layer to carry out inside the same transaction.
 *
 * A rejection is a plain reason string rather than a thrown error: most of the
 * legacy's failure paths were silent no-ops (a redirect with nothing changed),
 * so the caller usually wants to report rather than abort.
 */
export interface ActionOk {
  ok: true
  messages: PendingMessage[]
  intents?: ActionIntent[]
}

export interface ActionFail {
  ok: false
  reason: string
}

export type ActionResult = ActionOk | ActionFail

/**
 * Side effects the rules describe but refuse to perform.
 *
 * Two kinds live here. Some are outside the rules layer's remit on principle
 * -- hashing a password, sending mail. The rest are row lifecycle events that
 * the in-memory PlayerState cannot express: it holds one player's graph, so
 * creating a town, deleting another player's message or inserting a mission
 * has to be handed to the persistence layer to run in the same transaction.
 */
export type ActionIntent =
  | { kind: 'createTown'; town: TownState }
  | { kind: 'deleteTown'; townId: number }
  | { kind: 'deleteArmy'; townId: number }
  | { kind: 'deleteTownMessages'; townId: number }
  | { kind: 'createMission'; mission: MissionState }
  | { kind: 'changePassword' }
  | { kind: 'renameLogin'; login: string }
  | { kind: 'sendEmail'; template: string; params: Record<string, unknown> }
  | { kind: 'sendUserMessage'; toUserId: number; type: number; date: number; text: string }
  | {
      kind: 'markUserMessage'
      messageId: number
      field: 'checkedTo' | 'deletedTo' | 'deletedFrom'
      at: number
    }

/** Everything an action needs beyond the state itself. */
export interface ActionContext {
  /** Epoch seconds. */
  now: number
}

export function actionOk(messages: PendingMessage[] = [], intents?: ActionIntent[]): ActionOk {
  return intents && intents.length > 0 ? { ok: true, messages, intents } : { ok: true, messages }
}

export function actionFail(reason: string): ActionFail {
  return { ok: false, reason }
}

export function emptyResources(): Resources {
  return { wood: 0, wine: 0, marble: 0, crystal: 0, sulfur: 0 }
}

/**
 * Building levels keyed by type -- the legacy `$levels[]` array that the cost
 * functions index (player_model.php:91-96). Slots are scanned in order, so
 * when two hold the same building type the later one wins, as it did there.
 */
export function levelsByType(t: TownState): Record<number, number> {
  const levels: Record<number, number> = {}
  for (let i = 1; i <= 26; i++) levels[i] = 0
  for (let slot = 0; slot <= 14; slot++) {
    const b = t.buildings.bySlot[slot]
    if (!b) continue
    levels[b.type] = b.level
  }
  return levels
}

export function buildingLevel(t: TownState, type: number): number {
  let level = 0
  for (let slot = 0; slot <= 14; slot++) {
    const b = t.buildings.bySlot[slot]
    if (b && b.type === type) level = b.level
  }
  return level
}

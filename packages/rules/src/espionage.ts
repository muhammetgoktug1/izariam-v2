/**
 * Espionage: spy travel (Update_Model::Update_Spyes,
 * izariam/models/update_model.php:1036-1153) and mission resolution
 * (Actions::espionage, izariam/controllers/actions.php:876-1191).
 *
 * Two halves of one system. The tick walks spies between towns and decides
 * whether they survive the trip; the resolution spends an arrived spy on one of
 * eight orders and produces a report. Both roll against the same defence term
 * but compose it differently, and neither composes it the way the safehouse
 * screen advertises -- see riskFromDefences.
 *
 * The legacy built every report as an HTML table inside the controller
 * (actions.php:905-1103). This returns structured data instead; wording,
 * number formatting and icons belong to the client. Note the legacy printed
 * resource and gold counts through number_format(), so what a 2012 player saw
 * was the rounded value of the float returned here.
 *
 * A spy reads a town its owner does not own, so the target is not reachable
 * from PlayerState. The caller passes it in as a snapshot. Those snapshot
 * types are declared locally; combat will want the same shapes, at which point
 * they belong in types.ts.
 */

import { RESEARCH_BRANCH_SIZE } from '@izariam/gamedata'

import {
  researchInfo,
  spyGoldByMission,
  spyRiskByMission,
  spyTimeByCoords,
} from './costs.js'
import {
  BUILDING,
  buildingLevel,
  researchLevel,
  type PendingMessage,
  type PlayerState,
  type ResearchState,
  type Resources,
  type SpyState,
  type TownState,
} from './types.js'

// ---------------------------------------------------------------------------
// Randomness
// ---------------------------------------------------------------------------

/**
 * PHP's rand(a, b) draws an integer uniformly from the *closed* interval
 * [a, b], so rand(0, 100) has 101 outcomes, not 100. The port takes a uniform
 * [0, 1) generator and maps it with `a + floor(u * (b - a + 1))`, which gives
 * each of the b - a + 1 outcomes equal probability. u is never 1, so the top of
 * the range comes from the last bucket rather than a boundary case; the clamp
 * only guards against a caller handing us a generator that violates its
 * contract (a stubbed sequence that runs off its end, typically).
 *
 * Draw order is part of the behaviour and fixtures depend on it: each call site
 * below documents how many draws it consumes and when. Exported so a fixture
 * can replay a recorded PHP sequence by inverting the same mapping.
 */
export function phpRandInt(rng: () => number, min: number, max: number): number {
  const span = max - min + 1
  const v = min + Math.floor(rng() * span)
  if (v < min) return min
  if (v > max) return max
  return v
}

// ---------------------------------------------------------------------------
// Foreign towns
// ---------------------------------------------------------------------------

/** One occupied board position of a town, as stored in TownBuildings.bySlot. */
export interface SlotBuilding {
  type: number
  level: number
}

/**
 * The part of a town a spy can act against. Assembled by the caller from a
 * foreign town row plus its island; nothing here is owned by the acting player.
 */
export interface SpyTargetTown {
  id: number
  /** Owner of the town, needed to fetch treasury and last-visit intel. */
  userId: number
  name: string
  islandId: number
  x: number
  y: number
  /** Idle spies garrisoned here. Each adds 5 to the risk of every mission. */
  spies: number
  /** Slot-0 level. Confusingly this *lowers* risk -- see riskFromDefences. */
  townHallLevel: number
  safehouseLevel: number
}

/**
 * Town-hall and safehouse levels the way get_position() (data_model.php:1037)
 * finds them: it scans slots 0..14 without breaking, so the *last* slot holding
 * a safehouse wins, and a position of 0 is read back as level 0 because the
 * caller guards `($to_position > 0) ? ... : 0`. Slot 0 always holds the town
 * hall, so that guard never fires in practice.
 */
export function targetDefences(bySlot: Record<number, SlotBuilding>): {
  townHallLevel: number
  safehouseLevel: number
} {
  let safehouseSlot = 0
  for (let slot = 0; slot <= 14; slot++) {
    if (bySlot[slot]?.type === BUILDING.SAFEHOUSE) safehouseSlot = slot
  }
  return {
    townHallLevel: bySlot[0]?.level ?? 0,
    safehouseLevel: safehouseSlot > 0 ? (bySlot[safehouseSlot]?.level ?? 0) : 0,
  }
}

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

/**
 * The defence term shared by travel and mission resolution:
 *
 *   5 * targetSpies + 2 * targetSafehouse - 2 * targetTownHall - 2 * mySafehouse
 *
 * Two of those signs are wrong. Subtracting the *target's* town hall level
 * (update_model.php:1055, actions.php:892, safehouseMissions.php:97) means a
 * developed victim is a safer victim: a level 30 town hall pays -60 risk, which
 * on its own drives every mission to the 0 floor. And the attacker's own
 * safehouse subtracts too, so stacking safehouse levels at home protects spies
 * abroad. Both are reproduced.
 *
 * The two callers then differ in *where* they floor this and where they add the
 * mission's own risk -- see each call site.
 */
export function riskFromDefences(target: SpyTargetTown, mySafehouseLevel: number): number {
  return (
    5 * target.spies +
    2 * target.safehouseLevel -
    2 * target.townHallLevel -
    2 * mySafehouseLevel
  )
}

/** Spy row mission_type values. Anything else is never written to the table. */
export const SPY_MISSION = {
  /** Arrived and waiting for orders. */
  IDLE: 0,
  OUTBOUND: 1,
  RETURNING: 2,
} as const

// ---------------------------------------------------------------------------
// Travel
// ---------------------------------------------------------------------------

export interface SpyTickOptions {
  /**
   * Resolves the town a spy was sent to. Returning undefined skips the spy.
   *
   * The legacy had no such case: Load_Town() on a vanished row yields NULL and
   * PHP then reads every field off it as 0, so the spy would travel to island
   * coordinates (0, 0) against a town with no defences. That is a fatal-adjacent
   * accident rather than behaviour, so this port leaves the spy parked instead.
   */
  target?: (townId: number) => SpyTargetTown | undefined
  rng?: () => number
}

/**
 * Advance every spy sent from `town`, matching TickHooks.spies.
 *
 * Called once per town at the bottom of the town loop
 * (update_model.php:426), which is why it takes a town rather than walking
 * state.spies itself: `spyes` is indexed by origin town and the acting
 * safehouse level comes from that same town.
 *
 * Wire it up as
 * `hooks.spies = (s, t, n, m) => tickSpies(s, t, n, m, { target, rng })`, or use
 * createSpiesHook. The defaults exist only so the signature stays assignable to
 * TickHooks.spies; with no target supplied nothing resolves.
 *
 * RNG draws, in order, per spy whose travel time has elapsed: one rand(0, 100)
 * for the risk check, then one rand(0, 2) only if that check failed.
 */
export function tickSpies(
  state: PlayerState,
  town: TownState,
  now: number,
  messages: PendingMessage[],
  options: SpyTickOptions = {},
): void {
  const rng = options.rng ?? Math.random
  const lookup = options.target
  if (!lookup) return

  const origin = state.islands[town.islandId]
  if (!origin) return
  const mySafehouseLevel = buildingLevel(town, BUILDING.SAFEHOUSE)

  // Snapshot: the loop deletes from state.spies.
  for (const spy of state.spies.filter((s) => s.fromTownId === town.id)) {
    if (spy.missionType <= SPY_MISSION.IDLE) continue
    if (spy.toTownId == null) continue

    const target = lookup(spy.toTownId)
    if (!target) continue

    const travel = spyTimeByCoords(origin.x, target.x, origin.y, target.y)

    // A returning spy is handed a flat 0 rather than the floored formula
    // (update_model.php:1055). rand(0, 100) >= 0 always holds, so a spy that
    // starts for home always gets there and the whole capture branch below is
    // dead for mission_type 2. The draw still happens, and still advances the
    // generator.
    let risk =
      spy.missionType === SPY_MISSION.RETURNING
        ? 0
        : // spy_risk_by_mission is keyed by the *travel* state here, so this is
          // the flat 5 of mission_type 1 and nothing to do with what the spy was
          // sent to do.
          spyRiskByMission(spy.missionType) + spy.risk + riskFromDefences(target, mySafehouseLevel)

    risk = spy.missionType === SPY_MISSION.OUTBOUND ? Math.max(5, risk) : Math.max(0, risk)

    const arrivesAt = (spy.startedAt ?? 0) + travel
    if (arrivesAt > now) continue

    if (phpRandInt(rng, 0, 100) >= risk) {
      if (spy.missionType === SPY_MISSION.OUTBOUND) {
        // The risk that got the spy here is banked on the row, so the defence
        // term is charged once for the trip and then re-added by every mission
        // the spy runs from now on (resolveEspionage adds `spy.risk` on top of
        // a freshly computed defence term). Risk compounds for as long as the
        // spy lives.
        spy.risk = risk
        spy.missionType = SPY_MISSION.IDLE
        spy.startedAt = null
        messages.push(
          spyMessage(spy, 'spy_arrived', arrivesAt, { targetTownName: target.name }),
        )
      } else if (spy.missionType === SPY_MISSION.RETURNING) {
        town.spies += 1
        removeSpy(state, spy.id)
        messages.push(
          spyMessage(spy, 'spy_returned', arrivesAt, { targetTownName: target.name }),
        )
      }
      // The legacy switch has no default (update_model.php:1069-1109), so a
      // mission_type above 2 would succeed into nothing and the spy would be
      // stuck forever. Unreachable: only 0, 1 and 2 are ever written.
      continue
    }

    // Caught. One in three is executed; the rest are turned around.
    if (phpRandInt(rng, 0, 2) === 0) {
      removeSpy(state, spy.id)
      messages.push(
        spyMessage(spy, 'spy_lost', arrivesAt, { successChance: reportedSuccessChance(risk) }),
      )
    } else {
      spy.missionType = SPY_MISSION.RETURNING
      // Home leg starts at the moment the spy would have arrived, not at `now`,
      // so a player who was offline for a week does not owe a week of travel.
      // (The legacy only wrote this to the database -- update_model.php:1144
      // leaves the in-memory row's mission_start stale for the rest of the
      // request, which the safehouse screen then renders. Nothing to reproduce
      // here: there is one copy of the state.)
      spy.startedAt = arrivesAt
      messages.push(spyMessage(spy, 'spy_recalled', arrivesAt, {}))
    }
  }
}

/** Convenience wrapper producing a TickHooks.spies closure. */
export function createSpiesHook(
  options: SpyTickOptions,
): (state: PlayerState, town: TownState, now: number, messages: PendingMessage[]) => void {
  return (state, town, now, messages) => tickSpies(state, town, now, messages, options)
}

function removeSpy(state: PlayerState, spyId: number): void {
  const i = state.spies.findIndex((s) => s.id === spyId)
  if (i >= 0) state.spies.splice(i, 1)
}

/**
 * The "chance of success" quoted back to the player when a spy is caught
 * (update_model.php:1116, actions.php:1142). It is not the real one: the roll
 * is rand(0, 100) >= risk, which succeeds with probability (101 - risk) / 101.
 * Kept because it is what the message says.
 */
function reportedSuccessChance(risk: number): number {
  return Math.max(0, 100 - risk)
}

function spyMessage(
  spy: SpyState,
  kind: string,
  at: number,
  params: Record<string, unknown>,
): PendingMessage {
  return {
    channel: 'spy',
    userId: spy.userId,
    townId: spy.fromTownId,
    kind,
    params: {
      spyId: spy.id,
      fromTownId: spy.fromTownId,
      toTownId: spy.toTownId,
      at,
      ...params,
    },
  }
}

// ---------------------------------------------------------------------------
// Mission resolution
// ---------------------------------------------------------------------------

/**
 * Orders that can be given to a spy standing in a foreign town. Ids are the
 * third URL segment of actions/espionage and index spy_risk_by_mission and
 * spy_gold_by_mission (data_model.php:1723-1756).
 */
export const ESPIONAGE_MISSION = {
  TREASURY: 3,
  WAREHOUSE: 4,
  RESEARCH: 5,
  ONLINE_STATUS: 6,
  GARRISON: 7,
  FLEET_MOVEMENTS: 8,
  CORRESPONDENCE: 9,
  /** "Отозвать шпиона" -- send the spy home. Advertised as free and riskless. */
  RECALL: 10,
} as const

export type EspionageMission = (typeof ESPIONAGE_MISSION)[keyof typeof ESPIONAGE_MISSION]

/** Everything the eight orders can read off the target, loaded by the caller. */
export interface EspionageIntel {
  /** Target owner's treasury (mission 3). */
  gold: number
  /** Target owner's last request, epoch seconds (mission 6). */
  lastVisit: number
  /** Target town's warehouse (mission 4). */
  resources: Resources
  /** Target owner's research (mission 5). */
  research: ResearchState
  /** Target town's garrison, unit id -> count (mission 7). */
  army: Record<number, number>
}

export interface UnitCount {
  unitType: number
  count: number
}

/**
 * What the legacy would have printed, as data.
 *
 * `points` on a research branch is the cost of the node the branch is working
 * on, already multiplied for repeat levels by researchInfo().
 */
export interface ResearchBranchIntel {
  way: number
  /**
   * The node the branch is currently on, or null when every node below the
   * branch's repeatable future tech is finished and that future tech has not
   * been started -- the legacy never assigns $this->ways[$i] in that state and
   * renders a blank cell (actions.php:938-968).
   */
  current: { id: number; points: number } | null
  /**
   * The node whose *name* the report shows. When the current node has an unmet
   * prerequisite the legacy prints the prerequisite instead of the node, so
   * spying on a blocked branch tells you what the target still needs rather
   * than what they are researching. Null mirrors the blank cell above.
   */
  displayed: { way: number; id: number } | null
}

export type EspionageReport =
  | { mission: 3; kind: 'treasury'; gold: number }
  | { mission: 4; kind: 'warehouse'; resources: Resources }
  | { mission: 5; kind: 'research'; branches: ResearchBranchIntel[] }
  | { mission: 6; kind: 'online_status'; online: boolean; townName: string }
  | {
      mission: 7
      kind: 'garrison'
      townName: string
      land: UnitCount[]
      ships: UnitCount[]
      /** Always empty: the legacy hard-codes an empty table. */
      blockingFleet: UnitCount[]
    }
  | { mission: 8; kind: 'fleet_movements'; movements: never[] }
  | { mission: 9; kind: 'correspondence'; letters: never[] }

export type EspionageRejection = 'unknown_spy' | 'mission_out_of_range' | 'not_enough_gold'

export type EspionageOutcome =
  /** Mission ran; `report` holds the payload (null for a recall). */
  | 'succeeded'
  /** Caught and executed. The spy row is gone. */
  | 'spy_lost'
  /** Caught but escaped; the spy is on its way home. */
  | 'spy_withdrew'

export interface EspionageRequest {
  /** The spy's owner. Mutated: gold, and the spy row. */
  actor: PlayerState
  /**
   * The town whose safehouse level offsets the risk.
   *
   * The legacy reads `levels[$this->Player_Model->town_id][14]`
   * (actions.php:892) -- the town the player currently has selected -- while it
   * looks the spy up under the town id in the URL. The safehouse screen only
   * ever links spies belonging to the selected town, so the two agree unless
   * the URL is hand-built. Kept as a separate parameter rather than assumed
   * equal to spy.fromTownId, because that assumption is the bug.
   */
  actingTownId: number
  /**
   * The spy to spend. Looked up across the player's whole spy list.
   *
   * The legacy indexed it as `spyes[$town][$spy]` with `$town` taken from the
   * URL, so a request naming the wrong origin town simply missed and did
   * nothing. Since spy ids are unique and PlayerState.spies only ever holds
   * this player's spies, the guard was doing no work the id lookup does not
   * already do -- the difference is only visible to a hand-built URL.
   */
  spyId: number
  mission: number
  target: SpyTargetTown
  intel: EspionageIntel
  now: number
  rng: () => number
}

export interface EspionageResult {
  /** False when a guard rejected the order. Nothing was read or charged. */
  accepted: boolean
  rejection: EspionageRejection | null
  outcome: EspionageOutcome | null
  /** Total risk the roll was made against, after all the composition below. */
  risk: number
  /** The rand(0, 100) draw. -1 when the order was rejected before rolling. */
  roll: number
  goldSpent: number
  report: EspionageReport | null
  messages: PendingMessage[]
}

/**
 * Run one espionage order against a foreign town.
 *
 * RNG draws, in order: one rand(0, 100) for the risk check, then one rand(0, 1)
 * only if it failed. Note the second draw is *not* the rand(0, 2) the travel
 * tick uses -- a spy caught mid-mission dies half the time, a spy caught in
 * transit only a third of the time (actions.php:1139 vs
 * update_model.php:1113).
 *
 * Mutates `actor`: gold is debited, the spy's risk / mission_type / start time
 * are updated, and a dead spy is spliced out of actor.spies.
 */
export function resolveEspionage(req: EspionageRequest): EspionageResult {
  const { actor, target, intel, now, rng } = req
  const messages: PendingMessage[] = []
  const reject = (rejection: EspionageRejection): EspionageResult => ({
    accepted: false,
    rejection,
    outcome: null,
    risk: 0,
    roll: -1,
    goldSpent: 0,
    report: null,
    messages,
  })

  // floor() on all three URL segments (actions.php:879-881).
  const mission = Math.floor(req.mission)
  const spy = actor.spies.find((s) => s.id === Math.floor(req.spyId))

  if (!spy) return reject('unknown_spy')
  if (mission < 3 || mission > 10) return reject('mission_out_of_range')

  // Note what is *not* checked: nothing requires the spy to have arrived. An
  // order given to a spy still in transit (mission_type 1) or already heading
  // home (2) is accepted, produces a full report on the town it has not
  // reached, and leaves the spy's travel untouched (actions.php:882).

  const cost = spyGoldByMission(mission)
  if (actor.user.gold < cost) return reject('not_enough_gold')

  // An acting town that is not in the player's list contributes a safehouse
  // level of 0, which is what PHP's undefined `levels[$town_id][14]` evaluates
  // to in the arithmetic.
  const actingTown = actor.towns.find((t) => t.id === req.actingTownId)
  const mySafehouseLevel = actingTown ? buildingLevel(actingTown, BUILDING.SAFEHOUSE) : 0

  // Composition differs from the travel tick: the defence term is floored at 0
  // *first*, and only then are the mission's own risk and the spy's carried
  // risk added (actions.php:892-894). The tick sums everything and floors once
  // (update_model.php:1055-1063), so the same defences produce different
  // numbers on the two paths whenever the term is negative -- which, given the
  // town-hall sign, is most of the time.
  let risk = Math.max(0, riskFromDefences(target, mySafehouseLevel))

  // spy_risk_by_mission is called with the spy's *travel state*, not the
  // mission being ordered (actions.php:894). For the normal case -- an idle spy
  // at the target -- that is spy_risk_by_mission(0), which has no branch in the
  // PHP switch and returns NULL, i.e. 0. So the 5/10/20/30/50/60/70 difficulty
  // ladder never applies: peeking at the treasury and counting the garrison are
  // equally dangerous. safehouseMissions.php:97-99 shows the intent by passing
  // the ordered mission id to the same function when it renders the risk
  // percentage, so the screen quotes a number the controller does not use.
  risk += spyRiskByMission(spy.missionType) + spy.risk

  const roll = phpRandInt(rng, 0, 100)
  if (roll >= risk) {
    const report = buildReport(mission, target, intel, now)

    // The recall (mission 10) files no report. Every other mission does.
    if (mission < ESPIONAGE_MISSION.RECALL) {
      messages.push(
        spyMessage(spy, 'spy_report', now, { mission, report, targetTownName: target.name }),
      )
    } else {
      spy.missionType = SPY_MISSION.RETURNING
      spy.startedAt = now
    }

    // Banked, so the defence term is charged again by the next mission on top
    // of itself. Only the success path persists it -- a spy that is caught and
    // escapes keeps its old risk.
    spy.risk = risk

    actor.user.gold -= cost
    return {
      accepted: true,
      rejection: null,
      outcome: 'succeeded',
      risk,
      roll,
      goldSpent: cost,
      report,
      messages,
    }
  }

  // Caught. `if($chance)` on rand(0, 1), so 1 kills and 0 turns the spy around
  // (actions.php:1139-1140).
  let outcome: EspionageOutcome
  if (phpRandInt(rng, 0, 1) === 1) {
    removeSpy(actor, spy.id)
    messages.push(
      spyMessage(spy, 'spy_lost', now, { mission, successChance: reportedSuccessChance(risk) }),
    )
    outcome = 'spy_lost'
  } else {
    spy.missionType = SPY_MISSION.RETURNING
    spy.startedAt = now
    messages.push(spyMessage(spy, 'spy_recalled', now, { mission }))
    outcome = 'spy_withdrew'
  }

  // Charged either way, including when the spy was executed and when the order
  // was the free recall (actions.php:1177 sits outside the success branch).
  // A failed 750-gold fleet watch costs the full 750 and the spy.
  actor.user.gold -= cost

  return {
    accepted: true,
    rejection: null,
    outcome,
    risk,
    roll,
    goldSpent: cost,
    report: null,
    messages,
  }
}

function buildReport(
  mission: number,
  target: SpyTargetTown,
  intel: EspionageIntel,
  now: number,
): EspionageReport | null {
  switch (mission) {
    case ESPIONAGE_MISSION.TREASURY:
      return { mission: 3, kind: 'treasury', gold: intel.gold }

    case ESPIONAGE_MISSION.WAREHOUSE:
      return { mission: 4, kind: 'warehouse', resources: { ...intel.resources } }

    case ESPIONAGE_MISSION.RESEARCH:
      return { mission: 5, kind: 'research', branches: researchBranches(intel.research) }

    case ESPIONAGE_MISSION.ONLINE_STATUS:
      // Five minutes of grace (actions.php:995).
      return {
        mission: 6,
        kind: 'online_status',
        online: now - intel.lastVisit <= 300,
        townName: target.name,
      }

    case ESPIONAGE_MISSION.GARRISON:
      return {
        mission: 7,
        kind: 'garrison',
        townName: target.name,
        // Ids 1..14 then 16..22 (actions.php:1010, 1019). Unit 15, the
        // barbarian, falls in the gap and is invisible to espionage; unit 23 is
        // the cargo ship, which lives on the user rather than the garrison and
        // is excluded on purpose.
        land: unitList(intel.army, 1, 14),
        ships: unitList(intel.army, 16, 22),
        // The blocking-fleet table is hard-coded to "no troops" in the report
        // markup (actions.php:1070-1079); blockades exist in the schema but
        // were never wired to it.
        blockingFleet: [],
      }

    case ESPIONAGE_MISSION.FLEET_MOVEMENTS:
      // Unimplemented: the case body is a static table reading "no movements of
      // the fleets" (actions.php:1082-1086). At 750 gold it is the most
      // expensive order in the game and it never returns anything.
      return { mission: 8, kind: 'fleet_movements', movements: [] }

    case ESPIONAGE_MISSION.CORRESPONDENCE:
      // Also unimplemented (actions.php:1089-1102), 360 gold.
      return { mission: 9, kind: 'correspondence', letters: [] }

    default:
      return null
  }
}

function unitList(army: Record<number, number>, from: number, to: number): UnitCount[] {
  const out: UnitCount[] = []
  for (let unitType = from; unitType <= to; unitType++) {
    const count = army[unitType] ?? 0
    if (count > 0) out.push({ unitType, count })
  }
  return out
}

/**
 * The four research branches as the report shows them.
 *
 * For each branch the legacy scans ids 1..(future - 1) for the first one at
 * level 0 and calls that the current research; if the branch's repeatable
 * future tech has been started at all it overrides that. `future` is 14, 15, 16
 * and 14 for ways 1..4 -- the same clamps get_research() applies
 * (data_model.php:1059-1062).
 */
function researchBranches(research: ResearchState): ResearchBranchIntel[] {
  const branches: ResearchBranchIntel[] = []

  for (let way = 1; way <= 4; way++) {
    const future = RESEARCH_BRANCH_SIZE[way]!

    let currentId = 0
    for (let id = 1; id < future; id++) {
      if (researchLevel(research, way, id) === 0) {
        currentId = id
        break
      }
    }
    if (researchLevel(research, way, future) > 0) currentId = future

    if (currentId === 0) {
      // Every node below the future tech is done but the future tech is at 0,
      // so $this->ways[$way] was never assigned. PHP then reads ['need_id'] and
      // ['name'] off an undefined key, emits notices, and prints an empty cell.
      branches.push({ way, current: null, displayed: null })
      continue
    }

    const info = researchInfo(way, currentId, research)
    branches.push({
      way,
      current: { id: currentId, points: info.points },
      displayed:
        info.need_id > 0 ? { way: info.need_way, id: info.need_id } : { way, id: currentId },
    })
  }

  return branches
}

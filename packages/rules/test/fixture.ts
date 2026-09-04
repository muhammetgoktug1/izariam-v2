/**
 * Adapter from the legacy tick fixtures to the rules engine's PlayerState.
 *
 * fixtures/tick.json holds, per scenario, the raw MySQL rows the legacy tick
 * saw (`before`), what Load_Player derived from them (`derived`), and the rows
 * it left behind (`after`). This turns `before` into the shape packages/rules
 * consumes so the two can be compared directly.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MAPS } from '@izariam/gamedata'

import type {
  IslandState,
  PlayerState,
  ResearchState,
  TownState,
  UserState,
} from '../src/types.js'

const here = dirname(fileURLToPath(import.meta.url))

export interface TickScenario {
  elapsed: number
  /** The exact time() the legacy tick observed. */
  now: number
  before: FixtureSnapshot
  derived: Record<string, any>
  after: FixtureSnapshot
}

export interface FixtureSnapshot {
  town: Record<string, any>
  towns: Record<string, Record<string, any>>
  towns_active: number
  user: Record<string, number>
  research: Record<string, number>
  research_points: number
  army: Record<string, any>
  island: Record<string, any>
}

export const TICK_FIXTURES = JSON.parse(
  readFileSync(resolve(here, '../../../fixtures/tick.json'), 'utf8'),
).scenarios as Record<string, TickScenario>

/** class name ("phalanx") -> unit id (1..23). */
const UNIT_ID_BY_CLASS: Record<string, number> = {}
for (const [id, cls] of Object.entries(MAPS.army_class_by_type ?? {})) {
  if (typeof cls === 'string' && cls !== '') UNIT_ID_BY_CLASS[cls] = Number(id)
}

/** "1,6;2,6" -> [{slot:1,type:6},{slot:2,type:6}] */
export function parseBuildLine(line: string): { slot: number; type: number }[] {
  if (!line) return []
  return line
    .split(';')
    .filter(Boolean)
    .map((pair) => {
      const [slot, type] = pair.split(',')
      return { slot: Number(slot), type: Number(type) }
    })
}

/** "1,10;3,5" -> [{unitType:1,count:10},{unitType:3,count:5}] */
export function parseUnitLine(line: string): { unitType: number; count: number }[] {
  if (!line) return []
  return line
    .split(';')
    .filter(Boolean)
    .map((pair) => {
      const [unitType, count] = pair.split(',')
      return { unitType: Number(unitType), count: Number(count) }
    })
}

/** Legacy stores "not set" as 0 rather than NULL. */
function ts(v: unknown): number | null {
  const n = Number(v ?? 0)
  return n > 0 ? n : null
}

function townFromRow(
  row: Record<string, any>,
  id: number,
  userId: number,
  army: Record<string, any>,
): TownState {
  const bySlot: Record<number, { type: number; level: number }> = {}
  for (let slot = 0; slot <= 14; slot++) {
    bySlot[slot] = {
      type: Number(row[`pos${slot}_type`] ?? 0),
      level: Number(row[`pos${slot}_level`] ?? 0),
    }
  }

  const units: Record<number, number> = {}
  for (const [cls, unitId] of Object.entries(UNIT_ID_BY_CLASS)) {
    const v = army[cls]
    if (v !== undefined) units[unitId] = Number(v)
  }

  return {
    id,
    userId,
    islandId: Number(row.island),
    slot: Number(row.position),
    name: String(row.name ?? ''),
    lastUpdate: Number(row.last_update),
    resources: {
      wood: Number(row.wood),
      wine: Number(row.wine),
      marble: Number(row.marble),
      crystal: Number(row.crystal),
      sulfur: Number(row.sulfur),
    },
    peoples: Number(row.peoples),
    workers: Number(row.workers),
    tradegood: Number(row.tradegood),
    scientists: Number(row.scientists),
    templer: Number(row.templer ?? 0),
    buildings: { bySlot },
    buildQueue: parseBuildLine(String(row.build_line ?? '')),
    buildStartedAt: ts(row.build_start),
    spies: Number(row.spyes ?? 0),
    spyTrainingStartedAt: ts(row.spyes_start),
    workersWood: Number(row.workers_wood ?? 0),
    tradegoodWood: Number(row.tradegood_wood ?? 0),
    // The legacy has no monument donations at all, so every fixture is zero.
    wonderDonated: 0,
    actionPoints: Number(row.actions ?? 0),
    tavernWine: Number(row.tavern_wine ?? 0),
    army: units,
    landQueue: parseUnitLine(String(army.army_line ?? '')),
    landQueueStartedAt: ts(army.army_start),
    navalQueue: parseUnitLine(String(army.ships_line ?? '')),
    navalQueueStartedAt: ts(army.ships_start),
  }
}

function islandFromRow(row: Record<string, any>): IslandState {
  return {
    id: Number(row.id),
    name: String(row.name ?? ''),
    x: Number(row.x),
    y: Number(row.y),
    type: Number(row.type),
    tradeResource: Number(row.trade_resource),
    wonder: Number(row.wonder ?? 0),
    woodLevel: Number(row.wood_level),
    tradeLevel: Number(row.trade_level),
    woodDonated: Number(row.wood_count ?? 0),
    tradeDonated: Number(row.trade_count ?? 0),
    woodUpgradeStartedAt: ts(row.wood_start),
    tradeUpgradeStartedAt: ts(row.trade_start),
    // The legacy has no monument level and no donations toward one, so the
    // fixtures start every island where the port does.
    wonderLevel: 1,
    wonderDonated: { wine: 0, marble: 0, crystal: 0, sulfur: 0 },
  }
}

function researchFromRow(levels: Record<string, number>, points: number): ResearchState {
  return { levels: { ...levels }, points, branchSeen: {} }
}

/**
 * Build a PlayerState from a fixture snapshot.
 *
 * Towns in the fixture are keyed by ordinal (their real ids are not stable
 * across dumps); the subject town keeps the id recorded in `before.town`, and
 * colonies get synthetic negative ids so they cannot collide with it.
 *
 * Only the subject town's army and island are recorded, so colonies are given
 * an empty garrison and share the subject's island. Both are true of every
 * scenario the fixture defines.
 */
export function stateFromFixture(snap: FixtureSnapshot): {
  state: PlayerState
  subjectTownId: number
} {
  const subjectId = Number(snap.town.id)
  const userId = 1

  const towns: TownState[] = []
  let colonyOrdinal = 0
  for (const key of Object.keys(snap.towns).sort((a, b) => Number(a) - Number(b))) {
    const row = snap.towns[key]!
    const isSubject = Number(row.is_subject) === 1
    const id = isSubject ? subjectId : -1 - colonyOrdinal++
    towns.push(townFromRow(row, id, userId, isSubject ? snap.army : {}))
  }

  const u = snap.user
  const user: UserState = {
    id: userId,
    login: 'fixture',
    options: { citySelect: 0 },
    // The legacy has no miracles, so every fixture runs without one.
    miracles: [],
    gold: Number(u.gold),
    ambrosia: Number(u.ambrosy),
    transports: Number(u.transports),
    tutorialStep: Number(u.tutorial ?? 0),
    currentTownId: Number(u.town),
    capitalTownId: Number(u.capital),
    research: researchFromRow(snap.research, snap.research_points),
    premium: {
      account: ts(u.premium_account),
      wood: ts(u.premium_wood),
      wine: ts(u.premium_wine),
      marble: ts(u.premium_marble),
      crystal: ts(u.premium_crystal),
      sulfur: ts(u.premium_sulfur),
      capacity: ts(u.premium_capacity),
    },
    scores: {
      total: Number(u.points ?? 0),
      buildings: Number(u.points_buildings ?? 0),
      levels: Number(u.points_levels ?? 0),
      peoples: Number(u.points_peoples ?? 0),
      research: Number(u.points_research ?? 0),
      complete: Number(u.points_complete ?? 0),
      army: Number(u.points_army ?? 0),
      gold: Number(u.points_gold ?? 0),
      transports: Number(u.points_transports ?? 0),
    },
  }

  const island = islandFromRow(snap.island)
  const islands: Record<number, IslandState> = { [island.id]: island }
  for (const t of towns) if (!islands[t.islandId]) islands[t.islandId] = island

  return {
    state: { user, towns, islands, missions: [], tradeRoutes: [], spies: [] },
    subjectTownId: subjectId,
  }
}

/**
 * The instant the legacy tick observed. Every scenario seeds
 * `last_update = now - elapsed`, so this recovers `now` exactly.
 */
export function nowOf(scenario: TickScenario): number {
  return Number(scenario.before.town.last_update) + scenario.elapsed
}

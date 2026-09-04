/**
 * Reading and granting a player's resources from the staff panel.
 *
 * The whole module exists to go the long way round. `towns.wood` and
 * `users.gold` look like columns you could UPDATE, and doing so is wrong in
 * five separate ways, every one of them silent:
 *
 *   1. The tick adds production on top. A write that leaves `towns.last_update`
 *      alone means the next request computes `elapsed = now - last_update` and
 *      credits the whole backlog *on top of* the number just written
 *      (rules/tick.ts:171).
 *   2. The storage clamp eats it. Every tick truncates any resource above
 *      `d.capacity` (tick.ts:228-233), so a generous grant to a small town
 *      evaporates on the next page load.
 *   3. Last writer wins. `loadPlayerState` takes no row lock and
 *      `savePlayerState` blind-writes whole rows, so a `GET /api/state` that
 *      loaded before the UPDATE overwrites it afterwards.
 *   4. `user_scores` is a materialised table only the tick maintains, and the
 *      highscore reads it directly.
 *   5. The columns are `numeric(20,6)` accruing fractions per second.
 *
 * So a grant does what a game action does: `advance()` to bring the tick to
 * now, mutate the in-memory `PlayerState`, `persist()`. That is the same path
 * `routes/actions.ts` and even `GET /api/state` take.
 */

import {
  RESOURCES,
  derive,
  isTownActive,
  totalTransports,
  type MissionState,
  type PlayerState,
  type Resource,
  type UserState,
} from '@izariam/rules'
import {
  GRANT_RESOURCES,
  applyGrant,
  type AdminResourceGrantRequest,
  type GrantAccountField,
  type GrantField,
  type GrantResource,
} from '@izariam/shared/admin'

import { advance, persist } from '../state/advance.js'
import type { Queryable } from '../state/load.js'
import { audit } from './audit.js'

/** The panel declares the resource list itself so it need not import the rules
 *  engine; this is the compile-time proof that the two agree. */
const _sameResources: readonly Resource[] = GRANT_RESOURCES

export type ResourceErrorCode =
  | 'not_found'
  | 'unknown_town'
  | 'town_not_active'
  | 'no_towns_selected'
  | 'nothing_to_do'

export class ResourceFailure extends Error {
  constructor(readonly code: ResourceErrorCode) {
    super(code)
    this.name = 'ResourceFailure'
  }
}

export function resourceFailureStatus(code: ResourceErrorCode): 400 | 404 | 409 {
  if (code === 'not_found' || code === 'unknown_town') return 404
  if (code === 'town_not_active') return 409
  return 400
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface AdminTownStock {
  id: number
  name: string
  islandId: number
  x: number
  y: number
  slot: number
  /** Slot-0 level > 0. False = a colony still in transit, which the tick skips
   *  entirely and `derive()` has no entry for. */
  active: boolean
  /** Per-resource warehouse ceiling, or null for an inactive town. */
  capacity: number | null
  resources: Record<GrantResource, number>
  /**
   * Seconds the town's clock sits behind `now` after the tick.
   *
   * Normally zero. A landed transport deliberately rewinds it to the arrival
   * instant (rules/missions.ts:526-530) so the player is paid twice for that
   * window, which is the legacy behaviour. A "set exactly N" on such a town is
   * therefore not exact -- reported here rather than silently corrected.
   */
  rewoundBy: number
}

export interface AdminAccountStock {
  gold: number
  ambrosia: number
  researchPoints: number
  /** `free` is the pool at home; `total` counts ships in flight too, which is
   *  what the purchase price ladder is based on. */
  transports: { free: number; total: number }
}

export interface AdminPlayerResources {
  now: number
  player: { id: number; login: string; lastVisitAt: number | null }
  towns: AdminTownStock[]
  account: AdminAccountStock
  /** Fleets in flight, for the support desk: where, doing what, next event. */
  missions: {
    id: number
    kind: MissionState['kind']
    fromName: string | null
    toName: string | null
    phase: 'loading' | 'outbound' | 'returning'
    arrivesAt: number | null
    transports: number
  }[]
}

function stockOf(state: PlayerState, town: PlayerState['towns'][number]): Record<GrantResource, number> {
  const out = {} as Record<GrantResource, number>
  for (const r of GRANT_RESOURCES) out[r] = town.resources[r]
  return out
}

function accountOf(state: PlayerState): AdminAccountStock {
  return {
    gold: state.user.gold,
    ambrosia: state.user.ambrosia,
    researchPoints: state.user.research.points,
    transports: { free: state.user.transports, total: totalTransports(state) },
  }
}

/**
 * The player's stocks as they stand *now*.
 *
 * `advance()` ticks in memory and writes nothing -- `persist()` is the only
 * writer -- so this runs the identical arithmetic the grant will run and then
 * throws the result away. Reading the raw columns instead would show a number
 * frozen at the player's last visit, and would need a second implementation of
 * the warehouse-capacity rule, which is computed from `town_buildings` in
 * `derive()` and is not a column at all.
 */
export async function playerResources(
  client: Queryable,
  userId: number,
): Promise<AdminPlayerResources | null> {
  const advanced = await advance(client, userId)
  if (!advanced) return null
  const { state, now } = advanced
  const derived = derive(state, now)

  const { rows } = await client.query('select last_visit_at from users where id = $1', [userId])
  const lastVisitAt = rows[0]?.last_visit_at
    ? Math.floor(new Date(rows[0].last_visit_at as string).getTime() / 1000)
    : null

  return {
    now,
    player: { id: state.user.id, login: state.user.login, lastVisitAt },
    towns: state.towns.map((town) => {
      const island = state.islands[town.islandId]
      const active = isTownActive(town)
      return {
        id: town.id,
        name: town.name,
        islandId: town.islandId,
        x: island?.x ?? 0,
        y: island?.y ?? 0,
        slot: town.slot,
        active,
        capacity: derived.towns[town.id]?.capacity ?? null,
        resources: stockOf(state, town),
        rewoundBy: Math.max(0, now - town.lastUpdate),
      }
    }),
    account: accountOf(state),
    missions: state.missions.map((mission) => ({
      id: mission.id,
      kind: mission.kind,
      fromName: state.towns.find((t) => t.id === mission.fromTownId)?.name ?? null,
      toName:
        state.towns.find((t) => t.id === mission.toTownId)?.name ?? null,
      phase:
        mission.departedAt == null
          ? 'loading'
          : mission.returnStartedAt == null
            ? 'outbound'
            : 'returning',
      arrivesAt: mission.arrivesAt,
      transports: mission.transports,
    })),
  }
}

// ---------------------------------------------------------------------------
// Grant
// ---------------------------------------------------------------------------

export interface TownGrant {
  id: number
  name: string
  capacity: number
  before: Record<GrantResource, number>
  after: Record<GrantResource, number>
  clamped: GrantResource[]
  floored: GrantResource[]
  rewoundBy: number
}

export interface GrantResult {
  now: number
  towns: TownGrant[]
  account: {
    before: AdminAccountStock
    after: AdminAccountStock
    floored: GrantAccountField[]
  }
  /** What the panel's "3 şehirde kırpıldı" line counts. */
  clampedTowns: number
  /** (town, resource) pairs clamped: 3 towns x 2 resources = 6. */
  clampedFields: number
}

function readAccount(user: UserState, name: GrantAccountField): number {
  switch (name) {
    case 'gold':
      return user.gold
    case 'ambrosia':
      return user.ambrosia
    case 'researchPoints':
      return user.research.points
    case 'transports':
      return user.transports
  }
}

function writeAccount(user: UserState, name: GrantAccountField, value: number): void {
  switch (name) {
    case 'gold':
      user.gold = value
      break
    case 'ambrosia':
      // An `integer` column; the schema only accepts integers, but a caller
      // reaching this with a fraction would have Postgres round it silently.
      user.ambrosia = Math.round(value)
      break
    case 'researchPoints':
      user.research.points = value
      break
    case 'transports':
      user.transports = Math.round(value)
      break
  }
}

export async function grantResources(
  client: Queryable,
  actor: { id: number; ip?: string | undefined },
  targetId: number,
  input: AdminResourceGrantRequest,
): Promise<GrantResult> {
  const townFields = Object.entries(input.town) as [GrantResource, GrantField][]
  const accountFields = Object.entries(input.account) as [GrantAccountField, GrantField][]

  // Checked before the lock and before advance(): an empty form from a stale
  // tab must not cost a tick, must not move towns.last_update, must not land
  // arriving fleets and must not write an audit row.
  if (townFields.length === 0 && accountFields.length === 0) {
    throw new ResourceFailure('nothing_to_do')
  }
  if (townFields.length > 0 && input.townIds.length === 0) {
    throw new ResourceFailure('no_towns_selected')
  }
  // A repeated id would apply an `add` twice.
  const townIds = townFields.length === 0 ? [] : [...new Set(input.townIds)]

  // The stamp `persist()` is about to overwrite, read under the same lock the
  // other admin writes take (players.ts:200).
  const locked = await client.query(
    'select last_visit_at from users where id = $1 for update',
    [targetId],
  )
  if (locked.rows.length === 0) throw new ResourceFailure('not_found')
  const lastVisitAt: Date | null = locked.rows[0].last_visit_at ?? null

  const advanced = await advance(client, targetId)
  if (!advanced) throw new ResourceFailure('not_found')
  const { state, now } = advanced
  const derived = derive(state, now)

  // Resolve every town before mutating any of them, so a bad id leaves nothing
  // half-applied even before the transaction rolls back.
  const targets = townIds.map((id) => {
    const town = state.towns.find((t) => t.id === id)
    if (!town) throw new ResourceFailure('unknown_town')
    const d = derived.towns[id]
    // `derive()` drops a colony whose town hall is still level 0, exactly as
    // the tick skips it -- there is no capacity to clamp against, and
    // `deliverColony` would overwrite the values wholesale when the fleet
    // lands (rules/missions.ts:477-481).
    if (!d || !isTownActive(town)) throw new ResourceFailure('town_not_active')
    return { town, capacity: d.capacity }
  })

  let clampedTowns = 0
  let clampedFields = 0
  const towns: TownGrant[] = targets.map(({ town, capacity }) => {
    const before = stockOf(state, town)
    const clamped: GrantResource[] = []
    const floored: GrantResource[] = []

    for (const [resource, f] of townFields) {
      // The ceiling is `derived.capacity`, never `warehouseCapacity(derived,
      // plusCapacity)`: the tick ignores the premium multiplier, so anything
      // above this is taken straight back on the next pass.
      const out = applyGrant(town.resources[resource], f, capacity)
      town.resources[resource] = out.value
      if (out.clamped) {
        clamped.push(resource)
        clampedFields++
      }
      if (out.floored) floored.push(resource)
    }
    if (clamped.length > 0) clampedTowns++

    return {
      id: town.id,
      name: town.name,
      capacity,
      before,
      after: stockOf(state, town),
      clamped,
      floored,
      rewoundBy: Math.max(0, now - town.lastUpdate),
    }
  })

  const accountBefore = accountOf(state)
  const accountFloored: GrantAccountField[] = []
  for (const [name, f] of accountFields) {
    const out = applyGrant(readAccount(state.user, name), f)
    writeAccount(state.user, name, out.value)
    if (out.floored) accountFloored.push(name)
  }

  // The tick copied gold into the score before this ran (tick.ts:125), so
  // without this line the highscore keeps the pre-grant figure until the
  // player's next request. `scores.total` excludes gold, and
  // `scores.transports` records purchase *spending* (trade.ts:654) rather than
  // ship count -- a gifted ship must not move it.
  state.user.scores.gold = state.user.gold

  await persist(client, advanced)

  // `savePlayerState` always writes `last_visit_at = now()` (state/save.ts:77).
  // Left alone, a grant makes the account look like it just logged in -- in the
  // panel's own "Son giriş" column and in espionage's `online` flag, which is
  // `now - lastVisit <= 300`.
  await client.query('update users set last_visit_at = $2 where id = $1', [targetId, lastVisitAt])

  const accountAfter = accountOf(state)
  await audit(client, {
    adminUserId: actor.id,
    action: 'player.grant_resources',
    targetType: 'player',
    targetId,
    meta: {
      townIds,
      town: input.town,
      account: input.account,
      note: input.note,
      clampedTowns,
      clampedFields,
      // Per-town before/after, so "where did these 3000 marble come from" is
      // answerable a month later.
      towns: towns.map((t) => ({ id: t.id, name: t.name, before: t.before, after: t.after })),
      accountBefore: { ...accountBefore, transports: accountBefore.transports.free },
      accountAfter: { ...accountAfter, transports: accountAfter.transports.free },
    },
    ip: actor.ip,
  })

  return {
    now,
    towns,
    account: { before: accountBefore, after: accountAfter, floored: accountFloored },
    clampedTowns,
    clampedFields,
  }
}

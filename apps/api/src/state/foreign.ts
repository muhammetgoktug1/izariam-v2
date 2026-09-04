/**
 * Reads of rows outside the acting player's graph.
 *
 * The rules engine never queries. Where the legacy reached into Data_Model's
 * process-wide cache -- which happened to hold every town, user and island the
 * request had touched -- the port takes the same facts as parameters, and this
 * module is what produces them. That is the whole reason `targetExists`,
 * `recipientExists` and `taken` are booleans in the action signatures rather
 * than lookups: the boundary is deliberate, and it is also what makes the
 * 30,516-value golden suite possible without a database.
 */

import {
  CITIZENS_PER_PRIEST,
  RESOURCES,
  peoplesByLevel,
  townFaith,
  type EspionageIntel,
  type Mailbox,
  type Resources,
  type SpyTargetTown,
  type UserMessage,
  type WonderGood,
} from '@izariam/rules'
import type { SpyTargetTown as SendSpyTarget } from '@izariam/rules/actions/military'

import type { Queryable } from './load.js'

function secs(v: string | Date | null | undefined): number {
  if (v == null) return 0
  const ms = v instanceof Date ? v.getTime() : Date.parse(v)
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000)
}

export async function townExists(client: Queryable, townId: number): Promise<boolean> {
  const { rows } = await client.query('select 1 from towns where id = $1', [townId])
  return rows.length > 0
}

export async function userExists(client: Queryable, userId: number): Promise<boolean> {
  const { rows } = await client.query('select 1 from users where id = $1', [userId])
  return rows.length > 0
}

/** Case-insensitive, matching the legacy's `WHERE login = ?` on a ci collation. */
export async function loginTaken(
  client: Queryable,
  login: string,
  exceptUserId: number,
): Promise<boolean> {
  const { rows } = await client.query(
    'select 1 from users where lower(login) = lower($1) and id <> $2',
    [login, exceptUserId],
  )
  return rows.length > 0
}

/** Island coordinates for both ends of a mission, for abortFleet. */
export async function missionRoute(
  client: Queryable,
  missionId: number,
): Promise<{ fromX: number; fromY: number; toX: number; toY: number } | undefined> {
  const { rows } = await client.query(
    `select fi.x as from_x, fi.y as from_y, ti.x as to_x, ti.y as to_y
     from missions m
     join towns ft on ft.id = m.from_town_id
     join islands fi on fi.id = ft.island_id
     left join towns tt on tt.id = m.to_town_id
     left join islands ti on ti.id = tt.island_id
     where m.id = $1`,
    [missionId],
  )
  const r = rows[0]
  if (!r) return undefined
  return {
    fromX: Number(r.from_x),
    fromY: Number(r.from_y),
    toX: Number(r.to_x ?? r.from_x),
    toY: Number(r.to_y ?? r.from_y),
  }
}

const TARGET_TOWN = `
  select t.id, t.user_id, t.name, t.island_id, i.x, i.y, t.spies,
         coalesce((select level from town_buildings where town_id = t.id and slot = 0), 0)
           as town_hall_level,
         coalesce((select max(level) from town_buildings where town_id = t.id and type = 14), 0)
           as safehouse_level
  from towns t join islands i on i.id = t.island_id
  where t.id = $1
`

/** The espionage-model view of a town: what the risk calculation needs. */
export async function spyTarget(
  client: Queryable,
  townId: number,
): Promise<SpyTargetTown | undefined> {
  const { rows } = await client.query(TARGET_TOWN, [townId])
  const r = rows[0]
  if (!r) return undefined
  return {
    id: Number(r.id),
    userId: Number(r.user_id),
    name: String(r.name),
    islandId: Number(r.island_id),
    x: Number(r.x),
    y: Number(r.y),
    spies: Number(r.spies),
    townHallLevel: Number(r.town_hall_level),
    safehouseLevel: Number(r.safehouse_level),
  }
}

/**
 * The send-spy form's view of a town: `{id, islandId}` and nothing else
 * (military.ts:335), because all it does is reject a target on the wrong
 * island. The risk model's SpyTargetTown is a superset, so it stands in.
 */
export async function sendSpyTarget(
  client: Queryable,
  townId: number,
): Promise<SendSpyTarget | undefined> {
  return spyTarget(client, townId)
}

/**
 * Everything mission 3-9 can read off a target, fetched in one statement
 * whether or not the roll will succeed. The legacy did the same: Load_User and
 * Load_Town ran before the risk roll (actions.php:880-910), so a caught spy
 * still cost the server the reads.
 */
export async function espionageIntel(
  client: Queryable,
  townId: number,
): Promise<EspionageIntel | undefined> {
  const { rows } = await client.query(
    `select u.gold, u.last_visit_at, t.wood, t.wine, t.marble, t.crystal, t.sulfur,
       coalesce((select json_agg(json_build_object('branch', branch, 'node', node, 'level', level))
                 from user_research where user_id = u.id), '[]'::json) as research,
       u.research_points,
       coalesce((select json_object_agg(unit_type, count)
                 from army_units where town_id = t.id), '{}'::json) as army
     from towns t join users u on u.id = t.user_id
     where t.id = $1`,
    [townId],
  )
  const r = rows[0]
  if (!r) return undefined

  const resources = Object.fromEntries(
    RESOURCES.map((name) => [name, Number(r[name])]),
  ) as Resources

  const levels: Record<string, number> = {}
  for (const row of r.research ?? []) levels[`${row.branch}_${row.node}`] = Number(row.level)

  const army: Record<number, number> = {}
  for (const [unitType, count] of Object.entries(r.army ?? {})) {
    army[Number(unitType)] = Number(count)
  }

  return {
    gold: Number(r.gold),
    lastVisit: secs(r.last_visit_at),
    resources,
    research: { levels, points: Number(r.research_points), branchSeen: {} },
    army,
  }
}

/**
 * Mail from the last seven days, both sides, as Load_User_Messages produced it
 * (player_model.php:338-353). Older mail is invisible to every message action:
 * it cannot be read or deleted, only waited out.
 *
 * The legacy packed both participants' flags into the message row; here they
 * live in message_recipients, one row per side, and are folded back into the
 * flat shape the rules expect.
 */
export async function mailbox(client: Queryable, userId: number): Promise<Mailbox> {
  const { rows } = await client.query(
    `select m.id, m.from_user_id, m.kind, m.created_at, m.body,
       max(case when mr.side = 'to' then mr.user_id end) as to_user_id,
       max(case when mr.side = 'to' then extract(epoch from mr.read_at) end) as checked_to,
       max(case when mr.side = 'from' then extract(epoch from mr.read_at) end) as checked_from,
       bool_or(mr.side = 'to' and mr.deleted) as deleted_to,
       bool_or(mr.side = 'from' and mr.deleted) as deleted_from,
       bool_or(mr.side = 'to' and mr.archived) as archived_to,
       bool_or(mr.side = 'from' and mr.archived) as archived_from
     from user_messages m
     join message_recipients mr on mr.message_id = m.id
     where m.id in (
       select message_id from message_recipients
       where user_id = $1 and not deleted and not archived
     )
       and m.created_at > now() - interval '7 days'
     group by m.id
     order by m.created_at desc`,
    [userId],
  )

  const inbox: UserMessage[] = []
  const outbox: UserMessage[] = []
  for (const r of rows) {
    const message: UserMessage = {
      id: Number(r.id),
      from: Number(r.from_user_id ?? 0),
      to: Number(r.to_user_id ?? 0),
      type: Number(r.kind),
      date: secs(r.created_at),
      text: String(r.body),
      checkedFrom: Number(r.checked_from ?? 0),
      checkedTo: Number(r.checked_to ?? 0),
      deletedFrom: r.deleted_from ? 1 : 0,
      deletedTo: r.deleted_to ? 1 : 0,
      archivedFrom: r.archived_from ? 1 : 0,
      archivedTo: r.archived_to ? 1 : 0,
    }
    if (message.to === userId) inbox.push(message)
    if (message.from === userId) outbox.push(message)
  }
  return { inbox, outbox }
}

/**
 * How much of an island believes, 0..1.
 *
 * Every town on the island counts, whoever owns it: faith is a property of the
 * island's population, not of one empire. The numerator is the citizens the
 * priests have converted -- five each, themselves included, which is the
 * legacy's own wording (`information42_2`) -- and the denominator is the
 * population those towns can hold. Towns without a temple contribute nothing
 * to the numerator and everything to the denominator, which is exactly why the
 * legacy warns that "the larger an island's cities become, the more reduced
 * the effect of a single priest becomes" (`information42_4`).
 *
 * `max_peoples` is not a column -- it comes from the town hall's level through
 * a curve the database does not have -- so the rows come back raw and the
 * arithmetic happens in `islandFaith`, next to the curve.
 */
export interface IslandFaith {
  islandId: number
  priests: number
  /** Population the island's towns can hold. */
  capacity: number
  /** priests * 5 / capacity, clamped to 1. */
  faith: number
}

export async function islandFaith(
  client: Queryable,
  islandIds: number[],
): Promise<Map<number, IslandFaith>> {
  const result = new Map<number, IslandFaith>()
  if (islandIds.length === 0) return result

  const { rows } = await client.query(
    `select t.island_id, t.templer,
            coalesce((select level from town_buildings
                       where town_id = t.id and slot = 0), 0) as town_hall_level
       from towns t
      where t.island_id = any($1::int[])`,
    [islandIds],
  )

  const totals = new Map<number, { priests: number; capacity: number }>()
  for (const id of islandIds) totals.set(id, { priests: 0, capacity: 0 })
  for (const row of rows) {
    const entry = totals.get(Number(row.island_id))
    if (!entry) continue
    entry.priests += Number(row.templer)
    entry.capacity += peoplesByLevel(Number(row.town_hall_level))
  }

  for (const [islandId, { priests, capacity }] of totals) {
    result.set(islandId, {
      islandId,
      priests,
      capacity,
      faith: townFaith(priests, capacity),
    })
  }
  return result
}

/**
 * The monument's row, taken under `for update`.
 *
 * The island is shared by every player living on it and `savePlayerState`
 * writes island rows blind, so a donation cannot work from the copy
 * `loadPlayerState` handed it: two donors reading the same pre-upgrade
 * counters both conclude the last good has just landed, and the monument gains
 * two levels for one level's worth of goods. This is always the second lock
 * taken -- `advance()` already holds the user row -- so the order is user then
 * island everywhere and there is nothing to deadlock against.
 */
export interface LockedWonder {
  wonder: number
  tradeResource: number
  wonderLevel: number
  donated: Record<WonderGood, number>
}

export async function lockIslandWonder(
  client: Queryable,
  islandId: number,
): Promise<LockedWonder | null> {
  const { rows } = await client.query(
    `select wonder, trade_resource, wonder_level,
            wonder_wine_donated, wonder_marble_donated,
            wonder_crystal_donated, wonder_sulfur_donated
       from islands where id = $1 for update`,
    [islandId],
  )
  const row = rows[0]
  if (!row) return null
  return {
    wonder: Number(row.wonder),
    tradeResource: Number(row.trade_resource),
    wonderLevel: Number(row.wonder_level),
    donated: {
      wine: Number(row.wonder_wine_donated),
      marble: Number(row.wonder_marble_donated),
      crystal: Number(row.wonder_crystal_donated),
      sulfur: Number(row.wonder_sulfur_donated),
    },
  }
}

/** Write the monument back, while the lock from `lockIslandWonder` is held. */
export async function saveIslandWonder(
  client: Queryable,
  islandId: number,
  wonder: { wonderLevel: number; donated: Record<WonderGood, number> },
): Promise<void> {
  await client.query(
    `update islands set wonder_level = $2,
       wonder_wine_donated = $3, wonder_marble_donated = $4,
       wonder_crystal_donated = $5, wonder_sulfur_donated = $6
     where id = $1`,
    [
      islandId,
      wonder.wonderLevel,
      wonder.donated.wine,
      wonder.donated.marble,
      wonder.donated.crystal,
      wonder.donated.sulfur,
    ],
  )
}

/**
 * One row per town on the island, for the monument's roster.
 *
 * Not part of `/api/state`: that payload is refetched on every screen change
 * and after every action, and this is up to seventeen rows per island the
 * player lives on, wanted by exactly one screen. Faith stays there because it
 * is one number per island; the breakdown gets its own request.
 *
 * `converted` is capped at the town's own capacity -- a town with more priests
 * than citizens cannot convert islanders it does not hold, and without the cap
 * the shares stop adding up to one.
 */
export interface WonderRosterTown {
  townId: number
  slot: number
  userId: number
  owner: string
  name: string
  donated: number
  priests: number
  converted: number
  capacity: number
  /** This town's slice of the island's converted islanders, 0..1. */
  share: number
}

export interface WonderRoster {
  island: {
    id: number
    name: string
    wonder: number
    wonderLevel: number
    tradeResource: number
    donated: Record<WonderGood, number>
  }
  faith: IslandFaith
  towns: WonderRosterTown[]
}

export async function islandWonderRoster(
  client: Queryable,
  islandId: number,
): Promise<WonderRoster | null> {
  const { rows: islandRows } = await client.query(
    `select id, name, wonder, wonder_level, trade_resource,
            wonder_wine_donated, wonder_marble_donated,
            wonder_crystal_donated, wonder_sulfur_donated
       from islands where id = $1`,
    [islandId],
  )
  const i = islandRows[0]
  if (!i) return null

  const { rows } = await client.query(
    `select t.id, t.slot, t.name, t.templer, t.wonder_donated,
            u.id as user_id, u.login,
            coalesce((select level from town_buildings
                       where town_id = t.id and slot = 0), 0) as town_hall_level
       from towns t join users u on u.id = t.user_id
      where t.island_id = $1
      order by t.slot`,
    [islandId],
  )

  let priests = 0
  let capacity = 0
  const towns = rows.map((r) => {
    const townPriests = Number(r.templer)
    const townCapacity = peoplesByLevel(Number(r.town_hall_level))
    priests += townPriests
    capacity += townCapacity
    return {
      townId: Number(r.id),
      slot: Number(r.slot),
      userId: Number(r.user_id),
      owner: String(r.login),
      name: String(r.name),
      donated: Number(r.wonder_donated),
      priests: townPriests,
      converted: Math.min(townPriests * CITIZENS_PER_PRIEST, townCapacity),
      capacity: townCapacity,
      share: 0,
    }
  })

  const convertedTotal = towns.reduce((sum, t) => sum + t.converted, 0)
  for (const town of towns) {
    town.share = convertedTotal > 0 ? town.converted / convertedTotal : 0
  }

  return {
    island: {
      id: Number(i.id),
      name: String(i.name),
      wonder: Number(i.wonder),
      wonderLevel: Number(i.wonder_level),
      tradeResource: Number(i.trade_resource),
      donated: {
        wine: Number(i.wonder_wine_donated),
        marble: Number(i.wonder_marble_donated),
        crystal: Number(i.wonder_crystal_donated),
        sulfur: Number(i.wonder_sulfur_donated),
      },
    },
    faith: { islandId, priests, capacity, faith: townFaith(priests, capacity) },
    towns,
  }
}

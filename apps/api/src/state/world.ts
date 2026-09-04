/**
 * The slice of the world outside the acting player that the tick needs.
 *
 * `tickMissions` resolves both ends of every fleet, and half of them belong to
 * someone else -- a transport to an ally, a purchase from a foreign branch
 * office. `defaultMissionWorld` (packages/rules/src/missions.ts:120) only
 * covers the caller's own towns, so with it every cross-player mission is
 * skipped outright (`if (!from || !to) continue`, missions.ts:288) and the
 * goods simply never arrive.
 *
 * This loads the counterparties in one statement and hands the tick a world it
 * can actually settle against. The rules layer still never reaches for foreign
 * data itself; it is passed in, which is what keeps it testable.
 */

import { emptyBranchOffice } from '@izariam/rules/actions/trade'
import type { MissionWorld } from '@izariam/rules/missions'
import type {
  BranchOfficeState,
  IslandState,
  PlayerState,
  Resource,
  TownBuildings,
} from '@izariam/rules'

import type { Queryable } from './load.js'

const RESOURCES: Resource[] = ['wood', 'wine', 'marble', 'crystal', 'sulfur']

/** Every town at the far end of one of this player's missions. */
const COUNTERPARTIES = `
  with mission_towns as (
    select unnest(array_remove(array[m.from_town_id, m.to_town_id], null)) as town_id
    from missions m
    where m.user_id = $1
       or m.from_town_id = any($2::int[])
       or m.to_town_id = any($2::int[])
  )
  select t.id, t.user_id, t.island_id, t.slot, t.last_update, t.peoples,
         t.wood, t.wine, t.marble, t.crystal, t.sulfur,
         coalesce((select json_agg(json_build_object('slot', slot, 'type', type, 'level', level))
                   from town_buildings where town_id = t.id), '[]'::json) as buildings,
         coalesce((select json_agg(json_build_object('resource', resource, 'direction', direction,
                                                     'count', count, 'price', price))
                   from branch_offers where town_id = t.id), '[]'::json) as offers,
         u.gold as owner_gold, u.transports as owner_transports,
         row_to_json(i) as island
  from towns t
  join users u on u.id = t.user_id
  join islands i on i.id = t.island_id
  where t.id in (select town_id from mission_towns)
    and not (t.id = any($2::int[]))
`

function secs(v: string | null | undefined): number {
  if (v == null) return 0
  const ms = Date.parse(v)
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000)
}

function buildingsFrom(rows: { slot: number; type: number; level: number }[]): TownBuildings {
  const bySlot: Record<number, { type: number; level: number }> = {}
  for (let slot = 0; slot <= 14; slot++) bySlot[slot] = { type: 0, level: 0 }
  for (const b of rows ?? []) {
    bySlot[Number(b.slot)] = { type: Number(b.type), level: Number(b.level) }
  }
  return { bySlot }
}

function branchFrom(
  rows: { resource: Resource; direction: string; count: number; price: number }[],
): BranchOfficeState | undefined {
  if (!rows || rows.length === 0) return undefined
  const office = emptyBranchOffice()
  for (const row of rows) {
    office.offers[row.resource] = {
      direction: row.direction === 'sell' ? 1 : 0,
      count: Number(row.count),
      price: Number(row.price),
    }
  }
  return office
}

/**
 * Build the mission world: the player's own towns and islands, plus every
 * counterparty town, its owner and its island.
 */
export async function loadMissionWorld(
  client: Queryable,
  state: PlayerState,
): Promise<MissionWorld> {
  const own = state.towns.map((t) => t.id)

  const world: MissionWorld = {
    towns: {},
    users: { [state.user.id]: state.user },
    islands: { ...state.islands },
    removedTownIds: [],
  }
  for (const town of state.towns) world.towns[town.id] = town

  if (state.missions.length === 0) return world

  const { rows } = await client.query(COUNTERPARTIES, [state.user.id, own])
  for (const row of rows) {
    const resources = Object.fromEntries(
      RESOURCES.map((r) => [r, Number(row[r])]),
    ) as Record<Resource, number>

    world.towns[Number(row.id)] = {
      id: Number(row.id),
      userId: Number(row.user_id),
      islandId: Number(row.island_id),
      slot: Number(row.slot),
      lastUpdate: secs(row.last_update),
      peoples: Number(row.peoples),
      resources,
      buildings: buildingsFrom(row.buildings),
      branchOffice: branchFrom(row.offers),
    }

    world.users[Number(row.user_id)] = {
      id: Number(row.user_id),
      gold: Number(row.owner_gold),
      transports: Number(row.owner_transports),
    }

    const i = row.island
    if (i && !world.islands[Number(i.id)]) {
      world.islands[Number(i.id)] = {
        id: Number(i.id),
        name: String(i.name),
        x: Number(i.x),
        y: Number(i.y),
        type: Number(i.type),
        tradeResource: Number(i.trade_resource),
        wonder: Number(i.wonder),
        woodLevel: Number(i.wood_level),
        tradeLevel: Number(i.trade_level),
        woodDonated: Number(i.wood_donated),
        tradeDonated: Number(i.trade_donated),
        woodUpgradeStartedAt: null,
        tradeUpgradeStartedAt: null,
        wonderLevel: Number(i.wonder_level ?? 1),
        wonderDonated: { wine: 0, marble: 0, crystal: 0, sulfur: 0 },
      } satisfies IslandState
    }
  }

  return world
}

/**
 * Persist the parts of the mission world the tick changed that do not belong
 * to the acting player: a counterparty's warehouse after an unload, its branch
 * shelf after a sale, its owner's gold after a purchase, and any colony town
 * an abandoned colonisation left behind.
 */
export async function saveMissionWorld(
  client: Queryable,
  state: PlayerState,
  world: MissionWorld,
) {
  const own = new Set(state.towns.map((t) => t.id))

  for (const town of Object.values(world.towns)) {
    if (own.has(town.id)) continue
    await client.query(
      `update towns set wood=$2, wine=$3, marble=$4, crystal=$5, sulfur=$6, peoples=$7
       where id=$1`,
      [town.id, ...RESOURCES.map((r) => town.resources[r]), town.peoples],
    )
    if (town.branchOffice) {
      for (const r of RESOURCES) {
        const offer = town.branchOffice.offers[r]
        // The `exists` guard: this snapshot was read before the action ran,
        // and an aborted colonisation deletes its colony town through an
        // intent that has already been applied by the time we get here.
        // Writing the shelf back would resurrect a row under a town that no
        // longer exists -- a straight FK violation.
        await client.query(
          `insert into branch_offers (town_id, resource, direction, count, price)
           select $1,$2,$3,$4,$5 where exists (select 1 from towns where id = $1)
           on conflict (town_id, resource) do update set
             direction = excluded.direction, count = excluded.count, price = excluded.price`,
          [town.id, r, offer.direction === 1 ? 'sell' : 'buy', offer.count, offer.price],
        )
      }
    }
  }

  for (const [id, user] of Object.entries(world.users)) {
    if (Number(id) === state.user.id) continue
    await client.query('update users set gold=$2, transports=$3 where id=$1', [
      Number(id),
      user.gold,
      user.transports,
    ])
  }

  for (const townId of world.removedTownIds) {
    await client.query('delete from towns where id = $1', [townId])
  }
}

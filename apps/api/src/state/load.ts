/**
 * Load a whole player graph in one round trip.
 *
 * The legacy fired between 25 and 950 queries per authenticated request: every
 * Data_Model loader guarded its cache with an undefined local variable
 * (izariam/models/data_model.php:28 and six siblings) so the memoisation never
 * hit, Load_Player then ran twice, and Island_Model::Load_Island issued up to
 * 33 queries to render a single island.
 *
 * Here the entire graph -- user, research, scores, towns with their buildings,
 * garrisons and queues, the islands they sit on, missions, trade routes and
 * spies -- comes back as one JSON document from one statement. Cost is flat in
 * the number of towns and missions.
 */

import { emptyBranchOffice } from '@izariam/rules/actions/trade'
import { RESOURCE_BY_TRADE_RESOURCE } from '@izariam/rules'
import type {
  BranchOfficeState,
  IslandState,
  MissionState,
  PlayerState,
  Resource,
  SpyState,
  TownState,
  TradeRouteState,
  UnitQueueEntry,
  UserState,
} from '@izariam/rules'

/** Postgres timestamptz -> epoch seconds, which is what the rules speak. */
function secs(v: string | null | undefined): number | null {
  if (v == null) return null
  const ms = Date.parse(v)
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000)
}

function secsOr(v: string | null | undefined, fallback: number): number {
  return secs(v) ?? fallback
}

/**
 * The player graph as one statement. Written with a positional parameter so it
 * can be sent as a single prepared statement; drizzle's sql template would
 * inline the value instead.
 */
export const PLAYER_GRAPH_SQL = `
  select json_build_object(
    'user', (
      select row_to_json(u) from (
        select id, login, email, gold, ambrosia, transports, research_points,
               tutorial_step, options_select, current_town_id, capital_town_id,
               premium_account_until, premium_wood_until, premium_wine_until,
               premium_marble_until, premium_crystal_until, premium_sulfur_until,
               premium_capacity_until
        from users where id = $1
      ) u
    ),
    'research', coalesce((
      select json_agg(json_build_object('branch', branch, 'node', node, 'level', level))
      from user_research where user_id = $1
    ), '[]'::json),
    'branch_seen', coalesce((
      select json_agg(json_build_object('branch', branch, 'seen', seen))
      from user_research_branch_seen where user_id = $1
    ), '[]'::json),
    'scores', coalesce((
      select json_object_agg(category, value) from user_scores where user_id = $1
    ), '{}'::json),
    'miracles', coalesce((
      select json_agg(json_build_object('islandId', island_id, 'wonder', wonder,
                                        'level', level, 'activatedAt', activated_at))
      from miracle_activations where user_id = $1
    ), '[]'::json),
    'towns', coalesce((
      select json_agg(t order by t.id) from (
        select tw.*,
          coalesce((select json_agg(json_build_object('slot', slot, 'type', type, 'level', level))
                    from town_buildings where town_id = tw.id), '[]'::json) as buildings,
          coalesce((select json_agg(json_build_object('slot', slot, 'type', type) order by position)
                    from build_queue where town_id = tw.id), '[]'::json) as build_queue,
          (select min(started_at) from build_queue where town_id = tw.id) as build_started_at,
          coalesce((select json_object_agg(unit_type, count)
                    from army_units where town_id = tw.id), '{}'::json) as army,
          coalesce((select json_agg(json_build_object('unitType', unit_type, 'count', count) order by position)
                    from unit_queue where town_id = tw.id and kind = 'land'), '[]'::json) as land_queue,
          (select min(started_at) from unit_queue where town_id = tw.id and kind = 'land') as land_started_at,
          coalesce((select json_agg(json_build_object('unitType', unit_type, 'count', count) order by position)
                    from unit_queue where town_id = tw.id and kind = 'naval'), '[]'::json) as naval_queue,
          (select min(started_at) from unit_queue where town_id = tw.id and kind = 'naval') as naval_started_at,
          coalesce((select json_agg(json_build_object('resource', resource, 'direction', direction,
                                                      'count', count, 'price', price))
                    from branch_offers where town_id = tw.id), '[]'::json) as branch_offers
        from towns tw where tw.user_id = $1
      ) t
    ), '[]'::json),
    'islands', coalesce((
      select json_agg(row_to_json(i)) from (
        select isl.*,
          -- Slot occupancy, needed by foundColony/relocateTown. Without it
          -- both bail with island_not_loaded and colonisation is dead.
          coalesce((select json_object_agg(slot, id) from towns where island_id = isl.id),
                   '{}'::json) as slots
        from islands isl where isl.id in (
        select island_id from towns where user_id = $1
        union
        select tw.island_id from missions m join towns tw on tw.id in (m.from_town_id, m.to_town_id)
        where m.user_id = $1
        )
      ) i
    ), '[]'::json),
    'missions', coalesce((
      select json_agg(m) from (
        select ms.*,
          coalesce((select json_object_agg(unit_type, count)
                    from mission_units where mission_id = ms.id), '{}'::json) as units,
          coalesce((select json_object_agg(resource, json_build_object('count', count, 'price', price))
                    from mission_trade_terms where mission_id = ms.id), '{}'::json) as trade_terms
        from missions ms
        where ms.user_id = $1
           or ms.from_town_id in (select id from towns where user_id = $1)
           or ms.to_town_id in (select id from towns where user_id = $1)
      ) m
    ), '[]'::json),
    'trade_routes', coalesce((
      select json_agg(row_to_json(r)) from trade_routes r where r.user_id = $1
    ), '[]'::json),
    'spies', coalesce((
      select json_agg(row_to_json(s)) from spies s where s.user_id = $1
    ), '[]'::json)
  ) as graph
`

interface RawGraph {
  user: Record<string, any> | null
  research: { branch: number; node: number; level: number }[]
  branch_seen: { branch: number; seen: boolean }[]
  scores: Record<string, number>
  miracles: { islandId: number; wonder: number; level: number; activatedAt: string }[]
  towns: Record<string, any>[]
  islands: Record<string, any>[]
  missions: Record<string, any>[]
  trade_routes: Record<string, any>[]
  spies: Record<string, any>[]
}


/** Anything that can run a parameterised query: a pg Pool, Client, or a tx. */
export interface Queryable {
  query(text: string, params: unknown[]): Promise<{ rows: any[] }>
}

/** Returns null when the user does not exist. */
export async function loadPlayerState(
  client: Queryable,
  userId: number,
): Promise<PlayerState | null> {
  const { rows } = await client.query(PLAYER_GRAPH_SQL, [userId])
  const graph = rows[0]?.graph as RawGraph | undefined
  if (!graph?.user) return null
  return hydrate(graph)
}

/**
 * The trading-post shelf and its search filters.
 *
 * `branch_offers` has been in the graph query from the start but nothing read
 * it, so every sale left the shelf untouched: missions.ts:653 saw
 * `to.branch === undefined` and skipped the decrement.
 *
 * Always returns an office, never undefined. The legacy kept branch_trade_* as
 * plain columns on the town, so `$trade_town->branch_trade_wood_type` reads
 * fine on a town with no trading post -- it is 1/0/0, an empty sell offer, and
 * the count guards in update_model.php:555 reject it on their own.
 */
function branchOffice(t: Record<string, any>): BranchOfficeState {
  const office = emptyBranchOffice()
  office.searchType = t.branch_search_direction === 'sell' ? 1 : 0
  office.searchResource = Number(
    Object.entries(RESOURCE_BY_TRADE_RESOURCE).find(
      ([, name]) => name === t.branch_search_resource,
    )?.[0] ?? 0,
  )
  office.searchRadius = Number(t.branch_search_radius ?? 1)
  for (const row of (t.branch_offers ?? []) as any[]) {
    office.offers[row.resource as Resource] = {
      direction: row.direction === 'sell' ? 1 : 0,
      count: Number(row.count),
      price: Number(row.price),
    }
  }
  return office
}

/** An island has 17 town slots. Free ones must be present and 0, not absent. */
export const ISLAND_SLOTS = 17

function islandSlots(raw: Record<string, unknown> | null | undefined): Record<number, number> {
  const slots: Record<number, number> = {}
  for (let i = 0; i < ISLAND_SLOTS; i++) slots[i] = 0
  for (const [slot, townId] of Object.entries(raw ?? {})) slots[Number(slot)] = Number(townId)
  return slots
}

/** One island row, raw snake_case to the rules' shape. */
function hydrateIsland(i: Record<string, any>): IslandState {
  return {
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
    woodUpgradeStartedAt: secs(i.wood_upgrade_started_at),
    tradeUpgradeStartedAt: secs(i.trade_upgrade_started_at),
    wonderLevel: Number(i.wonder_level),
    // Read before any island lock, so a donation refreshes them from the
    // locked row before deciding anything (routes/actions.ts).
    wonderDonated: {
      wine: Number(i.wonder_wine_donated),
      marble: Number(i.wonder_marble_donated),
      crystal: Number(i.wonder_crystal_donated),
      sulfur: Number(i.wonder_sulfur_donated),
    },
    slots: islandSlots(i.slots),
  }
}

/**
 * Load one island into the graph for an action that targets it. The graph
 * query only selects islands the player already has a town or a mission on,
 * so a colonisation aimed at a fresh island would arrive at the rules without
 * it and be refused `island_not_loaded` -- the first colony on any new island
 * was unlaunchable. No-op when the island is already loaded; when the id
 * matches no row the rules' own unknown-island path takes over.
 */
export async function loadIslandIntoGraph(
  client: Queryable,
  state: PlayerState,
  islandId: number,
): Promise<void> {
  if (state.islands[islandId]) return
  const { rows } = await client.query(
    `select isl.*,
       coalesce((select json_object_agg(slot, id) from towns where island_id = isl.id),
                '{}'::json) as slots
     from islands isl where isl.id = $1`,
    [islandId],
  )
  if (rows[0]) state.islands[islandId] = hydrateIsland(rows[0])
}

function hydrate(g: RawGraph): PlayerState {
  const u = g.user!

  const levels: Record<string, number> = {}
  for (const r of g.research ?? []) levels[`${r.branch}_${r.node}`] = Number(r.level)
  const branchSeen: Record<number, boolean> = {}
  for (const b of g.branch_seen ?? []) branchSeen[Number(b.branch)] = Boolean(b.seen)

  const user: UserState = {
    id: Number(u.id),
    login: String(u.login),
    gold: Number(u.gold),
    ambrosia: Number(u.ambrosia),
    transports: Number(u.transports),
    tutorialStep: Number(u.tutorial_step),
    options: { citySelect: Number(u.options_select) },
    currentTownId: u.current_town_id == null ? null : Number(u.current_town_id),
    capitalTownId: u.capital_town_id == null ? null : Number(u.capital_town_id),
    research: { levels, points: Number(u.research_points), branchSeen },
    premium: {
      account: secs(u.premium_account_until),
      wood: secs(u.premium_wood_until),
      wine: secs(u.premium_wine_until),
      marble: secs(u.premium_marble_until),
      crystal: secs(u.premium_crystal_until),
      sulfur: secs(u.premium_sulfur_until),
      capacity: secs(u.premium_capacity_until),
    },
    scores: Object.fromEntries(
      Object.entries(g.scores ?? {}).map(([k, v]) => [k, Number(v)]),
    ),
    miracles: (g.miracles ?? []).map((m) => ({
      islandId: Number(m.islandId),
      wonder: Number(m.wonder),
      level: Number(m.level),
      activatedAt: secs(m.activatedAt) ?? 0,
    })),
  }

  const towns: TownState[] = (g.towns ?? []).map((t) => {
    const bySlot: Record<number, { type: number; level: number }> = {}
    for (let slot = 0; slot <= 14; slot++) bySlot[slot] = { type: 0, level: 0 }
    for (const b of t.buildings ?? []) {
      bySlot[Number(b.slot)] = { type: Number(b.type), level: Number(b.level) }
    }

    const army: Record<number, number> = {}
    for (const [unitType, count] of Object.entries(t.army ?? {})) {
      army[Number(unitType)] = Number(count)
    }

    const queue = (rows: any[]): UnitQueueEntry[] =>
      (rows ?? []).map((r) => ({ unitType: Number(r.unitType), count: Number(r.count) }))

    return {
      id: Number(t.id),
      userId: Number(t.user_id),
      islandId: Number(t.island_id),
      slot: Number(t.slot),
      name: String(t.name),
      lastUpdate: secsOr(t.last_update, 0),
      resources: {
        wood: Number(t.wood),
        wine: Number(t.wine),
        marble: Number(t.marble),
        crystal: Number(t.crystal),
        sulfur: Number(t.sulfur),
      },
      peoples: Number(t.peoples),
      workers: Number(t.workers),
      tradegood: Number(t.tradegood),
      scientists: Number(t.scientists),
      templer: Number(t.templer),
      buildings: { bySlot },
      buildQueue: (t.build_queue ?? []).map((b: any) => ({
        slot: Number(b.slot),
        type: Number(b.type),
      })),
      buildStartedAt: secs(t.build_started_at),
      spies: Number(t.spies),
      spyTrainingStartedAt: secs(t.spy_training_started_at),
      workersWood: Number(t.workers_wood),
      tradegoodWood: Number(t.tradegood_wood),
      wonderDonated: Number(t.wonder_donated),
      actionPoints: Number(t.action_points),
      tavernWine: Number(t.tavern_wine),
      army,
      landQueue: queue(t.land_queue),
      landQueueStartedAt: secs(t.land_started_at),
      navalQueue: queue(t.naval_queue),
      navalQueueStartedAt: secs(t.naval_started_at),
      branchOffice: branchOffice(t),
    }
  })

  const islands: Record<number, IslandState> = {}

  for (const i of g.islands ?? []) {
    islands[Number(i.id)] = hydrateIsland(i)
  }

  const missions: MissionState[] = (g.missions ?? []).map((m) => {
    const units: Record<number, number> = {}
    for (const [unitType, count] of Object.entries(m.units ?? {})) {
      units[Number(unitType)] = Number(count)
    }
    const tradeTerms: MissionState['tradeTerms'] = {}
    for (const [res, terms] of Object.entries(m.trade_terms ?? {})) {
      const t = terms as { count: number; price: number }
      tradeTerms[res as Resource] = { count: Number(t.count), price: Number(t.price) }
    }
    return {
      id: Number(m.id),
      userId: Number(m.user_id),
      fromTownId: Number(m.from_town_id),
      toTownId: m.to_town_id == null ? null : Number(m.to_town_id),
      kind: m.kind,
      loadingFromStartedAt: secs(m.loading_from_started_at),
      loadingToStartedAt: secs(m.loading_to_started_at),
      departedAt: secs(m.departed_at),
      returnStartedAt: secs(m.return_started_at),
      arrivesAt: secs(m.arrives_at),
      abortPercent: Number(m.abort_percent),
      transports: Number(m.transports),
      cargo: {
        wood: Number(m.wood),
        wine: Number(m.wine),
        marble: Number(m.marble),
        crystal: Number(m.crystal),
        sulfur: Number(m.sulfur),
        gold: Number(m.gold),
        peoples: Number(m.peoples),
      },
      units,
      tradeTerms,
    }
  })

  const tradeRoutes: TradeRouteState[] = (g.trade_routes ?? []).map((r) => ({
    id: Number(r.id),
    userId: Number(r.user_id),
    fromTownId: r.from_town_id == null ? null : Number(r.from_town_id),
    toTownId: r.to_town_id == null ? null : Number(r.to_town_id),
    nextRunAt: secsOr(r.next_run_at, 0),
    resource: r.resource,
    sendCount: Number(r.send_count),
    sendTime: Number(r.send_time),
  }))

  const spies: SpyState[] = (g.spies ?? []).map((s) => ({
    id: Number(s.id),
    userId: Number(s.user_id),
    fromTownId: Number(s.from_town_id),
    toTownId: s.to_town_id == null ? null : Number(s.to_town_id),
    risk: Number(s.risk),
    missionType: Number(s.mission_type),
    startedAt: secs(s.started_at),
    lastUpdate: secsOr(s.last_update, 0),
  }))

  return { user, towns, islands, missions, tradeRoutes, spies }
}

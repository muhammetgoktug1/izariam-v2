/**
 * Load the player, advance the world, hand back a state an action can run on.
 *
 * Every authenticated request goes through here. The legacy did the same thing
 * in the Game controller's constructor: there is no scheduler, so the world
 * only moves when somebody looks at it, and `elapsed = now - last_update` makes
 * that indistinguishable from a world that never stopped.
 *
 * The reason this exists as its own module rather than three lines in the state
 * route: `tickPlayer` takes three hooks and the route passed none of them, so
 * missions never arrived, colonies never completed, trade never settled, routes
 * never fired and spies never moved. Half the engine ran on every request and
 * threw its results away. Anything that needs a ticked world calls `advance`,
 * and the hooks come with it.
 */

import {
  DEFAULT_CONFIG,
  createSpiesHook,
  tickMissions,
  tickPlayer,
  tickTradeRoutes,
  type MissionWorld,
  type PendingMessage,
  type PlayerState,
  type SpyTargetTown,
} from '@izariam/rules'

import { loadPlayerState, type Queryable } from './load.js'
import { savePlayerState } from './save.js'
import { loadMissionWorld, saveMissionWorld } from './world.js'

/**
 * Towns this player's spies are walking towards. The hook has to be
 * synchronous, so the rows are fetched up front and the resolver reads a map.
 */
const SPY_TARGETS = `
  select t.id, t.user_id, t.name, t.island_id, i.x, i.y, t.spies,
         coalesce((select level from town_buildings where town_id = t.id and slot = 0), 0)
           as town_hall_level,
         coalesce((select max(level) from town_buildings where town_id = t.id and type = 14), 0)
           as safehouse_level
  from towns t join islands i on i.id = t.island_id
  where t.id = any($1::int[])
`

async function spyTargets(
  client: Queryable,
  state: PlayerState,
): Promise<Map<number, SpyTargetTown>> {
  const ids = state.spies.map((s) => s.toTownId).filter((id): id is number => id != null)
  const targets = new Map<number, SpyTargetTown>()
  if (ids.length === 0) return targets

  const { rows } = await client.query(SPY_TARGETS, [ids])
  for (const r of rows) {
    targets.set(Number(r.id), {
      id: Number(r.id),
      userId: Number(r.user_id),
      name: String(r.name),
      islandId: Number(r.island_id),
      x: Number(r.x),
      y: Number(r.y),
      spies: Number(r.spies),
      townHallLevel: Number(r.town_hall_level),
      safehouseLevel: Number(r.safehouse_level),
    })
  }
  return targets
}

export interface Advanced {
  state: PlayerState
  messages: PendingMessage[]
  world: MissionWorld
  now: number
}

/**
 * Returns null when the user has no row.
 *
 * The first statement takes the player's row, and it is load-bearing.
 * `loadPlayerState` reads the whole graph without a lock and `savePlayerState`
 * writes it back with blind full-row UPDATEs, so two overlapping requests for
 * the same player each read the same numbers and the second one to commit wins
 * -- a build ordered while a `GET /api/state` was in flight loses its cost, and
 * two concurrent purchases can both spend the same gold. Locking the row here
 * serialises every read-modify-write per player at the cost of one round trip.
 *
 * Both callers (`routes/state.ts`, `routes/actions.ts`) and the admin panel's
 * grant already run inside `transaction()`, which is what makes the lock hold
 * until the write lands. It is a single row, always taken first, so there is
 * nothing to deadlock against.
 */
export async function advance(
  client: Queryable,
  userId: number,
  now = Math.floor(Date.now() / 1000),
): Promise<Advanced | null> {
  const locked = await client.query('select id from users where id = $1 for update', [userId])
  if (locked.rows.length === 0) return null

  const loaded = await loadPlayerState(client, userId)
  if (!loaded) return null

  const world = await loadMissionWorld(client, loaded)
  const targets = await spyTargets(client, loaded)

  const { state, messages } = tickPlayer(loaded, now, DEFAULT_CONFIG, {
    missions: (s, at, msgs) => tickMissions(s, at, msgs, world),
    // Routes fire fleets straight into state.missions with id 0; the mission
    // loop above has already run for this tick, so they leave next time. That
    // is the legacy order too (update_model.php:1104).
    tradeRoutes: (s, at, msgs) => {
      tickTradeRoutes(s, at, msgs)
    },
    spies: createSpiesHook({ target: (townId) => targets.get(townId) }),
  })

  return { state, messages, world, now }
}

/**
 * Write back everything the tick touched: the player's own graph, and the
 * counterparties the mission loop reached into.
 */
export async function persist(
  client: Queryable,
  advanced: Advanced,
  intents: Parameters<typeof savePlayerState>[3] = [],
) {
  await savePlayerState(client, advanced.state, advanced.messages, intents)
  await saveMissionWorld(client, advanced.state, advanced.world)
}

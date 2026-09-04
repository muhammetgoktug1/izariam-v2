/**
 * Standing trade routes, ported from Update_Model::Update_Trade_Routes
 * (izariam/models/update_model.php:989-1034).
 *
 * A route is a standing order: once per cycle it ships a fixed amount of one
 * resource from one of the player's towns to another. There is no cron, so
 * this is a catch-up loop -- every cycle missed while the player was offline is
 * replayed in a single pass, and each replay is charged against *today's*
 * stockpile, cargo fleet and action points rather than the ones the town had on
 * the day the shipment was actually due. A player who returns after a week with
 * full warehouses fires up to a week's worth of shipments at once, limited only
 * by how many action points the town hall grants.
 *
 * Runs between the two Update_Missions passes (update_model.php:35-38), which
 * is why it can spend action points that Update_Towns has just recomputed.
 */

import { DEFAULT_CONFIG, type GameConfig } from './config.js'
import { isTownActive } from './derive.js'
import {
  emptyResources,
  type MissionState,
  type PendingMessage,
  type PlayerState,
  type TownState,
} from './types.js'

/**
 * Seconds between two runs of the same route.
 *
 * Deliberately not `config.tradeRouteInterval`. izariam/config/izariam.php:68
 * declares `trade_route_time = 604800` and nothing in the codebase ever reads
 * it -- the loop hardcodes 86400 (update_model.php:1026). The UI agrees with
 * the hardcoded value: route_time() (izariam/helpers/izariam_helper.php:133)
 * schedules the next occurrence of a chosen hour *of the day*. Routes are
 * daily; the weekly config item is dead.
 */
const CYCLE_SECONDS = 86400

/**
 * Fire every trade-route cycle that has come due, and return the transport
 * missions that were created.
 *
 * Shaped to satisfy TickHooks.tradeRoutes -- the return value is ignored when
 * it is installed as a hook, and is there for the API layer, which needs the
 * new rows to assign real mission ids. A non-default config must be closed
 * over at the call site, since tickPlayer does not forward its own.
 */
export function tickTradeRoutes(
  state: PlayerState,
  now: number,
  messages: PendingMessage[],
  config: GameConfig = DEFAULT_CONFIG,
): MissionState[] {
  const created: MissionState[] = []

  // Load_Player drops any town with pos0_level == 0 from `$this->towns`
  // (player_model.php:55), so a route sourced from an in-flight colonisation
  // indexes a missing entry. PHP resolved that to NULL, and `NULL > 0` failed
  // the action-point test below -- which is the only reason such a route never
  // ships. Its schedule still advances.
  const towns = new Map<number, TownState>()
  for (const town of state.towns) {
    if (isTownActive(town)) towns.set(town.id, town)
  }

  for (const route of state.tradeRoutes) {
    while (now >= route.nextRunAt) {
      const cycleAt = route.nextRunAt
      const from = route.fromTownId == null ? undefined : towns.get(route.fromTownId)

      // `>=`, not `>`, so a zero-count route clears the stock test. Unreachable
      // in practice: send_count is only ever zeroed together with `from`
      // (actions.php:47-48, run when a town is deleted), and the resulting
      // missing town then fails the action-point test.
      if (from !== undefined && from.resources[route.resource] >= route.sendCount) {
        const transports = Math.ceil(route.sendCount / config.transportCapacity)

        // Note there is no `transports != 0` guard here, unlike the manual
        // transport screen (actions.php:1854). Only the action point stops a
        // zero-count route from launching empty fleets.
        if (state.user.transports >= transports && from.actionPoints > 0) {
          from.resources[route.resource] -= route.sendCount
          from.actionPoints -= 1
          // Charged to the player being ticked, while the mission and the
          // message below are attributed to `route.user`. The two agree unless
          // a route row outlives a town transfer.
          state.user.transports -= transports

          const cargo = { ...emptyResources(), gold: 0, peoples: 0 }
          cargo[route.resource] = route.sendCount

          const mission: MissionState = {
            // 0 means "not persisted yet"; the save layer inserts it and
            // Postgres assigns the id. Synthesising max+1 here would collide
            // across players, since the sequence is global.
            id: 0,
            userId: route.userId,
            fromTownId: from.id,
            toTownId: route.toTownId,
            kind: 'transport',
            // Stamped with the cycle's due time, not `now`. On a catch-up the
            // mission is therefore born backdated by up to the full offline
            // window, so its port loading and its voyage are already partly or
            // wholly in the past by the time missions.ts first sees it.
            loadingFromStartedAt: cycleAt,
            loadingToStartedAt: null,
            departedAt: null,
            returnStartedAt: null,
            arrivesAt: null,
            abortPercent: 0,
            transports,
            cargo,
            units: {},
            tradeTerms: {},
          }
          // The legacy only INSERTed this row; it never appended it to the
          // in-memory `$missions` array, so the second Update_Missions pass at
          // update_model.php:37 could not see it and the mission first ticked
          // on the player's next request. Appending here makes it visible to
          // that pass instead -- see the report accompanying this file.
          state.missions.push(mission)
          created.push(mission)

          messages.push({
            channel: 'town',
            userId: route.userId,
            townId: from.id,
            kind: 'trade_route_started',
            params: {
              routeId: route.id,
              fromTownId: from.id,
              toTownId: route.toTownId,
              resource: route.resource,
              count: route.sendCount,
              transports,
              at: cycleAt,
              // The legacy sentence reads "trade mission started on the route
              // to X" but interpolates the *source* town's name
              // (update_model.php:1016). Carried through unchanged so the
              // rendered text matches; do not substitute the real destination.
              routeToName: from.name,
            },
          })
        }
      }

      // Advanced outside the guards: a cycle the town could not pay for is
      // dropped, never retried, and leaves no trace.
      route.nextRunAt = cycleAt + CYCLE_SECONDS
    }
  }

  return created
}

/** The legacy leaned on the missions table's AUTO_INCREMENT. Nothing in the
 *  rules touches a database, so ids are handed out above the highest one
 *  already in the graph and the persistence layer remaps them on insert. */

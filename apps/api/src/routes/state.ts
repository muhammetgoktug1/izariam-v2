/**
 * GET /api/state -- advance the world and return the player's whole graph.
 *
 * 68 of the legacy's 70 read-only screens rendered from the same Player_Model
 * object graph, so they collapse into this one endpoint rather than 68. The
 * tick runs here for the same reason it ran in the Game controller: there is
 * no scheduler, and elapsed-time accrual makes offline progress correct
 * without one.
 *
 * The tick itself lives in state/advance.ts, with the three hooks
 * (missions, trade routes, spies) that this route used to omit.
 *
 * Alongside the graph it returns what the chrome needs and the graph alone
 * cannot supply: the unread-message counts behind the advisor badges, the
 * research-advisor flag, and the instant each town's build queue completes.
 */

import {
  actionPointsByLevel,
  buildingCost,
  derive,
  levelsByType,
  researchWays,
  totalTransports,
} from '@izariam/rules'
import { Router } from 'express'

import { transaction } from '../db.js'
import { advance, persist } from '../state/advance.js'
import { islandFaith } from '../state/foreign.js'
import type { Queryable } from '../state/load.js'

export const stateRouter: Router = Router()

/** The two counters the legacy loaded in the Game controller constructor. */
async function messageCounts(client: Queryable, userId: number) {
  const { rows } = await client.query(
    `select
       (select count(*)::int from town_messages
         where user_id = $1 and read_at is null) as town,
       (select count(*)::int from message_recipients mr
          join user_messages m on m.id = mr.message_id
         where mr.user_id = $1 and mr.side = 'to' and mr.read_at is null
           and not mr.deleted and m.created_at > now() - interval '7 days') as user,
       (select count(*)::int from spy_messages where user_id = $1 and read_at is null) as spy,
       (select body from notes where user_id = $1) as notes`,
    [userId],
  )
  return {
    newTownMessages: Number(rows[0]?.town ?? 0),
    newUserMessages: Number(rows[0]?.user ?? 0),
    newSpyMessages: Number(rows[0]?.spy ?? 0),
    notes: String(rows[0]?.notes ?? ''),
  }
}

stateRouter.get('/state', async (req, res) => {
  const userId = req.userId!
  const payload = await transaction(async (client) => {
    const advanced = await advance(client, userId)
    if (!advanced) return null
    const { state: ticked, now } = advanced
    await persist(client, advanced)

    // Recompute after the tick so the client sees the same numbers the next
    // action will be validated against.
    const derived = derive(ticked, now)
    const { advisor } = researchWays(ticked.user.research)
    const counts = await messageCounts(client, userId)

    // Per-town: when the head of the build queue finishes, and how many
    // action points the town hall grants. Neither is derivable client-side --
    // the client has no cost tables.
    const towns: Record<
      number,
      { buildEndsAt: number | null; maxActionPoints: number }
    > = {}
    for (const town of ticked.towns) {
      const head = town.buildQueue[0]
      let buildEndsAt: number | null = null
      if (head && town.buildStartedAt != null) {
        const levels = levelsByType(town)
        const level = town.buildings.bySlot[head.slot]?.level ?? 0
        const cost = buildingCost(head.type, level, ticked.user.research, levels)
        buildEndsAt = town.buildStartedAt + cost.time
      }
      towns[town.id] = {
        buildEndsAt,
        maxActionPoints: actionPointsByLevel(town.buildings.bySlot[0]?.level ?? 0),
      }
    }

    // Fleets still loading at the quay drive the transporter sprite on the
    // city screen (player_model.php:230).
    const missionsLoading = ticked.missions.filter((m) => m.departedAt == null).length

    // The chrome shows "free / total": ships sitting at home over ships owned.
    // Everything in flight is counted by the missions, not by users.transports.
    const transports = {
      free: ticked.user.transports,
      total: totalTransports(ticked),
    }

    // Premium is seven independent expiries; the toolbar only asks whether the
    // account boost itself is live.
    const hasPremium = (ticked.user.premium.account ?? 0) > now

    // Island faith, for the islands this player has a town on. It sums over
    // *every* town there, including other players', so the client cannot work
    // it out from the graph it was handed -- and it rides along with the state
    // rather than getting its own endpoint, because the client refetches this
    // one on every screen change anyway.
    const faith = Object.fromEntries(
      [...(await islandFaith(client, [...new Set(ticked.towns.map((t) => t.islandId))]))].map(
        ([islandId, entry]) => [islandId, entry],
      ),
    )

    return {
      now,
      state: ticked,
      derived,
      chrome: {
        ...counts,
        researchAdvisor: advisor,
        missionsLoading,
        transports,
        hasPremium,
        towns,
        faith,
      },
    }
  })

  if (!payload) {
    res.status(404).json({ error: 'no_player' })
    return
  }
  res.json(payload)
})

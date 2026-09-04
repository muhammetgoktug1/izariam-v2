/**
 * Donating to an island's monument.
 *
 * There is no legacy counterpart. The 2012 game describes the mechanic in its
 * help text -- "the monument can be extended up to level 5, all players on the
 * island can donate resources, and luxury goods are needed, in particular
 * those that are not readily available on the island" (`information43_2`) --
 * and ships a stylesheet for the page (`design/skin/ik_wonder_0.4.5.css`) with
 * no page, no columns and no controller behind it.
 *
 * The island row is not read here. It is passed in, already locked, exactly as
 * `activateMiracle` takes its faith: the rules layer has no database, and the
 * counters it decides on are shared between every player on the island, so the
 * one thing it must not do is work from a copy loaded before the lock.
 *
 * Rejection reasons in use:
 *   donation_rejected   amount, island or stock check failed
 *   wonder_no_wonder    the island has no monument to give to
 *   wonder_max_level    it is already at 5
 *   wonder_wrong_good   the island produces that good itself
 */

import {
  WONDER_MAX_LEVEL,
  wonderGoods,
  wonderUpgradeCost,
} from '../temple.js'
import type {
  ActionResult,
  PendingMessage,
  WonderGood,
} from '../types.js'
import type { ActionContext } from './building.js'

/** The island's monument, as the route read it under `for update`. */
export interface WonderIsland {
  /** `islands.wonder`, 1..8. 0 means the island has none. */
  wonder: number
  tradeResource: number
  wonderLevel: number
  donated: Record<WonderGood, number>
}

export interface WonderDonationInput {
  islandId: number
  good: WonderGood
  amount: number
  island: WonderIsland
}

/**
 * An intersection rather than an `extends`: `ActionResult` is the union of the
 * ok and the failed shape, and an interface cannot extend a union.
 */
export type WonderDonationResult = ActionResult & {
  /** What the route must write back to the row it holds the lock on. Absent on
   *  a rejection, so a refused donation cannot write anything. */
  island?: { wonderLevel: number; donated: Record<WonderGood, number> }
  /** Levels gained by this donation, 0 or more. */
  levelsGained?: number
}

function reject(reason: string): WonderDonationResult {
  return { ok: false, reason }
}

/**
 * Give one luxury good to the monument, and expand it if that was the last
 * good it was waiting for.
 *
 * The expansion is immediate rather than timed. The island nodes are timed
 * because the legacy gave them a `time` column and `Update_Islands` read it;
 * the monument has no legacy cost at all, and more importantly `tickIslands`
 * only advances islands the *acting* player has a town on -- a monument that
 * finished when one particular neighbour next logged in would look like a
 * balance decision rather than the bug it is. Everyone on the island reads
 * `wonderLevel` through the miracle clamp, so it has to be true the moment the
 * goods are in.
 */
export function donateWonder(
  ctx: ActionContext,
  input: WonderDonationInput,
): WonderDonationResult {
  const { town } = ctx
  const amount = Math.floor(input.amount)
  const { island } = input

  if (amount <= 0 || town.islandId !== input.islandId) return reject('donation_rejected')
  if (!island.wonder) return reject('wonder_no_wonder')
  if (island.wonderLevel >= WONDER_MAX_LEVEL) return reject('wonder_max_level')

  const goods = wonderGoods(island.tradeResource)
  if (!goods.includes(input.good)) return reject('wonder_wrong_good')
  if (town.resources[input.good] < amount) return reject('donation_rejected')

  const donated: Record<WonderGood, number> = {
    wine: island.donated.wine,
    marble: island.donated.marble,
    crystal: island.donated.crystal,
    sulfur: island.donated.sulfur,
  }
  donated[input.good] += amount

  town.resources[input.good] -= amount
  town.wonderDonated += amount

  // Surplus carries into the next level, the way an island node's does
  // (tick.ts). The loop needs *all three* goods to clear the cost each time
  // round, so one good arriving in bulk cannot buy two levels on its own.
  const messages: PendingMessage[] = []
  let level = island.wonderLevel
  let gained = 0
  for (;;) {
    const cost = wonderUpgradeCost(level)
    if (cost == null) break
    if (!goods.every((g) => donated[g] >= cost)) break
    for (const g of goods) donated[g] -= cost
    level += 1
    gained += 1
    // Only the donor is told. The island node's own upgrade message goes out
    // with `userId: 0` and is then dropped by save.ts:600, which filters on
    // `userId > 0` -- writing rows for the island's other players is a
    // cross-player write this port does not do from an action.
    messages.push({
      channel: 'town',
      userId: ctx.state.user.id,
      townId: town.id,
      kind: 'island_wonder_upgraded',
      params: { islandId: input.islandId, level },
    })
  }

  return { ok: true, messages, island: { wonderLevel: level, donated }, levelsGained: gained }
}

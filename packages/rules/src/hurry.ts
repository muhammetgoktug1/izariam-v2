/**
 * Paying ambrosia to bring a construction forward.
 *
 * This one is **not** ported from the 2012 source -- the legacy has no such
 * feature, and `izariam/` spends ambrosia on exactly three things (a premium
 * boost, relocating a city, a second trade route). It reproduces what live
 * Ikariam does today, in two clicks: "shorten building time" removes half of
 * what is left, "complete instantly" removes all of it.
 *
 * The price curve is the wiki's, in seconds of *removed* time:
 *
 *     <= 300s          free           (patch 0.6.5 made the last five minutes free)
 *     301 .. 64_799s   4 per half hour, plus a flat 4
 *     >= 64_800s       148            (the cap; 18 hours is where the curve meets it)
 *
 * Both clicks are priced from the same curve, so halving costs less than
 * finishing and two clicks cost more than one -- which is the arrangement live
 * Ikariam ends up with.
 *
 * `hurryCost` lives in the rules package rather than in either app because the
 * client's quote and the server's charge have to agree to the unit; two
 * implementations of one curve disagree the first time somebody edits one.
 */

import { buildingCost } from './costs.js'
import { levelsByType, type PlayerState, type TownState } from './types.js'

/** Anything at or under this is free. */
export const HURRY_FREE_SECONDS = 300
export const HURRY_BLOCK_SECONDS = 1800
export const HURRY_PER_BLOCK = 4
export const HURRY_BASE = 4
/** Reached at exactly 64_800s: ceil(4 * 64800 / 1800) + 4 = 148. */
export const HURRY_CAP = 148

/**
 * What removing `seconds` of build time costs, in ambrosia.
 *
 * Rounded up: ambrosia is an integer column, and rounding a price down is a
 * discount nobody asked for.
 */
export function hurryCost(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= HURRY_FREE_SECONDS) return 0
  const raw = Math.ceil((HURRY_PER_BLOCK * seconds) / HURRY_BLOCK_SECONDS) + HURRY_BASE
  return Math.min(HURRY_CAP, raw)
}

export interface ConstructionHead {
  slot: number
  type: number
  /** The level standing at the slot now; the one being built is this + 1. */
  level: number
  startedAt: number
  endsAt: number
}

/**
 * The construction actually under way in this town, or null.
 *
 * Only the head of the queue counts. Everything behind it is waiting on the
 * head's clock -- `runBuildQueue` walks the queue from one `buildStartedAt`
 * (tick.ts:292-392), so there is no second timer to shorten.
 *
 * Priced at the *built* level, not at the level the entry will reach: an
 * upgrade was costed when it was queued, which is what BuildingHeader and the
 * construction list already do.
 */
export function constructionHead(state: PlayerState, town: TownState): ConstructionHead | null {
  const head = town.buildQueue[0]
  const startedAt = town.buildStartedAt
  if (!head || startedAt == null || startedAt <= 0) return null

  const slot = town.buildings.bySlot[head.slot] ?? { type: 0, level: 0 }
  const cost = buildingCost(head.type, slot.level, state.user.research, levelsByType(town))

  return {
    slot: head.slot,
    type: head.type,
    level: slot.level,
    startedAt,
    endsAt: startedAt + cost.time,
  }
}

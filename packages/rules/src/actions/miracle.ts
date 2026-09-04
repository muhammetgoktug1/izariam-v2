/**
 * Calling a miracle from an island's wonder.
 *
 * There is no legacy counterpart: the 2012 game ships the eight wonders as
 * names, descriptions, per-level effects, durations and cooldowns -- and one
 * static screen that prints them. Nothing activates anything. What is ported
 * here is that data (see temple.ts); the rules around it are live Ikariam's.
 *
 * Faith is not computed here, and neither is the monument's level. Both are
 * properties of the island rather than of this player -- faith sums the
 * priests and population of *every* town there, and the monument is raised by
 * everyone who lives on it -- so the API passes them in, the same arrangement
 * espionage uses for its target.
 */

import {
  MIRACLES,
  effectiveMiracleLevel,
  miracleWindow,
  templesForWonder,
} from '../temple.js'
import { BUILDING, type ActionResult, type PlayerState, type TownState } from '../types.js'

export interface MiracleContext {
  state: PlayerState
  now: number
}

export interface MiracleInput {
  islandId: number
  /** `islands.wonder`, 0 for an island without one. */
  wonder: number
  /** Island-wide faith, 0..1, computed by the caller. */
  faith: number
  /** `islands.wonder_level`, 1..5. Read by the caller for the same reason
   *  faith is: the island row is shared and the client cannot be asked. */
  wonderLevel: number
}

function reject(reason: string): ActionResult {
  return { ok: false, reason }
}

/** A town of this player on that island, with a temple standing. */
function templeTown(state: PlayerState, islandId: number): TownState | undefined {
  return state.towns.find(
    (town) =>
      town.islandId === islandId &&
      Object.values(town.buildings.bySlot).some(
        (b) => b.type === BUILDING.TEMPLE && b.level > 0,
      ),
  )
}

/**
 * Pray. The effect lands on the whole empire, not on the island -- the legacy
 * says so itself (`information44_3`): "Priests are very clever, they only pray
 * for the miracle for the whole population."
 */
export function activateMiracle(ctx: MiracleContext, input: MiracleInput): ActionResult {
  const { state, now } = ctx

  const spec = MIRACLES[input.wonder]
  if (!spec) return reject('no_wonder')

  // A temple on that island is what gives the priests somewhere to pray, so it
  // is checked before anything about faith.
  if (!templeTown(state, input.islandId)) return reject('no_temple_on_island')

  // A combat wonder is called like any other. Its duration and cooldown run,
  // the level is recorded, and `miracleBonus` has nothing to hand it to until
  // this port has a fight -- which is a missing consumer, not a reason to
  // refuse a player their island's god.

  // Faith says how much of the island believes; the monument says how much of
  // that offering it can carry. The smaller one is what the priests get. No
  // separate rejection for a small monument: every island starts at level 1,
  // so the monument can only ever bind *below* what faith allows, never at
  // zero when faith would have allowed something.
  const level = effectiveMiracleLevel(input.wonderLevel, input.faith)
  if (level < 1) return reject('faith_too_low')

  const existing = state.user.miracles.find((m) => m.islandId === input.islandId)
  if (existing) {
    const temples = templesForWonder(state, input.wonder)
    const { cooldownFor } = miracleWindow(spec, existing.activatedAt, now, temples)
    if (cooldownFor > 0) return reject('miracle_cooling_down')
  }

  const called = {
    islandId: input.islandId,
    wonder: input.wonder,
    level,
    activatedAt: now,
  }
  state.user.miracles = [
    ...state.user.miracles.filter((m) => m.islandId !== input.islandId),
    called,
  ]

  return { ok: true, messages: [] }
}

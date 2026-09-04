/**
 * The temple: priests, faith, the island's wonder and its miracle.
 *
 * The legacy wrote half of this and connected none of it. `towns.templer` is a
 * column no controller ever assigns, the temple (building 26) has a name and a
 * description but no cost and no page, and the eight wonders exist as *text*:
 * names, per-level effects, durations and cooldowns in `data_model.php:1500-1575`
 * and the language file, read by one static info screen and nothing else.
 *
 * So every number here comes from live Ikariam, which is the game the legacy
 * was copying:
 *
 * - the priest capacity per temple level and the temple's own cost table
 *   (@izariam/gamedata `TEMPLE`);
 * - the faith thresholds that unlock each of the five miracle levels;
 * - the per-level effect magnitudes, durations and cooldowns below.
 *
 * The legacy's own effect strings were an older, weaker balance -- half the
 * magnitudes and different windows -- and reproducing them would have shipped
 * a temple nobody recognises. `wonderN_levelM` in the catalogs is written from
 * this table, not the other way round.
 *
 * Four of the eight miracles are combat effects -- armour, damage, morale,
 * refunds for units that died defending -- and this port has no combat. They
 * can still be called, and their duration and cooldown run exactly like the
 * others; `miracleBonus` simply has nothing to hand them to yet.
 */

import { TEMPLE } from '@izariam/gamedata'

import { BUILDING, type PlayerState, type WonderGood } from './types.js'

const HOUR = 3600
const DAY = 86400

/** Every priest is worth two happiness, with no ceiling. */
export const HAPPINESS_PER_PRIEST = 2

/**
 * One priest converts four other islanders, himself included in the five --
 * the legacy says so in its own words (`information42_2`): "Every priest who
 * passes on the turbulent Gods' newest stories convinces five other island
 * inhabitants."
 */
export const CITIZENS_PER_PRIEST = 5

/**
 * Priests a temple of this level houses. 0 for no temple.
 *
 * A table, not a curve: the published figures do not follow one. They start at
 * 12 and step by 10, then 15, then 17 -- an increment that itself grows -- so
 * the geometric fit this used to carry was right at level 1 and level 38 and
 * wrong everywhere between (22 read as 14, 195 as 33).
 */
export function priestsByLevel(level: number): number {
  if (level <= 0) return 0
  const table = TEMPLE.priests
  return table[Math.min(level, table.length - 1)] ?? 0
}

/**
 * How much of a town believes, 0..1.
 *
 * Measured against the town's *maximum* population rather than its current
 * one, so faith does not jump every time a citizen is recruited away. That is
 * Ikariam's own denominator.
 */
export function townFaith(priests: number, maxPeoples: number): number {
  if (maxPeoples <= 0) return 0
  return Math.min(1, (priests * CITIZENS_PER_PRIEST) / maxPeoples)
}

/**
 * Which miracle level an island's faith unlocks: 20% for the first, then
 * 40/60/80, and the fifth at total belief.
 *
 * 100% is reachable rather than aspirational -- the denominator is what the
 * island's town halls can hold and a priest converts five, so an island whose
 * temples house a fifth of its capacity believes entirely.
 */
const FAITH_THRESHOLDS = [0.2, 0.4, 0.6, 0.8, 1]

export function miracleLevelForFaith(faith: number): number {
  let level = 0
  for (const threshold of FAITH_THRESHOLDS) {
    if (faith + 1e-9 >= threshold) level += 1
  }
  return level
}

/**
 * What the priests can actually call: the smaller of what the island believes
 * and what the monument has been built to carry.
 *
 * Both halves matter, and the legacy says so (`information43_3`): faith alone
 * with a level-1 monument has nowhere to put the offering, and a monument
 * raised to 5 on an island nobody believes on is a building.
 */
export function effectiveMiracleLevel(wonderLevel: number, faith: number): number {
  const byFaith = miracleLevelForFaith(faith)
  const byWonder = Math.min(WONDER_MAX_LEVEL, Math.max(0, Math.floor(wonderLevel)))
  return Math.min(byFaith, byWonder)
}

export type { WonderGood }

/** Every luxury, in the order the screens list them. */
const LUXURIES: WonderGood[] = ['wine', 'marble', 'crystal', 'sulfur']

/** `islands.trade_resource` -> the luxury that island produces. */
const LUXURY_BY_TRADE_RESOURCE: Record<number, WonderGood> = {
  1: 'wine',
  2: 'marble',
  3: 'crystal',
  4: 'sulfur',
}

export const WONDER_MAX_LEVEL = TEMPLE.wonder.max_level

/**
 * What each of the three goods costs to take the monument from `level` to the
 * next one. `null` at the top.
 */
export function wonderUpgradeCost(level: number): number | null {
  if (level >= WONDER_MAX_LEVEL) return null
  return TEMPLE.wonder.cost_per_good[Math.max(0, Math.floor(level))] ?? null
}

/**
 * The three luxuries an island's monument accepts: everything but the one it
 * digs up itself, which is the legacy's own rule (`information43_2`) --
 * "luxury goods are needed, in particular those that are not readily available
 * on the island."
 *
 * `trade_resource` is 1..4 for every island in the seed, so the fallback is
 * unreachable; it returns three goods anyway rather than throwing, because a
 * pure function called from a render path must not be able to blank a screen.
 */
export function wonderGoods(tradeResource: number): WonderGood[] {
  const own = LUXURY_BY_TRADE_RESOURCE[tradeResource]
  if (!own) return LUXURIES.slice(0, 3)
  return LUXURIES.filter((g) => g !== own)
}

/**
 * Concentrating on one god shortens the wait, which is the reward the legacy
 * describes for not spreading yourself over eight of them (`information44_6`):
 * "If you concentrate on a single God, you will 'only' receive a reduced next
 * miracle waiting time."
 *
 * Each further temple standing on an island with the same wonder takes a tenth
 * off that wonder's cooldown, down to half.
 */
export const COOLDOWN_REDUCTION_PER_TEMPLE = 0.1
export const COOLDOWN_FLOOR = 0.5

/** Temples this player has on islands whose wonder is `wonder`. */
export function templesForWonder(state: PlayerState, wonder: number): number {
  let count = 0
  for (const town of state.towns) {
    if (state.islands[town.islandId]?.wonder !== wonder) continue
    const hasTemple = Object.values(town.buildings.bySlot).some(
      (b) => b.type === BUILDING.TEMPLE && b.level > 0,
    )
    if (hasTemple) count += 1
  }
  return count
}

export function cooldownFor(spec: MiracleSpec, temples: number): number {
  const scale = Math.max(COOLDOWN_FLOOR, 1 - COOLDOWN_REDUCTION_PER_TEMPLE * (temples - 1))
  return Math.round(spec.cooldown * scale)
}

export type MiracleEffect = 'population' | 'loading' | 'travel' | 'storage' | 'combat'

export interface MiracleSpec {
  /** Wonder id, 1..8, matching `islands.wonder` and the `wonder_N` strings. */
  wonder: number
  /** Its effect exists only in a fight, which this port does not have yet. */
  combat: boolean
  kind: MiracleEffect
  /** Effect magnitude per level 1..5. A rate for `population`, a fraction for
   *  the rest. */
  perLevel: [number, number, number, number, number]
  /**
   * The second half of the two miracles that have one: Hephaistos' armour
   * (flat) and the Colossus' added rout time (seconds). Nothing reads them
   * yet -- both are combat -- but the screens print them.
   */
  secondary?: [number, number, number, number, number]
  /** Seconds the effect lasts. */
  duration: number
  /** Seconds before it can be called again, before any single-god discount. */
  cooldown: number
}

/**
 * The eight wonders, at live Ikariam's current values.
 */
export const MIRACLES: Record<number, MiracleSpec> = {
  // Hephaistos' Forge: +damage, and armour on top of it.
  1: {
    wonder: 1,
    combat: true,
    kind: 'combat',
    perLevel: [0.075, 0.075, 0.1, 0.125, 0.15],
    secondary: [0, 10, 10, 20, 20],
    duration: 8 * HOUR,
    cooldown: 2 * DAY + 8 * HOUR,
  },
  // Hades' Holy Grove: part of the cost of units lost defending comes back as
  // marble.
  2: {
    wonder: 2,
    combat: true,
    kind: 'combat',
    perLevel: [0.2, 0.3, 0.4, 0.5, 0.8],
    duration: 5 * HOUR + 20 * 60,
    cooldown: DAY + 8 * HOUR,
  },
  // Demeter's Gardens: citizens per hour, in every town of the empire.
  3: {
    wonder: 3,
    combat: false,
    kind: 'population',
    perLevel: [6, 12, 18, 24, 36],
    duration: 12 * HOUR,
    cooldown: 3 * DAY,
  },
  // Temple of Athene: more of the warehouse is safe from plunder.
  4: {
    wonder: 4,
    combat: false,
    kind: 'storage',
    perLevel: [0.4, 0.8, 1.6, 2.4, 4],
    duration: 8 * HOUR,
    cooldown: 2 * DAY + 8 * HOUR,
  },
  // Temple of Hermes: goods cross the quay faster.
  5: {
    wonder: 5,
    combat: false,
    kind: 'loading',
    perLevel: [0.4, 0.8, 1.2, 1.6, 2],
    duration: HOUR + 20 * 60,
    cooldown: 8 * HOUR,
  },
  // Ares' Stronghold: morale for every army in your towns -- and the enemy's.
  6: {
    wonder: 6,
    combat: true,
    kind: 'combat',
    perLevel: [100, 200, 400, 600, 2000],
    duration: 4 * HOUR,
    cooldown: DAY,
  },
  // Temple of Poseidon: ships sail faster.
  7: {
    wonder: 7,
    combat: false,
    kind: 'travel',
    perLevel: [0.1, 0.3, 0.5, 0.7, 1],
    duration: HOUR + 20 * 60,
    cooldown: 8 * HOUR,
  },
  // The Colossus: drives besiegers away, and keeps them away longer. Instant,
  // so no duration.
  8: {
    wonder: 8,
    combat: true,
    kind: 'combat',
    perLevel: [0.1, 0.2, 0.3, 0.5, 1],
    secondary: [10 * 60, 20 * 60, 30 * 60, 40 * 60, 60 * 60],
    duration: 0,
    cooldown: DAY,
  },
}

export function miracleSpec(wonder: number): MiracleSpec | undefined {
  return MIRACLES[wonder]
}

export interface MiracleWindow {
  /** Seconds until the effect ends; 0 when it is not running. */
  activeFor: number
  /** Seconds until it may be called again; 0 when it is ready. */
  cooldownFor: number
}

export function miracleWindow(
  spec: MiracleSpec,
  activatedAt: number,
  now: number,
  temples = 1,
): MiracleWindow {
  return {
    activeFor: Math.max(0, activatedAt + spec.duration - now),
    cooldownFor: Math.max(0, activatedAt + cooldownFor(spec, temples) - now),
  }
}

/**
 * The strongest running miracle of this kind, as a plain number.
 *
 * Effects do **not** stack: a player with temples on two islands whose wonders
 * happen to match gets the better of the two, not their sum. Anything else
 * would make a second island worth more than the first for no reason anybody
 * chose.
 */
export function miracleBonus(state: PlayerState, kind: MiracleEffect, now: number): number {
  let best = 0
  for (const active of state.user.miracles ?? []) {
    const spec = MIRACLES[active.wonder]
    if (!spec || spec.kind !== kind || spec.combat) continue
    if (now >= active.activatedAt + spec.duration) continue
    const level = Math.min(5, Math.max(1, active.level))
    const value = spec.perLevel[level - 1] ?? 0
    if (value > best) best = value
  }
  return best
}

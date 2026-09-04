/**
 * Tunables and legacy-compatibility switches.
 *
 * The port reproduces the 2012 behaviour exactly by default so the golden
 * fixtures in fixtures/ pass. Where that behaviour is a defect rather than a
 * design choice, it lives behind a named flag here: flip one and the tests
 * that encode it will fail loudly, which is the point -- you find out exactly
 * what the balance change touches.
 */

export interface GameConfig {
  /** Base warehouse capacity per resource, before warehouse buildings. */
  standardCapacity: number
  /** Cargo carried per transport ship. */
  transportCapacity: number
  townQueueSize: number
  armyQueueSize: number
  notesDefault: number
  notesPremium: number
  /** Seconds between trade-route runs. */
  tradeRouteInterval: number
  quirks: LegacyQuirks
}

/**
 * Each flag is ON by default, meaning "behave exactly like the 2012 PHP".
 */
export interface LegacyQuirks {
  /**
   * Army gold upkeep is charged twice per tick.
   *
   * Load_Player already subtracts unit upkeep when it computes `saldo`
   * (player_model.php:99-118), and then Update_Towns subtracts the same
   * upkeep again (update_model.php:417-424). With 50 phalanx + 20 spearmen
   * the town earns -40 gold/h instead of +300.
   */
  doubleArmyUpkeep: boolean

  /**
   * Gold income is computed from the population *before* it is clamped to the
   * town-hall cap. Load_Player derives `saldo` from the stored `peoples`, and
   * only afterwards does Update_Towns clamp `peoples` down to max_peoples --
   * so a town over its cap is paid for citizens it does not have.
   */
  saldoUsesUnclampedPopulation: boolean

  /**
   * Cargo ships past the 160th are free. transport_cost_by_count()
   * (data_model.php:1639) returns 0 for any count >= 160 because the price
   * ladder simply ends there, and nothing caps `users.transports`.
   */
  freeTransportsPast160: boolean

  /**
   * Tavern wine consumption *decreases* above level 40:
   * `818 + ((40 - level) * 60)` has its operands the wrong way round
   * (data_model.php:1602), so it goes negative around level 54.
   * Unreachable in practice -- the tavern's cost table stops at level 39 --
   * but reproduced so the curve is identical everywhere it is defined.
   */
  invertedTavernWineAbove40: boolean

  /**
   * The five bonus workshops all report the *wood* production rate as their
   * base figure. views/view/{forester,stonemason,glassblowing,winegrower,
   * alchemist}.php:5 each read `resource_production`, but four of the five
   * boost a trade good -- so the stonemason shows the town's wood output and
   * labels it marble.
   *
   * Display-only: the tick uses the right rate. Turning this off makes the
   * four trade-good workshops report `tradegood_production` instead, which is
   * what they were plainly meant to show.
   */
  workshopsShowWoodProduction: boolean
}

/**
 * Places the port knowingly does NOT match the legacy, and why.
 *
 * These are not flags: reproducing them would mean reintroducing a data race
 * or a duplicate charge, and each one falls out of a structural decision the
 * rewrite made on purpose. Listed here so a future reader comparing the two
 * implementations does not "fix" them back.
 *
 * 1. Update_Missions ran twice per request (update_model.php:37). Most of the
 *    mission block wrote through db->set without updating the in-memory row,
 *    so the second pass was how deferred state landed -- and it re-ran the buy
 *    and sell blocks, debiting the fleet's purse and removing its cargo twice.
 *    The port mutates state directly and runs the pass once, so the double
 *    charge is gone.
 *
 * 2. Writes to a town the acting player does not own were absolute UPDATEs
 *    computed from a value the legacy never refreshed (update_model.php:711,
 *    :638, :884). Two fleets settling against the same town in one tick
 *    therefore lost-updated: the second write overwrote the first and one
 *    delivery vanished. The port accumulates, so both land.
 *
 * 3. doResearch() with a node id outside a branch sent a nonexistent column to
 *    MySQL. The port rejects the request instead of relying on a query error
 *    to roll back the point deduction.
 *
 * 4. Load_Player never reset its town map, so a process handling several
 *    players in sequence inflated the colony count that drives corruption.
 *    Harmless per-request in the legacy; the port has no such state.
 *
 * 5. building_cost() has no `case 26`, so a temple in the legacy costs nothing
 *    and reports max_level 0 -- free, instant, and unupgradable. The port
 *    gives it live Ikariam's table (@izariam/gamedata TEMPLE), which is the
 *    one place the golden fixture is knowingly not reproduced:
 *    costs.golden.test.ts skips building 26 for this reason.
 */
export const DELIBERATE_DIVERGENCES = [
  'single Update_Missions pass',
  'accumulating cross-town writes instead of lost updates',
  'explicit rejection for out-of-range research nodes',
  'no cross-player state carried between ticks',
  'the temple has a cost table the legacy never wrote',
] as const

export const LEGACY_QUIRKS: LegacyQuirks = {
  doubleArmyUpkeep: true,
  saldoUsesUnclampedPopulation: true,
  freeTransportsPast160: true,
  invertedTavernWineAbove40: true,
  workshopsShowWoodProduction: true,
}

/** Values the legacy kept in izariam/config/izariam.php:62-68. */
export const DEFAULT_CONFIG: GameConfig = {
  standardCapacity: 1500,
  transportCapacity: 500,
  townQueueSize: 3,
  armyQueueSize: 3,
  notesDefault: 200,
  notesPremium: 8192,
  tradeRouteInterval: 604800,
  quirks: LEGACY_QUIRKS,
}

/** Warehouse capacity added per warehouse level (player_model.php:57). */
export const WAREHOUSE_CAPACITY_PER_LEVEL = 8000

/** Garrison limit base and per-level bonus (player_model.php). */
export const GARRISON_BASE = 250
export const GARRISON_PER_LEVEL = 50

/** Gold produced per unassigned citizen per hour. */
export const GOLD_PER_CITIZEN = 3
/** Gold consumed per scientist per hour; halved by research 3_13. */
export const GOLD_PER_SCIENTIST = 6
export const GOLD_PER_SCIENTIST_WITH_RESEARCH = 3

/** Population grows by (happiness / 50) citizens per hour. */
export const POPULATION_GROWTH_DIVISOR = 50

/** Workers beyond the island node's capacity still produce, at this rate. */
export const OVERFLOW_WORKER_RATE = 0.25

/** Refining buildings add this much per level to their resource. */
export const REFINERY_BONUS_PER_LEVEL = 0.02
/** Forester's house adds this much per level to wood. */
export const FORESTER_BONUS_PER_LEVEL = 0.02

/** Premium boosts multiply production / capacity by these factors. */
export const PREMIUM_PRODUCTION_MULTIPLIER = 1.2
export const PREMIUM_CAPACITY_MULTIPLIER = 2

export const SECONDS_PER_HOUR = 3600

/**
 * Golden test for tickPlayer(): running the port over each scenario's `before`
 * state must land on exactly the rows the legacy PHP wrote as `after`.
 *
 * 27 scenarios cover resource production, population growth and clamping,
 * gold, the storage cap, research accrual, both construction-queue cursors,
 * land and naval unit queues, spy training, corruption, the premium
 * multipliers, and army upkeep.
 */

import { describe, expect, it } from 'vitest'

import { tickPlayer } from '../src/tick.js'
import { TICK_FIXTURES, stateFromFixture, type FixtureSnapshot } from './fixture.js'

const EPS = 1e-4

function close(got: number, want: number | undefined, label: string) {
  expect(want, `${label}: fixture has no value`).toBeDefined()
  const w = want as number
  expect(
    Math.abs(got - w) <= EPS,
    `${label}: got ${got}, expected ${w} (delta ${Math.abs(got - w)})`,
  ).toBe(true)
}

/** Legacy writes 0 for "unset"; the port uses null. */
function tsEq(got: number | null, want: number, label: string) {
  const normalised = got ?? 0
  expect(normalised, label).toBe(want)
}

function buildLineOf(queue: { slot: number; type: number }[]): string {
  return queue.map((e) => `${e.slot},${e.type}`).join(';')
}

function unitLineOf(queue: { unitType: number; count: number }[]): string {
  return queue.map((e) => `${e.unitType},${e.count}`).join(';')
}

describe('tickPlayer', () => {
  for (const [name, scenario] of Object.entries(TICK_FIXTURES)) {
    it(name, () => {
      const { state, subjectTownId } = stateFromFixture(scenario.before)
      const now = scenario.now
      tickPlayer(state, now)

      const after: FixtureSnapshot = scenario.after
      const town = state.towns.find((t) => t.id === subjectTownId)!
      const exp = after.town

      close(town.resources.wood, Number(exp.wood), `${name}.wood`)
      close(town.resources.wine, Number(exp.wine), `${name}.wine`)
      close(town.resources.marble, Number(exp.marble), `${name}.marble`)
      close(town.resources.crystal, Number(exp.crystal), `${name}.crystal`)
      close(town.resources.sulfur, Number(exp.sulfur), `${name}.sulfur`)
      close(town.peoples, Number(exp.peoples), `${name}.peoples`)
      close(town.spies, Number(exp.spyes), `${name}.spyes`)
      close(town.actionPoints, Number(exp.actions), `${name}.actions`)
      close(town.tavernWine, Number(exp.tavern_wine), `${name}.tavern_wine`)

      // Building slots.
      for (let slot = 0; slot <= 14; slot++) {
        const b = town.buildings.bySlot[slot] ?? { type: 0, level: 0 }
        close(b.level, Number(exp[`pos${slot}_level`]), `${name}.pos${slot}_level`)
        close(b.type, Number(exp[`pos${slot}_type`]), `${name}.pos${slot}_type`)
      }

      expect(buildLineOf(town.buildQueue), `${name}.build_line`).toBe(String(exp.build_line ?? ''))
      tsEq(town.buildStartedAt, Number(exp.build_start), `${name}.build_start`)

      // Garrison and production queues.
      expect(unitLineOf(town.landQueue), `${name}.army_line`).toBe(String(after.army.army_line ?? ''))
      expect(unitLineOf(town.navalQueue), `${name}.ships_line`).toBe(
        String(after.army.ships_line ?? ''),
      )
      for (const [cls, count] of Object.entries(after.army)) {
        if (cls.endsWith('_line') || cls.endsWith('_start')) continue
        const unitId = UNIT_ID_BY_CLASS[cls]
        if (unitId === undefined) continue
        close(town.army[unitId] ?? 0, Number(count), `${name}.army.${cls}`)
      }

      // Player-level state.
      close(state.user.gold, Number(after.user.gold), `${name}.gold`)
      close(state.user.research.points, Number(after.research_points), `${name}.research_points`)

      // The legacy points_* columns are float(11,0) -- zero decimal places --
      // so MySQL rounds on write: a 1.6 score reads back as 2. The new schema
      // stores them as numeric and keeps the full value, so the comparison
      // rounds ours the way the old column did rather than degrading the port.
      const score = (facet: string) => Math.round(Number(state.user.scores[facet] ?? 0))
      expect(score('peoples'), `${name}.points_peoples`).toBe(Number(after.user.points_peoples))
      expect(score('buildings'), `${name}.points_buildings`).toBe(
        Number(after.user.points_buildings),
      )
      expect(score('levels'), `${name}.points_levels`).toBe(Number(after.user.points_levels))
      expect(score('army'), `${name}.points_army`).toBe(Number(after.user.points_army))
      expect(score('gold'), `${name}.points_gold`).toBe(Number(after.user.points_gold))
      expect(score('total'), `${name}.points`).toBe(Number(after.user.points))

      // Island node upgrade bookkeeping.
      const island = state.islands[town.islandId]!
      close(island.woodLevel, Number(after.island.wood_level), `${name}.island.wood_level`)
      close(island.tradeLevel, Number(after.island.trade_level), `${name}.island.trade_level`)
      tsEq(island.woodUpgradeStartedAt, Number(after.island.wood_start), `${name}.island.wood_start`)
      tsEq(
        island.tradeUpgradeStartedAt,
        Number(after.island.trade_start),
        `${name}.island.trade_start`,
      )
    })
  }
})

/** class name -> unit id, mirroring the fixture adapter. */
import { MAPS } from '@izariam/gamedata'
const UNIT_ID_BY_CLASS: Record<string, number> = {}
for (const [id, cls] of Object.entries(MAPS.army_class_by_type ?? {})) {
  if (typeof cls === 'string' && cls !== '') UNIT_ID_BY_CLASS[cls] = Number(id)
}

/**
 * Golden test for derive(): every value Load_Player computed for the subject
 * town must come back identical.
 *
 * The fixture records these directly (dump.php probes a freshly hydrated
 * Player_Model before the tick runs), so this validates the derivation in
 * isolation rather than inferring it from tick deltas.
 */

import { describe, expect, it } from 'vitest'

import { derive } from '../src/derive.js'
import { TICK_FIXTURES, nowOf, stateFromFixture } from './fixture.js'

const EPS = 1e-4

function close(got: number, want: number | undefined, label: string) {
  expect(want, `${label}: fixture has no value`).toBeDefined()
  const w = want as number
  expect(
    Math.abs(got - w) <= EPS,
    `${label}: got ${got}, expected ${w} (delta ${Math.abs(got - w)})`,
  ).toBe(true)
}

describe('derive', () => {
  for (const [name, scenario] of Object.entries(TICK_FIXTURES)) {
    it(name, () => {
      const { state, subjectTownId } = stateFromFixture(scenario.before)
      const now = nowOf(scenario)
      const d = derive(state, now)
      const town = d.towns[subjectTownId]
      expect(town, `${name}: subject town ${subjectTownId} was not derived`).toBeDefined()
      const exp = scenario.derived

      close(town!.capacity, exp.capacity, `${name}.capacity`)
      close(town!.totalPeoples, exp.peoples, `${name}.peoples`)
      close(town!.maxPeoples, exp.max_peoples, `${name}.max_peoples`)
      close(town!.garrisonLimit, exp.garisson_limit, `${name}.garisson_limit`)
      close(town!.saldo, exp.saldo, `${name}.saldo`)
      close(town!.peoplesGold, exp.peoples_gold, `${name}.peoples_gold`)
      close(town!.armyGoldNeed, exp.army_gold_need, `${name}.army_gold_need`)
      close(town!.landUnitCount, exp.units_count, `${name}.units_count`)
      close(town!.happiness, exp.good, `${name}.good`)
      close(town!.corruption, exp.corruption, `${name}.corruption`)
      close(town!.resourceProduction, exp.resource_production, `${name}.resource_production`)
      close(
        town!.resourceProductionBonus,
        exp.resource_production_bonus,
        `${name}.resource_production_bonus`,
      )
      close(town!.tradegoodProduction, exp.tradegood_production, `${name}.tradegood_production`)
      close(
        town!.tradegoodProductionBonus,
        exp.tradegood_production_bonus,
        `${name}.tradegood_production_bonus`,
      )
      close(town!.warehouseCount, exp.warehouses, `${name}.warehouses`)

      close(d.plusResearch, exp.plus_research, `${name}.plus_research`)
      close(d.plus.wood, exp.plus_wood, `${name}.plus_wood`)
      close(d.plus.wine, exp.plus_wine, `${name}.plus_wine`)
      close(d.plus.marble, exp.plus_marble, `${name}.plus_marble`)
      close(d.plus.crystal, exp.plus_crystal, `${name}.plus_crystal`)
      close(d.plus.sulfur, exp.plus_sulfur, `${name}.plus_sulfur`)
      close(d.plusCapacity, exp.plus_capacity, `${name}.plus_capacity`)
      close(d.scientists, exp.scientists, `${name}.scientists`)
      close(d.activeTownIds.length - 1, exp.colonies, `${name}.colonies`)

      // Building levels keyed by type.
      for (const [type, level] of Object.entries(exp.levels as Record<string, number>)) {
        close(town!.levels[Number(type)] ?? 0, level, `${name}.levels[${type}]`)
      }

      // Happiness breakdown, as the advisor screens display it.
      const p = exp.plus as Record<string, number>
      close(town!.happinessBreakdown.base, p.base, `${name}.plus.base`)
      close(town!.happinessBreakdown.capital, p.capital, `${name}.plus.capital`)
      close(town!.happinessBreakdown.research, p.research, `${name}.plus.research`)
      close(town!.happinessBreakdown.tavern, p.tavern, `${name}.plus.tavern`)
      close(town!.happinessBreakdown.wine, p.wine, `${name}.plus.wine`)
      const m = exp.minus as Record<string, number>
      close(town!.happinessBreakdown.peoples, m.peoples, `${name}.minus.peoples`)
    })
  }
})

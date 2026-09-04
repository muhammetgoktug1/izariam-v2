/**
 * A queued building counts as built.
 *
 * `correct_buildings()` (player_model.php:378-393) walks the build queue on
 * every page load and stamps the ordered type onto the empty slot it will
 * occupy, marking `already_build[type]`. The construction menu then drops that
 * building from its list (buildingGround.php:20).
 *
 * The port derived `alreadyBuilt` from stored slots only, so a Trading Port on
 * its way stayed on the menu -- and ordering it again queued a *second* one at
 * level 1 rather than sending the player to the upgrade panel. Nothing in
 * `build()` stops that: the rule reads stored slot types, faithfully to
 * actions.php:403-411, so the whole defence was presentational in the legacy
 * too.
 */

import { describe, expect, it } from 'vitest'

import { derive } from '../src/derive.js'
import { TICK_FIXTURES, nowOf, stateFromFixture } from './fixture.js'

const PORT = 2

function subject() {
  const scenario = Object.values(TICK_FIXTURES)[0]!
  const { state, subjectTownId } = stateFromFixture(scenario.before)
  const town = state.towns.find((t) => t.id === subjectTownId)!
  return { state, town, now: nowOf(scenario) }
}

describe('alreadyBuilt', () => {
  it('does not claim a building the town neither has nor ordered', () => {
    const { state, town, now } = subject()
    town.buildings.bySlot = { 0: { type: 1, level: 1 } }
    town.buildQueue = []

    const d = derive(state, now).towns[town.id]!
    expect(d.alreadyBuilt[PORT]).toBe(false)
  })

  it('claims a building that stands in the town', () => {
    const { state, town, now } = subject()
    town.buildings.bySlot = { 0: { type: 1, level: 1 }, 1: { type: PORT, level: 1 } }
    town.buildQueue = []

    const d = derive(state, now).towns[town.id]!
    expect(d.alreadyBuilt[PORT]).toBe(true)
  })

  it('claims a building that is only queued', () => {
    const { state, town, now } = subject()
    town.buildings.bySlot = { 0: { type: 1, level: 1 } }
    town.buildQueue = [{ slot: 1, type: PORT }]

    const d = derive(state, now).towns[town.id]!
    expect(
      d.alreadyBuilt[PORT],
      'a queued port must not be offered by the construction menu again',
    ).toBe(true)
  })

  it('claims every type in the queue, not just the head', () => {
    const { state, town, now } = subject()
    town.buildings.bySlot = { 0: { type: 1, level: 1 } }
    town.buildQueue = [
      { slot: 1, type: PORT },
      { slot: 3, type: 3 },
    ]

    const d = derive(state, now).towns[town.id]!
    expect(d.alreadyBuilt[PORT]).toBe(true)
    expect(d.alreadyBuilt[3]).toBe(true)
  })
})

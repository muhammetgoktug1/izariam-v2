/**
 * The grant arithmetic, on its own.
 *
 * `applyGrant` is the one function the panel's "1.500 → 11.500" preview and the
 * server's write both call, so the two agree by construction rather than by
 * two implementations happening to match. Six cases, no database.
 */

import { applyGrant } from '@izariam/shared/admin'
import { describe, expect, it } from 'vitest'

describe('applyGrant', () => {
  it('adds within the ceiling', () => {
    expect(applyGrant(500, { mode: 'add', value: 300 }, 1500)).toEqual({
      value: 800,
      clamped: false,
      floored: false,
    })
  })

  it('clamps an addition to the ceiling', () => {
    // What the tick would otherwise do silently on its next pass.
    expect(applyGrant(1400, { mode: 'add', value: 5000 }, 1500)).toEqual({
      value: 1500,
      clamped: true,
      floored: false,
    })
  })

  it('clamps a set above the ceiling', () => {
    expect(applyGrant(0, { mode: 'set', value: 999_999 }, 1500)).toEqual({
      value: 1500,
      clamped: true,
      floored: false,
    })
  })

  it('writes a set within the ceiling exactly', () => {
    expect(applyGrant(1234.56, { mode: 'set', value: 900 }, 1500).value).toBe(900)
  })

  it('treats set zero as a deliberate wipe, not as "leave alone"', () => {
    expect(applyGrant(1200, { mode: 'set', value: 0 }, 1500)).toEqual({
      value: 0,
      clamped: false,
      floored: false,
    })
  })

  it('floors a subtraction at zero', () => {
    expect(applyGrant(100, { mode: 'add', value: -500 }, 1500)).toEqual({
      value: 0,
      clamped: false,
      floored: true,
    })
  })

  it('has no ceiling for the account fields', () => {
    // gold, ambrosia, research points and transports are called with the
    // default `Infinity`; only the floor applies.
    expect(applyGrant(100, { mode: 'add', value: 10_000_000 }).value).toBe(10_000_100)
    expect(applyGrant(100, { mode: 'add', value: -1000 })).toEqual({
      value: 0,
      clamped: false,
      floored: true,
    })
  })
})

/**
 * The two time formatters from izariam/helpers/izariam_helper.php.
 *
 * Both stop after two non-zero units -- `$times_count < 2` -- so 1 day 2 hours
 * 3 minutes prints as "1d 2h " and the minutes are dropped. That truncation is
 * why a build showing "2h 5m" can sit at "2h 5m" for a minute: the seconds it
 * is actually counting down are never rendered.
 *
 * Both also emit a trailing space after every unit, `format_time` even after
 * the last one. Reproduced: several screens put the result straight next to
 * another word and the gap is load-bearing.
 */

import { t } from './i18n.js'

interface Unit {
  seconds: number
  short: string
  one: string
  many: string
}

const UNITS: Unit[] = [
  { seconds: 86400, short: 'd_mini', one: 'day', many: 'days' },
  { seconds: 3600, short: 'h_mini', one: 'hour', many: 'hours' },
  { seconds: 60, short: 'm_mini', one: 'minute', many: 'minutes' },
  { seconds: 1, short: 's_mini', one: 'second', many: 'seconds' },
]

function split(seconds: number): number[] {
  let rest = Math.max(0, seconds)
  return UNITS.map((u) => {
    const n = Math.floor(rest / u.seconds)
    rest -= n * u.seconds
    return n
  })
}

/** `format_time()`: "2d 4h ", at most two units, abbreviated. */
export function formatTime(seconds: number): string {
  const parts = split(seconds)
  let out = ''
  let count = 0
  for (let i = 0; i < UNITS.length; i++) {
    const n = parts[i]!
    if (n > 0 && count < 2) {
      count++
      out += `${n}${t(UNITS[i]!.short)} `
    }
  }
  return out
}

/** `format_time_large()`: "2 days4 hours", at most two units, spelled out.
 *  Note the missing separator between units -- the legacy concatenates them
 *  with no space, unlike format_time above. */
export function formatTimeLarge(seconds: number): string {
  const parts = split(seconds)
  let out = ''
  let count = 0
  for (let i = 0; i < UNITS.length; i++) {
    const n = parts[i]!
    if (n > 0 && count < 2) {
      count++
      const unit = UNITS[i]!
      out += `${n} ${t(n <= 1 ? unit.one : unit.many)}`
    }
  }
  return out
}

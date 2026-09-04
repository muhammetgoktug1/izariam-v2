/**
 * A countdown to a server-supplied instant.
 *
 * Replaces the legacy getCountdown() helper (design/js/complete-0.4.5.js:81).
 * Same model -- an absolute unix timestamp rendered client-side -- with two
 * changes: when the legacy timer hit zero it reloaded the whole page
 * (views/view/city.php:38), here it just fires `onFinish`; and the remaining
 * time is measured against the server clock rather than the browser's.
 *
 * `onFinish` is held in a ref on purpose. Callers pass inline arrows, so
 * putting it in the effect's dependency array tears the interval down and
 * rebuilds it on every render -- and any parent re-rendering faster than once
 * a second would stop the clock entirely.
 */

import { useEffect, useRef, useState } from 'react'

interface Props {
  /** Epoch seconds. */
  endsAt: number
  /** Server clock minus client clock, seconds. */
  clockOffset?: number
  onFinish?: () => void
}

function format(seconds: number): string {
  if (seconds <= 0) return '00:00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

export function Countdown({ endsAt, clockOffset = 0, onFinish }: Props) {
  const finish = useRef(onFinish)
  finish.current = onFinish

  const [remaining, setRemaining] = useState(() => endsAt - (Date.now() / 1000 + clockOffset))

  useEffect(() => {
    const left = () => endsAt - (Date.now() / 1000 + clockOffset)
    setRemaining(left())
    const timer = window.setInterval(() => {
      const value = left()
      setRemaining(value)
      if (value <= 0) {
        window.clearInterval(timer)
        finish.current?.()
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [endsAt, clockOffset])

  return <>{format(remaining)}</>
}

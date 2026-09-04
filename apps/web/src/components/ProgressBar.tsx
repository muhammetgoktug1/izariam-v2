/**
 * The legacy `getProgressBar()` (design/js/complete-0.4.5.js), which this
 * client had no equivalent of at all.
 *
 * Markup contract: `div.progressBar > div.bar` with an inline width percentage
 * and the percentage repeated in `title`, plus whatever the caller puts beside
 * the bar (every use site puts a cancel link there).
 *
 * The wrapper class is a prop because the legacy is inconsistent about it: the
 * building screens write `progressBar` and the two construction sideboxes
 * write `progressbar` (sidebox/city.php:51, sidebox/barracks.php:31), and the
 * stylesheet follows suit -- `#unitConstructionList .currentUnit .progressbar`
 * is lowercase (ik_common_0.0.1.css:1537). A bar with the wrong casing gets no
 * rule at all and renders as a full-width white block.
 *
 * The percentage is the legacy's arithmetic verbatim, including its rounding:
 *
 *   percent = intval(100 - floor(remaining / (total / 100)))
 *
 * which reaches 100 a fraction of a second before the work actually completes,
 * and can read 101 if the client clock runs ahead of the server's -- hence the
 * clamp on the *rendered* width only, leaving the number itself untouched.
 */

import { useEffect, useRef, useState } from 'react'

interface Props {
  /** Epoch seconds. */
  startsAt: number
  endsAt: number
  /** Server clock minus client clock, seconds. */
  clockOffset?: number
  id?: string
  /** `progressbar` inside the construction sideboxes, `progressBar` elsewhere. */
  className?: string
  children?: React.ReactNode
}

function percentAt(startsAt: number, endsAt: number, now: number): number {
  const total = endsAt - startsAt
  if (total <= 0) return 100
  const remaining = endsAt - now
  return Math.trunc(100 - Math.floor(remaining / (total / 100)))
}

export function ProgressBar({
  startsAt,
  endsAt,
  clockOffset = 0,
  id,
  className = 'progressBar',
  children,
}: Props) {
  const [percent, setPercent] = useState(() =>
    percentAt(startsAt, endsAt, Date.now() / 1000 + clockOffset),
  )

  // Same reason Countdown holds its callback in a ref: the interval must
  // survive a parent re-rendering faster than once a second.
  const bounds = useRef({ startsAt, endsAt, clockOffset })
  bounds.current = { startsAt, endsAt, clockOffset }

  useEffect(() => {
    const tick = () => {
      const b = bounds.current
      setPercent(percentAt(b.startsAt, b.endsAt, Date.now() / 1000 + b.clockOffset))
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [startsAt, endsAt])

  const width = Math.min(100, Math.max(0, percent))
  return (
    <div className={className}>
      <div className="bar" id={id} title={`${percent}%`} style={{ width: `${width}%` }} />
      {children}
    </div>
  )
}

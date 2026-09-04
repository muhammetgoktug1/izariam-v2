/**
 * Ambrosia for build time: "shorten" and "finish now".
 *
 * The only screen element in the port with no legacy counterpart -- the feature
 * is taken from live Ikariam (see packages/rules/src/hurry.ts). It reuses the
 * premium shop's markup vocabulary (`.centerButton`, `.button`, `.notenough`,
 * `.buyNow`, the ambrosia icon) so it needs no CSS of its own.
 *
 * Where it may be mounted is decided by the skin, not by taste: both boxes it
 * sits under are fixed-height with absolutely positioned children --
 * `#upgradeInProgress{height:95px}` (ik_common_0.4.5.css:1384) and
 * `#unitConstructionList .currentUnit{height:52px}` (:2402) -- so this renders
 * *after* them, never inside.
 *
 * The price is recomputed once a second because it falls with the clock. It can
 * therefore be a beat stale, and that is the safe direction: the remaining time
 * only shrinks, so the server's charge is never more than what was on screen.
 */

import { hurryCost, type HurryMode } from '@izariam/rules'
import { useEffect, useState } from 'react'

import { t, tf } from '../../lib/i18n.js'
import { hashFor } from '../../lib/routes.js'

interface Props {
  townId: number
  /** Board slot of the construction being hurried -- the queue head's. */
  slot: number
  endsAt: number
  ambrosia: number
  clockOffset: number
  act: (path: string, body?: unknown) => void
  onNavigate: (hash: string) => void
  /** The construction-list sidebox: one link, no wrapper. */
  compact?: boolean
}

/** Seconds left, ticking, against the server's clock. */
function useRemaining(endsAt: number, clockOffset: number): number {
  const left = () => Math.max(0, endsAt - (Date.now() / 1000 + clockOffset))
  const [remaining, setRemaining] = useState(left)

  useEffect(() => {
    setRemaining(left())
    const timer = window.setInterval(() => setRemaining(left()), 1000)
    return () => window.clearInterval(timer)
    // `left` closes over both, and both are in the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt, clockOffset])

  return remaining
}

export function HurryButtons({
  townId,
  slot,
  endsAt,
  ambrosia,
  clockOffset,
  act,
  onNavigate,
  compact = false,
}: Props) {
  const remaining = useRemaining(endsAt, clockOffset)
  if (remaining <= 0) return null

  // `half` removes half of what is left; the server floors the same way.
  const modes: { mode: HurryMode; label: string; cost: number }[] = [
    { mode: 'half', label: t('hurry_half'), cost: hurryCost(Math.floor(remaining / 2)) },
    { mode: 'all', label: t('hurry_all'), cost: hurryCost(remaining) },
  ]
  const shown = compact ? modes.slice(1) : modes

  const purse = Math.floor(ambrosia)

  /**
   * `.button` is `display:block` with padding (ik_common_0.4.5.css:1073,1286).
   * In the 200px sidebox that turns a two-word link into a full-width slab that
   * pushes the queued rows down and wraps the icon onto its own line, so the
   * compact form drops the class and stays an ordinary inline link.
   */
  const link = compact
    ? { style: { fontWeight: 'bold' as const, fontSize: 11, whiteSpace: 'nowrap' as const } }
    : { className: 'button', style: { whiteSpace: 'nowrap' as const } }

  const price = (cost: number) =>
    cost === 0 ? (
      <> · {t('hurry_free')}</>
    ) : (
      <>
        {' '}
        · {cost}{' '}
        {/* Two things the skin decides for us: the sprite is 16x22, taller than
            wide (the premium table squashes it to 24x20; a scaled-down copy of
            that distortion just looks broken), and images inside the sideboxes
            are `display:block`, which drops the icon onto a line of its own. */}
        <img
          src="/skin/premium/ambrosia_icon.gif"
          width={10}
          height={14}
          alt={t('ambrosy')}
          style={{ display: 'inline-block', verticalAlign: 'text-bottom' }}
        />
      </>
    )

  const buttons = shown.map(({ mode, label, cost }) =>
    cost > purse ? (
      /* Short of ambrosia the premium screen turns the button into a link to
         the payment page (premium.php:27); the same here rather than a dead
         disabled button. */
      <a
        key={mode}
        className="notenough"
        /* `.notenough` is an inline run of text with no margin of its own, so
           two of them side by side read as one sentence. */
        style={{ display: 'inline-block', margin: '0 10px', fontSize: 11 }}
        href={hashFor('premiumPayment')}
        title={label}
        onClick={(e) => {
          e.preventDefault()
          onNavigate(hashFor('premiumPayment'))
        }}
      >
        {label} — {tf('premium_missing', cost - purse)}{' '}
        <span className="buyNow">{t('acquire_now')}</span>
      </a>
    ) : (
      <a
        key={mode}
        {...link}
        href="#hurry"
        title={label}
        onClick={(e) => {
          e.preventDefault()
          act('hurryConstruction', { townId, slot, mode })
        }}
      >
        {label}
        {price(cost)}
      </a>
    ),
  )

  /* No label of its own: `.textLabel` is hidden off-canvas inside several
     containers (ik_common_0.4.5.css:209,236), so a caption there would silently
     vanish in the sidebox. Each link carries its own price. */
  if (compact) {
    return (
      <div style={{ textAlign: 'center', margin: '2px 0 6px' }}>{buttons}</div>
    )
  }

  return (
    <div className="centerButton" id="hurryConstruction">
      {buttons}
    </div>
  )
}

/**
 * The fixed top bar, reproducing izariam/views/game_index.php:666-715.
 *
 * Sits outside #container (design/skin/ik_common_0.4.5.css:69-79 pins it to
 * the viewport top at 24px tall). Every item is `li.{name} > a >
 * span.textLabel`, with the sprite on the anchor and the label parked
 * off-screen.
 *
 * The clock is driven from the server's timestamp plus the local delta rather
 * than raw browser time -- game_index.php:830 leaves that correction commented
 * out, so the legacy clock silently shows the player's own timezone.
 */

import { useEffect, useState } from 'react'

import { t } from '../../lib/i18n.js'
import { LanguageSwitch } from './LanguageSwitch.js'

interface Props {
  ambrosia: number
  version: string
  /** Server clock minus client clock, seconds. */
  clockOffset: number
  onNavigate: (page: string) => void
  onToggleNotes: () => void
  onLogout: () => void
}

function formatClock(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

export function GfToolbar({
  ambrosia,
  version,
  clockOffset,
  onNavigate,
  onToggleNotes,
  onLogout,
}: Props) {
  const [clock, setClock] = useState(() => Date.now() / 1000 + clockOffset)

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now() / 1000 + clockOffset), 500)
    return () => window.clearInterval(timer)
  }, [clockOffset])

  const go = (page: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    onNavigate(page)
  }

  return (
    <div id="GF_toolbar">
      <h3>{t('toolbar')}</h3>
      <ul>
        <li className="help">
          <a href="#/pedia" onClick={go('pedia')}>
            <span className="textLabel">{t('help')}</span>
          </a>
        </li>
        <li className="premium">
          <a href="#/premium" onClick={go('premium')}>
            <span className="textLabel">{t('izariam_plus')} ({Math.floor(ambrosia)})</span>
          </a>
        </li>
        <li className="highscore">
          <a href="#/highscore" onClick={go('highscore')}>
            <span className="textLabel">{t('top_list')}</span>
          </a>
        </li>
        <li className="options">
          <a href="#/options" onClick={go('options')}>
            <span className="textLabel">{t('options')}</span>
          </a>
        </li>
        <li className="notes">
          <a
            href="#notes"
            onClick={(e) => {
              e.preventDefault()
              onToggleNotes()
            }}
          >
            <span className="textLabel">{t('notes')}</span>
          </a>
        </li>
        <li className="forum">
          <a href="#/board" onClick={go('board')}>
            <span className="textLabel">{t('board')}</span>
          </a>
        </li>
        <li className="language">
          <LanguageSwitch />
        </li>
        <li className="logout">
          <a
            href="#logout"
            onClick={(e) => {
              e.preventDefault()
              onLogout()
            }}
          >
            <span className="textLabel">{t('logout_name')}</span>
          </a>
        </li>
        <li className="version">
          <a href="#/version" onClick={go('version')}>
            <span className="textLabel">v.{version}</span>
          </a>
        </li>
        <li className="serverTime">
          <a>
            <span className="textLabel" id="servertime">
              {formatClock(clock)}
            </span>
          </a>
        </li>
      </ul>
    </div>
  )
}

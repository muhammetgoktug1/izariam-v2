/**
 * The friends rail on the right edge, reproducing
 * izariam/views/game_index.php:630-643.
 *
 * Twelve fixed slots, six visible at a time; the legacy paginates by adding
 * `slot0`..`slot5` to whichever six are showing and re-appending them
 * (design/js/complete-0.4.5.js:705-718).
 *
 * The legacy's hover-expand animation binds to `li.friend`, which this page
 * never emits -- it only ever renders `li.slot` -- so that behaviour is dead
 * in the original too and is not reproduced.
 */

import { useState } from 'react'

import { t } from '../../lib/i18n.js'

const TOTAL_SLOTS = 12
const VISIBLE = 6

export function Friends() {
  const [expanded, setExpanded] = useState(false)
  const [page, setPage] = useState(0)

  const maxPage = Math.max(0, Math.ceil(TOTAL_SLOTS / VISIBLE) - 1)
  const start = page * VISIBLE
  const slots = Array.from({ length: TOTAL_SLOTS }, (_, i) => i + 1).slice(start, start + VISIBLE)

  return (
    <div id="friends">
      <h3>{t('friends')}</h3>
      <ul className="friends">
        {slots.map((n, i) => (
          <li key={n} className={`slot slot${i}`}>
            <div className="slotnum">{n}</div>
            <a className="image" title={t('invite_friends')} href="#/friendListEdit" />
          </li>
        ))}
      </ul>
      <div
        id="toggleShowFriends"
        className={expanded ? 'hidefriends' : 'showfriends'}
        onClick={() => setExpanded((v) => !v)}
      />
      <a
        className={page === 0 ? 'pageup pageup_deactivated' : 'pageup'}
        href="#up"
        onClick={(e) => {
          e.preventDefault()
          setPage((p) => Math.max(0, p - 1))
        }}
      >
        <span className="textLabel">{t('up')}</span>
      </a>
      <a
        className={page >= maxPage ? 'pagedown pagedown_deactivated' : 'pagedown'}
        href="#down"
        onClick={(e) => {
          e.preventDefault()
          setPage((p) => Math.min(maxPage, p + 1))
        }}
      >
        <span className="textLabel">{t('down')}</span>
      </a>
    </div>
  )
}

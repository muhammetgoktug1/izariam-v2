/**
 * The title block every building screen opens with,
 * izariam/views/view/building_description.php.
 *
 * Two states, and which one you get depends on the *queue*, not on the slot:
 * the progress view appears only when this slot is at the head of the build
 * queue. A second entry queued behind it shows the idle description, which is
 * why a player queueing two upgrades sees the first one animate and the second
 * one look untouched.
 *
 * The idle branch's `<h1>` has no inline style; the progress branch centres it
 * with one. Kept, because the skin styles neither and the difference is
 * visible.
 */

import { constructionHead, type PlayerState, type TownState } from '@izariam/rules'

import { Countdown } from '../Countdown.js'
import { formatTime } from '../../lib/format.js'
import { HurryButtons } from './HurryButtons.js'
import { t } from '../../lib/i18n.js'
import { hashFor } from '../../lib/routes.js'
import { ProgressBar } from '../ProgressBar.js'
import { buildingDesc, buildingName } from '../../lib/buildings.js'

interface Props {
  position: number
  state: PlayerState
  town: TownState
  now: number
  clockOffset: number
  onNavigate: (hash: string) => void
  /** Fired when the countdown reaches zero. The legacy reloaded the page two
   *  seconds later; here the caller refetches the graph. */
  onFinished: () => void
  /** POST an action. Only the ambrosia buttons use it, and a screen that does
   *  not pass one simply shows the progress without them. */
  act?: (path: string, body?: unknown) => void
}

export function BuildingHeader({
  position,
  state,
  town,
  now,
  clockOffset,
  onNavigate,
  onFinished,
  act,
}: Props) {
  const slot = town.buildings.bySlot[position] ?? { type: 0, level: 0 }
  const name = buildingName(slot.type)

  // Priced at the *built* level, not at real_level: an upgrade already under
  // way was costed when it was queued. `constructionHead` is the same reading
  // the server's hurry action takes, so the two never disagree about when this
  // finishes.
  const head = constructionHead(state, town)
  const building = head != null && head.slot === position

  if (!building) {
    return (
      <div className="buildingDescription">
        <h1>{name}</h1>
        <p>{buildingDesc(slot.type)}</p>
      </div>
    )
  }

  const endsAt = head.endsAt

  return (
    <div className="buildingDescription">
      <h1 style={{ textAlign: 'center' }}>{name}</h1>
      <div id="upgradeInProgress">
        <div className="isUpgrading">{t('is_upgrading')}</div>
        <div className="buildingLevel">
          <span className="textLabel">{t('level')} </span>
          {slot.level}
        </div>
        <div className="nextLevel">
          <span className="textLabel">{t('next_level')} </span>
          {slot.level + 1}
        </div>
        <ProgressBar
          id="upgradeProgress"
          startsAt={head.startedAt}
          endsAt={endsAt}
          clockOffset={clockOffset}
        >
          <a
            className="cancelUpgrade"
            href={hashFor('demolition', position)}
            title={t('cancel')}
            onClick={(e) => {
              e.preventDefault()
              onNavigate(hashFor('demolition', position))
            }}
          >
            <span className="textLabel">{t('cancel')}</span>
          </a>
        </ProgressBar>
        <div className="time" id="upgradeCountDown">
          {endsAt <= now ? (
            formatTime(0)
          ) : (
            <Countdown endsAt={endsAt} clockOffset={clockOffset} onFinish={onFinished} />
          )}
        </div>
      </div>
      {/* Outside #upgradeInProgress: that box is a fixed 95px
          (ik_common_0.4.5.css:1384) and anything added inside it overflows.
          .buildingDescription is height:auto (:669). */}
      {act && (
        <HurryButtons
          townId={town.id}
          slot={position}
          endsAt={endsAt}
          ambrosia={state.user.ambrosia}
          clockOffset={clockOffset}
          act={act}
          onNavigate={onNavigate}
        />
      )}
    </div>
  )
}

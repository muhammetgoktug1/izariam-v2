/**
 * The upgrade/demolish sidebox, izariam/views/sidebox/update.php.
 *
 * Rendered by 19 of the 65 screens, so it is the single highest-leverage
 * component in the port: getting it right opens every building screen at once.
 * It reaches those 19 through a missing `break` at view_model.php:127 -- see
 * lib/routes.ts.
 *
 * Three details that are easy to get wrong and all three are load-bearing:
 *
 * - `real_level` counts the entries already queued for *this building type*,
 *   not this slot, so two academies queued in different slots both inflate each
 *   other's next-level cost. The cost shown is for `real_level`, the level
 *   printed above it is the built one.
 * - The glass row's class is `glass`, not `crystal`. Only the class differs;
 *   the label and the value are the crystal cost.
 * - Zero-cost rows are not rendered at all, not rendered as zero. The town hall
 *   costs no sulfur, so it has five `<li>`s where the shipyard has six.
 *
 * `$page` in the legacy template is the page key, and slot 0 is special-cased:
 * the town hall is the only building the panel will price at position 0.
 */

import { buildingCost, levelsByType, type PlayerState, type TownState } from '@izariam/rules'

import { formatTime } from '../../lib/format.js'
import { num, t } from '../../lib/i18n.js'
import { hashFor, type Page } from '../../lib/routes.js'

interface Props {
  page: Page
  /** Board slot, 0..14. */
  position: number
  state: PlayerState
  town: TownState
  hasPremium: boolean
  onNavigate: (hash: string) => void
  onUpgrade: (position: number) => void
}

/** The five resource rows, with the class the skin actually uses. */
const ROWS = [
  { key: 'wood', cls: 'wood', label: 'wood' },
  { key: 'wine', cls: 'wine', label: 'wine' },
  { key: 'marble', cls: 'marble', label: 'marble' },
  { key: 'crystal', cls: 'glass', label: 'crystal' },
  { key: 'sulfur', cls: 'sulfur', label: 'sulfur' },
] as const

export function UpgradePanel({
  page,
  position,
  state,
  town,
  hasPremium,
  onNavigate,
  onUpgrade,
}: Props) {
  // `if ($position > 0 or ($position == 0 and $page == 'townHall'))` -- the
  // whole box is omitted otherwise, which is how buildingGround gets no panel.
  if (!(position > 0 || (position === 0 && page === 'townHall'))) return null

  const slot = town.buildings.bySlot[position] ?? { type: 0, level: 0 }
  const type = slot.type
  const level = slot.level

  // Queued entries of the same *type*, from any slot.
  let realLevel = level
  for (const entry of town.buildQueue) if (entry.type === type) realLevel++

  const cost = buildingCost(type, realLevel, state.user.research, levelsByType(town))

  const queueBusy = town.buildQueue.length > 0
  const shipyardBusy = type === 4 && town.navalQueue.length > 0
  const barracksBusy = type === 5 && town.landQueue.length > 0
  const safehouseBusy = type === 14 && (town.spyTrainingStartedAt ?? 0) > 0

  const upgradeDisabled =
    (queueBusy && !hasPremium) ||
    shipyardBusy ||
    barracksBusy ||
    safehouseBusy ||
    realLevel > cost.max_level

  // Demolition is blocked while this slot is at the head of the queue, and
  // never offered for the town hall.
  const downgradeDisabled =
    (queueBusy && town.buildQueue[0]?.slot === position) ||
    position === 0 ||
    shipyardBusy ||
    barracksBusy ||
    safehouseBusy

  const nav = (hash: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    onNavigate(hash)
  }

  return (
    <div id="buildingUpgrade" className="dynamic">
      <h3 className="header">
        {t('expand')}{' '}
        <a
          className="help"
          href={hashFor('buildingDetail', type)}
          title={t('help')}
          onClick={nav(hashFor('buildingDetail', type))}
        >
          <span className="textLabel">{t('need_help')}</span>
        </a>
      </h3>
      <div className="content">
        <div className="buildingLevel">
          <span className="textLabel">{t('level')} </span>
          {level}
        </div>
        <h4>
          {t('need_for_next')} {realLevel + 1}:
        </h4>
        <ul className="resources">
          {ROWS.map(({ key, cls, label }) =>
            cost[key] > 0 ? (
              <li key={key} className={cls} title={t(label)}>
                <span className="textLabel">{t(label)}: </span>
                {num(cost[key])}
              </li>
            ) : null,
          )}
          {cost.time > 0 && (
            <li className="time" title={t('build_time')}>
              <span className="textLabel">{t('build_time')}: </span>
              {formatTime(cost.time)}
            </li>
          )}
        </ul>
        <ul className="actions">
          <li className="upgrade">
            {upgradeDisabled ? (
              <a className="disabled" href="#" title={t('no_expand')} onClick={(e) => e.preventDefault()} />
            ) : (
              <a
                href="#"
                title={t('level_up')}
                onClick={(e) => {
                  e.preventDefault()
                  onUpgrade(position)
                }}
              >
                {/* "In queue" once the same type is already queued: the button
                    adds a second entry rather than starting work now. */}
                <span className="textLabel">
                  {realLevel !== level ? t('in_queue') : t('upgrade')}
                </span>
              </a>
            )}
          </li>
          <li className="downgrade">
            {downgradeDisabled ? (
              <a
                className="disabled"
                href="#"
                title={t('no_demolish')}
                onClick={(e) => e.preventDefault()}
              />
            ) : (
              <a
                href={hashFor('demolition', position)}
                title={t('level_down')}
                onClick={nav(hashFor('demolition', position))}
              >
                <span className="textLabel">{t('demolish')}</span>
              </a>
            )}
          </li>
        </ul>
      </div>
      <div className="footer" />
    </div>
  )
}

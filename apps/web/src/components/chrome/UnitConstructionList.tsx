/**
 * The recruitment queue, izariam/views/sidebox/{barracks,shipyard}.php.
 *
 * The sibling of `ConstructionList`, and the same shape: the unit being
 * trained as `div.currentUnit` with a progress bar, the rest as `li` rows, and
 * a cancel button under them. `#unitConstructionList` is the id every rule in
 * ik_common_0.0.1.css:1522-1560 is scoped to, so the tree matters.
 *
 * Quirks carried over from the legacy's arithmetic:
 *
 * - Every row is priced from `army_start`, the head entry's start time, so a
 *   queued entry's countdown is measured from when the first one began rather
 *   than from when it will actually start; the legacy then prints the running
 *   sum on each row.
 * - The head entry is split in two, "in process" for its first unit and a
 *   queued row for the remaining `count - 1` of the same type.
 *
 * Neither is a true ETA, and correcting them here would not make one: the tick
 * advances the queue's clock by the *successor's* count rather than the
 * completed entry's (packages/rules/src/tick.ts:427-429), a defect the port
 * reproduces on purpose. Showing the legacy's numbers keeps the sidebox and
 * the engine telling the same story.
 *
 * Cancelling clears the whole queue -- `abortUnits` / `abortShips` take only a
 * town id (packages/shared/src/actions.ts:91), as the legacy's did.
 */

import { levelsByType, unitCost } from '@izariam/rules'

import { armyClass, armyName } from '../../lib/buildings.js'
import { formatTime } from '../../lib/format.js'
import { num, t } from '../../lib/i18n.js'
import type { ScreenContext } from '../../screens/context.js'
import { ProgressBar } from '../ProgressBar.js'

export function UnitConstructionList({
  ctx,
  kind,
}: {
  ctx: ScreenContext
  kind: 'land' | 'naval'
}) {
  const { town } = ctx
  const queue = kind === 'land' ? town.landQueue : town.navalQueue
  const start = kind === 'land' ? town.landQueueStartedAt : town.navalQueueStartedAt
  const head = queue[0]
  if (!head || start == null) return null

  const levels = levelsByType(town)
  const costOf = (unitType: number) => unitCost(unitType, ctx.state.user.research, levels)

  const headCost = costOf(head.unitType)
  const headEndsAt = start + headCost.time
  let cumulative = Math.max(0, headEndsAt - ctx.now)

  // The head entry's remaining units, then every entry behind it.
  const rows: { key: string; unitType: number; count: number; cumulative: number }[] = []
  if (head.count > 1) {
    const endsAt = start + headCost.time * (head.count - 1)
    cumulative += Math.max(0, endsAt - ctx.now)
    rows.push({
      key: 'head-rest',
      unitType: head.unitType,
      count: head.count - 1,
      cumulative,
    })
  }
  for (let i = 1; i < queue.length; i++) {
    const entry = queue[i]!
    const cost = costOf(entry.unitType)
    const endsAt = start + cost.time * entry.count
    cumulative += Math.max(0, endsAt - ctx.now)
    rows.push({
      key: `q${i}`,
      unitType: entry.unitType,
      count: entry.count,
      cumulative,
    })
  }

  const action = kind === 'land' ? 'abortUnits' : 'abortShips'

  return (
    <div className="dynamic" id="unitConstructionList">
      <h3 className="header">{t('buildings_construction_list')}</h3>
      <div className="content">
        <h4>{t('in_process')}:</h4>
        <div className={`currentUnit ${armyClass(head.unitType)}`}>
          <div className="amount">
            <span className="textLabel">{armyName(head.unitType)}</span>
          </div>
          <ProgressBar
            id="buildProgress"
            className="progressbar"
            startsAt={start}
            endsAt={headEndsAt}
            clockOffset={ctx.clockOffset}
          />
          <div className="time" id="buildCountDown">
            {formatTime(Math.max(0, headEndsAt - ctx.now))}
            <span className="textLabel"> {t('to_complete')}</span>
          </div>
        </div>

        {rows.length > 0 && (
          <>
            <h4>{t('in_queue')}:</h4>
            <ul>
              {rows.map((row) => (
                <li key={row.key} className={armyClass(row.unitType)}>
                  <div className="amount">
                    {num(row.count)}
                    <span className="textLabel"> {armyName(row.unitType)}</span>
                  </div>
                  <div className="time">
                    {formatTime(row.cumulative)}
                    <span className="textLabel"> {t('to_complete')}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        <div style={{ textAlign: 'center', padding: '10px 0' }}>
          <a
            className="button"
            href="#abort"
            onClick={(e) => {
              e.preventDefault()
              if (!window.confirm(t('build_cancel'))) return
              void ctx.act(action, { townId: town.id })
            }}
          >
            {t('cancel')}
          </a>
        </div>
      </div>
      <div className="footer" />
    </div>
  )
}

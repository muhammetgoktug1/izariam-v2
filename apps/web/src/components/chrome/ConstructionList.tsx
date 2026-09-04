/**
 * The premium build queue, izariam/views/sidebox/city.php:26-107.
 *
 * Two blocks: the head of the queue as `div.currentUnit` with a progress bar,
 * and the rest as `li` rows under `ul.constructionList`.
 *
 * Three quirks carried over verbatim:
 *
 * - Every row is priced against `build_start` -- the head's start time -- so a
 *   queued entry's countdown is measured from when the *first* one began, not
 *   from when it will actually start. The legacy then sums those remainders
 *   into `$ostalos_all` and prints the running total on each row, which is why
 *   the third entry shows a longer time than the second even when they cost
 *   the same.
 * - The level shown is `+1` over a per-slot counter that only increments when
 *   the slot has already appeared in the queue, so two upgrades of the same
 *   building read "Level 4" then "Level 5" while two upgrades of different
 *   buildings both read their own next level.
 * - The row title is the literal string "Building material: ???".
 */

import { buildingCost, levelsByType } from '@izariam/rules'

import { buildingClass, buildingName } from '../../lib/buildings.js'
import { HurryButtons } from '../building/HurryButtons.js'
import { formatTime } from '../../lib/format.js'
import { t } from '../../lib/i18n.js'
import { hashFor } from '../../lib/routes.js'
import type { ScreenContext } from '../../screens/context.js'
import { ProgressBar } from '../ProgressBar.js'

export function ConstructionList({ ctx }: { ctx: ScreenContext }) {
  const { town } = ctx
  const start = town.buildStartedAt
  const head = town.buildQueue[0]
  if (!head || start == null) return null

  const levels = levelsByType(town)
  // Per-slot running level, exactly as the legacy's `$levels[]` accumulator.
  const seen: Record<number, number> = {}
  let cumulative = 0

  const rows = town.buildQueue.map((entry, i) => {
    const built = town.buildings.bySlot[entry.slot]?.level ?? 0
    seen[entry.slot] = seen[entry.slot] ? seen[entry.slot]! + 1 : built
    const cost = buildingCost(entry.type, seen[entry.slot]!, ctx.state.user.research, levels)
    const endsAt = start + cost.time
    const remaining = Math.max(0, endsAt - ctx.now)
    cumulative += remaining
    return { entry, index: i, level: seen[entry.slot]! + 1, endsAt, cumulative }
  })

  const first = rows[0]!
  const rest = rows.slice(1)

  const abort = (index: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    void ctx.act('leaveConstructionList', { townId: town.id, index })
  }

  return (
    <div className="dynamic" id="unitConstructionList">
      <h3 className="header">{t('buildings_construction_list')}</h3>
      <div className="content">
        {/* Hardcoded English in the legacy (sidebox/city.php:43); a key here
            so it follows the chosen language like everything else. */}
        <h4>{t('under_construction')}:</h4>
        <div className={`currentUnit ${buildingClass(head.type)}`}>
          <div className="abortdiv">
            <a
              className="abort"
              title={t('cancel')}
              href={hashFor('demolition', head.slot)}
              onClick={(e) => {
                e.preventDefault()
                ctx.navigate(hashFor('demolition', head.slot))
              }}
            />
          </div>
          <div className="amount">
            <span className="textLabel">
              {buildingName(head.type)} ({t('level')}&nbsp;{first.level})
            </span>
          </div>
          {/* Lowercase here: `#unitConstructionList .currentUnit .progressbar`
              is the rule that styles it (ik_common_0.0.1.css:1537), matching
              sidebox/city.php:51. */}
          <ProgressBar
            id="buildProgress"
            className="progressbar"
            startsAt={start}
            endsAt={first.endsAt}
            clockOffset={ctx.clockOffset}
          />
          <div className="time" id="buildCountDown">
            {formatTime(first.cumulative)}
          </div>
        </div>

        {/* After `.currentUnit`, never inside it: that row is a fixed 52px with
            absolutely positioned children (ik_common_0.4.5.css:2402-2420). */}
        <HurryButtons
          compact
          townId={town.id}
          slot={head.slot}
          endsAt={first.endsAt}
          ambrosia={ctx.state.user.ambrosia}
          clockOffset={ctx.clockOffset}
          act={ctx.act}
          onNavigate={ctx.navigate}
        />

        {rest.length > 0 && (
          <ul className="constructionList">
            {rest.map((row) => (
              <li
                key={row.index}
                className={buildingClass(row.entry.type)}
                title={t('building_material_unknown')}
              >
                <div className="abortdiv">
                  <a className="abort" title={t('cancel')} href="#" onClick={abort(row.index)} />
                </div>
                <div className="amount">
                  <span className="textLabel">
                    {buildingName(row.entry.type)} ({t('level')}&nbsp;{row.level})
                  </span>
                </div>
                <div className="time" id={`queueEntry${row.index}`}>
                  {formatTime(row.cumulative)}
                  <span className="textLabel"> {t('to_complete')}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="footer" />
    </div>
  )
}

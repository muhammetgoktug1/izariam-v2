/**
 * The construction menu, izariam/views/view/buildingGround.php.
 *
 * What every empty slot in the city opens. Without it nothing past the
 * starting town hall can ever be built, which is why it is in the first wave
 * despite being one of the more intricate files: 25 candidate buildings each
 * behind up to three gates.
 *
 * The gates, ported verbatim:
 *
 * - Already built, unless it is the warehouse (6), the only building a town
 *   may have more than one of.
 * - Terrain. Slot 14 takes the wall (7) and nothing else; slots 1 and 2 take
 *   only the port (2) and the shipyard (4); slots 3..13 take everything
 *   *except* those three.
 * - Research, and for two of them the capital: the palace (10) needs the
 *   capital, the governor's residence (15) needs *not* to be the capital, and
 *   the four trade-good workshops need the island to yield that good.
 *
 * The legacy's crystal row carries the typo `cystal` in its label. That is not
 * reproduced: `t()` here renders an unknown key as the empty string rather
 * than as the key, so the typo would show as a missing label rather than as
 * the legacy's visible oddity.
 *
 * Slot 0 is not reachable here -- the town hall is never demolished to nothing
 * -- so the loop starts at building type 2.
 */

import { buildingCost, levelsByType, RESOURCES } from '@izariam/rules'
import { useState } from 'react'

import { buildingClass, buildingDesc, buildingName } from '../lib/buildings.js'
import { formatTime } from '../lib/format.js'
import { num, t } from '../lib/i18n.js'
import { hashFor } from '../lib/routes.js'
import type { Screen, ScreenContext } from './context.js'

/** Building type -> the research node that unlocks it. */
const RESEARCH_GATE: Record<number, string> = {
  4: '4_1',
  6: '2_1',
  8: '2_4',
  9: '3_7',
  10: '1_4',
  11: '1_5',
  12: '2_3',
  13: '3_6',
  14: '3_3',
  15: '1_4',
  16: '2_5',
  17: '2_5',
  18: '2_5',
  19: '2_5',
  20: '2_5',
  21: '1_1',
  22: '2_7',
  23: '3_9',
  24: '2_12',
  25: '4_10',
  26: '3_4',
}

/** The four trade-good workshops, each tied to its island's yield. */
const TRADE_GATE: Record<number, number> = { 17: 2, 18: 3, 19: 1, 20: 4 }

/** Cost rows. The crystal row's class is `crystal` here, unlike the sidebox's
 *  `glass` -- the two templates disagree and the skin styles both. */
const ROWS = [
  { key: 'wood', cls: 'wood', label: 'wood' },
  { key: 'wine', cls: 'wine', label: 'wine' },
  { key: 'marble', cls: 'marble', label: 'marble' },
  { key: 'crystal', cls: 'crystal', label: 'crystal' },
  { key: 'sulfur', cls: 'sulfur', label: 'sulfur' },
] as const

function offered(ctx: ScreenContext, type: number, position: number): boolean {
  const { townDerived, state, island, town } = ctx

  // The warehouse is the one building a town may stack.
  if (townDerived.alreadyBuilt[type] && type !== 6) return false

  if (position === 14) return type === 7
  if (position === 1 || position === 2) return type === 4 || type === 2
  if (position > 2 && position < 14 && (type === 4 || type === 2 || type === 7)) return false

  const gate = RESEARCH_GATE[type]
  if (gate && (state.user.research.levels[gate] ?? 0) === 0) return false

  const isCapital = town.id === state.user.capitalTownId
  if (type === 10 && !isCapital) return false
  if (type === 15 && isCapital) return false

  const good = TRADE_GATE[type]
  if (good !== undefined && island.tradeResource !== good) return false

  return true
}

export const BuildingGroundScreen: Screen = ({ ctx, sideboxes }) => {
  const position = ctx.route.params[0]
  const levels = levelsByType(ctx.town)
  const queueBusy = ctx.town.buildQueue.length > 0
  /** Which type is in flight, so its button cannot be clicked a second time
   *  before the answer -- and the state refetch -- comes back. */
  const [ordering, setOrdering] = useState<number | null>(null)

  const candidates: number[] = []
  for (let type = 2; type <= 26; type++) {
    if (offered(ctx, type, position)) candidates.push(type)
  }

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <div className="buildingDescription">
          <h1>{t('empty_building_ground')}</h1>
          <p>{t('empty_building_text')}</p>
        </div>
        <div className="contentBox01h">
          <h3 className="header">{t('build_building')}</h3>
          <div className="content">
            <ul id="buildings">
              {candidates.map((type) => {
                const cost = buildingCost(type, 0, ctx.state.user.research, levels)
                const affordable = RESOURCES.every((r) => ctx.town.resources[r] >= cost[r])
                const cls = buildingClass(type)

                return (
                  <li key={type} className={`building ${cls}`}>
                    <div className="buildinginfo">
                      <h4>{buildingName(type)}</h4>
                      <a
                        href={hashFor('buildingDetail', type)}
                        onClick={(e) => {
                          e.preventDefault()
                          ctx.navigate(hashFor('buildingDetail', type))
                        }}
                      >
                        <img src={`/skin/buildings/y100/${cls}.gif`} alt="" />
                      </a>
                      <p>{buildingDesc(type)}</p>
                    </div>
                    <hr />

                    {!affordable ? (
                      <p className="cannotbuild">{t('not_resources')}</p>
                    ) : !queueBusy || ctx.chrome.hasPremium ? (
                      <div className="centerButton">
                        {/* The legacy's build link was a full page load that
                            ended in `show('city')` (actions.php:488), so the
                            menu tore itself down and a second click during the
                            request was impossible. Here the navigation and the
                            lock have to be explicit -- without them the panel
                            stayed up and a second click queued the same
                            building again at level 1. */}
                        <a
                          className="button build"
                          style={{ paddingLeft: 3, paddingRight: 3 }}
                          href="#"
                          onClick={(e) => {
                            e.preventDefault()
                            if (ordering !== null) return
                            setOrdering(type)
                            void ctx
                              .act('build', { townId: ctx.town.id, slot: position, type })
                              .then((ok) => {
                                setOrdering(null)
                                if (ok) ctx.navigate(hashFor('city'))
                              })
                          }}
                        >
                          <span className="textLabel">
                            {queueBusy ? t('to_queue') : t('build_now')}
                          </span>
                        </a>
                      </div>
                    ) : (
                      <p className="cannotbuild">
                        {t('already_building')} (
                        <a
                          href={hashFor('premiumDetails')}
                          onClick={(e) => {
                            e.preventDefault()
                            ctx.navigate(hashFor('premiumDetails'))
                          }}
                        >
                          {t('carry_building')}
                        </a>
                        )
                      </p>
                    )}

                    <div className="costs">
                      <h5>{t('cost')}:</h5>
                      <ul className="resources">
                        {ROWS.map((row) =>
                          cost[row.key] > 0 ? (
                            <li key={row.key} className={row.cls} title={t(row.key)}>
                              <span className="textLabel">{t(row.label)}: </span>
                              {num(cost[row.key])}
                            </li>
                          ) : null,
                        )}
                        {/* Unlike the upgrade panel, the time row is
                            unconditional here even at zero. */}
                        <li className="time" title={t('build_time')}>
                          <span className="textLabel">{t('build_time')}: </span>
                          {formatTime(cost.time)}
                        </li>
                      </ul>
                    </div>
                  </li>
                )
              })}
            </ul>
            {candidates.length === 0 && (
              <div>
                <br />
                <center>
                  <p>{t('no_buildings')}</p>
                </center>
              </div>
            )}
          </div>
          <div className="footer" />
        </div>
      </div>
    </>
  )
}

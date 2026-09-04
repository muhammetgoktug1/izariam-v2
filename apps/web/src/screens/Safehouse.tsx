/**
 * The two safehouse screens: sending a spy and giving one orders.
 *
 * izariam/views/view/sendSpy.php and safehouseMissions.php. The second is 168
 * lines of the same `<li>` copied seven times with a different mission id, cost
 * and blurb, so it becomes one loop over the mission table.
 *
 * The risk arithmetic is the same in both, and is the *display* half of
 * `riskFromDefences` (espionage.ts):
 *
 *   5 * targetSpies + 2 * targetSafehouse - 2 * targetTownHall - 2 * mySafehouse
 *
 * with two differences the templates introduce and the engine does not:
 *
 * - sendSpy adds the mission-1 base and clamps the *total* to a floor of 5.
 * - safehouseMissions clamps the defence part to a floor of 0 first, then adds
 *   the spy's stored risk and the mission's base with no upper clamp -- so a
 *   spy that has already been noticed can be quoted well over 100%.
 *
 * Both are what the player was shown, so both are reproduced. The number the
 * roll actually uses comes from the server.
 */

import { spyGoldByMission, spyRiskByMission, spyTimeByCoords, ESPIONAGE_MISSION } from '@izariam/rules'
import { useQuery } from '@tanstack/react-query'

import { api, type SpyTargetView } from '../lib/api.js'
import { formatTime } from '../lib/format.js'
import { num, t } from '../lib/i18n.js'
import { hashFor } from '../lib/routes.js'
import type { Screen, ScreenContext } from './context.js'

/** The seven intel missions, plus recall. `li` class drives the icon. */
const MISSIONS: { id: number; cls: string }[] = [
  { id: ESPIONAGE_MISSION.TREASURY, cls: 'gold' },
  { id: ESPIONAGE_MISSION.WAREHOUSE, cls: 'resources' },
  { id: ESPIONAGE_MISSION.RESEARCH, cls: 'research' },
  { id: ESPIONAGE_MISSION.ONLINE_STATUS, cls: 'online' },
  { id: ESPIONAGE_MISSION.GARRISON, cls: 'army' },
  { id: ESPIONAGE_MISSION.FLEET_MOVEMENTS, cls: 'fleet' },
  { id: ESPIONAGE_MISSION.CORRESPONDENCE, cls: 'messages' },
]

/** The defence half, floored at 0. */
function defenceRisk(target: SpyTargetView, mySafehouse: number): number {
  return Math.max(
    0,
    5 * target.spies + 2 * target.safehouseLevel - 2 * target.townHallLevel - 2 * mySafehouse,
  )
}

function mySafehouseLevel(ctx: ScreenContext): number {
  return ctx.townDerived.levels[14] ?? 0
}

/**
 * sendSpy.php. Reached from the island board; the target town id is the second
 * URL parameter, the island the first.
 */
export const SendSpyScreen: Screen = ({ ctx, sideboxes }) => {
  const [islandId, targetTownId] = ctx.route.params
  const island = ctx.state.islands[islandId] ?? ctx.island

  const board = useQuery({ queryKey: ['island', islandId], queryFn: () => api.island(islandId) })
  const town = board.data?.slots.find((s) => s.town?.id === targetTownId)?.town

  const travel = spyTimeByCoords(ctx.island.x, island.x, ctx.island.y, island.y)

  // The send screen has no target defences to hand -- Data_Model held them
  // because the island board had just been loaded -- so it quotes the base
  // risk with the caller's own safehouse discount, floored at 5.
  const risk = Math.max(
    5,
    spyRiskByMission(1) - 2 * mySafehouseLevel(ctx),
  )

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <div className="buildingDescription">
          <h1>{t('send_spy')}</h1>
          <p>{t('send_spy_text')}</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void ctx
              .act('spyes/send', { townId: ctx.town.id, islandId, targetTownId })
              .then(() => ctx.navigate(hashFor('safehouse')))
          }}
        >
          <div className="contentBox01h" id="sendSpy">
            <h3 className="header">{t('send_spy')}</h3>
            <div className="content">
              <p className="desc">{t('send_spy_desc')}</p>
              <div className="costs">
                <span className="textLabel">{t('cost')}: </span>
                {num(spyGoldByMission(1))}
              </div>
              <div className="risk">
                <span className="textLabel">{t('risk_detection')}:</span>
                <div title={`${t('risk_detection')} ${risk}%`} className="statusBar">
                  <div style={{ width: `${risk}%` }} className="bar" />
                </div>
                <div className="percentage">{risk}%</div>
              </div>
              <hr />
              <div id="missionSummary">
                <div className="common">
                  <div className="journeyTarget" title={t('city')}>
                    <span className="textLabel">{t('city')}: </span>
                    {town?.name ?? ''}
                  </div>
                  <div className="journeyTime" title={t('travel_time')}>
                    <span className="textLabel">{t('travel_time')}: </span>
                    {formatTime(travel)}
                  </div>
                </div>
              </div>
              <div className="centerButton">
                <input id="submit" className="button" type="submit" value={t('send_spy')} />
              </div>
              {ctx.failure && <p className="error">{t(ctx.failure)}</p>}
            </div>
            <div className="footer" />
          </div>
        </form>
      </div>
    </>
  )
}

/** safehouseMissions.php -- the order list for one spy already in place. */
export const SafehouseMissionsScreen: Screen = ({ ctx, sideboxes }) => {
  const spyId = ctx.route.params[0]
  const spy = ctx.state.spies.find((s) => s.id === spyId)
  const targets = useQuery({ queryKey: ['spy-targets'], queryFn: api.spyTargets })
  const target = spy ? targets.data?.targets[String(spy.id)] : undefined

  if (!spy || !target) {
    return (
      <>
        {sideboxes}
        <div id="mainview">
          <div className="buildingDescription">
            <h1>{t('missions')}</h1>
          </div>
        </div>
      </>
    )
  }

  const base = defenceRisk(target, mySafehouseLevel(ctx))

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <div className="buildingDescription">
          <h1>{t('missions')}</h1>
          <p>{t('give_spy_order')}</p>
        </div>
        <div className="contentBox01h">
          <h3 className="header">
            <span className="textLabel">
              {t('choose_mission')} {target.name}
            </span>
          </h3>
          <div className="content" style={{ position: 'relative' }}>
            <div className="percentage">{spy.risk}%</div>
            <h4>
              <span className="textLabel">{t('current_risk')}:</span>
            </h4>
            <div className="missionText">
              <div title={`${t('risk_detection')}: ${spy.risk}%`} className="statusBar">
                <div style={{ width: `${spy.risk}%` }} className="bar" />
              </div>
            </div>
            <ul id="missionlist">
              {MISSIONS.map((m) => {
                // No upper clamp: a spy already at risk can be quoted >100%.
                const risk = base + spy.risk + spyRiskByMission(m.id)
                return (
                  <li key={m.id} className={m.cls}>
                    <div title={t('mission_name')} className="missionType">
                      {t(`spy_mission_${m.id}_name`)}
                    </div>
                    <div title={t('mission_desc')} className="missionDesc">
                      {t(`spy_mission_${m.id}_desc`)}
                    </div>
                    <div title={t('mission_cost')} className="missionCosts">
                      <strong>{t('cost')}:</strong>{' '}
                      <span className="textLabel">{t('gold')}: </span>
                      <span className="gold">{num(spyGoldByMission(m.id))}</span>
                    </div>
                    <div title={t('mission_risk')} className="missionRisk">
                      <strong>{t('risk')}:</strong> {risk}%
                    </div>
                    <div title={String(m.id)} className="missionStart">
                      <div className="centerButton">
                        <a
                          className="button"
                          href="#"
                          onClick={(e) => {
                            e.preventDefault()
                            void ctx.act('resolveEspionage', {
                              townId: ctx.town.id,
                              spyId: spy.id,
                              mission: m.id,
                            })
                          }}
                        >
                          {t('start_mission')}
                        </a>
                      </div>
                    </div>
                  </li>
                )
              })}
              {/* Recall is advertised as free and riskless (espionage.ts). */}
              <li className="recall">
                <div className="missionType">{t('spy_mission_10_name')}</div>
                <div className="missionCosts">
                  <strong>{t('cost')}:</strong> <span className="gold">0</span>
                </div>
                <div className="missionStart">
                  <div className="centerButton">
                    <a
                      className="button"
                      href="#"
                      onClick={(e) => {
                        e.preventDefault()
                        void ctx.act('spyes/return', {
                          townId: ctx.town.id,
                          spyId: spy.id,
                          fromTownId: spy.fromTownId,
                        })
                      }}
                    >
                      {t('start_mission')}
                    </a>
                  </div>
                </div>
              </li>
            </ul>
            {ctx.failure && <p className="error">{t(ctx.failure)}</p>}
          </div>
          <div className="footer" />
        </div>
      </div>
    </>
  )
}

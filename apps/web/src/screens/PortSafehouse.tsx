/**
 * The port and the safehouse, izariam/views/view/{port,safehouse}.php.
 *
 * Both are hardcoded Russian throughout with no language keys.
 */

import { RESOURCE_CLASS } from '@izariam/gamedata'
import {
  spyTimeByLevel,
  transportCostByCount,
  totalTransports,
  levelsByType,
  type MissionState,
} from '@izariam/rules'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { BuildingHeader } from '../components/building/BuildingHeader.js'
import { Countdown } from '../components/Countdown.js'
import { api } from '../lib/api.js'
import { formatTime } from '../lib/format.js'
import { num, t, tf } from '../lib/i18n.js'
import { hashFor } from '../lib/routes.js'
import type { Screen, ScreenContext } from './context.js'

/** Resource -> icon file for the cargo tooltip. Crystal's is called glass. */
const TOOLTIP_ICON: Record<string, string> = {
  wood: 'wood',
  wine: 'wine',
  marble: 'marble',
  crystal: 'glass',
  sulfur: 'sulfur',
}

/**
 * port.php -- buy a cargo ship, a shortcut to every other town you own, and
 * the loading pier: which fleets are taking on cargo at this quay, how long
 * the one at the head of the queue still has, and a recall button for it.
 *
 * "Maximum: 160" is printed as a literal and nothing enforces it: the price
 * ladder simply ends at 160, so `transportCostByCount` returns 0 past it and
 * every ship after the 160th is free. Reproduced, flagged in the rules as
 * `freeTransportsPast160`.
 *
 * `game/shipDescription/23` has no controller; the sprite is kept, the link
 * is not.
 */
export const PortScreen: Screen = ({ ctx, sideboxes }) => {
  const position = ctx.route.params[0]
  const owned = totalTransports(ctx.state)
  const price = transportCostByCount(owned)
  const affordable = ctx.state.user.gold >= price

  // Fleets taking on cargo at THIS quay, in the order the pier serves them
  // (port.php:62 walks them in Load_Missions order; only the first is loading,
  // the rest wait for the quay -- update_model.php:517-538).
  const loading = ctx.state.missions
    .filter((m) => m.fromTownId === ctx.town.id && m.departedAt == null)
    .sort(
      (a, b) =>
        (a.loadingFromStartedAt ?? 0) - (b.loadingFromStartedAt ?? 0) || a.id - b.id,
    )

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <BuildingHeader
          position={position}
          state={ctx.state}
          town={ctx.town}
          now={ctx.now}
          clockOffset={ctx.clockOffset}
          onNavigate={ctx.navigate}
          onFinished={ctx.refresh}
          act={ctx.act}
        />
        <div className="contentBox01h">
          <h3 className="header">
            <span className="textLabel">{t('buy_transporter')}</span>
          </h3>
          <div className="content">
            <ul id="units">
              <li className="unit">
                <div className="unitinfo">
                  <h4>{t('cargo_ship')}</h4>
                  <img
                    src="/skin/characters/fleet/120x100/ship_transport_r_120x100.gif"
                    alt=""
                  />
                  <div className="unitcount">
                    <span className="textLabel">{t('available')}: </span>
                    {num(owned)}
                  </div>
                  <p>{t('cargo_ship_desc')}</p>
                </div>
                <label htmlFor="textfield_">{t('buy_transporter')}:</label>
                <div className="forminput">
                  {tf('spy_max_note', 160)}
                  <br />
                  {affordable ? (
                    <div className="leftButton">
                      <a
                        href="#"
                        className="button bigButton"
                        onClick={(e) => {
                          e.preventDefault()
                          void ctx.act('transporter', { townId: ctx.town.id })
                        }}
                      >
                        {t('buy_transporter')}
                      </a>
                    </div>
                  ) : (
                    t('not_resources')
                  )}
                </div>
                <div className="costs">
                  <ul className="resources">
                    {price > 0 && (
                      <li className="gold">
                        <span className="textLabel">{t('gold')}: </span>
                        {num(price)}
                      </li>
                    )}
                  </ul>
                </div>
              </li>
            </ul>
            {ctx.failure && <p className="error">{t(ctx.failure)}</p>}
          </div>
          <div className="footer" />
        </div>

        <div className="contentBox01h">
          <h3 className="header">
            <span className="textLabel">{t('send_transporter')}</span>
          </h3>
          <div className="content">
            {/* The skin's own port buttons (ik_port_0.4.5.css:21-70): a
                133x120 city card with the island coords, the town's level
                sprite, the island's trade good and a scroll-banner name. */}
            <ul className="cities">
              {ctx.state.towns
                .filter((town) => town.id !== ctx.town.id && ctx.derived.towns[town.id])
                .map((town) => {
                  const island = ctx.state.islands[town.islandId]
                  const href = hashFor('transport', town.islandId, town.id)
                  const level = Math.min(
                    24,
                    Math.max(1, levelsByType(town)[1] ?? 1),
                  )
                  return (
                    <li className="cityBox" key={town.id}>
                      <a
                        title={`${t('transport')} ${town.name}`}
                        href={href}
                        onClick={(e) => {
                          e.preventDefault()
                          ctx.navigate(href)
                        }}
                      >
                        <span className="coords">
                          [{island?.x}:{island?.y}]
                        </span>
                        <span
                          className={`resource ${RESOURCE_CLASS[String(island?.tradeResource ?? 0)] ?? ''}`}
                        />
                        <span className={`symbol level${level}`} />
                        <span className="name">
                          <span className="before" />
                          <span className="after" />
                          {town.name}
                        </span>
                      </a>
                    </li>
                  )
                })}
            </ul>
          </div>
          <div className="footer" />
        </div>

        <div className="contentBox01h" style={{ zIndex: 100 }}>
          <h3 className="header">
            <span className="textLabel">{t('port_load_fleets')}</span>
          </h3>
          <div className="content master">
            <div className="tcap">{t('port_own_ships')}</div>
            {loading.length === 0 ? (
              <p>{t('port_no_ships')}</p>
            ) : (
              <table cellPadding={0} cellSpacing={0} className="table01">
                <thead>
                  <tr>
                    <th className="origin">{t('destination')}</th>
                    <th>{t('quantity')}</th>
                    <th>{t('mission')}</th>
                    <th className="status">{t('status')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {loading.map((mission, i) => (
                    <LoadingRow key={mission.id} ctx={ctx} mission={mission} active={i === 0} />
                  ))}
                </tbody>
              </table>
            )}
            {/* Foreign fleets loading here: the legacy never listed any
                (port.php:161-162) and the tick has no quay sharing to report
                here yet either. */}
            <div className="tcap">{t('port_foreign_ships')}</div>
            <p>{t('port_no_ships')}</p>
          </div>
          <div className="footer" />
        </div>

        <div className="contentBox01h" style={{ zIndex: 50 }}>
          <h3 className="header">
            <span className="textLabel">{t('port_arriving')}</span>
          </h3>
          <div className="content master">
            <p>{t('port_no_ships')}</p>
          </div>
          <div className="footer" />
        </div>
      </div>
    </>
  )
}

/**
 * One fleet on the quay (port.php:89-152). The head of the queue is loading --
 * countdown to the projected departure, progress bar over the whole load,
 * recall button -- everything behind it is waiting for the pier.
 */
function LoadingRow({
  ctx,
  mission,
  active,
}: {
  ctx: ScreenContext
  mission: MissionState
  active: boolean
}) {
  const to = ctx.state.towns.find((x) => x.id === mission.toTownId)
  const start = mission.loadingFromStartedAt ?? 0
  const end = mission.arrivesAt ?? start
  const [pct, setPct] = useState(() => progress(start, end, ctx.clockOffset))

  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(
      () => setPct(progress(start, end, ctx.clockOffset)),
      1000,
    )
    return () => window.clearInterval(timer)
  }, [active, start, end, ctx.clockOffset])

  const manifest = (['wood', 'wine', 'marble', 'crystal', 'sulfur'] as const)
    .filter((r) => mission.cargo[r] > 0)
    .map((r) => `${t(r)}: ${num(mission.cargo[r])}`)
    .concat(mission.cargo.peoples > 0 ? [`${t('peoples')}: ${num(mission.cargo.peoples)}`] : [])
    .join(', ')

  return (
    <tr>
      <td className="city">{to?.name ?? '-'}</td>
      <td title={manifest}>
        {mission.transports} {t('ships')}
      </td>
      <td>{t(`mission_${mission.kind}`)}</td>
      <td className="status">
        {active ? (
          <>
            <div className="time" id={`outgoingOwnCountDown${mission.id}`}>
              {mission.arrivesAt != null ? (
                <Countdown
                  endsAt={mission.arrivesAt}
                  clockOffset={ctx.clockOffset}
                  onFinish={ctx.refresh}
                />
              ) : (
                '—'
              )}
            </div>
            <div className="progressBar">
              <div className="bar" style={{ width: `${pct}%` }} />
            </div>
            {t('port_loading_status')}
          </>
        ) : (
          t('port_waiting')
        )}
      </td>
      <td>
        {active && (
          <a
            href="#"
            title={t('withdraw')}
            onClick={(e) => {
              e.preventDefault()
              void ctx.act('abortFleet', { missionId: mission.id })
            }}
          >
            <img src="/skin/advisors/military/icon-back.gif" alt={t('withdraw')} />
          </a>
        )}
      </td>
    </tr>
  )
}

/** Percent of the load that is on board, against the server clock. */
function progress(start: number, end: number, clockOffset: number): number {
  if (end <= start) return 100
  const now = Date.now() / 1000 + clockOffset
  return Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100))
}

/**
 * safehouse.php -- train spies, and see the ones already placed.
 *
 * The spy cap is the safehouse level minus every spy the town has, placed or
 * idle. Cost is a flat 150 gold and 80 wood, both literals in the template --
 * and the wood row is given `class="glass"`, so it renders with the crystal
 * icon.
 *
 * The tabs point at `safehouse/reports` and `safehouse/archive`, which are
 * URL segments the controller never reads; both fall through to the training
 * tab. Kept as tabs that do nothing, which is what they did.
 */
export const SafehouseScreen: Screen = ({ ctx, sideboxes }) => {
  const position = ctx.route.params[0]
  const level = levelsByType(ctx.town)[14] ?? 0
  const targets = useQuery({ queryKey: ['spy-targets'], queryFn: api.spyTargets })

  const mine = ctx.state.spies.filter((s) => s.fromTownId === ctx.town.id)
  const placed = mine.length
  const total = placed + ctx.town.spies
  const training = (ctx.town.spyTrainingStartedAt ?? 0) > 0

  const head = ctx.town.buildQueue[0]
  const upgrading = head?.slot === position && ctx.town.buildStartedAt != null

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <BuildingHeader
          position={position}
          state={ctx.state}
          town={ctx.town}
          now={ctx.now}
          clockOffset={ctx.clockOffset}
          onNavigate={ctx.navigate}
          onFinished={ctx.refresh}
          act={ctx.act}
          />
        <div className="yui-navset">
          <ul className="yui-nav">
            <li className="selected">
              <a href="#" onClick={(e) => e.preventDefault()}>
                <em>{t('building14_name')}</em>
              </a>
            </li>
            <li>
              <a
                href={hashFor('safehouseReports')}
                onClick={(e) => {
                  e.preventDefault()
                  ctx.navigate(hashFor('safehouseReports'))
                }}
              >
                <em>{t('esp_report')}</em>
              </a>
            </li>
            <li>
              <a href="#" onClick={(e) => e.preventDefault()}>
                <em>{t('archive')}</em>
              </a>
            </li>
          </ul>
        </div>

        <div className="contentBox01h">
          <h3 className="header">
            <span className="textLabel">{t('spy_training')}</span>
          </h3>
          <div className="content">
            <ul id="units">
              <li className="unit">
                <div className="unitinfo">
                  <h4>{t('spy')}</h4>
                  <img src="/skin/characters/military/120x100/spy_120x100.gif" alt="" />
                  <p>{t('spy_desc')}</p>
                </div>
                <div className="forminput">
                  {training ? (
                    t('training_started')
                  ) : upgrading ? (
                    t('is_upgrading')
                  ) : level - total > 0 ? (
                    <div className="centerButton">
                      <a
                        href="#"
                        className="button"
                        title={t('train')}
                        onClick={(e) => {
                          e.preventDefault()
                          void ctx.act('spyes/buy', { townId: ctx.town.id })
                        }}
                      >
                        {t('train')}
                      </a>
                    </div>
                  ) : (
                    t('max_spies')
                  )}
                </div>
                <div className="costs">
                  <h5>{t('cost')}:</h5>
                  <ul className="resources">
                    <li className="gold">
                      <span className="textLabel">{t('gold')}: </span>150
                    </li>
                    {/* class="glass" on a wood row, in the original. */}
                    <li className="glass">
                      <span className="textLabel">{t('wood')}: </span>80
                    </li>
                    <li className="time">{formatTime(spyTimeByLevel(level))}</li>
                  </ul>
                </div>
              </li>
            </ul>
            {ctx.failure && <p className="error">{t(ctx.failure)}</p>}
          </div>
          <div className="footer" />
        </div>

        <div className="contentBox01h">
          <h3 className="header">
            <span className="textLabel">{t('spies_on_mission')}</span>
          </h3>
          <div className="content">
            {mine.length === 0 ? (
              <p>{t('no_spies')}</p>
            ) : (
              mine.map((spy) => {
                const target = targets.data?.targets[String(spy.id)]
                return (
                  <div key={spy.id} className="spyinfo">
                    <ul>
                      <li title={t('residence')} className="city">
                        {target ? `${target.name} (${target.x},${target.y})` : '-'}
                      </li>
                      <li className="risk">
                        <span className="textLabel">{t('risk_detection')}: </span>
                        {spy.risk}%
                      </li>
                    </ul>
                    <div className="centerButton">
                      <a
                        className="button"
                        href={hashFor('safehouseMissions', spy.id)}
                        onClick={(e) => {
                          e.preventDefault()
                          ctx.navigate(hashFor('safehouseMissions', spy.id))
                        }}
                      >
                        {t('missions')}
                      </a>
                    </div>
                  </div>
                )
              })
            )}
          </div>
          <div className="footer" />
        </div>
      </div>
    </>
  )
}

/** safehouseReports.php -- the spy message log. */
export const SafehouseReportsScreen: Screen = ({ ctx, sideboxes }) => (
  <>
    {sideboxes}
    <div id="mainview">
      <div className="buildingDescription" style={{ height: '50px' }}>
        <h1>{t('esp_report')}</h1>
      </div>
      <div className="contentBox01h">
        <h3 className="header">
          <span className="textLabel">{t('esp_report')}</span>
        </h3>
        <div className="content">
          {/* Spy reports are written to spy_messages by the tick; the chrome
              counts them and this is where they would be listed. The count is
              in /api/state as newSpyMessages. */}
          <p>
            {ctx.chrome.newSpyMessages > 0
              ? `${ctx.chrome.newSpyMessages} ${t('esp_report')}`
              : t('no_reports')}
          </p>
        </div>
        <div className="footer" />
      </div>
    </div>
  </>
)

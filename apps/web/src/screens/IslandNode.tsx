/**
 * The saw mill and the trade-good mine, izariam/views/view/resource.php and
 * tradegood.php -- the same body with the island's other node substituted in.
 *
 * Two panels: a worker slider, and a roster of everyone else on the island
 * with what they have donated.
 *
 * The slider's overcharge band exists only with research 2_5 (expansion):
 * without it the cap is the node's `workers` figure, with it the cap rises by
 * half again, and every worker past the plain cap produces at a quarter rate.
 * That last part is in the projection formula the template inlines:
 *
 *   rate = plus * (1 - corruption) * (min(cap, n) + max(0, 0.25 * (n - cap)))
 *
 * The income projection subtracts a flat 3 gold per worker moved, which is not
 * what the tick charges either -- workers cost nothing, only scientists do. The
 * number is wrong the moment the slider moves and right again after the reload.
 * Reproduced.
 *
 * tradegood.php additionally hides the whole screen behind research 2_3
 * (wealth); resource.php has no such gate.
 */

import { islandNodeCost } from '@izariam/rules'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Slider } from '../components/Slider.js'
import { api } from '../lib/api.js'
import { islandBuildingName, tradeResourceName } from '../lib/buildings.js'
import { num, t } from '../lib/i18n.js'
import { hashFor } from '../lib/routes.js'
import type { Screen, ScreenContext } from './context.js'

export const ResourceScreen: Screen = ({ ctx, sideboxes }) => (
  <>
    {sideboxes}
    <IslandNode ctx={ctx} kind="resource" />
  </>
)

export const TradegoodScreen: Screen = ({ ctx, sideboxes }) => (
  <>
    {sideboxes}
    <IslandNode ctx={ctx} kind="tradegood" />
  </>
)

function IslandNode({ ctx, kind }: { ctx: ScreenContext; kind: 'resource' | 'tradegood' }) {
  const islandId = ctx.route.params[0] || ctx.town.islandId
  const island = ctx.state.islands[islandId] ?? ctx.island
  const isWood = kind === 'resource'

  const detail = useQuery({
    queryKey: ['island', islandId],
    queryFn: () => api.island(islandId),
  })

  const level = isWood ? island.woodLevel : island.tradeLevel
  const cost = islandNodeCost(isWood ? 0 : 1, level)
  const assignedNow = Math.floor(isWood ? ctx.town.workers : ctx.town.tradegood)
  const available = ctx.town.peoples + (isWood ? ctx.town.workers : ctx.town.tradegood)

  const cap = Math.floor(Math.min(cost.workers, available))
  const hasExpansion = (ctx.state.user.research.levels['2_5'] ?? 0) > 0
  const overMax =
    hasExpansion && available >= cap
      ? Math.floor(Math.min(cap + cost.workers * 0.5, available))
      : cap
  const max = Math.max(cap, overMax)

  const [assigned, setAssigned] = useState(assignedNow)

  const good = isWood ? 'wood' : tradeResourceName(island.tradeResource)
  /** The artwork calls trade resource 3 `glass`; the balance tables call it
   *  `crystal`. Every file under `img/island` and `skin/resources` uses the
   *  first name. */
  const iconName = good === 'crystal' ? 'glass' : good

  /**
   * The mine screen carries its resource as a background on the description
   * block, right-aligned over a 180px box (tradegood.php:25 and :48). The saw
   * mill has no such rule and no such image -- `img/island/resource_wood.gif`
   * does not exist.
   */
  const mineDescription = {
    background: `url(/skin/img/island/resource_${iconName}.gif) no-repeat right 10px`,
    minHeight: '180px',
  }

  // tradegood.php is gated on wealth; resource.php is not. The heading stays
  // the node's own name either way -- the gate is what the paragraph says.
  if (!isWood && (ctx.state.user.research.levels['2_3'] ?? 0) === 0) {
    return (
      <div id="mainview">
        <div className="buildingDescription" style={mineDescription}>
          <h1>{islandBuildingName(island.tradeResource)}</h1>
          <p>{t('research_needed')}</p>
        </div>
      </div>
    )
  }

  const multiplier = isWood ? ctx.derived.plus.wood : ctx.derived.plus[ctx.townDerived.tradeResource]
  const projectedRate = Math.floor(
    multiplier *
      (1 - ctx.townDerived.corruption) *
      (Math.min(cost.workers, assigned) + Math.max(0, 0.25 * (assigned - cost.workers))),
  )
  const currentRate = Math.floor(
    (isWood ? ctx.townDerived.resourceProductionBonus : ctx.townDerived.tradegoodProductionBonus) *
      3600,
  )

  return (
    <div id="mainview">
      <div className="buildingDescription" style={isWood ? undefined : mineDescription}>
        <h1>{isWood ? t('saw_mill') : t(`${good}_mine`)}</h1>
        <p>{t(isWood ? 'saw_mill_desc' : 'mine_desc')}</p>
      </div>

      <form
        id="setWorkers"
        onSubmit={(e) => {
          e.preventDefault()
          void ctx.act('workers', {
            townId: ctx.town.id,
            screen: kind,
            slot: islandId,
            ...(isWood ? { resourceWorkers: assigned } : { tradegoodWorkers: assigned }),
          })
        }}
      >
        <div id="setWorkersBox" className="contentBox">
          <h3 className="header">
            <span className="textLabel">{t('assign_workers')}</span>
          </h3>
          <div className="content">
            <ul>
              <li className="citizens">
                <span className="textLabel">{t('peoples')}: </span>
                <span className="value" id="valueCitizens">
                  {num(available - assigned)}
                </span>
              </li>
              <li className="workers">
                <span className="textLabel">{t('workers')}: </span>
                <span className="value" id="valueWorkers">
                  {num(assigned)}
                </span>
              </li>
              <li className="gain" title={`${t('production')}: ${currentRate}`}>
                <span className="textLabel">{t('capacity')}: </span>
                <div id="gainPoints">
                  <div id="resiconcontainer">
                    <img
                      id="resicon"
                      src={`/skin/resources/icon_${iconName}.gif`}
                      width={25}
                      height={20}
                      alt=""
                    />
                  </div>
                </div>
                <div className="gainPerHour">
                  <span id="valueResource">+{num(projectedRate)}</span>{' '}
                  <span className="timeUnit">{t('per_hour')}</span>
                </div>
              </li>
              <li className="costs">
                <span className="textLabel">{t('income_town')}: </span>
                <span id="valueWorkCosts" className="negative">
                  {Math.floor(ctx.townDerived.saldo) - 3 * (assigned - assignedNow)}
                </span>
                <img src="/skin/resources/icon_gold.gif" title={t('gold')} alt={t('gold')} />
                <span className="timeUnit"> {t('per_hour')}</span>
              </li>
            </ul>

            <div id="overchargeMsg" className="status nooc ocready oced">
              {t('overloaded')}
            </div>
            <Slider value={assigned} max={max} onChange={setAssigned} overcharge />

            <a
              className="setMin"
              href="#reset"
              onClick={(e) => {
                e.preventDefault()
                setAssigned(0)
              }}
            >
              <span className="textLabel">{t('min')}</span>
            </a>
            <a
              className="setMax"
              href="#max"
              onClick={(e) => {
                e.preventDefault()
                setAssigned(cap)
              }}
            >
              <span className="textLabel">{t('max')}</span>
            </a>
            <input
              name={isWood ? 'rw' : 'tw'}
              id="inputWorkers"
              className="textfield"
              maxLength={4}
              autoComplete="off"
              value={assigned}
              onChange={(e) => setAssigned(Math.min(max, Number(e.target.value) || 0))}
            />
            <input
              id="inputWorkersSubmit"
              className={assigned === assignedNow ? 'button' : 'buttonChanged'}
              type="submit"
              value={t('confirm')}
            />
            {ctx.failure && <p className="error">{t(ctx.failure)}</p>}
          </div>
          <div className="footer" />
        </div>
      </form>

      <div id="resourceUsers" className="contentBox">
        <h3 className="header">
          <span className="textLabel">{t('other_players_island')}</span>
        </h3>
        <div className="content">
          <table cellPadding={0} cellSpacing={0}>
            <thead>
              <tr>
                <th>{t('player')}</th>
                <th>{t('city')}</th>
                <th>{t('level')}</th>
                <th>{t('workers')}</th>
                <th>{t('donated')}</th>
                <th>{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {(detail.data?.slots ?? [])
                .filter((s) => s.town)
                .map((s) => {
                  const town = s.town!
                  const mine = town.userId === ctx.state.user.id
                  return (
                    <tr key={s.slot} className={mine ? 'alt own avatar' : 'alt avatar'}>
                      <td className="ownerName">{town.owner}</td>
                      <td className="cityName">{town.name}</td>
                      <td className="cityLevel">
                        {t('level')} {town.level}
                      </td>
                      {/* Every row carries its own figures (resource.php:106-107)
                          -- the viewer's numbers belong to the viewer's row
                          alone, never to their other towns. */}
                      <td className="cityWorkers">
                        {num(isWood ? town.workers : town.tradegood)} {t('workers')}
                      </td>
                      <td className="ownerDonation">
                        {num(isWood ? town.workersWood : town.tradegoodWood)}{' '}
                        <img
                          src="/skin/resources/icon_wood.gif"
                          width={25}
                          height={20}
                          alt={t('wood')}
                        />
                      </td>
                      <td className="actions">
                        {!mine && (
                          <a
                            href={hashFor('sendIKMessage', town.userId, encodeURIComponent(town.owner))}
                            onClick={(e) => {
                              e.preventDefault()
                              ctx.navigate(
                                hashFor(
                                  'sendIKMessage',
                                  town.userId,
                                  encodeURIComponent(town.owner),
                                ),
                              )
                            }}
                          >
                            <img
                              src="/skin/interface/icon_message_write.gif"
                              alt={t('create_message')}
                            />
                          </a>
                        )}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
        <div className="footer" />
      </div>
    </div>
  )
}

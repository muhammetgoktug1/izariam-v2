/**
 * The remaining screens: the garrison summary, plundering, trade routes,
 * account options and the four premium pages.
 *
 * izariam/views/view/{cityMilitary,plunder,tradeAdvisorTradeRoute,options,
 * options_deletion_confirm,premium,premiumDetails,premiumPayment,
 * premiumTradeAdvisor}.php.
 */

import {
  AMBROSIA_PER_EXTRA_ROUTE,
  PREMIUM_COST,
  PREMIUM_DURATION,
  RESOURCE_BY_TRADE_RESOURCE,
} from '@izariam/rules'
import { useState } from 'react'

import { armyClass, armyName } from '../lib/buildings.js'
import { formatTime } from '../lib/format.js'
import { num, t, tf } from '../lib/i18n.js'
import { hashFor } from '../lib/routes.js'
import type { Screen, ScreenContext } from './context.js'

// ---------------------------------------------------------------------------
// cityMilitary
// ---------------------------------------------------------------------------

/** The tab shows units 1..14 or ships 16..23, seven columns at a time. */
const ARMY_TABS = {
  army: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  fleet: [16, 17, 18, 19, 20, 21, 22, 23],
} as const

/**
 * cityMilitary.php -- what is standing in this town, as a wide icon table.
 *
 * The legacy splits each tab into rows of seven and gates every column behind
 * the same research nodes the barracks uses, so a unit you cannot build has no
 * column even when you own some -- captured ones, in a game that has no
 * capture. Simpler here: a column per unit the town actually holds, which is
 * the same set in every reachable state.
 */
export const CityMilitaryScreen: Screen = ({ ctx, sideboxes }) => {
  const tab = (ctx.route.raw[0] === 'fleet' ? 'fleet' : 'army') as keyof typeof ARMY_TABS
  const ids = ARMY_TABS[tab].filter((id) => (ctx.town.army[id] ?? 0) > 0)

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <div className="buildingDescription">
          <h1>{t('army_in_city')}</h1>
          <p>{t('inspect_troops')}</p>
        </div>
        <div className="militaryAdvisorTabs">
          <table cellPadding={0} cellSpacing={0} id="tabz">
            <tbody>
              <tr>
                {(['army', 'fleet'] as const).map((name) => (
                  <td key={name} className={tab === name ? 'selected' : undefined}>
                    <a
                      title={t(name === 'army' ? 'units' : 'ships')}
                      href={`#/cityMilitary/${name}`}
                      onClick={(e) => {
                        e.preventDefault()
                        ctx.navigate(`#/cityMilitary/${name}`)
                      }}
                    >
                      <em>{t(name === 'army' ? 'units' : 'ships')}</em>
                    </a>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <div className="yui-navset yui-navset-top" id="demo">
          <div className="yui-content">
            <div id="tab1" style={{ display: 'block' }}>
              <div className="contentBox01h">
                <h3 className="header">
                  <span className="textLabel">{t('garisson')}</span>
                </h3>
                <div className="content">
                  {ids.length === 0 ? (
                    <p>{t('no_units')}</p>
                  ) : (
                    <table cellPadding={0} cellSpacing={0}>
                      <tbody>
                        <tr>
                          {ids.map((id) => (
                            <th key={id} title={armyName(id)}>
                              {/* The two sprite sets are not laid out alike:
                                  land is `military/x60_y60/y60_{class}` and
                                  fleet is `fleet/60x60/{class}` -- the class
                                  already carries the `ship_` prefix
                                  (cityMilitary.php:28 vs :94). */}
                              <img
                                src={
                                  tab === 'army'
                                    ? `/skin/characters/military/x60_y60/y60_${armyClass(id)}_faceright.gif`
                                    : `/skin/characters/fleet/60x60/${armyClass(id)}_faceright.gif`
                                }
                                alt={armyName(id)}
                                title={armyName(id)}
                              />
                            </th>
                          ))}
                        </tr>
                        <tr className="count">
                          {ids.map((id) => (
                            <td key={id}>{num(ctx.town.army[id] ?? 0)}</td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="footer" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// plunder
// ---------------------------------------------------------------------------

/**
 * plunder.php -- 392 lines of a form that has never had anything behind it.
 *
 * There is no `actions/plunder` handler, no combat resolution, and the unit
 * stats the form displays (`defence`, `health`) are read by nothing in the
 * codebase. The screen is reachable from the island board, so it is rendered;
 * the button is not, because there is nothing for it to post to.
 */
export const PlunderScreen: Screen = ({ ctx, sideboxes }) => (
  <>
    {sideboxes}
    <div id="mainview">
      <div className="buildingDescription">
        <h1>{t('pillage')}</h1>
        <p>{t('plunder_unavailable')}</p>
      </div>
      <div className="contentBox01h">
        <h3 className="header">
          <span className="textLabel">{t('garisson')}</span>
        </h3>
        <div className="content">
          <table cellPadding={0} cellSpacing={0} className="table01">
            <tbody>
              <tr>
                <th>{t('units')}</th>
                <th>{t('available')}</th>
              </tr>
              {ARMY_TABS.army
                .filter((id) => (ctx.town.army[id] ?? 0) > 0)
                .map((id, i) => (
                  <tr key={id} className={i % 2 === 1 ? 'alt' : undefined}>
                    <td>{armyName(id)}</td>
                    <td>{num(ctx.town.army[id] ?? 0)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="footer" />
      </div>
    </div>
  </>
)

// ---------------------------------------------------------------------------
// tradeAdvisorTradeRoute
// ---------------------------------------------------------------------------

/**
 * tradeAdvisorTradeRoute.php -- standing orders that fire once a day.
 *
 * The first route is free; every one after it costs 10 ambrosia
 * (AMBROSIA_PER_EXTRA_ROUTE). The hour is stored as an hour-of-day and
 * resolved against the deployment's timezone, which nothing in the legacy
 * config ever set -- so it was whatever the host's PHP defaulted to. The
 * browser's offset is sent instead, which is at least a defined value.
 *
 * The legacy renders one whole form per existing route with its own "save
 * changes" submit (tradeAdvisorTradeRoute.php:52-110) plus an empty one for a
 * new route; here the single form doubles as the editor, which is why the rows
 * carry an Edit link. Without it `tradeRoute/edit` had no caller at all and a
 * route could only be deleted and recreated -- at 10 ambrosia a time.
 */
export const TradeRouteScreen: Screen = ({ ctx, sideboxes }) => {
  const towns = ctx.state.towns
  const [editingId, setEditingId] = useState<number | null>(null)
  const [fromTownId, setFrom] = useState(ctx.town.id)
  const [toTownId, setTo] = useState(towns.find((x) => x.id !== ctx.town.id)?.id ?? ctx.town.id)
  const [tradegood, setTradegood] = useState(0)
  const [hour, setHour] = useState(12)
  const [count, setCount] = useState(0)

  const timezoneOffset = -new Date().getTimezoneOffset() * 60

  /** Resource name -> the 0..4 index the API takes. */
  const tradegoodOf = (resource: string) =>
    Number(
      Object.entries(RESOURCE_BY_TRADE_RESOURCE).find(([, name]) => name === resource)?.[0] ?? 0,
    )

  const edit = (route: (typeof ctx.state.tradeRoutes)[number]) => {
    setEditingId(route.id)
    setFrom(route.fromTownId ?? ctx.town.id)
    setTo(route.toTownId ?? ctx.town.id)
    setTradegood(tradegoodOf(route.resource))
    setHour(route.sendTime)
    setCount(route.sendCount)
  }

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <div className="buildingDescription">
          <h1>{t('trade_routes')}</h1>
          <p>{t('trade_routes_text')}</p>
        </div>

        <div className="contentBox01h">
          <h3 className="header">
            <span className="textLabel">{t('trade_routes')}</span>
          </h3>
          <div className="content">
            <table cellPadding={0} cellSpacing={0} className="table01">
              <tbody>
                <tr>
                  <th>{t('origin')}</th>
                  <th>{t('target')}</th>
                  <th>{t('resource')}</th>
                  <th>{t('amount')}</th>
                  <th>{t('time')}</th>
                  <th>{t('actions')}</th>
                </tr>
                {ctx.state.tradeRoutes.map((route, i) => (
                  <tr key={route.id} className={i % 2 === 1 ? 'alt' : undefined}>
                    <td>{towns.find((x) => x.id === route.fromTownId)?.name ?? '-'}</td>
                    <td>{towns.find((x) => x.id === route.toTownId)?.name ?? '-'}</td>
                    <td>{t(route.resource)}</td>
                    <td>{num(route.sendCount)}</td>
                    <td>{new Date(route.nextRunAt * 1000).toLocaleString()}</td>
                    <td>
                      <a
                        href="#edit"
                        onClick={(e) => {
                          e.preventDefault()
                          edit(route)
                        }}
                      >
                        {t('edit')}
                      </a>{' '}
                      <a
                        href="#delete"
                        onClick={(e) => {
                          e.preventDefault()
                          if (editingId === route.id) setEditingId(null)
                          void ctx.act('tradeRoute/delete', { deleteId: route.id })
                        }}
                      >
                        {t('delete')}
                      </a>
                    </td>
                  </tr>
                ))}
                {ctx.state.tradeRoutes.length === 0 && (
                  <tr>
                    <td colSpan={6}>{t('no_trade_routes')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="footer" />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            const body = { fromTownId, toTownId, tradegood, hour, count, timezoneOffset }
            void ctx
              .act(
                editingId ? 'tradeRoute/edit' : 'tradeRoute/create',
                editingId ? { ...body, routeId: editingId } : body,
              )
              .then(() => setEditingId(null))
          }}
        >
          <div className="contentBox01h">
            <h3 className="header">
              <span className="textLabel">
                {editingId ? t('edit_trade_routes') : t('new_trade_route')}
              </span>
            </h3>
            <div className="content">
              {/* Editing an existing route is free; only a new one past the
                  first costs ambrosia. */}
              <p>
                {t('cost')}:{' '}
                {editingId || ctx.state.tradeRoutes.length === 0 ? 0 : AMBROSIA_PER_EXTRA_ROUTE}{' '}
                <img src="/skin/premium/ambrosia_icon.gif" alt="" />
              </p>
              <label>
                {t('origin')}:{' '}
                <select value={fromTownId} onChange={(e) => setFrom(Number(e.target.value))}>
                  {towns.map((town) => (
                    <option key={town.id} value={town.id}>
                      {town.name}
                    </option>
                  ))}
                </select>
              </label>{' '}
              <label>
                {t('target')}:{' '}
                <select value={toTownId} onChange={(e) => setTo(Number(e.target.value))}>
                  {towns.map((town) => (
                    <option key={town.id} value={town.id}>
                      {town.name}
                    </option>
                  ))}
                </select>
              </label>{' '}
              <label>
                {t('resource')}:{' '}
                <select value={tradegood} onChange={(e) => setTradegood(Number(e.target.value))}>
                  {Object.entries(RESOURCE_BY_TRADE_RESOURCE).map(([id, name]) => (
                    <option key={id} value={id}>
                      {t(name)}
                    </option>
                  ))}
                </select>
              </label>{' '}
              <label>
                {t('amount')}:{' '}
                <input
                  type="text"
                  size={6}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value) || 0)}
                />
              </label>{' '}
              <label>
                {t('time')}:{' '}
                <select value={hour} onChange={(e) => setHour(Number(e.target.value))}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
              </label>
              <div className="centerButton">
                <input
                  type="submit"
                  className="button"
                  value={editingId ? t('save_changes') : t('create')}
                />
                {editingId != null && (
                  <a
                    href="#cancel"
                    onClick={(e) => {
                      e.preventDefault()
                      setEditingId(null)
                    }}
                  >
                    {t('cancel')}
                  </a>
                )}
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

// ---------------------------------------------------------------------------
// options
// ---------------------------------------------------------------------------

/**
 * options.php -- four tabs: the account, the password, the username and
 * deletion. The fourth posts to a controller that does not exist, so the
 * deletion tab links to the confirmation page and stops there, as it did.
 */
export const OptionsScreen: Screen = ({ ctx, sideboxes }) => {
  const [mode, setMode] = useState(ctx.state.user.options.citySelect)
  const [login, setLogin] = useState(ctx.state.user.login)
  const [oldPassword, setOld] = useState('')
  const [newPassword, setNew] = useState('')
  const [confirmPassword, setConfirm] = useState('')

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <div className="buildingDescription">
          <h1>{t('options')}</h1>
        </div>

        <div className="contentBox01h">
          <h3 className="header">
            <span className="textLabel">{t('settings')}</span>
          </h3>
          <div className="content">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void ctx.act('setCitySelectMode', { mode })
              }}
            >
              <label>
                {t('city_select')}:{' '}
                <select value={mode} onChange={(e) => setMode(Number(e.target.value))}>
                  <option value={0}>{t('city_select_0')}</option>
                  <option value={1}>{t('city_select_1')}</option>
                  <option value={2}>{t('city_select_2')}</option>
                </select>
              </label>
              <div className="centerButton">
                <input type="submit" className="button" value={t('confirm')} />
              </div>
            </form>

            <hr />

            <form
              onSubmit={(e) => {
                e.preventDefault()
                void ctx.act('renameLogin', { login })
              }}
            >
              <label>
                {t('username')}:{' '}
                <input value={login} onChange={(e) => setLogin(e.target.value)} maxLength={30} />
              </label>
              <div className="centerButton">
                <input type="submit" className="button" value={t('confirm')} />
              </div>
            </form>

            <hr />

            <form
              onSubmit={(e) => {
                e.preventDefault()
                void ctx
                  .act('changePassword', { oldPassword, newPassword, confirmPassword })
                  .then(() => {
                    setOld('')
                    setNew('')
                    setConfirm('')
                  })
              }}
            >
              <label>
                {t('old_password')}:{' '}
                <input
                  type="password"
                  autoComplete="current-password"
                  value={oldPassword}
                  onChange={(e) => setOld(e.target.value)}
                />
              </label>
              <br />
              <label>
                {t('new_password')}:{' '}
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNew(e.target.value)}
                />
              </label>
              <br />
              <label>
                {t('repeat_password')}:{' '}
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
              <div className="centerButton">
                <input type="submit" className="button" value={t('confirm')} />
              </div>
            </form>

            <hr />

            <div className="centerButton">
              <a
                className="button"
                href={hashFor('options_deletion_confirm')}
                onClick={(e) => {
                  e.preventDefault()
                  ctx.navigate(hashFor('options_deletion_confirm'))
                }}
              >
                {t('delete_account')}
              </a>
            </div>

            {ctx.failure && <p className="error">{t(ctx.failure)}</p>}
          </div>
          <div className="footer" />
        </div>
      </div>
    </>
  )
}

/**
 * options_deletion_confirm.php. The confirm button posts to
 * `game/options_umod_confirm`, which has no controller -- account deletion was
 * never implemented. Rendered without a live button.
 */
export const DeletionConfirmScreen: Screen = ({ sideboxes }) => (
  <>
    {sideboxes}
    <div id="mainview">
      <div className="buildingDescription">
        <h1>{t('settings')}</h1>
      </div>
      <div className="contentBox01h">
        <h3 className="header">
          <span className="textLabel">{t('delete_account')}</span>
        </h3>
        <div className="content">
          <p>{t('delete_account_text')}</p>
          <p>{t('delete_account_unavailable')}</p>
        </div>
        <div className="footer" />
      </div>
    </div>
  </>
)

// ---------------------------------------------------------------------------
// premium
// ---------------------------------------------------------------------------

/**
 * The seven boosts, in the order premium.php lists them, each with the `<tr>`
 * class the skin keys its artwork off.
 *
 * Those class names are the whole reason the page has pictures: the legacy
 * template contains exactly one `<img>` per row (the ambrosia icon) and paints
 * everything else through CSS, `#premium #premiumOffers tr.woodbonus
 * td.feature{background-image:url(premium/b_premium_wood.jpg)}`
 * (ik_premium_0.4.5.css:48-60). Render a plain `table01` and not one of those
 * rules matches, which is what left the page bare.
 *
 * `savecapacityBonus` really is spelled with a lower-case "save" and a capital
 * "B" in the stylesheet.
 */
const BOOSTS = [
  { type: 'account', row: 'account' },
  { type: 'wood', row: 'woodbonus' },
  { type: 'marble', row: 'marblebonus' },
  { type: 'sulfur', row: 'sulfurbonus' },
  { type: 'crystal', row: 'crystalbonus' },
  { type: 'wine', row: 'winebonus' },
  { type: 'capacity', row: 'savecapacityBonus' },
] as const

/**
 * premium.php -- buy a boost with ambrosia. Each lasts a week; the rules stamp
 * an expiry and the tick reads it, so buying twice extends rather than stacks.
 *
 * Two rows per boost, as the legacy: the offer, then a full-width cell saying
 * whether it is running. The price comes from the rules' own `PREMIUM_COST` --
 * the same table `buyPremium` charges from. It used to come from
 * `premiumCost()`, which reads a curve the extractor filled with nulls, so
 * every row advertised 0 ambrosia while the purchase took 10.
 */
export const PremiumScreen: Screen = ({ ctx, sideboxes }) => (
  <>
    {sideboxes}
    <div id="mainview">
      <div className="buildingDescription">
        <h1>{t('izariam_plus')}</h1>
        <p>{t('premium_intro')}</p>
      </div>
      <div className="contentBox01h" id="premiumOffers">
        <h3 className="header">
          <span className="textLabel">{t('izariam_plus')}</span>
        </h3>
        <div className="content">
          <p>
            {t('ambrosy')}: {num(ctx.state.user.ambrosia)}{' '}
            <img
              src="/skin/premium/ambrosia_icon.gif"
              width={24}
              height={20}
              alt={t('ambrosy')}
            />
          </p>
          <table cellPadding={0} cellSpacing={0} className="TableHoriMax">
            <tbody>
              <tr>
                <th className="feature">{t('premium')}</th>
                <th className="duration">{t('duration')}</th>
                <th className="cost">{t('cost')}</th>
                <th className="buy">&nbsp;</th>
              </tr>
              {BOOSTS.map(({ type, row }) => (
                <BoostRows key={type} ctx={ctx} type={type} row={row} />
              ))}
            </tbody>
          </table>
          {ctx.failure && <p className="error">{t(ctx.failure)}</p>}
        </div>
        <div className="footer" />
      </div>
    </div>
  </>
)

/** The offer row and its status row -- `rowspan={2}` ties them together, which
 *  is how the legacy gets one tall artwork cell beside two lines of text. */
function BoostRows({
  ctx,
  type,
  row,
}: {
  ctx: ScreenContext
  type: string
  row: string
}) {
  const cost = PREMIUM_COST[type] ?? 0
  const until = ctx.state.user.premium[type as keyof typeof ctx.state.user.premium]
  const active = (until ?? 0) > ctx.now
  const affordable = ctx.state.user.ambrosia >= cost

  return (
    <>
      <tr className={row}>
        <td className="feature" rowSpan={2}>
          <h4>{t(`premium_${type}`)}</h4>
          <p>{t(`premium_${type}_desc`)}</p>
        </td>
        <td className="duration">{tf('premium_duration_days', PREMIUM_DURATION / 86400)}</td>
        <td className="cost">
          {cost}{' '}
          <img src="/skin/premium/ambrosia_icon.gif" width={24} height={20} alt={t('ambrosy')} />
        </td>
        <td className="buy" rowSpan={2}>
          {affordable ? (
            <div className="centerButton">
              <a
                href="#buy"
                className="button"
                title={t('premium_buy')}
                onClick={(e) => {
                  e.preventDefault()
                  void ctx.act('buyPremium', { type })
                }}
              >
                {t('premium_buy')}
              </a>
            </div>
          ) : (
            /* premium.php:27 -- short of ambrosia, the cell becomes a link to
               the payment page instead of a buy button. */
            <a
              className="notenough"
              href={hashFor('premiumPayment')}
              onClick={(e) => {
                e.preventDefault()
                ctx.navigate(hashFor('premiumPayment'))
              }}
            >
              {tf('premium_missing', cost - Math.floor(ctx.state.user.ambrosia))}
              <br />
              <span className="buyNow">{t('acquire_now')}</span>
            </a>
          )}
        </td>
      </tr>
      <tr>
        {active && until != null ? (
          <td className="active" colSpan={3}>
            {tf('premium_remaining', formatTime(Math.max(0, until - ctx.now)))}
          </td>
        ) : (
          <td className="inactive" colSpan={3}>
            {t('not_active')}
          </td>
        )}
      </tr>
    </>
  )
}

/** premiumDetails.php -- the sales pitch behind every "look now" teaser. */
export const PremiumDetailsScreen: Screen = ({ ctx, sideboxes }) => (
  <>
    {sideboxes}
    <div id="mainview">
      <div className="buildingDescription">
        <h1>{t('izariam_plus')}</h1>
        <p>{t('premium_turn')}</p>
      </div>
      <div className="contentBox01h">
        <div className="content">
          <div className="centerButton">
            <a
              className="button"
              href={hashFor('premium')}
              onClick={(e) => {
                e.preventDefault()
                ctx.navigate(hashFor('premium'))
              }}
            >
              {t('izariam_plus')}
            </a>
          </div>
        </div>
        <div className="footer" />
      </div>
    </div>
  </>
)

/**
 * premiumPayment.php -- 23 lines pointing at a payment provider that was never
 * wired up. Ambrosia is granted at registration and never sold.
 */
export const PremiumPaymentScreen: Screen = ({ sideboxes }) => (
  <>
    {sideboxes}
    <div id="mainview">
      <div className="buildingDescription">
        <h1>{t('izariam_plus')}</h1>
      </div>
      <div className="contentBox01h">
        <div className="content">
          <p>{t('premium_payment_unavailable')}</p>
        </div>
        <div className="footer" />
      </div>
    </div>
  </>
)

/**
 * premiumTradeAdvisor.php -- the premium builder's overview: every town's
 * build queue on one page. 529 lines in the legacy, almost all of it the same
 * row repeated per town.
 */
export const PremiumTradeAdvisorScreen: Screen = ({ ctx, sideboxes }) => (
  <>
    {sideboxes}
    <div id="mainview">
      <div className="buildingDescription">
        <h1>{t('constructions_review')}</h1>
      </div>
      <div className="contentBox01h">
        <h3 className="header">
          <span className="textLabel">{t('buildings_construction_list')}</span>
        </h3>
        <div className="content">
          <table cellPadding={0} cellSpacing={0} className="table01">
            <tbody>
              <tr>
                <th>{t('city')}</th>
                <th>{t('buildings')}</th>
                <th>{t('position')}</th>
              </tr>
              {ctx.state.towns.flatMap((town) =>
                town.buildQueue.length === 0
                  ? [
                      <tr key={town.id}>
                        <td>{town.name}</td>
                        <td colSpan={2}>-</td>
                      </tr>,
                    ]
                  : town.buildQueue.map((entry, i) => (
                      <tr key={`${town.id}-${i}`} className={i % 2 === 1 ? 'alt' : undefined}>
                        <td>{i === 0 ? town.name : ''}</td>
                        <td>{t(`building${entry.type}_name`)}</td>
                        <td>{entry.slot}</td>
                      </tr>
                    )),
              )}
            </tbody>
          </table>
        </div>
        <div className="footer" />
      </div>
    </div>
  </>
)

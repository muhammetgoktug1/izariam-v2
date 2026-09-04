/**
 * The four trade screens: the branch office, accepting someone else's offer,
 * shipping goods, and founding a colony.
 *
 * izariam/views/view/{branchOffice,takeOffer,transport,colonize}.php.
 *
 * The branch office's five rows are the same markup five times over, with
 * field names that do not match the resources they carry: wood is `resource`,
 * and the other four are `tradegood1`..`tradegood4` regardless of which good
 * the island actually yields. The API takes them by name instead.
 *
 * "Reserved gold" is the money tied up in *buy* offers -- count times price,
 * summed over the rows set to buy. Sell offers reserve stock, not gold, and
 * the warehouse figure the branch office quotes therefore adds the shelf back
 * on (branchOffice.php:233).
 */

import {
  RELOCATE_AMBROSIA_COST,
  RESOURCES,
  branchCapacityByLevel,
  levelsByType,
  timeByCoords,
  unitCost,
  type Resource,
} from '@izariam/rules'
import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

import { BuildingHeader } from '../components/building/BuildingHeader.js'
import { Slider } from '../components/Slider.js'
import { api } from '../lib/api.js'
import { formatTime } from '../lib/format.js'
import { num, t } from '../lib/i18n.js'
import { hashFor } from '../lib/routes.js'
import type { Screen } from './context.js'

/** Resource -> icon file. Crystal's icon is called glass. */
const ICON: Record<Resource, string> = {
  wood: 'wood',
  wine: 'wine',
  marble: 'marble',
  crystal: 'glass',
  sulfur: 'sulfur',
}

interface OfferRow {
  direction: number
  count: number
  price: number
}

/** branchOffice.php -- the shelf, and a search for other people's shelves. */
export const BranchOfficeScreen: Screen = ({ ctx, sideboxes }) => {
  const position = ctx.route.params[0]
  const office = ctx.town.branchOffice
  const level = levelsByType(ctx.town)[12] ?? 0
  const capacity = branchCapacityByLevel(level)

  const [rows, setRows] = useState<Record<Resource, OfferRow>>(() =>
    Object.fromEntries(
      RESOURCES.map((r) => [
        r,
        {
          direction: office?.offers[r].direction ?? 0,
          count: office?.offers[r].count ?? 0,
          price: office?.offers[r].price ?? 0,
        },
      ]),
    ) as Record<Resource, OfferRow>,
  )

  const set = (r: Resource, patch: Partial<OfferRow>) =>
    setRows((rs) => ({ ...rs, [r]: { ...rs[r], ...patch } }))

  const reserved = RESOURCES.reduce(
    (n, r) => (rows[r].direction === 0 ? n + rows[r].count * rows[r].price : n),
    0,
  )
  const onSale = RESOURCES.reduce(
    (n, r) => (rows[r].direction === 1 ? n + rows[r].count : n),
    0,
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
            <span className="textLabel">{t('capacity')}</span>
          </h3>
          <div className="content">
            <p>
              {num(onSale)} / {num(capacity)}
            </p>
          </div>
          <div className="footer" />
        </div>

        <form
          name="formkontor"
          onSubmit={(e) => {
            e.preventDefault()
            void ctx.act('branchOffice', { townId: ctx.town.id, offers: rows })
          }}
        >
          <div className="contentBox01h">
            <h3 className="header">
              <span className="textLabel">{t('own_offers')}</span>
            </h3>
            <div className="content">
              <table cellPadding={0} cellSpacing={0} border={0} className="tablekontor">
                <tbody>
                  <tr>
                    <th colSpan={2}>{t('type_offer')}</th>
                    <th>{t('amount')}</th>
                    <th>{t('price')}</th>
                  </tr>
                  {RESOURCES.map((r, i) => (
                    <tr key={r} className={i % 2 === 1 ? 'alt' : undefined}>
                      <td className="icon">
                        <img src={`/skin/resources/icon_${ICON[r]}.gif`} alt={t(r)} title={t(r)} />
                      </td>
                      <td className="select">
                        <select
                          value={rows[r].direction}
                          onChange={(e) => set(r, { direction: Number(e.target.value) })}
                        >
                          <option value={0}>{t('own_buy')}</option>
                          <option value={1}>{t('own_sell')}</option>
                        </select>
                      </td>
                      <td>
                        <input
                          type="text"
                          size={4}
                          value={rows[r].count}
                          onChange={(e) => set(r, { count: Number(e.target.value) || 0 })}
                        />
                      </td>
                      <td>
                        {/* maxlength 2 in the original, so no offer above 99
                            gold a unit could ever be typed. */}
                        <input
                          type="text"
                          size={2}
                          maxLength={2}
                          value={rows[r].price}
                          onChange={(e) => set(r, { price: Number(e.target.value) || 0 })}
                        />
                        <img src="/skin/resources/icon_gold.gif" alt="" /> {t('per_piece')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div>
                <p>
                  {t('reserved_gold')}: <span id="reservedGold">{Math.floor(reserved)}</span>{' '}
                  <img src="/skin/resources/icon_gold.gif" alt="" />
                </p>
                <input type="submit" className="button" value={t('update_offers')} />
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

/**
 * takeOffer.php -- buy from or sell into somebody else's branch office.
 *
 * `type` decides the direction: 1 buys from their sell offers, 0 sells into
 * their buy offers. The price the fleet carries is a *tolerance*, checked
 * again when it lands, so an offer withdrawn mid-voyage simply is not filled.
 */
export const TakeOfferScreen: Screen = ({ ctx, sideboxes }) => {
  const [targetTownId, type] = ctx.route.params
  const shop = useQuery({
    queryKey: ['branch-office', targetTownId],
    queryFn: () => api.branchOffice(targetTownId),
  })

  const [counts, setCounts] = useState<Partial<Record<Resource, number>>>({})
  const [transporters, setTransporters] = useState(1)

  const offers = (shop.data?.offers ?? []).filter((o) => o.direction === type)
  const prices = Object.fromEntries(offers.map((o) => [o.resource, o.price]))

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <div className="buildingDescription">
          <h1>{t(type === 0 ? 'accept_rate' : 'accept_offer')}</h1>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void ctx.act('trade', {
              townId: ctx.town.id,
              targetTownId,
              type,
              counts,
              prices,
              transporters,
            })
          }}
        >
          <div className="contentBox01h">
            <h3 className="header">
              <span className="textLabel">{shop.data?.town.name ?? ''}</span>
            </h3>
            <div className="content">
              <table cellPadding={0} cellSpacing={0} className="tablekontor">
                <tbody>
                  <tr>
                    <th colSpan={2}>{t('resource')}</th>
                    <th>{t('amount')}</th>
                    <th>{t('price')}</th>
                  </tr>
                  {offers.map((o, i) => (
                    <tr key={o.resource} className={i % 2 === 1 ? 'alt' : undefined}>
                      <td className="icon">
                        <img
                          src={`/skin/resources/icon_${ICON[o.resource as Resource]}.gif`}
                          alt=""
                        />
                      </td>
                      <td>{t(o.resource)}</td>
                      <td>
                        <input
                          type="text"
                          size={6}
                          value={counts[o.resource as Resource] ?? 0}
                          onChange={(e) =>
                            setCounts((c) => ({
                              ...c,
                              [o.resource]: Math.min(o.count, Number(e.target.value) || 0),
                            }))
                          }
                        />{' '}
                        / {num(o.count)}
                      </td>
                      <td>
                        {num(o.price)} <img src="/skin/resources/icon_gold.gif" alt="" />{' '}
                        {t('per_piece')}
                      </td>
                    </tr>
                  ))}
                  {offers.length === 0 && (
                    <tr>
                      <td colSpan={4}>{t('no_offers')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div>
                <label htmlFor="transporters">{t('transporters')}: </label>
                <input
                  id="transporters"
                  type="text"
                  size={4}
                  value={transporters}
                  onChange={(e) => setTransporters(Number(e.target.value) || 0)}
                />{' '}
                / {num(ctx.state.user.transports)}
              </div>
              <div className="centerButton">
                <input type="submit" className="button" value={t('send')} />
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

/**
 * transport.php -- send goods to another town.
 *
 * `transport_capacity` is 500 per ship. The legacy neither floors nor clamps
 * the cargo (trade.ts:594) and collapses eight distinct rejections into one
 * `trade_fleet_no_freight`, so the totals here are the only feedback a player
 * gets before the server refuses.
 */
export const TransportScreen: Screen = ({ ctx, sideboxes }) => {
  const [islandId, targetTownId] = ctx.route.params
  const [cargo, setCargo] = useState<Partial<Record<Resource, number>>>({})
  const [transporters, setTransporters] = useState(1)

  const board = useQuery({ queryKey: ['island', islandId], queryFn: () => api.island(islandId) })
  const target = board.data?.slots.find((s) => s.town?.id === targetTownId)?.town

  const loaded = RESOURCES.reduce((n, r) => n + (cargo[r] ?? 0), 0)
  const capacity = transporters * 500

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <div className="buildingDescription">
          <h1>{t('transport')}</h1>
          <p>{t('transport_text')}</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void ctx.act('transport', {
              townId: ctx.town.id,
              islandId,
              targetTownId,
              cargo,
              transporters,
            })
          }}
        >
          <div className="contentBox01h" id="transport">
            <h3 className="header">
              <span className="textLabel">{target?.name ?? ''}</span>
            </h3>
            <div className="content">
              <table cellPadding={0} cellSpacing={0} className="tablekontor">
                <tbody>
                  {RESOURCES.map((r, i) => (
                    <tr key={r} className={i % 2 === 1 ? 'alt' : undefined}>
                      <td className="icon">
                        <img src={`/skin/resources/icon_${ICON[r]}.gif`} alt={t(r)} />
                      </td>
                      <td>{t(r)}</td>
                      <td>
                        <input
                          type="text"
                          size={6}
                          value={cargo[r] ?? 0}
                          onChange={(e) =>
                            setCargo((c) => ({ ...c, [r]: Number(e.target.value) || 0 }))
                          }
                        />{' '}
                        / {num(ctx.town.resources[r])}
                      </td>
                      <td>
                        <a
                          href="#max"
                          onClick={(e) => {
                            e.preventDefault()
                            setCargo((c) => ({ ...c, [r]: Math.floor(ctx.town.resources[r]) }))
                          }}
                        >
                          {t('max')}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="freight">
                <span className="textLabel">{t('freight')}: </span>
                {num(loaded)} / {num(capacity)}
              </div>
              <div>
                <label htmlFor="transporters">{t('transporters')}: </label>
                <input
                  id="transporters"
                  type="text"
                  size={4}
                  value={transporters}
                  onChange={(e) => setTransporters(Number(e.target.value) || 0)}
                />{' '}
                / {num(ctx.state.user.transports)}
              </div>
              <div className="centerButton">
                <input type="submit" className="button" value={t('send')} />
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

/** The cargo ship, unit 23 -- the speed the colony fleet sails at. */
const CARGO_SHIP = 23

/**
 * colonize.php -- found a colony on an empty island slot, or move an existing
 * town onto it.
 *
 * The fee is 1250 wood, 9000 gold, 40 citizens and one action point, on top of
 * whatever cargo is sent. Only `wood - 1000` is unloaded on arrival, so 1000
 * of the 1250 evaporates; aborting the fleet instead refunds all of it. That
 * asymmetry is the engine's, reproduced there and simply reported here.
 *
 * The five gate checks and the whole-form-when-passing structure are the
 * legacy's (colonize.php:76-92): the sliders, the summary and the submit only
 * exist once nothing blocks the founding.
 *
 * The ship count is transportController.js's: `ceil(load / 500)`, readonly.
 * The player never assigns ships to a colony run -- the fee (1,290) alone
 * books three of them. The journey time is mission_data.php's leg time for
 * the cargo ship between the two islands.
 *
 * The relocation box above the form is the legacy's `#moveCity`
 * (colonize.php:6-47): pick one of your towns, pay 200 ambrosia, and it lands
 * on this slot. Both submit to the same legacy URL, told apart by the presence
 * of the `action` field; here they are two endpoints.
 */
export const ColonizeScreen: Screen = ({ ctx, sideboxes }) => {
  const [islandId, slot] = ctx.route.params
  const [send, setSend] = useState<Partial<Record<Resource, number>>>({})
  const [moveTownId, setMoveTownId] = useState<number>(0)

  const board = useQuery({ queryKey: ['island', islandId], queryFn: () => api.island(islandId) })
  const island = board.data?.island
  const canAffordMove = ctx.state.user.ambrosia >= RELOCATE_AMBROSIA_COST

  /** The colony fee rides in the hold: 1,250 wood plus 40 settlers. */
  const fee = 1250 + 40
  const loaded = RESOURCES.reduce((n, r) => n + (send[r] ?? 0), 0)
  /** Free space across the *whole* fleet, which is what the sliders may fill
   *  (colonize.php:94-96 -- every transport the player owns, not just the
   *  ones this cargo ends up needing). */
  const freeCapacity = ctx.state.user.transports * 500 - fee

  const maxFor = (r: Resource) =>
    Math.max(
      0,
      Math.min(
        // Wood in the warehouse is 1,250 short: the fee comes out of it.
        Math.floor(ctx.town.resources[r]) - (r === 'wood' ? 1250 : 0),
        freeCapacity - (loaded - (send[r] ?? 0)),
      ),
    )

  const transports = Math.ceil((fee + loaded) / 500)

  const capital = ctx.state.towns.find((tw) => tw.id === ctx.state.user.capitalTownId)
  const palaceLevel = capital ? (levelsByType(capital)[10] ?? 0) : 0
  const errors: ReactNode[] = []
  if (ctx.town.peoples < 40)
    errors.push(
      <>
        {t('not_peoples_1')} <strong>{num(40 - ctx.town.peoples)} {t('not_peoples_2')}</strong>
        .<em>{t('not_peoples_3')}</em>
      </>,
    )
  if (ctx.state.user.gold < 9000)
    errors.push(
      <>
        {t('not_gold_1')} <strong>{num(9000 - ctx.state.user.gold)} {t('not_gold_2')}</strong>!
      </>,
    )
  if (ctx.town.resources.wood < 1250)
    errors.push(
      <>
        {t('not_wood_1')} <strong>{num(1250 - ctx.town.resources.wood)} {t('not_wood_2')}</strong>!
      </>,
    )
  if (ctx.state.user.transports < 3)
    errors.push(
      <>
        {t('not_tradeships_1')}{' '}
        <strong>{num(3 - ctx.state.user.transports)} {t('not_tradeships_2')}</strong>!
      </>,
    )
  if (ctx.state.towns.length - 1 >= palaceLevel)
    errors.push(
      <>
        {t('not_palace_1')} {ctx.state.towns.length - 1} {t('not_palace_2')} {palaceLevel}
        {t('not_palace_3')}
      </>,
    )

  /** Seconds at sea for the cargo ship, the figure the legacy put next to the
   *  destination in #missionSummary. */
  const travelTime = island
    ? timeByCoords(
        ctx.island.x,
        island.x,
        ctx.island.y,
        island.y,
        unitCost(CARGO_SHIP, ctx.state.user.research, levelsByType(ctx.town)).speed,
      )
    : 0

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <div className="buildingDescription">
          <h1>{t('mission_1')}</h1>
          <p>{t('colonize_text')}</p>
        </div>

        <div id="moveCity" className="contentBox01h" style={{ zIndex: 55 }}>
          <h3 className="header">
            {t('move_town_to')} {island?.name ?? ''}
          </h3>
          <div className="content" id="relatedCities">
            <p>{t('move_town_text')}</p>
            <div style={{ padding: '5px 10px 10px 10px' }}>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!moveTownId) return
                  void ctx
                    .act('colonize/relocate', { townId: moveTownId, islandId, slot })
                    .then(() => ctx.navigate(hashFor('island', islandId)))
                }}
              >
                <div style={{ height: 100 }}>
                  <img src="/skin/premium/movecity.jpg" style={{ float: 'left' }} alt="" />
                  <table className="cityMoveCitySelectionTable">
                    <tbody>
                      <tr>
                        <td style={{ width: 250 }}>
                          <select
                            id="moveCitySelect"
                            className="citySpecialSelect smallFont"
                            name="cityId"
                            value={moveTownId}
                            onChange={(e) => setMoveTownId(Number(e.target.value) || 0)}
                          >
                            <option value={0}>-- {t('choose_town')} --</option>
                            {ctx.state.towns.map((town) => {
                              const isl = ctx.state.islands[town.islandId]
                              return (
                                <option key={town.id} className="coords" value={town.id}>
                                  [{isl?.x}:{isl?.y}] {town.name}
                                </option>
                              )
                            })}
                          </select>
                        </td>
                        <td>
                          {RELOCATE_AMBROSIA_COST}
                          <img
                            height={20}
                            width={24}
                            src="/skin/premium/ambrosia_icon.gif"
                            title={t('ambrosy')}
                            alt={t('ambrosy')}
                          />
                        </td>
                        <td style={{ paddingBottom: 10 }}>
                          {canAffordMove ? (
                            <div className="centerButton">
                              <input type="submit" className="button" value={t('move')} />
                            </div>
                          ) : (
                            <a
                              className="notenough"
                              href={hashFor('premium')}
                              onClick={(e) => {
                                e.preventDefault()
                                ctx.navigate(hashFor('premium'))
                              }}
                            >
                              {RELOCATE_AMBROSIA_COST} {t('ambrosy_missing')}
                              <br />
                              <span className="buyNow">{t('acquire_now')}</span>
                            </a>
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </form>
            </div>
          </div>
          <div className="footer" />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void ctx
              .act('colonize/found', {
                townId: ctx.town.id,
                islandId,
                slot,
                send,
                transports,
              })
              .then(() => ctx.navigate(hashFor('island', islandId)))
          }}
        >
          <div id="createColony" className="contentBox01h" style={{ zIndex: 50 }}>
            <h3 className="header">
              <span className="textLabel">
                {t('found_colony')} {island?.name ?? ''}
              </span>
            </h3>
            <div className="content">
              <p>{t('found_colony_text')}</p>
              <div className="costs">
                <img src="/skin/img/colony_build.jpg" alt="" />
                <p>{t('colony_need')}:</p>
                <ul className="resources">
                  <li className="citizens">
                    <span className="textLabel">{t('peoples')}: </span>40
                  </li>
                  <li className="gold">
                    <span className="textLabel">{t('gold')}: </span>{num(9000)}
                  </li>
                  <li className="wood">
                    <span className="textLabel">{t('wood')}: </span>{num(1250)}
                  </li>
                </ul>
              </div>

              {errors.length > 0 ? (
                <div className="errors">
                  <h4>{t('colony_error')}</h4>
                  <ul>
                    {errors.map((error, i) => (
                      <li key={i}>
                        <span>{error}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <>
                  <p>{t('more_resources')}</p>
                  <ul className="resourceAssign">
                    {RESOURCES.map((r) => (
                      <li key={r} className={r === 'crystal' ? 'glass' : r}>
                        <label htmlFor={`textfield_${r}`}>
                          {t('send')} {t(r)}:
                        </label>
                        <div className="sliderinput">
                          <Slider
                            value={send[r] ?? 0}
                            max={maxFor(r)}
                            onChange={(v) => setSend((c) => ({ ...c, [r]: v }))}
                            bgId={`sliderbg_${r}`}
                            valueId={`actualValue_${r}`}
                            thumbId={`sliderthumb_${r}`}
                            /* The generic track (`.sliderinput .sliderbg`) is
                               332px with 10px padding and a 16px thumb, so the
                               travel is 10..326. The 344 default is the
                               350px worker track's, and it pushed the thumb
                               18px past this track's end, under the max
                               arrow. */
                            to={326}
                          />
                          <a
                            className="setMin"
                            href="#reset"
                            onClick={(e) => {
                              e.preventDefault()
                              setSend((c) => ({ ...c, [r]: 0 }))
                            }}
                          >
                            <span className="textLabel">{t('min')}</span>
                          </a>
                          <a
                            className="setMax"
                            href="#max"
                            onClick={(e) => {
                              e.preventDefault()
                              setSend((c) => ({ ...c, [r]: maxFor(r) }))
                            }}
                          >
                            <span className="textLabel">{t('max')}</span>
                          </a>
                        </div>
                        <input
                          type="text"
                          className="textfield"
                          id={`textfield_${r}`}
                          size={4}
                          maxLength={9}
                          /* The skin's left:414px parks this box over the max
                             arrow (track ends at 450, arrow at 426..450).
                             455px clears the arrow and puts the box to its
                             right, where it belongs. */
                          style={{ left: '455px' }}
                          value={send[r] ?? 0}
                          onChange={(e) =>
                            setSend((c) => ({
                              ...c,
                              [r]: Math.min(maxFor(r), Number(e.target.value) || 0),
                            }))
                          }
                        />
                      </li>
                    ))}
                    <li>
                      <div className="summaryText">{t('empty_seat')}:</div>
                      <div className="summary" id="sendSummary">
                        {loaded}/{Math.max(0, freeCapacity)}
                      </div>
                    </li>
                  </ul>
                  <hr />
                  <div id="missionSummary">
                    <div className="common">
                      <div className="journeyTarget">
                        <span className="textLabel">{t('destination')}: </span>
                        {island?.name ?? ''}
                      </div>
                      <div className="journeyTime">
                        <span className="textLabel">{t('duration_journey')}: </span>
                        {formatTime(travelTime)}
                      </div>
                    </div>
                    <div className="transporters">
                      <span className="textLabel">{t('button_transporters_name')}: </span>
                      <span>
                        <input
                          type="text"
                          id="transporterCount"
                          size={3}
                          maxLength={3}
                          readOnly
                          value={transports}
                        />{' '}
                        / {num(ctx.state.user.transports)}
                      </span>
                    </div>
                  </div>
                  <div className="centerButton">
                    <input type="submit" id="colonizeBtn" className="button" value={t('base_colony')} />
                  </div>
                </>
              )}
              {ctx.failure && <p className="error">{t(ctx.failure)}</p>}
            </div>
            <div className="footer" />
          </div>
        </form>
      </div>
    </>
  )
}

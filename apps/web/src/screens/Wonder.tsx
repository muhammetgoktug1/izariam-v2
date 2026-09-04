/**
 * The island's monument, izariam/views/view/wonder.php -- which does not exist.
 *
 * The legacy links here from the island board (`island.php:132`) and has no
 * controller behind the link, so it was one of the four dead 2012 URLs. What it
 * does have is the finished stylesheet, `design/skin/ik_wonder_0.4.5.css`, and
 * that file is the specification: it names `#wonderbox`, `.wonderPicN`,
 * `.wonderRays`, `.wonderDeity`, `#resUpgrade`, and a roster with the columns
 * `donor cityName donated priests convertion percentage` -- the monument, what
 * the island has given it, and how the island's faith is divided between the
 * towns that produced it. `convertion` is spelled that way in the skin.
 *
 * Two of those rules paint nothing on their own: the skin gives the god picture
 * and the belief bar a background and no dimensions, so this file sizes them
 * from the art. `wonder2/wonderN_active.gif` is 138x163 drawn at -15/-20, and
 * `wonder/belief_bar2.gif` is 512x213 -- three stacked 71px frames, empty then
 * the monument's ceiling then the island's belief, which is what `.wonder_bar`,
 * `.wonder_level` and `.wonder_belief` select with their background offsets
 * (ik_common_0.4.5.css:1515-1533). The five widths `.wonder_l1..l5` are the
 * segment boundaries.
 */

import { MIRACLES, effectiveMiracleLevel, miracleLevelForFaith } from '@izariam/rules'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, type WonderView } from '../lib/api.js'
import { num, t, tf } from '../lib/i18n.js'
import { hashFor } from '../lib/routes.js'
import type { Screen, ScreenContext } from './context.js'

type Good = WonderView['island']['goods'][number]

/** The resource icons are named after the good, except crystal glass. */
function goodIcon(good: Good): string {
  return `/skin/resources/icon_${good === 'crystal' ? 'glass' : good}.gif`
}

/** Whole percents, but one decimal below ten: a level-26 capital alone seats
 *  2,740, so a handful of priests is genuinely a fraction of a percent and
 *  flooring it reads as "nothing is working". */
function percent(value: number): string {
  const pct = value * 100
  if (pct > 0 && pct < 10) return `${pct.toFixed(1).replace('.', ',')}%`
  return `${Math.floor(pct)}%`
}

export const WonderScreen: Screen = ({ ctx, sideboxes }) => {
  const islandId = ctx.route.params[0] || ctx.town.islandId
  const view = useQuery({
    queryKey: ['island', islandId, 'wonder'],
    queryFn: () => api.islandWonder(islandId),
  })

  const data = view.data
  const wonder = data?.island.wonder ?? 0
  const spec = wonder ? MIRACLES[wonder] : undefined

  return (
    <>
      {sideboxes}
      <div id="mainview">
        <div className="buildingDescription">
          <h1>{wonder ? t(`wonder_${wonder}`) : t('no_wonder')}</h1>
        </div>

        {data && spec && (
          <>
            <Monument ctx={ctx} data={data} />
            <Donation ctx={ctx} data={data} onDone={() => void view.refetch()} />
            <Roster ctx={ctx} data={data} />
          </>
        )}
      </div>
    </>
  )
}

/**
 * The god, what the monument is standing at, and what the priests would get if
 * they asked today.
 *
 * The effect line is the *effective* level, not the one faith alone would
 * unlock: showing the level-5 text under a level-1 monument would promise
 * something the server then refuses to grant.
 */
function Monument({ ctx, data }: { ctx: ScreenContext; data: WonderView }) {
  const { wonder, wonderLevel } = data.island
  const faith = data.faith.faith
  const faithLevel = miracleLevelForFaith(faith)
  const level = effectiveMiracleLevel(wonderLevel, faith)

  const running = ctx.state.user.miracles.find((m) => m.islandId === data.island.id)
  const spec = MIRACLES[wonder]!
  const active = running != null && ctx.now < running.activatedAt + spec.duration

  return (
    <div id="wonderbox" className="contentBox01h">
      <h3 className="header">
        <span className="textLabel">{t('wonder')}: </span>
        {t(`wonder_${wonder}`)}
      </h3>
      <div className={`content ${active ? 'wonderRays' : 'wonderDeity'}`} style={{ minHeight: 163 }}>
        <div
          className={`wonderPic${wonder}${active ? '_active' : ''}`}
          /* Pinned to the content's top-left: the skin sizes the god from the
             art and pushes the text clear with `h4/p{margin-left:190px}`, but
             it never sets left/top on the picture, so an unpinned absolute
             drifts into the description. */
          style={{ position: 'absolute', left: 0, top: 0, width: 190, height: 163 }}
        />
        <h4>{t(`wonder_${wonder}`)}</h4>
        <p>{t(`wonder${wonder}_desc`)}</p>
        <p className="effect">
          {level > 0 ? t(`wonder${wonder}_level${level}`) : t('faith_too_low')}
        </p>

        {/* The bar carries both numbers: how far the island believes, and how
            far the monument can carry that belief. Where they stop apart is
            exactly what the player has left to fix. */}
        <div style={{ position: 'relative', height: 90, marginLeft: 40 }}>
          <div className="wonder_bar">
            {/* `wonder_bar` again on each overlay, which is where the image
                and the 71px height come from: `.wonder_level` and
                `.wonder_belief` are a `background-position` and nothing else,
                and `.wonder_lN` overrides the 512px width with the segment's
                because it is the later rule. */}
            {wonderLevel > 0 && (
              <div className={`wonder_bar wonder_level wonder_l${wonderLevel}`} />
            )}
            {faithLevel > 0 && <div className={`wonder_bar wonder_belief wonder_l${faithLevel}`} />}
            <div className={`wonder_level_display wld${Math.max(1, level)}`}>{level}</div>
          </div>
        </div>

        {/* The skin has no rules for this list -- the legacy never shipped a
            wonder page -- so it gets the sidebox idiom: no bullets, spaced
            label/value rows under the belief bar, inside the box's width. */}
        <ul style={{ listStyle: 'none', margin: '4px 40px 0 40px', padding: 0 }}>
          <li style={{ margin: '4px 0' }}>
            <span className="textLabel">{t('island_faith')}: </span>
            <span className="value" style={{ fontWeight: 'bold' }}>
              {percent(faith)}
            </span>{' '}
            <span className="timeUnit">
              ({t('level')} {faithLevel})
            </span>
          </li>
          <li style={{ margin: '4px 0' }}>
            <span className="textLabel">{t('wonder_level')}: </span>
            <span className="value" style={{ fontWeight: 'bold' }}>
              {wonderLevel}/5
            </span>
          </li>
          <li style={{ margin: '4px 0' }}>
            <span className="textLabel">{t('duration')}: </span>
            {spec.duration > 0 ? `${Math.round(spec.duration / 3600)} ${t('hours')}` : '-'}
          </li>
        </ul>

        {wonderLevel < faithLevel && (
          <p className="voted">{tf('wonder_limits_miracle', String(wonderLevel))}</p>
        )}
      </div>
      <div className="footer" />
    </div>
  )
}

/**
 * The expansion. Every player on the island may give, and only in the three
 * luxuries the island does not produce itself -- the legacy's own rule
 * (`information43_2`), which the server enforces from the island's row.
 */
function Donation({
  ctx,
  data,
  onDone,
}: {
  ctx: ScreenContext
  data: WonderView
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [amounts, setAmounts] = useState<Record<string, number>>({})
  const cost = data.island.costPerGood

  async function give(good: Good, amount: number) {
    if (amount <= 0) return
    const ok = await ctx.act('donateWonder', {
      townId: ctx.town.id,
      islandId: data.island.id,
      good,
      amount,
    })
    if (ok) {
      setAmounts((a) => ({ ...a, [good]: 0 }))
      await queryClient.invalidateQueries({ queryKey: ['island', data.island.id, 'wonder'] })
      onDone()
    }
  }

  return (
    <div id="resUpgrade" className="contentBox01h">
      <h3 className="header">
        <span className="textLabel">{t('wonder_donate')}</span>
      </h3>
      <div className="content">
        <p>{t('wonder_donate_desc')}</p>

        {cost == null ? (
          <p className="notice">{t('wonder_complete')}</p>
        ) : (
          /* The skin's own donation rows point at wonder2/multi_*.gif, none of
             which exist in design/, so the rich row never had art. The
             parchment `table01` is the skin's universal styled table -- the
             same one the island camps' roster uses -- and gives the three
             luxuries a clean row each: what is standing, what is missing, and
             the give controls right-aligned. */
          <table className="table01" cellPadding={0} cellSpacing={0}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>{t('resource')}</th>
                <th>{t('present')}</th>
                <th>{t('need_for_next')}</th>
                <th>{t('donate')}</th>
              </tr>
            </thead>
            <tbody>
              {data.island.goods.map((good, i) => {
                const given = data.island.donated[good]
                const missing = Math.max(0, cost - given)
                const stock = Math.floor(ctx.town.resources[good])
                const value = amounts[good] ?? 0
                return (
                  <tr key={good} className={i % 2 === 1 ? 'alt' : undefined}>
                    <td style={{ textAlign: 'left' }}>
                      <img className="multipleDonationImg" src={goodIcon(good)} alt={t(good)} />
                      {t(good)}
                    </td>
                    <td>
                      {num(given)} / {num(cost)}
                    </td>
                    <td>{num(missing)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <input
                        className="textfield"
                        style={{ width: 70, textAlign: 'center' }}
                        autoComplete="off"
                        value={value || ''}
                        onChange={(e) =>
                          setAmounts((a) => ({
                            ...a,
                            [good]: Math.min(stock, Math.max(0, Number(e.target.value) || 0)),
                          }))
                        }
                      />{' '}
                      <a
                        href="#max"
                        title={t('donate_max')}
                        onClick={(e) => {
                          e.preventDefault()
                          setAmounts((a) => ({ ...a, [good]: Math.min(stock, missing) }))
                        }}
                      >
                        {t('max')}
                      </a>{' '}
                      <a
                        href="#donate"
                        className="button"
                        onClick={(e) => {
                          e.preventDefault()
                          void give(good, value)
                        }}
                      >
                        {t('donate')}
                      </a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {ctx.failure && <p className="error">{t(ctx.failure)}</p>}
      </div>
      <div className="footer" />
    </div>
  )
}

/**
 * Every town on the island: who owns it, what it has given, how many priests
 * it keeps, how many islanders those priests have converted, and what share of
 * the island's faith that makes.
 *
 * The shares add up to 100% because `converted` is capped at each town's own
 * capacity on the server -- a town cannot convert islanders it does not hold.
 */
function Roster({ ctx, data }: { ctx: ScreenContext; data: WonderView }) {
  return (
    <div id="wonderOtherPlayers" className="contentBox01h">
      <h3 className="header">
        <span className="textLabel">{t('other_players_island')}</span>
      </h3>
      <div className="content">
        <table className="table02" cellPadding={0} cellSpacing={0}>
          <thead>
            <tr>
              <th className="donor">{t('donor')}</th>
              <th className="cityName">{t('city')}</th>
              <th className="donated">{t('donated')}</th>
              <th className="priests">{t('priests')}</th>
              <th className="convertion">{t('converted')}</th>
              <th className="percentage">{t('island_share')}</th>
            </tr>
          </thead>
          <tbody>
            {data.towns.map((row) => (
              <tr key={row.townId} className={row.userId === ctx.state.user.id ? 'own' : undefined}>
                <td className="donor">
                  {row.userId === ctx.state.user.id ? (
                    row.owner
                  ) : (
                    <a
                      href={hashFor('sendIKMessage', row.userId, encodeURIComponent(row.owner))}
                      onClick={(e) => {
                        e.preventDefault()
                        ctx.navigate(hashFor('sendIKMessage', row.userId, encodeURIComponent(row.owner)))
                      }}
                    >
                      {row.owner}
                    </a>
                  )}
                </td>
                <td className="cityName">{row.name}</td>
                <td className="donated">{num(row.donated)}</td>
                <td className="priests">{num(row.priests)}</td>
                <td className="convertion">{num(row.converted)}</td>
                <td className="percentage">{percent(row.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="footer" />
    </div>
  )
}

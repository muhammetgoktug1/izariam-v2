/**
 * The island board, izariam/views/view/island.php.
 *
 * The highest-value screen in the port: without it the city -> island -> world
 * loop has no middle, and colonize, transport, sendSpy and plunder have no
 * entry point at all.
 *
 * 17 slots are drawn. Slots 0-15 are the ordinary board; slot 16 is
 * `premiumBuildPlace`, which links to `game/colonizeExtreme` -- a view that
 * exists (406 lines) but has no controller and no `show_view` case, so the link
 * has always 404'd. It is still rendered, because the skin lays the board out
 * around 17 tiles and dropping the last one shifts the rest.
 *
 * Selection is React state. The legacy did it with `selectCity()` reaching
 * across the DOM to clone this `<li>`'s `ul.cityinfo` and `ul.cityactions` into
 * the two sideboxes; here both halves render from the same `selected` value,
 * which is why this screen supplies its own sideboxes.
 *
 * Two links the legacy renders are dead and are not reproduced as links:
 * `game/reportPlayer` and `game/islandBoard` have no controller. `game/wonder`
 * was a third until this port built the screen behind it (screens/Wonder.tsx),
 * so the monument tile is the one dead 2012 link that now goes somewhere.
 */

import { MAPS } from '@izariam/gamedata'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, type IslandSlotView } from '../lib/api.js'
import { num, t } from '../lib/i18n.js'
import { islandBuildingName } from '../lib/buildings.js'
import { hashFor } from '../lib/routes.js'
import type { Screen, ScreenContext } from './context.js'

/** The board's own slots; 16 is the premium tile drawn after them. */
const BOARD_SLOTS = 16

function resourceClass(resource: number): string {
  const names = MAPS.resource_class_by_type as Record<string, string>
  return names[String(resource)] ?? 'wood'
}

export const IslandScreen: Screen = ({ ctx }) => {
    // Defaults to the player's own island, which is what `game/island/` with
    // no parameter meant.
    const islandId = ctx.route.params[0] || ctx.town.islandId

    const detail = useQuery({
      queryKey: ['island', islandId],
      queryFn: () => api.island(islandId),
    })
    const [selected, setSelected] = useState<number | null>(null)

    if (detail.isError) return <div id="mainview">{t('page_not_found')}</div>
    if (!detail.data) return <div id="mainview" />

    const { island, slots } = detail.data
    const isHome = island.id === ctx.town.islandId
    const chosen = slots.find((s) => s.slot === selected)?.town ?? null

    const link = (hash: string) => (e: React.MouseEvent) => {
      e.preventDefault()
      ctx.navigate(hash)
    }

    const main = (
      <div id="mainview" className={`island${island.type}`}>
        <h3>
          {t('towns_on_island')} {island.name}
        </h3>
        <ul id="cities">
          {Array.from({ length: BOARD_SLOTS }, (_, i) => {
            const slot = slots.find((s) => s.slot === i)
            const town = slot?.town ?? null
            if (!town) {
              return (
                <li key={i} id={`cityLocation${i}`} className="cityLocation buildplace">
                  <div className="claim" />
                  <a
                    href={hashFor('colonize', island.id, i)}
                    title={t('colonize_here')}
                    onClick={link(hashFor('colonize', island.id, i))}
                  >
                    <span className="textLabel">
                      <span className="before" />
                      {t('building_ground')}
                      <span className="after" />
                    </span>
                  </a>
                </li>
              )
            }

            const mine = town.userId === ctx.state.user.id
            // level 0 is a colony whose fleet has not landed: it renders the
            // scaffolding sprite and is not selectable.
            const imgClass =
              town.level > 0 ? (mine ? 'ownCityImg' : 'cityimg') : 'buildCityImg'

            return (
              <li
                key={i}
                id={`cityLocation${i}`}
                className={`cityLocation city level${town.level}${
                  selected === i ? ' selected' : ''
                }`}
              >
                <div className={imgClass} />
                <div className="selectimg" />
                {town.level > 0 && (
                  <a
                    href="#"
                    id={`city_${town.id}`}
                    onClick={(e) => {
                      e.preventDefault()
                      setSelected(i)
                    }}
                  >
                    <span className="textLabel">
                      <span className="before" />
                      {town.name}
                      <span className="after" />
                    </span>
                  </a>
                )}
                <ul className="cityinfo">
                  <li className="name">
                    <span className="textLabel">{t('name')}: </span>
                    {town.name}
                  </li>
                  <li className="citylevel">
                    <span className="textLabel">{t('town_size')}: </span>
                    {town.level}
                  </li>
                  <li className="owner">
                    <span className="textLabel">{t('player')}: </span>
                    {town.owner}
                    {!mine && (
                      <a
                        href={hashFor('sendIKMessage', town.userId, encodeURIComponent(town.owner))}
                        className="messageSend"
                        title={t('send_message')}
                        onClick={link(
                          hashFor('sendIKMessage', town.userId, encodeURIComponent(town.owner)),
                        )}
                      >
                        <img
                          src="/skin/interface/icon_message_write.gif"
                          alt={t('send_message')}
                        />
                      </a>
                    )}
                  </li>
                  <li className="name">
                    <span className="textLabel">{t('points')}: </span>
                    {num(town.score)}
                  </li>
                  <li className="ally">
                    <span className="textLabel">{t('ally')}: </span>-
                  </li>
                </ul>
                <ul className="cityactions">{actionsFor(ctx, island.id, town, link)}</ul>
              </li>
            )
          })}

          {/* colonizeExtreme has no controller; the tile is drawn, the link
              is not offered. */}
          <li id="cityLocation16" className="cityLocation premiumBuildPlace">
            <div className="claim" />
            <a href="#" title={t('colonize_here')} onClick={(e) => e.preventDefault()}>
              <span className="textLabel">
                <span className="before" />
                {t('building_ground')}
                <span className="after" />
              </span>
            </a>
          </li>

          {isHome && (
            <li id="barbarianVilliage">
              <a href="#" id="barbarianLink" onClick={(e) => e.preventDefault()}>
                {' '}
              </a>
              <ul className="cityinfo" id="barbarianInformation">
                <li className="name">
                  <span className="textLabel">{t('name')}: </span>
                  {t('barbarian_village')}
                </li>
                <li className="citylevel">
                  <span className="textLabel">{t('city_level')}: </span>1
                </li>
                <li className="name">
                  <span className="textLabel">{t('barbarians')}: </span>1
                </li>
              </ul>
              <ul className="cityactions" id="barbarianActions">
                {/* Plundering needs a garrison. There is no combat model in
                    the legacy either -- actions/plunder has no handler -- so
                    the enabled branch links to a screen that only ever showed
                    a form. */}
                {ctx.townDerived.landUnitCount > 0 ? (
                  <li className="plundering">
                    <a
                      href={hashFor('plunder', island.id, 0)}
                      title={t('pillage')}
                      onClick={link(hashFor('plunder', island.id, 0))}
                    >
                      {t('pillage')}
                    </a>
                  </li>
                ) : (
                  <li className="plundering disabled" title={t('not_pillage')}>
                    <a id="barbarianPlundering" href="#" onClick={(e) => e.preventDefault()}>
                      {t('pillage')}
                    </a>
                  </li>
                )}
              </ul>
            </li>
          )}
        </ul>

        <h3>
          {t('special_places')} {island.name}
        </h3>
        <ul id="islandfeatures">
          {/* The two resource tiles only link on your own island. */}
          <li id="resource" className={`${resourceClass(0)} level${island.woodLevel}`}>
            <a
              href={isHome ? hashFor('resource', island.id) : '#'}
              title={`${islandBuildingName(0)} ${island.woodLevel}`}
              onClick={isHome ? link(hashFor('resource', island.id)) : (e) => e.preventDefault()}
            >
              <span className="textLabel">{islandBuildingName(0)}</span>
            </a>
          </li>
          <li
            id="tradegood"
            className={`${resourceClass(island.tradeResource)} level${island.tradeLevel}`}
          >
            <a
              href={isHome ? hashFor('tradegood', island.id) : '#'}
              title={`${islandBuildingName(island.tradeResource)} ${island.tradeLevel}`}
              onClick={isHome ? link(hashFor('tradegood', island.id)) : (e) => e.preventDefault()}
            >
              <span className="textLabel">{islandBuildingName(island.tradeResource)}</span>
            </a>
          </li>
          {island.wonder > 0 && (
            <li id="wonder" className={`wonder${island.wonder}`}>
              {/* `wonder_N`, not `wonderN_name`: the latter is in no language
                  file, so the label and its tooltip rendered empty. */}
              <a
                href={hashFor('wonder', island.id)}
                title={`${t(`wonder_${island.wonder}`)} (${t('level')} ${island.wonderLevel})`}
                onClick={link(hashFor('wonder', island.id))}
              >
                <span className="textLabel">{t(`wonder_${island.wonder}`)}</span>
              </a>
            </li>
          )}
          <li className="forum">
            {/* game/islandBoard has no controller either. */}
            <a title={t('agora')} href="#" onClick={(e) => e.preventDefault()}>
              <span className="textLabel">{t('agora')}</span>
            </a>
          </li>
        </ul>
      </div>
    )

  // sidebox/island.php: two boxes that start as hint text and filled from the
  // selected town. This screen ignores the dispatcher's copy and renders them
  // itself, because their content is the selection.
  const ownSideboxes = (
      <>
        <div id="infocontainer" className="dynamic">
          <h3 className="header">{t('info')}</h3>
          <div id="information" className="content">
            {chosen ? (
              <ul className="cityinfo">
                <li className="name">
                  <span className="textLabel">{t('name')}: </span>
                  {chosen.name}
                </li>
                <li className="citylevel">
                  <span className="textLabel">{t('town_size')}: </span>
                  {chosen.level}
                </li>
                <li className="owner">
                  <span className="textLabel">{t('player')}: </span>
                  {chosen.owner}
                </li>
                <li className="name">
                  <span className="textLabel">{t('points')}: </span>
                  {num(chosen.score)}
                </li>
              </ul>
            ) : (
              <div className="accesshint">{t('info_text')}</div>
            )}
          </div>
          <div className="footer" />
        </div>
        <div id="actioncontainer" className="dynamic">
          <h3 className="header">{t('actions')}</h3>
          <div id="actions" className="content">
            {chosen ? (
              <ul className="cityactions">{actionsFor(ctx, island.id, chosen, link)}</ul>
            ) : (
              <div className="accesshint">{t('info_text')}</div>
            )}
          </div>
          <div className="footer" />
        </div>
      </>
    )

  // Sideboxes first, matching game_index.php:333-334.
  return (
    <>
      {ownSideboxes}
      {main}
    </>
  )
}

/** The three per-town actions, shared by the tile and the sidebox. */
function actionsFor(
  ctx: ScreenContext,
  islandId: number,
  town: NonNullable<IslandSlotView['town']>,
  link: (hash: string) => (e: React.MouseEvent) => void,
) {
  const mine = town.userId === ctx.state.user.id
  const out = []

  if (!mine) {
    const write = hashFor('sendIKMessage', town.userId, encodeURIComponent(town.owner))
    out.push(
      <li key="diplomacy" className="diplomacy">
        <a href={write} title={t('diplomacy')} onClick={link(write)}>
          <span className="textLabel">{t('diplomacy')}</span>
        </a>
      </li>,
    )
  }

  // Offered for every town but the one you are standing in, your own included.
  if (town.id !== ctx.town.id) {
    out.push(
      <li key="transport" className="transport">
        <a
          href={hashFor('transport', islandId, town.id)}
          title={t('transport_goods')}
          onClick={link(hashFor('transport', islandId, town.id))}
        >
          <span className="textLabel">{t('transport_goods')}</span>
        </a>
      </li>,
    )
  }

  if (!mine) {
    out.push(
      ctx.town.spies === 0 ? (
        <li key="spy" className="espionage disabled" title={t('not_spyes')}>
          {/* The skin pads the label only through `li a .textLabel`
              (padding-top 34 + 36); the disabled variant's own rule has no
              padding, so the greyed sprite collapsed to an 11px strip --
              the same sliver the 2012 page shipped. Mirror the enabled
              button's geometry here instead of editing the skin. */}
          <span className="textLabel" style={{ paddingTop: 70 }}>
            {t('send_spy')}
          </span>
        </li>
      ) : (
        <li key="spy" className="espionage">
          <a
            href={hashFor('sendSpy', islandId, town.id)}
            title={t('send_spy')}
            onClick={link(hashFor('sendSpy', islandId, town.id))}
          >
            <span className="textLabel">{t('send_spy')}</span>
          </a>
        </li>
      ),
    )
  }

  return out
}

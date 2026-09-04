/**
 * The palace, izariam/views/view/palace.php, and palaceColony.php. Both are 66
 * lines and share the first 42; where palace.php ends with the "occupied
 * cities" table, palaceColony.php ends with the move-the-capital blocks
 * (palaceColony.php:43-65). Two routes, one component, one branch at the end.
 *
 * A roster of the player's towns with the level of the palace in each. The
 * palace level scan runs slots 3..13 only (palace.php:22), so a palace built
 * on slot 14 -- the wall slot, reachable by hand-building the build URL --
 * reports level 0 here while still counting toward the colony limit.
 *
 * "Occupied cities" is a hardcoded empty row in the legacy: there is no
 * conquest model, so it can never hold anything.
 *
 * Every string is hardcoded Russian in the original with no language key, so
 * the ones this screen needs live in HARDCODED / HARDCODED_TR rather than in
 * the extracted language file.
 */

import { BUILDING, type TownState } from '@izariam/rules'
import { MAPS } from '@izariam/gamedata'

import { BuildingHeader } from '../components/building/BuildingHeader.js'
import { islandBuildingName } from '../lib/buildings.js'
import { t, tf } from '../lib/i18n.js'
import { hashFor } from '../lib/routes.js'
import type { Screen, ScreenContext } from './context.js'

/** The scan the legacy runs: slots 3 to 13, and only those. */
function palaceLevel(town: TownState): number {
  let level = 0
  for (let slot = 3; slot <= 13; slot++) {
    const b = town.buildings.bySlot[slot]
    if (b?.type === BUILDING.PALACE) level = b.level
  }
  return level
}

function resourceIcon(resource: number): string {
  const names = MAPS.resource_class_by_type as Record<string, string>
  return names[String(resource)] ?? 'wood'
}

export const PalaceScreen: Screen = ({ ctx, sideboxes }) => {
  const position = ctx.route.params[0]

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
            <span className="textLabel">{t('towns_of_empire')}</span>
          </h3>
          <div className="content">
            <table cellPadding={0} cellSpacing={0} className="table01">
              <thead>
                <tr>
                  <th className="crown" />
                  <th>{t('city')}</th>
                  <th>{t('level')}</th>
                  <th>{t('building10_name')}</th>
                  <th>{t('island')}</th>
                  <th>{t('resource')}</th>
                </tr>
              </thead>
              <tbody>
                {ctx.state.towns.map((town) => {
                  const island = ctx.state.islands[town.islandId]
                  const good = island?.tradeResource ?? 0
                  return (
                    <tr key={town.id}>
                      <td>
                        {town.id === ctx.state.user.capitalTownId && (
                          <img
                            src="/skin/layout/crown.gif"
                            width={20}
                            height={20}
                            alt={t('capital')}
                            title={t('capital')}
                          />
                        )}
                      </td>
                      <td>{town.name}</td>
                      <td>{town.buildings.bySlot[0]?.level ?? 0}</td>
                      <td>{palaceLevel(town)}</td>
                      <td>
                        {island?.name} [{island?.x}:{island?.y}]
                      </td>
                      <td>
                        <img
                          src={`/skin/resources/icon_${resourceIcon(good)}.gif`}
                          title={islandBuildingName(good)}
                          alt={islandBuildingName(good)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="footer" />
        </div>

        {ctx.route.page === 'palaceColony' ? (
          <MoveCapital ctx={ctx} position={position} />
        ) : (
          /* Hardcoded empty in the legacy: there is no conquest model. */
          <div className="contentBox01h">
            <h3 className="header">
              <span className="textLabel">{t('occupied_cities')}</span>
            </h3>
            <div className="content">
              <table cellPadding={0} cellSpacing={0} className="table01">
                <thead>
                  <tr>
                    <th className="crown" />
                    <th>{t('city')}</th>
                    <th>{t('level')}</th>
                    <th>{t('island')}</th>
                    <th>{t('resource')}</th>
                    <th>{t('action')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={6}>{t('no_occupied_cities')}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="footer" />
          </div>
        )}
      </div>
    </>
  )
}

/**
 * palaceColony.php:43-65 -- promote this colony to capital.
 *
 * Two steps, as the legacy: a pitch with a button that reloads the page with
 * `upgrade` in the URL, then a confirmation whose button is the only caller of
 * `changeCapital`. Worth confirming: the action demolishes the palace in the
 * old capital outright, with no refund.
 */
function MoveCapital({ ctx, position }: { ctx: ScreenContext; position: number }) {
  const confirming = ctx.route.raw[1] === 'upgrade'
  const capital = ctx.state.towns.find((town) => town.id === ctx.state.user.capitalTownId)

  // Already the capital: the legacy still renders the box, and the action
  // rejects it, so the button stays and the rules answer.
  if (confirming) {
    return (
      <div className="contentBox01h" id="moveCapitalConfirmation">
        <h3 className="header">
          <span className="textLabel">{t('confirm')}</span>
        </h3>
        <div className="content">
          <p>
            {tf(
              'move_capital_confirm',
              ctx.town.name,
              capital?.name ?? '-',
              palaceLevel(capital ?? ctx.town),
            )}
          </p>
          {ctx.failure && <p className="error">{t(ctx.failure)}</p>}
          <div className="centerButton">
            <a
              href="#confirm"
              className="button"
              onClick={(e) => {
                e.preventDefault()
                void ctx.act('changeCapital', { townId: ctx.town.id })
              }}
            >
              {t('confirm')}
            </a>
          </div>
        </div>
        <div className="footer" />
      </div>
    )
  }

  return (
    <div className="contentBox01h" id="moveCapital">
      <h3 className="header">
        <span className="textLabel">{t('move_capital')}</span>
      </h3>
      <div className="content">
        <p>{t('move_capital_text')}</p>
        <div className="centerButton">
          <a
            href={hashFor('palaceColony', position, 'upgrade')}
            className="button"
            onClick={(e) => {
              e.preventDefault()
              ctx.navigate(hashFor('palaceColony', position, 'upgrade'))
            }}
          >
            {t('move_capital_button')}
          </a>
        </div>
      </div>
      <div className="footer" />
    </div>
  )
}
